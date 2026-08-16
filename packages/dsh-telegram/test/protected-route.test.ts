import { describe, expect, it } from 'vitest'
import { resolveTelegramConfig } from '../src/config.js'

const base = {
  agentId: 'main',
  chatId: 123,
  userId: 456,
}

describe('Telegram protected route policy', () => {
  it('accepts only the official Telegram API or a loopback test endpoint', () => {
    expect(resolveTelegramConfig(base).apiBase).toBe('https://api.telegram.org')
    expect(resolveTelegramConfig({ ...base, apiBase: 'http://127.0.0.1:8081' }).apiBase)
      .toBe('http://127.0.0.1:8081')

    for (const apiBase of [
      'https://example.com',
      'http://api.telegram.org',
      'https://user:secret@api.telegram.org',
      'https://api.telegram.org?chat_id=999',
    ]) {
      expect(() => resolveTelegramConfig({ ...base, apiBase })).toThrow(/apiBase/u)
    }
  })

  it('binds one exact route and one environment-variable secret reference', () => {
    const resolved = resolveTelegramConfig({
      ...base,
      agentId: 'stable-agent',
      chatId: 100123,
      userId: 789,
      tokenEnv: 'MY_TELEGRAM_TOKEN',
    })
    expect(resolved).toMatchObject({
      agentId: 'stable-agent',
      chatId: 100123,
      userId: 789,
      tokenEnv: 'MY_TELEGRAM_TOKEN',
    })
    expect(Object.isFrozen(resolved)).toBe(true)

    expect(() => resolveTelegramConfig({ ...base, tokenEnv: 'TOKEN-NAME' })).toThrow(/tokenEnv/u)
    expect(() => resolveTelegramConfig({ ...base, agentId: ' main' })).toThrow(/agentId/u)
    expect(() => resolveTelegramConfig({ ...base, chatId: Number.NaN })).toThrow(/chatId/u)
    expect(() => resolveTelegramConfig({ ...base, chatId: -100123 })).toThrow(/chatId/u)
    expect(() => resolveTelegramConfig({ ...base, userId: 1.5 })).toThrow(/userId/u)
    expect(() => resolveTelegramConfig({ ...base, userId: 0 })).toThrow(/userId/u)
  })

  it('rejects settings that could create unbounded polling, retry, or message work', () => {
    expect(() => resolveTelegramConfig({ ...base, pollTimeoutSeconds: 51 })).toThrow(/pollTimeoutSeconds/u)
    expect(() => resolveTelegramConfig({ ...base, maxSendAttempts: 6 })).toThrow(/maxSendAttempts/u)
    expect(() => resolveTelegramConfig({ ...base, maxTextChars: 4_097 })).toThrow(/maxTextChars/u)
  })
})
