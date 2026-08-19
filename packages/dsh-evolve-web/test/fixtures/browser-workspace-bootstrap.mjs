import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const name = 'evoforge-browser-workspace-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'sessions',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

/** Browser-only fixture: DSH creates and owns the Workspace, Session, and Agent. */
export async function apply(ctx, config) {
  await mkdir(config.runRoot, { recursive: true })
  const evolvePlugin = await import(pathToFileURL(config.evolveEntry).href)
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Browser Acceptance')
  const evolutionFiber = ctx.root.plugin(evolvePlugin, {
    cacheRoot: config.cacheRoot,
    supervisor: {
      runRoots: [{ workspaceId: String(workspace.id), path: config.runRoot }],
      scanIntervalMs: 30_000,
    },
  })
  await evolutionFiber

  let handle
  let agent = ctx.agents.get(config.sessionId)
  if (agent === undefined) {
    const persisted = (await ctx.sessionPersistence.list())
      .some(header => String(header.id) === String(config.sessionId))
    const common = {
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
    }
    handle = persisted
      ? await ctx.agents.resume({ resumeSessionId: config.sessionId, ...common })
      : await ctx.agents.create({
          sessionId: config.sessionId,
          meta: { cwd: workspace.path, agentPreset: config.agentPreset },
          ...common,
        })
    agent = handle.agent
  }
  await workspace.attachSession(agent.session.id)
  if (config.seedGoalMetrics === true) {
    await seedNativeGoalMetrics(ctx, workspace, agent)
  }
  ctx.effect(() => async () => {
    await evolutionFiber.dispose()
    await handle?.dispose()
  }, 'evoforge-browser-workspace-bootstrap.dispose')
}

/**
 * Commit one deterministic, test-owned native Session sequence so the real
 * browser acceptance covers DSH projection -> evolve Host -> Typert -> Web.
 * The sequence is idempotent across Host restart and never ships in the Bundle.
 */
async function seedNativeGoalMetrics(ctx, workspace, agent) {
  const session = agent.session
  const callId = 'evoforge-browser-goal-metrics'
  if (session.events.some(event => event.type === 'tool/call' && event.data.callId === callId)) {
    await waitForMeasuredOutcome(ctx, String(workspace.id), String(session.id))
    return
  }

  const goalId = 'goal-evoforge-browser-metrics'
  const lastEventTime = session.events.at(-1)?.time ?? 0
  const base = Math.max(Date.now(), lastEventTime + 100)
  appendAt(session, base, 'goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: {
      id: goalId,
      revision: 1,
      objective: 'Verify exact native DSH Goal execution metrics in the real Web control plane.',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 0,
    createdAt: base,
    updatedAt: base,
  })
  appendAt(session, base + 100, 'turn/start', { turn: 1 })
  appendAt(session, base + 110, 'step/start', { turn: 1, step: 1 })
  appendAt(session, base + 115, 'user/message', message({
    role: 'user',
    content: [{ type: 'text', text: 'Produce one verified delivery outcome.' }],
    source: { kind: 'goal', goalId, revision: 1, round: 1 },
  }), { surfaceOp: 'append' })
  const firstToken = appendAt(session, base + 130, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'Verified.' },
  })
  const usage = {
    inputTokens: 40,
    outputTokens: 8,
    cacheReadTokens: 30,
    cacheWriteTokens: 5,
  }
  const usageChunk = appendAt(session, base + 170, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage },
  })
  appendAt(session, base + 200, 'assistant/message', {
    turn: 1,
    step: 1,
    message: message({
      role: 'assistant',
      content: [{ type: 'text', text: 'Verified.' }],
      source: { kind: 'model', provider: 'browser-fixture', model: 'browser-fixture' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: [firstToken.seq, usageChunk.seq] })
  const call = appendAt(session, base + 210, 'tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: 'complete_delivery',
    arguments: '{}',
  })
  appendAt(session, base + 229, 'goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'complete',
    goal: {
      id: goalId,
      revision: 2,
      objective: 'Verify exact native DSH Goal execution metrics in the real Web control plane.',
      phase: 'complete',
      maxGoalRounds: 8,
    },
    roundsStarted: 1,
    createdAt: base,
    updatedAt: base + 229,
  })
  appendAt(session, base + 230, 'tool/result', {
    turn: 1,
    step: 1,
    message: message({
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{
          type: 'text',
          text: JSON.stringify({
            schemaVersion: 1,
            status: 'passed',
            reason: 'real DSH browser projection verified',
            goal: { id: goalId, revision: 2, phase: 'complete' },
            artifact: { commit: 'b'.repeat(40) },
          }),
        }],
        isError: false,
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  appendAt(session, base + 240, 'step/end', { turn: 1, step: 1 })
  appendAt(session, base + 250, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

  await ctx.sessions.flush(session)
  await waitForMeasuredOutcome(ctx, String(workspace.id), String(session.id))
}

function message(input) {
  return Object.freeze({ id: crypto.randomUUID(), ...input })
}

function appendAt(session, time, type, data, options) {
  const realNow = Date.now
  Date.now = () => time
  try {
    return session.append(type, data, options)
  } finally {
    Date.now = realNow
  }
}

async function waitForMeasuredOutcome(ctx, workspaceId, sessionId) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const control = ctx.get('evoforge.evolutionControl')
    const overview = await control?.overview(workspaceId, sessionId)
    if ((overview?.deliveryOutcomes?.metrics.all.measured ?? 0) > 0) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('real browser fixture did not project a measured native DSH delivery outcome')
}
