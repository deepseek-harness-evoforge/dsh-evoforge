import { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import * as GatewayPlugin from '../src/index.js'

describe('dsh-gateway Bundle lifecycle', () => {
  it('rejects invalid routes before opening any storage domain', async () => {
    const domains = trackedFacility()
    const context = { storageDomain: domains.facility } as Context

    await expect(GatewayPlugin.apply(context, {
      routes: [{
        id: 'Invalid Route',
        adapter: 'telegram',
        accountId: 'bot-a',
        conversationId: 'chat-a',
        userId: 'user-a',
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        agentPreset: 'standard',
        provider: 'mock',
        model: 'mock-a',
      }],
      pairing: { enabled: false },
    })).rejects.toThrow('route id has an invalid shape')

    expect(domains.closes).toHaveLength(0)
  })

  it('publishes only the read-only ingress evidence source and removes it with the Bundle', async () => {
    const domains = trackedFacility()
    const ctx = runtimeContext(domains.facility)
    const fiber = await ctx.plugin(GatewayPlugin, { pairing: { enabled: false } })

    const source = ctx.get('evoforge.gatewayIngressEvidence')
    expect(source).toBeDefined()
    expect(Object.keys(source!)).toEqual(['resolveIngressEvidence'])
    expect(source).not.toHaveProperty('retain')
    expect(source).not.toHaveProperty('close')
    expect(GatewayPlugin).not.toHaveProperty('openGatewayIngressEvidenceVault')
    expect(GatewayPlugin).not.toHaveProperty('createGatewayIngressEvidenceSource')

    await fiber.dispose()

    expect(ctx.get('evoforge.gatewayIngressEvidence')).toBeUndefined()
    expect(domains.closes).toHaveLength(3)
    for (const close of domains.closes) expect(close).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('preserves an outbound-open error when ingress cleanup also rejects', async () => {
    const domains = trackedFacility(0, 1)
    const logger = { warn: vi.fn() }
    const context = {
      storageDomain: domains.facility,
      logger,
    } as unknown as Context

    await expect(GatewayPlugin.apply(context, { pairing: { enabled: false } })).rejects
      .toThrow('outbound journal open failed')
    expect(domains.closes).toHaveLength(1)
    expect(domains.closes[0]).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(
      'startup cleanup failed: journal close failed',
    ))
  })

  it('keeps the original startup error when Bundle cleanup fails', async () => {
    const domains = trackedFacility(2)
    const logger = { warn: vi.fn() }
    const context = {
      storageDomain: domains.facility,
      sessionPersistence: {
        async list() { throw new Error('startup validation failed') },
      },
      workspaceRegistry: { get: () => undefined },
      agents: { get: () => undefined },
      agentPresets: {
        async resolve(id: string) { return { id } },
        async mount() {},
        composedPreset: () => undefined,
      },
      commands: { list: () => [], execute: async () => undefined },
      on: () => () => {},
      emit: () => {},
      effect: vi.fn(),
      provide: vi.fn(),
      logger,
    } as unknown as Context

    await expect(GatewayPlugin.apply(context, { pairing: { enabled: false } })).rejects
      .toThrow('startup validation failed')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('startup cleanup failed'))
    expect(context.effect).not.toHaveBeenCalled()
    expect(context.provide).not.toHaveBeenCalled()
    expect(domains.closes).toHaveLength(3)
    for (const close of domains.closes) expect(close).toHaveBeenCalledOnce()
  })
})

function runtimeContext(facility: DomainFacility): Context {
  const ctx = new Context()
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', { async list() { return [] } } as never)
  ctx.provide('workspaceRegistry', { get: () => undefined } as never)
  ctx.provide('agents', { get: () => undefined } as never)
  ctx.provide('agentPresets', {
    async resolve(id: string) { return { id } },
    async mount() {},
    composedPreset: () => undefined,
  } as never)
  ctx.provide('commands', { list: () => [], execute: async () => undefined } as never)
  ctx.provide('sessions', {} as never)
  return ctx
}

function trackedFacility(failingClose?: number, failingOpen?: number): {
  facility: DomainFacility
  closes: ReturnType<typeof vi.fn<() => Promise<void>>>[]
} {
  const closes: ReturnType<typeof vi.fn<() => Promise<void>>>[] = []
  let opens = 0
  const table = {
    size: 0,
    get: () => undefined,
    entries: () => new Map().entries(),
    keys: () => new Map().keys(),
    async put() {},
    async delete() { return false },
    async update() { throw new Error('unexpected table update') },
  }
  const facility = {
    async open() {
      const index = opens
      opens += 1
      if (index === failingOpen) throw new Error('outbound journal open failed')
      const close = vi.fn(async () => {
        if (index === failingClose) throw new Error('journal close failed')
      })
      closes.push(close)
      return {
        name: 'dsh_gateway_test',
        global: { get: () => ({}), async set() {} },
        table: () => table,
        close,
      }
    },
  } as unknown as DomainFacility
  return { facility, closes }
}
