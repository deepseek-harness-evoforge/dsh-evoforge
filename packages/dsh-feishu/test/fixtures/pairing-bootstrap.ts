import type { Context } from '@deepseek-ai/cordis'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuSendOptions,
} from '../../src/index.ts'

export const name = 'dsh-feishu-test-pairing-bootstrap'
export const inject = ['attachments', 'evoforge.gateway']

interface Config {
  readonly feishuEntry: string
  readonly appIdEnv: string
  readonly appSecretEnv: string
}

class FakePairingPlatform implements FeishuPlatform {
  connected = false
  disconnectCount = 0
  readonly texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }> = []
  readonly cards: Array<{
    messageId: string
    chatId: string
    card: object
    options?: FeishuSendOptions
  }> = []
  private messageHandler: ((message: FeishuInboundMessage) => Promise<void>) | undefined
  private approvalHandler: ((action: FeishuApprovalAction) => Promise<void>) | undefined

  onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): () => void {
    this.messageHandler = handler
    return () => { if (this.messageHandler === handler) this.messageHandler = undefined }
  }

  onApprovalAction(handler: (action: FeishuApprovalAction) => Promise<void>): () => void {
    this.approvalHandler = handler
    return () => { if (this.approvalHandler === handler) this.approvalHandler = undefined }
  }

  onError(_handler: (error: unknown) => void): () => void {
    return () => {}
  }

  async connect(): Promise<void> { this.connected = true }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1
    this.connected = false
  }

  async sendText(chatId: string, text: string, options?: FeishuSendOptions): Promise<{ messageId: string }> {
    this.texts.push({ chatId, text, ...(options === undefined ? {} : { options }) })
    return { messageId: `om_pair_ack_${this.texts.length}` }
  }

  async sendCard(
    chatId: string,
    card: object,
    options?: FeishuSendOptions,
  ): Promise<{ messageId: string }> {
    const messageId = `om_pair_card_${this.cards.length + 1}`
    this.cards.push({ messageId, chatId, card, ...(options === undefined ? {} : { options }) })
    return { messageId }
  }

  async downloadMessageResource(): Promise<Uint8Array> {
    throw new Error('pairing never downloads a message resource')
  }

  async emitMessage(message: FeishuInboundMessage): Promise<void> {
    if (this.messageHandler === undefined) throw new Error('pairing message handler is unavailable')
    await this.messageHandler(message)
  }

  async emitApproval(action: FeishuApprovalAction): Promise<void> {
    if (this.approvalHandler === undefined) throw new Error('pairing approval handler is unavailable')
    await this.approvalHandler(action)
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const feishu = await import(config.feishuEntry) as {
    FeishuRuntime: new (ctx: Context, resolved: never, gateway: unknown, platform: FeishuPlatform) => {
      start(): Promise<void>
      dispose(): Promise<void>
      createHostRoute(): unknown
    }
    resolveFeishuPairingConfig(input: unknown): unknown
  }
  const resolved = feishu.resolveFeishuPairingConfig({
    mode: 'pairing',
    routeIds: [],
    appIdEnv: config.appIdEnv,
    appSecretEnv: config.appSecretEnv,
  })
  const platform = new FakePairingPlatform()
  const runtime = new feishu.FeishuRuntime(ctx, resolved as never, ctx.get('evoforge.gateway' as never), platform)
  ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu-test.pairing')
  await runtime.start()
  ctx.provide('evoforge.feishuRoute' as never, runtime.createHostRoute() as never)
  ctx.provide('evoforge.feishuPairingTest' as never, Object.freeze({ platform, runtime }) as never)
}
