import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'

export const BENCHMARK_ID = 'as2-feishu-resident-pairing-epoch-4'
export const REAL_FEISHU_APPROVAL = 'I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS'

const terminalObservationNames = [
  'finalTarballsInstalled',
  'profileDumped',
  'officialTransportReady',
  'residentPairingGranted',
  'exactInboundChallenge',
  'replyDelivered',
  'commandRoundTrip',
  'nativeScheduleRoundTrip',
  'approvalAllowedOnce',
  'noticeDelivered',
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
  'DSH_FEISHU_APP_ID',
  'DSH_FEISHU_APP_SECRET',
  'DSH_FEISHU_DSH_SOURCE_DIR',
  'DSH_FEISHU_REAL_CHANNEL_RUN_ROOT',
] as const

export interface RealFeishuExecutionConfig {
  readonly appId: string
  readonly appSecret: string
  readonly dshSourceDir: string
  readonly runRoot: string
  readonly interactionTimeoutMs: number
}

export type RealFeishuAcceptanceResolution =
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
        readonly appIdentityHash: string
        readonly interactionTimeoutMs: number
      }
      readonly execution: RealFeishuExecutionConfig
      readonly exitCode?: undefined
    }

export interface RealFeishuTerminalReport {
  readonly schemaVersion: 1
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly status: 'passed' | 'failed'
  readonly scope: string
  readonly manifestHash: string
  readonly revisions: { readonly evoforge: string; readonly deepseekHarness: string }
  readonly chatKind: 'direct'
  readonly appIdentityHash: string
  /** Hashed only after the unknown DM is approved; external principal ids never enter public output. */
  readonly routeIdentityHash?: string
  readonly stage: string
  readonly observations: Readonly<Record<(typeof terminalObservationNames)[number], boolean>>
  readonly gateway?: Readonly<Record<(typeof terminalGatewayNames)[number], number>>
  readonly reasons: readonly string[]
}

export interface RealFeishuTerminalIdentity {
  readonly manifestHash: string
  readonly evoforgeRevision: string
  readonly dshRevision: string
  readonly preflight: Extract<RealFeishuAcceptanceResolution, { status: 'ready' }>['report']
}

export interface RealFeishuRuntimeEvent {
  readonly type: string
  readonly data?: unknown
}

/** Match the official Schedule facts exactly; there is no plugin:schedule event type. */
export function hasExactNativeScheduleRoundTrip(events: readonly RealFeishuRuntimeEvent[]): boolean {
  let created = 0
  let dispatched = 0
  let deliveredToSession = 0
  for (const event of events) {
    if (event.type === 'schedule/change' && isRecord(event.data)) {
      if (event.data.operation === 'create') created += 1
      if (event.data.operation === 'dispatch') dispatched += 1
    }
    if (event.type === 'user/message' && isRecord(event.data) && isRecord(event.data.source)
      && event.data.source.kind === 'plugin' && event.data.source.plugin === 'schedule') {
      deliveredToSession += 1
    }
  }
  return created === 1 && dispatched === 1 && deliveredToSession === 1
}

/**
 * Decode one retained AS-2 result before it can suppress a new real-platform
 * run. The exact epoch owns a closed hard-gate set, including native Schedule;
 * an older, partial, or malformed report is never reusable evidence.
 */
export function assertRealFeishuTerminalReport(
  value: unknown,
  expected: RealFeishuTerminalIdentity,
): asserts value is RealFeishuTerminalReport {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.benchmarkId !== BENCHMARK_ID
    || (value.status !== 'passed' && value.status !== 'failed')
    || !boundedText(value.scope, 2_048)
    || value.manifestHash !== expected.manifestHash
    || !isRecord(value.revisions)
    || value.revisions.evoforge !== expected.evoforgeRevision
    || value.revisions.deepseekHarness !== expected.dshRevision
    || value.chatKind !== expected.preflight.chatKind
    || value.appIdentityHash !== expected.preflight.appIdentityHash
    || (value.routeIdentityHash !== undefined
      && (typeof value.routeIdentityHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.routeIdentityHash)))
    || !boundedText(value.stage, 128)) {
    throw new Error('AS-2 retained terminal report identity is invalid')
  }
  const observations = value.observations
  if (!isRecord(observations)
    || !hasExactKeys(observations, terminalObservationNames)
    || terminalObservationNames.some(name => typeof observations[name] !== 'boolean')) {
    throw new Error('AS-2 retained terminal report observations are invalid')
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
    throw new Error('AS-2 retained terminal report verdict is invalid')
  }
  const gateway = value.gateway
  if (gateway !== undefined && (!isRecord(gateway)
    || !hasExactKeys(gateway, terminalGatewayNames)
    || terminalGatewayNames.some(name => !Number.isSafeInteger(gateway[name]) || Number(gateway[name]) < 0))) {
    throw new Error('AS-2 retained terminal report Gateway facts are invalid')
  }
}

/** Resolve authorization before inspecting any platform identity or secret. */
export function resolveRealFeishuAcceptance(
  environment: NodeJS.ProcessEnv,
): RealFeishuAcceptanceResolution {
  if (environment.DSH_FEISHU_REAL_CHANNEL_APPROVED !== REAL_FEISHU_APPROVAL) {
    return stopped('not-run', 2, ['real-feishu-effects-not-authorized'])
  }
  const missing = requiredNames.filter(name => !hasExactValue(environment[name]))
  if (missing.length > 0) {
    return stopped('not-run', 2, missing.map(name => `missing:${name}`))
  }

  let execution: RealFeishuExecutionConfig
  try {
    const appId = exactIdentity(environment.DSH_FEISHU_APP_ID!, 'DSH_FEISHU_APP_ID', /^cli_[A-Za-z0-9_-]+$/u)
    const appSecret = exact(environment.DSH_FEISHU_APP_SECRET!, 'DSH_FEISHU_APP_SECRET', 16 * 1_024)
    const dshSourceDir = exactAbsolutePath(environment.DSH_FEISHU_DSH_SOURCE_DIR!, 'DSH_FEISHU_DSH_SOURCE_DIR')
    const runRoot = exactAbsolutePath(
      environment.DSH_FEISHU_REAL_CHANNEL_RUN_ROOT!,
      'DSH_FEISHU_REAL_CHANNEL_RUN_ROOT',
    )
    const interactionTimeoutMs = optionalInteger(
      environment.DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS,
      'DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS',
      300_000,
      60_000,
      900_000,
    )
    execution = Object.freeze({
      appId,
      appSecret,
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
      appIdentityHash: sha256(execution.appId),
      interactionTimeoutMs: execution.interactionTimeoutMs,
    }),
    execution,
  })
}

function hasExactValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value.trim() === value
}

function exactIdentity(value: string, name: string, pattern: RegExp): string {
  const resolved = exact(value, name, 512)
  if (!pattern.test(resolved)) throw new Error(`invalid:${name}`)
  return resolved
}

function exact(value: string, name: string, maxBytes: number): string {
  if (!hasExactValue(value) || Buffer.byteLength(value) > maxBytes
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`invalid:${name}`)
  return value
}

function exactAbsolutePath(value: string, name: string): string {
  const resolvedValue = exact(value, name, 4_096)
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
): Extract<RealFeishuAcceptanceResolution, { status: 'not-run' | 'failed' }> {
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

function containsPath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

function boundedReason(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 256) || 'invalid:unknown'
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= maxBytes
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
