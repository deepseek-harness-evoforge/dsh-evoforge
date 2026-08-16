import React from 'react'
// The product workspace intentionally does not ship React DOM type declarations;
// this browser-only acceptance bundle consumes the runtime provided by DSH Web.
// @ts-expect-error browser fixture runtime import
import { createRoot } from 'react-dom/client'
import { EvolutionAction } from '../../src/client/EvolutionAction.tsx'
import type { EvolutionRemoteClient } from '../../src/client/remote.ts'

const signalId = '8'.repeat(64)
const draftId = 'e'.repeat(64)
const launchId = 'd'.repeat(64)
const calls = { author: 0, approve: 0, reject: 0 }

const draft = {
  id: draftId,
  launchId,
  targetId: 'plugin-delivery',
  skillName: 'build-dsh-plugin',
  status: 'draft-ready' as const,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:01.000Z',
  cost: { modelCalls: 1 as const, inputTokens: 100, outputTokens: 50 },
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const remote: EvolutionRemoteClient = {
  overview: () => ok({
    schemaVersion: 1,
    recovery: { available: false },
    automaticPromotion: { enabled: false, skills: [] },
    evaluatorAuthoring: {
      available: true,
      warningCount: 0,
      signals: [{ id: signalId, sourceUpdatedAt: 1_786_896_000_000 }],
      targets: [{ id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
      drafts: [draft],
    },
    reviews: {
      available: true,
      pendingCount: 0,
      actionableCount: 0,
      warningCount: 0,
      items: [],
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
  review: () => Promise.reject(new Error('not used')),
  pause: () => Promise.reject(new Error('not used')),
  resume: () => Promise.reject(new Error('not used')),
  approveReview: () => Promise.reject(new Error('not used')),
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
  'section.evaluators': 'Evaluator drafts',
  'section.evaluatorDetail': 'Evaluator qualification review',
  'section.reviews': 'Reviews',
  'empty.reviews': 'No reviews',
  'action.refresh': 'Refresh',
  'action.authorEvaluator': 'Author Evaluator',
  'action.inspectEvaluator': 'Inspect Evaluator',
  'action.approveEvaluator': 'Qualify Evaluator',
  'action.reject': 'Reject',
  'action.back': 'Back',
  'action.cancel': 'Cancel',
  'action.confirm': 'Confirm',
  'field.note': 'Decision note',
  'label.skill': 'Skill',
  'label.status': 'Status',
  'label.limitations': 'Limitations',
  'label.tokens': 'Tokens',
  'confirm.authorEvaluator': 'Paid disclosure confirmation',
  'confirm.approveEvaluator': 'Execute generated code in sealed qualification?',
  'confirm.rejectEvaluator': 'Reject without execution?',
  'notice.done': 'Done',
  'error.prefix': 'Error: ',
}

Object.assign(window, { __EVOFORGE_E2E__: calls })
createRoot(document.getElementById('root')!).render(
  <EvolutionAction remote={remote} t={key => labels[key] ?? key} />,
)
