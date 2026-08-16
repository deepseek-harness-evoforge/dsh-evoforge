import { describe, expect, it, vi } from 'vitest'
import { EvolutionControlPlane } from '../src/evolution-control-plane.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'

const generationId = 'a'.repeat(64)
const parentId = 'b'.repeat(64)
const reviewId = 'c'.repeat(64)

function generation(id = generationId): CapabilityGeneration {
  return {
    id,
    schemaVersion: 1,
    parentId,
    createdAt: 1_786_896_000_000,
    artifacts: [{
      kind: 'skill',
      name: 'build-dsh-plugin',
      gitCommit: 'd'.repeat(40),
      treeHash: 'e'.repeat(40),
    }],
    evaluatorVersion: 'case-pack-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function candidate(status: ReviewCandidate['status'] = 'pending'): ReviewCandidate {
  return {
    id: reviewId,
    runId: 'run-1',
    status,
    outputDir: '/private/evolution/run-1',
    skillName: 'build-dsh-plugin',
    recommendation: 'review',
    claim: 'Continue safe authorized work after a progress update.',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: '1'.repeat(64),
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

function store(active: CapabilityGeneration | undefined = generation()): EvolutionStore {
  let current: CapabilityGeneration | undefined = active
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn(),
    getActiveGeneration: vi.fn(() => current),
    promoteGeneration: vi.fn(async (id: string) => {
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
    const control = new EvolutionControlPlane({
      store: store(),
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
        skills: () => ['build-dsh-plugin'],
        evaluate: vi.fn(async () => ({
          eligible: false,
          policyVersion: 'auto-clear-instruction-v1' as const,
          reasons: ['manual review'],
        })),
      },
      outcomes: { summarize: () => ({
        all: { total: 3, passed: 2, failed: 1, unknown: 0 },
        selected: { total: 2, passed: 2, failed: 0, unknown: 0 },
      }) },
      feedback: { summarize: () => ({ all: 4, selected: 1 }) },
    })

    const overview = await control.overview()
    expect(overview).toMatchObject({
      schemaVersion: 1,
      active: { id: generationId, rollbackTargetId: parentId },
      recovery: { available: true, paused: false },
      automaticPromotion: { enabled: true, skills: ['build-dsh-plugin'] },
      reviews: { available: true, pendingCount: 1, warningCount: 1 },
    })
    expect(overview.reviews.inactiveGenerations).toEqual([{
      generationId: '7'.repeat(64),
      reviewId: '6'.repeat(64),
      skillName: 'build-dsh-plugin',
    }])
    expect(overview.reviews.items[0]).toMatchObject({ id: reviewId, skillName: 'build-dsh-plugin' })

    const detail = await control.review(reviewId)
    expect(detail.diff.patch).toBe('-old\n+new\n')
    expect(detail.automatic?.eligible).toBe(false)
    expect(JSON.stringify({ overview, detail })).not.toContain('/private/evolution')
    expect(JSON.stringify({ overview, detail })).not.toContain('private content')
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

    const approval = await control.approveReview(reviewId, 'verified by a human')
    expect(approval).toEqual({
      schemaVersion: 1,
      action: 'approve-review',
      reviewId,
      generationId,
      status: 'approved',
    })
    expect(evolutionStore.promoteGeneration).not.toHaveBeenCalled()

    const promotion = await control.promote(generationId)
    expect(evolutionStore.promoteGeneration).toHaveBeenCalledWith(generationId)
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
      get: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(async () => rejected),
    }
    const evolutionStore = store()
    const control = new EvolutionControlPlane({
      store: evolutionStore,
      resident,
      review: { inbox, publisher: { preview: vi.fn(), publish: vi.fn() } },
    })

    await expect(control.pause()).resolves.toMatchObject({ action: 'pause', recoveryPaused: true })
    await expect(control.resume()).resolves.toMatchObject({ action: 'resume', recoveryPaused: false })
    await expect(control.rejectReview(reviewId, 'not enough evidence')).resolves.toMatchObject({
      action: 'reject-review', reviewId, status: 'rejected',
    })
    await expect(control.rollback()).resolves.toMatchObject({
      action: 'rollback', previousGenerationId: generationId,
    })
    expect(resident.pause).toHaveBeenCalledOnce()
    expect(resident.resume).toHaveBeenCalledOnce()
    expect(inbox.reject).toHaveBeenCalledWith(reviewId, 'not enough evidence')
  })
})
