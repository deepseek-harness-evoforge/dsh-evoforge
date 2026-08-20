import { describe, expect, it, vi } from 'vitest'
import { EvolutionControlPlane } from '../src/evolution-control-plane.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationId = 'a'.repeat(64)
const parentId = 'b'.repeat(64)
const reviewId = 'c'.repeat(64)

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
        waitingCount: 1,
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
    const control = new EvolutionControlPlane({
      store: evolutionStore,
      resident,
      review: { inbox, publisher: { preview: vi.fn(), publish: vi.fn() } },
    })

    await expect(control.pause(WORKSPACE_ID)).resolves.toMatchObject({ action: 'pause', recoveryPaused: true })
    await expect(control.resume(WORKSPACE_ID)).resolves.toMatchObject({ action: 'resume', recoveryPaused: false })
    await expect(control.rejectReview(WORKSPACE_ID, reviewId, 'not enough evidence')).resolves.toMatchObject({
      action: 'reject-review', reviewId, status: 'rejected',
    })
    await expect(control.rollback(WORKSPACE_ID)).resolves.toMatchObject({
      action: 'rollback', previousGenerationId: generationId,
    })
    expect(resident.pause).toHaveBeenCalledOnce()
    expect(resident.resume).toHaveBeenCalledOnce()
    expect(inbox.reject).toHaveBeenCalledWith(reviewId, 'not enough evidence')
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
