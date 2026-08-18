/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { EvolutionAction } from '../src/client/EvolutionAction.tsx'
import { apply } from '../src/client/index.ts'
import type { EvolutionRemoteClient } from '../src/client/remote.ts'

afterEach(cleanup)

const reviewId = 'c'.repeat(64)
const generationId = 'a'.repeat(64)
const signalId = '8'.repeat(64)
const evaluatorDraftId = 'e'.repeat(64)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'
const sessionId = 'session-1'

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function remote(
  withActive = false,
  withInactive = false,
  evaluatorStatus: 'draft-ready' | 'incomplete' | 'qualified' = 'draft-ready',
  budgetStatus: 'ready' | 'unknown' = 'ready',
  expiryEligible = false,
): EvolutionRemoteClient {
  const overview = {
    schemaVersion: 1 as const,
    workspaceId,
    recovery: { available: true, paused: false },
    automaticPromotion: { enabled: false, skills: [] },
    automaticFeedbackBudget: {
      warningCount: 0,
      targets: [{
        workspaceId,
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        utcDay: '2026-08-17',
        used: budgetStatus === 'ready' ? 1 : 0,
        limit: 2,
        remaining: budgetStatus === 'ready' ? 1 : 0,
        status: budgetStatus,
      }],
    },
    automaticEvaluatorBudget: {
      warningCount: 0,
      targets: [{
        workspaceId,
        targetId: 'novel-failure',
        skillName: 'build-dsh-plugin',
        utcDay: '2026-08-17',
        used: 1,
        limit: 1,
        remaining: 0,
        status: 'ready' as const,
      }],
    },
    feedbackShadow: {
      available: true,
      warningCount: 0,
      signals: [{ workspaceId, id: signalId, sourceUpdatedAt: 1_786_896_000_000, generationId, eligibleTargetIds: ['plugin-delivery'] }],
      targets: [{ workspaceId, id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      runs: [],
    },
    evaluatorAuthoring: {
      available: true,
      actionableCount: 1,
      warningCount: 0,
      signals: [{ workspaceId, id: signalId, sourceUpdatedAt: 1_786_896_000_000, generationId, eligibleTargetIds: ['plugin-delivery'] }],
      targets: [{ workspaceId, id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      drafts: [{
        workspaceId,
        id: evaluatorDraftId,
        launchId: 'd'.repeat(64),
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        status: evaluatorStatus,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:01.000Z',
        cost: { modelCalls: 1 as const, inputTokens: 100, outputTokens: 50 },
      }],
    },
    reviews: {
      available: true,
      pendingCount: 1,
      actionableCount: 1,
      warningCount: 0,
      inactiveGenerations: withInactive
        ? [{ workspaceId, generationId, reviewId, skillName: 'build-dsh-plugin' }]
        : [],
      items: [{
        workspaceId,
        id: reviewId,
        status: 'pending' as const,
        recommendation: 'review' as const,
        skillName: 'build-dsh-plugin',
        claim: 'Continue safe work.',
        changedFiles: ['SKILL.md'],
        candidateTreeHash: '1'.repeat(64),
        cases: [{ id: 'case-1', baseline: 'fail' as const, candidate: 'pass' as const, passedChecks: 10, totalChecks: 10 }],
        cost: { inputTokens: 0, outputTokens: 0, trialCount: 1 },
        reasons: ['passed'],
        limitations: ['bounded case'],
        evaluatorVersion: 'case-pack-v1',
        compositionFingerprint: '2'.repeat(64),
        compositionStable: true,
        startedAt: '2026-08-16T00:00:00.000Z',
        automaticReviewExpiry: {
          eligibleAt: '2026-08-23T00:00:00.000Z',
          eligible: expiryEligible,
          trigger: 'next-same-skill-automatic-signal' as const,
        },
      }],
    },
  }
  if (withActive) Object.assign(overview, {
    active: {
      id: generationId,
      workspaceId,
      rollbackTargetId: 'b'.repeat(64),
      createdAt: 1_786_896_000_000,
      evaluatorVersion: 'case-pack-v1',
      policyVersion: 'human-review-v1',
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: 'f'.repeat(40),
        treeHash: '3'.repeat(64),
      }],
    },
    deliveryOutcomes: {
      all: { total: 6, passed: 3, failed: 2, unknown: 1 },
      selected: { total: 3, passed: 2, failed: 1, unknown: 0 },
      baseline: { total: 3, passed: 1, failed: 1, unknown: 1 },
    },
  })
  return {
    overview: vi.fn((requestedWorkspaceId: string) => success({
      ...overview,
      workspaceId: requestedWorkspaceId,
    })),
    review: vi.fn(() => success({
      schemaVersion: 1 as const,
      review: overview.reviews.items[0]!,
      diff: {
        patch: '-stop\n+continue\n',
        shownBytes: 16,
        totalBytes: 16,
        truncated: false,
        impact: { version: 'lexical-protected-effects-v1' as const, scope: 'append-only-skill' as const, indicators: [] },
      },
      automatic: { eligible: false, policyVersion: 'auto-clear-instruction-v1' as const, reasons: ['manual review'] },
    })),
    pause: vi.fn(() => success({ schemaVersion: 1 as const, workspaceId, action: 'pause' as const, recoveryPaused: true })),
    resume: vi.fn(() => success({ schemaVersion: 1 as const, workspaceId, action: 'resume' as const, recoveryPaused: false })),
    approveReview: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'approve-review' as const,
      reviewId,
      status: 'approved' as const,
      generationId,
    })),
    rejectReview: vi.fn(() => success({ schemaVersion: 1 as const, workspaceId, action: 'reject-review' as const, reviewId, status: 'rejected' as const })),
    promote: vi.fn(() => success({ schemaVersion: 1 as const, workspaceId, action: 'promote' as const, activeGenerationId: generationId })),
    rollback: vi.fn(() => success({ schemaVersion: 1 as const, workspaceId, action: 'rollback' as const, previousGenerationId: generationId })),
    startFeedbackShadow: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'start-shadow' as const,
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled' as const,
      jobId: 'evolution-1',
    })),
    evaluatorDraft: vi.fn(() => success({
      schemaVersion: 1 as const,
      draft: overview.evaluatorAuthoring.drafts[0]!,
      files: [
        { path: 'final-test/evaluator.mjs', content: 'process.stdout.write("bounded")\n' },
        { path: 'search/evidence.md', content: 'independent observable\n' },
      ],
      limitations: ['inactive until human qualification'],
      qualifiedShadowAvailable: true,
    })),
    authorEvaluator: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'author-evaluator' as const,
      launchId: 'd'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'scheduled' as const,
      jobId: 'evolution-2',
    })),
    approveEvaluator: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'approve-evaluator' as const,
      launchId: 'd'.repeat(64),
      draftId: evaluatorDraftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'qualified' as const,
    })),
    approveAndStartEvaluatorShadow: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'start-shadow' as const,
      launchId: '8'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled' as const,
      jobId: 'evolution-4',
    })),
    rejectEvaluator: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'reject-evaluator' as const,
      launchId: 'd'.repeat(64),
      draftId: evaluatorDraftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'rejected' as const,
    })),
    startEvaluatorShadow: vi.fn(() => success({
      schemaVersion: 1 as const,
      workspaceId,
      action: 'start-shadow' as const,
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled' as const,
      jobId: 'evolution-3',
    })),
  }
}

const t = (key: string) => ({
  'trigger.label': 'Evolution',
  'panel.title': 'Evolution control',
  'view.overview': 'Overview',
  'view.skills': 'Skills',
  'view.advanced': 'Advanced',
  'onboarding.idle': 'Nothing needs your attention',
  'onboarding.step.correct': 'Mark the assistant answer as problematic',
  'onboarding.step.correctHelp': 'Under the answer, select “Bad response”, then “Add a note”; explain what was wrong and the correct result, and save it.',
  'onboarding.verificationMissing': 'Corrections are available, but verification is not configured',
  'onboarding.verificationMissingHelp': 'You can still leave a correction under an answer. Until one bounded verification target is configured, EvoForge records feedback without pretending that evolution ran.',
  'onboarding.feedbackBlocked': 'A correction is recorded, but verification is not configured',
  'onboarding.feedbackBlockedHelp': 'Your correction remains safely in this Workspace. One bounded verification target must be configured before EvoForge can test a change.',
  'onboarding.feedbackIneligible': 'A correction is recorded, but this answer has no verifiable evolved Skill',
  'onboarding.feedbackIneligibleHelp': 'The answer came from native DSH or its evolved Skill does not match a configured target. The correction is retained and no invalid task is started.',
  'onboarding.feedbackReady': 'A recorded correction can be processed',
  'onboarding.feedbackReadyHelp': 'Open the advanced view to choose a configured verification path. Nothing changes in this Session.',
  'onboarding.processFeedback': 'Process recorded correction',
  'onboarding.recorded': 'recorded corrections',
  'skills.empty': 'No evolved Skills yet.',
  'skills.catalog': 'Session capability map',
  'skills.catalog.complete': 'Catalog observed',
  'skills.catalog.incomplete': 'Catalog incomplete',
  'skills.catalog.unobserved': 'Waiting for this Session to run',
  'skills.route.available': 'Available to DSH',
  'skills.route.model-selected': 'Selected automatically by the model',
  'skills.route.user-selected': 'Explicitly invoked by the user',
  'skills.version.provider-managed': 'Provider-managed',
  'skills.version.evolved-tree': 'Evolved version',
  'skills.gaps': 'Capability gap queue',
  'skills.gaps.empty': 'No confirmed capability gap.',
  'skills.gaps.confirmed': 'Confirmed by complete DSH catalog',
  'skills.gaps.catalog': 'Catalog evidence',
  'skills.gaps.inactive': 'No external Skill was installed or executed.',
  'skills.discovery': 'Discovered Skill candidates',
  'skills.discovery.quarantined': 'Quarantined candidate',
  'skills.discovery.source.local-git': 'Local Git',
  'skills.discovery.trust.explicit-deployer-config': 'Explicit deployer trust',
  'skills.discovery.version': 'Git commit',
  'skills.discovery.tree': 'tree',
  'skills.discovery.content': 'Content hash',
  'skills.discovery.package': 'Whole package',
  'skills.discovery.files': 'files',
  'skills.discovery.bytes': 'bytes',
  'skills.discovery.scripts': 'scripts',
  'skills.discovery.references': 'references',
  'skills.discovery.permissions.undeclared': 'Permissions not declared',
  'skills.discovery.permissions.declared': 'Permissions declared',
  'skills.discovery.executable': 'Executable content',
  'skills.discovery.effects.unknown': 'External effects unknown',
  'skills.discovery.state': 'Quarantined · Inactive · Never executed · Unevaluated',
  'skills.discovery.attempts': 'Discovery attempts',
  'skills.discovery.attempt.candidate-found': 'Candidate found',
  'skills.discovery.attempt.abstained': 'Discovery abstained',
  'skills.discovery.attempt.partial': 'Partial discovery',
  'skills.discovery.reason.no-trusted-sources': 'No trusted sources configured',
  'skills.discovery.reason.no-exact-skill': 'No exact Skill found',
  'skills.discovery.reason.invalid-skill-package': 'Invalid Skill package',
  'skills.discovery.reason.source-unavailable': 'Source unavailable',
  'skills.active': 'In use',
  'skills.ready': 'Verified, waiting to be enabled',
  'skills.reviewing': 'Waiting for review',
  'status.actions': 'Actionable',
  'action.refresh': 'Refresh',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.inspect': 'Inspect',
  'action.approve': 'Publish inactive',
  'action.reject': 'Reject',
  'action.promote': 'Promote',
  'action.rollback': 'Rollback',
  'action.startShadow': 'Start Shadow',
  'action.authorEvaluator': 'Author Evaluator',
  'action.inspectEvaluator': 'Inspect Evaluator',
  'action.approveEvaluator': 'Qualify Evaluator',
  'action.approveAndShadow': 'Qualify & start Shadow',
  'action.startQualifiedShadow': 'Start Qualified Shadow',
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'field.note': 'Decision note',
  'section.budget': 'Automatic evolution budget',
  'section.outcomes': 'Observed delivery outcomes',
  'label.attemptsUsed': 'attempts used',
  'label.remaining': 'remaining',
  'label.feedbackShadow': 'Feedback Shadow',
  'label.evaluatorDraft': 'Evaluator Draft',
  'label.reviewExpiry': 'Automatic review window',
  'review.expiryOpen': 'Open until',
  'review.expiryEligible': 'Expiry eligible since',
  'review.expiryTrigger': 'No background timer runs; rejection occurs only when the next same-Skill automatic Signal arrives.',
  'outcomes.active': 'Active',
  'outcomes.parent': 'Parent',
  'outcomes.total': 'total',
  'outcomes.passed': 'passed',
  'outcomes.failed': 'failed',
  'outcomes.unknown': 'unknown',
  'outcomes.disclaimer': 'Observed counts are descriptive; they do not prove that a Generation caused the difference.',
  'status.budgetUnknown': 'Budget state unknown; automatic launch is blocked',
  'error.workspaceRequired': 'Open a Session owned by a native Workspace first.',
}[key] ?? key)

function sessionHook(current: string | undefined = sessionId) {
  return <S,>(selector: (state: SessionListState) => S): S => selector({ current } as SessionListState)
}

function workspaceHook(id: string = workspaceId, current: string = sessionId) {
  return <S,>(selector: (state: WorkspaceListState) => S): S => selector({
    items: [{ workspaceId: id, sessionIds: [current] }],
  } as unknown as WorkspaceListState)
}

function renderEvolution(api: EvolutionRemoteClient) {
  return render(<EvolutionAction
    remote={api}
    t={t}
    wide
    useSessions={sessionHook()}
    useWorkspaces={workspaceHook()}
  />)
}

async function selectAdvanced() {
  fireEvent.click(await screen.findByRole('tab', { name: 'Advanced' }))
}

describe('EvolutionAction', () => {
  it('guides a first-time user before exposing evolution machinery', async () => {
    const api = remote()
    vi.mocked(api.overview).mockImplementationOnce(() => success({
      schemaVersion: 1,
      workspaceId,
      recovery: { available: true, paused: false },
      automaticPromotion: { enabled: false, skills: [] },
      reviews: {
        available: true,
        pendingCount: 0,
        actionableCount: 0,
        warningCount: 0,
        items: [],
        inactiveGenerations: [],
      },
    }))
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))

    expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Advanced' })).toBeTruthy()
    expect(screen.getByText('Corrections are available, but verification is not configured')).toBeTruthy()
    expect(screen.getByText(/without pretending that evolution ran/u)).toBeTruthy()
    expect(screen.getByText('Mark the assistant answer as problematic')).toBeTruthy()
    expect(screen.getByText(/select “Bad response”, then “Add a note”/u)).toBeTruthy()
    expect(screen.queryByText(/Generation|Shadow|Evaluator/)).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(screen.getByText('No evolved Skills yet.')).toBeTruthy()
  })

  it('does not hide a recorded correction when verification targets are missing', async () => {
    const api = remote()
    vi.mocked(api.overview).mockImplementationOnce(() => success({
      schemaVersion: 1,
      workspaceId,
      recovery: { available: true, paused: false },
      automaticPromotion: { enabled: false, skills: [] },
      feedbackSignals: { all: 1, selected: 1 },
      reviews: {
        available: true,
        pendingCount: 0,
        actionableCount: 0,
        warningCount: 0,
        items: [],
        inactiveGenerations: [],
      },
    }))
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))

    expect(await screen.findByText('A correction is recorded, but verification is not configured')).toBeTruthy()
    expect(screen.getByText(/must be configured before EvoForge can test/u)).toBeTruthy()
    expect(screen.getByText('recorded corrections').parentElement?.textContent).toBe('1recorded corrections')
    expect(screen.queryByText('Nothing needs your attention')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Process recorded correction' })).toBeNull()
  })

  it('routes a recorded correction with configured targets to the existing advanced controls', async () => {
    const api = remote()
    const configured = remote()
    vi.mocked(api.overview).mockImplementationOnce(async (requestedWorkspaceId: string) => {
      const result = await configured.overview(requestedWorkspaceId)
      if (!result.ok) return result
      return success({
        ...result.value,
        reviews: {
          ...result.value.reviews,
          pendingCount: 0,
          actionableCount: 0,
          items: [],
        },
        evaluatorAuthoring: {
          ...result.value.evaluatorAuthoring!,
          actionableCount: 0,
          drafts: [],
        },
      })
    })
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    expect(await screen.findByText('A recorded correction can be processed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Process recorded correction' }))

    expect(screen.getByRole('tab', { name: 'Advanced' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: /^Start Shadow/u })).toBeTruthy()
  })

  it('does not offer a target that the Host marks ineligible for native feedback', async () => {
    const api = remote()
    const configured = remote()
    vi.mocked(api.overview).mockImplementationOnce(async (requestedWorkspaceId: string) => {
      const result = await configured.overview(requestedWorkspaceId)
      if (!result.ok) return result
      const nativeSignal = {
        workspaceId,
        id: signalId,
        sourceUpdatedAt: 1_786_896_000_000,
        eligibleTargetIds: [],
      }
      return success({
        ...result.value,
        feedbackSignals: { all: 1, selected: 1 },
        feedbackShadow: { ...result.value.feedbackShadow!, signals: [nativeSignal] },
        evaluatorAuthoring: {
          ...result.value.evaluatorAuthoring!,
          actionableCount: 0,
          signals: [nativeSignal],
          drafts: [],
        },
        reviews: {
          ...result.value.reviews,
          pendingCount: 0,
          actionableCount: 0,
          items: [],
        },
      })
    })
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    expect(await screen.findByText('A correction is recorded, but this answer has no verifiable evolved Skill')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Process recorded correction' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    expect(screen.queryByRole('button', { name: /^Start Shadow/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Author Evaluator/u })).toBeNull()
  })

  it('projects active, approved, and reviewing Skill states without another catalog', async () => {
    const api = remote(true, true)
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Skills' }))

    expect(screen.getByText('In use')).toBeTruthy()
    expect(screen.getByText('Verified, waiting to be enabled')).toBeTruthy()
    expect(screen.getByText('Waiting for review')).toBeTruthy()
    expect(screen.getAllByText('build-dsh-plugin')).toHaveLength(3)
    expect(api.overview).toHaveBeenCalledTimes(1)
  })

  it('explains the exact Session capability map without offering a route menu', async () => {
    const api = remote()
    const configured = remote()
    vi.mocked(api.overview).mockImplementationOnce(async (requestedWorkspaceId, requestedSessionId) => {
      const result = await configured.overview(requestedWorkspaceId, requestedSessionId)
      if (!result.ok) return result
      return success({
        ...result.value,
        capabilityMap: {
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
        },
        capabilityGaps: {
          confirmedCount: 1,
          items: [{
            id: '5'.repeat(64),
            observedAt: 1_786_896_000_000,
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
          }],
        },
        skillDiscovery: {
          quarantinedCount: 1,
          candidates: [{
            id: '7'.repeat(64),
            discoveredAt: 1_786_896_000_100,
            gapId: '5'.repeat(64),
            requestedSkill: 'missing-release-skill',
            description: 'Prepare and verify a native DSH release.',
            source: {
              id: 'local-curated',
              kind: 'local-git' as const,
              trust: 'explicit-deployer-config' as const,
            },
            scope: 'workspace' as const,
            version: {
              kind: 'git-tree' as const,
              commit: '8'.repeat(40),
              treeHash: '9'.repeat(40),
            },
            contentHash: 'a'.repeat(64),
            package: {
              path: 'skills/missing-release-skill',
              fileCount: 3,
              totalBytes: 640,
              hasScripts: true,
              hasReferences: true,
            },
            permissions: {
              declared: false,
              executableContent: true,
              externalEffects: 'unknown' as const,
            },
            safety: {
              status: 'quarantined' as const,
              checks: [
                { name: 'git-object-integrity' as const, status: 'passed' as const },
                { name: 'regular-files-only' as const, status: 'passed' as const },
                { name: 'skill-identity' as const, status: 'passed' as const },
                { name: 'effect-review' as const, status: 'required' as const },
              ],
            },
            lifecycle: 'inactive' as const,
            verification: 'unevaluated' as const,
            execution: 'never' as const,
          }],
          attempts: [{
            id: 'b'.repeat(64),
            gapId: '5'.repeat(64),
            requestedSkill: 'missing-release-skill',
            startedAt: 1_786_896_000_000,
            completedAt: 1_786_896_000_100,
            status: 'candidate-found' as const,
            candidateIds: ['7'.repeat(64)],
            reasons: [],
            sources: [{
              id: 'local-curated',
              status: 'candidate' as const,
              revision: '8'.repeat(40),
            }],
          }, {
            id: 'c'.repeat(64),
            gapId: 'd'.repeat(64),
            requestedSkill: 'another-missing-skill',
            startedAt: 1_786_896_000_200,
            completedAt: 1_786_896_000_200,
            status: 'abstained' as const,
            candidateIds: [],
            reasons: ['no-trusted-sources' as const],
            sources: [],
          }],
        },
      })
    })
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Skills' }))

    expect(screen.getByText('Session capability map')).toBeTruthy()
    expect(screen.getByText('Catalog observed')).toBeTruthy()
    expect(screen.getByText('Selected automatically by the model')).toBeTruthy()
    expect(screen.getByText('project-agents · filesystem')).toBeTruthy()
    expect(screen.getByText(`Evolved version · ${'e'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText('Capability gap queue')).toBeTruthy()
    expect(screen.getAllByText('missing-release-skill').length).toBeGreaterThan(1)
    expect(screen.getByText('Publish a verified native DSH plugin.')).toBeTruthy()
    expect(screen.getByText('Confirmed by complete DSH catalog')).toBeTruthy()
    expect(screen.getByText('No external Skill was installed or executed.')).toBeTruthy()
    expect(screen.getByText('Discovered Skill candidates')).toBeTruthy()
    expect(screen.getByText('Prepare and verify a native DSH release.')).toBeTruthy()
    expect(screen.getByText('Quarantined candidate')).toBeTruthy()
    expect(screen.getByText('local-curated · Local Git · Explicit deployer trust')).toBeTruthy()
    expect(screen.getByText(`Git commit · ${'8'.repeat(12)} · tree ${'9'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText(`Content hash · ${'a'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText('Whole package · 3 files · 640 bytes · scripts · references')).toBeTruthy()
    expect(screen.getByText('Permissions not declared · Executable content · External effects unknown')).toBeTruthy()
    expect(screen.getByText('Quarantined · Inactive · Never executed · Unevaluated')).toBeTruthy()
    expect(screen.getByText('Discovery attempts')).toBeTruthy()
    expect(screen.getByText('Candidate found')).toBeTruthy()
    expect(screen.getByText('No trusted sources configured')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /build-dsh-plugin/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /install|activate|missing-release-skill/u })).toBeNull()
  })

  it('fails closed when the current Session is not owned by a native Workspace', async () => {
    const api = remote()
    render(<EvolutionAction
      remote={api}
      t={t}
      wide
      useSessions={sessionHook()}
      useWorkspaces={selector => selector({
        items: [{ workspaceId: otherWorkspaceId, sessionIds: [] }],
        recentWorkspaceId: otherWorkspaceId,
      } as unknown as WorkspaceListState)}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Open a Session owned by a native Workspace first.',
    )
    expect(api.overview).not.toHaveBeenCalled()
  })

  it('rebinds the panel to the exact Workspace of the newly selected Session', async () => {
    const api = remote()
    const view = render(<EvolutionAction
      remote={api}
      t={t}
      wide
      useSessions={sessionHook()}
      useWorkspaces={workspaceHook()}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await waitFor(() => expect(api.overview).toHaveBeenCalledWith(workspaceId, sessionId))

    view.rerender(<EvolutionAction
      remote={api}
      t={t}
      wide
      useSessions={sessionHook()}
      useWorkspaces={workspaceHook(otherWorkspaceId)}
    />)

    await waitFor(() => expect(api.overview).toHaveBeenCalledWith(otherWorkspaceId, sessionId))
    expect(api.overview).toHaveBeenCalledTimes(2)
  })

  it('rejects a control-plane response owned by another Workspace', async () => {
    const api = remote()
    vi.mocked(api.overview).mockImplementationOnce(() => success({
      schemaVersion: 1,
      workspaceId: otherWorkspaceId,
      recovery: { available: false },
      automaticPromotion: { enabled: false, skills: [] },
      reviews: {
        available: true,
        pendingCount: 0,
        actionableCount: 0,
        warningCount: 0,
        items: [],
        inactiveGenerations: [],
      },
    }))
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Workspace authority mismatch')
  })

  it('loads only when opened, exposes the bounded review, and keeps approval separate from promotion', async () => {
    const api = remote()
    renderEvolution(api)
    expect(api.overview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog', { name: 'Evolution control' })
    await selectAdvanced()
    expect(api.overview).toHaveBeenCalledWith(workspaceId, sessionId)
    expect(within(screen.getByRole('button', { name: 'Evolution' })).getByText('2')).toBeTruthy()
    expect(screen.getByText('Actionable')).toBeTruthy()
    expect(screen.getByText('Feedback Shadow · plugin-delivery · build-dsh-plugin')).toBeTruthy()
    expect(screen.getByText('1/2 attempts used · 1 remaining · 2026-08-17 UTC')).toBeTruthy()
    expect(screen.getByText('Evaluator Draft · novel-failure · build-dsh-plugin')).toBeTruthy()
    expect(screen.getByText('1/1 attempts used · 0 remaining · 2026-08-17 UTC')).toBeTruthy()
    expect(screen.getByText('Open until · 2026-08-23T00:00:00.000Z')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent?.includes('-stop') === true)
    expect(api.review).toHaveBeenCalledWith(workspaceId, reviewId)
    expect(screen.getByText('Continue safe work.')).toBeTruthy()
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(screen.getByText('passed')).toBeTruthy()
    expect(screen.getByText('bounded case')).toBeTruthy()
    expect(screen.getAllByText('label.tokens')).toHaveLength(1)
    expect(screen.getByText('Automatic review window')).toBeTruthy()
    expect(screen.getByText(
      'Open until 2026-08-23T00:00:00.000Z. No background timer runs; rejection occurs only when the next same-Skill automatic Signal arrives.',
    )).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'checked evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish inactive' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith(workspaceId, reviewId, 'checked evidence'))
    await waitFor(() => expect(screen.queryByLabelText('Decision note')).toBeNull())
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('requires confirmation for rollback and refreshes after a durable action', async () => {
    const api = remote(true)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    expect(api.rollback).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.rollback).toHaveBeenCalledOnce())
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2))
  })

  it('shows active and parent delivery outcomes without making a causal claim', async () => {
    const api = remote(true)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await selectAdvanced()

    expect(await screen.findByText('Observed delivery outcomes')).toBeTruthy()
    expect(screen.getByText(/Active · aaaaaaaa… · 3 total · 2 passed · 1 failed · 0 unknown/)).toBeTruthy()
    expect(screen.getByText(/Parent · bbbbbbbb… · 3 total · 1 passed · 1 failed · 1 unknown/)).toBeTruthy()
    expect(screen.getByText(
      'Observed counts are descriptive; they do not prove that a Generation caused the difference.',
    )).toBeTruthy()
  })

  it('explains that automatic launch is blocked when the budget journal is unknown', async () => {
    const api = remote(false, false, 'draft-ready', 'unknown')
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await selectAdvanced()

    expect(await screen.findByText('Budget state unknown; automatic launch is blocked')).toBeTruthy()
  })

  it('keeps an expiry-eligible review actionable and explains the next-Signal trigger', async () => {
    const api = remote(false, false, 'draft-ready', 'ready', true)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await selectAdvanced()

    expect(await screen.findByText('Expiry eligible since · 2026-08-23T00:00:00.000Z')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(await screen.findByText(
      'Expiry eligible since 2026-08-23T00:00:00.000Z. No background timer runs; rejection occurs only when the next same-Skill automatic Signal arrives.',
    )).toBeTruthy()
  })

  it('refreshes the currently inspected review from host authority without polling', async () => {
    const api = remote()
    const eligibleResult = await remote(false, false, 'draft-ready', 'ready', true).review(workspaceId, reviewId)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    await screen.findByText(
      'Open until 2026-08-23T00:00:00.000Z. No background timer runs; rejection occurs only when the next same-Skill automatic Signal arrives.',
    )
    vi.mocked(api.review).mockResolvedValueOnce(eligibleResult)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(
      'Expiry eligible since 2026-08-23T00:00:00.000Z. No background timer runs; rejection occurs only when the next same-Skill automatic Signal arrives.',
    )).toBeTruthy()
    expect(api.review).toHaveBeenCalledTimes(2)
  })

  it('shows the authoritative failure when a listed review expires before inspection', async () => {
    const api = remote()
    vi.mocked(api.review).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'not_found',
        message: 'Candidate was already rejected by the automatic review expiry policy; refresh authoritative state.',
        details: {},
      },
    })
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Candidate was already rejected by the automatic review expiry policy; refresh authoritative state.',
    )
  })

  it('can promote a durably approved inactive Generation after the panel is reopened', async () => {
    const api = remote(false, true)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    fireEvent.click(await screen.findByRole('button', { name: 'Promote' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.promote).toHaveBeenCalledWith(workspaceId, generationId))
  })

  it('requires explicit confirmation before starting a paid feedback Shadow', async () => {
    const api = remote()
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    fireEvent.click(await screen.findByRole('button', { name: 'Start Shadow · plugin-delivery' }))
    expect(api.startFeedbackShadow).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.startFeedbackShadow).toHaveBeenCalledWith(workspaceId, signalId, 'plugin-delivery'))
  })

  it('keeps paid evaluator authoring cancellable and qualification behind a second confirmation', async () => {
    const api = remote()
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    fireEvent.click(await screen.findByRole('button', { name: 'Author Evaluator · plugin-delivery' }))
    expect(api.authorEvaluator).not.toHaveBeenCalled()
    let confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.authorEvaluator).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Author Evaluator · plugin-delivery' }))
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.authorEvaluator).toHaveBeenCalledWith(workspaceId, signalId, 'plugin-delivery'))

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))
    await screen.findByText('final-test/evaluator.mjs')
    expect(api.evaluatorDraft).toHaveBeenCalledWith(workspaceId, evaluatorDraftId)
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'independent semantics reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qualify Evaluator' }))
    expect(api.approveEvaluator).not.toHaveBeenCalled()
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.approveEvaluator).toHaveBeenCalledWith(
      workspaceId,
      evaluatorDraftId,
      'independent semantics reviewed',
    ))
    expect(api.startFeedbackShadow).not.toHaveBeenCalled()
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('allows only local sealed qualification to be retried for an incomplete exact draft', async () => {
    const api = remote(false, false, 'incomplete')
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))
    await screen.findByText('final-test/evaluator.mjs')
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'retry exact local qualification' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qualify Evaluator' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(api.approveEvaluator).toHaveBeenCalledWith(
      workspaceId,
      evaluatorDraftId,
      'retry exact local qualification',
    ))
    expect(api.authorEvaluator).not.toHaveBeenCalled()
  })

  it('requires a fresh paid-disclosure confirmation before a Qualified Pack enters Shadow', async () => {
    const api = remote(false, false, 'qualified')
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Start Qualified Shadow' }))
    let confirmation = await screen.findByRole('alertdialog')
    expect(api.startEvaluatorShadow).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.startEvaluatorShadow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start Qualified Shadow' }))
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.startEvaluatorShadow).toHaveBeenCalledWith(workspaceId, evaluatorDraftId))
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('combines human qualification and contingent paid Shadow behind one cancellable confirmation', async () => {
    const api = remote()
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))
    await screen.findByText('final-test/evaluator.mjs')
    fireEvent.change(screen.getByLabelText('Decision note'), {
      target: { value: 'reviewed exact evaluator and authorize paid Shadow' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Qualify & start Shadow' }))
    let confirmation = await screen.findByRole('alertdialog')
    expect(api.approveAndStartEvaluatorShadow).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.approveAndStartEvaluatorShadow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Qualify & start Shadow' }))
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.approveAndStartEvaluatorShadow).toHaveBeenCalledWith(
      workspaceId,
      evaluatorDraftId,
      'reviewed exact evaluator and authorize paid Shadow',
    ))
    expect(api.approveEvaluator).not.toHaveBeenCalled()
    expect(api.startEvaluatorShadow).not.toHaveBeenCalled()
    expect(api.promote).not.toHaveBeenCalled()
  })
})

describe('client plugin lifecycle', () => {
  it('mounts one Remote and binds its unmount to the plugin lifecycle', async () => {
    const api = remote()
    const unmount = vi.fn(async () => {})
    const effectNames: string[] = []
    const disposers: Array<() => void | Promise<void>> = []
    let installSlot: (() => unknown) | undefined
    const registerSlot = vi.fn(() => vi.fn())
    const context = {
      remote: {
        $mount: vi.fn(async () => unmount),
        evoforgeEvolution: api,
      },
      locale: {
        register: vi.fn(() => vi.fn()),
      },
      slots: {
        inject: vi.fn((_name: string, install: () => unknown) => {
          installSlot = install
        }),
        register: registerSlot,
      },
      effect: vi.fn((install: () => (() => void | Promise<void>) | undefined, name: string) => {
        effectNames.push(name)
        const dispose = install()
        if (dispose !== undefined) disposers.push(dispose)
      }),
      inject: vi.fn((_services: string[], install: (scope: unknown) => void) => install(context)),
    }

    await apply(context as never)
    expect(context.remote.$mount).toHaveBeenCalledOnce()
    expect(context.inject).toHaveBeenCalledWith(
      ['remote.evoforgeEvolution'],
      expect.any(Function),
    )
    expect(effectNames).toEqual([
      'dsh-evolve-web.remote',
      'dsh-evolve-web.locale',
      'dsh-evolve-web.style',
    ])
    expect(context.slots.inject).toHaveBeenCalledWith(
      'sidebar.footer.action',
      expect.any(Function),
    )
    installSlot?.()
    expect(registerSlot).toHaveBeenCalledWith(expect.objectContaining({
      id: 'evoforge-evolution',
      order: 30,
    }), EvolutionAction)

    for (const dispose of disposers.reverse()) await dispose()
    expect(unmount).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-plugin-css="dsh-evolve-web"]')).toBeNull()
  })
})
