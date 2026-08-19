import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-dual-workspace-gateway-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'commands',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

interface RouteConfig {
  readonly id: string
  readonly adapter: string
  readonly accountId: string
  readonly conversationId: string
  readonly userId: string
  readonly workspacePath: string
  readonly sessionId: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
}

interface Config {
  readonly gatewayEntry: string
  readonly routes: readonly RouteConfig[]
}

/** Real-Host fixture: register each directory, then pass only native Workspace ids to the Gateway. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const registry = (ctx as unknown as {
    workspaceRegistry: { create(path: string): Promise<{ id: unknown }> }
  }).workspaceRegistry
  const routes = []
  for (const route of config.routes) {
    const workspace = await registry.create(route.workspacePath)
    const { workspacePath: _workspacePath, ...binding } = route
    routes.push({ ...binding, workspaceId: String(workspace.id) })
  }
  const gateway = await import(config.gatewayEntry) as {
    apply(ctx: Context, config: unknown): Promise<void>
  }
  await gateway.apply(ctx, { routes })
}
