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
    kind: 'internal-experience-v2' as const,
    eligibilityBasis: 'two-or-more-distinct-goals' as const,
    correctionSignals: {
      association: 'same-session-single-skill-gap' as const,
      count: 1,
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
    kind: 'internal-skill-candidate-lineage-v2' as const,
    candidateId: '8'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'build-dsh-plugin',
    opportunityId: '7'.repeat(64),
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
    automaticReviewExpiry: {
      eligibleAt: '2026-08-23T00:00:00.000Z',
      eligible: false,
      trigger: 'next-same-skill-automatic-signal',
    },
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
          candidate(),
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
      automatic: {
        skills: workspaceId => workspaceId === WORKSPACE_ID ? ['build-dsh-plugin'] : [],
        evaluate: vi.fn(async () => ({
          eligible: false,
          policyVersion: 'auto-clear-instruction-v1' as const,
          reasons: ['manual review'],
        })),
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
        list: () => [{
          schemaVersion: 2 as const,
          workspaceId: WORKSPACE_ID,
          id: '8'.repeat(64),
          observedAt: 1_786_896_000_000,
          sessionId: 'private-session',
          messageId: 'private-message',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          sourceUpdatedAt: 1_786_896_000_001,
          generationId,
        }],
      },
      feedbackShadow: {
        available: () => true,
        targets: () => [{ id: 'plugin-delivery', workspaceId: WORKSPACE_ID, skillName: 'build-dsh-plugin' }],
        scan: vi.fn(async () => ({
          warningCount: 0,
          runs: [{
            launchId: '9'.repeat(64),
            workspaceId: WORKSPACE_ID,
            targetId: 'plugin-delivery',
            skillName: 'build-dsh-plugin',
            phase: 'trial-running' as const,
            startedAt: '2026-08-16T00:00:00.000Z',
            updatedAt: '2026-08-16T00:00:01.000Z',
          }],
        })),
        launch: vi.fn(),
      },
      automaticFeedback: {
        budgetStatus: vi.fn(async () => ({
          warningCount: 0,
          targets: [{
            targetId: 'plugin-delivery',
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            utcDay: '2026-08-17',
            used: 1,
            limit: 2,
            remaining: 1,
            status: 'ready' as const,
          }],
        })),
      },
      automaticEvaluator: {
        budgetStatus: vi.fn(async () => ({
          warningCount: 0,
          targets: [{
            targetId: 'novel-failure',
            workspaceId: WORKSPACE_ID,
            skillName: 'build-dsh-plugin',
            utcDay: '2026-08-17',
            used: 1,
            limit: 1,
            remaining: 0,
            status: 'ready' as const,
          }],
        })),
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
          schemaVersion: 2 as const,
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
    })

    const overview = await control.overview(WORKSPACE_ID, 'session-1')
    expect(capabilitySnapshot).toHaveBeenCalledWith(WORKSPACE_ID, 'session-1')
    expect(overview).toMatchObject({
      schemaVersion: 1,
      active: { id: generationId, rollbackTargetId: parentId },
      recovery: { available: true, paused: false },
      automaticPromotion: { enabled: true, skills: ['build-dsh-plugin'] },
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
      feedbackShadow: {
        available: true,
        signals: [{ id: '8'.repeat(64), generationId, eligibleTargetIds: ['plugin-delivery'] }],
        targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
        runs: [{ launchId: '9'.repeat(64), phase: 'trial-running' }],
      },
      automaticFeedbackBudget: {
        warningCount: 0,
        targets: [{ targetId: 'plugin-delivery', used: 1, limit: 2, remaining: 1 }],
      },
      automaticEvaluatorBudget: {
        warningCount: 0,
        targets: [{ targetId: 'novel-failure', used: 1, limit: 1, remaining: 0 }],
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
          goal: { id: 'goal-1', objective: 'Publish a verified native DSH plugin.' },
          status: 'confirmed',
          evidence: { kind: 'native-skill-miss' },
        }, {
          id: 'd'.repeat(64),
          requestedSkill: 'release-native-extension',
          catalogHash: '6'.repeat(64),
          goal: { id: 'goal-2', objective: 'Ship the verified extension from another Goal.' },
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
          status: 'eligible-for-authoring',
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
      reviews: { available: true, pendingCount: 1, warningCount: 1 },
    })
    expect(JSON.stringify(overview)).not.toContain('local-curated')
    expect(JSON.stringify(overview)).not.toContain('researchHoldout')
    expect(overview.reviews.inactiveGenerations).toEqual([{
      workspaceId: WORKSPACE_ID,
      generationId: '7'.repeat(64),
      reviewId: '6'.repeat(64),
      skillName: 'build-dsh-plugin',
      lineage: lineage(),
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
      automaticReviewExpiry: {
        eligibleAt: '2026-08-23T00:00:00.000Z',
        eligible: false,
        trigger: 'next-same-skill-automatic-signal',
      },
    })

    const detail = await control.review(WORKSPACE_ID, reviewId)
    expect(detail.diff.patch).toBe('-old\n+new\n')
    expect(detail.automatic?.eligible).toBe(false)
    expect(detail.review.automaticReviewExpiry).toEqual({
      eligibleAt: '2026-08-23T00:00:00.000Z',
      eligible: false,
      trigger: 'next-same-skill-automatic-signal',
    })
    expect(detail.review.lineage).toEqual(lineage())
    expect(JSON.stringify({ overview, detail })).not.toContain('/private/evolution')
    expect(JSON.stringify({ overview, detail })).not.toContain('private content')
    expect(JSON.stringify(overview)).not.toContain('private-session')
    expect(JSON.stringify(overview)).not.toContain('private-message')
    expect(JSON.stringify(overview)).not.toContain('private-gap-session')
    expect(JSON.stringify(overview)).not.toContain('private content')
    expect(JSON.stringify(overview)).not.toContain('/Users/')
  })

  it('does not advertise configured targets for feedback without an exact evolved Skill generation', async () => {
    const control = new EvolutionControlPlane({
      store: store(undefined),
      feedback: {
        summarize: () => ({ all: 1, selected: 1 }),
        list: () => [{
          schemaVersion: 2 as const,
          workspaceId: WORKSPACE_ID,
          id: '8'.repeat(64),
          observedAt: 1_786_896_000_000,
          sessionId: 'private-session',
          messageId: 'private-message',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          sourceUpdatedAt: 1_786_896_000_001,
        }],
      },
      feedbackShadow: {
        available: () => true,
        targets: () => [{ id: 'plugin-delivery', workspaceId: WORKSPACE_ID, skillName: 'build-dsh-plugin' }],
        scan: vi.fn(async () => ({ warningCount: 0, runs: [] })),
        launch: vi.fn(),
      },
    })

    const overview = await control.overview(WORKSPACE_ID)
    expect(overview.feedbackShadow?.signals).toEqual([expect.objectContaining({
      id: '8'.repeat(64),
      eligibleTargetIds: [],
    })])
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

  it('starts a configured feedback Shadow through the existing launcher', async () => {
    const launcher = {
      available: () => true,
      targets: () => [],
      scan: vi.fn(async () => ({ runs: [], warningCount: 0 })),
      launch: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        workspaceId: WORKSPACE_ID,
        launchId: '8'.repeat(64),
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        runStatus: 'scheduled' as const,
        jobId: 'evolution-1',
      })),
    }
    const control = new EvolutionControlPlane({ store: store(), feedbackShadow: launcher })

    await expect(control.startFeedbackShadow(WORKSPACE_ID, '9'.repeat(64), 'plugin-delivery')).resolves.toMatchObject({
      action: 'start-shadow',
      jobId: 'evolution-1',
    })
    expect(launcher.launch).toHaveBeenCalledWith(WORKSPACE_ID, '9'.repeat(64), 'plugin-delivery')
  })

  it('projects and delegates evaluator drafts without exposing owned paths', async () => {
    const draftId = '8'.repeat(64)
    const evaluatorDrafts = {
      available: () => true,
      targets: () => [{ id: 'plugin-delivery', workspaceId: WORKSPACE_ID, skillName: 'build-dsh-plugin' }],
      scan: vi.fn(async () => ({
        warningCount: 0,
        drafts: [{
          id: draftId,
          workspaceId: WORKSPACE_ID,
          launchId: '9'.repeat(64),
          targetId: 'plugin-delivery',
          skillName: 'build-dsh-plugin',
          status: 'draft-ready' as const,
          createdAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:01.000Z',
          cost: { modelCalls: 1 as const, inputTokens: 30, outputTokens: 20 },
        }],
      })),
      get: vi.fn(async () => ({
        id: draftId,
        workspaceId: WORKSPACE_ID,
        launchId: '9'.repeat(64),
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        status: 'draft-ready' as const,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:01.000Z',
        cost: { modelCalls: 1 as const, inputTokens: 30, outputTokens: 20 },
        files: [{ path: 'final-test/evaluator.mjs', content: 'private bounded source' }],
        limitations: ['inactive'],
        qualifiedShadowAvailable: true,
      })),
      author: vi.fn(async () => ({ schemaVersion: 1 as const, workspaceId: WORKSPACE_ID, action: 'author-evaluator' as const })),
      approve: vi.fn(async () => ({ schemaVersion: 1 as const, workspaceId: WORKSPACE_ID, action: 'approve-evaluator' as const })),
      approveAndStartShadow: vi.fn(async () => ({ schemaVersion: 1 as const, workspaceId: WORKSPACE_ID, action: 'start-shadow' as const })),
      reject: vi.fn(async () => ({ schemaVersion: 1 as const, workspaceId: WORKSPACE_ID, action: 'reject-evaluator' as const })),
      startShadow: vi.fn(async () => ({ schemaVersion: 1 as const, workspaceId: WORKSPACE_ID, action: 'start-shadow' as const })),
    }
    const control = new EvolutionControlPlane({ store: store(), evaluatorDrafts: evaluatorDrafts as never })

    await expect(control.overview(WORKSPACE_ID)).resolves.toMatchObject({
      evaluatorAuthoring: {
        available: true,
        actionableCount: 1,
        warningCount: 0,
        targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
        drafts: [{ id: draftId, status: 'draft-ready' }],
      },
    })
    await expect(control.evaluatorDraft(WORKSPACE_ID, draftId)).resolves.toMatchObject({
      schemaVersion: 1,
      draft: { id: draftId },
      files: [{ path: 'final-test/evaluator.mjs', content: 'private bounded source' }],
      qualifiedShadowAvailable: true,
    })
    await control.authorEvaluator(WORKSPACE_ID, '7'.repeat(64), 'plugin-delivery')
    await control.approveEvaluator(WORKSPACE_ID, draftId, 'reviewed')
    await control.approveAndStartEvaluatorShadow(WORKSPACE_ID, draftId, 'reviewed and paid Shadow authorized')
    await control.rejectEvaluator(WORKSPACE_ID, draftId, 'wrong observable')
    await control.startEvaluatorShadow(WORKSPACE_ID, draftId)
    expect(evaluatorDrafts.author).toHaveBeenCalledWith(WORKSPACE_ID, '7'.repeat(64), 'plugin-delivery')
    expect(evaluatorDrafts.approve).toHaveBeenCalledWith(WORKSPACE_ID, draftId, 'reviewed')
    expect(evaluatorDrafts.approveAndStartShadow).toHaveBeenCalledWith(
      WORKSPACE_ID,
      draftId,
      'reviewed and paid Shadow authorized',
    )
    expect(evaluatorDrafts.reject).toHaveBeenCalledWith(WORKSPACE_ID, draftId, 'wrong observable')
    expect(evaluatorDrafts.startShadow).toHaveBeenCalledWith(WORKSPACE_ID, draftId)
  })

  it('counts only evaluator states that require human attention', async () => {
    const statuses = [
      'scheduled',
      'authoring-pending',
      'uncertain',
      'draft-ready',
      'qualification-running',
      'qualified',
      'incomplete',
      'rejected',
    ] as const
    const evaluatorDrafts = {
      available: () => true,
      targets: () => [],
      scan: vi.fn(async () => ({
        warningCount: 0,
        drafts: statuses.map((status, index) => ({
          id: String(index).repeat(64),
          workspaceId: WORKSPACE_ID,
          launchId: '9'.repeat(64),
          targetId: 'plugin-delivery',
          skillName: 'build-dsh-plugin',
          status,
          createdAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:01.000Z',
          cost: { modelCalls: 1 as const, inputTokens: 30, outputTokens: 20 },
        })),
      })),
    }
    const control = new EvolutionControlPlane({ store: store(), evaluatorDrafts: evaluatorDrafts as never })

    await expect(control.overview(WORKSPACE_ID)).resolves.toMatchObject({
      evaluatorAuthoring: { actionableCount: 4 },
    })
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
