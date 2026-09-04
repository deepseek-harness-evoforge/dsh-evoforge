import type { GatewayEndpoint, ResolvedGatewayRoute } from 'dsh-evoforge-gateway'

export const FEISHU_CONTENT_PERMISSIONS = [
  'document-read',
  'wiki-read',
  'drive-metadata-read',
  'bitable-records-read',
] as const

export type FeishuContentPermission = typeof FEISHU_CONTENT_PERMISSIONS[number]

export interface FeishuConfigInput {
  readonly mode?: 'routes' | 'pairing'
  readonly routeIds: readonly string[]
  readonly appIdEnv?: string
  readonly appSecretEnv?: string
  readonly handshakeTimeoutMs?: number
  readonly maxRetryAfterSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
  readonly contentPermissions?: readonly FeishuContentPermission[]
  readonly maxContentChars?: number
  readonly maxBitableRecords?: number
}

export interface ResolvedFeishuPairingConfig extends ResolvedFeishuConfig {
  readonly mode: 'pairing'
  readonly pairedRoutes: true
}

export interface ResolvedFeishuRoute {
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly endpoint: GatewayEndpoint
}

export interface ResolvedFeishuConfig {
  readonly appId: string
  readonly appIdEnv: string
  readonly appSecret: string
  readonly appSecretEnv: string
  readonly handshakeTimeoutMs: number
  readonly maxRetryAfterMs: number
  readonly maxSendAttempts: number
  readonly maxTextChars: number
  readonly contentPermissions: ReadonlySet<FeishuContentPermission>
  readonly maxContentChars: number
  readonly maxBitableRecords: number
  readonly routes: readonly ResolvedFeishuRoute[]
  readonly routeIds: ReadonlySet<string>
  readonly pairedRoutes: boolean
}

export function resolveFeishuConfig(
  config: FeishuConfigInput,
  routes: readonly ResolvedGatewayRoute[],
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedFeishuConfig {
  if (config.mode === 'pairing') throw new Error('dsh-feishu: routes config cannot use pairing mode')
  if (!Array.isArray(config.routeIds) || config.routeIds.length === 0 || config.routeIds.length > 100) {
    throw new Error('dsh-feishu: routeIds must contain 1 to 100 exact Gateway route ids')
  }
  const routeIds = new Set(config.routeIds)
  if (routeIds.size !== config.routeIds.length) throw new Error('dsh-feishu: routeIds must be unique')
  if (routes.length !== routeIds.size || routes.some(route => !routeIds.has(route.id))) {
    throw new Error('dsh-feishu: every routeId must resolve to exactly one Gateway route')
  }
  if (routes.some(route => route.adapter !== 'feishu')) {
    throw new Error('dsh-feishu: every configured Gateway route adapter must be feishu')
  }
  const accountIds = new Set(routes.map(route => route.accountId))
  if (accountIds.size !== 1) throw new Error('dsh-feishu: one Adapter instance can bind only one Feishu app account')

  const { appId, appIdEnv, appSecret, appSecretEnv } = resolveCredentials(config, environment)
  if (appId !== routes[0]!.accountId) {
    throw new Error('dsh-feishu: credential app id does not match the Gateway accountId')
  }

  const handshakeTimeoutMs = config.handshakeTimeoutMs ?? 15_000
  const maxRetryAfterSeconds = config.maxRetryAfterSeconds ?? 300
  const maxSendAttempts = config.maxSendAttempts ?? 3
  const maxTextChars = config.maxTextChars ?? 4_000
  const contentPermissions = resolveContentPermissions(config.contentPermissions)
  const maxContentChars = config.maxContentChars ?? 20_000
  const maxBitableRecords = config.maxBitableRecords ?? 20
  assertIntegerRange('handshakeTimeoutMs', handshakeTimeoutMs, 1_000, 60_000)
  assertIntegerRange('maxRetryAfterSeconds', maxRetryAfterSeconds, 1, 300)
  assertIntegerRange('maxSendAttempts', maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', maxTextChars, 256, 30_000)
  assertIntegerRange('maxContentChars', maxContentChars, 1_024, 100_000)
  assertIntegerRange('maxBitableRecords', maxBitableRecords, 1, 100)

  const resolvedRoutes = routes.map(route => Object.freeze({
    id: route.id,
    workspaceId: route.workspaceId,
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
    maxRetryAfterMs: maxRetryAfterSeconds * 1_000,
    maxSendAttempts,
    maxTextChars,
    contentPermissions,
    maxContentChars,
    maxBitableRecords,
    routes: Object.freeze(resolvedRoutes),
    routeIds,
    pairedRoutes: false,
  })
}

function resolveContentPermissions(
  input: readonly FeishuContentPermission[] | undefined,
): ReadonlySet<FeishuContentPermission> {
  const values: readonly unknown[] = input ?? []
  if (!Array.isArray(values) || values.length > FEISHU_CONTENT_PERMISSIONS.length
    || values.some(value => typeof value !== 'string'
      || !FEISHU_CONTENT_PERMISSIONS.includes(value as FeishuContentPermission))) {
    throw new Error(`dsh-feishu: contentPermissions must contain only ${FEISHU_CONTENT_PERMISSIONS.join(', ')}`)
  }
  const resolved = new Set(values as readonly FeishuContentPermission[])
  if (resolved.size !== values.length) throw new Error('dsh-feishu: contentPermissions must be unique')
  return Object.freeze(resolved)
}

/** Resolve resident unknown-DM pairing mode; Gateway owns grants and exact route bindings. */
export function resolveFeishuPairingConfig(
  config: FeishuConfigInput,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedFeishuPairingConfig {
  if (config.mode !== 'pairing') throw new Error('dsh-feishu: pairing config mode must be pairing')
  if (!Array.isArray(config.routeIds) || config.routeIds.length !== 0) {
    throw new Error('dsh-feishu: pairing mode requires empty routeIds')
  }
  if ((config.contentPermissions?.length ?? 0) !== 0) {
    throw new Error('dsh-feishu: pairing mode cannot enable contentPermissions')
  }
  const { appId, appIdEnv, appSecret, appSecretEnv } = resolveCredentials(config, environment)
  const handshakeTimeoutMs = config.handshakeTimeoutMs ?? 15_000
  const maxRetryAfterSeconds = config.maxRetryAfterSeconds ?? 300
  const maxSendAttempts = config.maxSendAttempts ?? 3
  const maxTextChars = config.maxTextChars ?? 4_000
  const maxContentChars = config.maxContentChars ?? 20_000
  const maxBitableRecords = config.maxBitableRecords ?? 20
  assertIntegerRange('handshakeTimeoutMs', handshakeTimeoutMs, 1_000, 60_000)
  assertIntegerRange('maxRetryAfterSeconds', maxRetryAfterSeconds, 1, 300)
  assertIntegerRange('maxSendAttempts', maxSendAttempts, 1, 5)
  assertIntegerRange('maxTextChars', maxTextChars, 256, 30_000)
  assertIntegerRange('maxContentChars', maxContentChars, 1_024, 100_000)
  assertIntegerRange('maxBitableRecords', maxBitableRecords, 1, 100)
  return Object.freeze({
    mode: 'pairing',
    appId,
    appIdEnv,
    appSecret,
    appSecretEnv,
    handshakeTimeoutMs,
    maxRetryAfterMs: maxRetryAfterSeconds * 1_000,
    maxSendAttempts,
    maxTextChars,
    contentPermissions: Object.freeze(new Set<FeishuContentPermission>()),
    maxContentChars,
    maxBitableRecords,
    routes: Object.freeze([]),
    routeIds: Object.freeze(new Set<string>()),
    pairedRoutes: true,
  })
}

function resolveCredentials(
  config: Pick<FeishuConfigInput, 'appIdEnv' | 'appSecretEnv'>,
  environment: NodeJS.ProcessEnv,
): { appId: string; appIdEnv: string; appSecret: string; appSecretEnv: string } {
  const appIdEnv = config.appIdEnv ?? 'DSH_FEISHU_APP_ID'
  const appSecretEnv = config.appSecretEnv ?? 'DSH_FEISHU_APP_SECRET'
  assertEnvironmentName(appIdEnv, 'appIdEnv')
  assertEnvironmentName(appSecretEnv, 'appSecretEnv')
  if (appIdEnv === appSecretEnv) throw new Error('dsh-feishu: app id and secret must use different environment variables')
  return {
    appId: exactSecret(environment[appIdEnv], appIdEnv),
    appIdEnv,
    appSecret: exactSecret(environment[appSecretEnv], appSecretEnv),
    appSecretEnv,
  }
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
