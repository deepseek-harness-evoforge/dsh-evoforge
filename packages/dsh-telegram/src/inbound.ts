export interface TelegramRouteIdentity {
  readonly chatId: number
  readonly userId: number
}

export type InboundSelection =
  | { readonly kind: 'ignored'; readonly updateId: number }
  | {
      readonly kind: 'message'
      readonly replyToMessageId: number
      readonly text: string
      readonly updateId: number
    }

/** A platform message before Gateway authorization. No user text is synthesized. */
export type TelegramMessageSelection =
  | { readonly kind: 'ignored'; readonly updateId: number }
  | {
      readonly kind: 'message' | 'unsupported'
      readonly updateId: number
      readonly messageId: number
      readonly chatId: number
      readonly userId: number
      readonly chatKind: 'direct' | 'group'
      readonly text?: string
    }

export type ApprovalCallbackSelection =
  | { readonly kind: 'ignored'; readonly updateId: number }
  | {
      readonly kind: 'approval-callback'
      readonly callbackQueryId: string
      readonly nonce: string
      readonly outcome: 'allowed-once' | 'rejected'
      readonly updateId: number
    }

export type TelegramApprovalCallback =
  | { readonly kind: 'ignored'; readonly updateId: number }
  | {
      readonly kind: 'approval-callback'
      readonly updateId: number
      readonly callbackQueryId: string
      readonly nonce: string
      readonly outcome: 'allowed-once' | 'rejected'
      readonly chatId: number
      readonly userId: number
    }

interface TelegramMessageUpdate {
  readonly update_id: number
  readonly message?: unknown
}

interface TelegramCallbackUpdate {
  readonly update_id: number
  readonly callback_query?: unknown
}

/** Select only one deployment-authorized private-chat text update. */
export function selectInboundUpdate(
  input: TelegramMessageUpdate,
  route: TelegramRouteIdentity,
): InboundSelection {
  const updateId = input.update_id
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error('Telegram update_id must be a non-negative safe integer')
  }
  const message = isRecord(input.message) ? input.message : undefined
  const chat = isRecord(message?.chat) ? message.chat : undefined
  const from = isRecord(message?.from) ? message.from : undefined
  const messageId = message?.message_id
  const authorized = chat?.type === 'private'
    && chat.id === route.chatId
    && from?.id === route.userId
    && from.is_bot === false
    && Number.isSafeInteger(messageId)
    && (messageId as number) > 0
  if (!authorized || typeof message?.text !== 'string' || message.text.length === 0) {
    return { kind: 'ignored', updateId }
  }
  return {
    kind: 'message',
    replyToMessageId: messageId as number,
    text: message.text,
    updateId,
  }
}

/**
 * Select a well-formed Telegram message without applying a static route.
 * Pairing mode uses this only to construct an exact Gateway endpoint; the
 * Gateway remains the sole authorization and Session authority.
 */
export function selectTelegramMessage(input: TelegramMessageUpdate): TelegramMessageSelection {
  const updateId = input.update_id
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error('Telegram update_id must be a non-negative safe integer')
  }
  const message = isRecord(input.message) ? input.message : undefined
  const chat = isRecord(message?.chat) ? message.chat : undefined
  const from = isRecord(message?.from) ? message.from : undefined
  const messageId = message?.message_id
  const chatId = chat?.id
  const userId = from?.id
  const chatKind = chat?.type === 'private' ? 'direct' : 'group'
  const validIdentity = from?.is_bot === false
    && Number.isSafeInteger(messageId) && (messageId as number) > 0
    && Number.isSafeInteger(chatId) && Number.isSafeInteger(userId)
    && (chatId as number) !== 0 && (userId as number) > 0
  if (!validIdentity) return { kind: 'ignored', updateId }
  if (chatKind !== 'direct') {
    return {
      kind: 'unsupported', updateId, messageId: messageId as number,
      chatId: chatId as number, userId: userId as number, chatKind,
    }
  }
  if (typeof message?.text === 'string' && message.text.length > 0) {
    return {
      kind: 'message', updateId, messageId: messageId as number,
      chatId: chatId as number, userId: userId as number, chatKind, text: message.text,
    }
  }
  return {
    kind: 'unsupported', updateId, messageId: messageId as number,
    chatId: chatId as number, userId: userId as number, chatKind,
  }
}

/** Select a bounded one-shot approval callback from the same authorized route. */
export function selectApprovalCallback(
  input: TelegramCallbackUpdate,
  route: TelegramRouteIdentity,
): ApprovalCallbackSelection {
  const updateId = input.update_id
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error('Telegram update_id must be a non-negative safe integer')
  }
  const callback = isRecord(input.callback_query) ? input.callback_query : undefined
  const from = isRecord(callback?.from) ? callback.from : undefined
  const message = isRecord(callback?.message) ? callback.message : undefined
  const chat = isRecord(message?.chat) ? message.chat : undefined
  const data = callback?.data
  const callbackId = callback?.id
  const authorized = chat?.type === 'private'
    && chat.id === route.chatId
    && from?.id === route.userId
    && from.is_bot === false
    && typeof callbackId === 'string'
    && callbackId.length > 0
    && typeof data === 'string'
    && Buffer.byteLength(data, 'utf8') <= 64
  if (!authorized) return { kind: 'ignored', updateId }
  const match = /^dsh:a:([A-Za-z0-9_-]{1,32}):(allow|reject)$/u.exec(data)
  if (match === null) return { kind: 'ignored', updateId }
  return {
    kind: 'approval-callback',
    callbackQueryId: callbackId as string,
    nonce: match[1]!,
    outcome: match[2] === 'allow' ? 'allowed-once' : 'rejected',
    updateId,
  }
}

/** Parse a callback without a static route so pairing mode can verify it against its pending approval. */
export function selectTelegramApprovalCallback(input: TelegramCallbackUpdate): TelegramApprovalCallback {
  const updateId = input.update_id
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new Error('Telegram update_id must be a non-negative safe integer')
  }
  const callback = isRecord(input.callback_query) ? input.callback_query : undefined
  const from = isRecord(callback?.from) ? callback.from : undefined
  const message = isRecord(callback?.message) ? callback.message : undefined
  const chat = isRecord(message?.chat) ? message.chat : undefined
  const data = callback?.data
  const callbackId = callback?.id
  const chatId = chat?.id
  const userId = from?.id
  if (chat?.type !== 'private' || from?.is_bot !== false
    || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId)
    || (chatId as number) === 0 || (userId as number) <= 0
    || typeof callbackId !== 'string' || callbackId.length === 0
    || typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 64) {
    return { kind: 'ignored', updateId }
  }
  const match = /^dsh:a:([A-Za-z0-9_-]{1,32}):(allow|reject)$/u.exec(data)
  if (match === null) return { kind: 'ignored', updateId }
  return {
    kind: 'approval-callback', updateId, callbackQueryId: callbackId as string,
    nonce: match[1]!, outcome: match[2] === 'allow' ? 'allowed-once' : 'rejected',
    chatId: chatId as number, userId: userId as number,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
