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
  readonly gateway?: RuntimeGatewayReadinessSnapshot
}

export interface RuntimeGatewayReadinessSnapshot {
  readonly lifecycle: 'starting' | 'ready' | 'stopping'
  readonly transports: {
    readonly items: readonly RuntimeChannelTransport[]
  }
}

export interface RuntimeChannelTransport {
  readonly adapter: string
  readonly state: 'connecting' | 'ready' | 'degraded' | 'stopping'
}

export interface ReadinessCheck {
  readonly id: 'required-plugins' | 'runtime-failures' | 'channel-feishu' | 'channel-telegram'
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
  const checks: ReadinessCheck[] = [requiredCheck, failureCheck]
  for (const channel of CHANNELS) {
    if (!input.requiredModules.includes(channel.moduleName)
      || !input.entries.some(entry => entry.moduleName === channel.moduleName
        && entry.enabled && entry.phase === 'active')) continue
    checks.push(channelReadinessCheck(channel, input.gateway))
  }
  return {
    schemaVersion: 1,
    status: checks.some(check => check.status === 'failed')
      ? 'not-ready'
      : checks.some(check => check.status === 'unknown') ? 'unknown' : 'ready',
    checks,
  }
}

const CHANNELS = [
  { id: 'channel-feishu', moduleName: 'dsh-feishu', adapter: 'feishu', label: 'Feishu' },
  { id: 'channel-telegram', moduleName: 'dsh-telegram', adapter: 'telegram', label: 'Telegram' },
] as const

function channelReadinessCheck(
  channel: typeof CHANNELS[number],
  gateway: RuntimeGatewayReadinessSnapshot | undefined,
): ReadinessCheck {
  const transports = gateway?.transports.items.filter(item => item.adapter === channel.adapter) ?? []
  if (transports.length === 0) {
    return {
      id: channel.id,
      status: 'failed',
      summary: `Required ${channel.label} transport is unavailable.`,
      action: `Enable dsh-gateway and one exact ${channel.label} route, then run /doctor again.`,
    }
  }
  if (transports.some(item => item.state === 'degraded')) {
    return {
      id: channel.id,
      status: 'failed',
      summary: `Required ${channel.label} transport is degraded.`,
      action: `Check the ${channel.label} credentials, exact route, network/proxy, and Adapter diagnostics, then run /doctor again.`,
    }
  }
  if (gateway?.lifecycle === 'ready' && transports.every(item => item.state === 'ready')) {
    return {
      id: channel.id,
      status: 'passed',
      summary: `${transports.length} required ${channel.label} transport${transports.length === 1 ? ' is' : 's are'} ready.`,
    }
  }
  const connecting = transports.filter(item => item.state === 'connecting').length
  const stopping = transports.filter(item => item.state === 'stopping').length
  const phases = [
    ...(connecting === 0 ? [] : [`${connecting} connecting`]),
    ...(stopping === 0 ? [] : [`${stopping} stopping`]),
  ]
  return {
    id: channel.id,
    status: 'unknown',
    summary: `Required ${channel.label} transport is still changing: ${phases.join(', ') || `Gateway ${gateway?.lifecycle ?? 'unavailable'}`}.`,
    action: `Wait for the ${channel.label} Adapter lifecycle to settle, then run /doctor again.`,
  }
}

function activeRequiredSummary(count: number): string {
  return count === 1
    ? '1 required plugin is active.'
    : `${count} required plugins are active.`
}
