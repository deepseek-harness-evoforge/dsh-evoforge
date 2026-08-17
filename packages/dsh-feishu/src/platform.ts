import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  LarkChannelError,
  type CardActionEvent,
  type NormalizedMessage,
} from '@larksuiteoapi/node-sdk'

export interface FeishuInboundMessage {
  readonly messageId: string
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly senderId: string
  readonly content: string
  readonly rawContentType: string
  readonly threadId?: string
}

export interface FeishuApprovalAction {
  readonly messageId: string
  readonly chatId: string
  readonly operatorId: string
  readonly value: unknown
}

export interface FeishuSendOptions {
  readonly replyTo?: string
  readonly replyInThread?: boolean
}

export interface FeishuPlatform {
  onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): () => void
  onApprovalAction(handler: (action: FeishuApprovalAction) => Promise<void>): () => void
  onError(handler: (error: unknown) => void): () => void
  connect(): Promise<void>
  disconnect(): Promise<void>
  sendText(chatId: string, text: string, options?: FeishuSendOptions): Promise<{ readonly messageId: string }>
  sendCard(chatId: string, card: object): Promise<{ readonly messageId: string }>
}

export interface FeishuPlatformOptions {
  readonly appId: string
  readonly appSecret: string
  readonly handshakeTimeoutMs: number
  readonly allowedChats: readonly string[]
  readonly allowedUsers: readonly string[]
}

export class FeishuPlatformSendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'FeishuPlatformSendError'
  }
}

/** Official Feishu WebSocket transport, narrowed behind an Adapter-owned port. */
export function createOfficialFeishuPlatform(options: FeishuPlatformOptions): FeishuPlatform {
  const channel = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    domain: Domain.Feishu,
    transport: 'websocket',
    source: 'dsh-feishu',
    loggerLevel: LoggerLevel.warn,
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    includeRawEvent: false,
    policy: {
      dmMode: 'allowlist',
      dmAllowlist: [...options.allowedUsers],
      groupAllowlist: [...options.allowedChats],
      requireMention: true,
      respondToMentionAll: false,
    },
    safety: {
      // Router StorageDomain ingress is the durable idempotency authority.
      dedup: { ttl: 0, maxEntries: 1, sweepIntervalMs: 60_000 },
      staleMessageWindowMs: Number.MAX_SAFE_INTEGER,
      chatQueue: { enabled: true },
      batch: { text: { delayMs: 0, longDelayMs: 0, maxMessages: 1, maxChars: 30_000 } },
    },
    // Delivery state belongs to this Adapter; SDK-level retries would obscure uncertainty.
    outbound: { retry: { maxAttempts: 1 } },
  })
  const platform: FeishuPlatform = {
    onMessage: handler => channel.on('message', message => handler(selectMessage(message))),
    onApprovalAction: handler => channel.on('cardAction', action => handler(selectAction(action))),
    onError: handler => channel.on('error', handler),
    connect: () => channel.connect(),
    disconnect: () => channel.disconnect(),
    sendText: async (chatId, text, sendOptions) => translateSendFailure(() => channel.send(
        chatId,
        { text },
        sendOptions === undefined ? undefined : {
          ...(sendOptions.replyTo === undefined ? {} : { replyTo: sendOptions.replyTo }),
          ...(sendOptions.replyInThread === undefined ? {} : { replyInThread: sendOptions.replyInThread }),
        },
      )),
    sendCard: (chatId, card) => translateSendFailure(() => channel.send(chatId, { card })),
  }
  return Object.freeze(platform)
}

async function translateSendFailure(
  send: () => Promise<{ messageId: string }>,
): Promise<{ messageId: string }> {
  try {
    return await send()
  } catch (error: unknown) {
    if (error instanceof LarkChannelError) {
      throw new FeishuPlatformSendError(
        error.code,
        error.message,
        error.code === 'rate_limited' ? 1_000 : undefined,
        { cause: error },
      )
    }
    throw new FeishuPlatformSendError('transport', 'Feishu transport failed', undefined, { cause: error })
  }
}

function selectMessage(message: NormalizedMessage): FeishuInboundMessage {
  return Object.freeze({
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    content: message.content,
    rawContentType: message.rawContentType,
    ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
  })
}

function selectAction(action: CardActionEvent): FeishuApprovalAction {
  return Object.freeze({
    messageId: action.messageId,
    chatId: action.chatId,
    operatorId: action.operator.openId,
    value: action.action.value,
  })
}
