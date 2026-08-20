import { describe, expect, it, vi } from 'vitest'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import {
  executeEvolutionCommand as executeNativeEvolutionCommand,
  type EvolutionCommandModules,
} from '../src/evolve-command.js'
import type { CandidatePublisher } from '../src/candidate-publisher.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'
import type { DeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const USAGE = 'Usage: /evolve [status|feedback [<signal-id>]|review [<review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback [<64-char-canary-id>]]'
const rootId = '1'.repeat(64)
const childId = '2'.repeat(64)

function executeEvolutionCommand(
  store: EvolutionStore,
  rawInput: string,
  modules: EvolutionCommandModules = {},
) {
  return executeNativeEvolutionCommand(store, rawInput, modules, WORKSPACE_ID)
}

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

  it('quarantines legacy artifacts in status instead of exposing repository coordinates', async () => {
    const store = fakeStore(generation(rootId))

    await expect(executeEvolutionCommand(store, 'status')).resolves.toEqual({
      kind: 'success',
      text: [
        'Evolution status',
        `Active: ${rootId}`,
        'Rollback target: native DSH',
        'Artifacts:',
        `- quarantined legacy artifact stable-skill tree ${'a'.repeat(64)}`,
        'Existing Sessions keep their pinned Generation.',
        '',
        'Commands: /evolve rollback',
      ].join('\n'),
    })
  })

  it('lists internal feedback evidence without offering a target-selection workflow', async () => {
    const signal = {
      schemaVersion: 2 as const,
      workspaceId: WORKSPACE_ID,
      id: 'f'.repeat(64),
      observedAt: 3,
      sessionId: 'session-private',
      messageId: 'message-private',
      feedbackVersion: 'version-private',
      sourceUpdatedAt: 2,
      generationId: rootId,
    }
    const feedback = {
      list: vi.fn(() => [signal]),
      summarize: vi.fn(() => ({ all: 1, selected: 1 })),
    }

    await expect(executeEvolutionCommand(fakeStore(), 'feedback', { feedback }))
      .resolves.toMatchObject({
        kind: 'success',
        text: expect.stringContaining(`- ${signal.id} [${rootId}] Session session-private`),
      })
    await expect(executeEvolutionCommand(fakeStore(), `feedback ${signal.id}`, { feedback }))
      .resolves.toMatchObject({
        kind: 'success',
        text: expect.stringContaining('is evidence for asynchronous opportunity discovery'),
      })
    await expect(executeEvolutionCommand(fakeStore(), `feedback ${signal.id} draft`, { feedback }))
      .resolves.toEqual({ kind: 'error', text: USAGE })
  })

  it('promotes only full content ids for future Sessions and rolls back precisely', async () => {
    const root = generation(rootId)
    const promoteGeneration = vi.fn(async () => ({ previousId: undefined, generation: root }))
    const store = fakeStore(undefined, { promoteGeneration })
    const promotion = {
      promote: (workspaceId: string, id: string) => store.promoteGeneration(workspaceId, id),
    }
    const rollback = {
      rollback: vi.fn(async (_workspaceId: string, options: { canaryId?: string } = {}) => ({
        previousId: rootId,
        generation: undefined,
        authority: options.canaryId === undefined
          ? 'explicit-human' as const
          : 'counterfactual-canary' as const,
        ...(options.canaryId === undefined ? {} : { canaryId: options.canaryId }),
      })),
    }

    await expect(executeEvolutionCommand(store, `promote ${rootId}`, { promotion })).resolves.toEqual({
      kind: 'success',
      text: [
        'Generation promoted for future Sessions.',
        'Previous: native DSH',
        `Active: ${rootId}`,
        'Existing Sessions were not changed.',
        'Rollback: /evolve rollback',
      ].join('\n'),
    })
    expect(promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, rootId)

    await expect(executeEvolutionCommand(store, `rollback ${childId}`, { rollback })).resolves.toEqual({
      kind: 'success',
      text: [
        'Generation rolled back for future Sessions.',
        `Previous: ${rootId}`,
        'Active: native DSH',
        `Authority: exact counterfactual Canary ${childId}`,
        'Existing Sessions were not changed.',
      ].join('\n'),
    })
    expect(rollback.rollback).toHaveBeenCalledWith(WORKSPACE_ID, { canaryId: childId })
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('fails closed when future-Session rollback governance is unavailable', async () => {
    const store = fakeStore(generation(rootId))

    await expect(executeEvolutionCommand(store, 'rollback')).resolves.toEqual({
      kind: 'error',
      text: 'Evolution action failed: future-Session rollback gate is not configured',
    })
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('fails closed when future-Session promotion governance is unavailable', async () => {
    const promoteGeneration = vi.fn(async () => ({
      previousId: undefined,
      generation: generation(rootId),
    }))
    const store = fakeStore(undefined, { promoteGeneration })

    await expect(executeEvolutionCommand(store, `promote ${rootId}`)).resolves.toEqual({
      kind: 'error',
      text: 'Evolution action failed: future-Session promotion eligibility is not configured',
    })
    expect(promoteGeneration).not.toHaveBeenCalled()
  })

  it('rejects ambiguous ids and removed target/evaluator actions without touching release state', async () => {
    const store = fakeStore()

    for (const input of [
      'promote',
      'promote abc',
      `promote ${rootId} extra`,
      `feedback ${'f'.repeat(64)} shadow selected-target`,
      'evaluator',
      'unknown',
    ]) {
      await expect(executeEvolutionCommand(store, input)).resolves.toEqual({
        kind: 'error',
        text: USAGE,
      })
    }
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('lists, explains, rejects, and publishes exact Bundle reviews through the host plane', async () => {
    const store = fakeStore()
    const candidate = reviewCandidate()
    const inbox = {
      scan: vi.fn(async () => ({ candidates: [candidate], warnings: [] })),
      get: vi.fn(async () => candidate),
      reject: vi.fn(async () => ({ ...candidate, status: 'rejected' as const })),
      approve: vi.fn(async (_id, _note, publish) => {
        const published = await publish(candidate)
        return { ...candidate, status: 'approved' as const, generationId: published.id }
      }),
    } as unknown as ReviewInbox
    const publisher = {
      preview: vi.fn(async () => ({
        patch: 'diff --git a/SKILL.md b/SKILL.md\nnew file mode 100644\n',
        shownBytes: 60,
        totalBytes: 60,
        truncated: false,
        impact: {
          version: 'lexical-protected-effects-v1',
          scope: 'new-skill',
          indicators: ['production-change'],
        },
      })),
      publish: vi.fn(async () => ({ id: childId })),
    } as unknown as CandidatePublisher
    const review = { inbox, publisher }

    await expect(executeEvolutionCommand(store, 'review', { review })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`${candidate.id} [promote] release-proof: ${candidate.claim}`),
    })
    const detail = await executeEvolutionCommand(store, `review ${candidate.id}`, { review })
    expect(detail).toMatchObject({
      kind: 'success',
      text: expect.stringContaining(
        'Verified diff (sealed capability-absent baseline → exact Candidate Bundle; controls escaped; 60 bytes):',
      ),
    })
    expect(detail.text).toContain('Protected-effect projection (lexical-protected-effects-v1; lexical only): scope new-skill; indicators production-change')
    expect(publisher.preview).toHaveBeenCalledWith(candidate)

    await expect(executeEvolutionCommand(
      store,
      `review ${candidate.id} reject too narrow`,
      { review },
    )).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('No Generation was created') })
    await expect(executeEvolutionCommand(
      store,
      `review ${candidate.id} approve clear held-out win`,
      { review },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`/evolve promote ${childId}`),
    })
    expect(publisher.publish).toHaveBeenCalledWith(candidate)
  })

  it('durably pauses and resumes resident recovery', async () => {
    let paused = false
    const resident = {
      isPaused: vi.fn(() => paused),
      pause: vi.fn(async () => { paused = true }),
      resume: vi.fn(async () => { paused = false }),
    }
    const store = fakeStore()

    await expect(executeEvolutionCommand(store, 'pause', { resident })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('paused durably'),
    })
    await expect(executeEvolutionCommand(store, 'status', { resident })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Resident recovery: paused'),
    })
    await expect(executeEvolutionCommand(store, 'resume', { resident })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('recovery resumed'),
    })
  })

  it('shows compact delivery evidence and returns actionable host errors', async () => {
    const outcomes = {
      summarize: vi.fn(() => ({
        all: { total: 4, passed: 2, failed: 1, unknown: 1 },
        selected: { total: 2, passed: 2, failed: 0, unknown: 0 },
        baseline: { total: 2, passed: 0, failed: 1, unknown: 1 },
      })),
    } as unknown as DeliveryOutcomeStore

    await expect(executeEvolutionCommand(
      fakeStore(generation(rootId, childId)),
      'status',
      { outcomes },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(
        `Parent selection outcomes (${childId}): 2 total (0 passed, 1 failed, 1 unknown)`,
      ),
    })

    const store = fakeStore(undefined, {
      promoteGeneration: vi.fn(async () => { throw new Error(`Generation '${rootId}' does not exist`) }),
    })
    const promotion = {
      promote: (workspaceId: string, id: string) => store.promoteGeneration(workspaceId, id),
    }
    await expect(executeEvolutionCommand(store, `promote ${rootId}`, { promotion })).resolves.toEqual({
      kind: 'error',
      text: `Evolution action failed: Generation '${rootId}' does not exist`,
    })
  })
})

function generation(id: string, parentId?: string): CapabilityGeneration {
  return {
    id,
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
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
    workspaceId: WORKSPACE_ID,
    runId: 'b'.repeat(64),
    status: 'pending',
    outputDir: '/private/run',
    skillName: 'release-proof',
    recommendation: 'promote',
    claim: 'Add exact browser verification',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: 'c'.repeat(64),
    baseTreeHash: 'd'.repeat(64),
    baselineKind: 'capability-absent',
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
