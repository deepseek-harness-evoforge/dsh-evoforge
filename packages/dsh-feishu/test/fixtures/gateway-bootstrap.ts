import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-feishu-gateway-bootstrap'
export const inject = [
  'agents',
  'agentPresets',
  'commands',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

interface Config {
  readonly gatewayEntry: string
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

export async function apply(ctx: Context, config: Config): Promise<void> {
  const registry = (ctx as unknown as {
    workspaceRegistry: { create(path: string): Promise<{ id: unknown }> }
  }).workspaceRegistry
  const workspace = await registry.create(config.workspacePath)
  const gateway = await import(config.gatewayEntry) as {
    apply(ctx: Context, config: unknown): Promise<void>
  }
  await gateway.apply(ctx, {
    routes: [{
      id: config.routeId,
      adapter: 'feishu',
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
