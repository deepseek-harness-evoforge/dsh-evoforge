import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { apply } from '../src/index.js'

describe('dsh-gateway Bundle lifecycle', () => {
  it('keeps the original startup error when Bundle cleanup fails', async () => {
    const logger = { warn: vi.fn() }
    const context = {
      storageDomain: failingFacility(),
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

    await expect(apply(context, { pairing: { enabled: false } })).rejects
      .toThrow('startup validation failed')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('startup cleanup failed'))
  })
})

function failingFacility(): DomainFacility {
  const table = {
    size: 0,
    get: () => undefined,
    entries: () => new Map().entries(),
    keys: () => new Map().keys(),
    async put() {},
    async delete() { return false },
    async update() { throw new Error('unexpected table update') },
  }
  return {
    async open() {
      return {
        name: 'dsh_gateway_test',
        global: { get: () => ({}), async set() {} },
        table: () => table,
        async close() { throw new Error('journal close failed') },
      }
    },
  } as unknown as DomainFacility
}
