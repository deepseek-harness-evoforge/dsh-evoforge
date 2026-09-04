import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { DshGateway } from 'dsh-evoforge-gateway'
import { resolveFeishuConfig, resolveFeishuPairingConfig } from '../src/config.js'
import type {
  FeishuApprovalAction,
  FeishuInboundMessage,
  FeishuPlatform,
} from '../src/platform.js'
import { FeishuRuntime } from '../src/runtime.js'

describe('Feishu runtime teardown', () => {
  it('cleans up a registered transport when startup fails before platform connect', async () => {
    const ctx = new Context()
    let transportDisposed = 0
    let disconnectCount = 0
    const route = {
      id: 'feishu-start-failure',
      adapter: 'feishu' as const,
      accountId: 'test-app',
      conversationId: 'oc_chat',
      userId: 'ou_user',
      workspaceId: 'workspace-test',
      sessionId: 'session-test',
      agentPreset: 'test',
      provider: 'test',
      model: 'test',
      endpointKey: '["feishu","test-app","oc_chat",null,"ou_user"]',
    }
    const agent = {
      id: route.sessionId,
      session: { id: route.sessionId, requestHeader: () => undefined },
      ctx: {
        inject(_deps: readonly string[], callback: (value: unknown) => unknown) {
          callback({ commands: { register: () => undefined } })
        },
      },
    }
    const gateway = {
      resolve: async () => agent,
      registerTransport: () => ({
        report: () => undefined,
        dispose: () => { transportDisposed += 1 },
      }),
      registerTextAdapter: () => { throw new Error('outbound registration failed') },
    } as unknown as DshGateway
    const platform: FeishuPlatform = {
      onMessage: () => () => {},
      onApprovalAction: () => () => {},
      onError: () => () => {},
      async connect() { throw new Error('platform connect must not run') },
      async disconnect() { disconnectCount += 1 },
      async sendText() { return { messageId: 'unused' } },
      async sendCard() { return { messageId: 'unused' } },
      async downloadMessageResource() { throw new Error('unused') },
    }
    const config = await resolveFeishuConfig({
      routeIds: [route.id],
      appIdEnv: 'TEST_APP_ID',
      appSecretEnv: 'TEST_APP_SECRET',
    }, [route], {
      resolve: async (reference: string) => ({
        value: reference === 'TEST_APP_ID' ? 'test-app' : 'test-secret',
        source: 'test',
      }),
    })
    const runtime = new FeishuRuntime(ctx, config, gateway, platform)

    await expect(runtime.start()).rejects.toThrow('outbound registration failed')
    expect(transportDisposed).toBe(1)
    expect(disconnectCount).toBe(1)
    await runtime.dispose()
    await ctx.fiber.dispose()
  })

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
    let disconnectStarted!: () => void
    let releaseDisconnect!: () => void
    const disconnectReached = new Promise<void>(resolve => { disconnectStarted = resolve })
    const disconnectReleased = new Promise<void>(resolve => { releaseDisconnect = resolve })
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
        disconnectStarted()
        await disconnectReleased
        connected = false
      },
      async sendText() { return { messageId: 'unused' } },
      async sendCard() { return { messageId: 'unused' } },
      async downloadMessageResource() { throw new Error('unused') },
    }
    const config = await resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: [],
      appIdEnv: 'TEST_APP_ID',
      appSecretEnv: 'TEST_APP_SECRET',
    }, {
      resolve: async (reference: string) => ({
        value: reference === 'TEST_APP_ID' ? 'test-app' : 'test-secret',
        source: 'test',
      }),
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
    const firstDispose = runtime.dispose()
    await disconnectReached
    const secondDispose = runtime.dispose()
    expect(secondDispose).toBe(firstDispose)
    releaseDisconnect()
    await expect(firstDispose).rejects.toThrow('Gateway already stopped')
    expect(connected).toBe(false)
    expect(disconnectCount).toBe(1)
    expect(outboundDisposed).toBe(true)
    expect(transportDisposed).toBe(true)
    await ctx.fiber.dispose()
  })
})
