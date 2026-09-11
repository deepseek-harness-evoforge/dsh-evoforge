import { createHash, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  SessionLogOffset,
  type SessionEvent,
  type SessionHeader,
  type UserMessage,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import type {
  GatewayCommandResult,
  GatewayIngressRecord,
  GatewayIngressJournal,
} from './ingress-journal.js'
import type {
  GatewayIngressEvidenceObservationV1,
  GatewayIngressEvidenceVaultV1,
} from './message-ingress-evidence.js'
import type {
  GatewayEndpoint,
  ResolvedGatewayRoute,
  ResolvedGatewayRoutes,
} from './routing.js'
import { sessionEvents } from './session-log.ts'
import {
  GatewayOutboundCoordinator,
  type GatewayOutboundObservation,
  type GatewayOutboundHealth,
  type GatewayTextAdapterConfig,
  type GatewayTextAdapterRegistration,
} from './outbound.js'
import type { GatewayOutboundJournal } from './outbound-journal.js'
import type {
  GatewayPairingApproval,
  GatewayPairingApprovalInput,
  GatewayPairingAuthority,
  GatewayPairingOffer,
  GatewayPairingPendingRequest,
  GatewayPairingRequestApprovalInput,
  GatewayPairingRevocation,
  GatewayPairingTarget,
} from './pairing.js'
import {
  GatewayTransportRegistry,
  type GatewayTransportConfig,
  type GatewayTransportHealth,
  type GatewayTransportRegistration,
} from './transport-health.js'

export interface GatewayDispatchInput {
  readonly endpoint: GatewayEndpoint
  /** Adapter-owned stable id for one inbound event. */
  readonly eventId: string
  /** Optional exact user text. Image-only messages deliberately omit it. */
  readonly text?: string
  /** Durable native DSH image references; external resource keys never cross this seam. */
  readonly images?: readonly ImageAttachmentRef[]
  readonly signal?: AbortSignal
}

export interface GatewayAcceptInput extends GatewayDispatchInput {
  readonly chatKind: 'direct' | 'group'
  /** Exact observation time used only when an unknown direct sender needs pairing. */
  readonly now?: number
}

interface GatewayUserContent {
  readonly blocks: Readonly<UserMessage['content']>
  readonly commandText?: string
  readonly contentHash: string
}

interface IngressEvidenceBoundary {
  readonly workspace: Workspace
  readonly session: Agent['session']
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly beforeSeq: number
  readonly nextTurnLength: number
}

interface GatewayDispatchBase {
  readonly route: ResolvedGatewayRoute
  readonly agent: Agent
  readonly duplicate: boolean
  readonly ingressId: string
}

export type GatewayDispatchResult =
  | (GatewayDispatchBase & { readonly kind: 'message' })
  | (GatewayDispatchBase & { readonly kind: 'command'; readonly result: GatewayCommandResult })

export type GatewayAcceptResult = GatewayDispatchResult
  | { readonly kind: 'pairing'; readonly offer: GatewayPairingOffer }
  | { readonly kind: 'rejected'; readonly reason: 'untrusted' }

export type GatewayAuthorizationResult =
  | { readonly kind: 'trusted'; readonly route: ResolvedGatewayRoute }
  | { readonly kind: 'pairing'; readonly offer: GatewayPairingOffer }
  | { readonly kind: 'rejected'; readonly reason: 'untrusted' }

export interface GatewayPairingSessionApprovalInput {
  readonly code: string
  readonly adapter: string
  readonly workspaceId: string
  readonly sessionId: string
}

export interface GatewayPairingSessionRequestApprovalInput {
  readonly requestId: string
  readonly workspaceId: string
  readonly sessionId: string
}

export interface GatewayPairingSessionApprovalReceipt {
  readonly routeId: string
  readonly workspaceId: string
  readonly sessionId: string
}

export type GatewayPairingRevocationReceipt = GatewayPairingRevocation

export interface GatewayHealthRoute {
  readonly id: string
  readonly adapter: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly threadScoped: boolean
  readonly live: boolean
  /** True only for a dynamic principal grant owned by the pairing authority. */
  readonly paired: boolean
}

export interface GatewayHealthSnapshot {
  readonly schemaVersion: 1
  readonly observedAt: number
  readonly lifecycle: 'starting' | 'ready' | 'stopping'
  readonly routes: {
    readonly total: number
    readonly liveSessions: number
    readonly items: readonly GatewayHealthRoute[]
  }
  readonly ingress: {
    readonly total: number
    readonly prepared: number
    readonly executing: number
    readonly settled: number
    readonly uncertain: number
  }
  readonly transports: GatewayTransportHealth
  readonly outbound: GatewayOutboundHealth
}

/** Redacted startup evidence retained until the Gateway is disposed. */
export interface GatewayRecoveryObservation {
  readonly workspaceId: string
  readonly ingressRecovered: number
  readonly outboundRecovered: number
  readonly observedAt: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Terminal outbound observation for optional long-term evidence projection. */
    'evoforge/gateway/outbound'(observation: GatewayOutboundObservation & { readonly workspaceId: string }): void
    /** Startup observation for inflight journal entries recovered after a prior interruption. */
    'evoforge/gateway/recovery'(observation: GatewayRecoveryObservation): void
  }
}

/** An accepted external event crossed an effect boundary whose outcome cannot be proven. */
export class GatewayIngressUncertainError extends Error {
  constructor(readonly ingressId: string, message: string) {
    super(`gateway ingress '${ingressId}' is uncertain: ${message}`)
    this.name = 'GatewayIngressUncertainError'
  }
}

interface PendingAgentResolution {
  readonly controller: AbortController
  readonly promise: Promise<Agent>
  readonly primary: PersistencePrimaryState
  waiters: number
  settled: boolean
}

/**
 * The shared Host-side routing seam used by platform adapters. It owns no
 * network transport: adapters authenticate and poll, then submit an exact
 * endpoint tuple here for native Workspace/Session/Agent dispatch.
 */
export class DshGateway {
  private readonly ownedHandles = new Map<string, AgentHandle>()
  private readonly resolutions = new Map<string, PendingAgentResolution>()
  private readonly activeResolutions = new Set<PendingAgentResolution>()
  private readonly activePersistenceLeases = new Set<CurrentReadHandleLease>()
  private readonly persistenceCloseFailures: unknown[] = []
  private readonly lifecycleController = new AbortController()
  private persistenceShutdownDeadlineAt: number | undefined
  private readonly ingressTails = new Map<string, Promise<void>>()
  private readonly activeIngressByRoute = new Map<string, number>()
  private readonly revokingRoutes = new Set<string>()
  private pairingMutationTail: Promise<void> = Promise.resolve()
  private started = false
  private starting: Promise<void> | undefined
  private sessionEventsBound = false
  private removeSessionEvents: (() => void) | undefined
  private stopping: Promise<void> | undefined
  private cleanupPromise: Promise<void> | undefined
  private recoveryObservationsValue: readonly GatewayRecoveryObservation[] = []
  private readonly outbound: GatewayOutboundCoordinator
  private readonly transports: GatewayTransportRegistry

  constructor(
    private readonly ctx: Context,
    private readonly configured: ResolvedGatewayRoutes,
    private readonly ingressJournal: GatewayIngressJournal,
    private readonly outboundJournal: GatewayOutboundJournal,
    private readonly pairing?: GatewayPairingAuthority,
    private readonly ingressEvidence?: GatewayIngressEvidenceVaultV1,
  ) {
    this.outbound = new GatewayOutboundCoordinator(
      configured,
      this.outboundJournal,
      (route, turn, signal) => this.nativeTurnEnded(route, turn, signal),
      id => this.pairedRoute(id),
      record => this.observeOutbound(record),
    )
    this.transports = new GatewayTransportRegistry(configured, id => this.pairedRoute(id))
  }

  private observeOutbound(record: import('./outbound-journal.js').GatewayOutboundRecord): void {
    const route = this.route(record.routeId)
    if (route === undefined || !['delivered', 'uncertain', 'failed'].includes(record.status)) return
    const operationKeyHash = createHash('sha256')
      .update(`${route.adapter}:${record.kind}`)
      .digest('hex')
    const intentKeyHash = createHash('sha256').update(record.intentKey).digest('hex')
    this.ctx.emit('evoforge/gateway/outbound', {
      workspaceId: route.workspaceId,
      recordId: record.id,
      routeId: record.routeId,
      adapter: route.adapter,
      intentKeyHash,
      operationKeyHash,
      status: record.status === 'delivered' ? 'applied' : 'unknown',
      attempts: record.attempts,
      observedAt: record.updatedAt,
    })
  }

  /** Validate the complete static binding table before any adapter accepts traffic. */
  start(): Promise<void> {
    if (this.stopping !== undefined) return Promise.reject(new Error('DSH gateway is stopping'))
    if (this.started) return Promise.resolve()
    if (this.starting !== undefined) return this.starting
    const starting = this.startInternal()
    this.starting = starting
    void starting.then(
      () => {
        if (this.starting === starting) this.starting = undefined
      },
      () => {
        if (this.starting === starting) this.starting = undefined
      },
    )
    return starting
  }

  private async startInternal(): Promise<void> {
    try {
      const observedAt = Date.now()
      const ingressBefore = this.ingressJournal.list().filter(record => record.status === 'executing')
      const outboundBefore = this.outboundJournal.list().filter(record => record.status === 'sending')
      const ingressRecovered = await this.ingressJournal.recoverInflight(observedAt)
      const outboundRecovered = await this.outbound.start(observedAt)
      if (!this.sessionEventsBound) {
        this.sessionEventsBound = true
        this.removeSessionEvents = this.ctx.on('session/event', (session, event) => {
          if (event.type !== 'turn/end') return
          this.outbound.wakeEndedTurn(String(session.id), event.data.turn)
        })
      }
      const persisted = await listPersistenceHeaders(
        this.ctx.sessionPersistence,
        this.lifecycleController.signal,
      )
      const persistedById = new Map(persisted.map(header => [String(header.id), header]))
      this.assertRouteSet()
      for (const route of this.allRoutes()) {
        const workspace = await this.requireWorkspace(route, this.lifecycleController.signal)
        await this.requirePreset(route, this.lifecycleController.signal)
        const live = this.ctx.agents.get(SessionId(route.sessionId))
        if (live !== undefined) {
          this.assertLiveIdentity(route, workspace, live)
          continue
        }
        if (persistedById.has(route.sessionId)) {
          const inspected = await inspectPersistenceSession(
            this.ctx.sessionPersistence,
            SessionId(route.sessionId),
            this.lifecycleController.signal,
            lease => { this.registerPersistenceLease(lease) },
          )
          this.assertPersistedIdentity(route, workspace, inspected.meta, inspected.events)
        }
      }
      this.observeRecovery(ingressBefore, outboundBefore, ingressRecovered, outboundRecovered, observedAt)
      this.started = true
    } catch (error: unknown) {
      // A direct DshGateway consumer must not leak journals or listeners when startup validation fails.
      // Do not call stop() here: a concurrent public stop() waits for this startup
      // promise, so awaiting it from inside startup would deadlock. The cleanup
      // itself is shared and idempotent; a racing stop() will await the same work.
      // Teardown is still awaited, but a journal/transport close failure must
      // not replace the actionable startup validation error. Public stop() can
      // report the shared cleanup failure to its caller independently.
      const cleanup = this.cleanupResources()
      await Promise.allSettled([cleanup])
      if (this.stopping === undefined) {
        this.persistenceShutdownDeadlineAt = globalThis.performance.now()
          + GATEWAY_PERSISTENCE_TIMEOUT_MS
        const stopping = Promise.resolve().then(async () => {
          const cleanupResult = await Promise.allSettled([cleanup])
          await this.quiescePersistenceLeases()
          const failed = cleanupResult[0]
          this.throwShutdownFailures(failed?.status === 'rejected' ? [failed.reason] : [])
        })
        // Startup reports its actionable validation failure. Retain and
        // observe the separate teardown result for a later explicit stop().
        void stopping.catch(() => undefined)
        this.stopping = stopping
      }
      throw error
    }
  }

  private observeRecovery(
    ingressBefore: readonly import('./ingress-journal.js').GatewayIngressRecord[],
    outboundBefore: readonly import('./outbound-journal.js').GatewayOutboundRecord[],
    ingressRecovered: number,
    outboundRecovered: number,
    observedAt: number,
  ): void {
    if (ingressRecovered === 0 && outboundRecovered === 0) return
    const byWorkspace = new Map<string, { ingressRecovered: number; outboundRecovered: number }>()
    for (const record of ingressBefore) {
      const route = this.route(record.routeId)
      if (route === undefined) continue
      const entry = byWorkspace.get(route.workspaceId) ?? { ingressRecovered: 0, outboundRecovered: 0 }
      entry.ingressRecovered += 1
      byWorkspace.set(route.workspaceId, entry)
    }
    for (const record of outboundBefore) {
      const route = this.route(record.routeId)
      if (route === undefined) continue
      const entry = byWorkspace.get(route.workspaceId) ?? { ingressRecovered: 0, outboundRecovered: 0 }
      entry.outboundRecovered += 1
      byWorkspace.set(route.workspaceId, entry)
    }
    const observations = [...byWorkspace.entries()].map(([workspaceId, counts]) => Object.freeze({
        workspaceId,
        ...counts,
        observedAt,
      }))
    this.recoveryObservationsValue = Object.freeze(observations)
    for (const observation of observations) this.ctx.emit('evoforge/gateway/recovery', observation)
  }

  /** Read-only replay seam for observers that attach after Gateway startup. */
  recoveryObservations(): readonly GatewayRecoveryObservation[] {
    return this.recoveryObservationsValue.map(observation => Object.freeze({ ...observation }))
  }

  route(id: string): ResolvedGatewayRoute | undefined {
    return this.configured.byId.get(id) ?? this.pairedRoute(id)
  }

  match(endpoint: GatewayEndpoint): ResolvedGatewayRoute | undefined {
    const configured = this.configured.match(endpoint)
    if (configured !== undefined) return configured
    const paired = this.pairing?.match(endpoint)
    return paired === undefined || this.revokingRoutes.has(paired.id) ? undefined : paired
  }

  approvePairing(input: GatewayPairingApprovalInput): Promise<GatewayPairingApproval> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    return this.enqueuePairingMutation(async () => {
      await this.validatePairingTarget(input.target)
      if (this.configured.byId.has(input.target.id) || this.pairing!.route(input.target.id) !== undefined) {
        throw new Error(`gateway pairing route id '${input.target.id}' is already configured`)
      }
      this.assertCompatibleSessionOwner(input.target)
      this.assertRunning()
      return this.pairing!.approve(input)
    })
  }

  async approvePairingForSession(
    input: GatewayPairingSessionApprovalInput,
  ): Promise<GatewayPairingSessionApprovalReceipt> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
    if (workspace === undefined || await runPersistenceDeadline(
      async () => workspace.status(),
      this.lifecycleController.signal,
      `Gateway pairing Workspace '${input.workspaceId}' status`,
    ) !== 'ok') {
      throw new Error(`gateway pairing names unavailable Workspace '${input.workspaceId}'`)
    }
    const sessionId = SessionId(input.sessionId)
    if (!workspace.sessionIds.some(id => id === sessionId)) {
      throw new Error(`gateway pairing Session '${input.sessionId}' is not owned by Workspace '${input.workspaceId}'`)
    }
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new Error('gateway pairing approval requires the selected native DSH Session to be live')
    }
    if (agent.session.header.cwd !== workspace.path) {
      throw new Error(`gateway pairing Session '${input.sessionId}' cwd does not match its Workspace`)
    }
    const agentPreset = this.ctx.agentPresets.composedPreset(agent.ctx)
    if (agentPreset === undefined || agent.options.provider === undefined || agent.options.model === undefined) {
      throw new Error('gateway pairing approval requires a complete live Agent route')
    }
    const approved = await this.approvePairing({
      code: input.code,
      adapter: input.adapter,
      target: {
        id: `paired-${randomBytes(12).toString('hex')}`,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        agentPreset,
        provider: agent.options.provider,
        model: agent.options.model,
        ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }),
      },
      now: Date.now(),
    })
    return Object.freeze({
      routeId: approved.route.id,
      workspaceId: approved.route.workspaceId,
      sessionId: approved.route.sessionId,
    })
  }

  /** Approve one pending request by its opaque request id from the Host control plane. */
  async approvePairingRequestForSession(
    input: GatewayPairingSessionRequestApprovalInput,
  ): Promise<GatewayPairingSessionApprovalReceipt> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
    if (workspace === undefined || await runPersistenceDeadline(
      async () => workspace.status(),
      this.lifecycleController.signal,
      `Gateway pairing Workspace '${input.workspaceId}' status`,
    ) !== 'ok') {
      throw new Error(`gateway pairing names unavailable Workspace '${input.workspaceId}'`)
    }
    const sessionId = SessionId(input.sessionId)
    if (!workspace.sessionIds.some(id => id === sessionId)) {
      throw new Error(`gateway pairing Session '${input.sessionId}' is not owned by Workspace '${input.workspaceId}'`)
    }
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) {
      throw new Error('gateway pairing approval requires the selected native DSH Session to be live')
    }
    if (agent.session.header.cwd !== workspace.path) {
      throw new Error(`gateway pairing Session '${input.sessionId}' cwd does not match its Workspace`)
    }
    const agentPreset = this.ctx.agentPresets.composedPreset(agent.ctx)
    if (agentPreset === undefined || agent.options.provider === undefined || agent.options.model === undefined) {
      throw new Error('gateway pairing approval requires a complete live Agent route')
    }
    const approved = await this.approvePairingRequest({
      requestId: input.requestId,
      target: {
        id: `paired-${randomBytes(12).toString('hex')}`,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        agentPreset,
        provider: agent.options.provider,
        model: agent.options.model,
        ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }),
      },
      now: Date.now(),
    })
    return Object.freeze({
      routeId: approved.route.id,
      workspaceId: approved.route.workspaceId,
      sessionId: approved.route.sessionId,
    })
  }

  approvePairingRequest(input: GatewayPairingRequestApprovalInput): Promise<GatewayPairingApproval> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    const target = input.target
    return this.enqueuePairingMutation(async () => {
      await this.validatePairingTarget(target)
      if (this.configured.byId.has(target.id) || this.pairing!.route(target.id) !== undefined) {
        throw new Error(`gateway pairing route id '${target.id}' is already configured`)
      }
      this.assertCompatibleSessionOwner(target)
      this.assertRunning()
      return this.pairing!.approveRequest(input)
    })
  }

  pendingPairings(observedAt = Date.now()): readonly GatewayPairingPendingRequest[] {
    exactHealthTime(observedAt)
    return this.pairing?.pending(observedAt) ?? []
  }

  async revokePairing(routeId: string): Promise<GatewayPairingRevocationReceipt> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    if (this.configured.byId.has(routeId)) {
      throw new Error(`gateway route '${routeId}' is configured and cannot be revoked as a pairing grant`)
    }
    if (this.revokingRoutes.has(routeId)) {
      throw new Error(`gateway pairing route '${routeId}' revocation is already in progress`)
    }
    this.revokingRoutes.add(routeId)
    try {
      if ((this.activeIngressByRoute.get(routeId) ?? 0) > 0) {
        throw new Error(`gateway pairing route '${routeId}' has active ingress and cannot be revoked yet`)
      }
      const outbound = this.outbound.health(new Set([routeId]))
      if (outbound.prepared + outbound.sending + outbound.retrying > 0) {
        throw new Error(`gateway pairing route '${routeId}' has active outbound effects and cannot be revoked yet`)
      }
      return await this.pairing.revoke(routeId, Date.now())
    } finally {
      this.revokingRoutes.delete(routeId)
    }
  }

  async accept(input: GatewayAcceptInput): Promise<GatewayAcceptResult> {
    this.assertRunning()
    const authorization = await this.authorize(input.endpoint, input.chatKind, input.now)
    if (authorization.kind === 'trusted') return this.dispatchRoute(authorization.route, input)
    return authorization
  }

  async authorize(
    endpoint: GatewayEndpoint,
    chatKind: 'direct' | 'group',
    now?: number,
  ): Promise<GatewayAuthorizationResult> {
    this.assertRunning()
    const route = this.match(endpoint)
    if (route !== undefined) return Object.freeze({ kind: 'trusted', route })
    if (chatKind !== 'direct' || this.pairing === undefined) {
      return Object.freeze({ kind: 'rejected', reason: 'untrusted' })
    }
    const offer = await this.pairing.offer(endpoint, now)
    if (offer.kind === 'already-trusted') return Object.freeze({ kind: 'trusted', route: offer.route })
    return Object.freeze({ kind: 'pairing', offer })
  }

  registerTextAdapter(config: GatewayTextAdapterConfig): GatewayTextAdapterRegistration {
    this.assertRunning()
    return this.outbound.register(config)
  }

  registerTransport(config: GatewayTransportConfig): GatewayTransportRegistration {
    this.assertRunning()
    return this.transports.register(config)
  }

  /**
   * Redacted point-in-time projection of facts owned by this Gateway. External
   * account, conversation and user identities never cross this seam.
   */
  healthSnapshot(observedAt = Date.now(), routeIds?: readonly string[]): GatewayHealthSnapshot {
    exactHealthTime(observedAt)
    const selected = this.selectHealthRoutes(routeIds)
    const selectedIds = new Set(selected.map(route => route.id))
    const liveSessions = new Set<string>()
    const items = selected
      .map((route): GatewayHealthRoute => {
        const live = this.ctx.agents.get(SessionId(route.sessionId)) !== undefined
        if (live) liveSessions.add(route.sessionId)
        return {
          id: route.id,
          adapter: route.adapter,
          workspaceId: route.workspaceId,
          sessionId: route.sessionId,
          threadScoped: route.threadId !== undefined,
          live,
          paired: !this.configured.byId.has(route.id),
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
    const ingress = { total: 0, prepared: 0, executing: 0, settled: 0, uncertain: 0 }
    for (const record of this.ingressJournal.list()) {
      if (!selectedIds.has(record.routeId)) continue
      ingress.total += 1
      ingress[record.status] += 1
    }
    return immutableHealth({
      schemaVersion: 1,
      observedAt,
      lifecycle: this.stopping !== undefined ? 'stopping' : this.started ? 'ready' : 'starting',
      routes: { total: items.length, liveSessions: liveSessions.size, items },
      ingress,
      transports: this.transports.health(selectedIds, routeIds === undefined),
      outbound: this.outbound.health(selectedIds, routeIds === undefined),
    })
  }

  /** Stable native MessageId an adapter can use to correlate inbox/turn events before dispatch. */
  messageIdFor(endpoint: GatewayEndpoint, eventId: string): string {
    const route = this.match(endpoint)
    if (route === undefined) throw new Error('no configured gateway route for the exact external endpoint')
    const exactEventId = exactIngressText(eventId, 'eventId', 1_024)
    const eventHash = hash(`${route.endpointKey}\0${exactEventId}`)
    return `channel:${hash(`${route.id}\0${eventHash}`)}`
  }

  /** Resolve the exact configured native Agent without dispatching user input. */
  async resolve(routeOrId: ResolvedGatewayRoute | string, signal?: AbortSignal): Promise<Agent> {
    this.assertRunning()
    const routeId = typeof routeOrId === 'string' ? routeOrId : routeOrId.id
    const route = this.route(routeId)
    if (route === undefined) throw new Error(`unknown gateway route '${String(routeOrId)}'`)
    if (typeof routeOrId !== 'string' && !isDeepStrictEqual(routeOrId, route)) {
      throw new Error(`gateway route '${routeId}' is stale or not authoritative`)
    }
    signal?.throwIfAborted()
    let pending = this.resolutions.get(route.sessionId)
    if (pending === undefined || pending.controller.signal.aborted) {
      const controller = new AbortController()
      const primary = persistencePrimaryState()
      let created!: PendingAgentResolution
      const promise = this.resolveNativeAgent(route, controller.signal, primary).finally(() => {
        created.settled = true
        if (this.resolutions.get(route.sessionId) === created) {
          this.resolutions.delete(route.sessionId)
        }
        this.activeResolutions.delete(created)
      })
      created = { controller, promise, primary, waiters: 0, settled: false }
      pending = created
      this.resolutions.set(route.sessionId, created)
      this.activeResolutions.add(created)
      // Every caller may cancel independently, leaving no public waiter on
      // the shared operation. Keep its terminal rejection observed.
      void promise.catch(() => undefined)
    }
    return await waitForAgentResolution(pending, signal, () => {
      if (this.resolutions.get(route.sessionId) === pending) {
        this.resolutions.delete(route.sessionId)
      }
    })
  }

  dispatch(input: GatewayDispatchInput): Promise<GatewayDispatchResult> {
    this.assertRunning()
    const route = this.match(input.endpoint)
    if (route === undefined) return Promise.reject(new Error('no configured gateway route for the exact external endpoint'))
    return this.dispatchRoute(route, input)
  }

  private dispatchRoute(route: ResolvedGatewayRoute, input: GatewayDispatchInput): Promise<GatewayDispatchResult> {
    if (!this.configured.byId.has(route.id)
      && (this.revokingRoutes.has(route.id) || this.pairing?.route(route.id) === undefined)) {
      return Promise.reject(new Error(`gateway pairing route '${route.id}' is not active`))
    }
    const eventId = exactIngressText(input.eventId, 'eventId', 1_024)
    const content = normalizeUserContent(input.text, input.images)
    const eventHash = hash(`${route.endpointKey}\0${eventId}`)
    const ingressId = hash(`${route.id}\0${eventHash}`)
    const prior = this.ingressTails.get(ingressId) ?? Promise.resolve()
    this.activeIngressByRoute.set(route.id, (this.activeIngressByRoute.get(route.id) ?? 0) + 1)
    const operation = prior.then(() => this.dispatchSerial({
      route, eventHash, ingressId, content,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }))
    const tail = operation.then(() => {}, () => {})
    this.ingressTails.set(ingressId, tail)
    void tail.finally(() => {
      if (this.ingressTails.get(ingressId) === tail) this.ingressTails.delete(ingressId)
      const active = (this.activeIngressByRoute.get(route.id) ?? 1) - 1
      if (active === 0) this.activeIngressByRoute.delete(route.id)
      else this.activeIngressByRoute.set(route.id, active)
    })
    return operation
  }

  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    let resolveStopping!: () => void
    let rejectStopping!: (error: unknown) => void
    const stopping = new Promise<void>((resolve, reject) => {
      resolveStopping = resolve
      rejectStopping = reject
    })
    // Publish the stopping state before any abort listener can re-enter stop().
    this.stopping = stopping
    this.persistenceShutdownDeadlineAt = globalThis.performance.now()
      + GATEWAY_PERSISTENCE_TIMEOUT_MS
    try {
      void this.stopInternal().then(resolveStopping, rejectStopping)
    } catch (error) {
      rejectStopping(error)
    }
    return stopping
  }

  private async stopInternal(): Promise<void> {
    const reason = new Error('DSH gateway is stopping')
    this.lifecycleController.abort(reason)
    for (const resolution of this.activeResolutions) {
      resolution.controller.abort(reason)
    }
    // A resident Host may receive shutdown while validation/recovery is still
    // awaiting persistence. Let startup finish before closing its resources.
    // Promise.allSettled keeps a startup validation error from masking cleanup.
    const starting = this.starting
    if (starting !== undefined) await Promise.allSettled([starting])
    await this.quiesceActiveResolutions()
    await this.quiescePersistenceLeases()
    const cleanup = await Promise.allSettled([this.cleanupResources()])
    const failed = cleanup[0]
    this.throwShutdownFailures(failed?.status === 'rejected' ? [failed.reason] : [])
  }

  private cleanupResources(): Promise<void> {
    this.cleanupPromise ??= (async () => {
      const failures: unknown[] = []
      const settle = async (
        operations: readonly (() => void | Promise<void>)[],
      ): Promise<void> => {
        const results = await Promise.allSettled(operations.map(operation =>
          Promise.resolve().then(operation)))
        for (const result of results) {
          if (result.status === 'rejected') failures.push(result.reason)
        }
      }

      const removeSessionEvents = this.removeSessionEvents
      this.removeSessionEvents = undefined
      if (removeSessionEvents !== undefined) await settle([removeSessionEvents])
      await Promise.allSettled(this.ingressTails.values())
      // A direct resolve() may be creating or resuming a Native Agent without
      // an ingress tail. Wait before snapshotting owned handles so a late
      // resolution cannot publish an undisposed handle after Host shutdown.
      await this.quiesceActiveResolutions()
      await settle([() => this.outbound.stop()])
      await settle([() => this.transports.stop()])
      const handles = [...this.ownedHandles.values()]
      this.ownedHandles.clear()
      await settle(handles.map(handle => () => handle.dispose()))
      const closes: Array<() => Promise<void>> = [() => this.ingressJournal.close()]
      const ingressEvidence = this.ingressEvidence
      if (ingressEvidence !== undefined) closes.push(() => ingressEvidence.close())
      const pairing = this.pairing
      if (pairing !== undefined) closes.push(() => pairing.close())
      await settle(closes)

      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, 'DSH gateway cleanup failed')
      }
    })()
    return this.cleanupPromise
  }

  private async quiesceActiveResolutions(): Promise<void> {
    while (this.activeResolutions.size > 0) {
      await Promise.allSettled(
        [...this.activeResolutions].map(resolution => resolution.promise),
      )
    }
  }

  private registerPersistenceLease(lease: CurrentReadHandleLease): void {
    this.activePersistenceLeases.add(lease)
    const forget = (): void => { this.activePersistenceLeases.delete(lease) }
    const forgetFailure = (error: unknown): void => {
      this.activePersistenceLeases.delete(lease)
      this.persistenceCloseFailures.push(error)
    }
    void lease.closed.then(forget, forgetFailure)
    if (this.stopping !== undefined) {
      void lease.closeUntil(this.persistenceShutdownDeadlineAt
        ?? globalThis.performance.now()).then(forget, forget)
    }
  }

  private async quiescePersistenceLeases(): Promise<void> {
    while (this.activePersistenceLeases.size > 0) {
      const leases = [...this.activePersistenceLeases]
      const deadlineAt = this.persistenceShutdownDeadlineAt
        ?? globalThis.performance.now() + GATEWAY_PERSISTENCE_TIMEOUT_MS
      const results = await Promise.allSettled(leases.map(lease => lease.closeUntil(deadlineAt)))
      for (const result of results) {
        if (result.status === 'rejected' && !this.persistenceCloseFailures.includes(result.reason)) {
          this.persistenceCloseFailures.push(result.reason)
        }
      }
      for (const lease of leases) this.activePersistenceLeases.delete(lease)
    }
  }

  private enqueuePairingMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pairingMutationTail.then(() => {
      this.assertRunning()
      return operation()
    })
    this.pairingMutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  private throwShutdownFailures(additional: readonly unknown[]): void {
    const failures = [...additional, ...this.persistenceCloseFailures]
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'DSH gateway cleanup failed')
    }
  }

  private async dispatchSerial(input: {
    route: ResolvedGatewayRoute
    eventHash: string
    ingressId: string
    content: GatewayUserContent
    signal?: AbortSignal
  }): Promise<GatewayDispatchResult> {
    input.signal?.throwIfAborted()
    const agent = await this.resolve(input.route, input.signal)
    const kind = input.content.commandText !== undefined
      && this.commandIsRegistered(agent, input.content.commandText) ? 'command' : 'message'
    const prepared = await this.ingressJournal.prepare({
      id: input.ingressId,
      routeId: input.route.id,
      workspaceId: input.route.workspaceId,
      sessionId: input.route.sessionId,
      eventHash: input.eventHash,
      contentHash: input.content.contentHash,
      kind,
      now: Date.now(),
    })
    if (!prepared.created) return this.replaySettled(input.route, agent, prepared.record)

    const executing = await this.ingressJournal.begin(input.ingressId, Date.now())
    if (kind === 'message') {
      const messageId = `channel:${input.ingressId}`
      const message = freezeMessage({
        id: MessageId(messageId),
        role: 'user',
        content: [...input.content.blocks],
        source: { kind: 'user' },
      } satisfies UserMessage)
      let evidenceObservation: GatewayIngressEvidenceObservationV1 | undefined
      try {
        if (!messageSeen(agent, messageId)) {
          const boundary = this.captureIngressEvidenceBoundary(input.route, agent)
          if (boundary === undefined) {
            agent.followup(message)
          } else {
            evidenceObservation = this.followupWithIngressEvidence(
              executing,
              input.route,
              boundary,
              agent,
              message,
            )
          }
        }
      } catch (error: unknown) {
        await this.ingressJournal.markUncertain(input.ingressId, safeMessage(error), Date.now())
        throw error
      }
      await this.ingressJournal.settleMessage(input.ingressId, Date.now())
      if (evidenceObservation !== undefined) {
        this.retainIngressEvidence(evidenceObservation)
      }
      return Object.freeze({
        kind: 'message', route: input.route, agent, duplicate: false, ingressId: input.ingressId,
      })
    }

    let result: GatewayCommandResult
    try {
      const execution = await executeNativeCommand(
        this.ctx.commands,
        agent,
        input.content.commandText!,
        input.signal ?? new AbortController().signal,
      )
      result = execution === undefined
        ? { kind: 'error', text: 'The command is no longer registered.' }
        : boundedCommandResult(execution.result)
    } catch (error: unknown) {
      result = { kind: 'error', text: boundedText(safeMessage(error), 16_384) }
    }
    await this.ingressJournal.settleCommand(input.ingressId, result, Date.now())
    return Object.freeze({
      kind: 'command', route: input.route, agent, duplicate: false, ingressId: input.ingressId, result,
    })
  }

  private replaySettled(
    route: ResolvedGatewayRoute,
    agent: Agent,
    record: GatewayIngressRecord,
  ): GatewayDispatchResult {
    if (record.status === 'uncertain') {
      throw new GatewayIngressUncertainError(record.id, record.error ?? 'outcome is unknown')
    }
    if (record.status !== 'settled') {
      throw new GatewayIngressUncertainError(record.id, `retained state is ${record.status}`)
    }
    if (record.kind === 'command') {
      if (record.commandResult === undefined) throw new Error(`settled command ingress '${record.id}' has no result`)
      return Object.freeze({ kind: 'command', route, agent, duplicate: true, ingressId: record.id, result: record.commandResult })
    }
    return Object.freeze({ kind: 'message', route, agent, duplicate: true, ingressId: record.id })
  }

  /**
   * Bracket the one synchronous alpha.5 followup commit. Everything before
   * `followup` is an authority check; anything ambiguous after a successful
   * return degrades only the auxiliary evidence, never message delivery.
   */
  private followupWithIngressEvidence(
    ingress: GatewayIngressRecord,
    route: ResolvedGatewayRoute,
    boundary: IngressEvidenceBoundary,
    agent: Agent,
    message: UserMessage,
  ): GatewayIngressEvidenceObservationV1 | undefined {
    const evidence = this.ingressEvidence
    if (evidence === undefined) {
      agent.followup(message)
      return undefined
    }

    // Every evidence-only read happened in the non-throwing capture. Once the
    // ingress journal says `executing`, the primary effect is the first
    // fallible operation; an unavailable witness must never poison an
    // unattempted delivery as `uncertain`.
    agent.followup(message)

    const {
      workspace,
      session,
      header,
      inheritedEventCount,
      beforeSeq,
      nextTurnLength,
    } = boundary

    try {
      const stable = this.ingressEvidenceBoundaryMatches(
        route,
        workspace,
        agent,
        session,
        header,
        inheritedEventCount,
      )
      const suffix = session.snapshotEvents(SessionLogOffset(beforeSeq))
      const candidates = suffix.filter(
        (event): event is SessionEvent<'agent/inbox/spliced'> =>
          event.type === 'agent/inbox/spliced'
          && event.data.inserted.some(inserted =>
            inserted.id === message.id || isDeepStrictEqual(inserted, message)),
      )
      const enqueue = candidates[0]
      if (!stable
        || candidates.length !== 1
        || enqueue === undefined
        || enqueue.seq !== beforeSeq
        || enqueue.data.target !== 'next-turn'
        || enqueue.data.start !== nextTurnLength
        || enqueue.data.removedCount !== undefined
        || enqueue.data.outcome !== undefined
        || enqueue.data.inserted.length !== 1
        || !isDeepStrictEqual(enqueue.data.inserted[0], message)) {
        return { status: 'conflict', ingress }
      }
      return {
        status: 'resolved',
        ingress,
        workspace: {
          id: String(workspace.id),
          path: workspace.path,
          createdAt: workspace.createdAt,
        },
        session: { header, inheritedEventCount },
        message,
        enqueue,
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-gateway could not inspect ingress evidence: ${safeMessage(error)}`)
      return { status: 'conflict', ingress }
    }
  }

  private captureIngressEvidenceBoundary(
    route: ResolvedGatewayRoute,
    agent: Agent,
  ): IngressEvidenceBoundary | undefined {
    if (this.ingressEvidence === undefined) return undefined
    try {
      const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(route.workspaceId))
      if (workspace === undefined) return undefined
      const session = agent.session
      const header = structuredClone(session.header)
      const inheritedEventCount: unknown = session.inheritedEventCount
      const beforeSeq: unknown = session.seq
      const nextTurnLength: unknown = agent.inbox.nextTurn.length
      if (typeof inheritedEventCount !== 'number'
        || !Number.isSafeInteger(inheritedEventCount)
        || inheritedEventCount < 0
        || typeof beforeSeq !== 'number'
        || !Number.isSafeInteger(beforeSeq)
        || beforeSeq < 0
        || typeof nextTurnLength !== 'number'
        || !Number.isSafeInteger(nextTurnLength)
        || nextTurnLength < 0
        || !this.ingressEvidenceBoundaryMatches(
          route,
          workspace,
          agent,
          session,
          header,
          inheritedEventCount,
        )) return undefined
      return {
        workspace,
        session,
        header,
        inheritedEventCount,
        beforeSeq,
        nextTurnLength,
      }
    } catch {
      return undefined
    }
  }

  private retainIngressEvidence(observation: GatewayIngressEvidenceObservationV1): void {
    const label = observation.status === 'conflict' ? ' conflict' : ''
    void this.ingressEvidence?.retain(observation).catch((error: unknown) => {
      this.ctx.logger.warn(
        `dsh-gateway could not retain ingress evidence${label}: ${safeMessage(error)}`,
      )
    })
  }

  private ingressEvidenceBoundaryMatches(
    route: ResolvedGatewayRoute,
    workspace: Workspace,
    agent: Agent,
    session: Agent['session'],
    header: SessionHeader,
    inheritedEventCount: number,
  ): boolean {
    try {
      this.assertRunning()
      if (!isDeepStrictEqual(this.route(route.id), route)
        || this.ctx.workspaceRegistry.get(WorkspaceId(route.workspaceId)) !== workspace
        || this.ctx.agents.get(SessionId(route.sessionId)) !== agent
        || agent.session !== session
        || this.ctx.sessions.get(SessionId(route.sessionId)) !== session
        || String(workspace.id) !== route.workspaceId
        || workspace.path !== header.cwd
        || !workspace.sessionIds.some(id => id === session.id)
        || !isDeepStrictEqual(session.header, header)
        || session.inheritedEventCount !== inheritedEventCount
        || !Number.isSafeInteger(inheritedEventCount)
        || inheritedEventCount < 0) return false
      return true
    } catch {
      return false
    }
  }

  private commandIsRegistered(agent: Agent, line: string): boolean {
    const parsed = parseCommand(line)
    return parsed !== undefined && this.ctx.commands.list(agent).some(command => command.name === parsed.name)
  }

  private async resolveNativeAgent(
    route: ResolvedGatewayRoute,
    signal: AbortSignal | undefined,
    primary: PersistencePrimaryState,
  ): Promise<Agent> {
    const workspace = await this.requireWorkspace(route, signal)
    await this.requirePreset(route, signal)
    const sessionId = SessionId(route.sessionId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      this.assertLiveIdentity(route, workspace, live)
      await workspace.attachSession(sessionId)
      return live
    }

    const header = (await listPersistenceHeaders(this.ctx.sessionPersistence, signal, primary))
      .find(item => item.id === sessionId)
    let handle: AgentHandle
    try {
      if (header === undefined) {
        handle = await this.ctx.agents.create({
          sessionId,
          meta: { cwd: workspace.path, agentPreset: route.agentPreset },
          agentOptions: routeAgentOptions(route),
          ...(signal === undefined ? {} : { signal }),
          setup: agentCtx => this.ctx.agentPresets.mount(agentCtx, route.agentPreset).then(() => undefined),
        })
      } else {
        const inspected = await inspectPersistenceSession(
          this.ctx.sessionPersistence,
          sessionId,
          signal,
          lease => { this.registerPersistenceLease(lease) },
          primary,
        )
        this.assertPersistedIdentity(route, workspace, inspected.meta, inspected.events)
        handle = await this.ctx.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: routeAgentOptions(route),
          ...(signal === undefined ? {} : { signal }),
          setup: agentCtx => this.ctx.agentPresets.mount(agentCtx, route.agentPreset).then(() => undefined),
        })
      }
    } catch (error: unknown) {
      // DSH alpha.5 publishes a resumed Agent only after the persistence
      // reservation. A concurrent resolver can therefore observe the public
      // "session already exists" error before the winning Agent is visible.
      // Wait for that explicit publication instead of turning a recoverable
      // race into an Adapter boot failure; all other errors remain fail-closed.
      const raced = isSessionAlreadyExistsError(error)
        ? await this.waitForRacingAgent(sessionId, signal)
        : this.ctx.agents.get(sessionId)
      if (raced === undefined) throw error
      this.assertLiveIdentity(route, workspace, raced)
      await workspace.attachSession(sessionId)
      return raced
    }

    try {
      this.assertLiveIdentity(route, workspace, handle.agent)
      await workspace.attachSession(sessionId)
    } catch (error: unknown) {
      await handle.dispose()
      throw error
    }
    this.ownedHandles.set(route.sessionId, handle)
    return handle.agent
  }

  private waitForRacingAgent(sessionId: SessionId, signal?: AbortSignal): Promise<Agent | undefined> {
    const existing = this.ctx.agents.get(sessionId)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise(resolve => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (agent: Agent | undefined): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        disposeCreated()
        signal?.removeEventListener('abort', onAbort)
        resolve(agent)
      }
      const onAbort = (): void => { finish(undefined) }
      const disposeCreated = this.ctx.on('agent/created', ({ agent }) => {
        if (agent.id === sessionId) finish(agent)
      })
      timer = setTimeout(() => finish(this.ctx.agents.get(sessionId)), 5_000)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async requireWorkspace(
    route: ResolvedGatewayRoute,
    signal?: AbortSignal,
  ): Promise<Workspace> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(route.workspaceId))
    if (workspace === undefined) throw new Error(`gateway route '${route.id}' names unknown Workspace '${route.workspaceId}'`)
    if (await runPersistenceDeadline(
      async () => workspace.status(),
      signal,
      `Gateway Workspace '${route.workspaceId}' status`,
    ) !== 'ok') {
      throw new Error(`gateway route '${route.id}' Workspace '${route.workspaceId}' directory is missing`)
    }
    return workspace
  }

  private async requirePreset(route: ResolvedGatewayRoute, signal?: AbortSignal): Promise<void> {
    const preset = await runPersistenceDeadline(
      async () => this.ctx.agentPresets.resolve(route.agentPreset),
      signal,
      `Gateway Agent preset '${route.agentPreset}' resolution`,
    )
    if (preset.broken !== undefined) {
      throw new Error(`gateway route '${route.id}' Agent preset '${route.agentPreset}' is broken: ${preset.broken}`)
    }
  }

  private assertLiveIdentity(route: ResolvedGatewayRoute, workspace: Workspace, agent: Agent): void {
    this.assertSessionIdentity(route, workspace, agent.session.header, sessionEvents(agent.session))
    if (agent.options.provider !== route.provider || agent.options.model !== route.model
      || (route.maxTokens !== undefined && agent.options.maxTokens !== route.maxTokens)) {
      throw new Error(`channel session '${route.sessionId}' live Agent model does not match route '${route.provider}/${route.model}'`)
    }
    const composed = this.ctx.agentPresets.composedPreset(agent.ctx)
    if (composed !== route.agentPreset) {
      throw new Error(`channel session '${route.sessionId}' live Agent preset is '${String(composed)}', expected '${route.agentPreset}'`)
    }
  }

  private assertPersistedIdentity(
    route: ResolvedGatewayRoute,
    workspace: Workspace,
    header: SessionHeader,
    events: readonly SessionEvent[],
  ): void {
    this.assertSessionIdentity(route, workspace, header, events)
  }

  private assertSessionIdentity(
    route: ResolvedGatewayRoute,
    workspace: Workspace,
    header: SessionHeader,
    events: readonly SessionEvent[],
  ): void {
    if (String(header.id) !== route.sessionId) {
      throw new Error(`channel persistence returned session '${String(header.id)}', expected '${route.sessionId}'`)
    }
    if (header.cwd !== workspace.path) {
      throw new Error(`channel session '${route.sessionId}' cwd is '${String(header.cwd)}', expected Workspace path '${workspace.path}'`)
    }
    const preset = sessionPreset(header, events)
    if (preset !== route.agentPreset) {
      throw new Error(`channel session '${route.sessionId}' preset is '${String(preset)}', expected '${route.agentPreset}'`)
    }
  }

  private assertRunning(): void {
    if (!this.started) throw new Error('DSH gateway has not started')
    if (this.stopping !== undefined) throw new Error('DSH gateway is stopping')
  }

  private async nativeTurnEnded(
    route: ResolvedGatewayRoute,
    turn: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const agent = await this.resolve(route, signal)
    return sessionEvents(agent.session).some(event =>
      event.type === 'turn/end' && event.data.turn === turn)
  }

  private selectHealthRoutes(routeIds: readonly string[] | undefined): readonly ResolvedGatewayRoute[] {
    if (routeIds === undefined) return this.allRoutes()
    const seen = new Set<string>()
    return routeIds.map((id) => {
      if (seen.has(id)) throw new Error(`duplicate gateway route '${id}'`)
      seen.add(id)
      const route = this.route(id)
      if (route === undefined) throw new Error(`unknown gateway route '${id}'`)
      return route
    })
  }

  private allRoutes(): readonly ResolvedGatewayRoute[] {
    return Object.freeze([...this.configured.routes, ...(this.pairing?.routes() ?? [])])
  }

  private pairedRoute(id: string): ResolvedGatewayRoute | undefined {
    return this.revokingRoutes.has(id) ? undefined : this.pairing?.route(id)
  }

  private assertRouteSet(): void {
    const ids = new Set<string>()
    const endpoints = new Set<string>()
    const sessionOwners = new Map<string, GatewayPairingTarget>()
    for (const route of this.allRoutes()) {
      if (ids.has(route.id)) throw new Error(`gateway route id '${route.id}' is duplicated`)
      if (endpoints.has(route.endpointKey)) throw new Error('gateway routes claim the same external endpoint')
      const owner = sessionOwners.get(route.sessionId)
      if (owner !== undefined) this.assertSameSessionOwner(owner, route)
      else sessionOwners.set(route.sessionId, route)
      ids.add(route.id)
      endpoints.add(route.endpointKey)
    }
  }

  private assertCompatibleSessionOwner(target: GatewayPairingTarget): void {
    for (const route of this.allRoutes()) {
      if (route.sessionId === target.sessionId) this.assertSameSessionOwner(route, target)
    }
  }

  private assertSameSessionOwner(
    owner: GatewayPairingTarget,
    candidate: GatewayPairingTarget,
  ): void {
    if (owner.workspaceId !== candidate.workspaceId
      || owner.agentPreset !== candidate.agentPreset
      || owner.provider !== candidate.provider
      || owner.model !== candidate.model
      || owner.maxTokens !== candidate.maxTokens) {
      throw new Error(
        `gateway Session '${candidate.sessionId}' cannot use incompatible Workspace, preset, or model routes`,
      )
    }
  }

  private async validatePairingTarget(target: GatewayPairingTarget): Promise<void> {
    const candidate: ResolvedGatewayRoute = Object.freeze({
      ...target,
      adapter: 'pairing',
      accountId: 'pending',
      conversationId: 'pending',
      userId: 'pending',
      endpointKey: 'pending',
    })
    const workspace = await this.requireWorkspace(candidate, this.lifecycleController.signal)
    await this.requirePreset(candidate, this.lifecycleController.signal)
    const live = this.ctx.agents.get(SessionId(target.sessionId))
    if (live !== undefined) {
      this.assertLiveIdentity(candidate, workspace, live)
      return
    }
    const header = (await listPersistenceHeaders(
      this.ctx.sessionPersistence,
      this.lifecycleController.signal,
    ))
      .find(item => String(item.id) === target.sessionId)
    if (header === undefined) return
    const inspected = await inspectPersistenceSession(
      this.ctx.sessionPersistence,
      SessionId(target.sessionId),
      this.lifecycleController.signal,
      lease => { this.registerPersistenceLease(lease) },
    )
    this.assertPersistedIdentity(candidate, workspace, inspected.meta, inspected.events)
  }
}

async function waitForAgentResolution(
  pending: PendingAgentResolution,
  signal?: AbortSignal,
  onAbandoned?: () => void,
): Promise<Agent> {
  signal?.throwIfAborted()
  pending.waiters += 1
  let waiterReleased = false
  const releaseWaiter = (cancelled: boolean): void => {
    if (waiterReleased) return
    waiterReleased = true
    pending.waiters -= 1
    if (cancelled && pending.waiters === 0 && !pending.settled) {
      onAbandoned?.()
      pending.controller.abort(signal?.reason)
    }
  }
  let removeAbort: (() => void) | undefined
  const outcome = signal === undefined
    ? pending.promise
    : Promise.race([
        pending.promise,
        new Promise<never>((_resolve, reject) => {
          const onAbort = (): void => {
            // Release synchronously: an official handle metadata getter may
            // re-enter the caller and abort while the shared read is on-stack.
            releaseWaiter(true)
            reject(pending.primary.recorded
              ? pending.primary.error
              : signal.reason ?? new Error('Gateway Agent resolution was cancelled'))
          }
          removeAbort = () => { signal.removeEventListener('abort', onAbort) }
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
        }),
      ])
  try {
    return await outcome
  } finally {
    removeAbort?.()
    releaseWaiter(false)
  }
}

function messageSeen(agent: Agent, messageId: string): boolean {
  if (agent.inbox.nextTurn.some(message => message.id === messageId)
    || agent.inbox.nextStep.some(message => message.id === messageId)) return true
  return sessionEvents(agent.session).some((event) => {
    if (event.type === 'user/message') return event.data.id === messageId
    return event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.id === messageId)
  })
}

type SessionPersistenceMethod = (...args: never[]) => unknown
const GATEWAY_PERSISTENCE_TIMEOUT_MS = 30_000

interface PersistencePrimaryState {
  recorded: boolean
  error: unknown
}

interface PersistenceDeadlineControl {
  readonly signal: AbortSignal
  readonly deadlineAt: number
  recordPrimary(error: unknown): void
}

function persistencePrimaryState(): PersistencePrimaryState {
  return { recorded: false, error: undefined }
}

type SessionPersistenceDialect =
  | { readonly kind: 'alpha5'; readonly inspect: SessionPersistenceMethod }
  | { readonly kind: 'current'; readonly open: SessionPersistenceMethod }

/** Select exactly one released persistence read dialect without invoking accessors. */
function sessionPersistenceDialect(persistence: object): SessionPersistenceDialect {
  const inspect = optionalDataMethod(persistence, 'inspect')
  const open = optionalDataMethod(persistence, 'open')
  if ((inspect === undefined) === (open === undefined)) {
    throw new Error('DSH session persistence must expose exactly one inspect/open read dialect')
  }
  return inspect === undefined
    ? { kind: 'current', open: open! }
    : { kind: 'alpha5', inspect }
}

/** Alpha.5 lists bare headers; current DSH lists header/revision snapshots. */
async function listPersistenceHeaders(
  persistence: unknown,
  signal?: AbortSignal,
  sharedPrimary?: PersistencePrimaryState,
): Promise<SessionHeader[]> {
  if ((typeof persistence !== 'object' || persistence === null)
    && typeof persistence !== 'function') {
    throw new Error('DSH session persistence service is unavailable')
  }
  const service = persistence as object
  const dialect = sessionPersistenceDialect(service)
  const list = requiredDataMethod(service, 'list')
  return runPersistenceDeadline(async ({ signal: operationSignal }) => {
    const raw = await Reflect.apply(list, service, dialect.kind === 'alpha5'
      ? [operationSignal]
      : [{ signal: operationSignal }])
    operationSignal.throwIfAborted()
    if (!Array.isArray(raw)) throw new Error('DSH session persistence list returned no array')
    const headers: SessionHeader[] = []
    const ids = new Set<string>()
    for (const item of raw) {
      let header: unknown
      if (dialect.kind === 'alpha5') {
        header = item
      } else {
        const snapshot = plainDataRecord(item)
        if (snapshot === undefined
          || typeof snapshot.revision !== 'string'
          || !Object.hasOwn(snapshot, 'header')
          || !optionalNonNegativeSafeInteger(snapshot.eventCount)
          || !optionalNonNegativeSafeInteger(snapshot.sizeBytes)) {
          throw new Error('DSH session persistence list returned a malformed snapshot')
        }
        header = snapshot.header
      }
      const detached = detachedSessionHeader(header)
      const id = String(detached.id)
      if (ids.has(id)) throw new Error(`DSH session persistence listed duplicate Session '${id}'`)
      ids.add(id)
      headers.push(detached)
    }
    return headers
  }, signal, 'Gateway Session persistence list', sharedPrimary)
}

/** Read one persisted Session through exact alpha.5 or current capabilities. */
async function inspectPersistenceSession(
  persistence: unknown,
  id: SessionId,
  signal?: AbortSignal,
  onLease?: (lease: CurrentReadHandleLease) => void,
  sharedPrimary?: PersistencePrimaryState,
): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
  if ((typeof persistence !== 'object' || persistence === null)
    && typeof persistence !== 'function') {
    throw new Error('DSH session persistence service is unavailable')
  }
  const service = persistence as object
  const dialect = sessionPersistenceDialect(service)
  if (dialect.kind === 'alpha5') {
    return runPersistenceDeadline(async ({ signal: operationSignal }) => {
      const inspected = await Reflect.apply(dialect.inspect, service, [id, operationSignal])
      operationSignal.throwIfAborted()
      const snapshot = plainDataRecord(inspected)
      if (snapshot === undefined || !Object.hasOwn(snapshot, 'meta') || !Array.isArray(snapshot.events)) {
        throw new Error(`persisted Session '${String(id)}' inspection is malformed`)
      }
      const meta = detachedSessionHeader(snapshot.meta, id)
      return { meta, events: detachedSessionEvents(snapshot.events) }
    }, signal, `Gateway persisted Session '${String(id)}' read`, sharedPrimary)
  }
  return runPersistenceDeadline(
    control => inspectCurrentPersistenceSession(
      service,
      dialect.open,
      id,
      control,
      onLease,
    ),
    signal,
    `Gateway persisted Session '${String(id)}' read`,
    sharedPrimary,
  )
}

async function inspectCurrentPersistenceSession(
  service: object,
  open: SessionPersistenceMethod,
  id: SessionId,
  control: PersistenceDeadlineControl,
  onLease?: (lease: CurrentReadHandleLease) => void,
): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
  const { signal } = control
  const candidate = await Reflect.apply(open, service, [id, 'read', { signal }])
  const lease = CurrentReadHandleLease.capture(candidate, control.deadlineAt)
  onLease?.(lease)
  const closeOnAbort = (): void => { void lease.closeOnce().catch(() => undefined) }
  signal.addEventListener('abort', closeOnAbort, { once: true })
  if (signal.aborted) closeOnAbort()
  let inspected: { meta: SessionHeader; events: readonly SessionEvent[] }
  try {
    signal.throwIfAborted()
    const handle = currentReadHandle(lease.receiver, id)
    signal.throwIfAborted()
    const result = await Reflect.apply(handle.read, lease.receiver, [
      0,
      Number.MAX_SAFE_INTEGER,
      { signal },
    ])
    signal.throwIfAborted()
    const envelope = plainDataRecord(result)
    if (envelope === undefined
      || !hasExactDataKeys(envelope, ['eventState', 'events'])
      || (envelope.eventState !== 'detached' && envelope.eventState !== 'shared-frozen')
      || !Array.isArray(envelope.events)) {
      throw new Error(`persisted Session '${String(id)}' read result is malformed`)
    }
    inspected = {
      meta: handle.header,
      events: detachedSessionEvents(envelope.events),
    }
  } catch (error) {
    control.recordPrimary(error)
    // Teardown starts immediately but cannot replace a read, validation,
    // cancellation, or deadline failure. Join it while this operation still
    // owns budget; an abort/deadline can still bound an ignored close.
    try {
      await waitForCloseOrAbort(lease, signal)
    } catch {
      // Preserve the primary read/validation failure.
    }
    signal.removeEventListener('abort', closeOnAbort)
    throw error
  }
  try {
    const closed = await waitForCloseOrAbort(lease, signal)
    if (!closed) signal.throwIfAborted()
    return inspected
  } finally {
    signal.removeEventListener('abort', closeOnAbort)
  }
}

async function waitForCloseOrAbort(
  lease: CurrentReadHandleLease,
  signal: AbortSignal,
): Promise<boolean> {
  const close = lease.closeOnce()
  void close.catch(() => undefined)
  if (signal.aborted) return false
  const aborted = Symbol('aborted')
  let resolveAborted!: (value: typeof aborted) => void
  const abortOutcome = new Promise<typeof aborted>(resolve => { resolveAborted = resolve })
  const onAbort = (): void => { resolveAborted(aborted) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const outcome = await Promise.race([close.then(() => true), abortOutcome])
    return outcome === aborted ? false : outcome
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

class CurrentReadHandleLease {
  readonly receiver: object
  readonly closed: Promise<void>
  private readonly close: SessionPersistenceMethod
  private closeStarted = false
  private resolveClosed!: () => void
  private rejectClosed!: (error: unknown) => void

  private constructor(
    receiver: object,
    close: SessionPersistenceMethod,
  ) {
    this.receiver = receiver
    this.close = close
    this.closed = new Promise<void>((resolve, reject) => {
      this.resolveClosed = resolve
      this.rejectClosed = reject
    })
  }

  static capture(candidate: unknown, _deadlineAt: number): CurrentReadHandleLease {
    if ((typeof candidate !== 'object' || candidate === null)
      && typeof candidate !== 'function') {
      throw new Error('DSH session persistence open returned no handle')
    }
    const receiver = candidate as object
    const close = requiredDataMethod(receiver, 'close')
    return new CurrentReadHandleLease(receiver, close)
  }

  closeOnce(): Promise<void> {
    if (this.closeStarted) return this.closed
    // Install the sentinel before invoking user/backend code: close may
    // synchronously stop the Gateway and re-enter this method through abort.
    this.closeStarted = true
    try {
      const result = Reflect.apply(this.close, this.receiver, [])
      void Promise.resolve(result).then(this.resolveClosed, this.rejectClosed)
    } catch (error) {
      this.rejectClosed(error)
    }
    return this.closed
  }

  async closeUntil(deadlineAt: number): Promise<void> {
    const close = this.closeOnce()
    void close.catch(() => undefined)
    const remainingMs = deadlineAt - globalThis.performance.now()
    if (remainingMs <= 0) throw new Error('Gateway Session read handle cleanup timed out')
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Gateway Session read handle cleanup timed out')), remainingMs)
    })
    try {
      await Promise.race([close, deadline])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

function currentReadHandle(receiver: object, expectedId: SessionId): {
  readonly receiver: object
  readonly header: SessionHeader
  readonly read: SessionPersistenceMethod
} {
  const read = requiredDataMethod(receiver, 'read')
  let id: unknown
  let access: unknown
  let header: unknown
  let inheritedEventCount: unknown
  try {
    id = Reflect.get(receiver, 'id')
    access = Reflect.get(receiver, 'access')
    header = Reflect.get(receiver, 'header')
    inheritedEventCount = Reflect.get(receiver, 'inheritedEventCount')
  } catch {
    throw new Error('DSH Session read handle metadata inspection failed')
  }
  if (id !== expectedId || access !== 'read') {
    throw new Error(`DSH persistence returned the wrong handle for Session '${String(expectedId)}'`)
  }
  if (!nonNegativeSafeInteger(inheritedEventCount)) {
    throw new Error(`persisted Session '${String(expectedId)}' has malformed inherited metadata`)
  }
  return {
    receiver,
    header: detachedSessionHeader(header, expectedId),
    read,
  }
}

async function runPersistenceDeadline<T>(
  invoke: (control: PersistenceDeadlineControl) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  label: string,
  sharedPrimary?: PersistencePrimaryState,
): Promise<T> {
  callerSignal?.throwIfAborted()
  const controller = new AbortController()
  const primary = persistencePrimaryState()
  const deadlineAt = globalThis.performance.now() + GATEWAY_PERSISTENCE_TIMEOUT_MS
  const recordPrimary = (error: unknown): void => {
    if (controller.signal.aborted || primary.recorded) return
    primary.recorded = true
    primary.error = error
    if (sharedPrimary !== undefined && !sharedPrimary.recorded) {
      sharedPrimary.recorded = true
      sharedPrimary.error = error
    }
  }
  const onCallerAbort = (): void => {
    controller.abort(callerSignal?.reason)
  }
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutError = new Error(`${label} timed out after ${GATEWAY_PERSISTENCE_TIMEOUT_MS}ms`)
  timer = setTimeout(() => { controller.abort(timeoutError) }, GATEWAY_PERSISTENCE_TIMEOUT_MS)
  const invocation = Promise.resolve().then(() => {
    controller.signal.throwIfAborted()
    return invoke({ signal: controller.signal, deadlineAt, recordPrimary })
  })
  // A backend may ignore the abort and reject after the public deadline.
  // Observe the invocation independently of which side wins.
  void invocation.catch(() => undefined)
  let removeAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(primary.recorded
        ? primary.error
        : controller.signal.reason ?? new Error(`${label} aborted`))
    }
    removeAbort = () => { controller.signal.removeEventListener('abort', onAbort) }
    controller.signal.addEventListener('abort', onAbort, { once: true })
    if (controller.signal.aborted) onAbort()
  })
  try {
    return await Promise.race([invocation, aborted])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    removeAbort?.()
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

function detachedSessionHeader(candidate: unknown, expectedId?: SessionId): SessionHeader {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('DSH session persistence returned a malformed Session header')
  }
  let header: SessionHeader
  try {
    header = structuredClone(candidate) as SessionHeader
  } catch {
    throw new Error('DSH session persistence returned an unclonable Session header')
  }
  if (typeof header.id !== 'string' || header.id.length === 0
    || (expectedId !== undefined && header.id !== expectedId)) {
    throw new Error(`DSH session persistence returned the wrong Session header${expectedId === undefined ? '' : ` for '${String(expectedId)}'`}`)
  }
  return header
}

function detachedSessionEvents(candidate: readonly unknown[]): readonly SessionEvent[] {
  try {
    return structuredClone(candidate) as readonly SessionEvent[]
  } catch {
    throw new Error('DSH session persistence returned unclonable Session events')
  }
}

function optionalDataMethod(receiver: object, key: string): SessionPersistenceMethod | undefined {
  const visited = new Set<object>()
  let cursor: object | null = receiver
  while (cursor !== null) {
    if (visited.has(cursor)) throw new Error('DSH session persistence has a cyclic prototype chain')
    visited.add(cursor)
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(cursor, key)
    } catch {
      throw new Error(`DSH session persistence ${key} capability inspection failed`)
    }
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new Error(`DSH session persistence ${key} capability is not a data method`)
      }
      return descriptor.value as SessionPersistenceMethod
    }
    try {
      cursor = Reflect.getPrototypeOf(cursor)
    } catch {
      throw new Error(`DSH session persistence ${key} capability inspection failed`)
    }
  }
  return undefined
}

function requiredDataMethod(receiver: object, key: string): SessionPersistenceMethod {
  const method = optionalDataMethod(receiver, key)
  if (method === undefined) throw new Error(`DSH session persistence has no callable ${key}`)
  return method
}

function plainDataRecord(candidate: unknown): Readonly<Record<string, unknown>> | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>
  try {
    const prototype = Reflect.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(candidate)
  } catch {
    return undefined
  }
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]
    if (typeof key !== 'string'
      || descriptor === undefined
      || !descriptor.enumerable
      || !('value' in descriptor)) return undefined
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function hasExactDataKeys(
  candidate: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return Reflect.ownKeys(candidate).length === keys.length
    && keys.every(key => Object.hasOwn(candidate, key))
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return typeof candidate === 'number'
    && Number.isSafeInteger(candidate)
    && candidate >= 0
    && !Object.is(candidate, -0)
}

function optionalNonNegativeSafeInteger(candidate: unknown): boolean {
  return candidate === undefined || nonNegativeSafeInteger(candidate)
}

function sessionPreset(header: SessionHeader, events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'agent-preset/selected') return event.data.agentPreset
  }
  return header.agentPreset
}

function boundedCommandResult(result: { kind: 'success' | 'error'; text?: string }): GatewayCommandResult {
  return Object.freeze({
    kind: result.kind,
    ...(result.text === undefined ? {} : { text: boundedText(result.text, 16_384) }),
  })
}

function routeAgentOptions(route: ResolvedGatewayRoute): {
  provider: string
  model: string
  maxTokens?: number
} {
  return {
    provider: route.provider,
    model: route.model,
    ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
  }
}

function boundedText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`
}

function normalizeUserContent(
  text: string | undefined,
  rawImages: readonly ImageAttachmentRef[] | undefined,
): GatewayUserContent {
  const exactText = text === undefined || text.length === 0
    ? undefined
    : exactIngressText(text, 'text', 1_048_576)
  if (rawImages !== undefined && !Array.isArray(rawImages)) {
    throw new Error('channel images must be an array of native DSH attachment references')
  }
  const images = (rawImages ?? []).map(normalizeImageReference)
  if (images.length > 100) throw new Error('channel content supports at most 100 image references')
  if (exactText === undefined && images.length === 0) {
    throw new Error('channel content must contain text or a native DSH image reference')
  }
  const blocks: UserMessage['content'] = [
    ...(exactText === undefined ? [] : [{ type: 'text' as const, text: exactText }]),
    ...images.map(attachment => ({ type: 'image' as const, attachment })),
  ]
  return Object.freeze({
    blocks: Object.freeze(blocks),
    ...(images.length === 0 && exactText !== undefined ? { commandText: exactText } : {}),
    // Preserve the v1 text-only digest so an upgrade cannot turn a settled
    // external event into false intent drift. Multimodal input uses a tagged
    // canonical shape that includes every durable native image reference.
    contentHash: images.length === 0 && exactText !== undefined
      ? hash(exactText)
      : hash(JSON.stringify({ schemaVersion: 2, text: exactText ?? null, images })),
  })
}

function normalizeImageReference(input: ImageAttachmentRef): ImageAttachmentRef {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('channel image reference must be an object')
  }
  if (typeof input.attachmentId !== 'string') {
    throw new Error('channel image attachmentId must be a native content-addressed reference')
  }
  const attachmentId = input.attachmentId
  if (!/^sha256:[a-f0-9]{64}$/u.test(attachmentId)) {
    throw new Error('channel image attachmentId must be a native content-addressed reference')
  }
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mediaType)) {
    throw new Error('channel image mediaType is unsupported by native DSH attachments')
  }
  for (const [label, value] of [
    ['bytes', input.bytes], ['width', input.width], ['height', input.height],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`channel image ${label} must be a positive safe integer`)
    }
  }
  const name = input.name === undefined ? undefined : exactImageName(input.name)
  const extended = input as ImageAttachmentRef & {
    originalDimensions?: { width: number; height: number }
  }
  const originalDimensions = extended.originalDimensions === undefined
    ? undefined
    : normalizeOriginalDimensions(extended.originalDimensions, input.width, input.height)
  const normalized = Object.freeze({
    attachmentId,
    mediaType: input.mediaType,
    bytes: input.bytes,
    width: input.width,
    height: input.height,
    ...(name === undefined ? {} : { name }),
    ...(originalDimensions === undefined ? {} : { originalDimensions }),
  })
  return normalized
}

async function executeNativeCommand(
  commands: Context['commands'],
  agent: Agent,
  line: string,
  signal: AbortSignal,
): Promise<CommandExecution | undefined> {
  if (commands.execute.length >= 4) {
    const executeWithImages = commands.execute as unknown as (
      agent: Agent,
      line: string,
      images: readonly never[],
      signal: AbortSignal,
    ) => Promise<CommandExecution | undefined>
    return executeWithImages.call(commands, agent, line, [], signal)
  }
  const executeLegacy = commands.execute as unknown as (
    agent: Agent,
    line: string,
    signal: AbortSignal,
  ) => Promise<CommandExecution | undefined>
  return executeLegacy(agent, line, signal)
}

function normalizeOriginalDimensions(
  value: { width: number; height: number },
  width: number,
  height: number,
): Readonly<{ width: number; height: number }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !Number.isSafeInteger(value.width) || value.width < width
    || !Number.isSafeInteger(value.height) || value.height < height
    || (value.width === width && value.height === height)) {
    throw new Error('channel image originalDimensions must describe a larger positive raster')
  }
  return Object.freeze({ width: value.width, height: value.height })
}

function exactImageName(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || value.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('channel image name must be a safe path-free display name')
  }
  return value
}

function exactIngressText(value: string, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > maxBytes
    || (label === 'eventId' && (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)))) {
    throw new Error(`channel ${label} is invalid or exceeds ${maxBytes} bytes`)
  }
  return value
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown channel failure'
}

function isSessionAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /session [^\n]* already exists/u.test(error.message)
}

function exactHealthTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('gateway health observation time must be a non-negative safe integer')
  }
  return value
}

function immutableHealth<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutableHealth(child)
    Object.freeze(value)
  }
  return value
}
