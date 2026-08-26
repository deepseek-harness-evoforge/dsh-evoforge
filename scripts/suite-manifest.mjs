/**
 * User-facing capability suites. The package list is intentionally explicit:
 * DSH installs each official Bundle, while this manifest keeps the product
 * surface small without hiding independent lifecycle and permission seams.
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

export const SUITES = Object.freeze({
  evolution: suite(
    'evolution',
    'Self-evolution',
    'Evidence-driven Skill evolution and runtime readiness diagnostics.',
    ['dsh-evolve', 'dsh-doctor'],
    ['dsh-evolve creates no second Session, Goal, Runtime, or approval system.'],
  ),
  control: suite(
    'control',
    'Web control center',
    'One native DSH Web view for suite status, evidence, and governed actions.',
    ['dsh-control-center', 'dsh-evolve-web'],
    ['The Control Center is a shared UI shell; dsh-evolve-web is its evolution adapter.'],
  ),
  gateway: suite(
    'gateway',
    'Channel gateway',
    'Resident, fail-closed routing and durable delivery foundation for channel adapters.',
    ['dsh-gateway'],
    ['Install this only when another adapter will consume the gateway seam.'],
  ),
  channels: suite(
    'channels',
    'Messaging channels',
    'Gateway plus private Feishu and Telegram adapters with optional evolution attention.',
    ['dsh-gateway', 'dsh-feishu', 'dsh-telegram', 'dsh-evolve-attention', 'dsh-control-center'],
    ['Adapters are disabled until their exact credentials and routes are configured.'],
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

export function validateSuiteManifest() {
  const known = new Set(PACKAGE_NAMES)
  const errors = []
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
