export type CandidateImpactIndicator = 'artifact-scope-change' | 'credential-access' | 'destructive-action' | 'messaging-or-calendar' | 'network-access' | 'payment-action' | 'permission-or-sandbox' | 'privileged-tooling' | 'production-change' | 'rewritten-instructions';
/** Browser-safe copy of the versioned host impact projection contract. */
export interface CandidateImpactProjection {
    readonly version: 'lexical-protected-effects-v1';
    readonly scope: 'append-only-skill' | 'broader-change' | 'new-skill';
    readonly indicators: readonly CandidateImpactIndicator[];
}
/** Minimal delivery status aggregate. */
export interface DeliveryOutcomeCounts {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly unknown: number;
}
export interface EvolutionProviderUsageView {
    readonly uncachedInputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
}
export interface EvolutionLatencyView {
    readonly llmMs: number;
    readonly toolMs: number;
    readonly ttftMs: number;
    readonly ttftSteps: number;
    readonly decodeMs: number;
    readonly decodeTokens: number;
}
/** Browser-safe aggregate of exact Goal metrics; missing measurements stay explicit. */
export interface EvolutionDeliveryMetricRollupView {
    readonly measured: number;
    readonly unmeasured: number;
    readonly attributedTurns: number;
    readonly closedSteps: number;
    readonly activeWallMs: number;
    readonly providerUsage: EvolutionProviderUsageView;
    readonly latency: EvolutionLatencyView;
    readonly monetaryCost: {
        readonly status: 'unavailable';
        readonly reason: 'provider-price-not-projected';
    };
}
/** One bounded Outcome evidence row without Session, call, reason, content, or host path. */
export interface EvolutionDeliveryMetricEvidenceView {
    readonly outcomeId: string;
    readonly observedAt: number;
    readonly generationId?: string;
    readonly status: 'passed' | 'failed' | 'unknown';
    readonly goal: {
        readonly id: string;
        readonly revision: number;
    };
    readonly metrics: {
        readonly schemaVersion: 1;
        readonly source: 'dsh-session-projections';
        readonly goalId: string;
        readonly throughEventSeq: number;
        readonly attributedTurns: number;
        readonly closedSteps: number;
        readonly activeWallMs: number;
        readonly providerUsage: EvolutionProviderUsageView;
        readonly latency: EvolutionLatencyView;
        readonly monetaryCost: {
            readonly status: 'unavailable';
            readonly reason: 'provider-price-not-projected';
        };
    };
}
/** Client-safe immutable Generation projection. */
export interface EvolutionGenerationView {
    readonly id: string;
    readonly workspaceId: string;
    readonly rollbackTargetId?: string;
    readonly createdAt: number;
    readonly evaluatorVersion: string;
    readonly policyVersion: string;
    readonly artifacts: readonly EvolutionArtifactView[];
}
/** Client-safe Skill artifact identity; no repository path is exposed. */
export interface EvolutionArtifactView {
    readonly kind: 'skill' | 'skill-bundle';
    readonly name: string;
    readonly gitCommit?: string;
    readonly artifactDigest?: string;
    readonly treeHash: string;
    readonly lineage?: EvolutionSkillCandidateLineageView;
}
export type EvolutionSkillCandidateVersionKind = 'experience-authored-bundle-v1';
/** Browser-safe identity of one internally discovered and admitted Candidate. */
export interface EvolutionSkillCandidateLineageView {
    readonly kind: 'internal-skill-candidate-lineage-v3';
    readonly candidateId: string;
    readonly workspaceId: string;
    readonly skillName: string;
    readonly opportunityId: string;
    readonly evaluationEvidenceId: string;
    readonly policyId: string;
    readonly versionKind: EvolutionSkillCandidateVersionKind;
    readonly contentHash: string;
    readonly candidateTreeHash: string;
    readonly admissionId: string;
    readonly evaluationEnvelopeId: string;
    readonly releaseAuthority: 'none';
}
export type EvolutionCapabilityRoute = 'available' | 'model-selected' | 'user-selected';
/** One exact Skill summary observed through the native DSH Skill registry. */
export interface EvolutionCapabilityView {
    readonly name: string;
    readonly description: string;
    readonly source: string;
    readonly provider: string;
    readonly scope: 'workspace-session';
    readonly invocation: {
        readonly model: boolean;
        readonly user: boolean;
    };
    readonly versionKind: 'provider-managed' | 'evolved-tree';
    readonly version?: string;
    readonly generationId?: string;
    readonly route: EvolutionCapabilityRoute;
}
/** Latest bounded native catalog observation for one exact Workspace Session. */
export interface EvolutionCapabilityMapView {
    readonly status: 'unobserved' | 'complete' | 'incomplete';
    readonly catalogHash?: string;
    readonly capabilities: readonly EvolutionCapabilityView[];
}
/** One bounded, evidence-backed absence observed through DSH's native Skill seam. */
export interface EvolutionCapabilityGapView {
    readonly id: string;
    readonly observedAt: number;
    readonly requestedSkill: string;
    readonly catalogHash: string;
    readonly catalogSize: number;
    readonly generationId?: string;
    readonly goal?: {
        readonly id: string;
        readonly revision: number;
        /** Omitted once the Gap contributes to an evaluation-bearing Opportunity. */
        readonly objective?: string;
    };
    readonly status: 'confirmed';
    readonly evidence: {
        readonly kind: 'native-skill-miss';
        readonly catalog: 'complete';
        readonly routing: 'requested-skill-absent';
        readonly providers: 'settled';
    } | {
        readonly kind: 'model-declared-skill-gap';
        readonly catalog: 'complete';
        readonly routing: 'model-declared-no-applicable-skill';
        readonly providers: 'settled';
    };
}
/** Workspace queue; exact Session ids remain host-private. */
export interface EvolutionCapabilityGapQueueView {
    readonly confirmedCount: number;
    readonly items: readonly EvolutionCapabilityGapView[];
}
/** Experience-derived opportunity; it cannot install, activate, or release a Skill. */
export interface EvolutionSkillOpportunityView {
    readonly id: string;
    readonly skillName: string;
    readonly gapIds: readonly string[];
    readonly goalIds: readonly string[];
    readonly gapCount: number;
    readonly goalCount: number;
    readonly firstObservedAt: number;
    readonly lastObservedAt: number;
    readonly evidence: {
        readonly kind: 'internal-experience-v3';
        readonly eligibilityBasis: 'two-or-more-distinct-goals';
        readonly correctionSignals: {
            readonly association: 'exact-durable-skill-invocation';
            readonly count: number;
            readonly goalCount: number;
            readonly ids: readonly string[];
            readonly referencesTruncated: boolean;
        };
        readonly deliveryOutcomes: {
            readonly association: 'same-goal-single-skill-gap';
            readonly total: number;
            readonly passed: number;
            readonly failed: number;
            readonly unknown: number;
            readonly ids: readonly string[];
            readonly referencesTruncated: boolean;
        };
        readonly causalClaim: 'none';
    };
    readonly evaluationReadiness: {
        readonly status: 'ready-to-seal' | 'sealed';
        readonly evidenceId: string;
        readonly observedGoalCount: number;
        readonly authoringGoalCount: number;
        readonly admissionGoalCount: number;
        readonly holdoutGoalCount: number;
        readonly retentionGoalCount: number;
        readonly proposerCanReadProtectedSamples: false;
        readonly releaseAuthority: 'none';
    } | {
        readonly status: 'waiting';
        readonly reason: 'fewer-than-four-independent-goals';
        readonly observedGoalCount: number;
        readonly requiredGoalCount: 4;
        readonly releaseAuthority: 'none';
    } | {
        readonly status: 'unavailable';
        readonly reason: 'governance-policy-unavailable';
        readonly observedGoalCount: number;
        readonly releaseAuthority: 'none';
    } | {
        readonly status: 'invalid';
        readonly reason: 'opportunity-evidence-invalid';
        readonly observedGoalCount: number;
        readonly releaseAuthority: 'none';
    };
    readonly status: 'eligible-for-authoring';
    readonly releaseAuthority: 'none';
}
export interface EvolutionSkillOpportunityQueueView {
    readonly eligibleCount: number;
    readonly items: readonly EvolutionSkillOpportunityView[];
}
export type EvolutionExistingSkillBaselineQualificationView = {
    readonly status: 'qualified';
    readonly qualificationId: string;
    readonly baseline: {
        readonly id: string;
        readonly provider: string;
        readonly source: string;
        readonly definitionDigest: string;
        readonly artifactDigest: string;
        readonly treeHash: string;
        readonly fileCount: number;
        readonly totalBytes: number;
    };
    readonly evidence: {
        readonly kind: 'exact-correction-invocation-baselines-v1';
        readonly invocationCount: number;
        readonly goalCount: number;
    };
    readonly candidateEligibility: 'eligible-for-existing-skill-authoring';
    readonly releaseAuthority: 'none';
} | {
    readonly status: 'waiting';
    readonly reason: 'invocation-baseline-missing' | 'evidence-over-limit';
    readonly observedInvocationCount: number;
    readonly releaseAuthority: 'none';
} | {
    readonly status: 'invalid';
    readonly reason: 'opportunity-evidence-drift' | 'invocation-baseline-corrupt' | 'invocation-baseline-mismatch' | 'baseline-bundle-conflict';
    readonly releaseAuthority: 'none';
} | {
    readonly status: 'unavailable';
    readonly reason: 'baseline-governance-unavailable';
    readonly releaseAuthority: 'none';
};
export type EvolutionExistingSkillEvaluationEvidenceReadinessView = {
    readonly status: 'ready-to-seal' | 'sealed';
    readonly evidenceId: string;
    readonly qualificationId: string;
    readonly baselineId: string;
    readonly observedGoalCount: number;
    readonly authoringGoalCount: number;
    readonly admissionGoalCount: number;
    readonly holdoutGoalCount: number;
    readonly retentionGoalCount: number;
    readonly proposerCanReadProtectedSamples: false;
    readonly releaseAuthority: 'none';
} | {
    readonly status: 'waiting' | 'unavailable' | 'invalid';
    readonly reason: 'governance-policy-unavailable' | 'baseline-qualification-waiting' | 'baseline-qualification-invalid' | 'fewer-than-four-independent-goals' | 'correction-evidence-unavailable' | 'correction-evidence-drift' | 'correction-evidence-invalid' | 'sealed-evidence-invalid' | 'evidence-services-unavailable';
    readonly observedGoalCount: number;
    readonly requiredGoalCount: 4;
    readonly releaseAuthority: 'none';
};
/** Existing-Skill investigation queue; no Candidate exists without an exact baseline bundle. */
export interface EvolutionSkillImprovementOpportunityView {
    readonly id: string;
    readonly skillName: string;
    readonly invocationContentHash: string;
    readonly feedbackSignalIds: readonly string[];
    readonly goalIds: readonly string[];
    readonly signalCount: number;
    readonly goalCount: number;
    readonly firstObservedAt: number;
    readonly lastObservedAt: number;
    readonly evidence: {
        readonly kind: 'internal-exact-skill-corrections-v1';
        readonly association: 'exact-durable-skill-invocation-content';
        readonly eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content';
        readonly referencesTruncated: boolean;
        readonly causalClaim: 'none';
    };
    readonly baselineQualification: EvolutionExistingSkillBaselineQualificationView;
    readonly evaluationReadiness: EvolutionExistingSkillEvaluationEvidenceReadinessView;
    readonly status: 'waiting-for-baseline-bundle';
    readonly releaseAuthority: 'none';
}
export interface EvolutionSkillImprovementOpportunityQueueView {
    readonly qualifiedCount: number;
    readonly waitingCount: number;
    readonly items: readonly EvolutionSkillImprovementOpportunityView[];
}
/** Quarantined whole-Skill package authored only from internal DSH experience. */
export interface EvolutionSkillCandidateView {
    readonly id: string;
    readonly createdAt: number;
    readonly skillName: string;
    readonly description: string;
    readonly opportunity: {
        readonly kind: 'internal-experience-v1';
        readonly id: string;
        readonly gapIds: readonly string[];
        readonly goalCount: number;
    };
    readonly authorship: {
        readonly kind: 'bounded-model-authoring-v1';
        readonly policyId: string;
        readonly modelIdentityHash: string;
        readonly evaluationEvidenceId: string;
        readonly inputDigest: string;
    };
    readonly scope: 'workspace';
    readonly version: {
        readonly kind: 'experience-authored-bundle-v1';
        readonly artifactDigest: string;
        readonly treeHash: string;
    };
    readonly contentHash: string;
    readonly package: {
        readonly path: string;
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly hasScripts: boolean;
        readonly hasReferences: boolean;
    };
    readonly permissions: {
        readonly declared: boolean;
        readonly executableContent: boolean;
        readonly externalEffects: 'unknown';
    };
    readonly license?: {
        readonly status: 'declared';
        readonly value: string;
    } | {
        readonly status: 'unknown';
    };
    readonly safety: {
        readonly status: 'quarantined';
        readonly checks: readonly {
            readonly name: 'artifact-digest-integrity' | 'regular-files-only' | 'skill-identity' | 'effect-review';
            readonly status: 'passed' | 'required';
        }[];
    };
    readonly lifecycle: 'inactive';
    readonly verification: 'unevaluated';
    readonly execution: 'never';
}
export interface EvolutionSkillCandidateQueueView {
    readonly quarantinedCount: number;
    readonly items: readonly EvolutionSkillCandidateView[];
}
/** Existing-Skill whole-tree Candidate; bodies and Host artifact paths stay private. */
export interface EvolutionExistingSkillCandidateView {
    readonly id: string;
    readonly createdAt: number;
    readonly skillName: string;
    readonly description: string;
    readonly opportunity: {
        readonly kind: 'internal-existing-skill-correction-v1';
        readonly id: string;
        readonly signalCount: number;
        readonly goalCount: number;
    };
    readonly baseline: {
        readonly qualificationId: string;
        readonly id: string;
        readonly artifactDigest: string;
        readonly treeHash: string;
    };
    readonly authorship: {
        readonly kind: 'protected-correction-authoring-v1';
        readonly policyId: string;
        readonly modelIdentityHash: string;
        readonly evaluationEvidenceId: string;
        readonly inputDigest: string;
        readonly holdoutEnvelopeId?: string;
    };
    readonly version: {
        readonly kind: 'existing-skill-improvement-bundle-v1';
        readonly parentBaselineId: string;
        readonly artifactDigest: string;
        readonly treeHash: string;
    };
    readonly contentHash: string;
    readonly diff: {
        readonly kind: 'bounded-instruction-tree-diff-v1';
        readonly changedPaths: readonly string[];
        readonly addedPaths: readonly string[];
        readonly preservedFileCount: number;
        readonly preservedBinaryFileCount: number;
    };
    readonly package: {
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly hasExecutableFiles: false;
    };
    readonly permissions: {
        readonly declared: boolean;
        readonly executableContentChanged: false;
        readonly externalEffects: 'unchanged-or-unknown';
    };
    readonly safety: {
        readonly status: 'quarantined';
    };
    readonly lifecycle: 'inactive';
    readonly verification: 'unevaluated';
    readonly execution: 'never';
    readonly releaseAuthority: 'none';
}
export interface EvolutionExistingSkillCandidateQueueView {
    readonly quarantinedCount: number;
    readonly items: readonly EvolutionExistingSkillCandidateView[];
}
/** Browser-safe state of the sole Host gate for an exact existing-Skill Candidate. */
export type EvolutionExistingSkillReleaseReason = 'exact-existing-skill-evidence-retained' | 'human-rejected' | 'candidate-not-found' | 'candidate-ambiguous' | 'admission-evidence-invalid' | 'admission-not-qualified' | 'holdout-evidence-invalid' | 'holdout-not-improved' | 'retention-evidence-invalid' | 'retention-not-retained' | 'release-decision-evidence-mismatch';
export interface EvolutionExistingSkillReleaseView {
    readonly available: true;
    readonly actionableCount: number;
    readonly items: readonly {
        readonly candidateId: string;
        readonly skillName: string;
        readonly status: 'eligible' | 'approved' | 'rejected' | 'blocked';
        readonly reason: EvolutionExistingSkillReleaseReason;
        readonly baseline: {
            readonly id: string;
            readonly artifactDigest: string;
            readonly treeHash: string;
        };
        readonly candidate: {
            readonly artifactDigest: string;
            readonly treeHash: string;
        };
        readonly diff: {
            readonly changedPaths: readonly string[];
            readonly addedPaths: readonly string[];
            readonly preservedFileCount: number;
            readonly preservedBinaryFileCount: number;
        };
        readonly admissionId?: string;
        readonly holdoutEvaluationId?: string;
        readonly retentionEvaluationId?: string;
        readonly generationId?: string;
        readonly activeForFutureSessions: boolean;
    }[];
}
/** Durable protected authoring state for existing-Skill improvements. */
export interface EvolutionExistingSkillAuthoringView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly runs: readonly {
        readonly id: string;
        readonly targetId: string;
        readonly skillName: string;
        readonly opportunityId: string;
        readonly qualificationId: string;
        readonly evaluationEvidenceId: string;
        readonly baselineId: string;
        readonly phase: 'prepared' | 'holdout-deferred' | 'holdout-blocked' | 'budget-deferred' | 'cancelled' | 'authoring-pending' | 'uncertain' | 'incomplete' | 'candidate-ready';
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly modelCalls: 0 | 1;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly candidateId?: string;
        readonly holdoutEnvelopeId?: string;
        readonly retryAt?: number;
        readonly releaseAuthority: 'none';
    }[];
}
/** Candidate-blind assembled holdout governance for an exact installed Skill baseline. */
export interface EvolutionExistingSkillHoldoutGovernanceView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly runs: readonly {
        readonly id: string;
        readonly policyId: string;
        readonly skillName: string;
        readonly opportunityId: string;
        readonly qualificationId: string;
        readonly baselineId: string;
        readonly evaluationEvidenceId: string;
        readonly phase: 'prepared' | 'budget-deferred' | 'authoring-pending' | 'holdout-ready' | 'authored' | 'uncertain' | 'incomplete' | 'ready';
        readonly pendingRole?: 'holdout' | 'retention';
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly modelCalls: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly retentionIncluded: boolean;
        readonly retryAt?: number;
        readonly failure?: 'paid-authoring-uncertain' | 'holdout-calibration-failed' | 'retention-calibration-failed' | 'governance-incomplete';
        readonly releaseAuthority: 'none';
    }[];
}
/** Exact existing-Skill parent/Candidate structural admission; no Skill is executed. */
export interface EvolutionExistingSkillAdmissionView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly results: readonly {
        readonly id: string;
        readonly candidateId: string;
        readonly skillName: string;
        readonly status: 'abstained' | 'incomplete' | 'protected' | 'qualified-for-holdout';
        readonly reasons: readonly ('no-governance-policy' | 'baseline-unavailable' | 'protected-evidence-unavailable' | 'protected-evidence-binding-mismatch' | 'baseline-identity-mismatch' | 'candidate-materialization-failed' | 'candidate-identity-mismatch' | 'undeclared-tree-difference' | 'unsupported-tree-difference' | 'evaluation-failed' | 'exact-paired-subjects-admitted')[];
        readonly evidence?: {
            readonly baselineId: string;
            readonly baselineArtifactDigest: string;
            readonly baselineTreeHash: string;
            readonly candidateArtifactDigest: string;
            readonly candidateTreeHash: string;
            readonly evaluationEvidenceId: string;
            readonly protectedAdmissionSampleHash: string;
            readonly protectedAdmissionSampleCount: 1;
            readonly changedFileCount: number;
            readonly addedFileCount: number;
            readonly preservedFileCount: number;
            readonly preservedBinaryFileCount: number;
            readonly candidateExecuted: false;
            readonly evaluatorClass: 'host-structural';
        };
        readonly releaseAuthority: 'none';
    }[];
}
/** Exact protected baseline/Candidate holdout result; it has no release authority. */
export interface EvolutionExistingSkillHoldoutEvaluationView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly results: readonly {
        readonly id: string;
        readonly candidateId: string;
        readonly admissionId: string;
        readonly envelopeId: string;
        readonly skillName: string;
        readonly baselineTreeHash: string;
        readonly candidateTreeHash: string;
        readonly casePackHash: string;
        readonly status: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete';
        readonly verdict?: 'improved' | 'ambiguous' | 'not-improved' | 'regressed' | 'none';
        readonly reason?: 'candidate-passed-protected-holdout' | 'baseline-already-passed-protected-holdout' | 'candidate-did-not-fix-protected-holdout' | 'candidate-regressed-protected-holdout' | 'evaluation-input-protected' | 'paired-trial-outcome-uncertain' | 'paired-trial-failed' | 'paired-trial-integrity-failed';
        readonly evidence?: {
            readonly baseline: 'pass' | 'fail';
            readonly candidate: 'pass' | 'fail';
            readonly calibrationPassed: boolean;
            readonly assembled: boolean;
            readonly compositionStable: boolean;
            readonly inputIntegrityStable: boolean;
            readonly proposerCalls: 0;
            readonly trialCount: 4;
            readonly modelCalls?: {
                readonly baseline: number;
                readonly candidate: number;
            };
            readonly usage?: {
                readonly baseline: {
                    readonly inputTokens?: number;
                    readonly outputTokens?: number;
                    readonly cacheReadTokens?: number;
                    readonly cacheWriteTokens?: number;
                    readonly reasoningTokens?: number;
                };
                readonly candidate: {
                    readonly inputTokens?: number;
                    readonly outputTokens?: number;
                    readonly cacheReadTokens?: number;
                    readonly cacheWriteTokens?: number;
                    readonly reasoningTokens?: number;
                };
            };
        };
        readonly startedAt?: string;
        readonly finishedAt?: string;
        readonly releaseAuthority: 'none';
    }[];
}
/** Exact independent existing-Skill Retention result; it has no release authority. */
export interface EvolutionExistingSkillRetentionEvaluationView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly results: readonly {
        readonly id: string;
        readonly candidateId: string;
        readonly holdoutEvaluationId: string;
        readonly admissionId: string;
        readonly envelopeId: string;
        readonly skillName: string;
        readonly baselineTreeHash: string;
        readonly candidateTreeHash: string;
        readonly holdoutCasePackHash: string;
        readonly casePackHash: string;
        readonly status: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete';
        readonly verdict?: 'retained' | 'ambiguous' | 'not-retained' | 'regressed' | 'none';
        readonly reason?: 'candidate-passed-protected-retention' | 'baseline-already-passed-protected-retention' | 'candidate-did-not-retain-protected-case' | 'candidate-regressed-protected-retention' | 'evaluation-input-protected' | 'paired-trial-outcome-uncertain' | 'paired-trial-failed' | 'paired-trial-integrity-failed';
        readonly evidence?: {
            readonly baseline: 'pass' | 'fail';
            readonly candidate: 'pass' | 'fail';
            readonly calibrationPassed: boolean;
            readonly assembled: boolean;
            readonly compositionStable: boolean;
            readonly inputIntegrityStable: boolean;
            readonly proposerCalls: 0;
            readonly trialCount: 4;
            readonly modelCalls?: {
                readonly baseline: number;
                readonly candidate: number;
            };
            readonly usage?: {
                readonly baseline: {
                    readonly inputTokens?: number;
                    readonly outputTokens?: number;
                    readonly cacheReadTokens?: number;
                    readonly cacheWriteTokens?: number;
                    readonly reasoningTokens?: number;
                };
                readonly candidate: {
                    readonly inputTokens?: number;
                    readonly outputTokens?: number;
                    readonly cacheReadTokens?: number;
                    readonly cacheWriteTokens?: number;
                    readonly reasoningTokens?: number;
                };
            };
        };
        readonly startedAt?: string;
        readonly finishedAt?: string;
        readonly releaseAuthority: 'none';
    }[];
}
/** Durable slow-loop authoring state; generated bodies and private paths stay host-only. */
export interface EvolutionSlowLoopAuthoringView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly runs: readonly {
        readonly id: string;
        readonly targetId: string;
        readonly skillName: string;
        readonly opportunityId: string;
        readonly gapCount: number;
        readonly goalCount: number;
        readonly phase: 'prepared' | 'budget-deferred' | 'cancelled' | 'authoring-pending' | 'uncertain' | 'incomplete' | 'candidate-ready';
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly modelCalls: 0 | 1;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly candidateId?: string;
        readonly retryAt?: number;
        readonly releaseAuthority: 'none';
    }[];
}
/** Redacted governance-authoring journal; protected cases, model identity, and paths stay host-only. */
export interface EvolutionSkillEvaluationGovernanceView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly runs: readonly {
        readonly id: string;
        readonly policyId: string;
        readonly skillName: string;
        readonly opportunityId: string;
        readonly evaluationEvidenceId: string;
        readonly phase: 'prepared' | 'budget-deferred' | 'authoring-pending' | 'admission-ready' | 'holdout-ready' | 'authored' | 'uncertain' | 'incomplete' | 'ready';
        readonly pendingRole?: 'admission' | 'holdout' | 'retention';
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly modelCalls: number;
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly retentionIncluded: boolean;
        readonly retryAt?: number;
        readonly failure?: 'paid-authoring-uncertain' | 'admission-calibration-failed' | 'holdout-calibration-failed' | 'retention-calibration-failed' | 'governance-incomplete';
        readonly releaseAuthority: 'none';
    }[];
}
/** Deterministic, zero-model admission evidence; it never carries release authority. */
export interface EvolutionSkillAdmissionView {
    readonly configuredPolicyCount: number;
    readonly warningCount: number;
    readonly results: readonly {
        readonly id: string;
        readonly candidateId: string;
        readonly skillName: string;
        readonly status: 'abstained' | 'protected' | 'incomplete' | 'rejected' | 'review' | 'qualified-for-shadow';
        readonly reasons: readonly ('no-current-evaluation-envelope' | 'candidate-has-executable-content' | 'candidate-is-not-instruction-only' | 'baseline-identity-mismatch' | 'case-pack-identity-mismatch' | 'assembled-evaluator-not-governance-separated' | 'case-pack-calibration-failed' | 'candidate-failed-admission' | 'baseline-already-passes' | 'candidate-improves-deterministic-admission' | 'governance-input-mutated' | 'governance-roots-overlap' | 'evaluation-failed')[];
        readonly envelopeId?: string;
        readonly releaseAuthority: 'none';
        readonly evidence?: {
            readonly baseline: 'pass' | 'fail';
            readonly candidate: 'pass' | 'fail';
            readonly calibrationPassed: boolean;
            readonly candidateExecuted: false;
            readonly evaluatorClass: 'deterministic-filesystem';
            readonly trialCount: 4;
        };
    }[];
}
/** Browser-safe reason vocabulary shared by Retention evidence and its control projection. */
export type EvolutionSkillRetentionReason = 'no-independent-retention-case' | 'shadow-not-complete' | 'shadow-not-promotable' | 'retention-trial-failed' | 'retention-input-mutated' | 'retention-not-assembled' | 'retention-calibration-failed' | 'prior-case-baseline-failed' | 'non-target-composition-changed' | 'candidate-regressed-prior-case' | 'candidate-retained-prior-case';
/** Exact assembled Shadow plus optional fifth-Goal Retention, with Host paths removed. */
export interface EvolutionSkillEvaluationRunsView {
    readonly configuredRetentionRootCount: number;
    readonly warningCount: number;
    readonly items: readonly {
        readonly candidateId: string;
        readonly skillName: string;
        readonly lineage: EvolutionSkillCandidateLineageView;
        readonly shadow: {
            readonly runId: string;
            readonly status: 'complete';
            readonly recommendation: 'promote' | 'review';
            readonly cases: readonly EvolutionReviewCaseView[];
            readonly cost: {
                readonly inputTokens: number;
                readonly outputTokens: number;
                readonly trialCount: number;
            };
            readonly compositionStable: boolean;
            readonly startedAt: string;
        };
        readonly retention?: {
            readonly id: string;
            readonly status: 'prepared' | 'retained' | 'regressed' | 'incomplete';
            readonly reason?: EvolutionSkillRetentionReason;
            readonly startedAt?: string;
            readonly finishedAt?: string;
            readonly evidence?: {
                readonly baseline: 'pass' | 'fail';
                readonly candidate: 'pass' | 'fail';
                readonly calibrationPassed: boolean;
                readonly compositionStable: boolean;
                readonly proposerCalls: 0;
                readonly trialCount: 4;
                readonly modelCalls?: {
                    readonly baseline: number;
                    readonly candidate: number;
                };
                readonly usage?: {
                    readonly baseline: {
                        readonly inputTokens: number;
                        readonly outputTokens: number;
                        readonly cacheReadTokens: number;
                        readonly cacheWriteTokens: number;
                        readonly reasoningTokens: number;
                    };
                    readonly candidate: {
                        readonly inputTokens: number;
                        readonly outputTokens: number;
                        readonly cacheReadTokens: number;
                        readonly cacheWriteTokens: number;
                        readonly reasoningTokens: number;
                    };
                };
            };
            readonly releaseAuthority: 'none';
        };
        readonly releaseAuthority: 'none';
    }[];
}
/** Failed-Outcome replay evidence; it can make rollback eligible but never move a pointer. */
export interface EvolutionCounterfactualCanaryView {
    readonly configuredRootCount: number;
    readonly warningCount: number;
    readonly runs: readonly {
        readonly id: string;
        readonly generationId: string;
        readonly outcomeId: string;
        readonly candidateId: string;
        readonly skillName: string;
        readonly reviewId: string;
        readonly retentionId: string;
        readonly admissionId: string;
        readonly evaluationEnvelopeId: string;
        readonly status: 'prepared' | 'keep' | 'review' | 'rollback-eligible';
        readonly reason?: 'candidate-retained-sealed-canary' | 'candidate-regressed-sealed-canary' | 'canary-input-mutated' | 'canary-not-assembled' | 'canary-calibration-failed' | 'canary-baseline-failed' | 'canary-composition-changed' | 'active-generation-changed' | 'canary-trial-outcome-uncertain';
        readonly startedAt?: string;
        readonly finishedAt?: string;
        readonly evidence?: {
            readonly baseline: 'pass' | 'fail';
            readonly candidate: 'pass' | 'fail';
            readonly calibrationPassed: boolean;
            readonly assembled: boolean;
            readonly compositionStable: boolean;
            readonly inputIntegrityStable: boolean;
            readonly activePointerStable: boolean;
            readonly proposerCalls: 0;
            readonly trialCount: 4;
            readonly modelCalls?: {
                readonly baseline: number;
                readonly candidate: number;
            };
            readonly usage?: {
                readonly baseline: {
                    readonly inputTokens: number;
                    readonly outputTokens: number;
                    readonly cacheReadTokens: number;
                    readonly cacheWriteTokens: number;
                    readonly reasoningTokens: number;
                };
                readonly candidate: {
                    readonly inputTokens: number;
                    readonly outputTokens: number;
                    readonly cacheReadTokens: number;
                    readonly cacheWriteTokens: number;
                    readonly reasoningTokens: number;
                };
            };
        };
        readonly releaseAuthority: 'none';
    }[];
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
    readonly workspaceId: string;
    readonly status: 'pending' | 'approved' | 'rejected';
    readonly recommendation: 'promote' | 'review';
    readonly skillName: string;
    readonly claim: string;
    readonly changedFiles: readonly string[];
    readonly candidateTreeHash: string;
    readonly lineage?: EvolutionSkillCandidateLineageView;
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
export type EvolutionFutureSessionPromotionReason = 'promotion-governance-unavailable' | 'generation-not-found' | 'generation-workspace-mismatch' | 'review-evidence-invalid' | 'approved-review-missing' | 'approved-review-ambiguous' | 'generation-lineage-mismatch' | 'retention-evidence-invalid' | 'retention-not-run' | 'retention-ambiguous' | 'retention-prepared' | 'retention-regressed' | 'retention-incomplete' | 'retention-verdict-invalid' | 'exact-retention-retained';
export interface EvolutionInactiveGenerationView {
    readonly workspaceId: string;
    readonly generationId: string;
    readonly reviewId: string;
    readonly skillName: string;
    readonly lineage?: EvolutionSkillCandidateLineageView;
    readonly promotion: {
        readonly status: 'eligible' | 'waiting' | 'blocked';
        readonly reason: EvolutionFutureSessionPromotionReason;
        readonly retentionId?: string;
    };
}
/** Browser overview. Dynamic global state stays outside Session and model context. */
export interface EvolutionOverview {
    readonly schemaVersion: 1;
    readonly workspaceId: string;
    readonly active?: EvolutionGenerationView;
    readonly recovery: {
        readonly available: boolean;
        readonly paused?: boolean;
    };
    readonly capabilityMap?: EvolutionCapabilityMapView;
    readonly capabilityGaps?: EvolutionCapabilityGapQueueView;
    readonly skillOpportunities?: EvolutionSkillOpportunityQueueView;
    readonly skillImprovementOpportunities?: EvolutionSkillImprovementOpportunityQueueView;
    readonly skillCandidates?: EvolutionSkillCandidateQueueView;
    readonly existingSkillCandidates?: EvolutionExistingSkillCandidateQueueView;
    readonly existingSkillAuthoring?: EvolutionExistingSkillAuthoringView;
    readonly existingSkillHoldoutGovernance?: EvolutionExistingSkillHoldoutGovernanceView;
    readonly existingSkillAdmission?: EvolutionExistingSkillAdmissionView;
    readonly existingSkillHoldoutEvaluation?: EvolutionExistingSkillHoldoutEvaluationView;
    readonly existingSkillRetentionEvaluation?: EvolutionExistingSkillRetentionEvaluationView;
    readonly existingSkillRelease?: EvolutionExistingSkillReleaseView;
    readonly slowLoopAuthoring?: EvolutionSlowLoopAuthoringView;
    readonly skillEvaluationGovernance?: EvolutionSkillEvaluationGovernanceView;
    readonly skillAdmission?: EvolutionSkillAdmissionView;
    readonly skillEvaluationRuns?: EvolutionSkillEvaluationRunsView;
    readonly counterfactualCanary?: EvolutionCounterfactualCanaryView;
    readonly deliveryOutcomes?: {
        readonly all: DeliveryOutcomeCounts;
        readonly selected: DeliveryOutcomeCounts;
        readonly baseline?: DeliveryOutcomeCounts;
        readonly metrics: {
            readonly all: EvolutionDeliveryMetricRollupView;
            readonly selected: EvolutionDeliveryMetricRollupView;
            readonly baseline?: EvolutionDeliveryMetricRollupView;
            readonly recent: readonly EvolutionDeliveryMetricEvidenceView[];
        };
    };
    readonly feedbackSignals?: {
        readonly all: number;
        readonly selected: number;
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
/** Exact bounded diff projection for one review. */
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
}
/** Durable action acknowledgement; UI refreshes the authoritative overview afterwards. */
export interface EvolutionActionReceipt {
    readonly schemaVersion: 1;
    readonly workspaceId: string;
    readonly action: 'pause' | 'resume' | 'approve-review' | 'reject-review' | 'approve-existing-skill' | 'reject-existing-skill' | 'promote-existing-skill' | 'promote' | 'rollback';
    readonly reviewId?: string;
    readonly candidateId?: string;
    readonly status?: 'approved' | 'rejected';
    readonly generationId?: string;
    readonly previousGenerationId?: string;
    readonly activeGenerationId?: string;
    readonly recoveryPaused?: boolean;
    readonly rollbackAuthority?: 'explicit-human' | 'counterfactual-canary';
    readonly canaryId?: string;
}
//# sourceMappingURL=control-types.d.ts.map