import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-telegram-package-gateway-service'

/** Package-boundary-only service; real Gateway/Agent behavior is covered by assembled-chat. */
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
  ctx.provide('evoforge.gateway' as never, Object.freeze({
    route: (id: string) => id === route.id ? route : undefined,
    resolve: () => Promise.resolve(agent),
    messageIdFor: () => `channel:${'a'.repeat(64)}`,
    dispatch: () => Promise.reject(new Error('package fixture does not dispatch')),
    registerTextAdapter: () => ({
      submit: async () => ({ id: 'b'.repeat(64), created: true, status: 'prepared' }),
      dispose: async () => {},
    }),
    registerTransport: () => ({ report() {}, dispose() {} }),
    healthSnapshot: () => ({
      transports: {
        registrations: 1, connecting: 0, ready: 1, degraded: 0, stopping: 0,
        items: [{ adapter: 'telegram', kind: 'telegram-long-poll', state: 'ready', routeIds: [route.id], observedAt: 1 }],
      },
      outbound: {
        registrations: 1, scheduled: 0, total: 0, prepared: 0, sending: 0, retrying: 0,
        delivered: 0, uncertain: 0, failed: 0,
      },
    }),
  }) as never)
}
