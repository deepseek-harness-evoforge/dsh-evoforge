import { randomBytes } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  GatewayIngressUncertainError,
  type DshGateway,
  type GatewayEndpoint,
  type GatewayOutboundSendInput,
  type GatewayOutboundSendResult,
  type GatewayTextAdapterRegistration,
  type GatewayTextDeliveryIntent,
  type GatewayTransportRegistration,
  type GatewayTransportState,
  type ResolvedGatewayRoute,
} from 'dsh-evoforge-gateway'
import { sessionEvents } from 'dsh-evoforge-gateway'
import {
  selectTelegramApprovalCallback,
  selectTelegramMessage,
  type TelegramMessageSelection,
} from './inbound.js'
import { outboundTextForTurn } from './outbound.js'
import { TelegramApi, type TelegramUpdate } from './telegram-api.js'
import type { ResolvedTelegramPairingConfig } from './config.js'

const EMPTY_POLL_DELAY_MS = 100
const POLL_FAILURE_DELAY_MS = 1_000
const MAX_RETRY_AFTER_SECONDS = 300
const MAX_PENDING_REPLY_CORRELATIONS = 10_000
const PLATFORM_SEND_TIMEOUT_MS = 30_000

interface ReplyDestination {
  readonly route: ResolvedGatewayRoute
  readonly replyToMessageId: number
}

interface PendingApproval {
  readonly destination: ReplyDestination
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly signal?: AbortSignal
  readonly onAbort?: () => void
}

/**
 * Resident Telegram adapter for Gateway-owned unknown-DM pairing. It has no
 * route, Session, or approval authority of its own; all grants are adopted
 * from the shared Gateway after a Host approves them.
 */
export class TelegramPairingRuntime {
  private readonly lifecycle = new AbortController()
  private readonly routesById = new Map<string, ResolvedGatewayRoute>()
  private readonly routesBySession = new Map<string, readonly ResolvedGatewayRoute[]>()
  private readonly agentsBySession = new Map<string, Agent>()
  private readonly repliesByMessage = new Map<string, ReplyDestination>()
  private readonly repliesByTurn = new WeakMap<Agent, Map<number, ReplyDestination>>()
  private readonly outboundByTurn = new WeakMap<Agent, Map<number, GatewayTextDeliveryIntent>>()
  private readonly latestDestination = new WeakMap<Agent, ReplyDestination>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly bound = new WeakSet<Agent>()
  private pollTask?: Promise<void>
  private outbound?: GatewayTextAdapterRegistration
  private transport: GatewayTransportRegistration | undefined
  private transportState: GatewayTransportState = 'connecting'
  private connectedAt?: number
  private lastInboundAt?: number
  private lastActivityAt?: number
  private lastErrorAt?: number

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedTelegramPairingConfig,
    private readonly gateway: DshGateway,
    private readonly api: TelegramApi,
  ) {}

  async start(): Promise<void> {
    this.transport = this.gateway.registerTransport({
      adapter: 'telegram',
      accountId: this.config.accountId,
      kind: 'telegram-long-poll',
      routeIds: [],
      pairedRoutes: true,
      initial: { state: 'connecting', observedAt: Date.now() },
    })
    this.outbound = this.gateway.registerTextAdapter({
      adapter: 'telegram',
      accountId: this.config.accountId,
      routeIds: [],
      pairedRoutes: true,
      maxAttempts: this.config.maxSendAttempts,
      maxRetryAfterMs: MAX_RETRY_AFTER_SECONDS * 1_000,
      sendTimeoutMs: PLATFORM_SEND_TIMEOUT_MS,
      send: (input, signal) => this.sendOutbound(input, signal),
    })

    this.ctx.on('agent/created', ({ agent }) => {
      const routes = this.routesBySession.get(String(agent.id))
      if (routes === undefined) return
      void Promise.all(routes.map(route => this.gateway.resolve(route.id, this.lifecycle.signal)))
        .then(resolved => {
          if (resolved.includes(agent)) this.bind(agent)
        })
        .catch(error => {
          if (!this.lifecycle.signal.aborted) {
            this.ctx.logger.warn(`dsh-telegram: rejected replacement Agent: ${safeMessage(error)}`)
          }
        })
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      const sessionId = String(agent.session.id)
      if (this.agentsBySession.get(sessionId) === agent) this.agentsBySession.delete(sessionId)
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
      const destination = this.turnMap(this.repliesByTurn, agent).get(turn)
        ?? this.latestDestination.get(agent)
      if (destination === undefined) return
      const text = outboundTextForTurn(sessionEvents(agent.session), turn, this.config.maxTextChars)
      if (text === undefined) return
      const intent: GatewayTextDeliveryIntent = Object.freeze({
        routeId: destination.route.id,
        kind: 'turn',
        intentKey: `turn:${turn}`,
        text,
        waitForTurnEnd: turn,
        replyToExternalId: String(destination.replyToMessageId),
      })
      this.turnMap(this.outboundByTurn, agent).set(turn, intent)
      await this.requireOutbound().submit(intent)
    })
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      const agent = this.agentsBySession.get(String(session.id))
      if (agent === undefined) return
      const intent = this.turnMap(this.outboundByTurn, agent).get(event.data.turn)
      this.turnMap(this.repliesByTurn, agent).delete(event.data.turn)
      this.turnMap(this.outboundByTurn, agent).delete(event.data.turn)
      if (intent !== undefined) {
        void this.requireOutbound().submit(intent).catch(error => {
          this.ctx.logger.warn(`dsh-telegram: could not release final answer: ${safeMessage(error)}`)
        })
      }
    })
    this.ctx.on('approval/request', (request, next) => {
      if (!this.bound.has(request.agent)) return next()
      return this.requestApproval(request, next)
    })
    this.pollTask = this.poll()
  }

  async dispose(): Promise<void> {
    this.transportState = 'stopping'
    this.reportTransport(Date.now())
    this.lifecycle.abort(new Error('dsh-telegram pairing runtime disposed'))
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      pending.signal?.removeEventListener('abort', pending.onAbort!)
      pending.resolve('cancelled')
    }
    await Promise.allSettled([this.pollTask, this.outbound?.dispose()])
    this.transport?.dispose()
    this.transport = undefined
  }

  private bind(agent: Agent): void {
    const sessionId = String(agent.session.id)
    this.agentsBySession.set(sessionId, agent)
    if (this.bound.has(agent)) return
    this.bound.add(agent)
    agent.ctx.inject(['commands'], commandCtx => commandCtx.commands.register({
      name: 'telegram',
      description: 'inspect paired Telegram routes and durable delivery state',
      recordInput: false,
      handler: ({ rawInput }) => {
        if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /telegram' }
        const routeIds = this.routesBySession.get(sessionId)?.map(route => route.id) ?? []
        const health = this.gateway.healthSnapshot(Date.now(), routeIds)
        const counts = health.outbound
        const transport = health.transports.items[0]
        return {
          kind: 'success',
          text: [
            `Telegram pairing: ${(transport?.state ?? 'unavailable').toUpperCase()} (Gateway account ${this.config.accountId}).`,
            `Authorized routes: ${routeIds.length}; transport ${transport?.kind ?? 'unavailable'}.`,
            `Retained delivery: ${counts.delivered} delivered; ${counts.prepared + counts.sending + counts.retrying} pending; ${counts.uncertain} uncertain; ${counts.failed} failed.`,
            'Model surface: 0 tools, 0 prompt sections, 0 skills.',
          ].join('\n'),
        }
      },
    }))
  }

  private async poll(): Promise<void> {
    let offset = 0
    while (!this.lifecycle.signal.aborted) {
      try {
        const updates = await this.api.getUpdates(offset, this.config.pollTimeoutSeconds, this.lifecycle.signal)
        this.observeTransportActivity(updates.length > 0)
        for (const update of updates) {
          await this.handleUpdate(update)
          if (Number.isSafeInteger(update.update_id) && update.update_id >= offset) offset = update.update_id + 1
        }
        if (updates.length === 0) await delay(EMPTY_POLL_DELAY_MS, this.lifecycle.signal)
      } catch {
        if (this.lifecycle.signal.aborted) return
        this.transportState = 'degraded'
        this.lastErrorAt = Date.now()
        this.reportTransport(this.lastErrorAt)
        this.ctx.logger.warn('dsh-telegram: pairing long poll failed; retrying after a bounded delay')
        await delay(POLL_FAILURE_DELAY_MS, this.lifecycle.signal)
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const callback = selectTelegramApprovalCallback(update)
    if (callback.kind === 'approval-callback') {
      const pending = this.pendingApprovals.get(callback.nonce)
      if (pending !== undefined
        && pending.destination.route.conversationId === String(callback.chatId)
        && pending.destination.route.userId === String(callback.userId)) {
        this.pendingApprovals.delete(callback.nonce)
        pending.signal?.removeEventListener('abort', pending.onAbort!)
        pending.resolve(callback.outcome)
      }
      await this.api.answerCallback(callback.callbackQueryId, this.lifecycle.signal)
      return
    }

    const selected = selectTelegramMessage(update)
    if (selected.kind === 'ignored' || selected.chatKind !== 'direct') return
    const endpoint: GatewayEndpoint = Object.freeze({
      adapter: 'telegram',
      accountId: this.config.accountId,
      conversationId: String(selected.chatId),
      userId: String(selected.userId),
    })
    const authorization = await this.gateway.authorize(endpoint, 'direct')
    if (authorization.kind === 'rejected') return
    if (authorization.kind === 'pairing') {
      if (authorization.offer.kind === 'offered') await this.sendPairingCode(selected, authorization.offer.code)
      return
    }
    const route = this.adoptRoute(authorization.route)
    if (route === undefined) return
    const eventId = `update:${selected.updateId}`
    const destination: ReplyDestination = Object.freeze({ route, replyToMessageId: selected.messageId })
    if (selected.kind === 'unsupported' || selected.text === undefined) {
      await this.prepareResponse(destination, eventId,
        'This Telegram message type is not supported yet. Send text to continue the native DSH Session.')
      return
    }
    // Resolve and bind before dispatch: a newly adopted paired route may be
    // using a live Agent whose inbox claim/turn events happen synchronously
    // while Gateway.dispatch appends the native message.
    this.bind(await this.gateway.resolve(route.id, this.lifecycle.signal))
    const messageId = this.gateway.messageIdFor(endpoint, eventId)
    if (!this.repliesByMessage.has(messageId) && this.repliesByMessage.size >= MAX_PENDING_REPLY_CORRELATIONS) {
      throw new Error('dsh-telegram: pending reply correlation capacity is full')
    }
    this.repliesByMessage.set(messageId, destination)
    let dispatch: Awaited<ReturnType<DshGateway['dispatch']>>
    try {
      dispatch = await this.gateway.dispatch({ endpoint, eventId, text: selected.text, signal: this.lifecycle.signal })
    } catch (error: unknown) {
      this.repliesByMessage.delete(messageId)
      if (!(error instanceof GatewayIngressUncertainError)) throw error
      await this.prepareResponse(destination, eventId,
        'This Telegram request crossed an uncertain execution boundary and was not replayed. Send a new message to try again.')
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
    await this.prepareResponse(destination, eventId, text)
  }

  private adoptRoute(route: ResolvedGatewayRoute): ResolvedGatewayRoute | undefined {
    if (route.adapter !== 'telegram' || route.accountId !== this.config.accountId) return undefined
    const existing = this.routesById.get(route.id)
    if (existing !== undefined) return existing
    this.routesById.set(route.id, route)
    const routes = this.routesBySession.get(route.sessionId) ?? []
    this.routesBySession.set(route.sessionId, Object.freeze([...routes, route]))
    const agent = this.agentsBySession.get(route.sessionId)
    if (agent !== undefined) this.bind(agent)
    return route
  }

  private async sendPairingCode(selected: TelegramMessageSelection & { readonly kind: 'message' | 'unsupported' }, code: string): Promise<void> {
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(PLATFORM_SEND_TIMEOUT_MS)])
    const sent = await this.api.sendText({
      chatId: selected.chatId,
      text: `EvoForge pairing code: ${code}\n\nGive this code to the administrator for approval, then send your next message. This message was not sent to the DSH Agent.`,
      replyToMessageId: selected.messageId,
    }, signal)
    if (!sent.ok) throw new Error('dsh-telegram: unable to send pairing code')
    this.observeTransportActivity(true)
  }

  private async prepareResponse(destination: ReplyDestination, eventId: string, text: string): Promise<void> {
    await this.requireOutbound().submit({
      routeId: destination.route.id,
      kind: 'response',
      intentKey: `response:${eventId}`,
      text: boundText(text, this.config.maxTextChars),
      replyToExternalId: String(destination.replyToMessageId),
    })
  }

  private async sendOutbound(input: GatewayOutboundSendInput, signal: AbortSignal): Promise<GatewayOutboundSendResult> {
    const route = this.routesById.get(input.routeId)
      ?? (() => {
        const discovered = this.gateway.route(input.routeId)
        return discovered === undefined ? undefined : this.adoptRoute(discovered)
      })()
    if (route === undefined || route.adapter !== 'telegram' || route.accountId !== this.config.accountId) {
      return { kind: 'rejected', code: 'route_mismatch' }
    }
    const replyToMessageId = input.replyToExternalId === undefined
      ? undefined
      : canonicalTelegramMessageId(input.replyToExternalId)
    if (input.replyToExternalId !== undefined && replyToMessageId === undefined) {
      return { kind: 'rejected', code: 'invalid_reply_identity' }
    }
    try {
      const result = await this.api.sendText({
        chatId: Number(route.conversationId),
        text: input.text,
        ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      }, signal)
      if (result.ok || result.failure.kind === 'telegram-rejected') this.observeTransportActivity(true)
      else this.observeTransportFailure()
      if (result.ok) return { kind: 'delivered', externalMessageId: String(result.messageId) }
      if (result.failure.kind !== 'telegram-rejected') return { kind: 'uncertain' }
      if (result.failure.errorCode === 429 && result.failure.retryAfterSeconds !== undefined) {
        return {
          kind: 'rate-limited',
          retryAfterMs: result.failure.retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS
            ? result.failure.retryAfterSeconds * 1_000
            : MAX_RETRY_AFTER_SECONDS * 1_000 + 1,
        }
      }
      return { kind: 'rejected', code: `telegram_${result.failure.errorCode}` }
    } catch (error) {
      if (!signal.aborted) this.observeTransportFailure()
      throw error
    }
  }

  private async requestApproval(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    if (request.signal?.aborted === true) return 'cancelled'
    const destination = this.latestDestination.get(request.agent)
    if (destination === undefined) return next()
    const nonce = randomBytes(9).toString('base64url')
    const sent = await this.api.sendText({
      chatId: Number(destination.route.conversationId),
      text: boundText(`Approval required\nTool: ${request.toolName}${request.reason === undefined ? '' : `\nReason: ${request.reason}`}`, this.config.maxTextChars),
      replyMarkup: {
        inline_keyboard: [[
          { text: 'Allow once', callback_data: `dsh:a:${nonce}:allow` },
          { text: 'Reject', callback_data: `dsh:a:${nonce}:reject` },
        ]],
      },
    }, this.lifecycle.signal)
    if (!sent.ok) return next()
    return new Promise<ApprovalOutcome>(resolve => {
      const settle = (outcome: ApprovalOutcome): void => {
        if (!this.pendingApprovals.delete(nonce)) return
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => settle('cancelled')
      this.pendingApprovals.set(nonce, {
        destination,
        resolve,
        onAbort,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private requireOutbound(): GatewayTextAdapterRegistration {
    if (this.outbound === undefined) throw new Error('dsh-telegram: Gateway outbound is unavailable')
    return this.outbound
  }

  private observeTransportActivity(activity: boolean): void {
    const observedAt = Date.now()
    this.connectedAt ??= observedAt
    if (activity) {
      this.lastInboundAt = observedAt
      this.lastActivityAt = observedAt
    }
    this.transportState = 'ready'
    this.reportTransport(observedAt)
  }

  private observeTransportFailure(): void {
    this.transportState = 'degraded'
    this.lastErrorAt = Date.now()
    this.reportTransport(this.lastErrorAt)
  }

  private reportTransport(observedAt: number): void {
    this.transport?.report({
      state: this.transportState,
      observedAt,
      ...(this.connectedAt === undefined ? {} : { connectedAt: this.connectedAt }),
      ...(this.lastInboundAt === undefined ? {} : { lastInboundAt: this.lastInboundAt }),
      ...(this.lastActivityAt === undefined ? {} : { lastActivityAt: this.lastActivityAt }),
      ...(this.lastErrorAt === undefined ? {} : { lastErrorAt: this.lastErrorAt }),
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
}

function boundText(value: string, maxChars: number): string {
  const text = value.length === 0 ? '(no output)' : value
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await wait(ms, undefined, { signal })
  } catch {
    // Abort is expected when the owning Cordis fiber is disposed.
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown failure'
}

function canonicalTelegramMessageId(value: string): number | undefined {
  if (!/^[1-9][0-9]*$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : undefined
}
