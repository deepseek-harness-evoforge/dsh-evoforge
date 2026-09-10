import { PAID_PROVIDER_APPROVAL } from './contract.ts'

export { PAID_PROVIDER_APPROVAL }

export const BENCHMARK_ID = 'rp1-internal-skill-evolution-epoch-2-model-declared-gap-fixture'

/**
 * Epoch 2 has no attested paid-runtime implementation. Approval is checked as
 * the sole input; provider configuration and private paths must remain unread.
 */
export function resolveRealProviderAcceptance(environment: NodeJS.ProcessEnv) {
  if (environment.DSH_EVOLVE_REAL_PROVIDER_APPROVED !== PAID_PROVIDER_APPROVAL) {
    return Object.freeze({
      status: 'not-run' as const,
      exitCode: 2 as const,
      report: Object.freeze({
        schemaVersion: 1 as const,
        benchmarkId: BENCHMARK_ID,
        status: 'not-run' as const,
        reasons: Object.freeze(['paid-provider-execution-not-authorized'] as const),
      }),
    })
  }

  return Object.freeze({
    status: 'failed' as const,
    exitCode: 1 as const,
    report: Object.freeze({
      schemaVersion: 1 as const,
      benchmarkId: BENCHMARK_ID,
      status: 'failed' as const,
      reasons: Object.freeze(['paid-provider-execution-blocked:runtime-attestation-incomplete'] as const),
    }),
  })
}

export type RealProviderAcceptanceResolution = ReturnType<typeof resolveRealProviderAcceptance>
