import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { DshGateway } from 'dsh-evoforge-gateway'

vi.mock('../src/feishu-credentials-remote.js', () => ({ FeishuCredentialRemoteService: class {} }))
const platformState = vi.hoisted(() => ({ fail: true, disconnected: 0 }))
vi.mock('../src/platform.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/platform.js')>(),
  createOfficialFeishuPairingPlatform: () => ({
    onMessage: () => () => {}, onApprovalAction: () => () => {}, onError: () => () => {},
    connect: async () => {
      if (platformState.fail) throw new Error('could not resolve bot identity: private-provider-detail')
    },
    disconnect: async () => { platformState.disconnected += 1 },
  }),
}))
import { apply } from '../src/index.js'

describe('Feishu startup fault isolation', () => {
  it('still rejects invalid Host configuration instead of disguising it as an offline channel', async () => {
    const ctx = new Context()
    ctx.provide('evoforge.gateway' as never, { route: () => undefined } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'fake', source: 'test' }) } as never)
    await expect(apply(ctx, { mode: 'routes', routeIds: [] })).rejects.toThrow(/routeIds/u)
    await ctx.fiber.dispose()
  })

  it('keeps Host load successful and degraded health visible; native reload recovers', async () => {
    platformState.fail = true
    platformState.disconnected = 0
    const active = new Set<{ state: string }>()
    const gateway = {
      registerTransport: (config: { initial: { state: string } }) => {
        const status = { ...config.initial }
        active.add(status)
        return { report: (value: { state: string }) => Object.assign(status, value), dispose: () => active.delete(status) }
      },
      registerTextAdapter: () => ({ dispose: async () => {} }),
    } as unknown as DshGateway
    const boot = async () => {
      const ctx = new Context()
      ctx.provide('evoforge.gateway' as never, gateway as never)
      ctx.provide('credentials', { resolve: async () => ({ value: 'fake-local-credential', source: 'test' }) } as never)
      const warnings = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
      try {
        await apply(ctx, { mode: 'pairing' })
        return { ctx, warnings }
      } catch (error) {
        await ctx.fiber.dispose().catch(() => {})
        throw error
      }
    }
    const failed = await boot()
    expect([...active].map(x => x.state)).toEqual(['degraded'])
    expect(platformState.disconnected).toBe(1)
    expect(JSON.stringify(failed.warnings.mock.calls)).not.toContain('private-provider-detail')
    await failed.ctx.fiber.dispose()
    expect(active.size).toBe(0)
    platformState.fail = false
    const recovered = await boot()
    expect([...active].map(x => x.state)).toEqual(['ready'])
    await recovered.ctx.fiber.dispose()
    expect(active.size).toBe(0)
  })
})
