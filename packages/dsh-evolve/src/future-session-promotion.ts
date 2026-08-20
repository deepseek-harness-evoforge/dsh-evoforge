import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'
import type {
  InternalSkillRetention,
  InternalSkillRetentionRunView,
} from './internal-skill-retention.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type { SkillCandidateLineage } from './skill-candidate-lineage.ts'
import type { EvolutionFutureSessionPromotionReason } from './control-types.ts'

export type FutureSessionPromotionReason = Exclude<
  EvolutionFutureSessionPromotionReason,
  'promotion-governance-unavailable'
>

export type FutureSessionPromotionEligibility =
  | {
      readonly status: 'eligible'
      readonly reason: 'exact-retention-retained'
      readonly generationId: string
      readonly reviewId: string
      readonly retentionId: string
    }
  | {
      readonly status: 'waiting' | 'blocked'
      readonly reason: Exclude<FutureSessionPromotionReason, 'exact-retention-retained'>
      readonly generationId: string
      readonly reviewId?: string
      readonly retentionId?: string
    }

export interface FutureSessionPromotionModules {
  readonly store: Pick<
    EvolutionStore,
    'getGeneration' | 'promoteGeneration'
  >
  readonly review: Pick<ReviewInbox, 'scanAll'>
  readonly retention: Pick<InternalSkillRetention, 'scan'>
}

/**
 * Turn independently owned review and Retention evidence into one bounded
 * future-Session selection decision. Neither evidence owner gains release
 * authority; only this Host-side gate may call the Generation store.
 */
export class FutureSessionPromotion {
  private readonly modules: FutureSessionPromotionModules

  constructor(modules: FutureSessionPromotionModules) {
    this.modules = modules
  }

  async eligibility(
    workspaceId: string,
    generationId: string,
  ): Promise<FutureSessionPromotionEligibility> {
    const generation = this.modules.store.getGeneration(generationId)
    if (generation === undefined) return blocked(generationId, 'generation-not-found')
    if (generation.workspaceId !== workspaceId) {
      return blocked(generationId, 'generation-workspace-mismatch')
    }

    const reviewScan = await this.modules.review.scanAll()
    if (reviewScan.warnings.length > 0) return blocked(generationId, 'review-evidence-invalid')
    const approved = reviewScan.candidates.filter(candidate =>
      candidate.workspaceId === workspaceId
      && candidate.status === 'approved'
      && candidate.generationId === generationId)
    if (approved.length === 0) return blocked(generationId, 'approved-review-missing')
    if (approved.length !== 1) return blocked(generationId, 'approved-review-ambiguous')
    const review = approved[0]!
    if (!exactGenerationReview(generation, review)) {
      return blocked(generationId, 'generation-lineage-mismatch', review.id)
    }

    const retentionScan = await this.modules.retention.scan(workspaceId)
    if (!Number.isSafeInteger(retentionScan.configuredRootCount)
      || retentionScan.configuredRootCount < 0
      || !Number.isSafeInteger(retentionScan.warningCount)
      || retentionScan.warningCount < 0
      || (retentionScan.configuredRootCount === 0 && retentionScan.runs.length > 0)
      || retentionScan.warningCount > 0) {
      return blocked(generationId, 'retention-evidence-invalid', review.id)
    }
    if (retentionScan.configuredRootCount === 0) {
      return waiting(generationId, 'retention-not-run', review.id)
    }
    const matches = retentionScan.runs.filter(run => exactRetentionReview(run, review))
    if (matches.length === 0) return waiting(generationId, 'retention-not-run', review.id)
    if (matches.length !== 1) return blocked(generationId, 'retention-ambiguous', review.id)
    const retention = matches[0]!
    if (retention.status === 'prepared') {
      return waiting(generationId, 'retention-prepared', review.id, retention.id)
    }
    if (retention.status === 'regressed') {
      return blocked(generationId, 'retention-regressed', review.id, retention.id)
    }
    if (retention.status === 'incomplete') {
      return blocked(generationId, 'retention-incomplete', review.id, retention.id)
    }
    if (!validRetainedVerdict(retention, review)) {
      return blocked(generationId, 'retention-verdict-invalid', review.id, retention.id)
    }
    return Object.freeze({
      status: 'eligible',
      reason: 'exact-retention-retained',
      generationId,
      reviewId: review.id,
      retentionId: retention.id,
    })
  }

  async promote(workspaceId: string, generationId: string): Promise<{
    readonly previousId: string | undefined
    readonly generation: CapabilityGeneration
  }> {
    const eligibility = await this.eligibility(workspaceId, generationId)
    if (eligibility.status !== 'eligible') {
      throw new Error(`future-Session promotion blocked: ${eligibility.reason}`)
    }
    return this.modules.store.promoteGeneration(workspaceId, generationId)
  }
}

function exactGenerationReview(
  generation: CapabilityGeneration,
  review: ReviewCandidate,
): boolean {
  if (review.recommendation !== 'promote'
    || review.lineage === undefined
    || review.decisionActor === undefined
    || !review.compositionStable
    || generation.evaluatorVersion !== review.evaluatorVersion
    || generation.compositionFingerprint !== review.compositionFingerprint) {
    return false
  }
  const artifacts = generation.artifacts.filter(artifact =>
    artifact.kind === 'skill-bundle'
    && artifact.name === review.skillName
    && artifact.treeHash === review.candidateTreeHash
    && exactLineage(artifact.lineage, review.lineage!))
  return artifacts.length === 1
}

function exactRetentionReview(
  retention: InternalSkillRetentionRunView,
  review: ReviewCandidate,
): boolean {
  const lineage = review.lineage
  return lineage !== undefined
    && retention.candidateId === lineage.candidateId
    && retention.workspaceId === review.workspaceId
    && retention.skillName === review.skillName
    && retention.admissionId === lineage.admissionId
    && retention.evaluationEnvelopeId === lineage.evaluationEnvelopeId
    && retention.shadowRunId === review.runId
    && retention.baselineTreeHash === review.baseTreeHash
    && retention.candidateTreeHash === review.candidateTreeHash
}

function validRetainedVerdict(
  retention: InternalSkillRetentionRunView,
  review: ReviewCandidate,
): boolean {
  const evidence = retention.evidence
  return retention.status === 'retained'
    && retention.reason === 'candidate-retained-prior-case'
    && evidence !== undefined
    && evidence.baselineTreeHash === review.baseTreeHash
    && evidence.candidateTreeHash === review.candidateTreeHash
    && evidence.baseline === 'pass'
    && evidence.candidate === 'pass'
    && evidence.calibrationPassed
    && evidence.compositionStable
    && evidence.proposerCalls === 0
    && evidence.trialCount === 4
}

function exactLineage(left: SkillCandidateLineage, right: SkillCandidateLineage): boolean {
  return left.kind === right.kind
    && left.candidateId === right.candidateId
    && left.workspaceId === right.workspaceId
    && left.skillName === right.skillName
    && left.opportunityId === right.opportunityId
    && left.evaluationEvidenceId === right.evaluationEvidenceId
    && left.policyId === right.policyId
    && left.versionKind === right.versionKind
    && left.contentHash === right.contentHash
    && left.candidateTreeHash === right.candidateTreeHash
    && left.admissionId === right.admissionId
    && left.evaluationEnvelopeId === right.evaluationEnvelopeId
    && left.releaseAuthority === right.releaseAuthority
}

function waiting(
  generationId: string,
  reason: Extract<FutureSessionPromotionReason, 'retention-not-run' | 'retention-prepared'>,
  reviewId: string,
  retentionId?: string,
): FutureSessionPromotionEligibility {
  return Object.freeze({
    status: 'waiting',
    reason,
    generationId,
    reviewId,
    ...(retentionId === undefined ? {} : { retentionId }),
  })
}

function blocked(
  generationId: string,
  reason: Exclude<FutureSessionPromotionReason,
    | 'exact-retention-retained'
    | 'retention-not-run'
    | 'retention-prepared'>,
  reviewId?: string,
  retentionId?: string,
): FutureSessionPromotionEligibility {
  return Object.freeze({
    status: 'blocked',
    reason,
    generationId,
    ...(reviewId === undefined ? {} : { reviewId }),
    ...(retentionId === undefined ? {} : { retentionId }),
  })
}
