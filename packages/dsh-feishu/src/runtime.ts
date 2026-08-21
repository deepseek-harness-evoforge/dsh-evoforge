import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  GatewayIngressUncertainError,
  type GatewayEndpoint,
  type DshGateway,
  type GatewayOutboundSendInput,
  type GatewayOutboundSendResult,
  type GatewayTextAdapterRegistration,
  type GatewayTextDeliveryIntent,
  type GatewayTransportRegistration,
} from 'dsh-gateway'
import type { ResolvedFeishuConfig, ResolvedFeishuRoute } from './config.js'
import { installFeishuContentTool, shouldInstallFeishuContentTool } from './content.js'
import { materializeFeishuInbound } from './inbound-images.js'
import type { FeishuHostNotice, FeishuHostNoticeReceipt } from './host-route.js'
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
  FeishuSendOptions,
} from './platform.js'

const MAX_PENDING_REPLY_CORRELATIONS = 10_000

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
  private readonly routesById: ReadonlyMap<string, ResolvedFeishuRoute>
  private readonly routesBySession: ReadonlyMap<string, readonly ResolvedFeishuRoute[]>
  private readonly agentsBySession = new Map<string, Agent>()
  private readonly bound = new WeakSet<Agent>()
  private readonly repliesByMessage = new Map<string, ReplyDestination>()
  private readonly repliesByTurn = new WeakMap<Agent, Map<number, ReplyDestination>>()
  private readonly outboundByTurn = new WeakMap<Agent, Map<number, GatewayTextDeliveryIntent>>()
  private readonly latestDestination = new WeakMap<Agent, ReplyDestination>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly contentToolDisposers = new Map<Agent, () => void>()
  private readonly unsubscribers: Array<() => void> = []
  private outbound?: GatewayTextAdapterRegistration
  private transport: GatewayTransportRegistration | undefined
  private started = false
  private disposed = false
  private transportState: FeishuTransportState = 'connecting'
  private connectedAt?: number
  private lastActivityAt?: number
  private lastPlatformErrorAt?: number

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedFeishuConfig,
    private readonly gateway: DshGateway,
    private readonly platform: FeishuPlatform,
  ) {
    this.configuredRouteIds = config.routeIds
    this.routesById = new Map(config.routes.map(route => [route.id, route]))
    const grouped = new Map<string, ResolvedFeishuRoute[]>()
    for (const route of config.routes) {
      const routes = grouped.get(route.sessionId) ?? []
      routes.push(route)
      grouped.set(route.sessionId, routes)
    }
    this.routesBySession = new Map([...grouped].map(([sessionId, routes]) => [sessionId, Object.freeze(routes)]))
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
      initial: { state: 'connecting', observedAt: startingAt },
    })
    for (const route of this.config.routes) this.bind(await this.gateway.resolve(route.id, this.lifecycle.signal))
    this.outbound = this.gateway.registerTextAdapter({
      adapter: 'feishu',
      accountId: this.config.appId,
      routeIds: this.config.routes.map(route => route.id),
      maxAttempts: this.config.maxSendAttempts,
      maxRetryAfterMs: this.config.maxRetryAfterMs,
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
      const text = outboundTextForTurn(agent.session.events, turn, this.config.maxTextChars)
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
      this.platform.onMessage(message => this.handleMessage(message)),
      this.platform.onApprovalAction(action => this.handleApprovalAction(action)),
      this.platform.onError(error => {
        this.transportState = 'degraded'
        this.lastPlatformErrorAt = Date.now()
        this.reportTransport(this.lastPlatformErrorAt)
        if (!this.lifecycle.signal.aborted) this.ctx.logger.warn(`dsh-feishu: platform error: ${safeMessage(error)}`)
      }),
    )
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
    this.transportState = 'stopping'
    this.reportTransport(Date.now())
    if (!this.lifecycle.signal.aborted) this.lifecycle.abort(new Error('dsh-feishu disposed'))
    while (this.unsubscribers.length > 0) this.unsubscribers.pop()?.()
    for (const disposeTool of this.contentToolDisposers.values()) disposeTool()
    this.contentToolDisposers.clear()
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.resolve('cancelled')
    }
    await this.outbound?.dispose()
    await this.platform.disconnect()
    this.transport?.dispose()
    this.transport = undefined
  }

  async notifyHost(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt> {
    if (!/^[a-f0-9]{64}$/u.test(notice.id)) {
      throw new Error('dsh-feishu: host notice id must be a SHA-256 hex digest')
    }
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

  /** Redacted projection of the exact Host state; it performs no model or platform call. */
  healthSnapshot(routes: readonly ResolvedFeishuRoute[] = this.config.routes): FeishuHealthSnapshot {
    const routeIds = new Set(routes.map(route => route.id))
    const observedAt = Date.now()
    const gateway = this.gateway.healthSnapshot(observedAt, [...routeIds])
    if (gateway.transports.items.length !== 1) {
      throw new Error('dsh-feishu: exact Gateway transport health is unavailable')
    }
    return summarizeFeishuHealth({
      now: observedAt,
      accountId: this.config.appId,
      transport: gateway.transports.items[0]!,
      routes: routes.map(route => ({
        id: route.id,
        workspaceId: route.workspaceId,
        sessionId: route.sessionId,
        threadScoped: route.endpoint.threadId !== undefined,
      })),
      outbound: gateway.outbound,
      pendingApprovals: [...this.pendingApprovals.values()]
        .filter(pending => routeIds.has(pending.destination.route.id)).length,
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
        return { kind: 'success', text: renderFeishuHealthCommand(this.healthSnapshot(routes)) }
      },
    }))
  }

  private async handleMessage(message: FeishuInboundMessage): Promise<void> {
    if (this.lifecycle.signal.aborted) return
    this.observeTransportActivity()
    if (message.rawContentType !== 'text' && message.rawContentType !== 'post'
      && message.rawContentType !== 'image') return
    const endpoint: GatewayEndpoint = Object.freeze({
      adapter: 'feishu',
      accountId: this.config.appId,
      conversationId: message.chatId,
      ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
      userId: message.senderId,
    })
    const route = this.gateway.match(endpoint)
    if (route === undefined || !this.configuredRouteIds.has(route.id)) return
    const selected = this.routesById.get(route.id)
    if (selected === undefined) return
    const materialized = await materializeFeishuInbound(
      message,
      this.platform,
      this.ctx.attachments,
      this.lifecycle.signal,
    )
    const eventId = `message:${message.messageId}`
    const messageId = this.gateway.messageIdFor(endpoint, eventId)
    if (!this.repliesByMessage.has(messageId)
      && this.repliesByMessage.size >= MAX_PENDING_REPLY_CORRELATIONS) {
      throw new Error('dsh-feishu: pending reply correlation capacity is full')
    }
    const destination: ReplyDestination = Object.freeze({
      route: selected,
      replyTo: message.messageId,
      replyInThread: message.threadId !== undefined,
    })
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

  private async handleApprovalAction(action: FeishuApprovalAction): Promise<void> {
    this.observeTransportActivity()
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
    _signal: AbortSignal,
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
      const sent = await this.platform.sendText(route.endpoint.conversationId, input.text, options)
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
      sent = await this.platform.sendCard(
        destination.route.endpoint.conversationId,
        approvalCard(content, nonce),
        sendOptionsFor(destination),
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

  private reportTransport(observedAt: number): void {
    this.transport?.report({
      state: this.transportState,
      observedAt,
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
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
