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
    let disposeStarted!: () => void
    let releaseDispose!: () => void
    const disposeReached = new Promise<void>(resolve => { disposeStarted = resolve })
    const disposeReleased = new Promise<void>(resolve => { releaseDispose = resolve })
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
        return {
          dispose: async () => {
            adapterDisposed += 1
            disposeStarted()
            await disposeReleased
          },
        }
      },
    } as unknown as DshGateway
    const runtime = new TelegramPairingRuntime(ctx, config, gateway, {} as TelegramApi)

    const firstStart = runtime.start()
    const secondStart = runtime.start()
    expect(secondStart).toBe(firstStart)
    await firstStart
    expect(transportRegistrations).toBe(1)
    expect(adapterRegistrations).toBe(1)
    const firstDispose = runtime.dispose()
    await disposeReached
    const secondDispose = runtime.dispose()
    expect(secondDispose).toBe(firstDispose)
    releaseDispose()
    await firstDispose
    expect(transportDisposed).toBe(1)
    expect(adapterDisposed).toBe(1)
    await ctx.fiber.dispose()
  })
})
