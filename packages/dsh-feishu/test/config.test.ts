import { describe, expect, it } from 'vitest'
import { resolveGatewayRoutes } from 'dsh-evoforge-gateway'
import { resolveFeishuConfig, resolveFeishuPairingConfig } from '../src/config.js'

const routes = resolveGatewayRoutes([{
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

const credentialValues = {
  FEISHU_ID: 'cli_app_id',
  FEISHU_SECRET: 'secret-value',
}

function credentialReader(values: Readonly<Record<string, string>>) {
  return {
    resolve: async (reference: string) => {
      const value = values[reference]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  }
}

const credentials = credentialReader(credentialValues)

describe('Feishu protected deployment config', () => {
  it('resolves credential references through the native DSH credential provider', async () => {
    const calls: string[] = []
    const resolved = await resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: [],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
    }, {
      resolve: async (reference: string) => {
        calls.push(reference)
        if (reference === 'FEISHU_ID') return { value: 'cli_app_id', source: 'file' }
        if (reference === 'FEISHU_SECRET') return { value: 'secret-value', source: 'file' }
        return undefined
      },
    })

    expect(calls).toEqual(['FEISHU_ID', 'FEISHU_SECRET'])
    expect(resolved).toMatchObject({
      appId: 'cli_app_id',
      appIdEnv: 'FEISHU_ID',
      appSecret: 'secret-value',
      appSecretEnv: 'FEISHU_SECRET',
    })
    expect(JSON.stringify(resolved)).not.toContain('source')
  })

  it('binds exact static Gateway routes to one credential-selected app', async () => {
    const resolved = await resolveFeishuConfig({
      routeIds: ['feishu-private', 'feishu-group'],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
    }, routes, credentials)

    expect(resolved).toMatchObject({
      appId: 'cli_app_id',
      appSecret: 'secret-value',
      handshakeTimeoutMs: 15_000,
      maxContentChars: 20_000,
      maxBitableRecords: 20,
      maxTextChars: 4_000,
    })
    expect([...resolved.contentPermissions]).toEqual([])
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

  it('fails closed on missing routes, wrong adapters, mixed accounts, or credential mismatch', async () => {
    const input = { routeIds: ['feishu-private'], appIdEnv: 'FEISHU_ID', appSecretEnv: 'FEISHU_SECRET' }
    await expect(resolveFeishuConfig({ ...input, mode: 'pairing' }, [routes[0]!], credentials))
      .rejects.toThrow(/routes config.*pairing mode/u)
    await expect(resolveFeishuConfig({ ...input, routeIds: [] }, [], credentials)).rejects.toThrow(/routeIds/u)
    await expect(resolveFeishuConfig(
      { ...input, routeIds: ['feishu-private', 'feishu-private'] },
      routes,
      credentials,
    )).rejects.toThrow(/unique/u)
    await expect(resolveFeishuConfig(
      input,
      [{ ...routes[0]!, adapter: 'telegram' }],
      credentials,
    )).rejects.toThrow(/adapter/u)
    await expect(resolveFeishuConfig(
      { ...input, routeIds: ['feishu-private', 'feishu-group'] },
      [routes[0]!, { ...routes[1]!, accountId: 'other' }],
      credentials,
    )).rejects.toThrow(/one Feishu app/u)
    await expect(resolveFeishuConfig(
      input,
      [routes[0]!],
      credentialReader({ ...credentialValues, FEISHU_ID: 'other' }),
    )).rejects.toThrow(/does not match/u)
  })

  it('accepts only bounded settings and credential references', async () => {
    const input = { routeIds: ['feishu-private'], appIdEnv: 'FEISHU_ID', appSecretEnv: 'FEISHU_SECRET' }
    await expect(resolveFeishuConfig(
      { ...input, appSecretEnv: 'BAD-NAME' },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/appSecretEnv/u)
    await expect(resolveFeishuConfig(
      { ...input, appSecretEnv: 'FEISHU_ID' },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/different/u)
    await expect(resolveFeishuConfig(
      input,
      [routes[0]!],
      credentialReader({ FEISHU_ID: 'cli_app_id' }),
    )).rejects.toThrow(/FEISHU_SECRET/u)
    await expect(resolveFeishuConfig(
      { ...input, handshakeTimeoutMs: 999 },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/handshakeTimeoutMs/u)
    await expect(resolveFeishuConfig(
      { ...input, maxTextChars: 30_001 },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/maxTextChars/u)
    await expect(resolveFeishuConfig(
      { ...input, maxContentChars: 1_023 },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/maxContentChars/u)
    await expect(resolveFeishuConfig(
      { ...input, maxBitableRecords: 101 },
      [routes[0]!],
      credentials,
    )).rejects.toThrow(/maxBitableRecords/u)
    await expect(resolveFeishuConfig({
      ...input,
      contentPermissions: ['document-read', 'document-read'],
    }, [routes[0]!], credentials)).rejects.toThrow(/contentPermissions.*unique/u)
    await expect(resolveFeishuConfig({
      ...input,
      contentPermissions: ['calendar-read' as never],
    }, [routes[0]!], credentials)).rejects.toThrow(/contentPermissions/u)
  })

  it('resolves four independent content permissions without granting a fifth capability', async () => {
    const resolved = await resolveFeishuConfig({
      routeIds: ['feishu-private'],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
      contentPermissions: ['document-read', 'wiki-read', 'drive-metadata-read', 'bitable-records-read'],
      maxContentChars: 12_000,
      maxBitableRecords: 7,
    }, [routes[0]!], credentials)

    expect([...resolved.contentPermissions]).toEqual([
      'document-read',
      'wiki-read',
      'drive-metadata-read',
      'bitable-records-read',
    ])
    expect(resolved.maxContentChars).toBe(12_000)
    expect(resolved.maxBitableRecords).toBe(7)
  })

  it('resolves explicit pairing mode without inventing a Gateway route', async () => {
    const resolved = await resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: [],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
    }, credentials)

    expect(resolved).toMatchObject({
      mode: 'pairing',
      appId: 'cli_app_id',
      appIdEnv: 'FEISHU_ID',
      appSecret: 'secret-value',
      appSecretEnv: 'FEISHU_SECRET',
      handshakeTimeoutMs: 15_000,
      maxRetryAfterMs: 300_000,
      maxSendAttempts: 3,
      maxTextChars: 4_000,
      pairedRoutes: true,
    })
    expect(resolved.routes).toEqual([])
    expect([...resolved.routeIds]).toEqual([])
    expect([...resolved.contentPermissions]).toEqual([])
    await expect(resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: ['feishu-private'],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
    }, credentials)).rejects.toThrow(/pairing mode.*routeIds/u)
    await expect(resolveFeishuPairingConfig({
      mode: 'pairing',
      routeIds: [],
      appIdEnv: 'FEISHU_ID',
      appSecretEnv: 'FEISHU_SECRET',
      contentPermissions: ['document-read'],
    }, credentials)).rejects.toThrow(/pairing mode.*contentPermissions/u)
  })
})
