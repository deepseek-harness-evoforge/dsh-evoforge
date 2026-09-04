import { createHash, randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader, type UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import type {
  GatewayCommandResult,
  GatewayIngressRecord,
  GatewayIngressJournal,
} from './ingress-journal.js'
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

/**
 * The shared Host-side routing seam used by platform adapters. It owns no
 * network transport: adapters authenticate and poll, then submit an exact
 * endpoint tuple here for native Workspace/Session/Agent dispatch.
 */
export class DshGateway {
  private readonly ownedHandles = new Map<string, AgentHandle>()
  private readonly resolutions = new Map<string, Promise<Agent>>()
  private readonly ingressTails = new Map<string, Promise<void>>()
  private readonly activeIngressByRoute = new Map<string, number>()
  private readonly revokingRoutes = new Set<string>()
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
      const persisted = persistenceHeaders(await this.ctx.sessionPersistence.list())
      const persistedById = new Map(persisted.map(header => [String(header.id), header]))
      this.assertRouteSet()
      for (const route of this.allRoutes()) {
        const workspace = await this.requireWorkspace(route)
        await this.requirePreset(route)
        const live = this.ctx.agents.get(SessionId(route.sessionId))
        if (live !== undefined) {
          this.assertLiveIdentity(route, workspace, live)
          continue
        }
        if (persistedById.has(route.sessionId)) {
          const inspected = await inspectPersistenceSession(this.ctx.sessionPersistence, SessionId(route.sessionId))
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
      await Promise.allSettled([this.cleanupResources()])
      this.stopping ??= this.cleanupPromise
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

  async approvePairing(input: GatewayPairingApprovalInput): Promise<GatewayPairingApproval> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    await this.validatePairingTarget(input.target)
    if (this.configured.byId.has(input.target.id) || this.pairing.route(input.target.id) !== undefined) {
      throw new Error(`gateway pairing route id '${input.target.id}' is already configured`)
    }
    return this.pairing.approve(input)
  }

  async approvePairingForSession(
    input: GatewayPairingSessionApprovalInput,
  ): Promise<GatewayPairingSessionApprovalReceipt> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
    if (workspace === undefined || await workspace.status() !== 'ok') {
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
    if (workspace === undefined || await workspace.status() !== 'ok') {
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

  async approvePairingRequest(input: GatewayPairingRequestApprovalInput): Promise<GatewayPairingApproval> {
    this.assertRunning()
    if (this.pairing === undefined) throw new Error('DSH gateway pairing is disabled')
    const target = input.target
    await this.validatePairingTarget(target)
    if (this.configured.byId.has(target.id) || this.pairing.route(target.id) !== undefined) {
      throw new Error(`gateway pairing route id '${target.id}' is already configured`)
    }
    return this.pairing.approveRequest(input)
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
    const route = typeof routeOrId === 'string' ? this.route(routeOrId) : routeOrId
    if (route === undefined) throw new Error(`unknown gateway route '${String(routeOrId)}'`)
    signal?.throwIfAborted()
    let pending = this.resolutions.get(route.sessionId)
    if (pending === undefined) {
      pending = this.resolveNativeAgent(route, signal).finally(() => {
        this.resolutions.delete(route.sessionId)
      })
      this.resolutions.set(route.sessionId, pending)
    }
    return await pending
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
    this.stopping ??= (async () => {
      // A resident Host may receive shutdown while validation/recovery is still
      // awaiting persistence. Let startup finish before closing its resources.
      // Promise.allSettled keeps a startup validation error from masking cleanup.
      const starting = this.starting
      if (starting !== undefined) await Promise.allSettled([starting])
      await this.cleanupResources()
    })()
    return this.stopping
  }

  private cleanupResources(): Promise<void> {
    this.cleanupPromise ??= (async () => {
      this.removeSessionEvents?.()
      this.removeSessionEvents = undefined
      await Promise.allSettled(this.ingressTails.values())
      await this.outbound.stop()
      this.transports.stop()
      const handles = [...this.ownedHandles.values()]
      this.ownedHandles.clear()
      await Promise.allSettled(handles.map(handle => handle.dispose()))
      await this.ingressJournal.close()
      await this.pairing?.close()
    })()
    return this.cleanupPromise
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

    await this.ingressJournal.begin(input.ingressId, Date.now())
    if (kind === 'message') {
      const messageId = `channel:${input.ingressId}`
      try {
        if (!messageSeen(agent, messageId)) {
          agent.followup(freezeMessage({
            id: MessageId(messageId),
            role: 'user',
            content: [...input.content.blocks],
            source: { kind: 'user' },
          } satisfies UserMessage))
        }
      } catch (error: unknown) {
        await this.ingressJournal.markUncertain(input.ingressId, safeMessage(error), Date.now())
        throw error
      }
      await this.ingressJournal.settleMessage(input.ingressId, Date.now())
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

  private commandIsRegistered(agent: Agent, line: string): boolean {
    const parsed = parseCommand(line)
    return parsed !== undefined && this.ctx.commands.list(agent).some(command => command.name === parsed.name)
  }

  private async resolveNativeAgent(route: ResolvedGatewayRoute, signal?: AbortSignal): Promise<Agent> {
    const workspace = await this.requireWorkspace(route)
    await this.requirePreset(route)
    const sessionId = SessionId(route.sessionId)
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) {
      this.assertLiveIdentity(route, workspace, live)
      await workspace.attachSession(sessionId)
      return live
    }

    const header = persistenceHeaders(await this.ctx.sessionPersistence.list(signal))
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
        const inspected = await inspectPersistenceSession(this.ctx.sessionPersistence, sessionId, signal)
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

  private async requireWorkspace(route: ResolvedGatewayRoute): Promise<Workspace> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(route.workspaceId))
    if (workspace === undefined) throw new Error(`gateway route '${route.id}' names unknown Workspace '${route.workspaceId}'`)
    if (await workspace.status() !== 'ok') {
      throw new Error(`gateway route '${route.id}' Workspace '${route.workspaceId}' directory is missing`)
    }
    return workspace
  }

  private async requirePreset(route: ResolvedGatewayRoute): Promise<void> {
    const preset = await this.ctx.agentPresets.resolve(route.agentPreset)
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
    for (const route of this.allRoutes()) {
      if (ids.has(route.id)) throw new Error(`gateway route id '${route.id}' is duplicated`)
      if (endpoints.has(route.endpointKey)) throw new Error('gateway routes claim the same external endpoint')
      ids.add(route.id)
      endpoints.add(route.endpointKey)
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
    const workspace = await this.requireWorkspace(candidate)
    await this.requirePreset(candidate)
    const live = this.ctx.agents.get(SessionId(target.sessionId))
    if (live !== undefined) {
      this.assertLiveIdentity(candidate, workspace, live)
      return
    }
    const header = persistenceHeaders(await this.ctx.sessionPersistence.list())
      .find(item => String(item.id) === target.sessionId)
    if (header === undefined) return
    const inspected = await inspectPersistenceSession(this.ctx.sessionPersistence, SessionId(target.sessionId))
    this.assertPersistedIdentity(candidate, workspace, inspected.meta, inspected.events)
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

/** DSH alpha.5 exposes list() snapshots; older builds returned bare headers. */
function persistenceHeaders(value: readonly unknown[]): SessionHeader[] {
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as { readonly header?: unknown; readonly id?: unknown }
    const header = record.header ?? item
    if (typeof header !== 'object' || header === null || typeof (header as { id?: unknown }).id !== 'string') return []
    return [header as SessionHeader]
  })
}

/** Read one persisted session across the pre-alpha5 and alpha5 APIs. */
async function inspectPersistenceSession(
  persistence: unknown,
  id: SessionId,
  signal?: AbortSignal,
): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> {
  const service = persistence as {
    inspect?: (sessionId: SessionId, signal?: AbortSignal) => Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>
    load?: (sessionId: SessionId, signal?: AbortSignal) => Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }>
    open?: (sessionId: SessionId, access: 'read', options?: { signal?: AbortSignal }) => Promise<{
      header?: SessionHeader
      read(offset?: number, length?: number, options?: { signal?: AbortSignal }): Promise<readonly SessionEvent[]>
      close(): Promise<void>
    }>
  }
  if (service.inspect !== undefined) return service.inspect(id, signal)
  if (service.load !== undefined) return service.load(id, signal)
  if (service.open === undefined) throw new Error('DSH session persistence does not expose inspect/load/open')
  const handle = await service.open(id, 'read', signal === undefined ? undefined : { signal })
  try {
    const meta = handle.header
    if (meta === undefined) throw new Error(`persisted Session '${String(id)}' has no header`)
    return { meta, events: await handle.read(0, Number.MAX_SAFE_INTEGER, signal === undefined ? undefined : { signal }) }
  } finally {
    await handle.close()
  }
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
