import type { ResolvedTelegramConfig } from './runtime.js'

export interface TelegramConfigInput {
  readonly agentId: string
  readonly chatId: number
  readonly userId: number
  readonly tokenEnv?: string
  readonly apiBase?: string
  readonly pollTimeoutSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export function resolveTelegramConfig(config: TelegramConfigInput): ResolvedTelegramConfig {
  const resolved: ResolvedTelegramConfig = {
    agentId: config.agentId,
    chatId: config.chatId,
    userId: config.userId,
    tokenEnv: config.tokenEnv ?? 'DSH_TELEGRAM_BOT_TOKEN',
    apiBase: config.apiBase ?? 'https://api.telegram.org',
    pollTimeoutSeconds: config.pollTimeoutSeconds ?? 30,
    maxSendAttempts: config.maxSendAttempts ?? 3,
    maxTextChars: config.maxTextChars ?? 4_000,
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(resolved.tokenEnv)) {
    throw new Error('dsh-telegram: tokenEnv must be an environment-variable name')
  }
  if (resolved.agentId.trim() !== resolved.agentId || resolved.agentId.length === 0) {
    throw new Error('dsh-telegram: agentId must be a non-empty trimmed string')
  }
  for (const [key, value] of [['chatId', resolved.chatId], ['userId', resolved.userId]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`dsh-telegram: ${key} must be a positive safe integer`)
    }
  }
  assertIntegerRange('pollTimeoutSeconds', resolved.pollTimeoutSeconds, 1, 50)
  assertIntegerRange('maxSendAttempts', resolved.maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', resolved.maxTextChars, 256, 4_096)
  assertApiBase(resolved.apiBase)
  return Object.freeze(resolved)
}

function assertIntegerRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`dsh-telegram: ${name} must be an integer from ${min} to ${max}`)
  }
}

function assertApiBase(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('dsh-telegram: apiBase must be an absolute URL')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('dsh-telegram: apiBase must not contain credentials, query, or fragment')
  }
  const official = url.protocol === 'https:' && url.hostname === 'api.telegram.org'
    && (url.pathname === '' || url.pathname === '/')
  const loopback = (url.protocol === 'http:' || url.protocol === 'https:')
    && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if (!official && !loopback) {
    throw new Error('dsh-telegram: apiBase must be official Telegram HTTPS or a loopback server')
  }
}
