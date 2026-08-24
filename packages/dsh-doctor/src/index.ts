import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  evaluateRuntimeReadiness,
  type RuntimeGatewayReadinessSnapshot,
  type RuntimePluginEntry,
  type RuntimePluginPhase,
  type RuntimeReadinessReport,
} from './readiness.js'

export const name = 'dsh-doctor'
export const inject = ['commands', 'loader']

const MAX_REQUIRED_MODULES = 50
const FIBER_PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
} as const satisfies Record<FiberState, RuntimePluginPhase>

export interface Config {
  /** Exact Loader module names that must have at least one enabled active entry. */
  readonly requiredModules?: string[]
}

export const Config: Schema<Config> = z.object({
  requiredModules: z.array(z.string()).max(MAX_REQUIRED_MODULES).default(['dsh-doctor']),
})

export function apply(ctx: Context, config: Config = {}): void {
  const requiredModules = normalizeRequiredModules(config.requiredModules ?? ['dsh-doctor'])
  ctx.commands.register({
    name: 'doctor',
    description: 'inspect current DSH runtime readiness without changing it',
    recordInput: false,
    handler: ({ rawInput }) => {
      if (rawInput.trim() !== '') {
        return { kind: 'error', text: 'Usage: /doctor' }
      }
      const gateway = requiredModules.some(moduleName => moduleName === 'dsh-feishu'
        || moduleName === 'dsh-telegram') ? snapshotGateway(ctx) : undefined
      const report = evaluateRuntimeReadiness({
        requiredModules,
        entries: snapshotLoader(ctx),
        ...(gateway === undefined ? {} : { gateway }),
      })
      return renderCommandResult(report)
    },
  })
}

function snapshotGateway(ctx: Context): RuntimeGatewayReadinessSnapshot | undefined {
  const gateway = ctx.get('evoforge.gateway' as never) as {
    healthSnapshot(): unknown
  } | undefined
  if (gateway === undefined) return undefined
  try {
    const snapshot = gateway.healthSnapshot()
    return isRuntimeGatewayReadinessSnapshot(snapshot) ? snapshot : undefined
  } catch {
    return undefined
  }
}

function isRuntimeGatewayReadinessSnapshot(value: unknown): value is RuntimeGatewayReadinessSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.lifecycle !== 'starting' && snapshot.lifecycle !== 'ready' && snapshot.lifecycle !== 'stopping') {
    return false
  }
  if (typeof snapshot.transports !== 'object' || snapshot.transports === null) return false
  const transports = snapshot.transports as Record<string, unknown>
  if (!Array.isArray(transports.items)) return false
  return transports.items.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const transport = item as Record<string, unknown>
    return typeof transport.adapter === 'string'
      && (transport.state === 'connecting'
        || transport.state === 'ready'
        || transport.state === 'degraded'
        || transport.state === 'stopping')
  })
}

/** Render a completed diagnostic as command output; health is data, not handler failure. */
export function renderCommandResult(report: RuntimeReadinessReport): CommandResult {
  const status = report.status === 'ready'
    ? 'READY'
    : report.status === 'not-ready' ? 'NOT READY' : 'UNKNOWN'
  const lines = [`DSH readiness: ${status}`]
  for (const check of report.checks) {
    const mark = check.status === 'passed' ? '✓' : check.status === 'failed' ? '✗' : '?'
    lines.push(`${mark} ${check.id}: ${check.summary}`)
    if (check.action !== undefined) lines.push(`  Next: ${check.action}`)
  }
  return { kind: 'success', text: lines.join('\n') }
}

function snapshotLoader(ctx: Context): RuntimePluginEntry[] {
  const entries: RuntimePluginEntry[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    entries.push({
      entryId: entry.id,
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      phase: fiberPhase(entry.fiber?.state),
    })
  }
  return entries
}

function fiberPhase(state: FiberState | undefined): RuntimePluginPhase {
  if (state === undefined) return null
  return FIBER_PHASE[state] ?? null
}

function normalizeRequiredModules(input: readonly string[]): string[] {
  if (input.length > MAX_REQUIRED_MODULES) {
    throw new Error(`dsh-doctor supports at most ${MAX_REQUIRED_MODULES} required modules`)
  }
  const result = input.map((value) => {
    if (value.trim() !== value || value.length === 0 || value.length > 214 || /\s/u.test(value)) {
      throw new Error(`invalid required Loader module name '${value}'`)
    }
    return value
  })
  if (new Set(result).size !== result.length) {
    throw new Error('dsh-doctor required module names must be unique')
  }
  return result
}

export {
  evaluateRuntimeReadiness,
  type ReadinessCheck,
  type RuntimePluginEntry,
  type RuntimeGatewayReadinessSnapshot,
  type RuntimeChannelTransport,
  type RuntimePluginPhase,
  type RuntimeReadinessInput,
  type RuntimeReadinessReport,
} from './readiness.js'
