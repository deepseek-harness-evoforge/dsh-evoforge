import { describe, expect, it } from 'vitest'
import { resolveChannelRoutes } from '../src/index.js'

const route = {
  id: 'telegram-a',
  adapter: 'telegram',
  accountId: 'bot-a',
  conversationId: 'chat-a',
  userId: 'user-a',
  workspaceId: 'workspace-a',
  sessionId: 'channel-session-a',
  agentPreset: 'standard',
  provider: 'deepseek',
  model: 'deepseek-chat',
}

describe('channel route configuration', () => {
  it('builds exact endpoint and id indexes without accepting implicit wildcards', () => {
    const resolved = resolveChannelRoutes([route])
    expect(resolved.byId.get('telegram-a')).toMatchObject(route)
    expect(resolved.match({
      adapter: 'telegram',
      accountId: 'bot-a',
      conversationId: 'chat-a',
      userId: 'user-a',
    })?.id).toBe('telegram-a')
    expect(resolved.match({
      adapter: 'telegram',
      accountId: 'bot-a',
      conversationId: 'chat-a',
      userId: 'other-user',
    })).toBeUndefined()
  })

  it('rejects endpoint ambiguity and one session crossing Workspace ownership', () => {
    expect(() => resolveChannelRoutes([route, { ...route, id: 'duplicate-endpoint' }]))
      .toThrow('same external endpoint')
    expect(() => resolveChannelRoutes([
      route,
      {
        ...route,
        id: 'feishu-b',
        adapter: 'feishu',
        accountId: 'tenant-b',
        conversationId: 'chat-b',
        userId: 'user-b',
        workspaceId: 'workspace-b',
      },
    ])).toThrow('cannot cross Workspaces')
    expect(() => resolveChannelRoutes([
      route,
      {
        ...route,
        id: 'same-session-other-model',
        conversationId: 'chat-b',
        model: 'another-model',
      },
    ])).toThrow('multiple model routes')
  })
})
