import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import * as DoctorPlugin from '../src/index.js'

describe('dsh-doctor runtime plugin', () => {
  it('adds one zero-argument human command and removes it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(CommandRuntime)
    const agent = {} as Agent
    const before = ctx.commands.list(agent)

    const fiber = await ctx.plugin(DoctorPlugin, { requiredModules: [] })

    expect(ctx.commands.list(agent)).toEqual([
      ...before,
      expect.objectContaining({
        name: 'doctor',
        description: expect.stringContaining('readiness'),
      }),
    ])
    const command = ctx.commands.find(agent, 'doctor')
    const result = await command?.handler({
      commandId: 'fixture-command' as never,
      agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(result).toEqual({
      kind: 'success',
      text: [
        'DSH readiness: READY',
        '✓ required-plugins: 0 required plugins are active.',
        '✓ runtime-failures: No enabled plugin is failed.',
      ].join('\n'),
    })

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual(before)
    await ctx.fiber.dispose()
  })

  it('reads the existing Gateway health seam when a required Feishu Adapter is active', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(CommandRuntime)
    vi.spyOn(ctx.loader, 'entries').mockImplementation(function* () {
      yield {
        id: 'feishu-entry',
        options: { name: 'dsh-feishu', group: false },
        disabled: false,
        fiber: { state: 2 },
      } as never
    })
    ctx.provide('evoforge.gateway' as never, Object.freeze({
      healthSnapshot: () => ({
        lifecycle: 'ready',
        transports: { items: [{ adapter: 'feishu', state: 'degraded' }] },
      }),
    }) as never)
    await ctx.plugin(DoctorPlugin, { requiredModules: ['dsh-feishu'] })

    const command = ctx.commands.find({} as Agent, 'doctor')
    const result = await command?.handler({
      commandId: 'fixture-channel-command' as never,
      agent: {} as Agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })

    expect(result?.text).toContain('DSH readiness: NOT READY')
    expect(result?.text).toContain('✗ channel-feishu: Required Feishu transport is degraded.')
    await ctx.fiber.dispose()
  })

  it('reads the same Gateway health seam for a required Telegram Adapter', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(CommandRuntime)
    vi.spyOn(ctx.loader, 'entries').mockImplementation(function* () {
      yield {
        id: 'telegram-entry',
        options: { name: 'dsh-telegram', group: false },
        disabled: false,
        fiber: { state: 2 },
      } as never
    })
    ctx.provide('evoforge.gateway' as never, Object.freeze({
      healthSnapshot: () => ({
        lifecycle: 'ready',
        transports: { items: [{ adapter: 'telegram', state: 'ready' }] },
      }),
    }) as never)
    await ctx.plugin(DoctorPlugin, { requiredModules: ['dsh-telegram'] })

    const command = ctx.commands.find({} as Agent, 'doctor')
    const result = await command?.handler({
      commandId: 'fixture-telegram-command' as never,
      agent: {} as Agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })

    expect(result?.text).toContain('DSH readiness: READY')
    expect(result?.text).toContain('✓ channel-telegram: 1 required Telegram transport is ready.')
    await ctx.fiber.dispose()
  })

  it('fails closed when the Gateway health service returns a malformed snapshot', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    await ctx.plugin(CommandRuntime)
    vi.spyOn(ctx.loader, 'entries').mockImplementation(function* () {
      yield {
        id: 'feishu-entry',
        options: { name: 'dsh-feishu', group: false },
        disabled: false,
        fiber: { state: 2 },
      } as never
    })
    ctx.provide('evoforge.gateway' as never, Object.freeze({
      healthSnapshot: () => ({ lifecycle: 'ready' }),
    }) as never)
    await ctx.plugin(DoctorPlugin, { requiredModules: ['dsh-feishu'] })

    const command = ctx.commands.find({} as Agent, 'doctor')
    const result = await command?.handler({
      commandId: 'fixture-malformed-gateway-command' as never,
      agent: {} as Agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    })

    expect(result?.text).toContain('DSH readiness: NOT READY')
    expect(result?.text).toContain('Required Feishu transport is unavailable.')
    await ctx.fiber.dispose()
  })
})
