import type {
  ExistingSkillCounterfactualCanary,
  ExistingSkillCounterfactualCanaryResult,
} from './existing-skill-counterfactual-canary.ts'
import type { ExistingSkillRelease } from './existing-skill-release.ts'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u

export type ExistingSkillFutureSessionRollbackReason =
  | 'exact-existing-skill-canary-rollback-eligible'
  | 'no-active-generation'
  | 'active-generation-workspace-mismatch'
  | 'rollback-target-missing'
  | 'rollback-target-workspace-mismatch'
  | 'canary-evidence-invalid'
  | 'canary-not-found'
  | 'canary-not-rollback-eligible'
  | 'canary-generation-mismatch'
  | 'release-evidence-invalid'

export type ExistingSkillFutureSessionRollbackEligibility =
  | {
      readonly status: 'eligible'
      readonly reason: 'exact-existing-skill-canary-rollback-eligible'
      readonly generationId: string
      readonly rollbackTargetId?: string
      readonly canaryId: string
    }
  | {
      readonly status: 'blocked'
      readonly reason: Exclude<
        ExistingSkillFutureSessionRollbackReason,
        'exact-existing-skill-canary-rollback-eligible'
      >
      readonly generationId?: string
      readonly canaryId: string
    }

export interface ExistingSkillFutureSessionRollbackModules {
  readonly store: Pick<
    EvolutionStore,
    'getActiveGeneration' | 'getGeneration' | 'rollbackGeneration'
  >
  readonly canary: Pick<ExistingSkillCounterfactualCanary, 'scan'>
  readonly releases: Pick<ExistingSkillRelease, 'eligibility'>
}

/**
 * Human-triggered mutation gate for one exact existing-Skill Canary verdict.
 * The evaluator owns no reference to this class or to rollbackGeneration.
 */
export class ExistingSkillFutureSessionRollback {
  private readonly modules: ExistingSkillFutureSessionRollbackModules

  constructor(modules: ExistingSkillFutureSessionRollbackModules) {
    this.modules = modules
  }

  async eligibility(
    workspaceId: string,
    canaryId: string,
  ): Promise<ExistingSkillFutureSessionRollbackEligibility> {
    const active = this.modules.store.getActiveGeneration(workspaceId)
    if (active === undefined) return blocked('no-active-generation', canaryId)
    if (active.workspaceId !== workspaceId) {
      return blocked('active-generation-workspace-mismatch', canaryId, active.id)
    }
    const target = this.exactTarget(workspaceId, active, canaryId)
    if (target.status === 'blocked') return target

    const scan = await this.modules.canary.scan(workspaceId)
    if (!validScanShape(scan)) return blocked('canary-evidence-invalid', canaryId, active.id)
    const matches = scan.runs.filter(run => run.id === canaryId)
    if (matches.length === 0) return blocked('canary-not-found', canaryId, active.id)
    if (matches.length !== 1) return blocked('canary-evidence-invalid', canaryId, active.id)
    const run = matches[0]!
    if (run.workspaceId !== workspaceId || run.generationId !== active.id) {
      return blocked('canary-generation-mismatch', canaryId, active.id)
    }
    if (!validRollbackVerdict(run)) {
      return blocked('canary-not-rollback-eligible', canaryId, active.id)
    }
    const release = await this.modules.releases.eligibility(workspaceId, run.candidateId)
    if (release.status !== 'approved'
      || release.reason !== 'exact-existing-skill-evidence-retained'
      || release.candidateId !== run.candidateId
      || release.admissionId !== run.admissionId
      || release.holdoutEvaluationId !== run.holdoutEvaluationId
      || release.retentionEvaluationId !== run.retentionEvaluationId
      || release.generationId !== active.id) {
      return blocked('release-evidence-invalid', canaryId, active.id)
    }
    return Object.freeze({
      status: 'eligible',
      reason: 'exact-existing-skill-canary-rollback-eligible',
      generationId: active.id,
      ...(target.generation === undefined ? {} : { rollbackTargetId: target.generation.id }),
      canaryId,
    })
  }

  async rollback(
    workspaceId: string,
    canaryId: string,
  ): Promise<{
    readonly previousId: string
    readonly generation: CapabilityGeneration | undefined
    readonly authority: 'existing-skill-counterfactual-canary'
    readonly canaryId: string
  }> {
    const eligibility = await this.eligibility(workspaceId, canaryId)
    if (eligibility.status !== 'eligible') {
      throw new Error(`existing-Skill future-Session rollback blocked: ${eligibility.reason}`)
    }
    const result = await this.modules.store.rollbackGeneration(workspaceId, eligibility.generationId)
    return Object.freeze({
      ...result,
      authority: 'existing-skill-counterfactual-canary',
      canaryId,
    })
  }

  private exactTarget(
    workspaceId: string,
    active: CapabilityGeneration,
    canaryId: string,
  ):
    | { readonly status: 'eligible'; readonly generation: CapabilityGeneration | undefined }
    | Extract<ExistingSkillFutureSessionRollbackEligibility, { status: 'blocked' }> {
    if (active.parentId === undefined) return { status: 'eligible', generation: undefined }
    const parent = this.modules.store.getGeneration(active.parentId)
    if (parent === undefined) return blocked('rollback-target-missing', canaryId, active.id)
    if (parent.workspaceId !== workspaceId) {
      return blocked('rollback-target-workspace-mismatch', canaryId, active.id)
    }
    return { status: 'eligible', generation: parent }
  }
}

function validScanShape(
  scan: Awaited<ReturnType<ExistingSkillCounterfactualCanary['scan']>>,
): boolean {
  return Number.isSafeInteger(scan.configuredPolicyCount)
    && scan.configuredPolicyCount > 0
    && Number.isSafeInteger(scan.warningCount)
    && scan.warningCount === 0
}

function validRollbackVerdict(
  run: Awaited<ReturnType<ExistingSkillCounterfactualCanary['scan']>>['runs'][number],
): run is ExistingSkillCounterfactualCanaryResult {
  if (run.kind !== 'existing-skill-counterfactual-canary-result-v1'
    || run.status !== 'rollback-eligible') return false
  const evidence = run.evidence
  return run.reason === 'candidate-regressed-baseline-recovers'
    && run.releaseAuthority === 'none'
    && evidence !== undefined
    && CONTENT_ID.test(evidence.holdoutCasePackHash)
    && CONTENT_ID.test(evidence.retentionCasePackHash)
    && CONTENT_ID.test(evidence.baselineTreeHash)
    && CONTENT_ID.test(evidence.candidateTreeHash)
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
  reason: Extract<ExistingSkillFutureSessionRollbackEligibility, { status: 'blocked' }>['reason'],
  canaryId: string,
  generationId?: string,
): Extract<ExistingSkillFutureSessionRollbackEligibility, { status: 'blocked' }> {
  return Object.freeze({
    status: 'blocked',
    reason,
    canaryId,
    ...(generationId === undefined ? {} : { generationId }),
  })
}
