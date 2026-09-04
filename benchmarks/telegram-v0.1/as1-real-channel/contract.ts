import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'

export const BENCHMARK_ID = 'as1-telegram-resident-pairing-epoch-1'
export const REAL_TELEGRAM_APPROVAL = 'I_APPROVE_REAL_TELEGRAM_CHANNEL_EFFECTS'

const terminalObservationNames = [
  'finalTarballsInstalled',
  'profileDumped',
  'officialTransportReady',
  'pairingCodeDelivered',
  'unknownMessageNotDispatched',
  'hostPairingApproved',
  'exactChallengeDelivered',
  'replyDelivered',
  'duplicateIngressSuppressed',
  'approvalAllowedOnce',
  'postRestartRoundTrip',
  'sessionRecoveredAfterRemoval',
  'nativeHostBootedAfterRemoval',
] as const

const terminalGatewayNames = [
  'ingressSettled',
  'ingressUncertain',
  'outboundDelivered',
  'outboundUncertain',
  'outboundFailed',
] as const

const requiredNames = [
  'DSH_TELEGRAM_BOT_TOKEN',
  'DSH_TELEGRAM_ACCOUNT_ID',
  'DSH_TELEGRAM_DSH_SOURCE_DIR',
  'DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT',
] as const

export interface RealTelegramExecutionConfig {
  readonly botToken: string
  readonly accountId: string
  readonly apiBase: string
  readonly dshSourceDir: string
  readonly runRoot: string
  readonly interactionTimeoutMs: number
}

export type RealTelegramAcceptanceResolution =
  | {
      readonly status: 'not-run' | 'failed'
      readonly exitCode: 1 | 2
      readonly report: {
        readonly schemaVersion: 1
        readonly benchmarkId: typeof BENCHMARK_ID
        readonly status: 'not-run' | 'failed'
        readonly reasons: readonly string[]
      }
    }
  | {
      readonly status: 'ready'
      readonly report: {
        readonly schemaVersion: 1
        readonly benchmarkId: typeof BENCHMARK_ID
        readonly status: 'ready'
        readonly chatKind: 'direct'
        readonly accountIdentityHash: string
        readonly interactionTimeoutMs: number
      }
      readonly execution: RealTelegramExecutionConfig
      readonly exitCode?: undefined
    }

export interface RealTelegramTerminalReport {
  readonly schemaVersion: 1
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly status: 'passed' | 'failed'
  readonly scope: string
  readonly manifestHash: string
  readonly revisions: {
    readonly evoforge: string
    readonly deepseekHarness: string
    readonly auditedLatestDeepseekHarness: string
  }
  readonly chatKind: 'direct'
  readonly accountIdentityHash: string
  /** Hashed only after the unknown DM is approved; Telegram ids never enter public output. */
  readonly routeIdentityHash?: string
  readonly stage: string
  readonly observations: Readonly<Record<(typeof terminalObservationNames)[number], boolean>>
  readonly gateway?: Readonly<Record<(typeof terminalGatewayNames)[number], number>>
  readonly reasons: readonly string[]
}

export interface RealTelegramTerminalIdentity {
  readonly manifestHash: string
  readonly evoforgeRevision: string
  readonly dshRevision: string
  readonly auditedLatestDshRevision: string
  readonly preflight: Extract<RealTelegramAcceptanceResolution, { status: 'ready' }>['report']
}

/** Resolve authorization before inspecting the Bot token or any other secret. */
export function resolveRealTelegramAcceptance(
  environment: NodeJS.ProcessEnv,
): RealTelegramAcceptanceResolution {
  if (environment.DSH_TELEGRAM_REAL_CHANNEL_APPROVED !== REAL_TELEGRAM_APPROVAL) {
    return stopped('not-run', 2, ['real-telegram-effects-not-authorized'])
  }
  const missing = requiredNames.filter(name => !hasExactValue(environment[name]))
  if (missing.length > 0) {
    return stopped('not-run', 2, missing.map(name => `missing:${name}`))
  }

  let execution: RealTelegramExecutionConfig
  try {
    const botToken = exactTelegramToken(environment.DSH_TELEGRAM_BOT_TOKEN!, 'DSH_TELEGRAM_BOT_TOKEN')
    const accountId = exactText(environment.DSH_TELEGRAM_ACCOUNT_ID!, 'DSH_TELEGRAM_ACCOUNT_ID', 256)
    const apiBase = exactApiBase(environment.DSH_TELEGRAM_BOT_API_BASE ?? 'https://api.telegram.org')
    const dshSourceDir = exactAbsolutePath(
      environment.DSH_TELEGRAM_DSH_SOURCE_DIR!,
      'DSH_TELEGRAM_DSH_SOURCE_DIR',
    )
    const runRoot = exactAbsolutePath(
      environment.DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT!,
      'DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT',
    )
    const interactionTimeoutMs = optionalInteger(
      environment.DSH_TELEGRAM_REAL_CHANNEL_TIMEOUT_MS,
      'DSH_TELEGRAM_REAL_CHANNEL_TIMEOUT_MS',
      300_000,
      60_000,
      900_000,
    )
    execution = Object.freeze({
      botToken,
      accountId,
      apiBase,
      dshSourceDir,
      runRoot,
      interactionTimeoutMs,
    })
  } catch (error: unknown) {
    return stopped('failed', 1, [boundedReason(error)])
  }
  if (containsPath(execution.dshSourceDir, execution.runRoot)
    || containsPath(execution.runRoot, execution.dshSourceDir)) {
    return stopped('failed', 1, ['invalid:acceptance-roots-overlap'])
  }
  return Object.freeze({
    status: 'ready',
    report: Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'ready',
      chatKind: 'direct',
      accountIdentityHash: sha256(JSON.stringify([execution.accountId, execution.botToken])),
      interactionTimeoutMs: execution.interactionTimeoutMs,
    }),
    execution,
  })
}

/** Decode one retained report before it can suppress a new real-Bot run. */
export function assertRealTelegramTerminalReport(
  value: unknown,
  expected: RealTelegramTerminalIdentity,
): asserts value is RealTelegramTerminalReport {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.benchmarkId !== BENCHMARK_ID
    || (value.status !== 'passed' && value.status !== 'failed')
    || !boundedText(value.scope, 2_048)
    || value.manifestHash !== expected.manifestHash
    || !isRecord(value.revisions)
    || value.revisions.evoforge !== expected.evoforgeRevision
    || value.revisions.deepSeekHarness !== undefined
    || value.revisions.deepseekHarness !== expected.dshRevision
    || value.revisions.auditedLatestDeepseekHarness !== expected.auditedLatestDshRevision
    || value.chatKind !== expected.preflight.chatKind
    || value.accountIdentityHash !== expected.preflight.accountIdentityHash
    || (value.routeIdentityHash !== undefined
      && (typeof value.routeIdentityHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.routeIdentityHash)))
    || !boundedText(value.stage, 128)) {
    throw new Error('AS-1 retained terminal report identity is invalid')
  }
  const observations = value.observations
  if (!isRecord(observations)
    || !hasExactKeys(observations, terminalObservationNames)
    || terminalObservationNames.some(name => typeof observations[name] !== 'boolean')) {
    throw new Error('AS-1 retained terminal report observations are invalid')
  }
  const reasons = value.reasons
  if (!Array.isArray(reasons)
    || reasons.some(reason => !boundedText(reason, 512))
    || (value.status === 'passed'
      ? value.stage !== 'complete'
        || !/^[a-f0-9]{64}$/u.test(String(value.routeIdentityHash ?? ''))
        || reasons.length !== 0
        || terminalObservationNames.some(name => observations[name] !== true)
      : reasons.length === 0)) {
    throw new Error('AS-1 retained terminal report verdict is invalid')
  }
  const gateway = value.gateway
  if (gateway !== undefined && (!isRecord(gateway)
    || !hasExactKeys(gateway, terminalGatewayNames)
    || terminalGatewayNames.some(name => !Number.isSafeInteger(gateway[name]) || Number(gateway[name]) < 0))) {
    throw new Error('AS-1 retained terminal report Gateway facts are invalid')
  }
}

export function emptyTelegramObservations(): Record<(typeof terminalObservationNames)[number], boolean> {
  return Object.fromEntries(terminalObservationNames.map(name => [name, false])) as Record<
    (typeof terminalObservationNames)[number], boolean
  >
}

function exactTelegramToken(value: string, name: string): string {
  const token = exactText(value, name, 512)
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,256}$/u.test(token)) throw new Error(`invalid:${name}`)
  return token
}

function exactApiBase(value: string): string {
  const base = exactText(value, 'DSH_TELEGRAM_BOT_API_BASE', 512)
  let url: URL
  try {
    url = new URL(base)
  } catch {
    throw new Error('invalid:DSH_TELEGRAM_BOT_API_BASE')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('invalid:DSH_TELEGRAM_BOT_API_BASE')
  }
  const official = url.protocol === 'https:' && url.hostname === 'api.telegram.org'
    && (url.pathname === '' || url.pathname === '/')
  if (!official) throw new Error('invalid:DSH_TELEGRAM_BOT_API_BASE')
  return base.replace(/\/$/u, '')
}

function exactText(value: string, field: string, maxBytes: number): string {
  if (!hasExactValue(value) || Buffer.byteLength(value) > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`invalid:${field}`)
  return value
}

function exactAbsolutePath(value: string, name: string): string {
  const resolvedValue = exactText(value, name, 4_096)
  if (!isAbsolute(resolvedValue)) throw new Error(`invalid:${name}`)
  const canonical = resolve(resolvedValue)
  if (canonical !== resolvedValue || dirname(canonical) === canonical) throw new Error(`invalid:${name}`)
  return canonical
}

function optionalInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`invalid:${name}`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`invalid:${name}`)
  return parsed
}

function stopped(
  status: 'not-run' | 'failed',
  exitCode: 1 | 2,
  reasons: readonly string[],
): Extract<RealTelegramAcceptanceResolution, { status: 'not-run' | 'failed' }> {
  return Object.freeze({
    status,
    exitCode,
    report: Object.freeze({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status,
      reasons: Object.freeze([...reasons]),
    }),
  })
}

function hasExactValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value.trim() === value
}

function containsPath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0
    && value.trim() === value && Buffer.byteLength(value) <= maxBytes
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function boundedReason(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown acceptance preflight failure'
}
