import { describe, expect, it } from 'vitest'
import { resolveGatewayRoutes } from 'dsh-evoforge-gateway'
import { resolveTelegramConfig, resolveTelegramPairingConfig } from '../src/config.js'

const base = {
  routeId: 'telegram-main',
}
const route = resolveGatewayRoutes([{
  id: 'telegram-main',
  adapter: 'telegram',
  accountId: 'bot-main',
  conversationId: '123',
  userId: '456',
  workspaceId: 'workspace-main',
  sessionId: 'session-main',
  agentPreset: 'standard',
  provider: 'deepseek',
  model: 'deepseek-chat',
}]).routes[0]!

describe('Telegram protected route policy', () => {
  it('accepts only the official Telegram API or a loopback test endpoint', () => {
    expect(resolveTelegramConfig(base, route).apiBase).toBe('https://api.telegram.org')
    expect(resolveTelegramConfig({ ...base, apiBase: 'http://127.0.0.1:8081' }, route).apiBase)
      .toBe('http://127.0.0.1:8081')

    for (const apiBase of [
      'https://example.com',
      'http://api.telegram.org',
      'https://user:secret@api.telegram.org',
      'https://api.telegram.org?chat_id=999',
    ]) {
      expect(() => resolveTelegramConfig({ ...base, apiBase }, route)).toThrow(/apiBase/u)
    }
  })

  it('binds one exact route and one environment-variable secret reference', () => {
    const resolved = resolveTelegramConfig({
      ...base,
      tokenEnv: 'MY_TELEGRAM_TOKEN',
    }, route)
    expect(resolved).toMatchObject({
      routeId: 'telegram-main',
      chatId: 123,
      userId: 456,
      sessionId: 'session-main',
      tokenEnv: 'MY_TELEGRAM_TOKEN',
    })
    expect(Object.isFrozen(resolved)).toBe(true)

    expect(() => resolveTelegramConfig({ ...base, tokenEnv: 'TOKEN-NAME' }, route)).toThrow(/tokenEnv/u)
    expect(() => resolveTelegramConfig({ ...base, routeId: 'other' }, route)).toThrow(/routeId/u)
    const feishu = { ...route, id: 'feishu-main', adapter: 'feishu' }
    expect(() => resolveTelegramConfig({ routeId: 'feishu-main' }, feishu)).toThrow(/adapter/u)
    const threaded = { ...route, threadId: 'topic-1' }
    expect(() => resolveTelegramConfig(base, threaded)).toThrow(/threadId/u)
    const invalidChat = { ...route, conversationId: '-100123' }
    expect(() => resolveTelegramConfig(base, invalidChat)).toThrow(/conversationId/u)
    const invalidUser = { ...route, userId: '01' }
    expect(() => resolveTelegramConfig(base, invalidUser)).toThrow(/userId/u)
  })

  it('rejects settings that could create unbounded polling, retry, or message work', () => {
    expect(() => resolveTelegramConfig({ ...base, pollTimeoutSeconds: 51 }, route)).toThrow(/pollTimeoutSeconds/u)
    expect(() => resolveTelegramConfig({ ...base, maxSendAttempts: 6 }, route)).toThrow(/maxSendAttempts/u)
    expect(() => resolveTelegramConfig({ ...base, maxTextChars: 4_097 }, route)).toThrow(/maxTextChars/u)
  })

  it('resolves resident pairing without inventing a static route', () => {
    const resolved = resolveTelegramPairingConfig({
      mode: 'pairing',
      accountId: 'bot-main',
      tokenEnv: 'MY_TELEGRAM_TOKEN',
      apiBase: 'http://127.0.0.1:8081',
    }, { MY_TELEGRAM_TOKEN: 'secret' })
    expect(resolved).toMatchObject({
      mode: 'pairing',
      accountId: 'bot-main',
      tokenEnv: 'MY_TELEGRAM_TOKEN',
      apiBase: 'http://127.0.0.1:8081',
    })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(() => resolveTelegramPairingConfig({ mode: 'pairing', accountId: 'bot-main', routeId: 'telegram-main' }, { DSH_TELEGRAM_BOT_TOKEN: 'x' })).toThrow(/no static route ids/u)
    expect(() => resolveTelegramPairingConfig({ mode: 'pairing', accountId: '' }, { DSH_TELEGRAM_BOT_TOKEN: 'x' })).toThrow(/accountId/u)
    expect(() => resolveTelegramPairingConfig({ mode: 'pairing', accountId: 'bot-main' }, {})).toThrow(/environment variable/u)
  })
})
