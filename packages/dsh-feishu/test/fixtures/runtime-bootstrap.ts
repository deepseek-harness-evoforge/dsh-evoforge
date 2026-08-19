import type { Context } from '@deepseek-ai/cordis'
import type { DshGateway, ResolvedGatewayRoute } from 'dsh-gateway'
import type {
  FeishuDeliveryStore,
  FeishuApprovalAction,
  FeishuHostNotice,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuSendOptions,
  ResolvedFeishuConfig,
} from '../../src/index.ts'

export const name = 'dsh-feishu-test-runtime-bootstrap'
export const inject = ['evoforge.gateway', 'storageDomain']

interface Config {
  readonly feishuEntry: string
  readonly routeIds: readonly string[]
  readonly appIdEnv: string
  readonly appSecretEnv: string
}

interface SentText {
  readonly chatId: string
  readonly text: string
  readonly options?: FeishuSendOptions
}

class FakeFeishuPlatform implements FeishuPlatform {
  readonly texts: SentText[] = []
  readonly cards: Array<{ chatId: string; card: object }> = []
  readonly sendAttempts: string[] = []
  private readonly failures: unknown[] = []
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

  async sendText(chatId: string, text: string, options?: FeishuSendOptions): Promise<{ messageId: string }> {
    this.sendAttempts.push(text)
    if (this.failures.length > 0) throw this.failures.shift()
    this.texts.push(Object.freeze({ chatId, text, ...(options === undefined ? {} : { options }) }))
    return { messageId: `om_sent_${this.texts.length}` }
  }

  async sendCard(chatId: string, card: object): Promise<{ messageId: string }> {
    this.cards.push(Object.freeze({ chatId, card }))
    return { messageId: `om_card_${this.cards.length}` }
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
      store: FeishuDeliveryStore,
      platform: FeishuPlatform,
    ) => {
      start(): Promise<void>
      dispose(): Promise<void>
      notifyHost(notice: FeishuHostNotice): Promise<unknown>
      healthSnapshot(): unknown
    }
    openFeishuDeliveryStore(
      facility: Context['storageDomain'],
      options: { maxRecords: number },
    ): Promise<FeishuDeliveryStore>
    resolveFeishuConfig(
      config: Config,
      routes: readonly ResolvedGatewayRoute[],
    ): ResolvedFeishuConfig
  }
  const resolved = feishu.resolveFeishuConfig(config, routes)
  const platform = new FakeFeishuPlatform()
  const store = await feishu.openFeishuDeliveryStore(ctx.storageDomain, { maxRecords: resolved.maxDeliveryRecords })
  const runtime = new feishu.FeishuRuntime(ctx, resolved, gateway, store, platform)
  ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu.test-runtime')
  await runtime.start()
  ctx.provide('evoforge.feishuRoute' as never, Object.freeze({
    routes: Object.freeze(resolved.routes.map(route => Object.freeze({
      routeId: route.id,
      workspaceId: route.workspaceId,
    }))),
    notify: (notice: FeishuHostNotice) => runtime.notifyHost(notice),
  }) as never)
  ctx.provide('evoforge.feishuTest' as never, Object.freeze({ platform, runtime }) as never)
}
