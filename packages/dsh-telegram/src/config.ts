import type { GatewayEndpoint, ResolvedGatewayRoute } from 'dsh-gateway'
import type { TelegramRouteIdentity } from './inbound.js'

export interface TelegramConfigInput {
  /** Legacy one-route spelling; retained for existing profiles. */
  readonly routeId?: string
  /** Exact static Gateway route ids for routes mode. */
  readonly routeIds?: readonly string[]
  /** Gateway account identity used by resident pairing mode. */
  readonly accountId?: string
  readonly mode?: 'routes' | 'pairing'
  readonly tokenEnv?: string
  readonly apiBase?: string
  readonly pollTimeoutSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export interface ResolvedTelegramConfig extends TelegramRouteIdentity {
  readonly mode: 'routes'
  readonly routeId: string
  readonly accountId: string
  readonly sessionId: string
  readonly endpoint: GatewayEndpoint
  readonly apiBase: string
  readonly maxSendAttempts: number
  readonly maxTextChars: number
  readonly pollTimeoutSeconds: number
  readonly tokenEnv: string
}

export interface ResolvedTelegramPairingConfig {
  readonly mode: 'pairing'
  readonly accountId: string
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
  const routeId = config.routeId ?? (config.routeIds?.length === 1 ? config.routeIds[0] : undefined)
  if (routeId !== route.id) {
    throw new Error(`dsh-telegram: routeId '${routeId ?? ''}' does not resolve to route '${route.id}'`)
  }
  if (route.adapter !== 'telegram') {
    throw new Error(`dsh-telegram: route '${route.id}' adapter must be telegram`)
  }
  if (route.threadId !== undefined) {
    throw new Error(`dsh-telegram: route '${route.id}' threadId is unsupported for a private chat`)
  }
  const resolved: ResolvedTelegramConfig = {
    mode: 'routes',
    routeId: route.id,
    accountId: route.accountId,
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

/** Resolve resident unknown-DM pairing; Gateway owns grants and exact routes. */
export function resolveTelegramPairingConfig(
  config: TelegramConfigInput,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedTelegramPairingConfig {
  if (config.mode !== 'pairing') throw new Error('dsh-telegram: pairing config mode must be pairing')
  if (config.routeId !== undefined || (config.routeIds?.length ?? 0) !== 0) {
    throw new Error('dsh-telegram: pairing mode requires no static route ids')
  }
  const accountId = exactText(config.accountId, 'accountId', 256)
  const tokenEnv = config.tokenEnv ?? 'DSH_TELEGRAM_BOT_TOKEN'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnv)) {
    throw new Error('dsh-telegram: tokenEnv must be an environment-variable name')
  }
  const resolved: ResolvedTelegramPairingConfig = {
    mode: 'pairing',
    accountId,
    tokenEnv,
    apiBase: config.apiBase ?? 'https://api.telegram.org',
    pollTimeoutSeconds: config.pollTimeoutSeconds ?? 30,
    maxSendAttempts: config.maxSendAttempts ?? 3,
    maxTextChars: config.maxTextChars ?? 4_000,
  }
  assertIntegerRange('pollTimeoutSeconds', resolved.pollTimeoutSeconds, 1, 50)
  assertIntegerRange('maxSendAttempts', resolved.maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', resolved.maxTextChars, 256, 4_096)
  assertApiBase(resolved.apiBase)
  if (environment[resolved.tokenEnv] === undefined || environment[resolved.tokenEnv]!.length === 0) {
    throw new Error(`dsh-telegram: configured token environment variable ${resolved.tokenEnv} is empty`)
  }
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

function exactText(value: string | undefined, field: string, maxBytes: number): string {
  if (value === undefined || value.length === 0 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value) || Buffer.byteLength(value) > maxBytes) {
    throw new Error(`dsh-telegram: ${field} must be non-empty, trimmed, control-free, and at most ${maxBytes} bytes`)
  }
  return value
}
