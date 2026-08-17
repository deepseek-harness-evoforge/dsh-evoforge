import { describe, expect, it } from 'vitest'
import { resolveFeishuTransport } from '../src/platform.js'

describe('official Feishu transport', () => {
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
