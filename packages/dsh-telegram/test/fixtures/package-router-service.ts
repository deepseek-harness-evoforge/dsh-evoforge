import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-telegram-package-router-service'

/** Package-boundary-only service; real Router/Agent behavior is covered by assembled-chat. */
export function apply(ctx: Context): void {
  const route = Object.freeze({
    id: 'telegram-package',
    adapter: 'telegram',
    accountId: 'package-bot',
    conversationId: '1001',
    userId: '2002',
    workspaceId: 'workspace-package',
    sessionId: 'main',
    agentPreset: 'package-test',
    provider: 'package-test',
    model: 'package-test',
    endpointKey: '["telegram","package-bot","1001",null,"2002"]',
  })
  const agent = Object.freeze({
    id: 'main',
    options: { provider: 'package-test', model: 'package-test' },
    session: { id: 'main', header: { id: 'main' }, events: [] },
    inbox: { nextTurn: [], nextStep: [] },
    status: 'idle',
    ctx,
  })
  ctx.provide('evoforge.channelRouter' as never, Object.freeze({
    route: (id: string) => id === route.id ? route : undefined,
    resolve: () => Promise.resolve(agent),
    messageIdFor: () => `channel:${'a'.repeat(64)}`,
    dispatch: () => Promise.reject(new Error('package fixture does not dispatch')),
  }) as never)
}
