import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { describe, expect, it } from 'vitest'
import * as DeliveryPlugin from '../src/index.js'

describe('dsh-software-delivery Skill plugin', () => {
  it('adds one stable on-demand software-delivery Skill and removes it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const before = await ctx.skills.list()
    const fiber = await ctx.plugin(DeliveryPlugin)

    const firstCatalog = await ctx.skills.list()
    const secondCatalog = await ctx.skills.list()
    expect(secondCatalog).toEqual(firstCatalog)
    expect(firstCatalog).toEqual([
      ...before,
      expect.objectContaining({
        name: 'software-delivery',
        source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true },
      }),
    ])

    const skill = await ctx.skills.get('software-delivery')
    expect(skill?.content).toContain('Use the native DSH Goal')
    expect(skill?.content).toContain('linked Git worktree')
    expect(skill?.content).toContain('dsh-delivery verify')
    expect(skill?.content).toContain('Draft PR')
    expect(skill?.content).toContain('Never merge, release, deploy, read secrets')

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual(before)
  })
})
