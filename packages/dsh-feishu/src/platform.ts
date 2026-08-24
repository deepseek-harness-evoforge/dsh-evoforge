import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createLarkChannel,
  Domain,
  LoggerLevel,
  LarkChannelError,
  type CardActionEvent,
  type HttpInstance,
  type NormalizedMessage,
  type ResourceDescriptor,
} from '@larksuiteoapi/node-sdk'
import axios, { type AxiosInstance } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type {
  FeishuContentReadRequest,
  FeishuContentReadResult,
} from './content.js'

const FEISHU_API_URL = 'https://open.feishu.cn/'

export interface FeishuInboundMessage {
  readonly messageId: string
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly senderId: string
  readonly content: string
  readonly rawContentType: string
  readonly resources: readonly FeishuInboundResource[]
  readonly threadId?: string
}

export type FeishuInboundResource = Pick<
  ResourceDescriptor,
  'type' | 'fileKey' | 'fileName' | 'durationMs' | 'coverImageKey'
>

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
  sendText(
    chatId: string,
    text: string,
    options: FeishuSendOptions | undefined,
    signal: AbortSignal,
  ): Promise<{ readonly messageId: string }>
  sendCard(
    chatId: string,
    card: object,
    options: FeishuSendOptions | undefined,
    signal: AbortSignal,
  ): Promise<{ readonly messageId: string }>
  downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file',
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
  readContent?(
    request: FeishuContentReadRequest,
    signal: AbortSignal,
  ): Promise<FeishuContentReadResult>
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
  withSignal<T>(signal: AbortSignal, call: () => Promise<T>): Promise<T>
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
    sendText: (chatId, text, sendOptions, signal) => transport.withSignal(
      signal,
      () => translateSendFailure(() => channel.send(
        chatId,
        { text },
        sendOptions === undefined ? undefined : {
          ...(sendOptions.replyTo === undefined ? {} : { replyTo: sendOptions.replyTo }),
          ...(sendOptions.replyInThread === undefined ? {} : { replyInThread: sendOptions.replyInThread }),
        },
      )),
    ),
    sendCard: (chatId, card, sendOptions, signal) => transport.withSignal(
      signal,
      () => translateSendFailure(() => channel.send(
        chatId,
        { card },
        sendOptions === undefined ? undefined : {
          ...(sendOptions.replyTo === undefined ? {} : { replyTo: sendOptions.replyTo }),
          ...(sendOptions.replyInThread === undefined ? {} : { replyInThread: sendOptions.replyInThread }),
        },
      )),
    ),
    downloadMessageResource: async (messageId, fileKey, type, maxBytes, signal) => {
      signal?.throwIfAborted()
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
        throw new Error('dsh-feishu: message resource byte limit is invalid')
      }
      try {
        const response = await channel.rawClient.im.v1.messageResource.get({
          params: { type },
          path: { message_id: messageId, file_key: fileKey },
        })
        return await readBoundedResource(response.getReadableStream(), maxBytes, signal)
      } catch (error: unknown) {
        signal?.throwIfAborted()
        throw new Error('dsh-feishu: unable to download the exact message resource', { cause: error })
      }
    },
    readContent: (request, signal) => transport.withSignal(
      signal,
      () => readOfficialFeishuContent(channel.rawClient, request, signal),
    ),
  }
  return Object.freeze(platform)
}

/** Process-local proxy adaptation; never mutates deployment environment or global agents. */
export function resolveFeishuTransport(
  environment: NodeJS.ProcessEnv = process.env,
): FeishuTransport {
  const signalScope = new AsyncLocalStorage<AbortSignal>()
  const proxyUrl = selectHttpsProxy(environment, FEISHU_API_URL)
  if (proxyUrl === undefined) {
    const httpInstance = createFeishuHttpInstance()
    return Object.freeze({
      httpInstance,
      withSignal: <T>(signal: AbortSignal, call: () => Promise<T>) =>
        runWithSignal(httpInstance, signalScope, signal, call),
    })
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
  const httpInstance = createFeishuHttpInstance(agent)
  return Object.freeze({
    agent,
    httpInstance,
    withSignal: <T>(signal: AbortSignal, call: () => Promise<T>) =>
      runWithSignal(httpInstance, signalScope, signal, call),
  })
}

async function runWithSignal<T>(
  httpInstance: AxiosInstance,
  scope: AsyncLocalStorage<AbortSignal>,
  signal: AbortSignal,
  call: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted()
  return scope.run(signal, async () => {
    const interceptor = httpInstance.interceptors.request.use((config) => {
      const current = scope.getStore()
      return current === undefined ? config : { ...config, signal: current }
    })
    try {
      const result = await call()
      signal.throwIfAborted()
      return result
    } finally {
      httpInstance.interceptors.request.eject(interceptor)
    }
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
    resources: Object.freeze(message.resources.map(resource => Object.freeze({
      type: resource.type,
      fileKey: resource.fileKey,
      ...(resource.fileName === undefined ? {} : { fileName: resource.fileName }),
      ...(resource.durationMs === undefined ? {} : { durationMs: resource.durationMs }),
      ...(resource.coverImageKey === undefined ? {} : { coverImageKey: resource.coverImageKey }),
    }))),
    ...(message.threadId === undefined ? {} : { threadId: message.threadId }),
  })
}

async function readBoundedResource(
  stream: NodeJS.ReadableStream & AsyncIterable<unknown> & { destroy(error?: Error): void },
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let bytes = 0
  const onAbort = (): void => stream.destroy(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const value of stream) {
      signal?.throwIfAborted()
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as unknown as Uint8Array)
      bytes += chunk.byteLength
      if (bytes > maxBytes) {
        stream.destroy(new Error('dsh-feishu: message resource exceeds the configured byte limit'))
        throw new Error('dsh-feishu: message resource exceeds the configured byte limit')
      }
      chunks.push(chunk)
    }
    signal?.throwIfAborted()
    return new Uint8Array(Buffer.concat(chunks, bytes))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function selectAction(action: CardActionEvent): FeishuApprovalAction {
  return Object.freeze({
    messageId: action.messageId,
    chatId: action.chatId,
    operatorId: action.operator.openId,
    value: action.action.value,
  })
}

interface FeishuRawClient {
  readonly docx: {
    readonly v1: {
      readonly document: {
        get(payload: unknown): Promise<unknown>
        rawContent(payload: unknown): Promise<unknown>
      }
    }
  }
  readonly wiki: {
    readonly v2: {
      readonly space: { getNode(payload: unknown): Promise<unknown> }
    }
  }
  readonly drive: {
    readonly v1: {
      readonly meta: { batchQuery(payload: unknown): Promise<unknown> }
    }
  }
  readonly bitable: {
    readonly v1: {
      readonly app: { get(payload: unknown): Promise<unknown> }
      readonly appTableRecord: { search(payload: unknown): Promise<unknown> }
    }
  }
}

class FeishuContentReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FeishuContentReadError'
  }
}

/** Map four current official SDK read APIs into one bounded, provider-metadata-minimized Tool value. */
export async function readOfficialFeishuContent(
  candidate: unknown,
  request: FeishuContentReadRequest,
  signal: AbortSignal,
): Promise<FeishuContentReadResult> {
  signal.throwIfAborted()
  const client = candidate as FeishuRawClient
  try {
    let result: FeishuContentReadResult
    switch (request.kind) {
      case 'document': result = await readDocument(client, request, signal); break
      case 'wiki': result = await readWiki(client, request, signal); break
      case 'drive': result = await readDrive(client, request, signal); break
      case 'bitable': result = await readBitable(client, request, signal); break
    }
    signal.throwIfAborted()
    return Object.freeze(result)
  } catch (error: unknown) {
    signal.throwIfAborted()
    if (error instanceof FeishuContentReadError) throw error
    throw new FeishuContentReadError(
      'Feishu content read is unavailable; verify the App scope and exact resource access',
      { cause: error },
    )
  }
}

async function readDocument(
  client: FeishuRawClient,
  request: FeishuContentReadRequest,
  signal: AbortSignal,
): Promise<FeishuContentReadResult> {
  const metadata = responseData(await client.docx.v1.document.get({
    path: { document_id: request.token },
  }))
  signal.throwIfAborted()
  const body = responseData(await client.docx.v1.document.rawContent({
    path: { document_id: request.token },
  }))
  const document = optionalRecord(metadata.document)
  const title = optionalString(document?.title)
  const revision = optionalSafeInteger(document?.revision_id)
  const bounded = boundText(optionalString(body.content) ?? '', request.maxContentChars)
  return {
    schemaVersion: 1,
    kind: 'document',
    ...(title === undefined ? {} : { title }),
    objectType: 'docx',
    ...(revision === undefined ? {} : { revision }),
    contentFormat: 'text/plain',
    content: bounded.value,
    truncated: bounded.truncated,
  }
}

async function readWiki(
  client: FeishuRawClient,
  request: FeishuContentReadRequest,
  signal: AbortSignal,
): Promise<FeishuContentReadResult> {
  const data = responseData(await client.wiki.v2.space.getNode({
    params: { token: request.token },
  }))
  const node = requiredRecord(data.node, 'Feishu Wiki returned no node')
  const objectType = requiredString(node.obj_type, 'Feishu Wiki returned no object type')
  const title = optionalString(node.title)
  if (objectType !== 'docx') {
    return {
      schemaVersion: 1,
      kind: 'wiki',
      ...(title === undefined ? {} : { title }),
      objectType,
      truncated: false,
    }
  }
  const objectToken = requiredString(node.obj_token, 'Feishu Wiki returned no document object')
  signal.throwIfAborted()
  const body = responseData(await client.docx.v1.document.rawContent({
    path: { document_id: objectToken },
  }))
  const bounded = boundText(optionalString(body.content) ?? '', request.maxContentChars)
  return {
    schemaVersion: 1,
    kind: 'wiki',
    ...(title === undefined ? {} : { title }),
    objectType,
    contentFormat: 'text/plain',
    content: bounded.value,
    truncated: bounded.truncated,
  }
}

async function readDrive(
  client: FeishuRawClient,
  request: FeishuContentReadRequest,
  _signal: AbortSignal,
): Promise<FeishuContentReadResult> {
  if (request.driveType === undefined) throw new FeishuContentReadError('Feishu Drive read requires drive_type')
  const data = responseData(await client.drive.v1.meta.batchQuery({
    data: {
      request_docs: [{ doc_token: request.token, doc_type: request.driveType }],
      with_url: false,
    },
  }))
  const metas = Array.isArray(data.metas) ? data.metas : []
  const meta = requiredRecord(metas[0], 'Feishu Drive returned no metadata for the exact resource')
  const title = optionalString(meta.title)
  const objectType = optionalString(meta.doc_type)
  const createdAt = optionalString(meta.create_time)
  const modifiedAt = optionalString(meta.latest_modify_time)
  const classification = optionalString(meta.sec_label_name)
  return {
    schemaVersion: 1,
    kind: 'drive',
    ...(title === undefined ? {} : { title }),
    ...(objectType === undefined ? {} : { objectType }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(classification === undefined ? {} : { classification }),
    truncated: false,
  }
}

async function readBitable(
  client: FeishuRawClient,
  request: FeishuContentReadRequest,
  signal: AbortSignal,
): Promise<FeishuContentReadResult> {
  const metadata = responseData(await client.bitable.v1.app.get({
    path: { app_token: request.token },
  }))
  const app = requiredRecord(metadata.app, 'Feishu Bitable returned no App metadata')
  const title = optionalString(app.name)
  const revision = optionalSafeInteger(app.revision)
  const base = {
    schemaVersion: 1 as const,
    kind: 'bitable' as const,
    ...(title === undefined ? {} : { title }),
    objectType: 'bitable',
    ...(revision === undefined ? {} : { revision }),
  }
  if (request.tableId === undefined) return { ...base, truncated: false }
  signal.throwIfAborted()
  const pageSize = Math.min(request.pageSize ?? request.maxBitableRecords, request.maxBitableRecords)
  const data = responseData(await client.bitable.v1.appTableRecord.search({
    path: { app_token: request.token, table_id: request.tableId },
    params: { page_size: pageSize },
    data: { automatic_fields: false },
  }))
  const items = Array.isArray(data.items) ? data.items.slice(0, pageSize) : []
  const records = items.map(item => {
    const record = requiredRecord(item, 'Feishu Bitable returned an invalid record')
    return Object.freeze({
      ...optionalString(record.record_id) === undefined ? {} : { recordId: optionalString(record.record_id) },
      fields: isRecord(record.fields) ? record.fields : {},
    })
  })
  const bounded = boundJsonRecords(records, request.maxContentChars)
  const providerHasMore = data.has_more === true
  const totalItems = optionalSafeInteger(data.total)
  return {
    ...base,
    contentFormat: 'application/json',
    content: bounded.value,
    returnedItems: bounded.items,
    ...(totalItems === undefined ? {} : { totalItems }),
    hasMore: providerHasMore || bounded.truncated,
    truncated: providerHasMore || bounded.truncated,
  }
}

function responseData(response: unknown): Record<string, unknown> {
  const root = requiredRecord(response, 'Feishu returned an invalid response')
  if (root.code !== 0) throw new FeishuContentReadError('Feishu rejected the content read')
  return requiredRecord(root.data, 'Feishu returned no content data')
}

function boundText(value: string, limit: number): { value: string; truncated: boolean } {
  const points = Array.from(value)
  if (points.length <= limit) return { value, truncated: false }
  return { value: points.slice(0, limit).join(''), truncated: true }
}

function boundJsonRecords(
  records: readonly Readonly<Record<string, unknown>>[],
  limit: number,
): { value: string; items: number; truncated: boolean } {
  const selected: Readonly<Record<string, unknown>>[] = []
  for (const record of records) {
    const next = JSON.stringify([...selected, record])
    if (Array.from(next).length > limit) break
    selected.push(record)
  }
  return {
    value: JSON.stringify(selected),
    items: selected.length,
    truncated: selected.length !== records.length,
  }
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new FeishuContentReadError(message)
  return value
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new FeishuContentReadError(message)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? value as number : undefined
}
