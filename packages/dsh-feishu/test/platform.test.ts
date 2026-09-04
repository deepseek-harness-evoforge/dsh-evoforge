import { describe, expect, it } from 'vitest'
import {
  FEISHU_EVENT_SUBSCRIPTION_READ_SCOPE,
  FEISHU_TRANSPORT_SCOPES,
  inspectFeishuPlatformAccess,
  resolveFeishuTransport,
} from '../src/platform.js'

describe('official Feishu transport', () => {
  it('reports verified app-level access without exposing platform identifiers', async () => {
    const result = await inspectFeishuPlatformAccess({
      listScopes: async () => ({
        code: 0,
        data: { scopes: [...FEISHU_TRANSPORT_SCOPES, FEISHU_EVENT_SUBSCRIPTION_READ_SCOPE]
          .map(scope_name => ({ scope_name, grant_status: 1 })) },
      }),
      readEventSubscriptions: async () => ({ code: 0, data: { subscriptions: [] } }),
    }, 'verified', 123)

    expect(result).toEqual({
      status: 'verified',
      checkedAt: 123,
      botIdentity: 'verified',
      scopeList: 'verified',
      requiredScopes: FEISHU_TRANSPORT_SCOPES.map(name => ({ name, granted: true })),
      eventSubscription: 'verified',
    })
    expect(JSON.stringify(result)).not.toContain('chat')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('keeps a missing event-read permission visible but does not fail a live transport', async () => {
    await expect(inspectFeishuPlatformAccess({
      listScopes: async () => ({
        code: 0,
        data: { scopes: FEISHU_TRANSPORT_SCOPES.map(scope_name => ({ scope_name, grant_status: 1 })) },
      }),
      readEventSubscriptions: async () => ({ code: 0 }),
    }, 'verified', 456)).resolves.toMatchObject({
      status: 'not-verified',
      reason: 'event-subscription-read-scope-missing',
      eventSubscription: 'not-verified',
    })
  })

  it('marks missing message permissions as attention and bounds all failures', async () => {
    await expect(inspectFeishuPlatformAccess({
      listScopes: async () => ({
        code: 0,
        data: { scopes: [{ scope_name: FEISHU_TRANSPORT_SCOPES[0], grant_status: 1 }] },
      }),
      readEventSubscriptions: async () => { throw new Error('secret should never escape') },
    }, 'verified', 789)).resolves.toMatchObject({
      status: 'attention',
      reason: 'required-scope-missing',
      requiredScopes: [
        { name: FEISHU_TRANSPORT_SCOPES[0], granted: true },
        { name: FEISHU_TRANSPORT_SCOPES[1], granted: false },
      ],
    })
  })

  it('adopts a conventional HTTPS proxy without changing process environment', () => {
    const environment = {
      http_proxy: 'http://127.0.0.1:7001',
      https_proxy: 'http://127.0.0.1:7002',
    }
    const before = { ...environment }

    const transport = resolveFeishuTransport(environment)

    expect(transport.agent).toBeDefined()
    expect(transport.httpInstance.defaults.proxy).toBe(false)
    expect(transport.httpInstance.defaults.httpsAgent).toBe(transport.agent)
    expect(environment).toEqual(before)
  })

  it('honors NO_PROXY and otherwise uses a direct axios instance', () => {
    const transport = resolveFeishuTransport({
      HTTPS_PROXY: 'http://127.0.0.1:7002',
      NO_PROXY: '.feishu.cn',
    })

    expect(transport.agent).toBeUndefined()
    expect(transport.httpInstance.defaults.proxy).toBe(false)
    expect(transport.httpInstance.defaults.httpsAgent).toBeUndefined()
  })

  it('falls back to populated uppercase variables when lowercase entries are empty', () => {
    const transport = resolveFeishuTransport({
      https_proxy: '',
      HTTPS_PROXY: 'http://127.0.0.1:7002',
      no_proxy: '',
      NO_PROXY: 'example.invalid',
    })

    expect(transport.agent).toBeDefined()
    expect(transport.httpInstance.defaults.httpsAgent).toBe(transport.agent)
  })

  it('fails before connecting when the selected proxy protocol is unsupported', () => {
    expect(() => resolveFeishuTransport({ https_proxy: 'socks5://127.0.0.1:7002' }))
      .toThrow(/HTTPS proxy.*http or https/u)
  })
})
