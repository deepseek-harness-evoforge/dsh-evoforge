import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { DshGateway } from 'dsh-evoforge-gateway'
import { resolveFeishuPairingConfig } from '../src/config.js'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
} from '../src/platform.js'
import { FeishuRuntime } from '../src/runtime.js'

describe('Feishu runtime teardown', () => {
  it('disconnects the platform even when the sibling Gateway rejects the stopping report', async () => {
    const ctx = new Context()
    let connected = false
    let disconnectCount = 0
    let outboundDisposed = false
    let transportDisposed = false
    const observations: string[] = []
    let messageHandler: ((message: FeishuInboundMessage) => Promise<void>) | undefined
    let reconnecting: (() => void) | undefined
    let reconnected: (() => void) | undefined
    const gateway = {
      registerTransport: () => ({
        report(input: { state: string }) {
          observations.push(input.state)
          if (input.state === 'stopping') throw new Error('Gateway already stopped')
        },
        dispose() { transportDisposed = true },
      }),
      registerTextAdapter: () => ({
        async dispose() { outboundDisposed = true },
      }),
    } as unknown as DshGateway
    const platform: FeishuPlatform = {
      onMessage(handler: (message: FeishuInboundMessage) => Promise<void>) {
        messageHandler = handler
        return () => { if (messageHandler === handler) messageHandler = undefined }
      },
      onApprovalAction(_handler: (action: FeishuApprovalAction) => Promise<void>) { return () => {} },
      onError(_handler: (error: unknown) => void) { return () => {} },
      onReconnecting(handler: () => void) {
        reconnecting = handler
        return () => { if (reconnecting === handler) reconnecting = undefined }
      },
      onReconnected(handler: () => void) {
        reconnected = handler
        return () => { if (reconnected === handler) reconnected = undefined }
      },
      async connect() { connected = true },
      async disconnect() {
        disconnectCount += 1
        connected = false
      },
      async sendText() { return { messageId: 'unused' } },
      async sendCard() { return { messageId: 'unused' } },
      async downloadMessageResource() { throw new Error('unused') },
    }
    const config = resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: [],
      appIdEnv: 'TEST_APP_ID',
      appSecretEnv: 'TEST_APP_SECRET',
    }, {
      TEST_APP_ID: 'test-app',
      TEST_APP_SECRET: 'test-secret',
    })
    const runtime = new FeishuRuntime(ctx, config, gateway, platform)

    await runtime.start()
    expect(connected).toBe(true)
    await expect(messageHandler!({
      messageId: 'om_failure',
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderId: 'ou_user',
      content: 'hello',
      rawContentType: 'text',
      resources: [],
    })).resolves.toBeUndefined()
    expect(observations.at(-1)).toBe('degraded')
    reconnecting?.()
    reconnected?.()
    expect(observations.slice(-2)).toEqual(['degraded', 'ready'])
    await expect(runtime.dispose()).rejects.toThrow('Gateway already stopped')
    expect(connected).toBe(false)
    expect(disconnectCount).toBe(1)
    expect(outboundDisposed).toBe(true)
    expect(transportDisposed).toBe(true)
    await ctx.fiber.dispose()
  })
})
