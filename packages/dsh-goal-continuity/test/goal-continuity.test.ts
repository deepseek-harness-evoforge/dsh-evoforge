import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as ContinuityPlugin from '../src/index.js'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('dsh-goal-continuity', () => {
  it('rearms only an allowlisted active native Goal after a cold Session resume', async () => {
    const allowed = await harness('allowed-session', ['allowed-session'])
    const goal = allowed.ctx.goals.create(allowed.agent, {
      objective: 'Finish the verified delivery.',
      maxGoalRounds: 3,
    })
    allowed.ctx.goals.disarm(allowed.agent)

    agentEvents(allowed.ctx, allowed.agent).emit('agent/session-start', { source: 'resume' })

    expect(allowed.ctx.goals.get(allowed.agent)).toMatchObject({
      id: goal.id,
      revision: goal.revision + 1,
      phase: 'active',
      activation: 'armed',
      roundsStarted: 0,
      maxGoalRounds: 3,
    })

    const denied = await harness('other-session', ['allowed-session'])
    const deniedGoal = denied.ctx.goals.create(denied.agent, { objective: 'Stay disarmed.' })
    denied.ctx.goals.disarm(denied.agent)
    agentEvents(denied.ctx, denied.agent).emit('agent/session-start', { source: 'resume' })
    expect(denied.ctx.goals.get(denied.agent)).toMatchObject({
      id: deniedGoal.id,
      revision: deniedGoal.revision,
      phase: 'active',
      activation: 'disarmed',
    })
  })

  it.each(['paused', 'blocked', 'complete'] as const)(
    'does not override an allowlisted %s Goal',
    async (phase) => {
      const test = await harness(`phase-${phase}`, [`phase-${phase}`])
      const created = test.ctx.goals.create(test.agent, { objective: `Remain ${phase}.` })
      const terminal = phase === 'paused'
        ? test.ctx.goals.pause(test.agent, created)
        : phase === 'blocked'
          ? test.ctx.goals.block(test.agent, created, { code: 'needs-human', message: 'Human input is required.' })
          : test.ctx.goals.complete(test.agent, created)

      agentEvents(test.ctx, test.agent).emit('agent/session-start', { source: 'resume' })

      expect(test.ctx.goals.get(test.agent)).toMatchObject({
        id: terminal.id,
        revision: terminal.revision,
        phase,
        activation: 'disarmed',
      })
    },
  )

  it('ignores fresh startup edges and stops acting after plugin disposal', async () => {
    const test = await harness('lifecycle-session', ['lifecycle-session'])
    const created = test.ctx.goals.create(test.agent, { objective: 'Require a real cold resume.' })
    test.ctx.goals.disarm(test.agent)

    agentEvents(test.ctx, test.agent).emit('agent/session-start', { source: 'startup' })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      revision: created.revision,
      activation: 'disarmed',
    })

    await test.plugin.dispose()
    agentEvents(test.ctx, test.agent).emit('agent/session-start', { source: 'resume' })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      revision: created.revision,
      activation: 'disarmed',
    })
  })

  it.each([
    { ids: ['', 'allowed'], error: 'non-empty' },
    { ids: ['x'.repeat(513)], error: 'at most 512 bytes' },
    { ids: ['duplicate', 'duplicate'], error: 'unique' },
    { ids: Array.from({ length: 51 }, (_, index) => `session-${index}`), error: 'array length <= 50' },
  ])('rejects invalid deployment authority before registering: $ids', async ({ ids, error }) => {
    const ctx = await coreContext()
    await expect(ctx.plugin(ContinuityPlugin, { autoResumeSessionIds: ids }))
      .rejects.toThrow(error)
  })
})

async function harness(sessionId: string, allowlist: string[]): Promise<{
  ctx: Context
  agent: Agent
  handle: AgentHandle
  plugin: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = await coreContext()
  const plugin = await ctx.plugin(ContinuityPlugin, { autoResumeSessionIds: allowlist })
  const handle = await ctx.agents.create({ sessionId: SessionId(sessionId) })
  return { ctx, agent: handle.agent, handle, plugin }
}

async function coreContext(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}
