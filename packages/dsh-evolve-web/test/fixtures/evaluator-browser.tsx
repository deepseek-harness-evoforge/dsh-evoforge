import React from 'react'
// The product workspace intentionally does not ship React DOM type declarations;
// this browser-only acceptance bundle consumes the runtime provided by DSH Web.
// @ts-expect-error browser fixture runtime import
import { createRoot } from 'react-dom/client'
import { EvolutionAction } from '../../src/client/EvolutionAction.tsx'
import type { EvolutionRemoteClient } from '../../src/client/remote.ts'
import { cssText } from '../../src/client/style.ts'

const signalId = '8'.repeat(64)
const draftId = 'e'.repeat(64)
const launchId = 'd'.repeat(64)
const reviewId = 'c'.repeat(64)
const search = new URLSearchParams(window.location.search)
const qualifiedMode = search.has('qualified')
const reviewMode = search.has('review')
const calls = { author: 0, approve: 0, reject: 0, shadow: 0, reviewApprove: 0 }
let reviewApproved = false
const runs: Array<{
  launchId: string
  targetId: string
  skillName: string
  phase: 'prepared'
  startedAt: string
  updatedAt: string
}> = []

const draft = {
  id: draftId,
  launchId,
  targetId: 'plugin-delivery',
  skillName: 'build-dsh-plugin',
  status: qualifiedMode ? 'qualified' as const : 'draft-ready' as const,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:01.000Z',
  cost: { modelCalls: 1 as const, inputTokens: 100, outputTokens: 50 },
}

const review = {
  id: reviewId,
  status: 'pending' as const,
  recommendation: 'review' as const,
  skillName: 'build-dsh-plugin',
  claim: 'Keep working until the requested result is verified.',
  changedFiles: ['SKILL.md'],
  candidateTreeHash: '1'.repeat(64),
  cases: [{
    id: 'progress-stop-heldout',
    baseline: 'fail' as const,
    candidate: 'pass' as const,
    passedChecks: 2,
    totalChecks: 2,
  }],
  cost: { inputTokens: 120, outputTokens: 30, trialCount: 4 },
  reasons: ['held-out case changed from fail to pass', 'complete composition stayed stable'],
  limitations: ['validated for one bounded software-delivery failure class'],
  evaluatorVersion: 'browser-review-v1',
  compositionFingerprint: '2'.repeat(64),
  compositionStable: true,
  startedAt: '2026-08-16T00:00:00.000Z',
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const remote: EvolutionRemoteClient = {
  overview: () => ok({
    schemaVersion: 1,
    recovery: { available: false },
    automaticPromotion: { enabled: false, skills: [] },
    automaticFeedbackBudget: {
      warningCount: 0,
      targets: [{
        targetId: 'plugin-delivery',
        skillName: 'build-dsh-plugin',
        utcDay: '2026-08-17',
        used: 1,
        limit: 2,
        remaining: 1,
        status: 'ready' as const,
      }],
    },
    automaticEvaluatorBudget: {
      warningCount: 0,
      targets: [{
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
      signals: [],
      targets: [],
      runs,
    },
    evaluatorAuthoring: {
      available: true,
      warningCount: 0,
      signals: [{ id: signalId, sourceUpdatedAt: 1_786_896_000_000 }],
      targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      drafts: [draft],
    },
    reviews: {
      available: true,
      pendingCount: reviewMode && !reviewApproved ? 1 : 0,
      actionableCount: reviewMode && !reviewApproved ? 1 : 0,
      warningCount: 0,
      items: reviewMode && !reviewApproved ? [review] : [],
      inactiveGenerations: [],
    },
  }),
  evaluatorDraft: () => ok({
    schemaVersion: 1,
    draft,
    files: [
      { path: 'final-test/evaluator.mjs', content: 'process.stdout.write("bounded")\n' },
      { path: 'search/evidence.md', content: 'independent observable\n' },
    ],
    limitations: ['inactive until exact-hash human qualification'],
    qualifiedShadowAvailable: true,
  }),
  authorEvaluator: (selectedSignal, selectedTarget) => {
    if (selectedSignal !== signalId || selectedTarget !== 'plugin-delivery') throw new Error('wrong author selection')
    calls.author += 1
    return ok({
      schemaVersion: 1,
      action: 'author-evaluator',
      launchId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'scheduled',
      jobId: 'evolution-2',
    })
  },
  approveEvaluator: (selectedDraft, note) => {
    if (selectedDraft !== draftId || note !== 'independent semantics reviewed') throw new Error('wrong approval')
    calls.approve += 1
    return ok({
      schemaVersion: 1,
      action: 'approve-evaluator',
      launchId,
      draftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'qualified',
    })
  },
  approveAndStartEvaluatorShadow: (selectedDraft, note) => {
    if (qualifiedMode
      || selectedDraft !== draftId
      || note !== 'independent semantics reviewed') {
      throw new Error('wrong combined qualification')
    }
    calls.approve += 1
    calls.shadow += 1
    return ok({
      schemaVersion: 1,
      action: 'start-shadow',
      launchId: '8'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled',
      jobId: 'evolution-4',
    })
  },
  rejectEvaluator: () => {
    calls.reject += 1
    return ok({
      schemaVersion: 1,
      action: 'reject-evaluator',
      launchId,
      draftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'rejected',
    })
  },
  startEvaluatorShadow: (selectedDraft) => {
    if (!qualifiedMode || selectedDraft !== draftId) throw new Error('wrong qualified Shadow selection')
    calls.shadow += 1
    if (runs.length === 0) runs.push({
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      phase: 'prepared',
      startedAt: '2026-08-17T00:00:02.000Z',
      updatedAt: '2026-08-17T00:00:02.000Z',
    })
    return ok({
      schemaVersion: 1,
      action: 'start-shadow',
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled',
      jobId: 'evolution-3',
    })
  },
  review: (selectedReview) => {
    if (!reviewMode || selectedReview !== reviewId) throw new Error('wrong review selection')
    return ok({
      schemaVersion: 1,
      review,
      diff: {
        patch: '-Stop after reporting progress.\n+Continue until the requested result is verified.\n',
        shownBytes: 85,
        totalBytes: 85,
        truncated: false,
        impact: {
          version: 'lexical-protected-effects-v1' as const,
          scope: 'append-only-skill' as const,
          indicators: [],
        },
      },
      automatic: {
        eligible: false,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['manual review fixture'],
      },
    })
  },
  pause: () => Promise.reject(new Error('not used')),
  resume: () => Promise.reject(new Error('not used')),
  approveReview: (selectedReview, note) => {
    if (!reviewMode || selectedReview !== reviewId || note !== 'evidence and limitation reviewed') {
      throw new Error('wrong review approval')
    }
    calls.reviewApprove += 1
    reviewApproved = true
    return ok({
      schemaVersion: 1,
      action: 'approve-review',
      reviewId,
      status: 'approved',
      generationId: 'a'.repeat(64),
    })
  },
  rejectReview: () => Promise.reject(new Error('not used')),
  promote: () => Promise.reject(new Error('not used')),
  rollback: () => Promise.reject(new Error('not used')),
  startFeedbackShadow: () => Promise.reject(new Error('not used')),
}

const labels: Record<string, string> = {
  'trigger.label': 'Evolution',
  'panel.title': 'Evolution control',
  'panel.close': 'Close',
  'status.loading': 'Loading',
  'status.native': 'Native DSH',
  'status.active': 'Active',
  'status.recovery': 'Recovery',
  'status.unavailable': 'Unavailable',
  'status.reviews': 'Reviews',
  'status.auto': 'Automatic',
  'status.off': 'Off',
  'status.budgetUnknown': 'Budget state unknown; automatic action is blocked',
  'section.budget': 'Automatic evolution budget',
  'section.feedback': 'Explicit corrections',
  'section.evaluators': 'Evaluator drafts',
  'section.evaluatorDetail': 'Evaluator qualification review',
  'section.detail': 'Review evidence',
  'section.runs': 'Recent Shadow runs',
  'section.reviews': 'Reviews',
  'empty.reviews': 'No reviews',
  'empty.feedback': 'No explicit corrections',
  'action.refresh': 'Refresh',
  'action.authorEvaluator': 'Author Evaluator',
  'action.inspectEvaluator': 'Inspect Evaluator',
  'action.inspect': 'Inspect',
  'action.approve': 'Publish inactive',
  'action.approveEvaluator': 'Qualify Evaluator',
  'action.approveAndShadow': 'Qualify & start Shadow',
  'action.startQualifiedShadow': 'Start Qualified Shadow',
  'action.reject': 'Reject',
  'action.back': 'Back',
  'action.cancel': 'Cancel',
  'action.confirm': 'Confirm',
  'field.note': 'Decision note',
  'label.claim': 'Improvement claim',
  'label.skill': 'Skill',
  'label.changedFiles': 'Changed files',
  'label.reasons': 'Decision reasons',
  'label.status': 'Status',
  'label.limitations': 'Limitations',
  'label.cases': 'Cases',
  'label.impact': 'Protected-effect indicators',
  'label.diff': 'Verified diff',
  'label.tokens': 'Tokens',
  'label.attemptsUsed': 'attempts used',
  'label.remaining': 'remaining',
  'label.feedbackShadow': 'Feedback Shadow',
  'label.evaluatorDraft': 'Evaluator Draft',
  'confirm.approve': 'Publish an inactive Generation without changing current or future Sessions?',
  'confirm.authorEvaluator': 'Paid disclosure confirmation',
  'confirm.approveEvaluator': 'Execute generated code in sealed qualification?',
  'confirm.approveAndShadow': 'Approve this exact Evaluator Draft and start one potentially paid Shadow only if sealed qualification succeeds? A failed qualification makes no proposer call; success sends bounded user text and correction to the configured model. This does not modify a Skill or authorize Promotion.',
  'confirm.qualifiedShadow': 'Start paid Qualified Shadow?',
  'confirm.rejectEvaluator': 'Reject without execution?',
  'notice.done': 'Done',
  'error.prefix': 'Error: ',
}

Object.assign(window, { __EVOFORGE_E2E__: calls })
const productStyle = document.createElement('style')
productStyle.textContent = cssText
document.head.append(productStyle)
createRoot(document.getElementById('root')!).render(
  <EvolutionAction remote={remote} t={key => labels[key] ?? key} />,
)
