import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FeishuPairingRuntime,
  type FeishuPairingTarget,
} from '../src/pairing.js'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
  FeishuSendOptions,
} from '../src/platform.js'

const target: FeishuPairingTarget = Object.freeze({
  workspaceId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'native-session',
  agentPreset: 'standard',
  provider: 'deepseek-official',
  model: 'deepseek-chat',
})

class PairingPlatform implements FeishuPlatform {
  connected = false
  connectCount = 0
  disconnectCount = 0
  readonly texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }> = []
  connectFailure: unknown
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

  async connect(): Promise<void> {
    this.connectCount += 1
    this.connected = true
    if (this.connectFailure !== undefined) throw this.connectFailure
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1
    this.connected = false
  }

  async sendText(chatId: string, text: string, options?: FeishuSendOptions): Promise<{ messageId: string }> {
    this.texts.push({ chatId, text, ...(options === undefined ? {} : { options }) })
    return { messageId: `om_pair_${this.texts.length}` }
  }

  async sendCard(): Promise<{ messageId: string }> {
    throw new Error('pairing never sends a card')
  }

  async downloadMessageResource(): Promise<Uint8Array> {
    throw new Error('pairing never downloads a message resource')
  }

  async emit(message: Partial<FeishuInboundMessage>): Promise<void> {
    if (this.messageHandler === undefined) throw new Error('message handler missing')
    await this.messageHandler({
      messageId: 'om_pair_input',
      chatId: 'oc_exact_chat',
      chatType: 'p2p',
      senderId: 'ou_exact_user',
      content: 'ignored',
      rawContentType: 'text',
      resources: [],
      ...message,
    })
  }
}

describe('novice Feishu pairing runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures only the first exact one-time phrase and renders a reviewable static route', async () => {
    const platform = new PairingPlatform()
    const runtime = new FeishuPairingRuntime(platform, {
      appId: 'cli_app_id',
      appIdEnv: 'DSH_FEISHU_APP_ID',
      appSecretEnv: 'DSH_FEISHU_APP_SECRET',
      pairingWindowMs: 120_000,
    })

    const started = await runtime.command(target, 'start')
    expect(started.kind).toBe('success')
    const phrase = started.text?.match(/EVOFORGE PAIR [A-Z2-9]{16}/u)?.[0]
    expect(phrase).toBeDefined()
    if (phrase === undefined) throw new Error('pairing phrase missing')
    expect(platform.connected).toBe(true)

    await platform.emit({ content: 'ordinary user message' })
    await platform.emit({ content: `${phrase} extra` })
    expect(platform.texts).toHaveLength(0)

    // The locked official SDK strips the bot mention before this Adapter seam;
    // exercise the group identity path with the remaining exact text.
    await platform.emit({ chatType: 'group', content: `  ${phrase}  ` })
    expect(platform.texts).toEqual([{
      chatId: 'oc_exact_chat',
      text: expect.stringContaining('配对信息已收到'),
      options: { replyTo: 'om_pair_input' },
    }])
    expect(platform.connected).toBe(false)

    await platform.emit({
      messageId: 'om_replay',
      chatId: 'oc_other',
      senderId: 'ou_other',
      content: phrase,
    })
    const status = await runtime.command(target, 'status')
    expect(status.kind).toBe('success')
    expect(status.text).toContain('conversationId: "oc_exact_chat"')
    expect(status.text).toContain('userId: "ou_exact_user"')
    expect(status.text).toContain('workspaceId: "11111111-1111-4111-8111-111111111111"')
    expect(status.text).toContain('sessionId: "native-session"')
    expect(status.text).toContain('agentPreset: "standard"')
    expect(status.text).toContain('provider: "deepseek-official"')
    expect(status.text).toContain('model: "deepseek-chat"')
    expect(status.text).toContain('appIdEnv: DSH_FEISHU_APP_ID')
    expect(status.text).toContain('appSecretEnv: DSH_FEISHU_APP_SECRET')
    expect(status.text).not.toContain('secret-value')
    expect(platform.texts).toHaveLength(1)

    await expect(runtime.command({ ...target, sessionId: 'other-session' }, 'status'))
      .resolves.toMatchObject({ kind: 'error', text: expect.stringMatching(/发起配对的 Session/u) })
    await runtime.dispose()
  })

  it('expires and disconnects without accepting a late identity', async () => {
    const platform = new PairingPlatform()
    const runtime = new FeishuPairingRuntime(platform, {
      appId: 'cli_app_id',
      appIdEnv: 'DSH_FEISHU_APP_ID',
      appSecretEnv: 'DSH_FEISHU_APP_SECRET',
      pairingWindowMs: 120_000,
    })
    const started = await runtime.command(target, 'start')
    const phrase = started.text?.match(/EVOFORGE PAIR [A-Z2-9]{16}/u)?.[0]
    expect(phrase).toBeDefined()
    if (phrase === undefined) throw new Error('pairing phrase missing')

    await vi.advanceTimersByTimeAsync(120_001)
    expect(platform.connected).toBe(false)
    await platform.emit({ content: phrase })
    expect(platform.texts).toHaveLength(0)
    await expect(runtime.command(target, 'status')).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringMatching(/已过期/u),
    })
    await runtime.dispose()
  })

  it('cancels the bounded listener and never forwards messages to an Agent', async () => {
    const platform = new PairingPlatform()
    const runtime = new FeishuPairingRuntime(platform, {
      appId: 'cli_app_id',
      appIdEnv: 'DSH_FEISHU_APP_ID',
      appSecretEnv: 'DSH_FEISHU_APP_SECRET',
      pairingWindowMs: 120_000,
    })
    await runtime.command(target, 'start')

    await expect(runtime.command(target, 'cancel')).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringMatching(/已取消/u),
    })
    expect(platform.connected).toBe(false)
    expect(platform.texts).toHaveLength(0)
    await runtime.dispose()
  })

  it('opens a fresh bounded window after cancellation', async () => {
    const platform = new PairingPlatform()
    const runtime = new FeishuPairingRuntime(platform, {
      appId: 'cli_app_id',
      appIdEnv: 'DSH_FEISHU_APP_ID',
      appSecretEnv: 'DSH_FEISHU_APP_SECRET',
      pairingWindowMs: 120_000,
    })
    const first = await runtime.command(target, 'start')
    await runtime.command(target, 'cancel')
    const second = await runtime.command(target, 'start')

    expect(first.text).not.toEqual(second.text)
    expect(platform.connectCount).toBe(2)
    expect(platform.connected).toBe(true)
    await runtime.dispose()
    expect(platform.disconnectCount).toBe(2)
  })

  it('disconnects a partially opened transport when connect fails', async () => {
    const platform = new PairingPlatform()
    platform.connectFailure = new Error('handshake failed after allocation')
    const runtime = new FeishuPairingRuntime(platform, {
      appId: 'cli_app_id',
      appIdEnv: 'DSH_FEISHU_APP_ID',
      appSecretEnv: 'DSH_FEISHU_APP_SECRET',
      pairingWindowMs: 120_000,
    })

    await expect(runtime.command(target, 'start')).resolves.toMatchObject({
      kind: 'error',
      text: expect.stringMatching(/连接失败/u),
    })
    expect(platform.connected).toBe(false)
    expect(platform.disconnectCount).toBe(1)
    await runtime.dispose()
  })
})
