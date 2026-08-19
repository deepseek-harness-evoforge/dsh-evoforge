import { randomBytes } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  GatewayIngressUncertainError,
  type GatewayEndpoint,
  type DshGateway,
} from 'dsh-gateway'
import type { ResolvedFeishuConfig, ResolvedFeishuRoute } from './config.js'
import type { FeishuDeliveryRecord, FeishuDeliveryStore } from './delivery-store.js'
import type { FeishuSendFailure } from './delivery-state.js'
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
  private readonly outputByTurn = new WeakMap<Agent, Map<number, string>>()
  private readonly latestDestination = new WeakMap<Agent, ReplyDestination>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly scheduled = new Set<string>()
  private readonly unsubscribers: Array<() => void> = []
  private deliveryTail: Promise<void> = Promise.resolve()
  private started = false
  private transportState: FeishuTransportState = 'connecting'
  private connectedAt?: number
  private lastActivityAt?: number
  private lastPlatformErrorAt?: number

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedFeishuConfig,
    private readonly gateway: DshGateway,
    private readonly store: FeishuDeliveryStore,
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
    await this.store.recoverInflight(Date.now())
    for (const route of this.config.routes) this.bind(await this.gateway.resolve(route.id, this.lifecycle.signal))

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
    this.ctx.on('agent/turn-stopping', ({ agent, turn }) => {
      if (!this.bound.has(agent)) return
      const replies = this.turnMap(this.repliesByTurn, agent)
      if (!replies.has(turn)) {
        const routes = this.routesBySession.get(String(agent.session.id))
        if (routes?.length === 1) {
          replies.set(turn, Object.freeze({ route: routes[0]!, replyInThread: routes[0]!.endpoint.threadId !== undefined }))
        }
      }
      if (!replies.has(turn)) return
      const text = outboundTextForTurn(agent.session.events, turn, this.config.maxTextChars)
      if (text !== undefined) this.turnMap(this.outputByTurn, agent).set(turn, text)
    })
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      const agent = this.agentsBySession.get(String(session.id))
      if (agent === undefined || session !== agent.session) return
      const destination = this.turnMap(this.repliesByTurn, agent).get(event.data.turn)
      const text = this.turnMap(this.outputByTurn, agent).get(event.data.turn)
      this.turnMap(this.repliesByTurn, agent).delete(event.data.turn)
      this.turnMap(this.outputByTurn, agent).delete(event.data.turn)
      if (destination !== undefined && this.latestDestination.get(agent) === destination) {
        this.latestDestination.delete(agent)
      }
      if (destination !== undefined && text !== undefined) {
        void this.prepareTurn(destination, agent, event.data.turn, text).catch((error: unknown) => {
          this.ctx.logger.warn(`dsh-feishu: could not prepare final answer: ${safeMessage(error)}`)
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
        if (!this.lifecycle.signal.aborted) this.ctx.logger.warn(`dsh-feishu: platform error: ${safeMessage(error)}`)
      }),
    )
    try {
      await this.platform.connect()
      this.connectedAt = Date.now()
      this.transportState = 'ready'
      this.enqueuePending()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  async dispose(): Promise<void> {
    this.transportState = 'stopping'
    if (!this.lifecycle.signal.aborted) this.lifecycle.abort(new Error('dsh-feishu disposed'))
    while (this.unsubscribers.length > 0) this.unsubscribers.pop()?.()
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.resolve('cancelled')
    }
    await this.deliveryTail
    await this.platform.disconnect()
    await this.store.close()
  }

  async notifyHost(notice: FeishuHostNotice): Promise<FeishuHostNoticeReceipt> {
    if (!/^[a-f0-9]{64}$/u.test(notice.id)) {
      throw new Error('dsh-feishu: host notice id must be a SHA-256 hex digest')
    }
    const route = this.routesById.get(notice.routeId)
    if (route === undefined) throw new Error(`dsh-feishu: host notice route '${notice.routeId}' is not configured`)
    const prepared = await this.store.prepareNotice({
      routeId: route.id,
      sessionId: route.sessionId,
      chatId: route.endpoint.conversationId,
      ...(route.endpoint.threadId === undefined ? {} : { threadId: route.endpoint.threadId }),
      noticeId: notice.id,
      text: boundText(notice.text, this.config.maxTextChars),
      now: Date.now(),
    })
    this.enqueue(prepared.record.id)
    return Object.freeze({ created: prepared.created, status: prepared.record.status })
  }

  /** Redacted projection of the exact Host state; it performs no model or platform call. */
  healthSnapshot(routes: readonly ResolvedFeishuRoute[] = this.config.routes): FeishuHealthSnapshot {
    const routeIds = new Set(routes.map(route => route.id))
    return summarizeFeishuHealth({
      now: Date.now(),
      accountId: this.config.appId,
      transport: {
        state: this.transportState,
        ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
        ...(this.lastActivityAt === undefined ? {} : { lastActivityAt: this.lastActivityAt }),
        ...(this.lastPlatformErrorAt === undefined ? {} : { lastErrorAt: this.lastPlatformErrorAt }),
      },
      routes: routes.map(route => ({
        id: route.id,
        workspaceId: route.workspaceId,
        sessionId: route.sessionId,
        threadScoped: route.endpoint.threadId !== undefined,
      })),
      records: this.store.list(),
      scheduled: [...this.scheduled].filter(id => {
        const record = this.store.get(id)
        return record !== undefined && routeIds.has(record.routeId)
      }).length,
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
    if (message.rawContentType !== 'text' && message.rawContentType !== 'post') return
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
        text: message.content,
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
    if (pending.destination.route.endpoint.conversationId !== action.chatId
      || pending.destination.route.endpoint.userId !== action.operatorId) return
    this.pendingApprovals.delete(selected.nonce)
    if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
    pending.resolve(selected.outcome)
  }

  private async prepareTurn(
    destination: ReplyDestination,
    agent: Agent,
    turn: number,
    text: string,
  ): Promise<void> {
    const prepared = await this.store.prepareTurn({
      ...deliveryDestination(destination),
      sessionId: String(agent.session.id),
      turn,
      text,
      now: Date.now(),
    })
    this.enqueue(prepared.record.id)
  }

  private async prepareResponse(
    destination: ReplyDestination,
    eventId: string,
    text: string,
  ): Promise<void> {
    const prepared = await this.store.prepareResponse({
      ...deliveryDestination(destination),
      sessionId: destination.route.sessionId,
      eventId,
      text: boundText(text, this.config.maxTextChars),
      now: Date.now(),
    })
    this.enqueue(prepared.record.id)
  }

  private enqueuePending(): void {
    for (const record of this.store.list(['prepared', 'retrying'])) this.enqueue(record.id)
  }

  private enqueue(id: string): void {
    if (this.scheduled.has(id) || this.lifecycle.signal.aborted) return
    this.scheduled.add(id)
    const task = this.deliveryTail.then(() => this.deliver(id))
    this.deliveryTail = task.then(
      () => {
        this.scheduled.delete(id)
        if (this.store.get(id)?.status === 'retrying') this.enqueue(id)
      },
      (error: unknown) => {
        this.scheduled.delete(id)
        this.ctx.logger.warn(`dsh-feishu: delivery worker failed: ${safeMessage(error)}`)
      },
    )
  }

  private async deliver(id: string): Promise<void> {
    let record = this.store.get(id)
    if (record === undefined || (record.status !== 'prepared' && record.status !== 'retrying')) return
    if (record.status === 'retrying' && record.nextAttemptAt !== undefined) {
      await delay(Math.max(0, record.nextAttemptAt - Date.now()), this.lifecycle.signal)
      if (this.lifecycle.signal.aborted) return
      record = this.store.get(id)
      if (record === undefined || record.status !== 'retrying') return
    }
    const sending = await this.store.markSending(id, Date.now())
    try {
      const sent = await this.platform.sendText(
        sending.chatId,
        sending.source.text,
        deliverySendOptions(sending),
      )
      this.observeTransportActivity()
      await this.store.markDelivered(id, sent.messageId, Date.now())
    } catch (error: unknown) {
      await this.store.markFailure(
        id,
        classifyPlatformFailure(error),
        Date.now(),
        this.config.maxSendAttempts,
        this.config.maxRetryAfterMs,
      )
    }
  }

  private async requestApproval(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (request.signal?.aborted === true) return 'cancelled'
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
    try {
      await this.platform.sendCard(destination.route.endpoint.conversationId, approvalCard(content, nonce))
    } catch {
      return next()
    }
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        if (!this.pendingApprovals.delete(nonce)) return
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => { settle('cancelled') }
      this.pendingApprovals.set(nonce, {
        destination,
        resolve,
        onAbort,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
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
  }
}

function deliveryDestination(destination: ReplyDestination): {
  routeId: string
  chatId: string
  threadId?: string
  replyToMessageId?: string
} {
  return {
    routeId: destination.route.id,
    chatId: destination.route.endpoint.conversationId,
    ...(destination.route.endpoint.threadId === undefined ? {} : { threadId: destination.route.endpoint.threadId }),
    ...(destination.replyTo === undefined ? {} : { replyToMessageId: destination.replyTo }),
  }
}

function deliverySendOptions(record: FeishuDeliveryRecord): FeishuSendOptions | undefined {
  if (record.replyToMessageId === undefined && record.threadId === undefined) return undefined
  return Object.freeze({
    ...(record.replyToMessageId === undefined ? {} : { replyTo: record.replyToMessageId }),
    ...(record.threadId === undefined ? {} : { replyInThread: true }),
  })
}

function classifyPlatformFailure(error: unknown): FeishuSendFailure {
  if (!isPlatformSendError(error)) return { kind: 'transport' }
  if (error.code === 'rate_limited') {
    return { kind: 'rate-limited', retryAfterMs: error.retryAfterMs ?? 1_000 }
  }
  if (['format_error', 'permission_denied', 'target_revoked'].includes(error.code)) {
    return { kind: 'rejected', code: error.code }
  }
  return error.code === 'unknown' ? { kind: 'invalid-response' } : { kind: 'transport' }
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

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await wait(ms, undefined, { signal })
  } catch {
    // Cordis disposal aborts the only expected wait.
  }
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
