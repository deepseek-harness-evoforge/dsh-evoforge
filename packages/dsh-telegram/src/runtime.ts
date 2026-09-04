import { randomBytes } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import {
  GatewayIngressUncertainError,
  type DshGateway,
  type GatewayOutboundSendInput,
  type GatewayOutboundSendResult,
  type GatewayTextAdapterRegistration,
  type GatewayTextDeliveryIntent,
  type GatewayTransportRegistration,
  type GatewayTransportState,
} from 'dsh-evoforge-gateway'
import { sessionEvents } from 'dsh-evoforge-gateway'
import {
  selectApprovalCallback,
  selectInboundUpdate,
} from './inbound.js'
import { outboundTextForTurn } from './outbound.js'
import { TelegramApi, type TelegramUpdate } from './telegram-api.js'
import type { TelegramHostNotice, TelegramHostNoticeReceipt } from './host-route.js'
import type { ResolvedTelegramConfig } from './config.js'

const EMPTY_POLL_DELAY_MS = 100
const POLL_FAILURE_DELAY_MS = 1_000
const MAX_RETRY_AFTER_SECONDS = 300
const MAX_PENDING_REPLY_CORRELATIONS = 10_000
const PLATFORM_SEND_TIMEOUT_MS = 30_000

interface PendingApproval {
  readonly resolve: (outcome: ApprovalOutcome) => void
  readonly signal?: AbortSignal
  readonly onAbort?: () => void
}

/** One thin, fixed-route Telegram adapter. It contributes no model-visible surface. */
export class TelegramRuntime {
  private readonly lifecycle = new AbortController()
  private readonly repliesByMessage = new Map<string, number>()
  private readonly repliesByTurn = new Map<number, number>()
  private readonly outboundByTurn = new Map<number, GatewayTextDeliveryIntent>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly bound = new WeakSet<Agent>()
  private readonly unsubscribers: Array<() => void> = []
  private pollTask?: Promise<void>
  private outbound?: GatewayTextAdapterRegistration
  private transport: GatewayTransportRegistration | undefined
  private transportState: GatewayTransportState = 'connecting'
  private connectedAt?: number
  private lastInboundAt?: number
  private lastActivityAt?: number
  private lastErrorAt?: number
  private agent: Agent | undefined
  private started = false
  private disposed = false
  private disposing: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedTelegramConfig,
    private readonly gateway: DshGateway,
    private readonly api: TelegramApi,
  ) {}

  async start(): Promise<void> {
    if (this.disposed) throw new Error('dsh-telegram: runtime is already disposed')
    if (this.started) return
    const agent = await this.gateway.resolve(this.config.routeId, this.lifecycle.signal)
    this.started = true
    try {
      this.transport = this.gateway.registerTransport({
      adapter: 'telegram',
      accountId: this.config.endpoint.accountId,
      kind: 'telegram-long-poll',
      routeIds: [this.config.routeId],
      initial: { state: 'connecting', observedAt: Date.now() },
      })
      this.outbound = this.gateway.registerTextAdapter({
      adapter: 'telegram',
      accountId: this.config.endpoint.accountId,
      routeIds: [this.config.routeId],
      maxAttempts: this.config.maxSendAttempts,
      maxRetryAfterMs: MAX_RETRY_AFTER_SECONDS * 1_000,
      sendTimeoutMs: PLATFORM_SEND_TIMEOUT_MS,
      send: (input, signal) => this.sendOutbound(input, signal),
      })
      this.bind(agent)

      this.unsubscribers.push(this.ctx.on('agent/created', ({ agent }) => {
      if (String(agent.id) !== this.config.sessionId) return
      void this.gateway.resolve(this.config.routeId, this.lifecycle.signal).then((resolved) => {
        if (resolved === agent) this.bind(resolved)
      }).catch((error: unknown) => {
        if (!this.lifecycle.signal.aborted) {
          this.ctx.logger.warn(`dsh-telegram: rejected replacement Agent: ${safeMessage(error)}`)
        }
      })
      }))
      this.unsubscribers.push(this.ctx.on('agent/disposed', ({ agent }) => {
      if (this.agent === agent) this.agent = undefined
      }))
      this.unsubscribers.push(this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (agent !== this.agent) return
      const messageId = String(message.id)
      const reply = this.repliesByMessage.get(messageId)
      if (reply !== undefined) {
        this.repliesByMessage.delete(messageId)
        this.repliesByTurn.set(turn, reply)
      }
      }))
      this.unsubscribers.push(this.ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      if (agent !== this.agent) return
      const text = outboundTextForTurn(sessionEvents(agent.session), turn, this.config.maxTextChars)
      if (text === undefined) return
      const intent: GatewayTextDeliveryIntent = Object.freeze({
        routeId: this.config.routeId,
        kind: 'turn',
        intentKey: `turn:${turn}`,
        text,
        waitForTurnEnd: turn,
        ...(this.repliesByTurn.get(turn) === undefined
          ? {}
          : { replyToExternalId: String(this.repliesByTurn.get(turn)!) }),
      })
      this.outboundByTurn.set(turn, intent)
      await this.requireOutbound().submit(intent)
      }))
      this.unsubscribers.push(this.ctx.on('session/event', (session, event) => {
      if (session !== this.agent?.session || event.type !== 'turn/end') return
      this.repliesByTurn.delete(event.data.turn)
      const intent = this.outboundByTurn.get(event.data.turn)
      this.outboundByTurn.delete(event.data.turn)
      if (intent !== undefined) {
        void this.requireOutbound().submit(intent).catch((error: unknown) => {
          this.ctx.logger.warn(`dsh-telegram: could not release final answer: ${safeMessage(error)}`)
        })
      }
      }))
      this.unsubscribers.push(this.ctx.on('approval/request', (request, next) => {
      if (request.agent !== this.agent) return next()
      return this.requestApproval(request, next)
      }))

      this.pollTask = this.poll()
    } catch (error: unknown) {
      try {
        await this.dispose()
      } catch (cleanupError: unknown) {
        this.ctx.logger.warn(`dsh-telegram: startup cleanup failed: ${safeMessage(cleanupError)}`)
      }
      throw error
    }
  }

  dispose(): Promise<void> {
    if (this.disposing !== undefined) return this.disposing
    if (this.disposed) return Promise.resolve()
    const disposing = this.disposeInternal()
    this.disposing = disposing
    return disposing
  }

  private async disposeInternal(): Promise<void> {
    this.disposed = true
    this.transportState = 'stopping'
    try {
      this.reportTransport(Date.now())
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-telegram: teardown health report failed: ${safeMessage(error)}`)
    }
    this.lifecycle.abort(new Error('dsh-telegram disposed'))
    while (this.unsubscribers.length > 0) {
      try {
        this.unsubscribers.pop()?.()
      } catch (error: unknown) {
        this.ctx.logger.warn(`dsh-telegram: teardown listener removal failed: ${safeMessage(error)}`)
      }
    }
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.resolve('cancelled')
    }
    await Promise.allSettled([this.pollTask, this.outbound?.dispose()])
    try {
      this.transport?.dispose()
    } catch (error: unknown) {
      this.ctx.logger.warn(`dsh-telegram: transport teardown failed: ${safeMessage(error)}`)
    }
    this.transport = undefined
  }

  async notifyHost(notice: TelegramHostNotice): Promise<TelegramHostNoticeReceipt> {
    if (!/^[a-f0-9]{64}$/u.test(notice.id)) {
      throw new Error('dsh-telegram: host notice id must be a SHA-256 hex digest')
    }
    if (notice.text.length === 0) {
      throw new Error('dsh-telegram: host notice text must be non-empty')
    }
    const prepared = await this.requireOutbound().submit({
      routeId: this.config.routeId,
      kind: 'notice',
      intentKey: `notice:${notice.id}`,
      text: boundText(notice.text, this.config.maxTextChars),
    })
    return { created: prepared.created, status: prepared.status }
  }

  private bind(agent: Agent): void {
    this.agent = agent
    if (this.bound.has(agent)) return
    this.bound.add(agent)
    agent.ctx.inject(['commands'], commandCtx => commandCtx.commands.register({
        name: 'telegram',
        description: 'inspect the fixed Telegram route and durable delivery state',
        recordInput: false,
        handler: ({ rawInput }) => {
          if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /telegram' }
          const health = this.gateway.healthSnapshot(Date.now(), [this.config.routeId])
          const counts = health.outbound
          const transport = health.transports.items[0]
          return {
            kind: 'success',
            text: [
              `Telegram route: ${(transport?.state ?? 'unavailable').toUpperCase()} (Gateway ${this.config.routeId}, session ${this.config.sessionId}, one private chat).`,
              `Transport: ${transport?.kind ?? 'unavailable'}; lifecycle ${transport?.state ?? 'unavailable'}.`,
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
      if (this.agent === undefined) {
        try {
          this.bind(await this.gateway.resolve(this.config.routeId, this.lifecycle.signal))
        } catch (error: unknown) {
          if (this.lifecycle.signal.aborted) return
          this.ctx.logger.warn(`dsh-telegram: native route unavailable: ${safeMessage(error)}`)
          await delay(POLL_FAILURE_DELAY_MS, this.lifecycle.signal)
          continue
        }
      }
      try {
        const updates = await this.api.getUpdates(offset, this.config.pollTimeoutSeconds, this.lifecycle.signal)
        this.observeTransportActivity(updates.length > 0)
        for (const update of updates) {
          await this.handleUpdate(update)
          if (Number.isSafeInteger(update.update_id) && update.update_id >= offset) {
            offset = update.update_id + 1
          }
        }
        if (updates.length === 0) await delay(EMPTY_POLL_DELAY_MS, this.lifecycle.signal)
      } catch {
        if (this.lifecycle.signal.aborted) return
        this.transportState = 'degraded'
        this.lastErrorAt = Date.now()
        this.reportTransport(this.lastErrorAt)
        this.ctx.logger.warn('dsh-telegram: long poll failed; retrying after a bounded delay')
        await delay(POLL_FAILURE_DELAY_MS, this.lifecycle.signal)
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const callback = selectApprovalCallback(update, this.config)
    if (callback.kind === 'approval-callback') {
      const pending = this.pendingApprovals.get(callback.nonce)
      if (pending !== undefined) {
        this.pendingApprovals.delete(callback.nonce)
        if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
        pending.resolve(callback.outcome)
      }
      await this.api.answerCallback(callback.callbackQueryId, this.lifecycle.signal)
      return
    }

    const selected = selectInboundUpdate(update, this.config)
    if (selected.kind === 'ignored') return
    const eventId = `update:${selected.updateId}`
    const messageId = this.gateway.messageIdFor(this.config.endpoint, eventId)
    if (!this.repliesByMessage.has(messageId)
      && this.repliesByMessage.size >= MAX_PENDING_REPLY_CORRELATIONS) {
      throw new Error('dsh-telegram: pending reply correlation capacity is full')
    }
    this.repliesByMessage.set(messageId, selected.replyToMessageId)
    let dispatch: Awaited<ReturnType<DshGateway['dispatch']>>
    try {
      dispatch = await this.gateway.dispatch({
        endpoint: this.config.endpoint,
        eventId,
        text: selected.text,
        signal: this.lifecycle.signal,
      })
    } catch (error: unknown) {
      this.repliesByMessage.delete(messageId)
      if (!(error instanceof GatewayIngressUncertainError)) throw error
      this.ctx.logger.warn(`dsh-telegram: refusing uncertain ingress replay: ${safeMessage(error)}`)
      await this.prepareCommandResponse(
        selected.updateId,
        selected.replyToMessageId,
        'This Telegram request crossed an uncertain execution boundary and was not replayed. Send a new message to try again.',
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
    await this.prepareCommandResponse(selected.updateId, selected.replyToMessageId, text)
  }

  private async prepareCommandResponse(
    updateId: number,
    replyToMessageId: number,
    text: string,
  ): Promise<void> {
    const bounded = boundText(text, this.config.maxTextChars)
    await this.requireOutbound().submit({
      routeId: this.config.routeId,
      kind: 'response',
      intentKey: `response:update:${updateId}`,
      text: bounded,
      replyToExternalId: String(replyToMessageId),
    })
  }

  private async sendOutbound(
    input: GatewayOutboundSendInput,
    signal: AbortSignal,
  ): Promise<GatewayOutboundSendResult> {
    if (input.routeId !== this.config.routeId) return { kind: 'rejected', code: 'route_mismatch' }
    const replyToMessageId = input.replyToExternalId === undefined
      ? undefined
      : canonicalTelegramMessageId(input.replyToExternalId)
    if (input.replyToExternalId !== undefined && replyToMessageId === undefined) {
      return { kind: 'rejected', code: 'invalid_reply_identity' }
    }
    let result: Awaited<ReturnType<TelegramApi['sendText']>>
    try {
      result = await this.api.sendText({
        chatId: this.config.chatId,
        text: input.text,
        ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      }, signal)
      if (result.ok || result.failure.kind === 'telegram-rejected') this.observeTransportActivity(true)
      else this.observeTransportFailure()
    } catch (error) {
      if (!signal.aborted) this.observeTransportFailure()
      throw error
    }
    if (result.ok) return { kind: 'delivered', externalMessageId: String(result.messageId) }
    if (result.failure.kind !== 'telegram-rejected') return { kind: 'uncertain' }
    const retryAfterSeconds = result.failure.retryAfterSeconds
    if (result.failure.errorCode === 429 && retryAfterSeconds !== undefined) {
      return {
        kind: 'rate-limited',
        retryAfterMs: retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS
          ? retryAfterSeconds * 1_000
          : MAX_RETRY_AFTER_SECONDS * 1_000 + 1,
      }
    }
    return { kind: 'rejected', code: `telegram_${result.failure.errorCode}` }
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

  private observeTransportFailure(): void {
    this.transportState = 'degraded'
    this.lastErrorAt = Date.now()
    this.reportTransport(this.lastErrorAt)
  }

  private async requestApproval(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (request.signal?.aborted === true) return 'cancelled'
    const nonce = randomBytes(9).toString('base64url')
    const text = boundText(
      `Approval required\nTool: ${request.toolName}${request.reason === undefined ? '' : `\nReason: ${request.reason}`}`,
      this.config.maxTextChars,
    )
    const sent = await this.api.sendText({
      chatId: this.config.chatId,
      text,
      replyMarkup: {
        inline_keyboard: [[
          { text: 'Allow once', callback_data: `dsh:a:${nonce}:allow` },
          { text: 'Reject', callback_data: `dsh:a:${nonce}:reject` },
        ]],
      },
    }, this.lifecycle.signal)
    if (!sent.ok) return next()
    return new Promise<ApprovalOutcome>((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        if (!this.pendingApprovals.delete(nonce)) return
        request.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const onAbort = (): void => { settle('cancelled') }
      this.pendingApprovals.set(nonce, {
        resolve,
        onAbort,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      request.signal?.addEventListener('abort', onAbort, { once: true })
    })
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
    // Abort is the only expected failure; the owning loop checks its signal.
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
