import { mkdir } from 'node:fs/promises'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'evoforge-control-center-browser-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'sessions',
  'workspaceRegistry',
]

/** Test-only native DSH fixture: create one real Workspace/Session without a model call. */
export async function apply(ctx, config) {
  // WorkspaceRegistry resolves the path before creating its own metadata.
  // Make the standalone overlay self-contained so a clean-profile user can
  // run it without a pre-created fixture directory.
  await mkdir(config.workspacePath, { recursive: true })
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Control Center Browser')
  const handle = await ctx.agents.create({
    sessionId: config.sessionId,
    meta: { cwd: workspace.path, agentPreset: config.agentPreset },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
  })
  await workspace.attachSession(handle.agent.session.id)
  const session = handle.agent.session
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Control Center browser fixture.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Fixture ready.' }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
    usage: { inputTokens: 1, outputTokens: 1 },
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await ctx.sessions.flush(session)
  ctx.effect(() => async () => handle.dispose(), 'evoforge-control-center-browser-bootstrap.dispose')
}
