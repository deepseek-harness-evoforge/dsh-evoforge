import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalRoundDriver from '@deepseek-ai/dsh-goal-round-driver'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ContinuityPlugin from '../../src/index.js'

class RecordingAdapter extends LlmAdapter {
  requests = 0

  resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream() {
    this.requests += 1
    yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
    yield { type: 'text-delta' as const, index: 0, text: 'Recovered one bounded round.' }
    yield {
      type: 'block-end' as const,
      index: 0,
      block: { type: 'text' as const, text: 'Recovered one bounded round.' },
    }
    yield { type: 'usage' as const, usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for recovered Goal')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function main(): Promise<void> {
  const [mode, persistenceRoot, dshSourceDir] = process.argv.slice(2)
  if ((mode !== 'seed' && mode !== 'resume')
    || persistenceRoot === undefined
    || dshSourceDir === undefined) {
    throw new Error('usage: crash-resume.ts <seed|resume> <persistence-root> <dsh-source-dir>')
  }

  const sessionId = SessionId('continuity-sigkill')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { persona: 'Goal continuity SIGKILL test.' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const { default: JsonlSessionPersistence } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'session', 'session-persistence-jsonl', 'lib', 'index.js'),
  ).href)
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })

  if (mode === 'seed') {
    await ctx.plugin(AgentLoop, { agents: [] })
    const handle = await ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'continuity', model: 'continuity' },
    })
    ctx.goals.create(handle.agent, {
      objective: 'Resume after the host process is killed.',
      maxGoalRounds: 1,
    })
    await ctx.sessions.flush(handle.agent.session)
    process.stdout.write('READY\n')
    setInterval(() => {}, 60_000)
    return
  }

  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['continuity'], adapter)
  await ctx.plugin(GoalRoundDriver)
  await ctx.plugin(ContinuityPlugin, { autoResumeSessionIds: [String(sessionId)] })
  await ctx.plugin(AgentLoop, { agents: [] })
  const handle = await ctx.agents.resume({
    resumeSessionId: sessionId,
    agentOptions: { provider: 'continuity', model: 'continuity' },
  })
  await waitFor(() => adapter.requests === 1)
  await handle.agent.whenIdle()
  await waitFor(() => ctx.goals.get(handle.agent)?.phase === 'blocked')
  const goal = ctx.goals.get(handle.agent)
  await ctx.fiber.dispose()
  process.stdout.write(`${JSON.stringify({ requests: adapter.requests, goal })}\n`)
}

await main()
