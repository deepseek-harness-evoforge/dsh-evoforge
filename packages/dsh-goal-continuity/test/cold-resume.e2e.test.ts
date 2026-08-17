import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as ContinuityPlugin from '../src/index.js'

const temporaryRoots: string[] = []
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('native Goal cold resume', () => {
  it('continues only an authorized Goal and preserves the manual-resume model request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-goal-continuity-'))
    temporaryRoots.push(root)
    const ids = {
      automatic: SessionId('continuity-automatic'),
      manual: SessionId('continuity-manual'),
      denied: SessionId('continuity-denied'),
    }
    const objective = 'Continue one bounded native Goal round.'

    const first = await core(root)
    try {
      for (const id of Object.values(ids)) {
        const handle = await first.agents.create({
          sessionId: id,
          agentOptions: { provider: 'continuity', model: 'continuity' },
        })
        first.goals.create(handle.agent, { objective, maxGoalRounds: 1 })
        await first.sessions.flush(handle.agent.session)
      }
    } finally {
      await first.fiber.dispose()
    }

    const adapter = new RecordingAdapter()
    const second = await core(root, adapter, [ids.automatic])
    try {
      const automatic = (await second.agents.resume({
        resumeSessionId: ids.automatic,
        agentOptions: { provider: 'continuity', model: 'continuity' },
      })).agent
      await expect.poll(() => adapter.requests.length).toBe(1)
      await automatic.whenIdle()
      await expect.poll(() => second.goals.get(automatic)?.phase).toBe('blocked')
      expect(second.goals.get(automatic)).toMatchObject({
        activation: 'disarmed',
        roundsStarted: 1,
        blockedReason: { code: 'round-limit' },
      })

      const manual = (await second.agents.resume({
        resumeSessionId: ids.manual,
        agentOptions: { provider: 'continuity', model: 'continuity' },
      })).agent
      expect(second.goals.get(manual)).toMatchObject({ phase: 'active', activation: 'disarmed' })
      expect(adapter.requests).toHaveLength(1)
      const manualGoal = second.goals.get(manual)
      if (manualGoal === undefined) throw new Error('manual Goal missing')
      second.goals.resume(manual, { id: manualGoal.id, revision: manualGoal.revision })
      await expect.poll(() => adapter.requests.length).toBe(2)
      await manual.whenIdle()
      await expect.poll(() => second.goals.get(manual)?.phase).toBe('blocked')

      const denied = (await second.agents.resume({
        resumeSessionId: ids.denied,
        agentOptions: { provider: 'continuity', model: 'continuity' },
      })).agent
      await settleIdle(denied)
      expect(second.goals.get(denied)).toMatchObject({
        phase: 'active',
        activation: 'disarmed',
        roundsStarted: 0,
      })
      expect(adapter.requests).toHaveLength(2)
      expect(cacheSurface(adapter.requests[0])).toEqual(cacheSurface(adapter.requests[1]))
    } finally {
      await second.fiber.dispose()
    }
  })
})

class RecordingAdapter extends LlmAdapter {
  readonly requests: unknown[] = []

  resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: unknown) {
    this.requests.push(structuredClone(options))
    yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
    yield { type: 'text-delta' as const, index: 0, text: 'One bounded round ran.' }
    yield {
      type: 'block-end' as const,
      index: 0,
      block: { type: 'text' as const, text: 'One bounded round ran.' },
    }
    yield { type: 'usage' as const, usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
}

async function core(
  persistenceRoot: string,
  adapter?: RecordingAdapter,
  autoResumeSessionIds: readonly SessionId[] = [],
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Goal continuity test.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const { default: JsonlSessionPersistence } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'session', 'session-persistence-jsonl', 'lib', 'index.js'),
  ).href)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
  if (adapter !== undefined) {
    ctx.llm.registerAdapter(['continuity'], adapter)
    await ctx.plugin(GoalRoundDriver)
    await ctx.plugin(ContinuityPlugin, {
      autoResumeSessionIds: autoResumeSessionIds.map(String),
    })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

async function settleIdle(agent: Agent): Promise<void> {
  await agent.whenIdle()
  await new Promise(resolve => setImmediate(resolve))
}

function cacheSurface(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('LLM request is not an object')
  }
  const request = value as Record<string, unknown>
  if (!Array.isArray(request.messages)) throw new Error('LLM request messages are missing')
  return {
    provider: request.provider,
    model: request.model,
    system: request.system,
    tools: request.tools,
    messages: request.messages.map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error('LLM request message is invalid')
      }
      const message = entry as Record<string, unknown>
      return { role: message.role, content: message.content }
    }),
  }
}
