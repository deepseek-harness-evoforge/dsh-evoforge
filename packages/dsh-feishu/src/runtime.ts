import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  GatewayIngressUncertainError,
  type GatewayEndpoint,
  type ResolvedGatewayRoute,
  type DshGateway,
  type GatewayOutboundSendInput,
  type GatewayOutboundSendResult,
  type GatewayTextAdapterRegistration,
  type GatewayTextDeliveryIntent,
  type GatewayTransportRegistration,
} from 'dsh-gateway'
import { sessionEvents } from 'dsh-gateway'
import type { ResolvedFeishuConfig, ResolvedFeishuRoute } from './config.js'
import {
  FEISHU_CONTENT_TOOL,
  installFeishuContentTool,
  shouldInstallFeishuContentTool,
} from './content.js'
import { materializeFeishuInbound } from './inbound-images.js'
import type {
  FeishuHostNotice,
  FeishuHostNoticeReceipt,
  FeishuHostRoute,
  FeishuHostRouteBinding,
} from './host-route.js'
import {
  renderFeishuHealthCommand,
  summarizeFeishuHealth,
  type FeishuHealthSnapshot,
  type FeishuTransportState,
} from './health.js'
import { boundText, outboundTextForTurn } from './outbound.js'
import { FeishuPlatformSendError } from './platform.js'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuPlatformReject,
  FeishuSendOptions,
} from './platform.js'

const MAX_PENDING_REPLY_CORRELATIONS = 10_000
const PLATFORM_SEND_TIMEOUT_MS = 30_000

interface ReplyDestination {
  readonly route: ResolvedFeishuRoute
  readonly replyTo?: string
  readonly replyInThread: boolean
}

interface PendingApproval {
  readonly destination: ReplyDestination
  readonly externalMessageId: string
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly signal?: AbortSignal
  readonly onAbort?: () => void
}

/** Thin Feishu transport over native DSH Gateway, Agent, Session, Command, and Approval. */
export class FeishuRuntime {
  private readonly lifecycle = new AbortController()
  private readonly configuredRouteIds: ReadonlySet<string>
  private readonly routesById = new Map<string, ResolvedFeishuRoute>()
  private readonly routesBySession = new Map<string, readonly ResolvedFeishuRoute[]>()
  private readonly agentsBySession = new Map<string, Agent>()
  private readonly bound = new WeakSet<Agent>()
  private readonly repliesByMessage = new Map<string, ReplyDestination>()
  private readonly repliesByTurn = new WeakMap<Agent, Map<number, ReplyDestination>>()
  private readonly outboundByTurn = new WeakMap<Agent, Map<number, GatewayTextDeliveryIntent>>()
  private readonly latestDestination = new WeakMap<Agent, ReplyDestination>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly contentToolDisposers = new Map<Agent, () => void>()
  private readonly observedChatKinds = new Map<string, 'direct' | 'group'>()
  private readonly unsubscribers: Array<() => void> = []
  private outbound?: GatewayTextAdapterRegistration
  private transport: GatewayTransportRegistration | undefined
  private started = false
  private disposed = false
  private transportState: FeishuTransportState = 'connecting'
  private connectedAt?: number
  private lastInboundAt?: number
  private lastActivityAt?: number
  private lastPlatformErrorAt?: number
  private lastPolicyRejectAt?: number
  private lastPolicyRejectReason?: FeishuPlatformReject['reason']

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedFeishuConfig,
    private readonly gateway: DshGateway,
    private readonly platform: FeishuPlatform,
  ) {
    this.configuredRouteIds = config.routeIds
    for (const route of config.routes) this.rememberRoute(route)
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const startingAt = Date.now()
    this.transport = this.gateway.registerTransport({
      adapter: 'feishu',
      accountId: this.config.appId,
      kind: 'official-feishu-websocket',
      routeIds: this.config.routes.map(route => route.id),
      pairedRoutes: this.config.pairedRoutes,
      initial: { state: 'connecting', observedAt: startingAt },
    })
    for (const route of this.config.routes) this.bind(await this.gateway.resolve(route.id, this.lifecycle.signal))
    this.outbound = this.gateway.registerTextAdapter({
      adapter: 'feishu',
      accountId: this.config.appId,
      routeIds: this.config.routes.map(route => route.id),
      pairedRoutes: this.config.pairedRoutes,
      maxAttempts: this.config.maxSendAttempts,
      maxRetryAfterMs: this.config.maxRetryAfterMs,
      sendTimeoutMs: PLATFORM_SEND_TIMEOUT_MS,
      send: (input, signal) => this.sendOutbound(input, signal),
    })

    this.ctx.on('agent/created', ({ agent }) => {
      const routes = this.routesBySession.get(String(agent.id))
      if (routes === undefined) return
      void Promise.all(routes.map(route => this.gateway.resolve(route.id, this.lifecycle.signal)))
        .then((resolved) => {
          if (resolved.includes(agent)) this.bind(agent)
        })
        .catch((error: unknown) => {
          if (!this.lifecycle.signal.aborted) {
            this.ctx.logger.warn(`dsh-feishu: rejected replacement Agent: ${safeMessage(error)}`)
          }
        })
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      this.contentToolDisposers.get(agent)?.()
      this.contentToolDisposers.delete(agent)
      if (this.agentsBySession.get(String(agent.session.id)) === agent) {
        this.agentsBySession.delete(String(agent.session.id))
      }
    })
    this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (!this.bound.has(agent)) return
      const destination = this.repliesByMessage.get(String(message.id))
      if (destination === undefined) return
      this.repliesByMessage.delete(String(message.id))
      this.turnMap(this.repliesByTurn, agent).set(turn, destination)
      this.latestDestination.set(agent, destination)
    })
    this.ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      if (!this.bound.has(agent)) return
      const replies = this.turnMap(this.repliesByTurn, agent)
      if (!replies.has(turn)) {
        const routes = this.routesBySession.get(String(agent.session.id))
        if (routes?.length === 1) {
          replies.set(turn, Object.freeze({ route: routes[0]!, replyInThread: routes[0]!.endpoint.threadId !== undefined }))
        }
      }
      const destination = replies.get(turn)
      if (destination === undefined) return
      const text = outboundTextForTurn(sessionEvents(agent.session), turn, this.config.maxTextChars)
      if (text === undefined) return
      const intent: GatewayTextDeliveryIntent = Object.freeze({
        routeId: destination.route.id,
        kind: 'turn',
        intentKey: `turn:${turn}`,
        text,
        waitForTurnEnd: turn,
        ...(destination.replyTo === undefined ? {} : { replyToExternalId: destination.replyTo }),
        ...(destination.replyInThread ? { replyInThread: true } : {}),
      })
      this.turnMap(this.outboundByTurn, agent).set(turn, intent)
      await this.requireOutbound().submit(intent)
    })
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      const agent = this.agentsBySession.get(String(session.id))
      if (agent === undefined || session !== agent.session) return
      const destination = this.turnMap(this.repliesByTurn, agent).get(event.data.turn)
      const intent = this.turnMap(this.outboundByTurn, agent).get(event.data.turn)
      this.turnMap(this.repliesByTurn, agent).delete(event.data.turn)
      this.turnMap(this.outboundByTurn, agent).delete(event.data.turn)
      if (destination !== undefined && this.latestDestination.get(agent) === destination) {
        this.latestDestination.delete(agent)
      }
      if (intent !== undefined) {
        void this.requireOutbound().submit(intent).catch((error: unknown) => {
          this.ctx.logger.warn(`dsh-feishu: could not release final answer: ${safeMessage(error)}`)
        })
      }
    })
    this.ctx.on('approval/request', (request, next) => {
      if (!this.bound.has(request.agent)) return next()
      return this.requestApproval(request, next)
    })

    this.unsubscribers.push(
      this.platform.onMessage(message => this.receiveMessage(message)),
      this.platform.onApprovalAction(action => this.receiveApprovalAction(action)),
      this.platform.onError(error => {
        this.transportState = 'degraded'
        this.lastPlatformErrorAt = Date.now()
        this.reportTransport(this.lastPlatformErrorAt)
        if (!this.lifecycle.signal.aborted) this.ctx.logger.warn(`dsh-feishu: platform error: ${safeMessage(error)}`)
      }),
    )
    if (this.platform.onReject !== undefined) {
      this.unsubscribers.push(this.platform.onReject(reject => {
        if (this.lifecycle.signal.aborted) return
        this.lastPolicyRejectAt = Date.now()
        this.lastPolicyRejectReason = reject.reason
        // Policy rejects are expected safety decisions, not transport failures.
        // Keep the lifecycle state intact while making the cause visible to Host health.
        this.observeTransportActivity()
      }))
    }
    if (this.platform.onReconnecting !== undefined) {
      this.unsubscribers.push(this.platform.onReconnecting(() => {
        if (this.lifecycle.signal.aborted) return
        this.transportState = 'degraded'
        this.reportTransport(Date.now())
      }))
    }
    if (this.platform.onReconnected !== undefined) {
      this.unsubscribers.push(this.platform.onReconnected(() => {
        if (this.lifecycle.signal.aborted) return
        this.transportState = 'ready'
        this.reportTransport(Date.now())
      }))
    }
    try {
      await this.platform.connect()
      this.connectedAt = Date.now()
      this.transportState = 'ready'
      this.reportTransport(this.connectedAt)
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const failures: unknown[] = []
    this.transportState = 'stopping'
    try {
      this.reportTransport(Date.now())
    } catch (error) {
      failures.push(error)
    }
    if (!this.lifecycle.signal.aborted) this.lifecycle.abort(new Error('dsh-feishu disposed'))
    while (this.unsubscribers.length > 0) {
      try {
        this.unsubscribers.pop()?.()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const disposeTool of this.contentToolDisposers.values()) {
      try {
        disposeTool()
      } catch (error) {
        failures.push(error)
      }
    }
    this.contentToolDisposers.clear()
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.resolve('cancelled')
    }
    try {
      await this.outbound?.dispose()
    } catch (error) {
      failures.push(error)
    }
    try {
      await this.platform.disconnect()
    } catch (error) {
      failures.push(error)
    }
    try {
      this.transport?.dispose()
    } catch (error) {
      failures.push(error)
    }
    this.transport = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'dsh-feishu: one or more runtime teardown steps failed')
    }
  }

  async notifyHost(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt> {
    if (!/^[a-f0-9]{64}$/u.test(notice.id)) {
      throw new Error('dsh-feishu: host notice id must be a SHA-256 hex digest')
    }
    this.syncActivePairedRoutes()
    const route = this.routesById.get(notice.routeId)
    if (route === undefined) throw new Error(`dsh-feishu: host notice route '${notice.routeId}' is not configured`)
    const prepared = await this.requireOutbound().submit({
      routeId: route.id,
      kind: 'notice',
      intentKey: `notice:${notice.id}`,
      text: boundText(notice.text, this.config.maxTextChars),
      ...(route.endpoint.threadId === undefined ? {} : { replyInThread: true }),
    })
    return Object.freeze({ created: prepared.created, status: prepared.status })
  }

  /** Host notice/control seam; route ownership is read dynamically after resident grants are adopted. */
  createHostRoute(): FeishuHostRoute {
    const runtime = this
    return Object.freeze({
      get routes(): readonly FeishuHostRouteBinding[] {
        runtime.syncActivePairedRoutes()
        return Object.freeze([...runtime.routesById.values()]
          .map(route => Object.freeze({ routeId: route.id, workspaceId: route.workspaceId }))
          .sort((left, right) => left.routeId.localeCompare(right.routeId)))
      },
      observedChatKind: (routeId: string) => runtime.observedChatKind(routeId),
      notify: (notice: FeishuHostNotice) => runtime.notifyHost(notice),
    })
  }

  observedChatKind(routeId: string): 'direct' | 'group' | undefined {
    this.syncActivePairedRoutes()
    if (!this.routesById.has(routeId)) return undefined
    return this.observedChatKinds.get(routeId)
  }

  /** Redacted projection of the exact Host state; it performs no model or platform call. */
  healthSnapshot(routes: readonly ResolvedFeishuRoute[] = [...this.routesById.values()]): FeishuHealthSnapshot {
    this.syncActivePairedRoutes()
    const activeRoutes = routes.filter(route => this.routesById.get(route.id) === route
      || this.configuredRouteIds.has(route.id))
    const routeIds = new Set(activeRoutes.map(route => route.id))
    const observedAt = Date.now()
    const sessionId = activeRoutes[0]?.sessionId
    const agent = sessionId === undefined ? undefined : this.agentsBySession.get(sessionId)
    const requestHeader = agent?.session.requestHeader()
    const toolAvailable = agent?.ctx.get('tools')?.get(FEISHU_CONTENT_TOOL, agent) !== undefined
    const gateway = this.gateway.healthSnapshot(observedAt, [...routeIds])
    if (gateway.transports.items.length !== 1) {
      throw new Error('dsh-feishu: exact Gateway transport health is unavailable')
    }
    return summarizeFeishuHealth({
      now: observedAt,
      accountId: this.config.appId,
      transport: gateway.transports.items[0]!,
      routes: activeRoutes.map(route => ({
        id: route.id,
        workspaceId: route.workspaceId,
        sessionId: route.sessionId,
        threadScoped: route.endpoint.threadId !== undefined,
      })),
      outbound: gateway.outbound,
      pendingApprovals: [...this.pendingApprovals.values()]
        .filter(pending => routeIds.has(pending.destination.route.id)).length,
      ...(this.lastInboundAt === undefined ? {} : { lastInboundAt: this.lastInboundAt }),
      ...(this.lastPolicyRejectAt === undefined ? {} : { lastPolicyRejectAt: this.lastPolicyRejectAt }),
      ...(this.lastPolicyRejectReason === undefined ? {} : { lastPolicyRejectReason: this.lastPolicyRejectReason }),
      content: {
        permissions: this.config.contentPermissions,
        toolAvailable,
        approvalAvailable: agent?.ctx.get('approval') !== undefined,
        futureSessionOnly: this.config.contentPermissions.size > 0 && !toolAvailable
          && requestHeader !== undefined
          && requestHeader.tools?.some(tool => tool.name === FEISHU_CONTENT_TOOL) !== true,
        maxContentChars: this.config.maxContentChars,
        maxBitableRecords: this.config.maxBitableRecords,
      },
    })
  }

  private bind(agent: Agent): void {
    const sessionId = String(agent.session.id)
    const routes = this.routesBySession.get(sessionId)
    if (routes === undefined) return
    this.agentsBySession.set(sessionId, agent)
    if (this.bound.has(agent)) return
    this.bound.add(agent)
    if (shouldInstallFeishuContentTool(agent, this.config.contentPermissions)) {
      if (this.platform.readContent === undefined) {
        throw new Error('dsh-feishu: configured content reads require a Feishu content platform')
      }
      // Approval is consumed opportunistically by ToolRuntime; if it is absent,
      // the native pipeline denies every `ask` decision instead of bypassing it.
      agent.ctx.inject(['tools'], () => {
        if (this.disposed || this.contentToolDisposers.has(agent)) return
        const disposeTool = installFeishuContentTool(agent, {
          permissions: this.config.contentPermissions,
          maxContentChars: this.config.maxContentChars,
          maxBitableRecords: this.config.maxBitableRecords,
        }, {
          read: (request, signal) => this.platform.readContent!(request, signal),
        })
        this.contentToolDisposers.set(agent, disposeTool)
        return () => {
          disposeTool()
          if (this.contentToolDisposers.get(agent) === disposeTool) {
            this.contentToolDisposers.delete(agent)
          }
        }
      })
    }
    agent.ctx.inject(['commands'], commandCtx => commandCtx.commands.register({
      name: 'feishu',
      description: 'inspect the static Feishu routes bound to this native Session',
      recordInput: false,
      handler: ({ rawInput }) => {
        if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /feishu' }
        const currentRoutes = this.routesBySession.get(sessionId) ?? []
        return { kind: 'success', text: renderFeishuHealthCommand(this.healthSnapshot(currentRoutes)) }
      },
    }))
  }

  private async handleMessage(message: FeishuInboundMessage): Promise<void> {
    if (this.lifecycle.signal.aborted) return
    this.syncActivePairedRoutes()
    this.observeInboundActivity()
    const endpoint: GatewayEndpoint = Object.freeze({
      adapter: 'feishu',
      accountId: this.config.appId,
      conversationId: message.chatId,
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
      userId: message.senderId,
    })
    const observedChatKind = message.chatType === 'p2p' ? 'direct' : 'group'
    const authorization = await this.gateway.authorize(endpoint, observedChatKind)
    if (authorization.kind === 'rejected') return
    if (authorization.kind === 'pairing') {
      if (authorization.offer.kind === 'offered') {
        await this.sendPairingCode(message, authorization.offer.code)
      }
      return
    }
    const selected = this.adoptRoute(authorization.route)
    if (selected === undefined) return
    const previousChatKind = this.observedChatKinds.get(selected.id)
    if (previousChatKind !== undefined && previousChatKind !== observedChatKind) {
      throw new Error(`dsh-feishu: platform chat kind drifted for exact route '${selected.id}'`)
    }
    this.observedChatKinds.set(selected.id, observedChatKind)
    const eventId = `message:${message.messageId}`
    const destination: ReplyDestination = Object.freeze({
      route: selected,
      replyTo: message.messageId,
      replyInThread: message.threadId !== undefined,
    })
    // Authorize before interpreting content. An unknown direct user must
    // receive the pairing code even when their first message is a file, audio,
    // or another type the current DSH attachment contract cannot materialize.
    // Once trusted, unsupported top-level types get a durable explanation
    // instead of disappearing silently; the Gateway outbound journal makes a
    // repeated platform event idempotent.
    if (message.rawContentType !== 'text' && message.rawContentType !== 'post'
      && message.rawContentType !== 'image') {
      await this.prepareResponse(
        destination,
        eventId,
        unsupportedContentNotice(message.rawContentType),
      )
      return
    }
    const materialized = await materializeFeishuInbound(
      message,
      this.platform,
      this.ctx.attachments,
      this.lifecycle.signal,
    )
    const messageId = this.gateway.messageIdFor(endpoint, eventId)
    if (!this.repliesByMessage.has(messageId)
      && this.repliesByMessage.size >= MAX_PENDING_REPLY_CORRELATIONS) {
      throw new Error('dsh-feishu: pending reply correlation capacity is full')
    }
    this.repliesByMessage.set(messageId, destination)
    let dispatch: Awaited<ReturnType<DshGateway['dispatch']>>
    try {
      dispatch = await this.gateway.dispatch({
        endpoint,
        eventId,
        ...(materialized.text === undefined ? {} : { text: materialized.text }),
        images: materialized.images,
        signal: this.lifecycle.signal,
      })
    } catch (error: unknown) {
      this.repliesByMessage.delete(messageId)
      if (!(error instanceof GatewayIngressUncertainError)) throw error
      await this.prepareResponse(
        destination,
        eventId,
        'This Feishu request crossed an uncertain execution boundary and was not replayed. Send a new message to try again.',
      )
      return
    }
    this.bind(dispatch.agent)
    if (dispatch.kind === 'message') {
      if (dispatch.duplicate) this.repliesByMessage.delete(messageId)
      return
    }
    this.repliesByMessage.delete(messageId)
    const text = dispatch.result.text
      ?? (dispatch.result.kind === 'success' ? 'Command completed.' : 'Command failed.')
    await this.prepareResponse(destination, eventId, boundText(text, this.config.maxTextChars))
  }

  /** Keep SDK event emitters from observing an unhandled async rejection. */
  private async receiveMessage(message: FeishuInboundMessage): Promise<void> {
    try {
      await this.handleMessage(message)
    } catch (error: unknown) {
      this.recordInboundFailure('message', error)
    }
  }

  /** Approval callbacks share the same failure boundary as inbound messages. */
  private async receiveApprovalAction(action: FeishuApprovalAction): Promise<void> {
    try {
      await this.handleApprovalAction(action)
    } catch (error: unknown) {
      this.recordInboundFailure('card action', error)
    }
  }

  private recordInboundFailure(kind: string, error: unknown): void {
    if (this.lifecycle.signal.aborted) return
    this.transportState = 'degraded'
    this.lastPlatformErrorAt = Date.now()
    try {
      this.reportTransport(this.lastPlatformErrorAt)
    } catch (reportError: unknown) {
      if (!this.lifecycle.signal.aborted) {
        this.ctx.logger.warn(`dsh-feishu: could not report ${kind} failure: ${safeMessage(reportError)}`)
      }
    }
    if (!this.lifecycle.signal.aborted) {
      this.ctx.logger.warn(`dsh-feishu: ${kind} handler failed: ${safeMessage(error)}`)
    }
  }

  private async sendPairingCode(message: FeishuInboundMessage, code: string): Promise<void> {
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(PLATFORM_SEND_TIMEOUT_MS)])
    await this.platform.sendText(
      message.chatId,
      `EvoForge 配对码：${code}\n\n请把配对码交给管理员批准；批准后直接发送下一条消息。当前消息不会进入 DSH Agent。`,
      { replyTo: message.messageId },
      signal,
    )
    this.observeTransportActivity()
  }

  private adoptRoute(route: ResolvedGatewayRoute): ResolvedFeishuRoute | undefined {
    if (route.adapter !== 'feishu' || route.accountId !== this.config.appId) return undefined
    if (!this.config.pairedRoutes && !this.configuredRouteIds.has(route.id)) return undefined
    const existing = this.routesById.get(route.id)
    if (existing !== undefined) return existing
    const selected: ResolvedFeishuRoute = Object.freeze({
      id: route.id,
      workspaceId: route.workspaceId,
      sessionId: route.sessionId,
      endpoint: Object.freeze({
        adapter: route.adapter,
        accountId: route.accountId,
        conversationId: route.conversationId,
        userId: route.userId,
        ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
      }),
    })
    this.rememberRoute(selected)
    return selected
  }

  /**
   * Gateway pairing grants are revocable Host state. Do not let a local cache
   * keep exposing a grant after the authoritative Gateway has removed it.
   * Configured routes are intentionally retained: their lifecycle is owned by
   * the DSH configuration, not the pairing authority.
   */
  private syncActivePairedRoutes(): void {
    if (!this.config.pairedRoutes) return
    let changed = false
    for (const routeId of this.routesById.keys()) {
      if (this.configuredRouteIds.has(routeId)) continue
      if (this.gateway.route(routeId) !== undefined) continue
      this.routesById.delete(routeId)
      this.observedChatKinds.delete(routeId)
      changed = true
    }
    if (!changed) return
    const rebuilt = new Map<string, readonly ResolvedFeishuRoute[]>()
    for (const route of this.routesById.values()) {
      const routes = rebuilt.get(route.sessionId) ?? []
      rebuilt.set(route.sessionId, Object.freeze([...routes, route]))
    }
    this.routesBySession.clear()
    for (const [sessionId, routes] of rebuilt) this.routesBySession.set(sessionId, routes)
  }

  private rememberRoute(route: ResolvedFeishuRoute): void {
    this.routesById.set(route.id, route)
    const routes = this.routesBySession.get(route.sessionId) ?? []
    if (!routes.some(candidate => candidate.id === route.id)) {
      this.routesBySession.set(route.sessionId, Object.freeze([...routes, route]))
    }
  }

  private async handleApprovalAction(action: FeishuApprovalAction): Promise<void> {
    this.observeInboundActivity()
    const selected = selectApprovalValue(action.value)
    if (selected === undefined) return
    const pending = this.pendingApprovals.get(selected.nonce)
    if (pending === undefined) return
    if (pending.externalMessageId !== action.messageId
      || pending.destination.route.endpoint.conversationId !== action.chatId
      || pending.destination.route.endpoint.userId !== action.operatorId) return
    this.pendingApprovals.delete(selected.nonce)
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
    pending.resolve(selected.outcome)
  }

  private async prepareResponse(
    destination: ReplyDestination,
    eventId: string,
    text: string,
  ): Promise<void> {
    await this.requireOutbound().submit({
      routeId: destination.route.id,
      kind: 'response',
      intentKey: `response:${eventId}`,
      text: boundText(text, this.config.maxTextChars),
      ...(destination.replyTo === undefined ? {} : { replyToExternalId: destination.replyTo }),
      ...(destination.replyInThread ? { replyInThread: true } : {}),
    })
  }

  private async sendOutbound(
    input: GatewayOutboundSendInput,
    signal: AbortSignal,
  ): Promise<GatewayOutboundSendResult> {
    const route = this.routesById.get(input.routeId)
    if (route === undefined) return { kind: 'rejected', code: 'route_mismatch' }
    try {
      const options: FeishuSendOptions | undefined = input.replyToExternalId === undefined && !input.replyInThread
        ? undefined
        : Object.freeze({
          ...(input.replyToExternalId === undefined ? {} : { replyTo: input.replyToExternalId }),
          ...(input.replyInThread ? { replyInThread: true } : {}),
        })
      const sent = await this.platform.sendText(route.endpoint.conversationId, input.text, options, signal)
      this.observeTransportActivity()
      return { kind: 'delivered', externalMessageId: sent.messageId }
    } catch (error: unknown) {
      const result = classifyPlatformFailure(error)
      if (result.kind === 'uncertain') {
        this.transportState = 'degraded'
        this.lastPlatformErrorAt = Date.now()
        this.reportTransport(this.lastPlatformErrorAt)
      }
      return result
    }
  }

  private requireOutbound(): GatewayTextAdapterRegistration {
    if (this.outbound === undefined) throw new Error('dsh-feishu: Gateway outbound is unavailable')
    return this.outbound
  }

  private async requestApproval(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (isAborted(request.signal)) return 'cancelled'
    const routes = this.routesBySession.get(String(request.agent.session.id))
    const destination = this.latestDestination.get(request.agent)
      ?? (routes?.length === 1
        ? Object.freeze({ route: routes[0]!, replyInThread: routes[0]!.endpoint.threadId !== undefined })
        : undefined)
    if (destination === undefined) return next()
    const nonce = randomBytes(9).toString('base64url')
    const content = boundText(
      `**Approval required**\n\nTool: ${request.toolName}${request.reason === undefined ? '' : `\n\nReason: ${request.reason}`}`,
      this.config.maxTextChars,
    )
    let sent: { readonly messageId: string }
    try {
      const signals = [this.lifecycle.signal, AbortSignal.timeout(PLATFORM_SEND_TIMEOUT_MS)]
      if (request.signal !== undefined) signals.push(request.signal)
      sent = await this.platform.sendCard(
        destination.route.endpoint.conversationId,
        approvalCard(content, nonce),
        sendOptionsFor(destination),
        AbortSignal.any(signals),
      )
    } catch {
      return next()
    }
    if (this.lifecycle.signal.aborted || isAborted(request.signal)) return 'cancelled'
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        if (!this.pendingApprovals.delete(nonce)) return
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => { settle('cancelled') }
      this.pendingApprovals.set(nonce, {
        destination,
        externalMessageId: sent.messageId,
        resolve,
        onAbort,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
      if (this.lifecycle.signal.aborted || isAborted(request.signal)) settle('cancelled')
    })
  }

  private turnMap<T>(store: WeakMap<Agent, Map<number, T>>, agent: Agent): Map<number, T> {
    let map = store.get(agent)
    if (map === undefined) {
      map = new Map()
      store.set(agent, map)
    }
    return map
  }

  private observeTransportActivity(): void {
    this.lastActivityAt = Date.now()
    if (!this.lifecycle.signal.aborted) this.transportState = 'ready'
    this.reportTransport(this.lastActivityAt)
  }

  private observeInboundActivity(): void {
    this.lastInboundAt = Date.now()
    this.observeTransportActivity()
  }

  private reportTransport(observedAt: number): void {
    this.transport?.report({
      state: this.transportState,
      observedAt,
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
      ...(this.lastInboundAt === undefined ? {} : { lastInboundAt: this.lastInboundAt }),
      ...(this.lastActivityAt === undefined ? {} : { lastActivityAt: this.lastActivityAt }),
      ...(this.lastPlatformErrorAt === undefined ? {} : { lastErrorAt: this.lastPlatformErrorAt }),
    })
  }
}

function sendOptionsFor(destination: ReplyDestination): FeishuSendOptions | undefined {
  if (destination.replyTo === undefined && !destination.replyInThread) return undefined
  return Object.freeze({
    ...(destination.replyTo === undefined ? {} : { replyTo: destination.replyTo }),
    ...(destination.replyInThread ? { replyInThread: true } : {}),
  })
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function unsupportedContentNotice(rawContentType: string): string {
  const label = rawContentType === 'file' || rawContentType === 'audio' || rawContentType === 'video'
    ? rawContentType
    : 'this Feishu message type'
  return `暂不支持直接处理 ${label}。当前 DSH 附件契约仅接受图片；请发送文字或图片，或先将文件内容粘贴到消息中。`
}

function classifyPlatformFailure(error: unknown): GatewayOutboundSendResult {
  if (!isPlatformSendError(error)) return { kind: 'uncertain' }
  if (error.code === 'rate_limited') {
    return { kind: 'rate-limited', retryAfterMs: error.retryAfterMs ?? 1_000 }
  }
  if (['format_error', 'permission_denied', 'target_revoked'].includes(error.code)) {
    return { kind: 'rejected', code: error.code }
  }
  return { kind: 'uncertain' }
}

function isPlatformSendError(error: unknown): error is FeishuPlatformSendError {
  if (error instanceof FeishuPlatformSendError) return true
  return error instanceof Error
    && error.name === 'FeishuPlatformSendError'
    && isRecord(error)
    && typeof error.code === 'string'
    && (error.retryAfterMs === undefined
      || (Number.isSafeInteger(error.retryAfterMs) && (error.retryAfterMs as number) > 0))
}

function approvalCard(content: string, nonce: string): object {
  return Object.freeze({
    schema: '2.0',
    config: { update_multi: true },
    body: {
      elements: [
        { tag: 'markdown', content },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: 'Allow once' },
              type: 'primary',
              value: { evoforge: 'dsh-approval-v1', nonce, outcome: 'allowed-once' },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: 'Reject' },
              type: 'danger',
              value: { evoforge: 'dsh-approval-v1', nonce, outcome: 'rejected' },
            },
          ],
        },
      ],
    },
  })
}

function selectApprovalValue(value: unknown): { nonce: string; outcome: 'allowed-once' | 'rejected' } | undefined {
  if (!isRecord(value) || value.evoforge !== 'dsh-approval-v1'
    || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{12}$/u.test(value.nonce)
    || (value.outcome !== 'allowed-once' && value.outcome !== 'rejected')) return undefined
  return { nonce: value.nonce, outcome: value.outcome }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown failure'
}
