import { describe, expect, it, vi } from 'vitest'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import { executeEvolutionCommand } from '../src/evolve-command.js'
import type { CandidatePublisher } from '../src/candidate-publisher.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'
import type { AutoPromotionPolicy } from '../src/auto-promotion.js'
import type { DeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'

const rootId = '1'.repeat(64)
const childId = '2'.repeat(64)

describe('/evolve host command', () => {
  it('shows native status without invoking a model or creating state', async () => {
    const store = fakeStore()

    await expect(executeEvolutionCommand(store, '')).resolves.toEqual({
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
        'Future Sessions will use native capabilities.',
        '',
        'Commands: /evolve promote <64-char-generation-id>',
      ].join('\n'),
    })
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('explains the active immutable Generation and exact rollback target', async () => {
    const root = generation(rootId)
    const store = fakeStore(root)

    const result = await executeEvolutionCommand(store, 'status')

    expect(result).toEqual({
      kind: 'success',
      text: [
        'Evolution status',
        `Active: ${rootId}`,
        'Rollback target: native DSH',
        'Artifacts:',
        `- skill stable-skill tree ${'a'.repeat(64)} commit ${'b'.repeat(40)}`,
        'Existing Sessions keep their pinned Generation.',
        '',
        'Commands: /evolve rollback',
      ].join('\n'),
    })
  })

  it('promotes a full content id only for future Sessions and is idempotent', async () => {
    const root = generation(rootId)
    const promoteGeneration = vi.fn<
      (id: string) => Promise<{ previousId: string | undefined; generation: CapabilityGeneration }>
    >(async () => ({ previousId: undefined, generation: root }))
    const store = fakeStore(undefined, { promoteGeneration })

    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toEqual({
      kind: 'success',
      text: [
        'Generation promoted for future Sessions.',
        'Previous: native DSH',
        `Active: ${rootId}`,
        'Existing Sessions were not changed.',
        `Rollback: /evolve rollback`,
      ].join('\n'),
    })
    expect(promoteGeneration).toHaveBeenCalledWith(rootId)

    promoteGeneration.mockResolvedValue({ previousId: rootId, generation: root })
    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toMatchObject({
      kind: 'success',
      text: `Generation ${rootId} is already active. Existing Sessions remain pinned.`,
    })
  })

  it('rolls a child to its parent and a root to native DSH', async () => {
    const root = generation(rootId)
    const child = generation(childId, rootId)
    const rollbackGeneration = vi.fn()
      .mockResolvedValueOnce({ previousId: childId, generation: root })
      .mockResolvedValueOnce({ previousId: rootId, generation: undefined })
    const store = fakeStore(child, { rollbackGeneration })

    await expect(executeEvolutionCommand(store, 'rollback')).resolves.toMatchObject({
      kind: 'success',
      text: [
        'Generation rolled back for future Sessions.',
        `Previous: ${childId}`,
        `Active: ${rootId}`,
        'Existing Sessions were not changed.',
      ].join('\n'),
    })
    await expect(executeEvolutionCommand(store, 'rollback')).resolves.toMatchObject({
      kind: 'success',
      text: [
        'Generation rolled back for future Sessions.',
        `Previous: ${rootId}`,
        'Active: native DSH',
        'Existing Sessions were not changed.',
      ].join('\n'),
    })
  })

  it('rejects ambiguous ids and unknown actions without touching release state', async () => {
    const store = fakeStore()

    for (const input of ['promote', 'promote abc', `promote ${rootId} extra`, 'unknown']) {
      await expect(executeEvolutionCommand(store, input)).resolves.toMatchObject({
        kind: 'error',
        text: 'Usage: /evolve [status|review [<review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]',
      })
    }
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('lists, explains, rejects, and publishes reviews through the host plane', async () => {
    const store = fakeStore()
    const candidate = reviewCandidate()
    const inbox = {
      scan: vi.fn(async () => ({ candidates: [candidate], warnings: [] })),
      get: vi.fn(async () => candidate),
      reject: vi.fn(async () => ({ ...candidate, status: 'rejected' as const })),
      approve: vi.fn(async (_id, _note, publish) => {
        const generation = await publish(candidate)
        return { ...candidate, status: 'approved' as const, generationId: generation.id }
      }),
    } as unknown as ReviewInbox
    const publisher = {
      publish: vi.fn(async () => ({ id: childId })),
    } as unknown as CandidatePublisher
    const review = { inbox, publisher }
    const automatic = {
      skills: vi.fn(() => ['stable-skill']),
      evaluate: vi.fn(async () => ({
        eligible: false,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['instruction change mentions a protected effect'],
      })),
    } as unknown as AutoPromotionPolicy

    await expect(executeEvolutionCommand(store, 'review', review)).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`${candidate.id} [promote] stable-skill`),
    })
    await expect(executeEvolutionCommand(
      store,
      `review ${candidate.id}`,
      review,
      undefined,
      automatic,
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Automatic policy: manual review — instruction change mentions a protected effect'),
    })
    await expect(executeEvolutionCommand(
      store,
      `review ${candidate.id} reject too narrow`,
      review,
    )).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('No Generation was created') })
    await expect(executeEvolutionCommand(
      store,
      `review ${candidate.id} approve clear held-out win`,
      review,
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`/evolve promote ${childId}`),
    })
    expect(publisher.publish).toHaveBeenCalledWith(candidate)
  })

  it('does not invent a review store when no owned run roots are configured', async () => {
    await expect(executeEvolutionCommand(fakeStore(), 'review')).resolves.toEqual({
      kind: 'error',
      text: 'Review inbox is not configured. Set dsh-evolve supervisor.runRoots to owned Shadow run roots.',
    })
  })

  it('durably pauses and resumes resident recovery without invoking release state', async () => {
    let paused = false
    const resident = {
      isPaused: vi.fn(() => paused),
      pause: vi.fn(async () => { paused = true }),
      resume: vi.fn(async () => { paused = false }),
    }
    const store = fakeStore()

    await expect(executeEvolutionCommand(store, 'pause', undefined, resident)).resolves.toEqual({
      kind: 'success',
      text: 'Resident evolution recovery paused durably. Active recovery was stopped; normal Sessions and human review remain available.',
    })
    await expect(executeEvolutionCommand(store, 'status', undefined, resident)).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Resident recovery: paused'),
    })
    await expect(executeEvolutionCommand(store, 'resume', undefined, resident)).resolves.toEqual({
      kind: 'success',
      text: 'Resident evolution recovery resumed. Durable Candidate/Trial discovery was awakened.',
    })
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('shows the explicit automatic Skill allowlist in host-only status', async () => {
    const automatic = {
      skills: vi.fn(() => ['stable-skill']),
      evaluate: vi.fn(),
    } as unknown as AutoPromotionPolicy

    await expect(executeEvolutionCommand(
      fakeStore(),
      'status',
      undefined,
      undefined,
      automatic,
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Automatic promotion: auto-clear-instruction-v1 (stable-skill)'),
    })
  })

  it('shows only compact delivery outcome counts on the host status plane', async () => {
    const outcomes = {
      summarize: vi.fn(() => ({
        all: { total: 4, passed: 2, failed: 1, unknown: 1 },
        selected: { total: 2, passed: 2, failed: 0, unknown: 0 },
      })),
    } as unknown as DeliveryOutcomeStore

    await expect(executeEvolutionCommand(
      fakeStore(generation(rootId)),
      'status',
      undefined,
      undefined,
      undefined,
      outcomes,
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining([
        'Delivery outcomes: 4 total (2 passed, 1 failed, 1 unknown)',
        `Active selection outcomes (${rootId}): 2 total (2 passed, 0 failed, 0 unknown)`,
      ].join('\n')),
    })
    expect(outcomes.summarize).toHaveBeenCalledWith(rootId)
  })

  it('returns an actionable host error instead of throwing an implementation stack', async () => {
    const store = fakeStore(undefined, {
      promoteGeneration: vi.fn(async () => { throw new Error(`Generation '${rootId}' does not exist`) }),
    })

    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toEqual({
      kind: 'error',
      text: `Evolution action failed: Generation '${rootId}' does not exist`,
    })
  })
})

function generation(id: string, parentId?: string): CapabilityGeneration {
  return {
    id,
    schemaVersion: 1,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill',
      name: 'stable-skill',
      gitCommit: 'b'.repeat(40),
      treeHash: 'a'.repeat(64),
    }],
    evaluatorVersion: 'fixture',
    policyVersion: 'human-p0c.1',
    compositionFingerprint: 'c'.repeat(64),
  }
}

function reviewCandidate(): ReviewCandidate {
  return {
    id: 'a'.repeat(64),
    runId: 'b'.repeat(64),
    status: 'pending',
    outputDir: '/private/run',
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'Add exact browser verification',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: 'c'.repeat(64),
    baseTreeHash: 'd'.repeat(64),
    proposalHash: 'e'.repeat(64),
    proposal: { claim: 'Add exact browser verification', files: [{ path: 'SKILL.md', content: 'body' }] },
    cases: [{ id: 'held-out', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 120, outputTokens: 32, trialCount: 4 },
    reasons: ['held-out pass'],
    limitations: ['one case'],
    evaluatorVersion: 'fixture-v1',
    compositionFingerprint: 'f'.repeat(64),
    compositionStable: false,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '1'.repeat(64),
  }
}

function fakeStore(
  active?: CapabilityGeneration,
  overrides: Partial<EvolutionStore> = {},
): EvolutionStore & {
  promoteGeneration: ReturnType<typeof vi.fn>
  rollbackGeneration: ReturnType<typeof vi.fn>
} {
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn(),
    getActiveGeneration: vi.fn(() => active),
    promoteGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as unknown as EvolutionStore & {
    promoteGeneration: ReturnType<typeof vi.fn>
    rollbackGeneration: ReturnType<typeof vi.fn>
  }
}
