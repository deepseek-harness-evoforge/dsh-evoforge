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
    let transportRegistrations = 0
    let transportDisposals = 0
    let adapterDisposals = 0
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
          dispose: async () => { adapterDisposals += 1 },
        }
      },
    }
    const credentials = {
      resolve: async () => token === undefined ? undefined : { value: token, source: 'test' },
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

    token = 'test-token'
    ctx.emit('credentials/reference-updated', credentialRef('TEST_TELEGRAM_TOKEN'))
    await vi.waitFor(() => expect(transportRegistrations).toBe(1), { timeout: 2_000 })
    expect(transportDisposals).toBe(0)

    await ctx.fiber.dispose()
    expect(transportDisposals).toBe(1)
    expect(adapterDisposals).toBe(1)
  })
})
