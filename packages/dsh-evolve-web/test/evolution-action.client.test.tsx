/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvolutionAction } from '../src/client/EvolutionAction.tsx'
import { apply } from '../src/client/index.ts'
import type { EvolutionRemoteClient } from '../src/client/remote.ts'

afterEach(cleanup)

const reviewId = 'c'.repeat(64)
const generationId = 'a'.repeat(64)
const signalId = '8'.repeat(64)
const evaluatorDraftId = 'e'.repeat(64)

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function remote(
  withActive = false,
  withInactive = false,
  evaluatorStatus: 'draft-ready' | 'incomplete' | 'qualified' = 'draft-ready',
  budgetStatus: 'ready' | 'unknown' = 'ready',
): EvolutionRemoteClient {
  const overview = {
    schemaVersion: 1 as const,
    recovery: { available: true, paused: false },
    automaticPromotion: { enabled: false, skills: [] },
    automaticFeedbackBudget: {
      warningCount: 0,
      targets: [{
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        utcDay: '2026-08-17',
        used: budgetStatus === 'ready' ? 1 : 0,
        limit: 2,
        remaining: budgetStatus === 'ready' ? 1 : 0,
        status: budgetStatus,
      }],
    },
    feedbackShadow: {
      available: true,
      warningCount: 0,
      signals: [{ id: signalId, sourceUpdatedAt: 1_786_896_000_000, generationId }],
      targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      runs: [],
    },
    evaluatorAuthoring: {
      available: true,
      warningCount: 0,
      signals: [{ id: signalId, sourceUpdatedAt: 1_786_896_000_000, generationId }],
      targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      drafts: [{
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
        ? [{ generationId, reviewId, skillName: 'build-dsh-plugin' }]
        : [],
      items: [{
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
      }],
    },
  }
  if (withActive) Object.assign(overview, {
    active: {
      id: generationId,
      rollbackTargetId: 'b'.repeat(64),
      createdAt: 1_786_896_000_000,
      evaluatorVersion: 'case-pack-v1',
      policyVersion: 'human-review-v1',
      artifacts: [],
    },
  })
  return {
    overview: vi.fn(() => success(overview)),
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
    pause: vi.fn(() => success({ schemaVersion: 1 as const, action: 'pause' as const, recoveryPaused: true })),
    resume: vi.fn(() => success({ schemaVersion: 1 as const, action: 'resume' as const, recoveryPaused: false })),
    approveReview: vi.fn(() => success({
      schemaVersion: 1 as const,
      action: 'approve-review' as const,
      reviewId,
      status: 'approved' as const,
      generationId,
    })),
    rejectReview: vi.fn(() => success({ schemaVersion: 1 as const, action: 'reject-review' as const, reviewId, status: 'rejected' as const })),
    promote: vi.fn(() => success({ schemaVersion: 1 as const, action: 'promote' as const, activeGenerationId: generationId })),
    rollback: vi.fn(() => success({ schemaVersion: 1 as const, action: 'rollback' as const, previousGenerationId: generationId })),
    startFeedbackShadow: vi.fn(() => success({
      schemaVersion: 1 as const,
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
      action: 'author-evaluator' as const,
      launchId: 'd'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'scheduled' as const,
      jobId: 'evolution-2',
    })),
    approveEvaluator: vi.fn(() => success({
      schemaVersion: 1 as const,
      action: 'approve-evaluator' as const,
      launchId: 'd'.repeat(64),
      draftId: evaluatorDraftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'qualified' as const,
    })),
    rejectEvaluator: vi.fn(() => success({
      schemaVersion: 1 as const,
      action: 'reject-evaluator' as const,
      launchId: 'd'.repeat(64),
      draftId: evaluatorDraftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'rejected' as const,
    })),
    startEvaluatorShadow: vi.fn(() => success({
      schemaVersion: 1 as const,
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
  'action.startQualifiedShadow': 'Start Qualified Shadow',
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'field.note': 'Decision note',
  'section.budget': 'Automatic evolution budget',
  'label.attemptsUsed': 'attempts used',
  'label.remaining': 'remaining',
  'status.budgetUnknown': 'Budget state unknown; automatic launch is blocked',
}[key] ?? key)

describe('EvolutionAction', () => {
  it('loads only when opened, exposes the bounded review, and keeps approval separate from promotion', async () => {
    const api = remote()
    render(<EvolutionAction remote={api} t={t} />)
    expect(api.overview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog', { name: 'Evolution control' })
    expect(api.overview).toHaveBeenCalledOnce()
    expect(screen.getByText('1/2 attempts used · 1 remaining · 2026-08-17 UTC')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent?.includes('-stop') === true)
    expect(api.review).toHaveBeenCalledWith(reviewId)
    expect(screen.getByText('Continue safe work.')).toBeTruthy()
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(screen.getByText('passed')).toBeTruthy()
    expect(screen.getByText('bounded case')).toBeTruthy()
    expect(screen.getAllByText('label.tokens')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'checked evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish inactive' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.approveReview).toHaveBeenCalledWith(reviewId, 'checked evidence'))
    await waitFor(() => expect(screen.queryByLabelText('Decision note')).toBeNull())
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('requires confirmation for rollback and refreshes after a durable action', async () => {
    const api = remote(true)
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }))
    expect(api.rollback).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.rollback).toHaveBeenCalledOnce())
    await waitFor(() => expect(api.overview).toHaveBeenCalledTimes(2))
  })

  it('explains that automatic launch is blocked when the budget journal is unknown', async () => {
    const api = remote(false, false, 'draft-ready', 'unknown')
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))

    expect(await screen.findByText('Budget state unknown; automatic launch is blocked')).toBeTruthy()
  })

  it('can promote a durably approved inactive Generation after the panel is reopened', async () => {
    const api = remote(false, true)
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')

    fireEvent.click(await screen.findByRole('button', { name: 'Promote' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.promote).toHaveBeenCalledWith(generationId))
  })

  it('requires explicit confirmation before starting a paid feedback Shadow', async () => {
    const api = remote()
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')

    fireEvent.click(await screen.findByRole('button', { name: 'Start Shadow · plugin-delivery' }))
    expect(api.startFeedbackShadow).not.toHaveBeenCalled()
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.startFeedbackShadow).toHaveBeenCalledWith(signalId, 'plugin-delivery'))
  })

  it('keeps paid evaluator authoring cancellable and qualification behind a second confirmation', async () => {
    const api = remote()
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')

    fireEvent.click(await screen.findByRole('button', { name: 'Author Evaluator · plugin-delivery' }))
    expect(api.authorEvaluator).not.toHaveBeenCalled()
    let confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.authorEvaluator).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Author Evaluator · plugin-delivery' }))
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.authorEvaluator).toHaveBeenCalledWith(signalId, 'plugin-delivery'))

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))
    await screen.findByText('final-test/evaluator.mjs')
    expect(api.evaluatorDraft).toHaveBeenCalledWith(evaluatorDraftId)
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'independent semantics reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qualify Evaluator' }))
    expect(api.approveEvaluator).not.toHaveBeenCalled()
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.approveEvaluator).toHaveBeenCalledWith(
      evaluatorDraftId,
      'independent semantics reviewed',
    ))
    expect(api.startFeedbackShadow).not.toHaveBeenCalled()
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('allows only local sealed qualification to be retried for an incomplete exact draft', async () => {
    const api = remote(false, false, 'incomplete')
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')

    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))
    await screen.findByText('final-test/evaluator.mjs')
    fireEvent.change(screen.getByLabelText('Decision note'), { target: { value: 'retry exact local qualification' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qualify Evaluator' }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(api.approveEvaluator).toHaveBeenCalledWith(
      evaluatorDraftId,
      'retry exact local qualification',
    ))
    expect(api.authorEvaluator).not.toHaveBeenCalled()
  })

  it('requires a fresh paid-disclosure confirmation before a Qualified Pack enters Shadow', async () => {
    const api = remote(false, false, 'qualified')
    render(<EvolutionAction remote={api} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Evaluator' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Start Qualified Shadow' }))
    let confirmation = await screen.findByRole('alertdialog')
    expect(api.startEvaluatorShadow).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    expect(api.startEvaluatorShadow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start Qualified Shadow' }))
    confirmation = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.startEvaluatorShadow).toHaveBeenCalledWith(evaluatorDraftId))
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
