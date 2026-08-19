import type { GatewayEndpoint, ResolvedGatewayRoute } from 'dsh-gateway'
import type { TelegramRouteIdentity } from './inbound.js'

export interface TelegramConfigInput {
  readonly routeId: string
  readonly tokenEnv?: string
  readonly apiBase?: string
  readonly pollTimeoutSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export interface ResolvedTelegramConfig extends TelegramRouteIdentity {
  readonly routeId: string
  readonly sessionId: string
  readonly endpoint: GatewayEndpoint
  readonly apiBase: string
  readonly maxSendAttempts: number
  readonly maxTextChars: number
  readonly pollTimeoutSeconds: number
  readonly tokenEnv: string
}

export function resolveTelegramConfig(
  config: TelegramConfigInput,
  route: ResolvedGatewayRoute,
): ResolvedTelegramConfig {
  if (config.routeId !== route.id) {
    throw new Error(`dsh-telegram: routeId '${config.routeId}' does not resolve to route '${route.id}'`)
  }
  if (route.adapter !== 'telegram') {
    throw new Error(`dsh-telegram: route '${route.id}' adapter must be telegram`)
  }
  if (route.threadId !== undefined) {
    throw new Error(`dsh-telegram: route '${route.id}' threadId is unsupported for a private chat`)
  }
  const resolved: ResolvedTelegramConfig = {
    routeId: route.id,
    sessionId: route.sessionId,
    endpoint: Object.freeze({
      adapter: route.adapter,
      accountId: route.accountId,
      conversationId: route.conversationId,
      userId: route.userId,
    }),
    chatId: telegramId(route.conversationId, 'conversationId'),
    userId: telegramId(route.userId, 'userId'),
    tokenEnv: config.tokenEnv ?? 'DSH_TELEGRAM_BOT_TOKEN',
    apiBase: config.apiBase ?? 'https://api.telegram.org',
    pollTimeoutSeconds: config.pollTimeoutSeconds ?? 30,
    maxSendAttempts: config.maxSendAttempts ?? 3,
    maxTextChars: config.maxTextChars ?? 4_000,
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(resolved.tokenEnv)) {
    throw new Error('dsh-telegram: tokenEnv must be an environment-variable name')
  }
  assertIntegerRange('pollTimeoutSeconds', resolved.pollTimeoutSeconds, 1, 50)
  assertIntegerRange('maxSendAttempts', resolved.maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', resolved.maxTextChars, 256, 4_096)
  assertApiBase(resolved.apiBase)
  return Object.freeze(resolved)
}

function telegramId(value: string, field: 'conversationId' | 'userId'): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`dsh-telegram: Gateway ${field} must be a canonical positive Telegram integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`dsh-telegram: Gateway ${field} must be a canonical positive safe integer`)
  }
  return parsed
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
