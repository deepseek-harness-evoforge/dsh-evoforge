import { describe, expect, it, vi } from 'vitest'
import {
  AUTO_PROMOTION_ACTOR,
  AutoPromotionService,
  type AutoPromotionPolicyResult,
} from '../src/auto-promotion.js'
import type { CandidatePublisher } from '../src/candidate-publisher.js'
import type { EvolutionStore } from '../src/generation-store.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('resident automatic promoter', () => {
  it('approves, publishes, and promotes an eligible pending Candidate', async () => {
    const candidate = fixtureCandidate()
    const generationId = '9'.repeat(64)
    const publisher = { publish: vi.fn(async () => ({ id: generationId })) } as unknown as CandidatePublisher
    const approve = vi.fn(async (_id, _note, publish, options) => {
      const generation = await publish(candidate)
      expect(options).toEqual({ actor: AUTO_PROMOTION_ACTOR })
      return {
        ...candidate,
        status: 'approved' as const,
        decisionActor: AUTO_PROMOTION_ACTOR,
        generationId: generation.id,
      }
    })
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [candidate], warnings: [] })),
      approve,
      markAutomaticActivated: vi.fn(async () => undefined),
    } as unknown as ReviewInbox
    const store = {
      promoteGeneration: vi.fn(async () => ({ previousId: undefined, generation: { id: generationId } })),
    } as unknown as EvolutionStore
    const policy = { evaluate: vi.fn(async () => eligible()) }
    const service = new AutoPromotionService({ inbox, policy, publisher, store })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toMatchObject({ promoted: [generationId], warnings: [] })
    expect(publisher.publish).toHaveBeenCalledWith(candidate, { policyVersion: AUTO_PROMOTION_ACTOR })
    expect(store.promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, generationId)
    expect(inbox.markAutomaticActivated).toHaveBeenCalledWith(candidate.id, generationId)
  })

  it('finishes promotion after a crash left an automatic approval inactive', async () => {
    const generationId = '8'.repeat(64)
    const approved = {
      ...fixtureCandidate(),
      status: 'approved' as const,
      decisionActor: AUTO_PROMOTION_ACTOR,
      generationId,
    }
    const publisher = { publish: vi.fn() } as unknown as CandidatePublisher
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [approved], warnings: [] })),
      approve: vi.fn(),
      markAutomaticActivated: vi.fn(async () => undefined),
    } as unknown as ReviewInbox
    const store = {
      promoteGeneration: vi.fn(async () => ({ previousId: undefined, generation: { id: generationId } })),
    } as unknown as EvolutionStore
    const service = new AutoPromotionService({
      inbox,
      policy: { evaluate: vi.fn(async () => eligible()) },
      publisher,
      store,
    })

    await service.scanOnce(WORKSPACE_ID)

    expect(inbox.approve).not.toHaveBeenCalled()
    expect(publisher.publish).not.toHaveBeenCalled()
    expect(store.promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, generationId)
    expect(inbox.markAutomaticActivated).toHaveBeenCalledWith(approved.id, generationId)
  })

  it('rechecks policy and does not activate an automatic approval whose Retention evidence regressed', async () => {
    const generationId = '8'.repeat(64)
    const approved = {
      ...fixtureCandidate(),
      status: 'approved' as const,
      decisionActor: AUTO_PROMOTION_ACTOR,
      generationId,
    }
    const policy = { evaluate: vi.fn(async () => ({
      eligible: false,
      policyVersion: AUTO_PROMOTION_ACTOR,
      reasons: ['an exact prior Case Pack proves baseline pass / Candidate fail'],
    })) }
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [approved], warnings: [] })),
      approve: vi.fn(),
      markAutomaticActivated: vi.fn(),
    } as unknown as ReviewInbox
    const store = { promoteGeneration: vi.fn() } as unknown as EvolutionStore
    const service = new AutoPromotionService({
      inbox,
      policy,
      publisher: { publish: vi.fn() } as unknown as CandidatePublisher,
      store,
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ promoted: [], warnings: [] })
    expect(policy.evaluate).toHaveBeenCalledWith(approved)
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(inbox.markAutomaticActivated).not.toHaveBeenCalled()
  })

  it('never activates ineligible, rejected, or human-approved Candidates', async () => {
    const candidates = [
      fixtureCandidate(),
      { ...fixtureCandidate(), id: '7'.repeat(64), status: 'rejected' as const, decisionActor: 'human' as const },
      {
        ...fixtureCandidate(),
        id: '6'.repeat(64),
        status: 'approved' as const,
        decisionActor: 'human' as const,
        generationId: '5'.repeat(64),
      },
    ]
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates, warnings: [] })),
      approve: vi.fn(),
      markAutomaticActivated: vi.fn(),
    } as unknown as ReviewInbox
    const store = { promoteGeneration: vi.fn() } as unknown as EvolutionStore
    const service = new AutoPromotionService({
      inbox,
      policy: { evaluate: vi.fn(async () => ({
        eligible: false,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['manual review required'],
      })) },
      publisher: { publish: vi.fn() } as unknown as CandidatePublisher,
      store,
    })

    await service.scanOnce(WORKSPACE_ID)

    expect(inbox.approve).not.toHaveBeenCalled()
    expect(store.promoteGeneration).not.toHaveBeenCalled()
  })
})

function eligible(): AutoPromotionPolicyResult {
  return {
    eligible: true,
    policyVersion: 'auto-clear-instruction-v1',
    reasons: ['clear win'],
  }
}

function fixtureCandidate(): ReviewCandidate {
  return {
    workspaceId: WORKSPACE_ID,
    id: '1'.repeat(64),
    runId: '2'.repeat(64),
    status: 'pending',
    outputDir: '/run',
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'append verification step',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: '3'.repeat(64),
    baseTreeHash: '4'.repeat(64),
    proposalHash: '5'.repeat(64),
    proposal: { claim: 'append verification step', files: [{ path: 'SKILL.md', content: 'body' }] },
    cases: [{ id: 'held-out', baseline: 'fail', candidate: 'pass', passedChecks: 2, totalChecks: 2 }],
    cost: { inputTokens: 10, outputTokens: 5, trialCount: 4 },
    reasons: ['clear win'],
    limitations: [],
    evaluatorVersion: 'fixture-v1',
    compositionFingerprint: '6'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '7'.repeat(64),
  }
}
