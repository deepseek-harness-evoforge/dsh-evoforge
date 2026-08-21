import { describe, expect, it, vi } from 'vitest'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import {
  executeEvolutionCommand as executeNativeEvolutionCommand,
  type EvolutionCommandModules,
} from '../src/evolve-command.js'
import type { CandidatePublisher } from '../src/candidate-publisher.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'
import type { DeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'
import type { SkillUseStore } from '../src/skill-use-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const USAGE = 'Usage: /evolve [status|feedback [<signal-id>]|review [<review-id> [approve|reject <note>]]|existing [<candidate-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|promote-existing <candidate-id>|rollback [<64-char-canary-id>]]'
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

  it('reviews and promotes an exact existing-Skill Candidate through its separate Host gate', async () => {
    const candidateId = 'd'.repeat(64)
    const eligibility = {
      status: 'eligible' as const,
      reason: 'exact-existing-skill-evidence-retained' as const,
      candidateId,
      admissionId: '3'.repeat(64),
      holdoutEvaluationId: '4'.repeat(64),
      retentionEvaluationId: '5'.repeat(64),
    }
    const decision = {
      schemaVersion: 1 as const,
      kind: 'existing-skill-release-decision-v1' as const,
      id: '6'.repeat(64),
      candidateId,
      workspaceId: WORKSPACE_ID,
      skillName: 'shared-skill',
      status: 'approved' as const,
      actor: 'human' as const,
      decisionNote: 'Exact diff reviewed.',
      decidedAt: '2026-08-21T00:00:00.000Z',
      evidenceHash: '7'.repeat(64),
      admissionId: eligibility.admissionId,
      holdoutEvaluationId: eligibility.holdoutEvaluationId,
      retentionEvaluationId: eligibility.retentionEvaluationId,
      generationId: childId,
    }
    const existingRelease = {
      scan: vi.fn(async () => [eligibility]),
      eligibility: vi.fn(async () => eligibility),
      approve: vi.fn(async () => decision),
      reject: vi.fn(),
      promote: vi.fn(async () => ({
        previousId: undefined,
        generation: generation(childId),
      })),
    }

    await expect(executeEvolutionCommand(fakeStore(), 'existing', { existingRelease }))
      .resolves.toMatchObject({
        kind: 'success',
        text: expect.stringContaining(`${candidateId} [eligible]`),
      })
    await expect(executeEvolutionCommand(
      fakeStore(),
      `existing ${candidateId} approve Exact diff reviewed.`,
      { existingRelease },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`Inactive Generation: ${childId}`),
    })
    await expect(executeEvolutionCommand(
      fakeStore(),
      `promote-existing ${candidateId}`,
      { existingRelease },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Existing Skill Generation promoted for future Sessions.'),
    })
    expect(existingRelease.approve).toHaveBeenCalledWith(
      WORKSPACE_ID,
      candidateId,
      'Exact diff reviewed.',
    )
    expect(existingRelease.promote).toHaveBeenCalledWith(WORKSPACE_ID, candidateId)
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
    const skillUses = {
      summarize: vi.fn(() => ({
        all: { useCount: 5, goalCount: 4, skillVersionCount: 3, crossGoalSkillVersionCount: 1 },
        selected: { useCount: 4, goalCount: 3, skillVersionCount: 2, crossGoalSkillVersionCount: 1 },
        baseline: { useCount: 1, goalCount: 1, skillVersionCount: 1, crossGoalSkillVersionCount: 0 },
        items: [],
      })),
    } as unknown as SkillUseStore
    const skillOutcomeContext = {
      summarize: vi.fn(() => ({
        all: commandOutcomeContextRollup(),
        selected: commandOutcomeContextRollup(),
        baseline: commandOutcomeContextRollup({ empty: true }),
        items: [],
      })),
    }

    const status = await executeEvolutionCommand(
      fakeStore(generation(rootId, childId)),
      'status',
      { outcomes, skillUses, skillOutcomeContext },
    )
    expect(status).toMatchObject({
      kind: 'success',
      text: expect.stringContaining(
        `Parent selection outcomes (${childId}): 2 total (0 passed, 1 failed, 1 unknown)`,
      ),
    })
    expect(status.text).toContain('Exact Skill reuse: 5 uses across 4 Goals; 1 cross-Goal versions')
    expect(status.text).toContain('Active selection reuse: 4 uses across 3 Goals; 1 cross-Goal versions')
    expect(status.text).toContain('Reuse is descriptive and grants no Candidate or promotion authority.')
    expect(status.text).toContain(
      'Exact Skill outcome context: 1 versions; 2/3 Goal contexts observed; 3 attempts; 1 repeated; 1 recovered; 0 ambiguous latest.',
    )
    expect(status.text).toContain('Latest durable outcomes: 1 passed, 0 failed, 1 unknown.')
    expect(status.text).toContain(
      'Between-attempt work: 1 ordered transitions; 1 measured; 0 unmeasured; 0 ambiguous Goal orders.',
    )
    expect(status.text).toContain(
      'Outcome context is temporal and non-causal; it grants no Candidate or promotion authority.',
    )

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

function commandOutcomeContextRollup(options: { empty?: boolean } = {}) {
  const value = options.empty === true ? 0 : 1
  return {
    skillVersionCount: value,
    goalContextCount: value * 3,
    outcomeObservedGoalContextCount: value * 2,
    outcomeUnobservedGoalContextCount: value,
    outcomeAttemptCount: value * 3,
    repeatedOutcomeGoalContextCount: value,
    recoveredGoalContextCount: value,
    ambiguousLatestGoalContextCount: 0,
    betweenAttempts: {
      transitionCount: value,
      ambiguousOrderGoalContextCount: 0,
      metrics: {
        measured: value,
        unmeasured: 0,
        attributedTurns: value,
        closedSteps: value,
        activeWallMs: value,
        providerUsage: {
          uncachedInputTokens: value,
          outputTokens: value,
          cacheReadTokens: value,
          cacheWriteTokens: value,
        },
        latency: {
          llmMs: value,
          toolMs: value,
          ttftMs: value,
          ttftSteps: value,
          decodeMs: value,
          decodeTokens: value,
        },
        monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
      },
    },
    latest: { passed: value, failed: 0, unknown: value },
    metrics: {
      measured: value * 2,
      unmeasured: 0,
      attributedTurns: value * 2,
      closedSteps: value * 2,
      activeWallMs: value * 2,
      providerUsage: {
        uncachedInputTokens: value * 2,
        outputTokens: value * 2,
        cacheReadTokens: value * 2,
        cacheWriteTokens: value * 2,
      },
      latency: {
        llmMs: value * 2,
        toolMs: value * 2,
        ttftMs: value * 2,
        ttftSteps: value * 2,
        decodeMs: value * 2,
        decodeTokens: value * 2,
      },
      monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
    },
  }
}

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
