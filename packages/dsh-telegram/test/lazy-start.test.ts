import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

describe('Telegram native credential lifecycle', () => {
  let server: ReturnType<typeof createServer> | undefined

  afterEach(async () => {
    if (server === undefined) return
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    server = undefined
  })

  it('keeps the Host bootable without a token and starts the same route after a committed update', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, result: [] }))
    })
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject)
      server!.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Telegram test server did not bind')

    let token: string | undefined
    let resolveCalls = 0
    let blockResolution = false
    let releaseBlockedResolution: (() => void) | undefined
    let transportRegistrations = 0
    let transportDisposals = 0
    let adapterDisposals = 0
    let adapterDisposeStarted = 0
    let blockAdapterDisposal = false
    let releaseAdapterDisposal: (() => void) | undefined
    const route = Object.freeze({
      id: 'telegram-lazy',
      adapter: 'telegram',
      accountId: 'test-bot',
      conversationId: '1001',
      userId: '2002',
      workspaceId: 'workspace-test',
      sessionId: 'session-test',
      agentPreset: 'test',
      provider: 'test',
      model: 'test',
      endpointKey: '["telegram","test-bot","1001",null,"2002"]',
    })
    const agent = {
      id: route.sessionId,
      ctx: {
        inject(_deps: readonly string[], callback: (value: unknown) => unknown) {
          callback({ commands: { register: () => undefined } })
        },
      },
      session: { id: route.sessionId },
    }
    const gateway = {
      route: (id: string) => id === route.id ? route : undefined,
      resolve: async () => agent,
      registerTransport: () => {
        transportRegistrations += 1
        return { report: () => undefined, dispose: () => { transportDisposals += 1 } }
      },
      registerTextAdapter: () => {
        return {
          submit: async () => ({ id: 'b'.repeat(64), created: true, status: 'delivered' }),
          dispose: async () => {
            adapterDisposals += 1
            adapterDisposeStarted += 1
            if (blockAdapterDisposal) {
              await new Promise<void>(resolve => { releaseAdapterDisposal = resolve })
            }
          },
        }
      },
    }
    const credentials = {
      resolve: async () => {
        resolveCalls += 1
        const value = token
        if (blockResolution) {
          await new Promise<void>(resolve => { releaseBlockedResolution = resolve })
        }
        return value === undefined ? undefined : { value, source: 'test' }
      },
    }
    const ctx = new Context()
    ctx.provide('credentials' as never, credentials as never)
    ctx.provide('evoforge.gateway' as never, gateway as never)

    await apply(ctx, {
      mode: 'routes',
      routeId: route.id,
      tokenEnv: 'TEST_TELEGRAM_TOKEN',
      apiBase: `http://127.0.0.1:${address.port}`,
      pollTimeoutSeconds: 1,
    })
    expect(transportRegistrations).toBe(0)

    const hostRoute = ctx.get('evoforge.telegramRoute' as never) as unknown as {
      notify(input: { id: string; text: string }): Promise<unknown>
    }
    await expect(hostRoute.notify({ id: 'a'.repeat(64), text: 'not ready' })).rejects.toThrow(/not ready/u)

    // Two committed writes arrive while the first credential resolution is
    // still in flight. The old attempt must be discarded and the second value
    // must become the only live runtime.
    blockResolution = true
    blockAdapterDisposal = true
    token = 'old-token'
    ctx.emit('credentials/reference-updated', credentialRef('TEST_TELEGRAM_TOKEN'))
    await vi.waitFor(() => expect(resolveCalls).toBe(2), { timeout: 2_000 })
    token = 'new-token'
    blockResolution = false
    ctx.emit('credentials/reference-updated', credentialRef('TEST_TELEGRAM_TOKEN'))
    releaseBlockedResolution?.()
    await vi.waitFor(() => expect(adapterDisposeStarted).toBe(1), { timeout: 2_000 })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(transportRegistrations).toBe(1)
    blockAdapterDisposal = false
    releaseAdapterDisposal?.()
    await vi.waitFor(() => expect(transportRegistrations).toBe(2), { timeout: 2_000 })
    expect(transportDisposals).toBe(1)
    expect(adapterDisposals).toBe(1)

    await ctx.fiber.dispose()
    expect(transportDisposals).toBe(2)
    expect(adapterDisposals).toBe(2)
  })
})
