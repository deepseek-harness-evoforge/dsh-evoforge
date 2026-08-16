export type RuntimePluginPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface RuntimePluginEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly phase: RuntimePluginPhase
}

export interface RuntimeReadinessInput {
  readonly requiredModules: readonly string[]
  readonly entries: readonly RuntimePluginEntry[]
}

export interface ReadinessCheck {
  readonly id: 'required-plugins' | 'runtime-failures'
  readonly status: 'passed' | 'failed' | 'unknown'
  readonly summary: string
  readonly action?: string
}

export interface RuntimeReadinessReport {
  readonly schemaVersion: 1
  readonly status: 'ready' | 'not-ready' | 'unknown'
  readonly checks: readonly ReadinessCheck[]
}

/** Classify one point-in-time Loader snapshot without mutating the runtime. */
export function evaluateRuntimeReadiness(input: RuntimeReadinessInput): RuntimeReadinessReport {
  const inactive: string[] = []
  const changing: string[] = []
  for (const moduleName of [...input.requiredModules].sort()) {
    const matches = input.entries.filter(entry => entry.moduleName === moduleName)
    if (matches.some(entry => entry.enabled && entry.phase === 'active')) continue
    if (matches.length === 0) inactive.push(`${moduleName} (missing)`)
    else if (matches.every(entry => !entry.enabled)) inactive.push(`${moduleName} (disabled)`)
    else if (matches.some(entry => entry.enabled && entry.phase === 'failed')) inactive.push(`${moduleName} (failed)`)
    else {
      const phase = matches.find(entry => entry.enabled)?.phase
      changing.push(`${moduleName} (${phase ?? 'no live fiber'})`)
    }
  }
  const failures = input.entries
    .filter(entry => entry.enabled && entry.phase === 'failed')
    .sort((left, right) => left.moduleName.localeCompare(right.moduleName)
      || left.entryId.localeCompare(right.entryId))
  const requiredCheck: ReadinessCheck = inactive.length > 0
    ? {
        id: 'required-plugins',
        status: 'failed',
        summary: `Required plugins are not active: ${inactive.join(', ')}.`,
        action: 'Enable or install the named plugins, then run /doctor again.',
      }
    : changing.length > 0
      ? {
          id: 'required-plugins',
          status: 'unknown',
          summary: `Required plugins are still changing: ${changing.join(', ')}.`,
          action: 'Wait for Loader activity to settle, then run /doctor again.',
        }
      : {
          id: 'required-plugins',
          status: 'passed',
          summary: activeRequiredSummary(input.requiredModules.length),
        }
  const failureCheck: ReadinessCheck = failures.length === 0
    ? {
        id: 'runtime-failures',
        status: 'passed',
        summary: 'No enabled plugin is failed.',
      }
    : {
        id: 'runtime-failures',
        status: 'failed',
        summary: `Enabled plugins failed: ${failures.map(entry => `${entry.moduleName} [${entry.entryId}]`).join(', ')}.`,
        action: 'Inspect the named Loader entry diagnostics, correct its configuration, and reload it.',
      }
  return {
    schemaVersion: 1,
    status: inactive.length > 0 || failures.length > 0
      ? 'not-ready'
      : changing.length > 0 ? 'unknown' : 'ready',
    checks: [requiredCheck, failureCheck],
  }
}

function activeRequiredSummary(count: number): string {
  return count === 1
    ? '1 required plugin is active.'
    : `${count} required plugins are active.`
}
