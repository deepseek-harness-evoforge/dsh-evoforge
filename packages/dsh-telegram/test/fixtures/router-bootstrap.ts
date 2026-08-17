import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-telegram-router-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'commands',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

interface Config {
  readonly routerEntry: string
  readonly workspacePath: string
  readonly routeId: string
  readonly accountId: string
  readonly conversationId: string
  readonly userId: string
  readonly sessionId: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
}

/** Real-Host test bootstrap: create the stable Workspace before loading the actual Router plugin. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const registry = (ctx as unknown as {
    workspaceRegistry: { create(path: string): Promise<{ id: unknown }> }
  }).workspaceRegistry
  const workspace = await registry.create(config.workspacePath)
  const router = await import(config.routerEntry) as {
    apply(ctx: Context, config: unknown): Promise<void>
  }
  await router.apply(ctx, {
    routes: [{
      id: config.routeId,
      adapter: 'telegram',
      accountId: config.accountId,
      conversationId: config.conversationId,
      userId: config.userId,
      workspaceId: String(workspace.id),
      sessionId: config.sessionId,
      agentPreset: config.agentPreset,
      provider: config.provider,
      model: config.model,
    }],
  })
}
