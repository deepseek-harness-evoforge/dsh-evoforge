import { describe, expect, it } from 'vitest'
import { resolveChannelRoutes } from 'dsh-channel-router'
import { resolveFeishuConfig } from '../src/config.js'

const routes = resolveChannelRoutes([{
  id: 'feishu-private',
  adapter: 'feishu',
  accountId: 'cli_app_id',
  conversationId: 'oc_private',
  userId: 'ou_alice',
  workspaceId: 'workspace-a',
  sessionId: 'feishu-a',
  agentPreset: 'standard',
  provider: 'deepseek',
  model: 'deepseek-chat',
}, {
  id: 'feishu-group',
  adapter: 'feishu',
  accountId: 'cli_app_id',
  conversationId: 'oc_group',
  threadId: 'omt_topic',
  userId: 'ou_alice',
  workspaceId: 'workspace-b',
  sessionId: 'feishu-b',
  agentPreset: 'standard',
  provider: 'deepseek',
  model: 'deepseek-chat',
}]).routes

const environment = {
  FEISHU_ID: 'cli_app_id',
  FEISHU_SECRET: 'secret-value',
}

describe('Feishu protected deployment config', () => {
  it('binds exact static Router routes to one credential-selected app', () => {
    const resolved = resolveFeishuConfig({
      routeIds: ['feishu-private', 'feishu-group'],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
    }, routes, environment)

    expect(resolved).toMatchObject({
      appId: 'cli_app_id',
      appSecret: 'secret-value',
      handshakeTimeoutMs: 15_000,
      maxTextChars: 4_000,
    })
    expect([...resolved.routeIds]).toEqual(['feishu-private', 'feishu-group'])
    expect(resolved.routes.map(route => ({ id: route.id, workspaceId: route.workspaceId }))).toEqual([
      { id: 'feishu-private', workspaceId: 'workspace-a' },
      { id: 'feishu-group', workspaceId: 'workspace-b' },
    ])
    expect(resolved.routes[1]?.endpoint).toEqual({
      adapter: 'feishu',
      accountId: 'cli_app_id',
      conversationId: 'oc_group',
      threadId: 'omt_topic',
      userId: 'ou_alice',
    })
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('fails closed on missing routes, wrong adapters, mixed accounts, or credential mismatch', () => {
    const input = { routeIds: ['feishu-private'], appIdEnv: 'FEISHU_ID', appSecretEnv: 'FEISHU_SECRET' }
    expect(() => resolveFeishuConfig({ ...input, routeIds: [] }, [], environment)).toThrow(/routeIds/u)
    expect(() => resolveFeishuConfig({ ...input, routeIds: ['feishu-private', 'feishu-private'] }, routes, environment))
      .toThrow(/unique/u)
    expect(() => resolveFeishuConfig(input, [{ ...routes[0]!, adapter: 'telegram' }], environment))
      .toThrow(/adapter/u)
    expect(() => resolveFeishuConfig(
      { ...input, routeIds: ['feishu-private', 'feishu-group'] },
      [routes[0]!, { ...routes[1]!, accountId: 'other' }],
      environment,
    )).toThrow(/one Feishu app/u)
    expect(() => resolveFeishuConfig(input, [routes[0]!], { ...environment, FEISHU_ID: 'other' }))
      .toThrow(/does not match/u)
  })

  it('accepts only bounded settings and environment-variable secret references', () => {
    const input = { routeIds: ['feishu-private'], appIdEnv: 'FEISHU_ID', appSecretEnv: 'FEISHU_SECRET' }
    expect(() => resolveFeishuConfig({ ...input, appSecretEnv: 'BAD-NAME' }, [routes[0]!], environment))
      .toThrow(/appSecretEnv/u)
    expect(() => resolveFeishuConfig({ ...input, appSecretEnv: 'FEISHU_ID' }, [routes[0]!], environment))
      .toThrow(/different/u)
    expect(() => resolveFeishuConfig(input, [routes[0]!], { FEISHU_ID: 'cli_app_id' }))
      .toThrow(/FEISHU_SECRET/u)
    expect(() => resolveFeishuConfig({ ...input, handshakeTimeoutMs: 999 }, [routes[0]!], environment))
      .toThrow(/handshakeTimeoutMs/u)
    expect(() => resolveFeishuConfig({ ...input, maxTextChars: 30_001 }, [routes[0]!], environment))
      .toThrow(/maxTextChars/u)
  })
})
