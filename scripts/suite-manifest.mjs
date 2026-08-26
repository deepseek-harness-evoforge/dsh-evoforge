/**
 * Capability suites. The package list is intentionally explicit: DSH installs
 * each official Bundle, while this manifest keeps the product surface small
 * without hiding independent lifecycle and permission seams.
 */
export const PACKAGE_NAMES = Object.freeze([
  'dsh-control-center',
  'dsh-doctor',
  'dsh-evolve',
  'dsh-evolve-attention',
  'dsh-evolve-web',
  'dsh-feishu',
  'dsh-gateway',
  'dsh-github-review',
  'dsh-goal-continuity',
  'dsh-resident',
  'dsh-software-delivery',
  'dsh-telegram',
])

const suite = (id, label, description, packages, notes = []) => Object.freeze({
  id,
  label,
  description,
  packages: Object.freeze([...packages]),
  notes: Object.freeze([...notes]),
})

/**
 * Default product entries shown to users. The remaining entries are either
 * optional add-ons, compatibility aliases, or maintainer-only validation
 * compositions. Keeping this distinction here prevents the installer/docs
 * from turning every physical Bundle into a product choice.
 */
export const PUBLIC_SUITE_IDS = Object.freeze([
  'core',
  'channels',
  'delivery',
  'continuity',
])

/** The least-surprising install preset for an invocation without --suite. */
export const DEFAULT_SUITE_ID = 'core'

/** First-party channel adapters that can be selected independently at pack time. */
export const CHANNEL_ADAPTER_IDS = Object.freeze(['feishu', 'telegram'])

export const OPTIONAL_SUITE_IDS = Object.freeze(['attention'])

export const COMPATIBILITY_SUITE_IDS = Object.freeze(['evolution', 'control', 'gateway'])

export function getSuiteAudience(id) {
  if (PUBLIC_SUITE_IDS.includes(id)) return 'default'
  if (OPTIONAL_SUITE_IDS.includes(id)) return 'optional'
  if (COMPATIBILITY_SUITE_IDS.includes(id)) return 'compatibility'
  if (id === 'full') return 'maintainer'
  throw new Error(`Unknown suite audience: ${id}`)
}

export const SUITES = Object.freeze({
  core: suite(
    'core',
    'EvoForge Core',
    'Self-evolution, zero-token diagnostics, and the shared native DSH Web control surface.',
    ['dsh-evolve', 'dsh-doctor', 'dsh-control-center', 'dsh-evolve-web'],
    ['This is the default installation entry for the core product. The four Bundles remain independently removable.'],
  ),
  evolution: suite(
    'evolution',
    'Self-evolution',
    'Evidence-driven Skill evolution and runtime readiness diagnostics.',
    ['dsh-evolve', 'dsh-doctor'],
    ['Compatibility entry; new installations should use core. dsh-evolve creates no second Session, Goal, Runtime, or approval system.'],
  ),
  control: suite(
    'control',
    'Web control center',
    'One native DSH Web view for suite status, evidence, and governed actions.',
    ['dsh-control-center', 'dsh-evolve-web'],
    ['Compatibility entry; new installations should use core. The Control Center is a shared UI shell; dsh-evolve-web is its evolution adapter.'],
  ),
  gateway: suite(
    'gateway',
    'Channel gateway',
    'Resident, fail-closed routing and durable delivery foundation for channel adapters.',
    ['dsh-gateway'],
    ['Advanced compatibility entry; channels installs the gateway with both first-party adapters. Install this alone only when another adapter will consume the gateway seam.'],
  ),
  channels: suite(
    'channels',
    'Messaging channels',
    'Gateway plus private Feishu and Telegram adapters, without forcing optional attention or the core Web surface.',
    ['dsh-gateway', 'dsh-feishu', 'dsh-telegram'],
    ['Adapters are disabled until their exact credentials and routes are configured. Install core for the native Web control surface and attention only when channel notifications are required.'],
  ),
  attention: suite(
    'attention',
    'Channel attention add-on',
    'Optional delivery of actionable EvoForge review and promotion notices through configured channel adapters.',
    ['dsh-evolve-attention'],
    ['Optional add-on; requires dsh-evolve and at least one configured Feishu or Telegram adapter. It does not add a second Gateway or notification runtime.'],
  ),
  delivery: suite(
    'delivery',
    'Software delivery',
    'Verified worktree delivery and optional Draft PR review follow-up.',
    ['dsh-software-delivery', 'dsh-github-review'],
    ['GitHub review stays optional because its external read/follow-up trust boundary differs.'],
  ),
  continuity: suite(
    'continuity',
    'Continuity and residence',
    'Bounded native Goal cold resume and user-level OS service registration.',
    ['dsh-goal-continuity', 'dsh-resident'],
    ['Both are opt-in and reuse native DSH Goal/Commands and OS service authorities.'],
  ),
  full: suite(
    'full',
    'Full EvoForge suite',
    'Every independently removable package, for maintainers and complete acceptance tests.',
    PACKAGE_NAMES,
  ),
})

export function getSuite(id) {
  const value = SUITES[id]
  if (value === undefined) {
    throw new Error(`Unknown capability suite: ${id}. Choose one of: ${Object.keys(SUITES).join(', ')}`)
  }
  return value
}

/**
 * Resolve an optional channel selection without merging the Gateway and its
 * platform Adapter into one runtime Bundle. The selection is a packaging
 * convenience only; DSH still installs each returned Bundle independently.
 */
export function getSuitePackages(id, channel) {
  const value = getSuite(id)
  if (channel === undefined) return value.packages
  if (id !== 'channels') {
    throw new Error(`--channel is only valid with --suite channels (received ${id})`)
  }
  if (!CHANNEL_ADAPTER_IDS.includes(channel)) {
    throw new Error(`Unknown channel: ${channel}. Choose one of: ${CHANNEL_ADAPTER_IDS.join(', ')}`)
  }
  return Object.freeze(['dsh-gateway', `dsh-${channel}`])
}

export function validateSuiteManifest() {
  const known = new Set(PACKAGE_NAMES)
  const errors = []
  const declaredIds = new Set([
    ...PUBLIC_SUITE_IDS,
    ...OPTIONAL_SUITE_IDS,
    ...COMPATIBILITY_SUITE_IDS,
    'full',
  ])
  for (const id of declaredIds) if (SUITES[id] === undefined) errors.push(`declared suite ${id} is missing`)
  for (const id of Object.keys(SUITES)) if (!declaredIds.has(id)) errors.push(`suite ${id} has no audience classification`)
  for (const [id, value] of Object.entries(SUITES)) {
    if (value.id !== id) errors.push(`suite ${id} has mismatched id ${value.id}`)
    const seen = new Set()
    for (const name of value.packages) {
      if (!known.has(name)) errors.push(`suite ${id} references unknown package ${name}`)
      if (seen.has(name)) errors.push(`suite ${id} repeats package ${name}`)
      seen.add(name)
    }
  }
  const full = new Set(SUITES.full.packages)
  for (const name of PACKAGE_NAMES) if (!full.has(name)) errors.push(`full suite omits ${name}`)
  return errors
}
