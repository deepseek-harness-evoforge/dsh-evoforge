export type CandidateImpactIndicator =
  | 'artifact-scope-change'
  | 'credential-access'
  | 'destructive-action'
  | 'messaging-or-calendar'
  | 'network-access'
  | 'payment-action'
  | 'permission-or-sandbox'
  | 'privileged-tooling'
  | 'production-change'
  | 'rewritten-instructions'

/** Browser-safe copy of the versioned host impact projection contract. */
export interface CandidateImpactProjection {
  readonly version: 'lexical-protected-effects-v1'
  readonly scope: 'append-only-skill' | 'broader-change'
  readonly indicators: readonly CandidateImpactIndicator[]
}

/** Minimal delivery aggregate; individual outcomes never cross the adapter. */
export interface DeliveryOutcomeCounts {
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly unknown: number
}

/** Client-safe immutable Generation projection. */
export interface EvolutionGenerationView {
  readonly id: string
  readonly workspaceId: string
  readonly rollbackTargetId?: string
  readonly createdAt: number
  readonly evaluatorVersion: string
  readonly policyVersion: string
  readonly artifacts: readonly EvolutionArtifactView[]
}

/** Client-safe Skill artifact identity; no repository path is exposed. */
export interface EvolutionArtifactView {
  readonly kind: 'skill'
  readonly name: string
  readonly gitCommit: string
  readonly treeHash: string
  readonly lineage?: EvolutionSkillCandidateLineageView
}

export type EvolutionSkillCandidateVersionKind = 'experience-authored-bundle-v1'

/** Browser-safe identity of one internally discovered and admitted Candidate. */
export interface EvolutionSkillCandidateLineageView {
  readonly kind: 'internal-skill-candidate-lineage-v1'
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly policyId: string
  readonly versionKind: EvolutionSkillCandidateVersionKind
  readonly contentHash: string
  readonly candidateTreeHash: string
  readonly admissionId: string
  readonly admissionTargetId: string
  readonly releaseAuthority: 'none'
}

export type EvolutionCapabilityRoute = 'available' | 'model-selected' | 'user-selected'

/** One exact Skill summary observed through the native DSH Skill registry. */
export interface EvolutionCapabilityView {
  readonly name: string
  readonly description: string
  readonly source: string
  readonly provider: string
  readonly scope: 'workspace-session'
  readonly invocation: {
    readonly model: boolean
    readonly user: boolean
  }
  readonly versionKind: 'provider-managed' | 'evolved-tree'
  readonly version?: string
  readonly generationId?: string
  readonly route: EvolutionCapabilityRoute
}

/** Latest bounded native catalog observation for one exact Workspace Session. */
export interface EvolutionCapabilityMapView {
  readonly status: 'unobserved' | 'complete' | 'incomplete'
  readonly catalogHash?: string
  readonly capabilities: readonly EvolutionCapabilityView[]
}

/** One bounded, evidence-backed absence observed through DSH's native Skill seam. */
export interface EvolutionCapabilityGapView {
  readonly id: string
  readonly observedAt: number
  readonly requestedSkill: string
  readonly catalogHash: string
  readonly catalogSize: number
  readonly generationId?: string
  readonly goal?: {
    readonly id: string
    readonly revision: number
    readonly objective: string
  }
  readonly status: 'confirmed'
  readonly evidence:
    | {
        readonly kind: 'native-skill-miss'
        readonly catalog: 'complete'
        readonly routing: 'requested-skill-absent'
        readonly providers: 'settled'
      }
    | {
        readonly kind: 'model-declared-skill-gap'
        readonly catalog: 'complete'
        readonly routing: 'model-declared-no-applicable-skill'
        readonly providers: 'settled'
      }
}

/** Workspace queue; exact Session ids remain host-private. */
export interface EvolutionCapabilityGapQueueView {
  readonly confirmedCount: number
  readonly items: readonly EvolutionCapabilityGapView[]
}

/** Experience-derived opportunity; it cannot install, activate, or release a Skill. */
export interface EvolutionSkillOpportunityView {
  readonly id: string
  readonly skillName: string
  readonly gapIds: readonly string[]
  readonly goalIds: readonly string[]
  readonly gapCount: number
  readonly goalCount: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly evidence: {
    readonly kind: 'internal-experience-v2'
    readonly eligibilityBasis: 'two-or-more-distinct-goals'
    readonly correctionSignals: {
      readonly association: 'same-session-single-skill-gap'
      readonly count: number
      readonly ids: readonly string[]
      readonly referencesTruncated: boolean
    }
    readonly deliveryOutcomes: {
      readonly association: 'same-goal-revision-single-skill-gap'
      readonly total: number
      readonly passed: number
      readonly failed: number
      readonly unknown: number
      readonly ids: readonly string[]
      readonly referencesTruncated: boolean
    }
    readonly causalClaim: 'none'
  }
  readonly status: 'eligible-for-authoring'
  readonly releaseAuthority: 'none'
}

export interface EvolutionSkillOpportunityQueueView {
  readonly eligibleCount: number
  readonly items: readonly EvolutionSkillOpportunityView[]
}

/** Quarantined whole-Skill package authored only from internal DSH experience. */
export interface EvolutionSkillCandidateView {
  readonly id: string
  readonly createdAt: number
  readonly skillName: string
  readonly description: string
  readonly opportunity: {
    readonly kind: 'internal-experience-v1'
    readonly id: string
    readonly gapIds: readonly string[]
    readonly goalCount: number
  }
  readonly authorship: {
    readonly kind: 'bounded-model-authoring-v1'
    readonly policyId: string
    readonly modelIdentityHash: string
    readonly inputDigest: string
  }
  readonly scope: 'workspace'
  readonly version: {
    readonly kind: 'experience-authored-bundle-v1'
    readonly artifactDigest: string
    readonly treeHash: string
  }
  readonly contentHash: string
  readonly package: {
    readonly path: string
    readonly fileCount: number
    readonly totalBytes: number
    readonly hasScripts: boolean
    readonly hasReferences: boolean
  }
  readonly permissions: {
    readonly declared: boolean
    readonly executableContent: boolean
    readonly externalEffects: 'unknown'
  }
  readonly license?:
    | { readonly status: 'declared'; readonly value: string }
    | { readonly status: 'unknown' }
  readonly safety: {
    readonly status: 'quarantined'
    readonly checks: readonly {
      readonly name:
        | 'artifact-digest-integrity'
        | 'regular-files-only'
        | 'skill-identity'
        | 'effect-review'
      readonly status: 'passed' | 'required'
    }[]
  }
  readonly lifecycle: 'inactive'
  readonly verification: 'unevaluated'
  readonly execution: 'never'
}

export interface EvolutionSkillCandidateQueueView {
  readonly quarantinedCount: number
  readonly items: readonly EvolutionSkillCandidateView[]
}

/** Durable slow-loop authoring state; generated bodies and private paths stay host-only. */
export interface EvolutionSlowLoopAuthoringView {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly {
    readonly id: string
    readonly targetId: string
    readonly skillName: string
    readonly opportunityId: string
    readonly gapCount: number
    readonly goalCount: number
    readonly phase:
      | 'prepared'
      | 'budget-deferred'
      | 'cancelled'
      | 'authoring-pending'
      | 'uncertain'
      | 'incomplete'
      | 'candidate-ready'
    readonly createdAt: string
    readonly updatedAt: string
    readonly modelCalls: 0 | 1
    readonly inputTokens: number
    readonly outputTokens: number
    readonly candidateId?: string
    readonly retryAt?: number
    readonly releaseAuthority: 'none'
  }[]
}

/** Deterministic, zero-model admission evidence; it never carries release authority. */
export interface EvolutionSkillAdmissionView {
  readonly configuredTargetCount: number
  readonly warningCount: number
  readonly results: readonly {
    readonly id: string
    readonly candidateId: string
    readonly skillName: string
    readonly status: 'abstained' | 'protected' | 'incomplete' | 'rejected' | 'review' | 'qualified-for-shadow'
    readonly reasons: readonly (
      | 'no-exact-evaluation-target'
      | 'candidate-has-executable-content'
      | 'candidate-is-not-instruction-only'
      | 'baseline-identity-mismatch'
      | 'case-pack-identity-mismatch'
      | 'assembled-evaluator-not-governance-separated'
      | 'case-pack-calibration-failed'
      | 'candidate-failed-admission'
      | 'baseline-already-passes'
      | 'candidate-improves-deterministic-admission'
      | 'governance-input-mutated'
      | 'governance-roots-overlap'
      | 'evaluation-failed'
    )[]
    readonly targetId?: string
    readonly releaseAuthority: 'none'
    readonly evidence?: {
      readonly baseline: 'pass' | 'fail'
      readonly candidate: 'pass' | 'fail'
      readonly calibrationPassed: boolean
      readonly candidateExecuted: false
      readonly evaluatorClass: 'deterministic-filesystem'
      readonly trialCount: 4
    }
  }[]
}

/** One sealed evaluator result shown in review. */
export interface EvolutionReviewCaseView {
  readonly id: string
  readonly baseline: 'pass' | 'fail' | 'incomplete'
  readonly candidate: 'pass' | 'fail' | 'incomplete'
  readonly passedChecks: number
  readonly totalChecks: number
}

/** Exact host-derived window for one ambiguous Candidate from automatic feedback. */
export interface EvolutionAutomaticReviewExpiryView {
  readonly eligibleAt: string
  readonly eligible: boolean
  readonly trigger: 'next-same-skill-automatic-signal'
}

/** Bounded review metadata shared by the list and detail views. */
export interface EvolutionReviewView {
  readonly id: string
  readonly workspaceId: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly recommendation: 'promote' | 'review'
  readonly skillName: string
  readonly claim: string
  readonly changedFiles: readonly string[]
  readonly candidateTreeHash: string
  readonly lineage?: EvolutionSkillCandidateLineageView
  readonly cases: readonly EvolutionReviewCaseView[]
  readonly cost: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly trialCount: number
  }
  readonly reasons: readonly string[]
  readonly limitations: readonly string[]
  readonly evaluatorVersion: string
  readonly compositionFingerprint: string
  readonly compositionStable: boolean
  readonly startedAt: string
  readonly automaticReviewExpiry?: EvolutionAutomaticReviewExpiryView
  readonly decisionActor?: 'human' | 'auto-clear-instruction-v1' | 'auto-review-expiry-v1'
  readonly decisionNote?: string
  readonly generationId?: string
  readonly activatedAt?: string
}

/** Durable approved Generation that is not the current active selection. */
export interface EvolutionInactiveGenerationView {
  readonly workspaceId: string
  readonly generationId: string
  readonly reviewId: string
  readonly skillName: string
  readonly lineage?: EvolutionSkillCandidateLineageView
}

/** Reference-only feedback row; Session/message ids and correction text stay on host. */
export interface EvolutionFeedbackSignalView {
  readonly workspaceId: string
  readonly id: string
  readonly sourceUpdatedAt: number
  readonly generationId?: string
  /** Exact configured targets whose Skill exists in the Signal's immutable Generation. */
  readonly eligibleTargetIds: readonly string[]
}

/** Public name of one statically configured host-side Shadow Target. */
export interface EvolutionShadowTargetView {
  readonly workspaceId: string
  readonly id: string
  readonly skillName: string
}

/** Bounded run projection; host paths, proposal and private draft stay excluded. */
export interface EvolutionShadowRunView {
  readonly workspaceId: string
  readonly launchId: string
  readonly targetId: string
  readonly skillName: string
  readonly phase: 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete'
  readonly startedAt: string
  readonly updatedAt: string
}

/** Daily host-only reservation cap for one automatic paid evolution Target. */
export interface EvolutionAutomaticBudgetView {
  readonly workspaceId: string
  readonly targetId: string
  readonly skillName: string
  readonly utcDay: string
  readonly used: number
  readonly limit: number
  readonly remaining: number
  readonly status: 'ready' | 'unknown'
}

/** Bounded host-only evaluator proposal; generated code remains inactive. */
export interface EvolutionEvaluatorDraftView {
  readonly workspaceId: string
  readonly id: string
  readonly launchId: string
  readonly targetId: string
  readonly skillName: string
  readonly status: 'authoring-pending' | 'uncertain' | 'draft-ready' | 'qualification-running' | 'qualified' | 'incomplete' | 'rejected'
  readonly createdAt: string
  readonly updatedAt: string
  readonly cost: {
    readonly modelCalls: 0 | 1
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

/** Exact bounded files shown only after an explicit detail request. */
export interface EvolutionEvaluatorDraftDetail {
  readonly schemaVersion: 1
  readonly draft: EvolutionEvaluatorDraftView
  readonly files: readonly { readonly path: string; readonly content: string }[]
  readonly limitations: readonly string[]
  readonly qualifiedShadowAvailable: boolean
  readonly decision?: {
    readonly actor: 'human'
    readonly note: string
    readonly decidedAt: string
  }
  readonly qualification?: {
    readonly calibrated: boolean
    readonly attempt: number
  }
  readonly reason?: string
}

/** Browser overview. Dynamic global state stays outside Session and model context. */
export interface EvolutionOverview {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly active?: EvolutionGenerationView
  readonly recovery: {
    readonly available: boolean
    readonly paused?: boolean
  }
  readonly automaticPromotion: {
    readonly enabled: boolean
    readonly skills: readonly string[]
  }
  readonly capabilityMap?: EvolutionCapabilityMapView
  readonly capabilityGaps?: EvolutionCapabilityGapQueueView
  readonly skillOpportunities?: EvolutionSkillOpportunityQueueView
  readonly skillCandidates?: EvolutionSkillCandidateQueueView
  readonly slowLoopAuthoring?: EvolutionSlowLoopAuthoringView
  readonly skillAdmission?: EvolutionSkillAdmissionView
  readonly deliveryOutcomes?: {
    readonly all: DeliveryOutcomeCounts
    readonly selected: DeliveryOutcomeCounts
    readonly baseline?: DeliveryOutcomeCounts
  }
  readonly feedbackSignals?: {
    readonly all: number
    readonly selected: number
  }
  readonly feedbackShadow?: {
    readonly available: boolean
    readonly warningCount: number
    readonly signals: readonly EvolutionFeedbackSignalView[]
    readonly targets: readonly EvolutionShadowTargetView[]
    readonly runs: readonly EvolutionShadowRunView[]
  }
  readonly automaticFeedbackBudget?: {
    readonly warningCount: number
    readonly targets: readonly EvolutionAutomaticBudgetView[]
  }
  readonly automaticEvaluatorBudget?: {
    readonly warningCount: number
    readonly targets: readonly EvolutionAutomaticBudgetView[]
  }
  readonly evaluatorAuthoring?: {
    readonly available: boolean
    readonly actionableCount: number
    readonly warningCount: number
    readonly signals: readonly EvolutionFeedbackSignalView[]
    readonly targets: readonly EvolutionShadowTargetView[]
    readonly drafts: readonly EvolutionEvaluatorDraftView[]
  }
  readonly reviews: {
    readonly available: boolean
    readonly pendingCount: number
    readonly actionableCount: number
    readonly warningCount: number
    readonly items: readonly EvolutionReviewView[]
    readonly inactiveGenerations: readonly EvolutionInactiveGenerationView[]
  }
}

/** Exact bounded diff and deterministic policy projection for one review. */
export interface EvolutionReviewDetail {
  readonly schemaVersion: 1
  readonly review: EvolutionReviewView
  readonly diff: {
    readonly patch: string
    readonly shownBytes: number
    readonly totalBytes: number
    readonly truncated: boolean
    readonly impact: CandidateImpactProjection
  }
  readonly automatic?: {
    readonly eligible: boolean
    readonly policyVersion: 'auto-clear-instruction-v1'
    readonly reasons: readonly string[]
  }
}

/** Durable action acknowledgement; UI refreshes the authoritative overview afterwards. */
export interface EvolutionActionReceipt {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly action: 'pause' | 'resume' | 'approve-review' | 'reject-review' | 'promote' | 'rollback' | 'start-shadow' | 'author-evaluator' | 'approve-evaluator' | 'reject-evaluator'
  readonly reviewId?: string
  readonly status?: 'approved' | 'rejected'
  readonly generationId?: string
  readonly previousGenerationId?: string
  readonly activeGenerationId?: string
  readonly recoveryPaused?: boolean
  readonly launchId?: string
  readonly targetId?: string
  readonly skillName?: string
  readonly runStatus?: 'scheduled' | 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete'
  readonly jobId?: string
  readonly draftId?: string
  readonly draftStatus?: 'scheduled' | 'authoring-pending' | 'uncertain' | 'draft-ready' | 'qualification-running' | 'qualified' | 'incomplete' | 'rejected'
}
