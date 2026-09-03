import { inspectDshTarget } from './run-dsh-compatibility-matrix.mjs'
import { pathToFileURL } from 'node:url'

/**
 * Fail before the long repository check when assembled tests do not have an
 * exact, clean DSH checkout. The full check intentionally never guesses a
 * nearby checkout: a newer or dirty DSH can make a failure look like a
 * regression in EvoForge.
 */
export function requireDshPreflight(env = process.env) {
  const sourceDir = env.DSH_EVOLVE_DSH_SOURCE_DIR?.trim()
  if (sourceDir === undefined || sourceDir === '') {
    throw new Error([
      'DSH preflight failed: DSH_EVOLVE_DSH_SOURCE_DIR is required for pnpm check.',
      'Point it at a clean checkout of the exact audited DSH alpha.5 target, for example:',
      '  DSH_EVOLVE_DSH_SOURCE_DIR=/path/to/dsh-v0.1.2-alpha.5 pnpm run check',
      'Run pnpm run check:docs or pnpm run check:ci for checks that do not load DSH runtime artifacts.',
    ].join('\n'))
  }

  try {
    const target = inspectDshTarget(sourceDir)
    process.stdout.write(`DSH preflight passed for ${target.version} ${target.revision} at ${target.root}\n`)
    return target
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error([
      `DSH preflight failed for '${sourceDir}'.`,
      detail,
      'Use a clean checkout of the exact audited DSH alpha.5 target; do not point the full check at latest master unless it is explicitly admitted.',
    ].join('\n'))
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireDshPreflight()
}
