import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  LarkChannelError,
  type CardActionEvent,
  type HttpInstance,
  type NormalizedMessage,
} from '@larksuiteoapi/node-sdk'
import axios, { type AxiosInstance } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'

const FEISHU_API_URL = 'https://open.feishu.cn/'

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

export interface FeishuPairingPlatformOptions {
  readonly appId: string
  readonly appSecret: string
  readonly handshakeTimeoutMs: number
}

interface FeishuPolicy {
  readonly dmMode: 'open' | 'allowlist'
  readonly dmAllowlist?: string[]
  readonly groupAllowlist?: string[]
  readonly requireMention: boolean
  readonly respondToMentionAll: boolean
}

interface FeishuTransport {
  readonly httpInstance: AxiosInstance & HttpInstance
  readonly agent?: HttpsProxyAgent<string>
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
  return createOfficialPlatform(options, {
    dmMode: 'allowlist',
    dmAllowlist: [...options.allowedUsers],
    groupAllowlist: [...options.allowedChats],
    requireMention: true,
    respondToMentionAll: false,
  })
}

/** Setup-only transport; the pairing runtime adds the high-entropy one-message gate. */
export function createOfficialFeishuPairingPlatform(options: FeishuPairingPlatformOptions): FeishuPlatform {
  return createOfficialPlatform(options, {
    dmMode: 'open',
    requireMention: true,
    respondToMentionAll: false,
  })
}

function createOfficialPlatform(
  options: FeishuPairingPlatformOptions,
  policy: FeishuPolicy,
): FeishuPlatform {
  const transport = resolveFeishuTransport()
  const channel = createLarkChannel({
    appId: options.appId,
    appSecret: options.appSecret,
    domain: Domain.Feishu,
    transport: 'websocket',
    source: 'dsh-feishu',
    loggerLevel: LoggerLevel.warn,
    httpInstance: transport.httpInstance,
    ...(transport.agent === undefined ? {} : { agent: transport.agent }),
    handshakeTimeoutMs: options.handshakeTimeoutMs,
    includeRawEvent: false,
    policy,
    safety: {
      // Gateway StorageDomain ingress is the durable idempotency authority.
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

/** Process-local proxy adaptation; never mutates deployment environment or global agents. */
export function resolveFeishuTransport(
  environment: NodeJS.ProcessEnv = process.env,
): FeishuTransport {
  const proxyUrl = selectHttpsProxy(environment, FEISHU_API_URL)
  if (proxyUrl === undefined) {
    return Object.freeze({ httpInstance: createFeishuHttpInstance() })
  }
  let parsed: URL
  try {
    parsed = new URL(proxyUrl)
  } catch {
    throw new Error('dsh-feishu: HTTPS proxy environment must contain a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('dsh-feishu: HTTPS proxy environment must use http or https')
  }
  const agent = new HttpsProxyAgent(parsed)
  return Object.freeze({
    agent,
    httpInstance: createFeishuHttpInstance(agent),
  })
}

function createFeishuHttpInstance(agent?: HttpsProxyAgent<string>): AxiosInstance & HttpInstance {
  const instance = axios.create({
    proxy: false,
    ...(agent === undefined ? {} : { httpsAgent: agent }),
  })
  instance.interceptors.response.use((response) => {
    const config = response.config as typeof response.config & { $return_headers?: boolean }
    return config.$return_headers === true
      ? { data: response.data, headers: response.headers }
      : response.data
  })
  return instance as AxiosInstance & HttpInstance
}

function selectHttpsProxy(environment: NodeJS.ProcessEnv, target: string): string | undefined {
  const url = new URL(target)
  if (bypassesProxy(url.hostname, Number(url.port) || 443, firstPopulated(
    environment.no_proxy,
    environment.NO_PROXY,
  ))) {
    return undefined
  }
  const value = firstPopulated(
    environment.https_proxy,
    environment.HTTPS_PROXY,
    environment.all_proxy,
    environment.ALL_PROXY,
  )
  if (value === undefined) return undefined
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('dsh-feishu: HTTPS proxy environment must contain a valid URL')
  }
  return value.includes('://') ? value : `https://${value}`
}

function firstPopulated(...values: readonly (string | undefined)[]): string | undefined {
  return values.find(value => value !== undefined && value.length > 0)
}

function bypassesProxy(hostname: string, port: number, noProxy: string | undefined): boolean {
  if (noProxy === undefined || noProxy.length === 0) return false
  if (noProxy.trim() === '*') return true
  return noProxy.toLowerCase().split(/[,\s]+/u).some((entry) => {
    if (entry.length === 0) return false
    const match = /^(.*?)(?::(\d+))?$/u.exec(entry)
    if (match === null) return false
    const rulePort = match[2] === undefined ? undefined : Number(match[2])
    if (rulePort !== undefined && rulePort !== port) return false
    const rule = match[1]!.startsWith('*') ? match[1]!.slice(1) : match[1]!
    return rule.startsWith('.') ? hostname.endsWith(rule) : hostname === rule
  })
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
