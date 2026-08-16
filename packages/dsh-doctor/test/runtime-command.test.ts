import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
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
})
