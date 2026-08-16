export type CandidateImpactIndicator = 'artifact-scope-change' | 'credential-access' | 'destructive-action' | 'messaging-or-calendar' | 'network-access' | 'payment-action' | 'permission-or-sandbox' | 'privileged-tooling' | 'production-change' | 'rewritten-instructions';
/** Browser-safe copy of the versioned host impact projection contract. */
export interface CandidateImpactProjection {
    readonly version: 'lexical-protected-effects-v1';
    readonly scope: 'append-only-skill' | 'broader-change';
    readonly indicators: readonly CandidateImpactIndicator[];
}
/** Minimal delivery aggregate; individual outcomes never cross the adapter. */
export interface DeliveryOutcomeCounts {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly unknown: number;
}
/** Client-safe immutable Generation projection. */
export interface EvolutionGenerationView {
    readonly id: string;
    readonly rollbackTargetId?: string;
    readonly createdAt: number;
    readonly evaluatorVersion: string;
    readonly policyVersion: string;
    readonly artifacts: readonly EvolutionArtifactView[];
}
/** Client-safe Skill artifact identity; no repository path is exposed. */
export interface EvolutionArtifactView {
    readonly kind: 'skill';
    readonly name: string;
    readonly gitCommit: string;
    readonly treeHash: string;
}
/** One sealed evaluator result shown in review. */
export interface EvolutionReviewCaseView {
    readonly id: string;
    readonly baseline: 'pass' | 'fail' | 'incomplete';
    readonly candidate: 'pass' | 'fail' | 'incomplete';
    readonly passedChecks: number;
    readonly totalChecks: number;
}
/** Bounded review metadata shared by the list and detail views. */
export interface EvolutionReviewView {
    readonly id: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly recommendation: 'promote' | 'review';
    readonly skillName: string;
    readonly claim: string;
    readonly changedFiles: readonly string[];
    readonly candidateTreeHash: string;
    readonly cases: readonly EvolutionReviewCaseView[];
    readonly cost: {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly trialCount: number;
    };
    readonly reasons: readonly string[];
    readonly limitations: readonly string[];
    readonly evaluatorVersion: string;
    readonly compositionFingerprint: string;
    readonly compositionStable: boolean;
    readonly startedAt: string;
    readonly decisionActor?: 'human' | 'auto-clear-instruction-v1';
    readonly decisionNote?: string;
    readonly generationId?: string;
    readonly activatedAt?: string;
}
/** Durable approved Generation that is not the current active selection. */
export interface EvolutionInactiveGenerationView {
    readonly generationId: string;
    readonly reviewId: string;
    readonly skillName: string;
}
/** Reference-only feedback row; Session/message ids and correction text stay on host. */
export interface EvolutionFeedbackSignalView {
    readonly id: string;
    readonly sourceUpdatedAt: number;
    readonly generationId?: string;
}
/** Public name of one statically configured host-side Shadow Target. */
export interface EvolutionShadowTargetView {
    readonly id: string;
    readonly skillName: string;
}
/** Bounded run projection; host paths, proposal and private draft stay excluded. */
export interface EvolutionShadowRunView {
    readonly launchId: string;
    readonly targetId: string;
    readonly skillName: string;
    readonly phase: 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete';
    readonly startedAt: string;
    readonly updatedAt: string;
}
/** Bounded host-only evaluator proposal; generated code remains inactive. */
export interface EvolutionEvaluatorDraftView {
    readonly id: string;
    readonly launchId: string;
    readonly targetId: string;
    readonly skillName: string;
    readonly status: 'authoring-pending' | 'uncertain' | 'draft-ready' | 'qualification-running' | 'qualified' | 'incomplete' | 'rejected';
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly cost: {
        readonly modelCalls: 0 | 1;
        readonly inputTokens: number;
        readonly outputTokens: number;
    };
}
/** Exact bounded files shown only after an explicit detail request. */
export interface EvolutionEvaluatorDraftDetail {
    readonly schemaVersion: 1;
    readonly draft: EvolutionEvaluatorDraftView;
    readonly files: readonly {
        readonly path: string;
        readonly content: string;
    }[];
    readonly limitations: readonly string[];
    readonly qualifiedShadowAvailable: boolean;
    readonly decision?: {
        readonly actor: 'human';
        readonly note: string;
        readonly decidedAt: string;
    };
    readonly qualification?: {
        readonly calibrated: boolean;
        readonly attempt: number;
    };
    readonly reason?: string;
}
/** Browser overview. Dynamic global state stays outside Session and model context. */
export interface EvolutionOverview {
    readonly schemaVersion: 1;
    readonly active?: EvolutionGenerationView;
    readonly recovery: {
        readonly available: boolean;
        readonly paused?: boolean;
    };
    readonly automaticPromotion: {
        readonly enabled: boolean;
        readonly skills: readonly string[];
    };
    readonly deliveryOutcomes?: {
        readonly all: DeliveryOutcomeCounts;
        readonly selected: DeliveryOutcomeCounts;
    };
    readonly feedbackSignals?: {
        readonly all: number;
        readonly selected: number;
    };
    readonly feedbackShadow?: {
        readonly available: boolean;
        readonly warningCount: number;
        readonly signals: readonly EvolutionFeedbackSignalView[];
        readonly targets: readonly EvolutionShadowTargetView[];
        readonly runs: readonly EvolutionShadowRunView[];
    };
    readonly evaluatorAuthoring?: {
        readonly available: boolean;
        readonly warningCount: number;
        readonly signals: readonly EvolutionFeedbackSignalView[];
        readonly targets: readonly EvolutionShadowTargetView[];
        readonly drafts: readonly EvolutionEvaluatorDraftView[];
    };
    readonly reviews: {
        readonly available: boolean;
        readonly pendingCount: number;
        readonly actionableCount: number;
        readonly warningCount: number;
        readonly items: readonly EvolutionReviewView[];
        readonly inactiveGenerations: readonly EvolutionInactiveGenerationView[];
    };
}
/** Exact bounded diff and deterministic policy projection for one review. */
export interface EvolutionReviewDetail {
    readonly schemaVersion: 1;
    readonly review: EvolutionReviewView;
    readonly diff: {
        readonly patch: string;
        readonly shownBytes: number;
        readonly totalBytes: number;
        readonly truncated: boolean;
        readonly impact: CandidateImpactProjection;
    };
    readonly automatic?: {
        readonly eligible: boolean;
        readonly policyVersion: 'auto-clear-instruction-v1';
        readonly reasons: readonly string[];
    };
}
/** Durable action acknowledgement; UI refreshes the authoritative overview afterwards. */
export interface EvolutionActionReceipt {
    readonly schemaVersion: 1;
    readonly action: 'pause' | 'resume' | 'approve-review' | 'reject-review' | 'promote' | 'rollback' | 'start-shadow' | 'author-evaluator' | 'approve-evaluator' | 'reject-evaluator';
    readonly reviewId?: string;
    readonly status?: 'approved' | 'rejected';
    readonly generationId?: string;
    readonly previousGenerationId?: string;
    readonly activeGenerationId?: string;
    readonly recoveryPaused?: boolean;
    readonly launchId?: string;
    readonly targetId?: string;
    readonly skillName?: string;
    readonly runStatus?: 'scheduled' | 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete';
    readonly jobId?: string;
    readonly draftId?: string;
    readonly draftStatus?: 'scheduled' | 'authoring-pending' | 'uncertain' | 'draft-ready' | 'qualification-running' | 'qualified' | 'incomplete' | 'rejected';
}
//# sourceMappingURL=control-types.d.ts.map