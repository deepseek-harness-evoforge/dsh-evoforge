import type {
  CounterfactualCanary,
  CounterfactualCanaryRunView,
} from './counterfactual-canary.ts'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'

export type FutureSessionRollbackReason =
  | 'explicit-human-rollback'
  | 'exact-canary-rollback-eligible'
  | 'no-active-generation'
  | 'active-generation-workspace-mismatch'
  | 'rollback-target-missing'
  | 'rollback-target-workspace-mismatch'
  | 'canary-evidence-invalid'
  | 'canary-governance-unavailable'
  | 'canary-not-found'
  | 'canary-not-rollback-eligible'
  | 'canary-generation-mismatch'

export type FutureSessionRollbackEligibility =
  | {
      readonly status: 'eligible'
      readonly reason: 'explicit-human-rollback' | 'exact-canary-rollback-eligible'
      readonly generationId: string
      readonly rollbackTargetId?: string
      readonly canaryId?: string
    }
  | {
      readonly status: 'blocked'
      readonly reason: Exclude<
        FutureSessionRollbackReason,
        'explicit-human-rollback' | 'exact-canary-rollback-eligible'
      >
      readonly generationId?: string
      readonly canaryId?: string
    }

export interface FutureSessionRollbackModules {
  readonly store: Pick<
    EvolutionStore,
    'getActiveGeneration' | 'getGeneration' | 'rollbackGeneration'
  >
  readonly canary?: Pick<CounterfactualCanary, 'scan'>
}

/**
 * The sole Host mutation seam for future-Session rollback. It keeps explicit
 * human recovery available, while an evidence-driven request must bind one
 * exact terminal Canary to the still-active Generation.
 */
export class FutureSessionRollback {
  private readonly modules: FutureSessionRollbackModules

  constructor(modules: FutureSessionRollbackModules) {
    this.modules = modules
  }

  async eligibility(
    workspaceId: string,
    options: { readonly canaryId?: string } = {},
  ): Promise<FutureSessionRollbackEligibility> {
    const active = this.modules.store.getActiveGeneration(workspaceId)
    if (active === undefined) return blocked('no-active-generation', options.canaryId)
    const target = this.exactTarget(workspaceId, active)
    if (target.status === 'blocked') return target
    if (options.canaryId === undefined) {
      return Object.freeze({
        status: 'eligible',
        reason: 'explicit-human-rollback',
        generationId: active.id,
        ...(target.generation === undefined ? {} : { rollbackTargetId: target.generation.id }),
      })
    }

    if (this.modules.canary === undefined) {
      return blocked('canary-governance-unavailable', options.canaryId, active.id)
    }
    const scan = await this.modules.canary.scan(workspaceId)
    if (!validScanShape(scan)) {
      return blocked('canary-evidence-invalid', options.canaryId, active.id)
    }
    const matches = scan.runs.filter(run => run.id === options.canaryId)
    if (matches.length === 0) return blocked('canary-not-found', options.canaryId, active.id)
    if (matches.length !== 1) return blocked('canary-evidence-invalid', options.canaryId, active.id)
    const run = matches[0]!
    if (run.generationId !== active.id || run.workspaceId !== workspaceId) {
      return blocked('canary-generation-mismatch', options.canaryId, active.id)
    }
    if (!validRollbackVerdict(run)) {
      return blocked('canary-not-rollback-eligible', options.canaryId, active.id)
    }
    return Object.freeze({
      status: 'eligible',
      reason: 'exact-canary-rollback-eligible',
      generationId: active.id,
      ...(target.generation === undefined ? {} : { rollbackTargetId: target.generation.id }),
      canaryId: options.canaryId,
    })
  }

  async rollback(
    workspaceId: string,
    options: { readonly canaryId?: string } = {},
  ): Promise<{
    readonly previousId: string
    readonly generation: CapabilityGeneration | undefined
    readonly authority: 'explicit-human' | 'counterfactual-canary'
    readonly canaryId?: string
  }> {
    const eligibility = await this.eligibility(workspaceId, options)
    if (eligibility.status !== 'eligible') {
      throw new Error(`future-Session rollback blocked: ${eligibility.reason}`)
    }
    const result = await this.modules.store.rollbackGeneration(workspaceId, eligibility.generationId)
    return Object.freeze({
      ...result,
      authority: eligibility.canaryId === undefined ? 'explicit-human' : 'counterfactual-canary',
      ...(eligibility.canaryId === undefined ? {} : { canaryId: eligibility.canaryId }),
    })
  }

  private exactTarget(
    workspaceId: string,
    active: CapabilityGeneration,
  ):
    | { readonly status: 'eligible'; readonly generation: CapabilityGeneration | undefined }
    | Extract<FutureSessionRollbackEligibility, { status: 'blocked' }> {
    if (active.workspaceId !== workspaceId) {
      return blocked('active-generation-workspace-mismatch', undefined, active.id)
    }
    if (active.parentId === undefined) {
      return { status: 'eligible', generation: undefined }
    }
    const parent = this.modules.store.getGeneration(active.parentId)
    if (parent === undefined) return blocked('rollback-target-missing', undefined, active.id)
    if (parent.workspaceId !== workspaceId) {
      return blocked('rollback-target-workspace-mismatch', undefined, active.id)
    }
    return { status: 'eligible', generation: parent }
  }
}

function validScanShape(scan: Awaited<ReturnType<CounterfactualCanary['scan']>>): boolean {
  return Number.isSafeInteger(scan.configuredRootCount)
    && scan.configuredRootCount > 0
    && Number.isSafeInteger(scan.warningCount)
    && scan.warningCount === 0
}

function validRollbackVerdict(run: CounterfactualCanaryRunView | { readonly status: 'prepared' }): boolean {
  if (run.status !== 'rollback-eligible') return false
  const evidence = run.evidence
  return run.reason === 'candidate-regressed-sealed-canary'
    && run.releaseAuthority === 'none'
    && evidence !== undefined
    && evidence.baseline === 'pass'
    && evidence.candidate === 'fail'
    && evidence.calibrationPassed
    && evidence.assembled
    && evidence.compositionStable
    && evidence.inputIntegrityStable
    && evidence.activePointerStable
    && evidence.proposerCalls === 0
    && evidence.trialCount === 4
}

function blocked(
  reason: Extract<FutureSessionRollbackEligibility, { status: 'blocked' }>['reason'],
  canaryId?: string,
  generationId?: string,
): Extract<FutureSessionRollbackEligibility, { status: 'blocked' }> {
  return Object.freeze({
    status: 'blocked',
    reason,
    ...(generationId === undefined ? {} : { generationId }),
    ...(canaryId === undefined ? {} : { canaryId }),
  })
}
