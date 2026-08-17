import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const name = 'evoforge-browser-workspace-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

/** Browser-only fixture: DSH creates and owns the Workspace, Session, and Agent. */
export async function apply(ctx, config) {
  await mkdir(config.runRoot, { recursive: true })
  const evolvePlugin = await import(pathToFileURL(config.evolveEntry).href)
  const workspace = await ctx.workspaceRegistry.create(config.workspacePath, 'EvoForge Browser Acceptance')
  let handle
  let agent = ctx.agents.get(config.sessionId)
  if (agent === undefined) {
    handle = await ctx.agents.create({
      sessionId: config.sessionId,
      meta: { cwd: workspace.path, agentPreset: config.agentPreset },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, config.agentPreset).then(() => undefined),
    })
    agent = handle.agent
  }
  await workspace.attachSession(agent.session.id)

  const evolutionFiber = ctx.root.plugin(evolvePlugin, {
    cacheRoot: config.cacheRoot,
    supervisor: {
      runRoots: [{ workspaceId: String(workspace.id), path: config.runRoot }],
      scanIntervalMs: 30_000,
    },
  })
  await evolutionFiber
  ctx.effect(() => async () => {
    await evolutionFiber.dispose()
    await handle?.dispose()
  }, 'evoforge-browser-workspace-bootstrap.dispose')
}
