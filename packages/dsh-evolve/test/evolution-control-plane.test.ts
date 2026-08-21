import { describe, expect, it, vi } from 'vitest'
import { EvolutionControlPlane } from '../src/evolution-control-plane.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'
import type { ExistingSkillCandidate } from '../src/skill-candidate-repository.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationId = 'a'.repeat(64)
const parentId = 'b'.repeat(64)
const reviewId = 'c'.repeat(64)
const existingCandidateId = '0'.repeat(64)
const existingGenerationId = '1'.repeat(64)

function opportunityEvidence() {
  return {
    kind: 'internal-experience-v3' as const,
    eligibilityBasis: 'two-or-more-distinct-goals' as const,
    correctionSignals: {
      association: 'exact-durable-skill-invocation' as const,
      count: 1,
      goalCount: 1,
      ids: ['3'.repeat(64)],
      referencesTruncated: false,
    },
    deliveryOutcomes: {
      association: 'same-goal-single-skill-gap' as const,
      total: 2,
      passed: 1,
      failed: 1,
      unknown: 0,
      ids: ['4'.repeat(64), '5'.repeat(64)],
      referencesTruncated: false,
    },
    causalClaim: 'none' as const,
  }
}

function lineage(candidateTreeHash = '1'.repeat(64)) {
  return {
    kind: 'internal-skill-candidate-lineage-v3' as const,
    candidateId: '8'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'build-dsh-plugin',
    opportunityId: '7'.repeat(64),
    evaluationEvidenceId: '6'.repeat(64),
    policyId: 'bounded-author',
    versionKind: 'experience-authored-bundle-v1' as const,
    contentHash: '9'.repeat(64),
    candidateTreeHash,
    admissionId: 'a'.repeat(64),
    evaluationEnvelopeId: 'e'.repeat(64),
    releaseAuthority: 'none' as const,
  }
}

function generation(id = generationId): CapabilityGeneration {
  return {
    id,
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    parentId,
    createdAt: 1_786_896_000_000,
    artifacts: [{
      kind: 'skill',
      name: 'build-dsh-plugin',
      gitCommit: 'd'.repeat(40),
      treeHash: 'e'.repeat(40),
      lineage: lineage(),
    }, {
      kind: 'skill-bundle',
      name: 'release-proof',
      artifactDigest: '8'.repeat(64),
      treeHash: '7'.repeat(64),
      contentBase64: 'Zml4dHVyZQ==',
      lineage: {
        ...lineage('7'.repeat(64)),
        skillName: 'release-proof',
        contentHash: '8'.repeat(64),
      },
    }],
    evaluatorVersion: 'case-pack-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function candidate(status: ReviewCandidate['status'] = 'pending'): ReviewCandidate {
  return {
    id: reviewId,
    workspaceId: WORKSPACE_ID,
    runId: 'run-1',
    status,
    outputDir: '/private/evolution/run-1',
    skillName: 'build-dsh-plugin',
    recommendation: 'review',
    claim: 'Continue safe authorized work after a progress update.',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: '1'.repeat(64),
    lineage: lineage(),
    baseTreeHash: '2'.repeat(64),
    proposalHash: '3'.repeat(64),
    proposal: { claim: 'private proposal', files: [{ path: 'SKILL.md', content: 'private content' }] },
    cases: [{ id: 'continuation', baseline: 'fail', candidate: 'pass', passedChecks: 10, totalChecks: 10 }],
    cost: { inputTokens: 0, outputTokens: 0, trialCount: 1 },
    reasons: ['all checks passed'],
    limitations: ['one bounded case'],
    evaluatorVersion: 'case-pack-v1',
    compositionFingerprint: '4'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '5'.repeat(64),
  }
}

function existingCandidate(): ExistingSkillCandidate {
  return {
    schemaVersion: 1,
    kind: 'existing-skill-improvement-candidate-v1',
    id: existingCandidateId,
    createdAt: 1_786_896_200_000,
    workspaceId: WORKSPACE_ID,
    skillName: 'build-dsh-plugin',
    description: 'Build a DSH plugin with independent verification.',
    opportunity: {
      kind: 'internal-existing-skill-correction-v1',
      id: 'f'.repeat(64),
      signalCount: 4,
      goalCount: 4,
    },
    baseline: {
      qualificationId: 'a'.repeat(64),
      id: 'b'.repeat(64),
      artifactDigest: 'd'.repeat(64),
      treeHash: 'e'.repeat(64),
    },
    authorship: {
      kind: 'protected-correction-authoring-v1',
      policyId: 'internal-experience-author',
      modelIdentityHash: '1'.repeat(64),
      evaluationEvidenceId: '2'.repeat(64),
      inputDigest: '3'.repeat(64),
      holdoutEnvelopeId: 'd'.repeat(64),
      claim: 'private proposer claim',
    },
    scope: 'workspace',
    version: {
      kind: 'existing-skill-improvement-bundle-v1',
      parentBaselineId: 'b'.repeat(64),
      artifactDigest: '4'.repeat(64),
      treeHash: '5'.repeat(64),
    },
    contentHash: '4'.repeat(64),
    diff: {
      kind: 'bounded-instruction-tree-diff-v1',
      changedPaths: ['references/verification.md', 'SKILL.md'],
      addedPaths: ['references/verification.md'],
      preservedFileCount: 2,
      preservedBinaryFileCount: 1,
    },
    package: {
      path: '/private/candidate/build-dsh-plugin',
      fileCount: 4,
      totalBytes: 640,
      hasExecutableFiles: false,
    },
    permissions: {
      declared: false,
      executableContentChanged: false,
      externalEffects: 'unchanged-or-unknown',
    },
    license: { status: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'exact-baseline-binding', status: 'passed' },
        { name: 'whole-tree-inheritance', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'instruction-only-diff', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: {
      kind: 'sealed-complete-skill-bundle',
      format: 'tar.gz',
      digest: '4'.repeat(64),
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
    releaseAuthority: 'none',
  }
}

function store(
  active: CapabilityGeneration | undefined = generation(),
  inactive: readonly CapabilityGeneration[] = [],
): EvolutionStore {
  let current: CapabilityGeneration | undefined = active
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn((id: string) => id === current?.id
      ? current
      : inactive.find(item => item.id === id)),
    getActiveGeneration: vi.fn(() => current),
    promoteGeneration: vi.fn(async (_workspaceId: string, id: string) => {
      const previousId = current?.id
      current = generation(id)
      return { previousId, generation: current }
    }),
    rollbackGeneration: vi.fn(async () => {
      const previousId = current?.id ?? generationId
      current = undefined
      return { previousId, generation: undefined }
    }),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
  }
}

describe('EvolutionControlPlane', () => {
  it('projects one bounded browser snapshot without private host paths or proposal content', async () => {
    const inbox = {
      scanAll: vi.fn(async () => ({
        candidates: [
          { ...candidate(), recommendation: 'promote' as const },
          {
            ...candidate('approved'),
            id: '6'.repeat(64),
            generationId: '7'.repeat(64),
          },
        ],
        warnings: ['/private/path: invalid'],
      })),
      get: vi.fn(async () => candidate()),
      approve: vi.fn(),
      reject: vi.fn(),
    }
    const capabilitySnapshot = vi.fn(() => ({
      status: 'complete' as const,
      catalogHash: '6'.repeat(64),
      capabilities: [{
        name: 'build-dsh-plugin',
        description: 'Build one native DSH plugin.',
        source: 'project-agents',
        provider: 'filesystem',
        scope: 'workspace-session' as const,
        invocation: { model: true, user: true },
        versionKind: 'evolved-tree' as const,
        version: 'e'.repeat(40),
        generationId,
        route: 'model-selected' as const,
      }],
    }))
    const control = new EvolutionControlPlane({
      store: store(generation(), [generation('7'.repeat(64))]),
      resident: { isPaused: () => false, pause: vi.fn(), resume: vi.fn() },
      review: {
        inbox,
        publisher: {
          preview: vi.fn(async () => ({
            patch: '-old\n+new\n',
            shownBytes: 10,
            totalBytes: 10,
            truncated: false,
            impact: {
              version: 'lexical-protected-effects-v1' as const,
              scope: 'append-only-skill' as const,
              indicators: [],
            },
          })),
          publish: vi.fn(),
        },
      },
      outcomes: { summarize: () => ({
        all: { total: 3, passed: 2, failed: 1, unknown: 0 },
        selected: { total: 2, passed: 2, failed: 0, unknown: 0 },
        baseline: { total: 1, passed: 0, failed: 1, unknown: 0 },
        metrics: {
          all: metricRollup(2, 1, 2),
          selected: metricRollup(1, 1, 1),
          baseline: metricRollup(1, 0, 1),
          recent: [{
            outcomeId: '0'.repeat(64),
            observedAt: 1_786_896_000_200,
            generationId,
            status: 'passed' as const,
            goal: { id: 'goal-metrics', revision: 2 },
            metrics: projectedGoalMetrics(),
          }],
        },
      }) },
      skillUses: { summarize: () => ({
        all: { useCount: 5, goalCount: 4, skillVersionCount: 3, crossGoalSkillVersionCount: 1 },
        selected: { useCount: 4, goalCount: 3, skillVersionCount: 2, crossGoalSkillVersionCount: 1 },
        baseline: { useCount: 1, goalCount: 1, skillVersionCount: 1, crossGoalSkillVersionCount: 0 },
        items: [{
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          generationId,
          useCount: 3,
          goalCount: 2,
          routes: { userExplicit: 1, modelTool: 2 },
          firstObservedAt: 1_786_896_000_100,
          lastObservedAt: 1_786_896_000_300,
          status: 'cross-goal-observed' as const,
          causalClaim: 'none' as const,
          releaseAuthority: 'none' as const,
        }],
      }) },
      skillOutcomeContext: { summarize: () => ({
        all: outcomeContextRollup(1, 3, 2, 1, 3, 1, 1, 0),
        selected: outcomeContextRollup(1, 3, 2, 1, 3, 1, 1, 0),
        baseline: outcomeContextRollup(0, 0, 0, 0, 0, 0, 0, 0),
        items: [{
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          generationId,
          useCount: 3,
          goalContextCount: 2,
          outcomeObservedGoalContextCount: 2,
          outcomeUnobservedGoalContextCount: 0,
          outcomeAttemptCount: 3,
          repeatedOutcomeGoalContextCount: 1,
          recoveredGoalContextCount: 1,
          ambiguousLatestGoalContextCount: 0,
          betweenAttempts: {
            transitionCount: 1,
            ambiguousOrderGoalContextCount: 0,
            metrics: metricRollup(1, 0, 1),
          },
          latest: { passed: 1, failed: 0, unknown: 1 },
          metrics: metricRollup(2, 0, 2),
          attribution: 'same-session-goal-generation-after-use' as const,
          causalClaim: 'none' as const,
          improvementClaim: 'none' as const,
          releaseAuthority: 'none' as const,
        }],
      }) },
      feedback: {
        summarize: () => ({ all: 4, selected: 1 }),
      },
      capabilities: {
        snapshot: capabilitySnapshot,
      },
      gaps: {
        list: () => [{
          schemaVersion: 1 as const,
          id: '5'.repeat(64),
          observedAt: 1_786_896_000_000,
          workspaceId: WORKSPACE_ID,
          sessionId: 'private-gap-session',
          requestedSkill: 'missing-release-skill',
          catalogHash: '6'.repeat(64),
          catalogSize: 1,
          generationId,
          goal: {
            id: 'goal-1',
            revision: 3,
            objective: 'Publish a verified native DSH plugin.',
          },
          status: 'confirmed' as const,
          evidence: {
            kind: 'native-skill-miss' as const,
            catalog: 'complete' as const,
            routing: 'requested-skill-absent' as const,
            providers: 'settled' as const,
          },
        }, {
          schemaVersion: 1 as const,
          id: 'd'.repeat(64),
          observedAt: 1_786_896_000_200,
          workspaceId: WORKSPACE_ID,
          sessionId: 'second-private-gap-session',
          requestedSkill: 'release-native-extension',
          catalogHash: '6'.repeat(64),
          catalogSize: 1,
          generationId,
          goal: {
            id: 'goal-2',
            revision: 1,
            objective: 'Ship the verified extension from another Goal.',
          },
          status: 'confirmed' as const,
          evidence: {
            kind: 'model-declared-skill-gap' as const,
            catalog: 'complete' as const,
            routing: 'model-declared-no-applicable-skill' as const,
            providers: 'settled' as const,
          },
        }],
      },
      opportunities: {
        discover: () => [{
          schemaVersion: 3 as const,
          id: '8'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'release-native-extension',
          gapIds: ['5'.repeat(64), 'd'.repeat(64)],
          goalIds: ['goal-1', 'goal-2'],
          gapCount: 2,
          goalCount: 2,
          firstObservedAt: 1_786_896_000_000,
          lastObservedAt: 1_786_896_000_200,
          evidence: opportunityEvidence(),
          status: 'eligible-for-authoring' as const,
          releaseAuthority: 'none' as const,
        }],
        discoverImprovements: () => [{
          schemaVersion: 1 as const,
          id: 'f'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          feedbackSignalIds: ['2'.repeat(64), '3'.repeat(64)],
          goalIds: ['goal-correction-1', 'goal-correction-2'],
          signalCount: 2,
          goalCount: 2,
          firstObservedAt: 1_786_896_000_010,
          lastObservedAt: 1_786_896_000_020,
          evidence: {
            kind: 'internal-exact-skill-corrections-v1' as const,
            association: 'exact-durable-skill-invocation-content' as const,
            eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content' as const,
            referencesTruncated: false,
            causalClaim: 'none' as const,
          },
          status: 'waiting-for-baseline-bundle' as const,
          releaseAuthority: 'none' as const,
        }],
      },
      improvementBaselines: {
        qualify: async () => ({
          status: 'qualified' as const,
          qualification: {
            schemaVersion: 1 as const,
            kind: 'existing-skill-baseline-qualification-v1' as const,
            id: 'a'.repeat(64),
            opportunityId: 'f'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            invocationContentHash: '1'.repeat(64),
            baseline: {
              id: 'b'.repeat(64),
              provider: 'filesystem',
              source: 'project-dsh',
              definitionDigest: 'c'.repeat(64),
              artifactDigest: 'd'.repeat(64),
              treeHash: 'e'.repeat(64),
              fileCount: 3,
              totalBytes: 512,
            },
            evidence: {
              kind: 'exact-correction-invocation-baselines-v1' as const,
              feedbackSignalIds: ['2'.repeat(64), '3'.repeat(64)],
              goalIds: ['goal-correction-1', 'goal-correction-2'],
              invocationCount: 2,
              goalCount: 2,
            },
            status: 'eligible-for-existing-skill-authoring' as const,
            releaseAuthority: 'none' as const,
          },
          baseline: {} as never,
        }),
      },
      improvementEvidence: {
        readiness: async () => ({
          status: 'waiting' as const,
          reason: 'fewer-than-four-independent-goals' as const,
          observedGoalCount: 2,
          requiredGoalCount: 4 as const,
          releaseAuthority: 'none' as const,
        }),
      },
      evaluationEvidence: {
        readiness: async () => ({
          status: 'waiting' as const,
          reason: 'fewer-than-four-independent-goals' as const,
          observedGoalCount: 2,
          requiredGoalCount: 4 as const,
          releaseAuthority: 'none' as const,
        }),
      },
      candidates: {
        listCandidates: () => [experienceSkillCandidate({
          id: '4'.repeat(64),
          createdAt: 1_786_896_100_000,
          skillName: 'release-native-extension',
          description: 'Publish a verified release.',
          opportunity: {
            kind: 'internal-experience-v1' as const,
            id: '8'.repeat(64),
            gapIds: ['5'.repeat(64), 'd'.repeat(64)],
            goalCount: 2,
          },
          authorship: {
            kind: 'bounded-model-authoring-v1' as const,
            policyId: 'internal-experience-author',
            modelIdentityHash: 'a'.repeat(64),
            evaluationEvidenceId: '9'.repeat(64),
            inputDigest: 'b'.repeat(64),
          },
          version: {
            kind: 'experience-authored-bundle-v1' as const,
            artifactDigest: 'c'.repeat(64),
            treeHash: 'd'.repeat(64),
          },
          contentHash: 'c'.repeat(64),
          package: {
            path: 'release-native-extension',
            fileCount: 2,
            totalBytes: 512,
            hasScripts: false,
            hasReferences: true,
          },
        })],
        listExistingCandidates: () => [{
          schemaVersion: 1 as const,
          kind: 'existing-skill-improvement-candidate-v1' as const,
          id: '0'.repeat(64),
          createdAt: 1_786_896_200_000,
          workspaceId: WORKSPACE_ID,
          skillName: 'build-dsh-plugin',
          description: 'Build a DSH plugin with independent verification.',
          opportunity: {
            kind: 'internal-existing-skill-correction-v1' as const,
            id: 'f'.repeat(64),
            signalCount: 4,
            goalCount: 4,
          },
          baseline: {
            qualificationId: 'a'.repeat(64),
            id: 'b'.repeat(64),
            artifactDigest: 'd'.repeat(64),
            treeHash: 'e'.repeat(64),
          },
          authorship: {
            kind: 'protected-correction-authoring-v1' as const,
            policyId: 'internal-experience-author',
            modelIdentityHash: '1'.repeat(64),
            evaluationEvidenceId: '2'.repeat(64),
            inputDigest: '3'.repeat(64),
            holdoutEnvelopeId: 'd'.repeat(64),
            claim: 'Require an independent verification step.',
          },
          scope: 'workspace' as const,
          version: {
            kind: 'existing-skill-improvement-bundle-v1' as const,
            parentBaselineId: 'b'.repeat(64),
            artifactDigest: '4'.repeat(64),
            treeHash: '5'.repeat(64),
          },
          contentHash: '4'.repeat(64),
          diff: {
            kind: 'bounded-instruction-tree-diff-v1' as const,
            changedPaths: ['references/verification.md', 'SKILL.md'],
            addedPaths: ['references/verification.md'],
            preservedFileCount: 2,
            preservedBinaryFileCount: 1,
          },
          package: {
            path: 'build-dsh-plugin',
            fileCount: 4,
            totalBytes: 640,
            hasExecutableFiles: false as const,
          },
          permissions: {
            declared: false,
            executableContentChanged: false as const,
            externalEffects: 'unchanged-or-unknown' as const,
          },
          license: { status: 'unknown' as const },
          safety: {
            status: 'quarantined' as const,
            checks: [
              { name: 'artifact-digest-integrity' as const, status: 'passed' as const },
              { name: 'exact-baseline-binding' as const, status: 'passed' as const },
              { name: 'whole-tree-inheritance' as const, status: 'passed' as const },
              { name: 'skill-identity' as const, status: 'passed' as const },
              { name: 'instruction-only-diff' as const, status: 'passed' as const },
              { name: 'effect-review' as const, status: 'required' as const },
            ],
          },
          artifact: {
            kind: 'sealed-complete-skill-bundle' as const,
            format: 'tar.gz' as const,
            digest: '4'.repeat(64),
          },
          lifecycle: 'inactive' as const,
          verification: 'unevaluated' as const,
          execution: 'never' as const,
          releaseAuthority: 'none' as const,
        }],
      },
      admissions: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          results: [{
            schemaVersion: 2 as const,
            id: '2'.repeat(64),
            candidateId: '4'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: 'release-native-extension',
            status: 'qualified-for-shadow' as const,
            reasons: ['candidate-improves-deterministic-admission' as const],
            envelopeId: 'e'.repeat(64),
            releaseAuthority: 'none' as const,
            evidence: {
              baseline: 'fail' as const,
              candidate: 'pass' as const,
              calibrationPassed: true,
              candidateExecuted: false as const,
              evaluatorClass: 'deterministic-filesystem' as const,
              trialCount: 4 as const,
              baselineTreeHash: '6'.repeat(64),
              candidateTreeHash: '7'.repeat(64),
            },
          }],
        })),
      },
      retention: {
        scan: vi.fn(async () => ({
          configuredRootCount: 1,
          warningCount: 0,
          runs: [{
            id: 'f'.repeat(64),
            candidateId: lineage().candidateId,
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            admissionId: lineage().admissionId,
            evaluationEnvelopeId: lineage().evaluationEnvelopeId,
            shadowRunId: 'run-1',
            baselineTreeHash: '2'.repeat(64),
            candidateTreeHash: '1'.repeat(64),
            status: 'retained' as const,
            reason: 'candidate-retained-prior-case' as const,
            startedAt: '2026-08-16T00:01:00.000Z',
            finishedAt: '2026-08-16T00:02:00.000Z',
            evidence: {
              retentionCasePackHash: '3'.repeat(64),
              baselineTreeHash: '2'.repeat(64),
              candidateTreeHash: '1'.repeat(64),
              baseline: 'pass' as const,
              candidate: 'pass' as const,
              calibrationPassed: true,
              compositionStable: true,
              proposerCalls: 0 as const,
              trialCount: 4 as const,
              modelCalls: { baseline: 1, candidate: 1 },
              usage: {
                baseline: { inputTokens: 12, cacheReadTokens: 4 },
                candidate: { inputTokens: 10, cacheReadTokens: 6 },
              },
            },
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      counterfactualCanary: {
        scan: vi.fn(async () => ({
          configuredRootCount: 1,
          warningCount: 0,
          runs: [{
            schemaVersion: 1 as const,
            kind: 'internal-counterfactual-canary-result-v1' as const,
            id: '1'.repeat(64),
            workspaceId: WORKSPACE_ID,
            generationId,
            outcomeId: '0'.repeat(64),
            candidateId: lineage().candidateId,
            skillName: 'build-dsh-plugin',
            reviewId,
            retentionId: 'f'.repeat(64),
            admissionId: lineage().admissionId,
            evaluationEnvelopeId: lineage().evaluationEnvelopeId,
            status: 'rollback-eligible' as const,
            reason: 'candidate-regressed-sealed-canary' as const,
            startedAt: '2026-08-16T00:03:00.000Z',
            finishedAt: '2026-08-16T00:04:00.000Z',
            evidence: {
              retentionCasePackHash: '3'.repeat(64),
              baselineTreeHash: '2'.repeat(64),
              candidateTreeHash: '1'.repeat(64),
              baseline: 'pass' as const,
              candidate: 'fail' as const,
              calibrationPassed: true,
              assembled: true,
              compositionStable: true,
              inputIntegrityStable: true,
              activePointerStable: true,
              proposerCalls: 0 as const,
              trialCount: 4 as const,
              modelCalls: { baseline: 1, candidate: 1 },
              usage: {
                baseline: { inputTokens: 12, cacheReadTokens: 4 },
                candidate: { inputTokens: 10, cacheReadTokens: 6 },
              },
            },
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      slowLoopAuthoring: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: '9'.repeat(64),
            targetId: 'missing-release-author',
            workspaceId: WORKSPACE_ID,
            skillName: 'missing-release-skill',
            opportunityId: '8'.repeat(64),
            gapCount: 2,
            goalCount: 2,
            phase: 'candidate-ready' as const,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:01.000Z',
            modelCalls: 1 as const,
            inputTokens: 320,
            outputTokens: 120,
            candidateId: '7'.repeat(64),
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      existingSkillAuthoring: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: '0'.repeat(64),
            targetId: 'existing-skill-author',
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            opportunityId: 'f'.repeat(64),
            qualificationId: 'a'.repeat(64),
            evaluationEvidenceId: '2'.repeat(64),
            baselineId: 'b'.repeat(64),
            phase: 'candidate-ready' as const,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:01.000Z',
            modelCalls: 1 as const,
            inputTokens: 280,
            outputTokens: 70,
            candidateId: '4'.repeat(64),
            holdoutEnvelopeId: 'd'.repeat(64),
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      existingSkillHoldoutGovernance: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: 'c'.repeat(64),
            policyId: 'workspace-governance',
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            opportunityId: 'f'.repeat(64),
            qualificationId: 'a'.repeat(64),
            baselineId: 'b'.repeat(64),
            evaluationEvidenceId: '2'.repeat(64),
            phase: 'ready' as const,
            createdAt: '2026-08-18T00:00:00.000Z',
            updatedAt: '2026-08-18T00:00:01.000Z',
            modelCalls: 1 as const,
            inputTokens: 90,
            outputTokens: 40,
            retentionIncluded: false,
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      existingSkillAdmissions: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          results: [{
            schemaVersion: 1 as const,
            id: '6'.repeat(64),
            candidateId: '4'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            status: 'qualified-for-holdout' as const,
            reasons: ['exact-paired-subjects-admitted' as const],
            evidence: {
              baselineId: 'b'.repeat(64),
              baselineArtifactDigest: '1'.repeat(64),
              baselineTreeHash: 'e'.repeat(64),
              candidateArtifactDigest: '3'.repeat(64),
              candidateTreeHash: '5'.repeat(64),
              evaluationEvidenceId: '2'.repeat(64),
              protectedAdmissionSampleHash: '7'.repeat(64),
              protectedAdmissionSampleCount: 1 as const,
              changedFileCount: 2,
              addedFileCount: 1,
              preservedFileCount: 2,
              preservedBinaryFileCount: 1,
              candidateExecuted: false as const,
              evaluatorClass: 'host-structural' as const,
            },
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      existingSkillHoldoutEvaluations: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          results: [{
            id: '8'.repeat(64),
            candidateId: '4'.repeat(64),
            admissionId: '6'.repeat(64),
            envelopeId: 'd'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            baselineTreeHash: 'e'.repeat(64),
            candidateTreeHash: '5'.repeat(64),
            casePackHash: '7'.repeat(64),
            status: 'complete' as const,
            verdict: 'improved' as const,
            reason: 'candidate-passed-protected-holdout' as const,
            evidence: {
              baselineTreeHash: 'e'.repeat(64),
              candidateTreeHash: '5'.repeat(64),
              casePackHash: '7'.repeat(64),
              baseline: 'fail' as const,
              candidate: 'pass' as const,
              calibrationPassed: true,
              assembled: true,
              compositionStable: true,
              inputIntegrityStable: true,
              proposerCalls: 0 as const,
              trialCount: 4 as const,
              modelCalls: { baseline: 1, candidate: 1 },
              usage: {
                baseline: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 40 },
                candidate: { inputTokens: 110, outputTokens: 18, cacheReadTokens: 50 },
              },
            },
            startedAt: '2026-08-18T00:01:00.000Z',
            finishedAt: '2026-08-18T00:01:01.000Z',
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      existingSkillRetentionEvaluations: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          results: [{
            id: '9'.repeat(64),
            candidateId: '4'.repeat(64),
            holdoutEvaluationId: '8'.repeat(64),
            admissionId: '6'.repeat(64),
            envelopeId: 'd'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            baselineTreeHash: 'e'.repeat(64),
            candidateTreeHash: '5'.repeat(64),
            holdoutCasePackHash: '7'.repeat(64),
            casePackHash: '9'.repeat(64),
            status: 'complete' as const,
            verdict: 'retained' as const,
            reason: 'candidate-passed-protected-retention' as const,
            evidence: {
              holdoutCasePackHash: '7'.repeat(64),
              baselineTreeHash: 'e'.repeat(64),
              candidateTreeHash: '5'.repeat(64),
              casePackHash: '9'.repeat(64),
              baseline: 'fail' as const,
              candidate: 'pass' as const,
              calibrationPassed: true,
              assembled: true,
              compositionStable: true,
              inputIntegrityStable: true,
              proposerCalls: 0 as const,
              trialCount: 4 as const,
              modelCalls: { baseline: 1, candidate: 1 },
              usage: {
                baseline: { inputTokens: 130, outputTokens: 22, cacheReadTokens: 42 },
                candidate: { inputTokens: 115, outputTokens: 19, cacheReadTokens: 55 },
              },
            },
            startedAt: '2026-08-18T00:02:00.000Z',
            finishedAt: '2026-08-18T00:02:01.000Z',
            releaseAuthority: 'none' as const,
          }],
        })),
      },
      evaluationGovernance: {
        scan: vi.fn(async () => ({
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: 'a'.repeat(64),
            policyId: 'workspace-governance',
            workspaceId: WORKSPACE_ID,
            skillName: 'release-native-extension',
            opportunityId: '8'.repeat(64),
            evaluationEvidenceId: '9'.repeat(64),
            phase: 'ready' as const,
            createdAt: '2026-08-18T00:00:01.000Z',
            updatedAt: '2026-08-18T00:00:02.000Z',
            modelCalls: 2,
            inputTokens: 640,
            outputTokens: 240,
            retentionIncluded: false,
            releaseAuthority: 'none' as const,
          }],
        })),
      },
    })

    const overview = await control.overview(WORKSPACE_ID, 'session-1')
    expect(capabilitySnapshot).toHaveBeenCalledWith(WORKSPACE_ID, 'session-1')
    expect(overview.capabilityGaps?.items.map(gap => gap.goal)).toEqual([
      { id: 'goal-1', revision: 3 },
      { id: 'goal-2', revision: 1 },
    ])
    expect(overview).toMatchObject({
      schemaVersion: 1,
      active: { id: generationId, rollbackTargetId: parentId },
      recovery: { available: true, paused: false },
      deliveryOutcomes: {
        all: { total: 3, passed: 2, failed: 1, unknown: 0 },
        selected: { total: 2, passed: 2, failed: 0, unknown: 0 },
        baseline: { total: 1, passed: 0, failed: 1, unknown: 0 },
        metrics: {
          all: {
            measured: 2,
            unmeasured: 1,
            providerUsage: {
              uncachedInputTokens: 60,
              outputTokens: 18,
              cacheReadTokens: 140,
              cacheWriteTokens: 10,
            },
          },
          selected: { measured: 1, unmeasured: 1 },
          baseline: { measured: 1, unmeasured: 0 },
          recent: [{
            outcomeId: '0'.repeat(64),
            goal: { id: 'goal-metrics', revision: 2 },
            metrics: { throughEventSeq: 12, activeWallMs: 300 },
          }],
        },
      },
      skillReuse: {
        all: { useCount: 5, goalCount: 4, skillVersionCount: 3, crossGoalSkillVersionCount: 1 },
        selected: { useCount: 4, goalCount: 3, skillVersionCount: 2, crossGoalSkillVersionCount: 1 },
        baseline: { useCount: 1, goalCount: 1, skillVersionCount: 1, crossGoalSkillVersionCount: 0 },
        items: [{
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          generationId,
          useCount: 3,
          goalCount: 2,
          routes: { userExplicit: 1, modelTool: 2 },
          status: 'cross-goal-observed',
          causalClaim: 'none',
          releaseAuthority: 'none',
        }],
      },
      skillOutcomeContext: {
        all: {
          skillVersionCount: 1,
          goalContextCount: 3,
          outcomeObservedGoalContextCount: 2,
          outcomeUnobservedGoalContextCount: 1,
          outcomeAttemptCount: 3,
          repeatedOutcomeGoalContextCount: 1,
          recoveredGoalContextCount: 1,
          ambiguousLatestGoalContextCount: 0,
        },
        selected: { skillVersionCount: 1, goalContextCount: 3 },
        baseline: { skillVersionCount: 0, goalContextCount: 0 },
        items: [{
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          generationId,
          useCount: 3,
          goalContextCount: 2,
          outcomeObservedGoalContextCount: 2,
          outcomeAttemptCount: 3,
          repeatedOutcomeGoalContextCount: 1,
          recoveredGoalContextCount: 1,
          latest: { passed: 1, failed: 0, unknown: 1 },
          attribution: 'same-session-goal-generation-after-use',
          causalClaim: 'none',
          improvementClaim: 'none',
          releaseAuthority: 'none',
        }],
      },
      capabilityMap: {
        status: 'complete',
        catalogHash: '6'.repeat(64),
        capabilities: [{
          name: 'build-dsh-plugin',
          source: 'project-agents',
          provider: 'filesystem',
          versionKind: 'evolved-tree',
          version: 'e'.repeat(40),
          generationId,
          route: 'model-selected',
        }],
      },
      capabilityGaps: {
        confirmedCount: 2,
        items: [{
          id: '5'.repeat(64),
          requestedSkill: 'missing-release-skill',
          catalogHash: '6'.repeat(64),
          goal: { id: 'goal-1' },
          status: 'confirmed',
          evidence: { kind: 'native-skill-miss' },
        }, {
          id: 'd'.repeat(64),
          requestedSkill: 'release-native-extension',
          catalogHash: '6'.repeat(64),
          goal: { id: 'goal-2' },
          status: 'confirmed',
          evidence: { kind: 'model-declared-skill-gap' },
        }],
      },
      skillOpportunities: {
        eligibleCount: 1,
        items: [{
          id: '8'.repeat(64),
          skillName: 'release-native-extension',
          gapIds: ['5'.repeat(64), 'd'.repeat(64)],
          goalIds: ['goal-1', 'goal-2'],
          gapCount: 2,
          goalCount: 2,
          evidence: opportunityEvidence(),
          evaluationReadiness: {
            status: 'waiting',
            reason: 'fewer-than-four-independent-goals',
            observedGoalCount: 2,
            requiredGoalCount: 4,
            releaseAuthority: 'none',
          },
          status: 'eligible-for-authoring',
          releaseAuthority: 'none',
        }],
      },
      skillImprovementOpportunities: {
        qualifiedCount: 1,
        waitingCount: 0,
        items: [{
          id: 'f'.repeat(64),
          skillName: 'build-dsh-plugin',
          invocationContentHash: '1'.repeat(64),
          feedbackSignalIds: ['2'.repeat(64), '3'.repeat(64)],
          goalIds: ['goal-correction-1', 'goal-correction-2'],
          signalCount: 2,
          goalCount: 2,
          evidence: {
            kind: 'internal-exact-skill-corrections-v1',
            association: 'exact-durable-skill-invocation-content',
            eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content',
            referencesTruncated: false,
            causalClaim: 'none',
          },
          baselineQualification: {
            status: 'qualified',
            qualificationId: 'a'.repeat(64),
            baseline: {
              id: 'b'.repeat(64),
              provider: 'filesystem',
              source: 'project-dsh',
              definitionDigest: 'c'.repeat(64),
              artifactDigest: 'd'.repeat(64),
              treeHash: 'e'.repeat(64),
              fileCount: 3,
              totalBytes: 512,
            },
            evidence: {
              kind: 'exact-correction-invocation-baselines-v1',
              invocationCount: 2,
              goalCount: 2,
            },
            candidateEligibility: 'eligible-for-existing-skill-authoring',
            releaseAuthority: 'none',
          },
          evaluationReadiness: {
            status: 'waiting',
            reason: 'fewer-than-four-independent-goals',
            observedGoalCount: 2,
            requiredGoalCount: 4,
            releaseAuthority: 'none',
          },
          status: 'waiting-for-baseline-bundle',
          releaseAuthority: 'none',
        }],
      },
      skillCandidates: {
        quarantinedCount: 1,
        items: [{
          id: '4'.repeat(64),
          skillName: 'release-native-extension',
          opportunity: {
            kind: 'internal-experience-v1',
            id: '8'.repeat(64),
            gapIds: ['5'.repeat(64), 'd'.repeat(64)],
            goalCount: 2,
          },
          authorship: {
            kind: 'bounded-model-authoring-v1',
            policyId: 'internal-experience-author',
            evaluationEvidenceId: '9'.repeat(64),
          },
          version: { kind: 'experience-authored-bundle-v1', treeHash: 'd'.repeat(64) },
          contentHash: 'c'.repeat(64),
          safety: { status: 'quarantined' },
          lifecycle: 'inactive',
          verification: 'unevaluated',
          execution: 'never',
        }],
      },
      existingSkillCandidates: {
        quarantinedCount: 1,
        items: [{
          id: '0'.repeat(64),
          skillName: 'build-dsh-plugin',
          opportunity: {
            kind: 'internal-existing-skill-correction-v1',
            id: 'f'.repeat(64),
            signalCount: 4,
            goalCount: 4,
          },
          baseline: {
            qualificationId: 'a'.repeat(64),
            id: 'b'.repeat(64),
            treeHash: 'e'.repeat(64),
          },
          authorship: { holdoutEnvelopeId: 'd'.repeat(64) },
          version: {
            kind: 'existing-skill-improvement-bundle-v1',
            parentBaselineId: 'b'.repeat(64),
            treeHash: '5'.repeat(64),
          },
          diff: {
            kind: 'bounded-instruction-tree-diff-v1',
            changedPaths: ['references/verification.md', 'SKILL.md'],
            addedPaths: ['references/verification.md'],
            preservedFileCount: 2,
            preservedBinaryFileCount: 1,
          },
          safety: { status: 'quarantined' },
          lifecycle: 'inactive',
          verification: 'unevaluated',
          execution: 'never',
          releaseAuthority: 'none',
        }],
      },
      skillAdmission: {
        configuredPolicyCount: 1,
        warningCount: 0,
        results: [{
          id: '2'.repeat(64),
          candidateId: '4'.repeat(64),
          skillName: 'release-native-extension',
          status: 'qualified-for-shadow',
          reasons: ['candidate-improves-deterministic-admission'],
          envelopeId: 'e'.repeat(64),
          releaseAuthority: 'none',
          evidence: {
            baseline: 'fail',
            candidate: 'pass',
            candidateExecuted: false,
            evaluatorClass: 'deterministic-filesystem',
          },
        }],
      },
      slowLoopAuthoring: {
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          id: '9'.repeat(64),
          targetId: 'missing-release-author',
          skillName: 'missing-release-skill',
          opportunityId: '8'.repeat(64),
          gapCount: 2,
          goalCount: 2,
          phase: 'candidate-ready',
          modelCalls: 1,
          inputTokens: 320,
          outputTokens: 120,
          candidateId: '7'.repeat(64),
          releaseAuthority: 'none',
        }],
      },
      existingSkillAuthoring: {
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          id: '0'.repeat(64),
          targetId: 'existing-skill-author',
          skillName: 'build-dsh-plugin',
          opportunityId: 'f'.repeat(64),
          qualificationId: 'a'.repeat(64),
          evaluationEvidenceId: '2'.repeat(64),
          baselineId: 'b'.repeat(64),
          phase: 'candidate-ready',
          modelCalls: 1,
          inputTokens: 280,
          outputTokens: 70,
          candidateId: '4'.repeat(64),
          holdoutEnvelopeId: 'd'.repeat(64),
          releaseAuthority: 'none',
        }],
      },
      existingSkillHoldoutGovernance: {
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          id: 'c'.repeat(64),
          policyId: 'workspace-governance',
          skillName: 'build-dsh-plugin',
          opportunityId: 'f'.repeat(64),
          qualificationId: 'a'.repeat(64),
          baselineId: 'b'.repeat(64),
          evaluationEvidenceId: '2'.repeat(64),
          phase: 'ready',
          modelCalls: 1,
          inputTokens: 90,
          outputTokens: 40,
          retentionIncluded: false,
          releaseAuthority: 'none',
        }],
      },
      existingSkillAdmission: {
        configuredPolicyCount: 1,
        warningCount: 0,
        results: [{
          id: '6'.repeat(64),
          candidateId: '4'.repeat(64),
          skillName: 'build-dsh-plugin',
          status: 'qualified-for-holdout',
          reasons: ['exact-paired-subjects-admitted'],
          evidence: {
            baselineId: 'b'.repeat(64),
            baselineArtifactDigest: '1'.repeat(64),
            baselineTreeHash: 'e'.repeat(64),
            candidateArtifactDigest: '3'.repeat(64),
            candidateTreeHash: '5'.repeat(64),
            evaluationEvidenceId: '2'.repeat(64),
            protectedAdmissionSampleHash: '7'.repeat(64),
            protectedAdmissionSampleCount: 1,
            changedFileCount: 2,
            addedFileCount: 1,
            preservedFileCount: 2,
            preservedBinaryFileCount: 1,
            candidateExecuted: false,
            evaluatorClass: 'host-structural',
          },
          releaseAuthority: 'none',
        }],
      },
      existingSkillHoldoutEvaluation: {
        configuredPolicyCount: 1,
        warningCount: 0,
        results: [{
          id: '8'.repeat(64),
          candidateId: '4'.repeat(64),
          admissionId: '6'.repeat(64),
          envelopeId: 'd'.repeat(64),
          skillName: 'build-dsh-plugin',
          baselineTreeHash: 'e'.repeat(64),
          candidateTreeHash: '5'.repeat(64),
          casePackHash: '7'.repeat(64),
          status: 'complete',
          verdict: 'improved',
          reason: 'candidate-passed-protected-holdout',
          evidence: {
            baseline: 'fail',
            candidate: 'pass',
            calibrationPassed: true,
            assembled: true,
            compositionStable: true,
            inputIntegrityStable: true,
            proposerCalls: 0,
            trialCount: 4,
            modelCalls: { baseline: 1, candidate: 1 },
            usage: {
              baseline: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 40 },
              candidate: { inputTokens: 110, outputTokens: 18, cacheReadTokens: 50 },
            },
          },
          startedAt: '2026-08-18T00:01:00.000Z',
          finishedAt: '2026-08-18T00:01:01.000Z',
          releaseAuthority: 'none',
        }],
      },
      existingSkillRetentionEvaluation: {
        configuredPolicyCount: 1,
        warningCount: 0,
        results: [{
          id: '9'.repeat(64),
          candidateId: '4'.repeat(64),
          holdoutEvaluationId: '8'.repeat(64),
          admissionId: '6'.repeat(64),
          envelopeId: 'd'.repeat(64),
          skillName: 'build-dsh-plugin',
          baselineTreeHash: 'e'.repeat(64),
          candidateTreeHash: '5'.repeat(64),
          holdoutCasePackHash: '7'.repeat(64),
          casePackHash: '9'.repeat(64),
          status: 'complete',
          verdict: 'retained',
          reason: 'candidate-passed-protected-retention',
          evidence: {
            baseline: 'fail',
            candidate: 'pass',
            calibrationPassed: true,
            assembled: true,
            compositionStable: true,
            inputIntegrityStable: true,
            proposerCalls: 0,
            trialCount: 4,
            modelCalls: { baseline: 1, candidate: 1 },
            usage: {
              baseline: { inputTokens: 130, outputTokens: 22, cacheReadTokens: 42 },
              candidate: { inputTokens: 115, outputTokens: 19, cacheReadTokens: 55 },
            },
          },
          startedAt: '2026-08-18T00:02:00.000Z',
          finishedAt: '2026-08-18T00:02:01.000Z',
          releaseAuthority: 'none',
        }],
      },
      skillEvaluationGovernance: {
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          id: 'a'.repeat(64),
          policyId: 'workspace-governance',
          skillName: 'release-native-extension',
          opportunityId: '8'.repeat(64),
          evaluationEvidenceId: '9'.repeat(64),
          phase: 'ready',
          modelCalls: 2,
          inputTokens: 640,
          outputTokens: 240,
          releaseAuthority: 'none',
        }],
      },
      counterfactualCanary: {
        configuredRootCount: 1,
        warningCount: 0,
        runs: [{
          generationId,
          outcomeId: '0'.repeat(64),
          candidateId: lineage().candidateId,
          skillName: 'build-dsh-plugin',
          status: 'rollback-eligible',
          reason: 'candidate-regressed-sealed-canary',
          evidence: {
            baseline: 'pass',
            candidate: 'fail',
            calibrationPassed: true,
            assembled: true,
            compositionStable: true,
            inputIntegrityStable: true,
            activePointerStable: true,
            proposerCalls: 0,
            trialCount: 4,
          },
          releaseAuthority: 'none',
        }],
      },
      reviews: { available: true, pendingCount: 1, warningCount: 1 },
    })
    expect(overview.skillEvaluationRuns).toMatchObject({
      configuredRetentionRootCount: 1,
      warningCount: 0,
    })
    expect(overview.skillEvaluationRuns?.items[0]).toMatchObject({
      candidateId: lineage().candidateId,
      skillName: 'build-dsh-plugin',
      lineage: lineage(),
      shadow: {
        runId: 'run-1',
        status: 'complete',
        recommendation: 'promote',
        cases: [{ id: 'continuation', baseline: 'fail', candidate: 'pass' }],
        cost: { inputTokens: 0, outputTokens: 0, trialCount: 1 },
        compositionStable: true,
      },
      retention: {
        id: 'f'.repeat(64),
        status: 'retained',
        reason: 'candidate-retained-prior-case',
        evidence: {
          baseline: 'pass',
          candidate: 'pass',
          calibrationPassed: true,
          compositionStable: true,
          proposerCalls: 0,
          trialCount: 4,
          modelCalls: { baseline: 1, candidate: 1 },
        },
        releaseAuthority: 'none',
      },
      releaseAuthority: 'none',
    })
    expect(JSON.stringify(overview)).not.toContain('local-curated')
    expect(JSON.stringify(overview)).not.toContain('researchHoldout')
    expect(overview.reviews.inactiveGenerations).toEqual([{
      workspaceId: WORKSPACE_ID,
      generationId: '7'.repeat(64),
      reviewId: '6'.repeat(64),
      skillName: 'build-dsh-plugin',
      lineage: lineage(),
      promotion: {
        status: 'blocked',
        reason: 'promotion-governance-unavailable',
      },
    }])
    expect(overview.active?.artifacts[0]?.lineage).toEqual(lineage())
    expect(overview.active?.artifacts[1]).toMatchObject({
      kind: 'skill-bundle',
      name: 'release-proof',
      artifactDigest: '8'.repeat(64),
      treeHash: '7'.repeat(64),
    })
    expect(overview.active?.artifacts[1]).not.toHaveProperty('gitCommit')
    expect(overview.reviews.items[0]).toMatchObject({
      id: reviewId,
      skillName: 'build-dsh-plugin',
      lineage: lineage(),
    })

    const detail = await control.review(WORKSPACE_ID, reviewId)
    expect(detail.diff.patch).toBe('-old\n+new\n')
    expect(detail.review.lineage).toEqual(lineage())
    expect(JSON.stringify({ overview, detail })).not.toContain('/private/evolution')
    expect(JSON.stringify({ overview, detail })).not.toContain('private content')
    expect(JSON.stringify(overview)).not.toContain('private-session')
    expect(JSON.stringify(overview)).not.toContain('private-message')
    expect(JSON.stringify(overview)).not.toContain('private-gap-session')
    expect(JSON.stringify(overview)).not.toContain('private content')
    expect(JSON.stringify(overview)).not.toContain('Require an independent verification step.')
    expect(JSON.stringify(overview)).not.toContain('/Users/')
  })

  it('fails visible instead of pairing Retention to a different Shadow Candidate tree', async () => {
    const exact = { ...candidate(), recommendation: 'promote' as const }
    const control = new EvolutionControlPlane({
      store: store(),
      review: {
        inbox: {
          scanAll: vi.fn(async () => ({ candidates: [exact], warnings: [] })),
          get: vi.fn(async () => exact),
          approve: vi.fn(),
          reject: vi.fn(),
        },
        publisher: { preview: vi.fn(), publish: vi.fn() },
      },
      retention: {
        scan: vi.fn(async () => ({
          configuredRootCount: 1,
          warningCount: 0,
          runs: [{
            id: 'f'.repeat(64),
            candidateId: lineage().candidateId,
            workspaceId: WORKSPACE_ID,
            skillName: exact.skillName,
            admissionId: lineage().admissionId,
            evaluationEnvelopeId: lineage().evaluationEnvelopeId,
            shadowRunId: exact.runId,
            baselineTreeHash: exact.baseTreeHash,
            candidateTreeHash: '0'.repeat(64),
            status: 'retained' as const,
            reason: 'candidate-retained-prior-case' as const,
            releaseAuthority: 'none' as const,
          }],
        })),
      },
    })

    const overview = await control.overview(WORKSPACE_ID)
    expect(overview.skillEvaluationRuns).toMatchObject({
      configuredRetentionRootCount: 1,
      warningCount: 1,
    })
    expect(overview.skillEvaluationRuns?.items[0]?.retention).toBeUndefined()
  })

  it('keeps approval inactive and requires a separate promotion action', async () => {
    const evolutionStore = store(undefined)
    const published = generation()
    const publisher = {
      preview: vi.fn(),
      publish: vi.fn(async () => published),
    }
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [], warnings: [] })),
      get: vi.fn(async () => candidate()),
      reject: vi.fn(),
      approve: vi.fn(async (_id: string, _note: string, publish: (value: ReviewCandidate) => Promise<{ id: string }>) => {
        const result = await publish(candidate())
        return { ...candidate('approved'), generationId: result.id }
      }),
    }
    const control = new EvolutionControlPlane({
      store: evolutionStore,
      promotion: {
        eligibility: async () => ({
          status: 'eligible' as const,
          reason: 'exact-retention-retained' as const,
          generationId,
          reviewId,
          retentionId: 'f'.repeat(64),
        }),
        promote: (workspaceId, id) => evolutionStore.promoteGeneration(workspaceId, id),
      },
      review: { inbox, publisher },
    })

    const approval = await control.approveReview(WORKSPACE_ID, reviewId, 'verified by a human')
    expect(approval).toEqual({
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
      action: 'approve-review',
      reviewId,
      generationId,
      status: 'approved',
    })
    expect(evolutionStore.promoteGeneration).not.toHaveBeenCalled()

    const promotion = await control.promote(WORKSPACE_ID, generationId)
    expect(evolutionStore.promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, generationId)
    expect(promotion).toMatchObject({ action: 'promote', activeGenerationId: generationId })
  })

  it('projects and controls existing-Skill release through the sole Host release owner', async () => {
    const evolutionStore = store(undefined)
    const release = {
      scan: vi.fn(async () => [{
        status: 'eligible' as const,
        reason: 'exact-existing-skill-evidence-retained' as const,
        candidateId: existingCandidateId,
        admissionId: '6'.repeat(64),
        holdoutEvaluationId: '8'.repeat(64),
        retentionEvaluationId: '9'.repeat(64),
      }]),
      approve: vi.fn(async () => ({
        schemaVersion: 1 as const,
        kind: 'existing-skill-release-decision-v1' as const,
        id: '2'.repeat(64),
        status: 'approved' as const,
        candidateId: existingCandidateId,
        workspaceId: WORKSPACE_ID,
        skillName: 'build-dsh-plugin',
        actor: 'human' as const,
        decisionNote: 'verified retained improvement',
        decidedAt: '2026-08-21T00:00:00.000Z',
        evidenceHash: '3'.repeat(64),
        admissionId: '6'.repeat(64),
        holdoutEvaluationId: '8'.repeat(64),
        retentionEvaluationId: '9'.repeat(64),
        generationId: existingGenerationId,
      })),
      reject: vi.fn(async () => ({
        schemaVersion: 1 as const,
        kind: 'existing-skill-release-decision-v1' as const,
        id: '4'.repeat(64),
        status: 'rejected' as const,
        candidateId: existingCandidateId,
        workspaceId: WORKSPACE_ID,
        skillName: 'build-dsh-plugin',
        actor: 'human' as const,
        decisionNote: 'unsafe effect boundary',
        decidedAt: '2026-08-21T00:00:00.000Z',
        evidenceHash: '5'.repeat(64),
      })),
      promote: vi.fn(async () => ({
        previousId: undefined,
        generation: generation(existingGenerationId),
      })),
    }
    const control = new EvolutionControlPlane({
      store: evolutionStore,
      candidates: {
        listCandidates: () => [],
        listExistingCandidates: () => [existingCandidate()],
      },
      existingSkillRelease: release,
    })

    const overview = await control.overview(WORKSPACE_ID)
    expect(release.scan).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(overview.existingSkillRelease).toEqual({
      available: true,
      actionableCount: 1,
      items: [{
        candidateId: existingCandidateId,
        skillName: 'build-dsh-plugin',
        status: 'eligible',
        reason: 'exact-existing-skill-evidence-retained',
        baseline: {
          id: 'b'.repeat(64),
          artifactDigest: 'd'.repeat(64),
          treeHash: 'e'.repeat(64),
        },
        candidate: {
          artifactDigest: '4'.repeat(64),
          treeHash: '5'.repeat(64),
        },
        diff: {
          changedPaths: ['references/verification.md', 'SKILL.md'],
          addedPaths: ['references/verification.md'],
          preservedFileCount: 2,
          preservedBinaryFileCount: 1,
        },
        admissionId: '6'.repeat(64),
        holdoutEvaluationId: '8'.repeat(64),
        retentionEvaluationId: '9'.repeat(64),
        activeForFutureSessions: false,
      }],
    })
    expect(JSON.stringify(overview.existingSkillRelease)).not.toContain('/private/')
    expect(JSON.stringify(overview.existingSkillRelease)).not.toContain('private proposer claim')

    await expect(control.approveExistingSkill(
      WORKSPACE_ID,
      existingCandidateId,
      'verified retained improvement',
    )).resolves.toEqual({
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
      action: 'approve-existing-skill',
      candidateId: existingCandidateId,
      generationId: existingGenerationId,
      status: 'approved',
    })
    expect(release.approve).toHaveBeenCalledWith(
      WORKSPACE_ID,
      existingCandidateId,
      'verified retained improvement',
    )
    expect(evolutionStore.promoteGeneration).not.toHaveBeenCalled()

    await expect(control.promoteExistingSkill(WORKSPACE_ID, existingCandidateId)).resolves.toEqual({
      schemaVersion: 1,
      workspaceId: WORKSPACE_ID,
      action: 'promote-existing-skill',
      candidateId: existingCandidateId,
      activeGenerationId: existingGenerationId,
    })
    expect(release.promote).toHaveBeenCalledWith(WORKSPACE_ID, existingCandidateId)

    await expect(control.rejectExistingSkill(
      WORKSPACE_ID,
      existingCandidateId,
      'unsafe effect boundary',
    )).resolves.toMatchObject({
      action: 'reject-existing-skill',
      candidateId: existingCandidateId,
      status: 'rejected',
    })
    expect(release.reject).toHaveBeenCalledWith(
      WORKSPACE_ID,
      existingCandidateId,
      'unsafe effect boundary',
    )
  })

  it('refuses future-Session promotion when independent eligibility governance is unavailable', async () => {
    const evolutionStore = store(undefined, [generation()])
    const before = evolutionStore.getActiveGeneration(WORKSPACE_ID)
    const control = new EvolutionControlPlane({ store: evolutionStore })

    await expect(control.promote(WORKSPACE_ID, generationId))
      .rejects.toThrow('future-Session promotion eligibility is not configured')
    expect(evolutionStore.promoteGeneration).not.toHaveBeenCalled()
    expect(evolutionStore.getActiveGeneration(WORKSPACE_ID)).toEqual(before)
  })

  it('projects exact promotion eligibility for an inactive Generation', async () => {
    const inactiveId = '7'.repeat(64)
    const approved = {
      ...candidate('approved'),
      recommendation: 'promote' as const,
      generationId: inactiveId,
      decisionActor: 'human' as const,
      decisionNote: 'verified',
    }
    const promotion = {
      eligibility: vi.fn(async () => ({
        status: 'eligible' as const,
        reason: 'exact-retention-retained' as const,
        generationId: inactiveId,
        reviewId: approved.id,
        retentionId: 'f'.repeat(64),
      })),
      promote: vi.fn(),
    }
    const control = new EvolutionControlPlane({
      store: store(generation(), [generation(inactiveId)]),
      promotion,
      review: {
        inbox: {
          scanAll: vi.fn(async () => ({ candidates: [approved], warnings: [] })),
          get: vi.fn(),
          approve: vi.fn(),
          reject: vi.fn(),
        },
        publisher: { preview: vi.fn(), publish: vi.fn() },
      },
    })

    const overview = await control.overview(WORKSPACE_ID)
    expect(overview.reviews.inactiveGenerations).toEqual([{
      workspaceId: WORKSPACE_ID,
      generationId: inactiveId,
      reviewId: approved.id,
      skillName: approved.skillName,
      lineage: lineage(),
      promotion: {
        status: 'eligible',
        reason: 'exact-retention-retained',
        retentionId: 'f'.repeat(64),
      },
    }])
    expect(promotion.eligibility).toHaveBeenCalledWith(WORKSPACE_ID, inactiveId)
  })

  it('routes pause, resume, rejection, and rollback through the existing durable owners', async () => {
    let paused = false
    const resident = {
      isPaused: () => paused,
      pause: vi.fn(async () => { paused = true }),
      resume: vi.fn(async () => { paused = false }),
    }
    const rejected = { ...candidate('rejected'), decisionActor: 'human' as const, decisionNote: 'not enough evidence' }
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [], warnings: [] })),
      get: vi.fn(async () => candidate()),
      approve: vi.fn(),
      reject: vi.fn(async () => rejected),
    }
    const evolutionStore = store()
    const rollback = {
      rollback: vi.fn(async (_workspaceId: string, options: { canaryId?: string } = {}) => ({
        previousId: generationId,
        generation: undefined,
        authority: options.canaryId === undefined
          ? 'explicit-human' as const
          : 'counterfactual-canary' as const,
        ...(options.canaryId === undefined ? {} : { canaryId: options.canaryId }),
      })),
    }
    const control = new EvolutionControlPlane({
      store: evolutionStore,
      rollback,
      resident,
      review: { inbox, publisher: { preview: vi.fn(), publish: vi.fn() } },
    })

    await expect(control.pause(WORKSPACE_ID)).resolves.toMatchObject({ action: 'pause', recoveryPaused: true })
    await expect(control.resume(WORKSPACE_ID)).resolves.toMatchObject({ action: 'resume', recoveryPaused: false })
    await expect(control.rejectReview(WORKSPACE_ID, reviewId, 'not enough evidence')).resolves.toMatchObject({
      action: 'reject-review', reviewId, status: 'rejected',
    })
    await expect(control.rollback(WORKSPACE_ID, 'd'.repeat(64))).resolves.toMatchObject({
      action: 'rollback',
      previousGenerationId: generationId,
      rollbackAuthority: 'counterfactual-canary',
      canaryId: 'd'.repeat(64),
    })
    expect(resident.pause).toHaveBeenCalledOnce()
    expect(resident.resume).toHaveBeenCalledOnce()
    expect(inbox.reject).toHaveBeenCalledWith(reviewId, 'not enough evidence')
    expect(rollback.rollback).toHaveBeenCalledWith(WORKSPACE_ID, { canaryId: 'd'.repeat(64) })
    expect(evolutionStore.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('projects existing-Skill Canary evidence and routes its exact rollback gate independently', async () => {
    const canaryId = '4'.repeat(64)
    const existingSkillCounterfactualCanary = {
      scan: vi.fn(async () => ({
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          schemaVersion: 1 as const,
          kind: 'existing-skill-counterfactual-canary-result-v1' as const,
          id: canaryId,
          policyId: 'workspace-governance',
          workspaceId: WORKSPACE_ID,
          generationId,
          outcomeId: '5'.repeat(64),
          candidateId: existingCandidateId,
          skillName: 'build-dsh-plugin',
          admissionId: '6'.repeat(64),
          holdoutEvaluationId: '7'.repeat(64),
          retentionEvaluationId: '8'.repeat(64),
          evaluationEnvelopeId: '9'.repeat(64),
          status: 'rollback-eligible' as const,
          reason: 'candidate-regressed-baseline-recovers' as const,
          startedAt: '2026-08-21T00:00:00.000Z',
          finishedAt: '2026-08-21T00:01:00.000Z',
          evidence: {
            holdoutCasePackHash: '1'.repeat(64),
            retentionCasePackHash: '2'.repeat(64),
            baselineTreeHash: '3'.repeat(64),
            candidateTreeHash: '4'.repeat(64),
            baseline: 'pass' as const,
            candidate: 'fail' as const,
            calibrationPassed: true,
            assembled: true,
            compositionStable: true,
            inputIntegrityStable: true,
            activePointerStable: true,
            proposerCalls: 0 as const,
            trialCount: 4 as const,
            modelCalls: { baseline: 1, candidate: 1 },
            usage: {
              baseline: { inputTokens: 20, cacheReadTokens: 5 },
              candidate: { inputTokens: 18, cacheReadTokens: 7 },
            },
          },
          releaseAuthority: 'none' as const,
        }],
      })),
    }
    const existingSkillRollback = {
      rollback: vi.fn(async () => ({
        previousId: generationId,
        generation: undefined,
        authority: 'existing-skill-counterfactual-canary' as const,
        canaryId,
      })),
    }
    const control = new EvolutionControlPlane({
      store: store(),
      existingSkillCounterfactualCanary,
      existingSkillRollback,
    })

    await expect(control.overview(WORKSPACE_ID)).resolves.toMatchObject({
      existingSkillCounterfactualCanary: {
        configuredPolicyCount: 1,
        warningCount: 0,
        runs: [{
          id: canaryId,
          status: 'rollback-eligible',
          reason: 'candidate-regressed-baseline-recovers',
          evidence: {
            baseline: 'pass',
            candidate: 'fail',
            activePointerStable: true,
            inputIntegrityStable: true,
            proposerCalls: 0,
            trialCount: 4,
            usage: {
              baseline: { inputTokens: 20, cacheReadTokens: 5 },
              candidate: { inputTokens: 18, cacheReadTokens: 7 },
            },
          },
          releaseAuthority: 'none',
        }],
      },
    })
    await expect(control.rollbackExistingSkill(WORKSPACE_ID, canaryId)).resolves.toMatchObject({
      action: 'rollback-existing-skill',
      previousGenerationId: generationId,
      rollbackAuthority: 'existing-skill-counterfactual-canary',
      canaryId,
    })
    expect(existingSkillRollback.rollback).toHaveBeenCalledWith(WORKSPACE_ID, canaryId)
  })

  it('fails closed instead of bypassing a missing future-Session rollback gate', async () => {
    const evolutionStore = store()
    const control = new EvolutionControlPlane({ store: evolutionStore })

    await expect(control.rollback(WORKSPACE_ID))
      .rejects.toThrow('future-Session rollback gate is not configured')
    expect(evolutionStore.rollbackGeneration).not.toHaveBeenCalled()
  })

})

function projectedGoalMetrics() {
  return {
    schemaVersion: 1 as const,
    source: 'dsh-session-projections' as const,
    goalId: 'goal-metrics',
    throughEventSeq: 12,
    attributedTurns: 2,
    closedSteps: 1,
    activeWallMs: 300,
    providerUsage: {
      uncachedInputTokens: 30,
      outputTokens: 9,
      cacheReadTokens: 70,
      cacheWriteTokens: 5,
    },
    latency: {
      llmMs: 180,
      toolMs: 50,
      ttftMs: 45,
      ttftSteps: 2,
      decodeMs: 135,
      decodeTokens: 9,
    },
    monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
  }
}

function metricRollup(measured: number, unmeasured: number, factor: number) {
  return {
    measured,
    unmeasured,
    attributedTurns: 2 * factor,
    closedSteps: factor,
    activeWallMs: 300 * factor,
    providerUsage: {
      uncachedInputTokens: 30 * factor,
      outputTokens: 9 * factor,
      cacheReadTokens: 70 * factor,
      cacheWriteTokens: 5 * factor,
    },
    latency: {
      llmMs: 180 * factor,
      toolMs: 50 * factor,
      ttftMs: 45 * factor,
      ttftSteps: 2 * factor,
      decodeMs: 135 * factor,
      decodeTokens: 9 * factor,
    },
    monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
  }
}

function outcomeContextRollup(
  skillVersionCount: number,
  goalContextCount: number,
  outcomeObservedGoalContextCount: number,
  outcomeUnobservedGoalContextCount: number,
  outcomeAttemptCount: number,
  repeatedOutcomeGoalContextCount: number,
  recoveredGoalContextCount: number,
  ambiguousLatestGoalContextCount: number,
) {
  return {
    skillVersionCount,
    goalContextCount,
    outcomeObservedGoalContextCount,
    outcomeUnobservedGoalContextCount,
    outcomeAttemptCount,
    repeatedOutcomeGoalContextCount,
    recoveredGoalContextCount,
    ambiguousLatestGoalContextCount,
    betweenAttempts: {
      transitionCount: repeatedOutcomeGoalContextCount,
      ambiguousOrderGoalContextCount: 0,
      metrics: metricRollup(repeatedOutcomeGoalContextCount, 0, repeatedOutcomeGoalContextCount),
    },
    latest: { passed: 1, failed: 0, unknown: 1 },
    metrics: metricRollup(2, 0, 2),
  }
}
