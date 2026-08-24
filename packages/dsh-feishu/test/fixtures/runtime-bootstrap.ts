import type { Context } from '@deepseek-ai/cordis'
import type { DshGateway, ResolvedGatewayRoute } from 'dsh-gateway'
import type {
  FeishuApprovalAction,
  FeishuContentReadRequest,
  FeishuContentReadResult,
  FeishuContentPermission,
  FeishuHostNotice,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuSendOptions,
  ResolvedFeishuConfig,
} from '../../src/index.ts'

export const name = 'dsh-feishu-test-runtime-bootstrap'
export const inject = ['attachments', 'evoforge.gateway']

interface Config {
  readonly feishuEntry: string
  readonly routeIds: readonly string[]
  readonly appIdEnv: string
  readonly appSecretEnv: string
  readonly contentPermissions?: readonly FeishuContentPermission[]
  readonly maxContentChars?: number
  readonly maxBitableRecords?: number
}

interface SentText {
  readonly chatId: string
  readonly text: string
  readonly options?: FeishuSendOptions
}

interface SentCard {
  readonly messageId: string
  readonly chatId: string
  readonly card: object
  readonly options?: FeishuSendOptions
}

class FakeFeishuPlatform implements FeishuPlatform {
  readonly texts: SentText[] = []
  readonly cards: SentCard[] = []
  readonly sendAttempts: string[] = []
  readonly sendSignals: AbortSignal[] = []
  readonly cardSignals: AbortSignal[] = []
  readonly contentReads: FeishuContentReadRequest[] = []
  private readonly failures: unknown[] = []
  private readonly resources = new Map<string, Uint8Array>()
  private readonly content = new Map<string, FeishuContentReadResult>()
  connected = false
  private messageHandler: ((message: FeishuInboundMessage) => Promise<void>) | undefined
  private approvalHandler: ((action: FeishuApprovalAction) => Promise<void>) | undefined
  private errorHandler: ((error: unknown) => void) | undefined

  onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): () => void {
    this.messageHandler = handler
    return () => { if (this.messageHandler === handler) this.messageHandler = undefined }
  }

  onApprovalAction(handler: (action: FeishuApprovalAction) => Promise<void>): () => void {
    this.approvalHandler = handler
    return () => { if (this.approvalHandler === handler) this.approvalHandler = undefined }
  }

  onError(handler: (error: unknown) => void): () => void {
    this.errorHandler = handler
    return () => { if (this.errorHandler === handler) this.errorHandler = undefined }
  }

  async connect(): Promise<void> { this.connected = true }

  async disconnect(): Promise<void> { this.connected = false }

  async sendText(
    chatId: string,
    text: string,
    options?: FeishuSendOptions,
    signal?: AbortSignal,
  ): Promise<{ messageId: string }> {
    this.sendAttempts.push(text)
    if (signal !== undefined) this.sendSignals.push(signal)
    if (this.failures.length > 0) throw this.failures.shift()
    this.texts.push(Object.freeze({ chatId, text, ...(options === undefined ? {} : { options }) }))
    return { messageId: `om_sent_${this.texts.length}` }
  }

  async sendCard(
    chatId: string,
    card: object,
    options?: FeishuSendOptions,
    signal?: AbortSignal,
  ): Promise<{ messageId: string }> {
    if (signal !== undefined) this.cardSignals.push(signal)
    const messageId = `om_card_${this.cards.length + 1}`
    this.cards.push(Object.freeze({ messageId, chatId, card, ...(options === undefined ? {} : { options }) }))
    return { messageId }
  }

  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    _type: 'image' | 'file',
    maxBytes: number,
  ): Promise<Uint8Array> {
    const value = this.resources.get(`${messageId}\0${fileKey}`)
    if (value === undefined) throw new Error('test Feishu message resource is unavailable')
    if (value.byteLength > maxBytes) throw new Error('test Feishu message resource exceeds maxBytes')
    return new Uint8Array(value)
  }

  async readContent(request: FeishuContentReadRequest, signal: AbortSignal): Promise<FeishuContentReadResult> {
    signal.throwIfAborted()
    this.contentReads.push(request)
    const value = this.content.get(`${request.kind}\0${request.token}`)
    if (value === undefined) throw new Error('test Feishu content is unavailable')
    return value
  }

  setResource(messageId: string, fileKey: string, value: Uint8Array): void {
    this.resources.set(`${messageId}\0${fileKey}`, new Uint8Array(value))
  }

  setContent(kind: FeishuContentReadRequest['kind'], token: string, value: FeishuContentReadResult): void {
    this.content.set(`${kind}\0${token}`, value)
  }

  async emitMessage(message: FeishuInboundMessage): Promise<void> {
    if (this.messageHandler === undefined) throw new Error('Feishu message handler is not registered')
    await this.messageHandler(message)
  }

  async emitApproval(action: FeishuApprovalAction): Promise<void> {
    if (this.approvalHandler === undefined) throw new Error('Feishu approval handler is not registered')
    await this.approvalHandler(action)
  }

  emitError(error: unknown): void {
    if (this.errorHandler === undefined) throw new Error('Feishu error handler is not registered')
    this.errorHandler(error)
  }

  queueFailure(error: unknown): void { this.failures.push(error) }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const gateway = ctx.get('evoforge.gateway' as never) as DshGateway | undefined
  if (gateway === undefined) throw new Error('test Gateway is unavailable')
  const routes = config.routeIds
    .map(id => gateway.route(id))
    .filter((route): route is ResolvedGatewayRoute => route !== undefined)
  const feishu = await import(config.feishuEntry) as {
    FeishuRuntime: new(
      ctx: Context,
      config: ResolvedFeishuConfig,
      gateway: DshGateway,
      platform: FeishuPlatform,
    ) => {
      start(): Promise<void>
      dispose(): Promise<void>
      notifyHost(notice: FeishuHostNotice): Promise<unknown>
      observedChatKind(routeId: string): 'direct' | 'group' | undefined
      healthSnapshot(): unknown
    }
    resolveFeishuConfig(
      config: Config,
      routes: readonly ResolvedGatewayRoute[],
    ): ResolvedFeishuConfig
  }
  const resolved = feishu.resolveFeishuConfig(config, routes)
  const platform = new FakeFeishuPlatform()
  const runtime = new feishu.FeishuRuntime(ctx, resolved, gateway, platform)
  ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu.test-runtime')
  await runtime.start()
  ctx.provide('evoforge.feishuRoute' as never, Object.freeze({
    routes: Object.freeze(resolved.routes.map(route => Object.freeze({
      routeId: route.id,
      workspaceId: route.workspaceId,
    }))),
    observedChatKind: (routeId: string) => runtime.observedChatKind(routeId),
    notify: (notice: FeishuHostNotice) => runtime.notifyHost(notice),
  }) as never)
  ctx.provide('evoforge.feishuTest' as never, Object.freeze({ platform, runtime }) as never)
}
