export const name = 'evoforge-feishu-browser-workspace-bootstrap'
export const inject = ['agents', 'agentPresets', 'workspaceRegistry']

/** Browser-only fixture: DSH creates and owns the Workspace, Session, and Agent. */
export async function apply(ctx, config) {
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Feishu Setup')
  let handle
  let agent = ctx.agents.get(config.sessionId)
  if (agent === undefined) {
    handle = await ctx.agents.create({
      sessionId: config.sessionId,
      meta: { cwd: workspace.path, agentPreset: config.agentPreset },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-chat' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
    })
    agent = handle.agent
  }
  await workspace.attachSession(agent.session.id)
  ctx.effect(() => async () => handle?.dispose(), 'evoforge-feishu-browser-workspace-bootstrap.dispose')
}
