import type { Context } from '@deepseek-ai/cordis'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuSendOptions,
} from '../../src/index.ts'

export const name = 'dsh-feishu-test-pairing-bootstrap'
export const inject = ['commands', 'workspaceRegistry']

interface Config {
  readonly feishuEntry: string
  readonly appIdEnv: string
  readonly appSecretEnv: string
}

class FakePairingPlatform implements FeishuPlatform {
  connected = false
  disconnectCount = 0
  readonly texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }> = []
  private messageHandler: ((message: FeishuInboundMessage) => Promise<void>) | undefined

  onMessage(handler: (message: FeishuInboundMessage) => Promise<void>): () => void {
    this.messageHandler = handler
    return () => { if (this.messageHandler === handler) this.messageHandler = undefined }
  }

  onApprovalAction(_handler: (action: FeishuApprovalAction) => Promise<void>): () => void {
    return () => {}
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

  async sendCard(): Promise<{ messageId: string }> {
    throw new Error('pairing never sends a card')
  }

  async downloadMessageResource(): Promise<Uint8Array> {
    throw new Error('pairing never downloads a message resource')
  }

  async emitMessage(message: FeishuInboundMessage): Promise<void> {
    if (this.messageHandler === undefined) throw new Error('pairing message handler is unavailable')
    await this.messageHandler(message)
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const feishu = await import(config.feishuEntry) as {
    installFeishuPairing(ctx: Context, resolved: unknown, platform: FeishuPlatform): unknown
    resolveFeishuPairingConfig(input: unknown): unknown
  }
  const resolved = feishu.resolveFeishuPairingConfig({
    mode: 'pairing',
    routeIds: [],
    appIdEnv: config.appIdEnv,
    appSecretEnv: config.appSecretEnv,
  })
  const platform = new FakePairingPlatform()
  const runtime = feishu.installFeishuPairing(ctx, resolved, platform)
  ctx.provide('evoforge.feishuPairingTest' as never, Object.freeze({ platform, runtime }) as never)
}
