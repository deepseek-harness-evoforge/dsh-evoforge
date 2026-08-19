type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type TelegramSendFailure =
  | { readonly kind: 'transport' }
  | { readonly kind: 'invalid-response' }
  | {
      readonly kind: 'telegram-rejected'
      readonly errorCode: number
      readonly retryAfterSeconds?: number
    }

export interface TelegramUpdate {
  readonly update_id: number
  readonly message?: unknown
  readonly callback_query?: unknown
}

export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly {
    readonly text: string
    readonly callback_data: string
  }[])[]
}

export interface SendTextInput {
  readonly chatId: number
  readonly text: string
  readonly replyToMessageId?: number
  readonly replyMarkup?: InlineKeyboardMarkup
}

export type SendTextResult =
  | { readonly ok: true; readonly messageId: number }
  | { readonly ok: false; readonly failure: TelegramSendFailure }

interface TelegramEnvelope {
  readonly ok?: unknown
  readonly result?: unknown
  readonly error_code?: unknown
  readonly parameters?: unknown
}

class TelegramInvalidResponseError extends Error {}

/** Minimal dependency-free Telegram Bot API client. */
export class TelegramApi {
  private readonly base: string
  private readonly fetch: FetchLike

  constructor(options: { readonly token: string; readonly apiBase: string; readonly fetch?: FetchLike }) {
    if (options.token.length === 0) throw new Error('Telegram token must not be empty')
    if (options.apiBase.trim() !== options.apiBase || options.apiBase.length === 0) {
      throw new Error('Telegram apiBase must be a non-empty trimmed URL')
    }
    this.base = `${options.apiBase.replace(/\/$/u, '')}/bot${options.token}`
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async getUpdates(offset: number, timeoutSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const envelope = await this.call('getUpdates', {
      allowed_updates: ['message', 'callback_query'],
      limit: 100,
      offset,
      timeout: timeoutSeconds,
    }, signal)
    if (envelope.ok !== true || !Array.isArray(envelope.result)) {
      throw new Error('Telegram getUpdates returned no valid update array')
    }
    return envelope.result as TelegramUpdate[]
  }

  async sendText(input: SendTextInput, signal: AbortSignal): Promise<SendTextResult> {
    let envelope: TelegramEnvelope
    try {
      envelope = await this.call('sendMessage', {
        chat_id: input.chatId,
        ...input.replyToMessageId === undefined
          ? {}
          : {
              reply_parameters: {
                allow_sending_without_reply: true,
                message_id: input.replyToMessageId,
              },
            },
        ...input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup },
        text: input.text,
      }, signal)
    } catch (error) {
      return {
        ok: false,
        failure: { kind: error instanceof TelegramInvalidResponseError ? 'invalid-response' : 'transport' },
      }
    }
    if (envelope.ok === true && isRecord(envelope.result)) {
      const messageId = envelope.result.message_id
      if (Number.isSafeInteger(messageId) && (messageId as number) > 0) {
        return { ok: true, messageId: messageId as number }
      }
      return { ok: false, failure: { kind: 'invalid-response' } }
    }
    if (envelope.ok === false && Number.isSafeInteger(envelope.error_code)) {
      const retryAfter = isRecord(envelope.parameters) ? envelope.parameters.retry_after : undefined
      return {
        ok: false,
        failure: {
          kind: 'telegram-rejected',
          errorCode: envelope.error_code as number,
          ...Number.isSafeInteger(retryAfter) && (retryAfter as number) > 0
            ? { retryAfterSeconds: retryAfter as number }
            : {},
        },
      }
    }
    return { ok: false, failure: { kind: 'invalid-response' } }
  }

  async answerCallback(callbackQueryId: string, signal: AbortSignal): Promise<boolean> {
    try {
      const envelope = await this.call('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
      }, signal)
      return envelope.ok === true && envelope.result === true
    } catch {
      return false
    }
  }

  private async call(method: string, body: unknown, signal: AbortSignal): Promise<TelegramEnvelope> {
    const response = await this.fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      throw new TelegramInvalidResponseError(`Telegram ${method} returned invalid JSON`)
    }
    if (!isRecord(parsed)) throw new TelegramInvalidResponseError(`Telegram ${method} returned an invalid envelope`)
    return parsed
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
