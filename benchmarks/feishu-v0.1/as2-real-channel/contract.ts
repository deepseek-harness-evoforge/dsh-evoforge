import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'

export const BENCHMARK_ID = 'as2-feishu-real-channel-epoch-1'
export const REAL_FEISHU_APPROVAL = 'I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS'

const requiredNames = [
  'DSH_FEISHU_APP_ID',
  'DSH_FEISHU_APP_SECRET',
  'DSH_FEISHU_CONVERSATION_ID',
  'DSH_FEISHU_USER_ID',
  'DSH_FEISHU_CHAT_KIND',
  'DSH_FEISHU_DSH_SOURCE_DIR',
  'DSH_FEISHU_REAL_CHANNEL_RUN_ROOT',
] as const

export interface RealFeishuExecutionConfig {
  readonly appId: string
  readonly appSecret: string
  readonly conversationId: string
  readonly userId: string
  readonly chatKind: 'direct' | 'group'
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
        readonly chatKind: 'direct' | 'group'
        readonly appIdentityHash: string
        readonly routeIdentityHash: string
        readonly interactionTimeoutMs: number
      }
      readonly execution: RealFeishuExecutionConfig
      readonly exitCode?: undefined
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
    const conversationId = exactIdentity(
      environment.DSH_FEISHU_CONVERSATION_ID!,
      'DSH_FEISHU_CONVERSATION_ID',
      /^oc_[A-Za-z0-9_-]+$/u,
    )
    const userId = exactIdentity(environment.DSH_FEISHU_USER_ID!, 'DSH_FEISHU_USER_ID', /^ou_[A-Za-z0-9_-]+$/u)
    const chatKind = exact(environment.DSH_FEISHU_CHAT_KIND!, 'DSH_FEISHU_CHAT_KIND', 16)
    if (chatKind !== 'direct' && chatKind !== 'group') throw new Error('invalid:DSH_FEISHU_CHAT_KIND')
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
      conversationId,
      userId,
      chatKind,
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
      chatKind: execution.chatKind,
      appIdentityHash: sha256(execution.appId),
      routeIdentityHash: sha256(JSON.stringify([
        execution.appId,
        execution.conversationId,
        execution.userId,
        execution.chatKind,
      ])),
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
