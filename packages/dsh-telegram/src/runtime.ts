import { randomBytes } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { GatewayIngressUncertainError, type DshGateway } from 'dsh-gateway'
import {
  selectApprovalCallback,
  selectInboundUpdate,
} from './inbound.js'
import {
  openTelegramDeliveryStore,
  type TelegramDeliveryRecord,
  type TelegramDeliveryStore,
} from './delivery-store.js'
import { outboundTextForTurn } from './outbound.js'
import { TelegramApi, type TelegramUpdate } from './telegram-api.js'
import type { TelegramHostNotice, TelegramHostNoticeReceipt } from './host-route.js'
import type { ResolvedTelegramConfig } from './config.js'

const EMPTY_POLL_DELAY_MS = 100
const POLL_FAILURE_DELAY_MS = 1_000
const MAX_RETRY_AFTER_SECONDS = 300
const MAX_PENDING_REPLY_CORRELATIONS = 10_000

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
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly scheduled = new Set<string>()
  private readonly bound = new WeakSet<Agent>()
  private pollTask?: Promise<void>
  private deliveryTail: Promise<void> = Promise.resolve()
  private agent: Agent | undefined

  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedTelegramConfig,
    private readonly gateway: DshGateway,
    private readonly api: TelegramApi,
    private readonly store: TelegramDeliveryStore,
  ) {}

  async start(): Promise<void> {
    await this.store.recoverInflight(Date.now())
    this.bind(await this.gateway.resolve(this.config.routeId, this.lifecycle.signal))

    this.ctx.on('agent/created', ({ agent }) => {
      if (String(agent.id) !== this.config.sessionId) return
      void this.gateway.resolve(this.config.routeId, this.lifecycle.signal).then((resolved) => {
        if (resolved === agent) this.bind(resolved)
      }).catch((error: unknown) => {
        if (!this.lifecycle.signal.aborted) {
          this.ctx.logger.warn(`dsh-telegram: rejected replacement Agent: ${safeMessage(error)}`)
        }
      })
    })
    this.ctx.on('agent/disposed', ({ agent }) => {
      if (this.agent === agent) this.agent = undefined
    })
    this.ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      if (agent !== this.agent) return
      const messageId = String(message.id)
      const reply = this.repliesByMessage.get(messageId)
      if (reply !== undefined) {
        this.repliesByMessage.delete(messageId)
        this.repliesByTurn.set(turn, reply)
      }
    })
    this.ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
      if (agent !== this.agent) return
      const text = outboundTextForTurn(agent.session.events, turn, this.config.maxTextChars)
      if (text === undefined) return
      await this.store.prepareTurn({
        now: Date.now(),
        sessionId: String(agent.session.id),
        turn,
        ...(this.repliesByTurn.get(turn) === undefined
          ? {}
          : { replyToMessageId: this.repliesByTurn.get(turn)! }),
      })
    })
    this.ctx.on('session/event', (session, event) => {
      if (session !== this.agent?.session || event.type !== 'turn/end') return
      this.repliesByTurn.delete(event.data.turn)
      this.enqueuePending()
    })
    this.ctx.on('approval/request', (request, next) => {
      if (request.agent !== this.agent) return next()
      return this.requestApproval(request, next)
    })

    this.enqueuePending()
    this.pollTask = this.poll()
  }

  async dispose(): Promise<void> {
    this.lifecycle.abort(new Error('dsh-telegram disposed'))
    for (const [nonce, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(nonce)
      if (pending.onAbort !== undefined) pending.signal?.removeEventListener('abort', pending.onAbort)
      pending.resolve('cancelled')
    }
    await Promise.allSettled([this.pollTask, this.deliveryTail])
    await this.store.close()
  }

  async notifyHost(notice: TelegramHostNotice): Promise<TelegramHostNoticeReceipt> {
    if (!/^[a-f0-9]{64}$/u.test(notice.id)) {
      throw new Error('dsh-telegram: host notice id must be a SHA-256 hex digest')
    }
    if (notice.text.length === 0) {
      throw new Error('dsh-telegram: host notice text must be non-empty')
    }
    const prepared = await this.store.prepareNotice({
      id: notice.id,
      now: Date.now(),
      sessionId: this.config.sessionId,
      text: boundText(notice.text, this.config.maxTextChars),
    })
    this.enqueue(prepared.record.id)
    return { created: prepared.created, status: prepared.record.status }
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
          const counts = { prepared: 0, sending: 0, retrying: 0, delivered: 0, uncertain: 0, failed: 0 }
          for (const record of this.store.list()) counts[record.status] += 1
          return {
            kind: 'success',
            text: [
              `Telegram route: READY (Gateway ${this.config.routeId}, session ${this.config.sessionId}, one private chat).`,
              `Retained delivery: ${counts.delivered} delivered; ${counts.prepared + counts.sending + counts.retrying} pending; ${counts.uncertain} uncertain; ${counts.failed} failed.`,
              'Model surface: 0 tools, 0 prompt sections, 0 skills.',
            ].join('\n'),
          }
        },
      }))
    this.enqueuePending()
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
        for (const update of updates) {
          await this.handleUpdate(update)
          if (Number.isSafeInteger(update.update_id) && update.update_id >= offset) {
            offset = update.update_id + 1
          }
        }
        if (updates.length === 0) await delay(EMPTY_POLL_DELAY_MS, this.lifecycle.signal)
      } catch {
        if (this.lifecycle.signal.aborted) return
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
    const prepared = await this.store.prepareCommand({
      now: Date.now(),
      replyToMessageId,
      sessionId: this.config.sessionId,
      text: bounded,
      updateId,
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
        this.ctx.logger.warn(`dsh-telegram: delivery worker failed: ${safeMessage(error)}`)
      },
    )
  }

  private async deliver(id: string): Promise<void> {
    let record = this.store.get(id)
    if (record === undefined || !['prepared', 'retrying'].includes(record.status)) return
    if (record.source.kind === 'turn') {
      const agent = this.agent
      if (agent === undefined || String(agent.session.id) !== record.sessionId
        || !turnEnded(agent.session.events, record.source.turn)) return
    }
    if (record.status === 'retrying' && record.nextAttemptAt !== undefined) {
      await delay(Math.max(0, record.nextAttemptAt - Date.now()), this.lifecycle.signal)
      if (this.lifecycle.signal.aborted) return
      record = this.store.get(id)
      if (record === undefined || record.status !== 'retrying') return
    }
    const text = this.textFor(record)
    if (text === undefined) {
      await this.store.markLocallyFailed(id, 'The referenced DSH turn has no final assistant text.', Date.now())
      return
    }
    const sending = await this.store.markSending(id, Date.now())
    const result = await this.api.sendText({
      chatId: this.config.chatId,
      text,
      ...(sending.replyToMessageId === undefined ? {} : { replyToMessageId: sending.replyToMessageId }),
    }, this.lifecycle.signal)
    if (result.ok) {
      await this.store.markDelivered(id, result.messageId, Date.now())
      return
    }
    if (result.failure.kind === 'telegram-rejected'
      && result.failure.errorCode === 429
      && (result.failure.retryAfterSeconds ?? 0) > MAX_RETRY_AFTER_SECONDS) {
      await this.store.markFailure(
        id,
        { kind: 'telegram-rejected', errorCode: 429 },
        Date.now(),
        this.config.maxSendAttempts,
      )
      return
    }
    await this.store.markFailure(id, result.failure, Date.now(), this.config.maxSendAttempts)
  }

  private textFor(record: TelegramDeliveryRecord): string | undefined {
    if (record.source.kind === 'command' || record.source.kind === 'notice') {
      return record.source.text
    }
    const agent = this.agent
    if (agent === undefined || String(agent.session.id) !== record.sessionId) return undefined
    return outboundTextForTurn(agent.session.events, record.source.turn, this.config.maxTextChars)
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

export function turnEnded(events: readonly SessionEvent[], turn: number): boolean {
  return events.some(event => event.type === 'turn/end' && event.data.turn === turn)
}
