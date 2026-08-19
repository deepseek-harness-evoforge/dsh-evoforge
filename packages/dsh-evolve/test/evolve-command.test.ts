import { describe, expect, it, vi } from 'vitest'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import {
  executeEvolutionCommand as executeNativeEvolutionCommand,
  type EvolutionCommandModules,
} from '../src/evolve-command.js'
import type { CandidatePublisher } from '../src/candidate-publisher.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'
import type { AutoPromotionPolicy } from '../src/auto-promotion.js'
import type { DeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

function executeEvolutionCommand(
  store: EvolutionStore,
  rawInput: string,
  modules: EvolutionCommandModules = {},
) {
  return executeNativeEvolutionCommand(store, rawInput, modules, WORKSPACE_ID)
}

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

  it('shows host-only explicit feedback counts for the active selection', async () => {
    const store = fakeStore(generation(rootId))
    const feedback = {
      list: vi.fn(() => []),
      summarize: vi.fn(() => ({ all: 5, selected: 2 })),
    }

    const result = await executeEvolutionCommand(
      store,
      'status',
      { feedback },
    )

    expect(result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Explicit feedback signals: 5 retained (2 active selection)'),
    })
    expect(feedback.summarize).toHaveBeenCalledWith(WORKSPACE_ID, rootId)
  })

  it('shows the durable automatic evolution budget without a model call', async () => {
    const automaticFeedback = {
      budgetStatus: vi.fn(async () => ({
        warningCount: 0,
        targets: [{
          targetId: 'stable-target',
          workspaceId: WORKSPACE_ID,
          skillName: 'stable-skill',
          utcDay: '2026-08-17',
          used: 1,
          limit: 2,
          remaining: 1,
          status: 'ready' as const,
        }],
      })),
    }
    const automaticEvaluator = {
      budgetStatus: vi.fn(async () => ({
        warningCount: 0,
        targets: [{
          targetId: 'novel-failure',
          workspaceId: WORKSPACE_ID,
          skillName: 'stable-skill',
          utcDay: '2026-08-17',
          used: 1,
          limit: 1,
          remaining: 0,
          status: 'ready' as const,
        }],
      })),
    }

    const result = await executeEvolutionCommand(
      fakeStore(),
      'status',
      { automaticFeedback, automaticEvaluator },
    )

    expect(result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining(
        'Automatic evolution budget (Feedback Shadow): stable-target 1/2 attempts used on 2026-08-17 UTC (1 remaining)',
      ),
    })
    expect(result.text).toContain(
      'Automatic evolution budget (Evaluator Draft): novel-failure 1/1 attempts used on 2026-08-17 UTC (0 remaining)',
    )
    expect(automaticFeedback.budgetStatus).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(automaticEvaluator.budgetStatus).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  it('lists opaque feedback references and delegates explicit draft creation', async () => {
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
    const feedbackDraft = {
      create: vi.fn(async () => ({
        created: true,
        draft: { id: childId, target: { name: 'stable-skill' } },
        path: '/private/draft.json',
      })),
    }

    await expect(executeEvolutionCommand(fakeStore(), 'feedback', { feedback }))
      .resolves.toMatchObject({
        kind: 'success',
        text: expect.stringContaining(`- ${signal.id} [${rootId}] Session session-private`),
      })
    await expect(executeEvolutionCommand(
      fakeStore(),
      `feedback ${signal.id} draft`,
      { feedback, feedbackDraft: feedbackDraft as never },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Skill: stable-skill (derived from the exact durable invocation).'),
    })
    expect(feedbackDraft.create).toHaveBeenCalledWith(WORKSPACE_ID, signal.id)
  })

  it('does not create a draft without explicit private-root composition', async () => {
    const id = 'f'.repeat(64)
    const feedback = {
      list: vi.fn(() => []),
      summarize: vi.fn(() => ({ all: 0, selected: 0 })),
    }

    await expect(executeEvolutionCommand(
      fakeStore(),
      `feedback ${id} draft`,
      { feedback },
    )).resolves.toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Feedback Case Draft creation is disabled.'),
    })
  })

  it('submits an explicitly confirmed feedback Shadow without waiting for completion', async () => {
    const id = 'f'.repeat(64)
    const feedbackShadow = {
      launch: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        workspaceId: WORKSPACE_ID,
        launchId: childId,
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        runStatus: 'scheduled' as const,
        jobId: 'evolution-1',
      })),
    }

    await expect(executeEvolutionCommand(
      fakeStore(),
      `feedback ${id} shadow stable-skill`,
      { feedbackShadow },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('submitted as native Job evolution-1'),
    })
    expect(feedbackShadow.launch).toHaveBeenCalledWith(WORKSPACE_ID, id, 'stable-skill')
  })

  it('authors and reviews evaluator drafts through a separate human qualification inbox', async () => {
    const signalId = 'f'.repeat(64)
    const draftId = 'e'.repeat(64)
    const evaluatorDrafts = {
      author: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'author-evaluator' as const,
        launchId: childId,
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        draftStatus: 'scheduled' as const,
        jobId: 'evolution-2',
      })),
      scan: vi.fn(async () => ({
        warningCount: 0,
        drafts: [{
          id: draftId,
          launchId: childId,
          targetId: 'stable-skill',
          skillName: 'stable-skill',
          status: 'draft-ready' as const,
          createdAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:01.000Z',
          cost: { modelCalls: 1 as const, inputTokens: 30, outputTokens: 20 },
        }],
      })),
      get: vi.fn(async () => ({
        id: draftId,
        launchId: childId,
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        status: 'draft-ready' as const,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:01.000Z',
        cost: { modelCalls: 1 as const, inputTokens: 30, outputTokens: 20 },
        files: [{ path: 'search/evidence.md', content: 'bounded evidence' }],
        limitations: ['not executable before approval'],
        qualifiedShadowAvailable: true,
      })),
      approve: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'approve-evaluator' as const,
        launchId: childId,
        draftId,
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        draftStatus: 'qualified' as const,
      })),
      approveAndStartShadow: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        launchId: '8'.repeat(64),
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        runStatus: 'scheduled' as const,
        jobId: 'evolution-4',
      })),
      reject: vi.fn(),
      startShadow: vi.fn(async () => ({
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        launchId: '9'.repeat(64),
        targetId: 'stable-skill',
        skillName: 'stable-skill',
        runStatus: 'scheduled' as const,
        jobId: 'evolution-3',
      })),
    }

    await expect(executeEvolutionCommand(
      fakeStore(),
      `feedback ${signalId} author stable-skill`,
      { evaluatorDrafts: evaluatorDrafts as never },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('submitted as native Job evolution-2'),
    })
    expect(evaluatorDrafts.author).toHaveBeenCalledWith(WORKSPACE_ID, signalId, 'stable-skill')

    await expect(executeEvolutionCommand(fakeStore(), 'evaluator', { evaluatorDrafts: evaluatorDrafts as never }))
      .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining(draftId) })
    await expect(executeEvolutionCommand(fakeStore(), `evaluator ${draftId}`, { evaluatorDrafts: evaluatorDrafts as never }))
      .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('bounded evidence') })
    await expect(executeEvolutionCommand(
      fakeStore(),
      `evaluator ${draftId} approve independently reviewed`,
      { evaluatorDrafts: evaluatorDrafts as never },
    )).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('Qualified Case Pack') })
    expect(evaluatorDrafts.approve).toHaveBeenCalledWith(WORKSPACE_ID, draftId, 'independently reviewed')
    await expect(executeEvolutionCommand(
      fakeStore(),
      `evaluator ${draftId} shadow`,
      { evaluatorDrafts: evaluatorDrafts as never },
    )).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('evolution-3') })
    expect(evaluatorDrafts.startShadow).toHaveBeenCalledWith(WORKSPACE_ID, draftId)
    await expect(executeEvolutionCommand(
      fakeStore(),
      `evaluator ${draftId} qualify-shadow independently reviewed and paid Shadow authorized`,
      { evaluatorDrafts: evaluatorDrafts as never },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('evolution-4'),
    })
    expect(evaluatorDrafts.approveAndStartShadow).toHaveBeenCalledWith(
      WORKSPACE_ID,
      draftId,
      'independently reviewed and paid Shadow authorized',
    )
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
    expect(promoteGeneration).toHaveBeenCalledWith(WORKSPACE_ID, rootId)

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
      text: 'Usage: /evolve [status|feedback [<signal-id> [draft|shadow <target>|author <evaluator-target>]]|evaluator [<draft-id> [shadow|qualify-shadow <note>|approve|reject <note>]]|review [<review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]',
      })
    }
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('lists, explains, rejects, and publishes reviews through the host plane', async () => {
    const store = fakeStore()
    const candidate: ReviewCandidate = {
      ...reviewCandidate(),
      recommendation: 'review',
      automaticReviewExpiry: {
        eligibleAt: '2026-08-23T00:00:00.000Z',
        eligible: false,
        trigger: 'next-same-skill-automatic-signal',
      },
    }
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
      preview: vi.fn(async () => ({
        patch: [
          'diff --git a/SKILL.md b/SKILL.md',
          '--- a/SKILL.md',
          '+++ b/SKILL.md',
          '@@ -1 +1 @@',
          '-old body',
          '+new body',
          '',
        ].join('\n'),
        shownBytes: 107,
        totalBytes: 107,
        truncated: false,
        impact: {
          version: 'lexical-protected-effects-v1',
          scope: 'append-only-skill',
          indicators: ['production-change'],
        },
      })),
      publish: vi.fn(async () => ({ id: childId })),
    } as unknown as CandidatePublisher
    const review = { inbox, publisher }
    const automatic = {
      skills: vi.fn((workspaceId: string) => workspaceId === WORKSPACE_ID ? ['stable-skill'] : []),
      evaluate: vi.fn(async () => ({
        eligible: false,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['instruction change mentions a protected effect'],
      })),
    } as unknown as AutoPromotionPolicy

    await expect(executeEvolutionCommand(store, 'review', { review })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(
        `${candidate.id} [review] stable-skill: ${candidate.claim} — automatic review window until 2026-08-23T00:00:00.000Z`,
      ),
    })
    const detail = await executeEvolutionCommand(
      store,
      `review ${candidate.id}`,
      { review, automatic },
    )
    expect(detail).toMatchObject({
      kind: 'success',
      text: expect.stringContaining([
        'Protected-effect projection (lexical-protected-effects-v1; lexical only): scope append-only-skill; indicators production-change',
        'DSH Approval remains authoritative; no lexical indicator is a safety proof.',
        'Verified diff (exact Git baseline → sealed Candidate; controls escaped; 107 bytes):',
        'diff --git a/SKILL.md b/SKILL.md',
        '--- a/SKILL.md',
        '+++ b/SKILL.md',
        '@@ -1 +1 @@',
        '-old body',
        '+new body',
        'Automatic policy: manual review — instruction change mentions a protected effect',
      ].join('\n')),
    })
    expect(detail.text).toContain(
      'Automatic review expiry: open until 2026-08-23T00:00:00.000Z; after that, the next same-Skill automatic Signal rejects this Candidate.',
    )
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

    await expect(executeEvolutionCommand(store, 'pause', { resident })).resolves.toEqual({
      kind: 'success',
      text: 'Resident evolution recovery paused durably. Active recovery was stopped; normal Sessions and human review remain available.',
    })
    await expect(executeEvolutionCommand(store, 'status', { resident })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('Resident recovery: paused'),
    })
    await expect(executeEvolutionCommand(store, 'resume', { resident })).resolves.toEqual({
      kind: 'success',
      text: 'Resident evolution recovery resumed. Durable Candidate/Trial discovery was awakened.',
    })
    expect(store.promoteGeneration).not.toHaveBeenCalled()
    expect(store.rollbackGeneration).not.toHaveBeenCalled()
  })

  it('shows the explicit automatic Skill allowlist in host-only status', async () => {
    const automatic = {
      skills: vi.fn((workspaceId: string) => workspaceId === WORKSPACE_ID ? ['stable-skill'] : []),
      evaluate: vi.fn(),
    } as unknown as AutoPromotionPolicy

    await expect(executeEvolutionCommand(
      fakeStore(),
      'status',
      { automatic },
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
        baseline: { total: 2, passed: 0, failed: 1, unknown: 1 },
      })),
    } as unknown as DeliveryOutcomeStore

    await expect(executeEvolutionCommand(
      fakeStore(generation(rootId, childId)),
      'status',
      { outcomes },
    )).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining([
        'Delivery outcomes: 4 total (2 passed, 1 failed, 1 unknown)',
        `Active selection outcomes (${rootId}): 2 total (2 passed, 0 failed, 0 unknown)`,
        `Parent selection outcomes (${childId}): 2 total (0 passed, 1 failed, 1 unknown)`,
        'Observed delivery counts are descriptive; they do not prove that a Generation caused the difference.',
      ].join('\n')),
    })
    expect(outcomes.summarize).toHaveBeenCalledWith(
      WORKSPACE_ID,
      rootId,
      { baselineGenerationId: childId },
    )
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
