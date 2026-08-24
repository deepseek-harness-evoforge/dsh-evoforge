import { describe, expect, it, vi } from 'vitest'
import { FutureSessionPromotion } from '../src/future-session-promotion.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import type { InternalSkillRetentionRunView } from '../src/internal-skill-retention.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'
import type { SkillCandidateLineage } from '../src/skill-candidate-lineage.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const GENERATION_ID = '1'.repeat(64)
const BASE_TREE = '2'.repeat(64)
const CANDIDATE_TREE = '3'.repeat(64)

describe('future-Session Promotion', () => {
  it('refuses a reviewed Generation when the exact Candidate regressed in Retention', async () => {
    const generation = generationFixture()
    const store = storeFixture(generation)
    const promotion = new FutureSessionPromotion({
      store,
      review: { scanAll: async () => ({ candidates: [reviewFixture()], warnings: [] }) },
      retention: { scan: async () => ({
        configuredRootCount: 1,
        warningCount: 0,
        runs: [retentionFixture('regressed')],
      }) },
    })

    await expect(promotion.promote(WORKSPACE_ID, GENERATION_ID))
      .rejects.toThrow('future-Session promotion blocked: retention-regressed')
    expect(store.promoteGeneration).not.toHaveBeenCalled()
  })

  it('promotes only the approved Generation bound to one exact retained verdict', async () => {
    const generation = generationFixture()
    const store = storeFixture(generation)
    const promotion = new FutureSessionPromotion({
      store,
      review: { scanAll: async () => ({ candidates: [reviewFixture()], warnings: [] }) },
      retention: { scan: async () => ({
        configuredRootCount: 1,
        warningCount: 0,
        runs: [retentionFixture('retained')],
      }) },
    })

    await expect(promotion.eligibility(WORKSPACE_ID, GENERATION_ID)).resolves.toEqual({
      status: 'eligible',
      reason: 'exact-retention-retained',
      generationId: GENERATION_ID,
      reviewId: 'a'.repeat(64),
      retentionId: 'f'.repeat(64),
    })
    await expect(promotion.promote(WORKSPACE_ID, GENERATION_ID)).resolves.toEqual({
      previousId: undefined,
      generation,
    })
    expect(store.promoteGeneration).toHaveBeenCalledOnce()
    expect(store.promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, GENERATION_ID, {
      authority: 'internal-retention',
      reviewId: 'a'.repeat(64),
      retentionId: 'f'.repeat(64),
    })
  })

  it('fails closed when a Retention run is projected without an owned configured root', async () => {
    const generation = generationFixture()
    const store = storeFixture(generation)
    const promotion = new FutureSessionPromotion({
      store,
      review: { scanAll: async () => ({ candidates: [reviewFixture()], warnings: [] }) },
      retention: { scan: async () => ({
        configuredRootCount: 0,
        warningCount: 0,
        runs: [retentionFixture('retained')],
      }) },
    })

    await expect(promotion.promote(WORKSPACE_ID, GENERATION_ID))
      .rejects.toThrow('future-Session promotion blocked: retention-evidence-invalid')
    expect(store.promoteGeneration).not.toHaveBeenCalled()
  })
})

function lineageFixture(): SkillCandidateLineage {
  return {
    kind: 'internal-skill-candidate-lineage-v3',
    candidateId: '4'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    opportunityId: '5'.repeat(64),
    evaluationEvidenceId: '6'.repeat(64),
    policyId: 'release-proof-author',
    versionKind: 'experience-authored-bundle-v1',
    contentHash: '7'.repeat(64),
    candidateTreeHash: CANDIDATE_TREE,
    admissionId: '8'.repeat(64),
    evaluationEnvelopeId: '9'.repeat(64),
    releaseAuthority: 'none',
  }
}

function reviewFixture(): ReviewCandidate {
  const lineage = lineageFixture()
  return {
    id: 'a'.repeat(64),
    workspaceId: WORKSPACE_ID,
    runId: 'b'.repeat(64),
    status: 'approved',
    outputDir: '/private/evolution/release-proof',
    skillName: lineage.skillName,
    recommendation: 'promote',
    claim: 'Preserve prior behavior.',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: CANDIDATE_TREE,
    baseTreeHash: BASE_TREE,
    baselineKind: 'capability-absent',
    proposalHash: 'c'.repeat(64),
    proposal: { claim: 'Preserve prior behavior.', files: [{ path: 'SKILL.md', content: 'proof\n' }] },
    cases: [{ id: 'holdout', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 10, outputTokens: 5, trialCount: 4 },
    reasons: ['held-out improvement'],
    limitations: ['bounded evidence'],
    evaluatorVersion: 'holdout-v1',
    compositionFingerprint: 'd'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-21T00:00:00.000Z',
    lineage,
    evidenceHash: 'e'.repeat(64),
    decisionActor: 'human',
    decisionNote: 'reviewed',
    generationId: GENERATION_ID,
  }
}

function retentionFixture(status: 'retained' | 'regressed'): InternalSkillRetentionRunView {
  const lineage = lineageFixture()
  return {
    id: 'f'.repeat(64),
    candidateId: lineage.candidateId,
    workspaceId: WORKSPACE_ID,
    skillName: lineage.skillName,
    admissionId: lineage.admissionId,
    evaluationEnvelopeId: lineage.evaluationEnvelopeId,
    shadowRunId: reviewFixture().runId,
    baselineTreeHash: BASE_TREE,
    candidateTreeHash: CANDIDATE_TREE,
    status,
    reason: status === 'retained'
      ? 'candidate-retained-prior-case'
      : 'candidate-regressed-prior-case',
    evidence: {
      retentionCasePackHash: '0'.repeat(64),
      baselineTreeHash: BASE_TREE,
      candidateTreeHash: CANDIDATE_TREE,
      baseline: 'pass',
      candidate: status === 'retained' ? 'pass' : 'fail',
      calibrationPassed: true,
      compositionStable: true,
      proposerCalls: 0,
      trialCount: 4,
    },
    releaseAuthority: 'none',
  }
}

function generationFixture(): CapabilityGeneration {
  const lineage = lineageFixture()
  return {
    id: GENERATION_ID,
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_787_270_400_000,
    artifacts: [{
      kind: 'skill-bundle',
      name: lineage.skillName,
      artifactDigest: lineage.contentHash,
      treeHash: lineage.candidateTreeHash,
      contentBase64: 'cHJvb2YK',
      lineage,
    }],
    evaluatorVersion: 'holdout-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'd'.repeat(64),
  }
}

function storeFixture(generation: CapabilityGeneration): EvolutionStore & {
  promoteGeneration: ReturnType<typeof vi.fn>
} {
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn((id: string) => id === generation.id ? generation : undefined),
    getActiveGeneration: vi.fn(() => undefined),
    promoteGeneration: vi.fn(async () => ({ previousId: undefined, generation })),
    rollbackGeneration: vi.fn(),
    listGenerationSelectionEvents: vi.fn(() => []),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
  }
}
