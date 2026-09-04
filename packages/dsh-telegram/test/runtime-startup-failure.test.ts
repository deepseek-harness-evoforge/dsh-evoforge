import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { DshGateway } from 'dsh-evoforge-gateway'
import { resolveTelegramConfig, resolveTelegramPairingConfig } from '../src/config.js'
import { TelegramPairingRuntime } from '../src/pairing-runtime.js'
import { TelegramRuntime } from '../src/runtime.js'
import type { TelegramApi } from '../src/telegram-api.js'

describe('Telegram runtime startup boundaries', () => {
  it('cleans up a registered transport when static startup fails', async () => {
    const ctx = new Context()
    let transportDisposed = 0
    const route = {
      id: 'telegram-start-failure',
      adapter: 'telegram' as const,
      accountId: 'test-bot',
      conversationId: '1001',
      userId: '2002',
      workspaceId: 'workspace-test',
      sessionId: 'session-test',
      agentPreset: 'test',
      provider: 'test',
      model: 'test',
      endpointKey: '["telegram","test-bot","1001",null,"2002"]',
    }
    const agent = {
      id: route.sessionId,
      session: { id: route.sessionId },
      ctx: {
        inject(_deps: readonly string[], callback: (value: unknown) => unknown) {
          callback({ commands: { register: () => undefined } })
        },
      },
    }
    const config = resolveTelegramConfig({
      routeId: route.id,
      tokenEnv: 'TEST_TELEGRAM_TOKEN',
      apiBase: 'http://127.0.0.1',
    }, route)
    const gateway = {
      resolve: async () => agent,
      registerTransport: () => ({
        report: () => undefined,
        dispose: () => { transportDisposed += 1 },
      }),
      registerTextAdapter: () => { throw new Error('outbound registration failed') },
    } as unknown as DshGateway
    const runtime = new TelegramRuntime(ctx, config, gateway, {} as TelegramApi)

    await expect(runtime.start()).rejects.toThrow('outbound registration failed')
    expect(transportDisposed).toBe(1)
    await runtime.dispose()
    await ctx.fiber.dispose()
  })

  it('does not register pairing resources twice when start is repeated', async () => {
    const ctx = new Context()
    let transportRegistrations = 0
    let adapterRegistrations = 0
    let transportDisposed = 0
    let adapterDisposed = 0
    const config = resolveTelegramPairingConfig({
      mode: 'pairing',
      accountId: 'test-bot',
      tokenEnv: 'TEST_TELEGRAM_TOKEN',
      apiBase: 'http://127.0.0.1',
    })
    const gateway = {
      registerTransport: () => {
        transportRegistrations += 1
        return { report: () => undefined, dispose: () => { transportDisposed += 1 } }
      },
      registerTextAdapter: () => {
        adapterRegistrations += 1
        return { dispose: async () => { adapterDisposed += 1 } }
      },
    } as unknown as DshGateway
    const runtime = new TelegramPairingRuntime(ctx, config, gateway, {} as TelegramApi)

    await runtime.start()
    await runtime.start()
    expect(transportRegistrations).toBe(1)
    expect(adapterRegistrations).toBe(1)
    await runtime.dispose()
    expect(transportDisposed).toBe(1)
    expect(adapterDisposed).toBe(1)
    await ctx.fiber.dispose()
  })
})
