import type { CandidatePublisher } from './candidate-publisher.ts'
import type { DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type { CapabilityGapStore } from './capability-gap-store.ts'
import type { SkillCandidateStore } from './skill-candidate-repository.ts'
import type { ExperienceDrivenSkillOpportunityDiscovery } from './skill-opportunity-discovery.ts'
import type { SkillCandidateAdmission } from './skill-candidate-admission.ts'
import type { SlowLoopSkillAuthoring } from './slow-loop-skill-authoring.ts'
import type { SkillCandidateLineage } from './skill-candidate-lineage.ts'
import type { SkillEvaluationEvidenceVault } from './skill-evaluation-evidence-vault.ts'
import type { SkillEvaluationGovernance } from './skill-evaluation-governance.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { ResidentEvolutionControl } from './resident-evolution-control.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type {
  EvolutionActionReceipt,
  EvolutionCapabilityMapView,
  EvolutionCapabilityGapQueueView,
  EvolutionSkillCandidateQueueView,
  EvolutionSkillAdmissionView,
  EvolutionSkillCandidateLineageView,
  EvolutionGenerationView,
  EvolutionOverview,
  EvolutionReviewDetail,
  EvolutionReviewView,
} from './control-types.ts'

const MAX_REVIEW_ROWS = 20
const MAX_CAPABILITY_GAP_ROWS = 20
const MAX_DISCOVERY_ROWS = 20

/** Existing authoritative owners used by Commands and structured adapters. */
export interface EvolutionControlPlaneModules {
  readonly store: EvolutionStore
  readonly review?: {
    readonly inbox: Pick<ReviewInbox, 'scanAll' | 'get' | 'approve' | 'reject'>
    readonly publisher: Pick<CandidatePublisher, 'preview' | 'publish'>
  }
  readonly resident?: Pick<ResidentEvolutionControl, 'isPaused' | 'pause' | 'resume'>
  readonly outcomes?: Pick<DeliveryOutcomeStore, 'summarize'>
  readonly feedback?: Pick<FeedbackSignalStore, 'summarize'>
  readonly capabilities?: {
    readonly snapshot: (workspaceId: string, sessionId?: string) => EvolutionCapabilityMapView
  }
  readonly gaps?: Pick<CapabilityGapStore, 'list'>
  readonly opportunities?: Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discover'>
    & Partial<Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discoverImprovements'>>
  readonly evaluationEvidence?: Pick<SkillEvaluationEvidenceVault, 'readiness'>
  readonly candidates?: Pick<SkillCandidateStore, 'listCandidates'>
  readonly admissions?: Pick<SkillCandidateAdmission, 'scan'>
  readonly slowLoopAuthoring?: Pick<SlowLoopSkillAuthoring, 'scan'>
  readonly evaluationGovernance?: Pick<SkillEvaluationGovernance, 'scan'>
}

/** A structured adapter surface that delegates to the same owners as Commands. */
export class EvolutionControlPlane {
  private readonly modules: EvolutionControlPlaneModules

  constructor(modules: EvolutionControlPlaneModules) {
    this.modules = modules
  }

  async overview(workspaceId: string, sessionId?: string): Promise<EvolutionOverview> {
    const active = this.modules.store.getActiveGeneration(workspaceId)
    const [
      scan,
      admissionScan,
      slowLoopAuthoringScan,
      evaluationGovernanceScan,
    ] = await Promise.all([
      this.modules.review === undefined ? undefined : this.modules.review.inbox.scanAll(),
      this.modules.admissions === undefined ? undefined : this.modules.admissions.scan(workspaceId),
      this.modules.slowLoopAuthoring === undefined
        ? undefined
        : this.modules.slowLoopAuthoring.scan(workspaceId),
      this.modules.evaluationGovernance === undefined
        ? undefined
        : this.modules.evaluationGovernance.scan(workspaceId),
    ])
    const skillOpportunities = this.modules.opportunities?.discover(workspaceId)
    const skillImprovementOpportunities = this.modules.opportunities?.discoverImprovements?.(workspaceId)
    const opportunityGapIds = new Set(skillOpportunities?.flatMap(opportunity => opportunity.gapIds) ?? [])
    const opportunityReadiness = skillOpportunities === undefined
      ? []
      : await Promise.all(skillOpportunities.map(opportunity =>
          this.modules.evaluationEvidence?.readiness(opportunity) ?? Promise.resolve({
            status: 'unavailable' as const,
            reason: 'governance-policy-unavailable' as const,
            observedGoalCount: opportunity.goalCount,
            releaseAuthority: 'none' as const,
          })))
    return {
      schemaVersion: 1,
      ...(active === undefined ? {} : { active: projectGeneration(active) }),
      workspaceId,
      recovery: this.modules.resident === undefined
        ? { available: false }
        : { available: true, paused: this.modules.resident.isPaused(workspaceId) },
      ...(this.modules.capabilities === undefined
        ? {}
        : { capabilityMap: cloneCapabilityMap(this.modules.capabilities.snapshot(workspaceId, sessionId)) }),
      ...(this.modules.gaps === undefined
        ? {}
        : { capabilityGaps: projectCapabilityGaps(
            this.modules.gaps.list(workspaceId),
            opportunityGapIds,
          ) }),
      ...(skillOpportunities === undefined
        ? {}
        : { skillOpportunities: {
            eligibleCount: skillOpportunities.length,
            items: skillOpportunities.map((opportunity, index) => ({
              id: opportunity.id,
              skillName: opportunity.skillName,
              gapIds: [...opportunity.gapIds],
              goalIds: [...opportunity.goalIds],
              gapCount: opportunity.gapCount,
              goalCount: opportunity.goalCount,
              firstObservedAt: opportunity.firstObservedAt,
              lastObservedAt: opportunity.lastObservedAt,
              evidence: {
                kind: opportunity.evidence.kind,
                eligibilityBasis: opportunity.evidence.eligibilityBasis,
                correctionSignals: {
                  association: opportunity.evidence.correctionSignals.association,
                  count: opportunity.evidence.correctionSignals.count,
                  goalCount: opportunity.evidence.correctionSignals.goalCount,
                  ids: [...opportunity.evidence.correctionSignals.ids],
                  referencesTruncated: opportunity.evidence.correctionSignals.referencesTruncated,
                },
                deliveryOutcomes: {
                  association: opportunity.evidence.deliveryOutcomes.association,
                  total: opportunity.evidence.deliveryOutcomes.total,
                  passed: opportunity.evidence.deliveryOutcomes.passed,
                  failed: opportunity.evidence.deliveryOutcomes.failed,
                  unknown: opportunity.evidence.deliveryOutcomes.unknown,
                  ids: [...opportunity.evidence.deliveryOutcomes.ids],
                  referencesTruncated: opportunity.evidence.deliveryOutcomes.referencesTruncated,
                },
                causalClaim: opportunity.evidence.causalClaim,
              },
              evaluationReadiness: opportunityReadiness[index]!,
              status: opportunity.status,
              releaseAuthority: opportunity.releaseAuthority,
            })),
          } }),
      ...(skillImprovementOpportunities === undefined
        ? {}
        : { skillImprovementOpportunities: {
            waitingCount: skillImprovementOpportunities.length,
            items: skillImprovementOpportunities.map(opportunity => ({
              id: opportunity.id,
              skillName: opportunity.skillName,
              invocationContentHash: opportunity.invocationContentHash,
              feedbackSignalIds: [...opportunity.feedbackSignalIds],
              goalIds: [...opportunity.goalIds],
              signalCount: opportunity.signalCount,
              goalCount: opportunity.goalCount,
              firstObservedAt: opportunity.firstObservedAt,
              lastObservedAt: opportunity.lastObservedAt,
              evidence: { ...opportunity.evidence },
              status: opportunity.status,
              releaseAuthority: opportunity.releaseAuthority,
            })),
          } }),
      ...(this.modules.candidates === undefined
        ? {}
        : { skillCandidates: projectSkillCandidates(this.modules.candidates, workspaceId) }),
      ...(slowLoopAuthoringScan === undefined
        ? {}
        : { slowLoopAuthoring: {
            configuredPolicyCount: slowLoopAuthoringScan.configuredPolicyCount,
            warningCount: slowLoopAuthoringScan.warningCount,
            runs: slowLoopAuthoringScan.runs.map(run => ({
              id: run.id,
              targetId: run.targetId,
              skillName: run.skillName,
              opportunityId: run.opportunityId,
              gapCount: run.gapCount,
              goalCount: run.goalCount,
              phase: run.phase,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
              modelCalls: run.modelCalls,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              ...(run.candidateId === undefined ? {} : { candidateId: run.candidateId }),
              ...(run.retryAt === undefined ? {} : { retryAt: run.retryAt }),
              releaseAuthority: run.releaseAuthority,
            })),
          } }),
      ...(admissionScan === undefined
        ? {}
        : { skillAdmission: projectSkillAdmission(admissionScan) }),
      ...(evaluationGovernanceScan === undefined
        ? {}
        : { skillEvaluationGovernance: {
            configuredPolicyCount: evaluationGovernanceScan.configuredPolicyCount,
            warningCount: evaluationGovernanceScan.warningCount,
            runs: evaluationGovernanceScan.runs.slice(0, MAX_DISCOVERY_ROWS).map(run => ({
              id: run.id,
              policyId: run.policyId,
              skillName: run.skillName,
              opportunityId: run.opportunityId,
              evaluationEvidenceId: run.evaluationEvidenceId,
              phase: run.phase,
              ...(run.pendingRole === undefined ? {} : { pendingRole: run.pendingRole }),
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
              modelCalls: run.modelCalls,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              retentionIncluded: run.retentionIncluded,
              ...(run.retryAt === undefined ? {} : { retryAt: run.retryAt }),
              ...(run.failure === undefined ? {} : { failure: run.failure }),
              releaseAuthority: run.releaseAuthority,
            })),
          } }),
      ...(this.modules.outcomes === undefined
        ? {}
        : {
            deliveryOutcomes: cloneOutcomeSummary(this.modules.outcomes.summarize(
              workspaceId,
              active?.id,
              active === undefined
                ? undefined
                : active.parentId === undefined ? {} : { baselineGenerationId: active.parentId },
            )),
          }),
      ...(this.modules.feedback === undefined
        ? {}
        : { feedbackSignals: { ...this.modules.feedback.summarize(workspaceId, active?.id) } }),
      reviews: scan === undefined
        ? {
            available: false,
            pendingCount: 0,
            actionableCount: 0,
            warningCount: 0,
            items: [],
            inactiveGenerations: [],
          }
        : {
            ...projectReviews(scan, active?.id, workspaceId, this.modules.store),
          },
    }
  }

  async review(workspaceId: string, id: string): Promise<EvolutionReviewDetail> {
    const review = this.requireReview()
    const candidate = await review.inbox.get(id)
    assertWorkspace(candidate.workspaceId, workspaceId, 'Review Candidate')
    const diff = await review.publisher.preview(candidate)
    return {
      schemaVersion: 1,
      review: projectReview(candidate),
      diff: {
        patch: diff.patch,
        shownBytes: diff.shownBytes,
        totalBytes: diff.totalBytes,
        truncated: diff.truncated,
        impact: {
          version: diff.impact.version,
          scope: diff.impact.scope,
          indicators: [...diff.impact.indicators],
        },
      },
    }
  }

  async pause(workspaceId: string): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.pause(workspaceId)
    return { schemaVersion: 1, workspaceId, action: 'pause', recoveryPaused: resident.isPaused(workspaceId) }
  }

  async resume(workspaceId: string): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.resume(workspaceId)
    return { schemaVersion: 1, workspaceId, action: 'resume', recoveryPaused: resident.isPaused(workspaceId) }
  }

  async approveReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    const review = this.requireReview()
    assertWorkspace((await review.inbox.get(id)).workspaceId, workspaceId, 'Review Candidate')
    const approved = await review.inbox.approve(
      id,
      note,
      candidate => review.publisher.publish(candidate),
    )
    if (approved.generationId === undefined) {
      throw new Error('approved review has no inactive Generation id')
    }
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'approve-review',
      reviewId: approved.id,
      generationId: approved.generationId,
      status: 'approved',
    }
  }

  async rejectReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    const inbox = this.requireReview().inbox
    assertWorkspace((await inbox.get(id)).workspaceId, workspaceId, 'Review Candidate')
    const rejected = await inbox.reject(id, note)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'reject-review',
      reviewId: rejected.id,
      status: 'rejected',
    }
  }

  async promote(workspaceId: string, generationId: string): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.promoteGeneration(workspaceId, generationId)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'promote',
      ...(result.previousId === undefined ? {} : { previousGenerationId: result.previousId }),
      activeGenerationId: result.generation.id,
    }
  }

  async rollback(workspaceId: string): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.rollbackGeneration(workspaceId)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'rollback',
      previousGenerationId: result.previousId,
      ...(result.generation === undefined ? {} : { activeGenerationId: result.generation.id }),
    }
  }

  private requireReview(): NonNullable<EvolutionControlPlaneModules['review']> {
    if (this.modules.review === undefined) {
      throw new Error('review inbox is not configured')
    }
    return this.modules.review
  }

  private requireResident(): NonNullable<EvolutionControlPlaneModules['resident']> {
    if (this.modules.resident === undefined) {
      throw new Error('resident recovery is not configured')
    }
    return this.modules.resident
  }

}

function cloneCapabilityMap(map: EvolutionCapabilityMapView): EvolutionCapabilityMapView {
  return {
    status: map.status,
    ...(map.catalogHash === undefined ? {} : { catalogHash: map.catalogHash }),
    capabilities: map.capabilities.map(capability => ({
      ...capability,
      invocation: { ...capability.invocation },
    })),
  }
}

function projectCapabilityGaps(
  gaps: ReturnType<CapabilityGapStore['list']>,
  redactObjectiveFor: ReadonlySet<string>,
): EvolutionCapabilityGapQueueView {
  return {
    confirmedCount: gaps.filter(gap => gap.status === 'confirmed').length,
    items: gaps.slice(0, MAX_CAPABILITY_GAP_ROWS).map(gap => ({
      id: gap.id,
      observedAt: gap.observedAt,
      requestedSkill: gap.requestedSkill,
      catalogHash: gap.catalogHash,
      catalogSize: gap.catalogSize,
      ...(gap.generationId === undefined ? {} : { generationId: gap.generationId }),
      ...(gap.goal === undefined ? {} : { goal: {
        id: gap.goal.id,
        revision: gap.goal.revision,
        ...(redactObjectiveFor.has(gap.id) ? {} : { objective: gap.goal.objective }),
      } }),
      status: gap.status,
      evidence: { ...gap.evidence },
    })),
  }
}

function projectSkillCandidates(
  candidates: NonNullable<EvolutionControlPlaneModules['candidates']>,
  workspaceId: string,
): EvolutionSkillCandidateQueueView {
  const values = candidates.listCandidates(workspaceId)
  return {
    quarantinedCount: values.filter(candidate => candidate.safety.status === 'quarantined').length,
    items: values.slice(0, MAX_DISCOVERY_ROWS).map(candidate => ({
      id: candidate.id,
      createdAt: candidate.createdAt,
      skillName: candidate.skillName,
      description: candidate.description,
      opportunity: {
        kind: candidate.opportunity.kind,
        id: candidate.opportunity.id,
        gapIds: [...candidate.opportunity.gapIds],
        goalCount: candidate.opportunity.goalCount,
      },
      authorship: { ...candidate.authorship },
      scope: candidate.scope,
      version: { ...candidate.version },
      contentHash: candidate.contentHash,
      package: { ...candidate.package },
      permissions: { ...candidate.permissions },
      ...(candidate.license === undefined ? {} : { license: { ...candidate.license } }),
      safety: {
        status: candidate.safety.status,
        checks: candidate.safety.checks.map(check => ({ ...check })),
      },
      lifecycle: candidate.lifecycle,
      verification: candidate.verification,
      execution: candidate.execution,
    })),
  }
}

function projectSkillAdmission(
  scan: Awaited<ReturnType<NonNullable<EvolutionControlPlaneModules['admissions']>['scan']>>,
): EvolutionSkillAdmissionView {
  return {
    configuredPolicyCount: scan.configuredPolicyCount,
    warningCount: scan.warningCount,
    results: scan.results.slice(0, MAX_DISCOVERY_ROWS).map(value => ({
      id: value.id,
      candidateId: value.candidateId,
      skillName: value.skillName,
      status: value.status,
      reasons: [...value.reasons],
      ...(value.envelopeId === undefined ? {} : { envelopeId: value.envelopeId }),
      releaseAuthority: value.releaseAuthority,
      ...(value.evidence === undefined ? {} : { evidence: {
        baseline: value.evidence.baseline,
        candidate: value.evidence.candidate,
        calibrationPassed: value.evidence.calibrationPassed,
        candidateExecuted: value.evidence.candidateExecuted,
        evaluatorClass: value.evidence.evaluatorClass,
        trialCount: value.evidence.trialCount,
      } }),
    })),
  }
}

function projectReviews(
  all: Awaited<ReturnType<ReviewInbox['scanAll']>>,
  activeGenerationId: string | undefined,
  workspaceId: string,
  store: EvolutionStore,
): EvolutionOverview['reviews'] {
  const workspaceCandidates = all.candidates.filter(candidate => candidate.workspaceId === workspaceId)
  const actionable = workspaceCandidates.filter(candidate => candidate.status === 'pending'
    || (candidate.status === 'approved'
      && candidate.decisionActor === 'auto-clear-instruction-v1'
      && candidate.activatedAt === undefined))
  const inactiveGenerations = workspaceCandidates
    .filter(candidate => candidate.status === 'approved'
      && candidate.generationId !== undefined
      && candidate.generationId !== activeGenerationId)
    .slice(-MAX_REVIEW_ROWS)
    .reverse()
    .map(candidate => {
      const generation = store.getGeneration(candidate.generationId!)
      const artifact = generation?.workspaceId === candidate.workspaceId
        ? generation.artifacts.find(value => value.name === candidate.skillName
          && value.lineage?.candidateTreeHash === candidate.candidateTreeHash)
        : undefined
      return {
        workspaceId: candidate.workspaceId,
        generationId: candidate.generationId!,
        reviewId: candidate.id,
        skillName: candidate.skillName,
        ...(artifact?.lineage === undefined
          ? {}
          : { lineage: projectSkillCandidateLineage(artifact.lineage) }),
      }
    })
  return {
    available: true,
    pendingCount: actionable.filter(item => item.status === 'pending').length,
    actionableCount: actionable.length,
    warningCount: all.warnings.length,
    items: actionable.slice(0, MAX_REVIEW_ROWS).map(projectReview),
    inactiveGenerations,
  }
}

function projectGeneration(generation: ReturnType<EvolutionStore['getActiveGeneration']> & {}): EvolutionGenerationView {
  return {
    id: generation.id,
    workspaceId: generation.workspaceId,
    ...(generation.parentId === undefined ? {} : { rollbackTargetId: generation.parentId }),
    createdAt: generation.createdAt,
    evaluatorVersion: generation.evaluatorVersion,
    policyVersion: generation.policyVersion,
    artifacts: generation.artifacts.map(artifact => ({
      kind: artifact.kind,
      name: artifact.name,
      ...(artifact.kind === 'skill'
        ? { gitCommit: artifact.gitCommit }
        : { artifactDigest: artifact.artifactDigest }),
      treeHash: artifact.treeHash,
      ...(artifact.lineage === undefined
        ? {}
        : { lineage: projectSkillCandidateLineage(artifact.lineage) }),
    })),
  }
}

function projectReview(candidate: ReviewCandidate): EvolutionReviewView {
  return {
    id: candidate.id,
    workspaceId: candidate.workspaceId,
    status: candidate.status,
    recommendation: candidate.recommendation,
    skillName: candidate.skillName,
    claim: candidate.claim,
    changedFiles: [...candidate.changedFiles],
    candidateTreeHash: candidate.candidateTreeHash,
    ...(candidate.lineage === undefined
      ? {}
      : { lineage: projectSkillCandidateLineage(candidate.lineage) }),
    cases: candidate.cases.map(item => ({ ...item })),
    cost: { ...candidate.cost },
    reasons: [...candidate.reasons],
    limitations: [...candidate.limitations],
    evaluatorVersion: candidate.evaluatorVersion,
    compositionFingerprint: candidate.compositionFingerprint,
    compositionStable: candidate.compositionStable,
    startedAt: candidate.startedAt,
    ...(candidate.decisionActor === undefined ? {} : { decisionActor: candidate.decisionActor }),
    ...(candidate.decisionNote === undefined ? {} : { decisionNote: candidate.decisionNote }),
    ...(candidate.generationId === undefined ? {} : { generationId: candidate.generationId }),
    ...(candidate.activatedAt === undefined ? {} : { activatedAt: candidate.activatedAt }),
  }
}

function projectSkillCandidateLineage(
  lineage: SkillCandidateLineage,
): EvolutionSkillCandidateLineageView {
  return {
    kind: lineage.kind,
    candidateId: lineage.candidateId,
    workspaceId: lineage.workspaceId,
    skillName: lineage.skillName,
    opportunityId: lineage.opportunityId,
    evaluationEvidenceId: lineage.evaluationEvidenceId,
    policyId: lineage.policyId,
    versionKind: lineage.versionKind,
    contentHash: lineage.contentHash,
    candidateTreeHash: lineage.candidateTreeHash,
    admissionId: lineage.admissionId,
    evaluationEnvelopeId: lineage.evaluationEnvelopeId,
    releaseAuthority: lineage.releaseAuthority,
  }
}

function cloneOutcomeSummary(summary: ReturnType<DeliveryOutcomeStore['summarize']>) {
  return {
    all: { ...summary.all },
    selected: { ...summary.selected },
    ...(summary.baseline === undefined ? {} : { baseline: { ...summary.baseline } }),
    metrics: {
      all: cloneMetricRollup(summary.metrics.all),
      selected: cloneMetricRollup(summary.metrics.selected),
      ...(summary.metrics.baseline === undefined
        ? {}
        : { baseline: cloneMetricRollup(summary.metrics.baseline) }),
      recent: summary.metrics.recent.map(item => ({
        outcomeId: item.outcomeId,
        observedAt: item.observedAt,
        ...(item.generationId === undefined ? {} : { generationId: item.generationId }),
        status: item.status,
        goal: { ...item.goal },
        metrics: {
          ...item.metrics,
          providerUsage: { ...item.metrics.providerUsage },
          latency: { ...item.metrics.latency },
          monetaryCost: { ...item.metrics.monetaryCost },
        },
      })),
    },
  }
}

function cloneMetricRollup(
  value: ReturnType<DeliveryOutcomeStore['summarize']>['metrics']['all'],
) {
  return {
    ...value,
    providerUsage: { ...value.providerUsage },
    latency: { ...value.latency },
    monetaryCost: { ...value.monetaryCost },
  }
}

function assertWorkspace(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} belongs to Workspace '${actual}', not '${expected}'`)
  }
}
