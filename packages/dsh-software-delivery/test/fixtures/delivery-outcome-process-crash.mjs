import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [mode, root, dshSourceDir, suiteRoot] = process.argv.slice(2)
if (!['before-session-durable', 'after-session-durable', 'inspect'].includes(mode)
  || root === undefined || dshSourceDir === undefined || suiteRoot === undefined) {
  throw new Error('usage: delivery-outcome-process-crash <before-session-durable|after-session-durable|inspect> <root> <dsh-source> <suite-root>')
}

const sourcePackage = path => pathToFileURL(join(dshSourceDir, 'packages', path, 'lib', 'index.js')).href
const evolveSource = pathToFileURL(join(suiteRoot, 'packages', 'dsh-evolve', 'src', 'delivery-outcome-monitor.ts')).href
const deliverySource = pathToFileURL(join(suiteRoot, 'packages', 'dsh-software-delivery', 'src', 'index.ts')).href
const workspaceId = '6cc3ea57-9f8d-4ad8-b82a-36f1cd2d7af4'
const sessionIdValue = 'delivery-outcome-process-crash'
const sessionsRoot = join(root, 'sessions')
const storageRoot = join(root, 'storage')

const [
  { Context },
  llm,
  session,
  systemPrompt,
  tools,
  skill,
  agent,
  goal,
  toolGoal,
  sessionProjections,
  agentLoop,
  persistence,
  storage,
  storageJson,
  storageDomain,
  subprocessLocal,
  shellEnv,
  bashLocal,
  toolBash,
  evolve,
] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import(sourcePackage('llm/llm')),
  import(sourcePackage('core/session')),
  import(sourcePackage('core/system-prompt')),
  import(sourcePackage('core/tools')),
  import(sourcePackage('skill/skill')),
  import(sourcePackage('core/agent')),
  import(sourcePackage('goal/goal')),
  import(sourcePackage('goal/tool-goal')),
  import(sourcePackage('session/session-projection')),
  import(sourcePackage('core/agent-loop')),
  import(sourcePackage('session/session-persistence-jsonl')),
  import(sourcePackage('storage/storage')),
  import(sourcePackage('storage/storage-json')),
  import(sourcePackage('storage/storage-domain')),
  import(sourcePackage('subprocess/subprocess-local')),
  import(sourcePackage('shell/shell-env')),
  import(sourcePackage('shell/bash-local')),
  import(sourcePackage('shell/tool-bash')),
  import(evolveSource),
])

const ctx = new Context()
await ctx.plugin(storage.default)
await ctx.plugin(storageJson, { root: storageRoot })
await ctx.plugin(storageDomain, { backend: 'json' })
await ctx.plugin(llm.default)
await ctx.plugin(session.default)
await ctx.plugin(persistence.default, {
  root: sessionsRoot,
  compression: 'none',
  writeBatchMaxDelayMs: 60_000,
})
await ctx.plugin(systemPrompt.default, { persona: 'Delivery Outcome process crash fixture.' })
await ctx.plugin(tools.default)
await ctx.plugin(skill.default)
await ctx.plugin(agent.default)
await ctx.plugin(sessionProjections.default)
await ctx.plugin(goal.default)
await ctx.plugin(toolGoal, {})
await ctx.plugin(agentLoop.default, { agents: [] })
ctx.provide('workspaceRegistry', {
  resolveByPath: async () => ({ id: workspaceId }),
})

const outcomes = await evolve.openDeliveryOutcomeStore(ctx.storageDomain)
const generation = { getSessionGeneration: () => undefined }

if (mode === 'before-session-durable') {
  let announced = false
  const persistence = ctx.sessionPersistence
  // Alpha5 keeps the durable write seam on the backend adapter owned by the
  // coordinator; older assembled artifacts exposed it as `persistBatch` on
  // the backend itself. Resolve both shapes so this fixture fails loudly when
  // the current DSH backend no longer provides a durable interception seam.
  const backend = persistence.coordinator?.backend ?? persistence
  const appendBatch = backend.appendBatch ?? backend.persistBatch
  if (typeof appendBatch !== 'function') throw new Error('alpha5 persistence appendBatch seam is unavailable')
  const boundAppendBatch = appendBatch.bind(backend)
  backend.appendBatch = async (storage, events, isMaterialized, ...rest) => {
    if (!announced) {
      announced = true
      process.stdout.write('BEFORE_SESSION_DURABLE\n')
    }
    await new Promise(() => {})
  }
  evolve.installDeliveryOutcomeMonitor(ctx, outcomes, generation)
  await runDelivery(ctx, { root })
  setInterval(() => {}, 60_000)
} else if (mode === 'after-session-durable') {
  const blockedOutcomes = {
    record: async () => {
      process.stdout.write('AFTER_SESSION_DURABLE\n')
      await new Promise(() => {})
    },
    list: workspaceId => outcomes.list(workspaceId),
    summarize: (...args) => outcomes.summarize(...args),
    close: () => outcomes.close(),
  }
  evolve.installDeliveryOutcomeMonitor(ctx, blockedOutcomes, generation)
  await runDelivery(ctx, { root })
  setInterval(() => {}, 60_000)
} else {
  const effectCount = await readEffectCount(join(root, 'external-effects.log'))
  const sessionPresent = (await ctx.sessionPersistence.list())
    .some(snapshot => (snapshot.header ?? snapshot).id === sessionIdValue)
  if (!sessionPresent) {
    process.stdout.write(`${JSON.stringify({ effectCount, outcomeCount: outcomes.list().length, sessionPresent: false })}\n`)
    await outcomes.close()
    await ctx.fiber.dispose()
  } else {
    const monitor = evolve.installDeliveryOutcomeMonitor(ctx, outcomes, generation)
    class RecoveryAdapter extends llm.LlmAdapter {
      requests = 0
      resolveModel(provider, model) {
        return Promise.resolve({ provider, id: model, name: model })
      }
      async * stream() {
        this.requests += 1
        throw new Error('cold Outcome replay must not call the model')
      }
    }
    const adapter = new RecoveryAdapter()
    ctx.llm.registerAdapter(['delivery-crash'], adapter)
    const handle = await ctx.agents.resume({
      resumeSessionId: session.SessionId(sessionIdValue),
      agentOptions: { provider: 'delivery-crash', model: 'delivery-crash' },
    })
    await monitor.flush()
    const events = typeof handle.agent.session.snapshotEvents === 'function'
      ? handle.agent.session.snapshotEvents()
      : handle.agent.session.events
    const result = {
      effectCount,
      goalPhase: ctx.goals.get(handle.agent)?.phase,
      modelRequests: adapter.requests,
      outcomeCount: outcomes.list().length,
      sessionPresent: true,
      toolCalls: events.filter(event => event.type === 'tool/call' && event.data.name === 'complete_delivery').length,
      toolResults: events.filter(event => event.type === 'tool/result'
        && event.data.message.source.callId === 'delivery-outcome-call').length,
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    await monitor.dispose()
    await outcomes.close()
    await ctx.fiber.dispose()
  }
}

async function runDelivery(ctx, { root }) {
  const fixture = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8'))
  await ctx.plugin(subprocessLocal.default)
  await ctx.plugin(shellEnv)
  await ctx.plugin(bashLocal.default, { cwd: fixture.worktree, timeoutMs: 10_000 })
  await ctx.plugin(toolBash, { enableRunInBackground: false })
  const delivery = await import(deliverySource)
  await ctx.plugin(delivery)
  const callArguments = {
    goal_id: 'set-after-goal-create',
    revision: 0,
    worktree: fixture.worktree,
    base_ref: fixture.baseRef,
    checks: [{
      name: 'external-effect-probe',
      argv: [
        process.execPath,
        '-e',
        "require('node:fs').appendFileSync(process.argv[1], 'complete_delivery\\n')",
        fixture.effectPath,
      ],
    }],
  }
  class DeliveryAdapter extends llm.LlmAdapter {
    requests = 0
    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model })
    }
    async * stream() {
      this.requests += 1
      if (this.requests === 1) {
        const input = JSON.stringify(callArguments)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: llm.ToolCallId('delivery-outcome-call'),
          name: 'complete_delivery',
          argumentsDelta: input,
        }
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: llm.ToolCallId('delivery-outcome-call'),
            name: 'complete_delivery',
            arguments: input,
          },
        }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'delivery completed' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'delivery completed' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new DeliveryAdapter()
  ctx.llm.registerAdapter(['delivery-crash'], adapter)
  const handle = await ctx.agents.create({
    sessionId: session.SessionId(sessionIdValue),
    agentOptions: { provider: 'delivery-crash', model: 'delivery-crash' },
    meta: { cwd: resolve(fixture.worktree) },
  })
  const nativeGoal = ctx.goals.create(handle.agent, { objective: 'Complete delivery exactly once across a crash.' })
  callArguments.goal_id = String(nativeGoal.id)
  callArguments.revision = nativeGoal.revision
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: 'Complete the verified delivery.' }],
    source: { kind: 'user' },
  }))
}

async function readEffectCount(path) {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).length
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
}
