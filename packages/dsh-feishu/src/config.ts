import type { ChannelEndpoint, ResolvedChannelRoute } from 'dsh-channel-router'

export interface FeishuConfigInput {
  readonly routeIds: readonly string[]
  readonly appIdEnv?: string
  readonly appSecretEnv?: string
  readonly handshakeTimeoutMs?: number
  readonly maxDeliveryRecords?: number
  readonly maxRetryAfterSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export interface ResolvedFeishuRoute {
  readonly id: string
  readonly sessionId: string
  readonly endpoint: ChannelEndpoint
}

export interface ResolvedFeishuConfig {
  readonly appId: string
  readonly appIdEnv: string
  readonly appSecret: string
  readonly appSecretEnv: string
  readonly handshakeTimeoutMs: number
  readonly maxDeliveryRecords: number
  readonly maxRetryAfterMs: number
  readonly maxSendAttempts: number
  readonly maxTextChars: number
  readonly routes: readonly ResolvedFeishuRoute[]
  readonly routeIds: ReadonlySet<string>
}

export function resolveFeishuConfig(
  config: FeishuConfigInput,
  routes: readonly ResolvedChannelRoute[],
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedFeishuConfig {
  if (!Array.isArray(config.routeIds) || config.routeIds.length === 0 || config.routeIds.length > 100) {
    throw new Error('dsh-feishu: routeIds must contain 1 to 100 exact Router route ids')
  }
  const routeIds = new Set(config.routeIds)
  if (routeIds.size !== config.routeIds.length) throw new Error('dsh-feishu: routeIds must be unique')
  if (routes.length !== routeIds.size || routes.some(route => !routeIds.has(route.id))) {
    throw new Error('dsh-feishu: every routeId must resolve to exactly one Router route')
  }
  if (routes.some(route => route.adapter !== 'feishu')) {
    throw new Error('dsh-feishu: every configured Router route adapter must be feishu')
  }
  const accountIds = new Set(routes.map(route => route.accountId))
  if (accountIds.size !== 1) throw new Error('dsh-feishu: one Adapter instance can bind only one Feishu app account')

  const appIdEnv = config.appIdEnv ?? 'DSH_FEISHU_APP_ID'
  const appSecretEnv = config.appSecretEnv ?? 'DSH_FEISHU_APP_SECRET'
  assertEnvironmentName(appIdEnv, 'appIdEnv')
  assertEnvironmentName(appSecretEnv, 'appSecretEnv')
  if (appIdEnv === appSecretEnv) throw new Error('dsh-feishu: app id and secret must use different environment variables')
  const appId = exactSecret(environment[appIdEnv], appIdEnv)
  const appSecret = exactSecret(environment[appSecretEnv], appSecretEnv)
  if (appId !== routes[0]!.accountId) {
    throw new Error('dsh-feishu: credential app id does not match the Router accountId')
  }

  const handshakeTimeoutMs = config.handshakeTimeoutMs ?? 15_000
  const maxDeliveryRecords = config.maxDeliveryRecords ?? 10_000
  const maxRetryAfterSeconds = config.maxRetryAfterSeconds ?? 300
  const maxSendAttempts = config.maxSendAttempts ?? 3
  const maxTextChars = config.maxTextChars ?? 4_000
  assertIntegerRange('handshakeTimeoutMs', handshakeTimeoutMs, 1_000, 60_000)
  assertIntegerRange('maxDeliveryRecords', maxDeliveryRecords, 1, 100_000)
  assertIntegerRange('maxRetryAfterSeconds', maxRetryAfterSeconds, 1, 300)
  assertIntegerRange('maxSendAttempts', maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', maxTextChars, 256, 30_000)

  const resolvedRoutes = routes.map(route => Object.freeze({
    id: route.id,
    sessionId: route.sessionId,
    endpoint: Object.freeze({
      adapter: route.adapter,
      accountId: route.accountId,
      conversationId: route.conversationId,
      ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
      userId: route.userId,
    }),
  }))
  return Object.freeze({
    appId,
    appIdEnv,
    appSecret,
    appSecretEnv,
    handshakeTimeoutMs,
    maxDeliveryRecords,
    maxRetryAfterMs: maxRetryAfterSeconds * 1_000,
    maxSendAttempts,
    maxTextChars,
    routes: Object.freeze(resolvedRoutes),
    routeIds,
  })
}

function assertEnvironmentName(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`dsh-feishu: ${label} must be an environment-variable name`)
  }
}

function exactSecret(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0 || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`dsh-feishu: configured credential environment variable ${name} is empty or invalid`)
  }
  return value
}

function assertIntegerRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`dsh-feishu: ${name} must be an integer from ${min} to ${max}`)
  }
}
