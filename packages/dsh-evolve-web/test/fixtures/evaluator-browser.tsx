import React from 'react'
// The product workspace intentionally does not ship React DOM type declarations;
// this browser-only acceptance bundle consumes the runtime provided by DSH Web.
// @ts-expect-error browser fixture runtime import
import { createRoot } from 'react-dom/client'
import { EvolutionAction } from '../../src/client/EvolutionAction.tsx'
import { en } from '../../src/client/locales.ts'
import type { EvolutionRemoteClient } from '../../src/client/remote.ts'
import { cssText } from '../../src/client/style.ts'

const browserDiagnostics: string[] = []
const recordBrowserDiagnostic = (value: string) => {
  browserDiagnostics.push(value)
  document.documentElement.dataset.evoforgeBrowserDiagnostics = JSON.stringify(browserDiagnostics)
}
document.documentElement.dataset.evoforgeBrowserDiagnostics = '[]'
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console)
  console[level] = (...values: unknown[]) => {
    recordBrowserDiagnostic(`${level}: ${values.map(String).join(' ')}`)
    original(...values)
  }
}
window.addEventListener('error', event => recordBrowserDiagnostic(`page-error: ${event.message}`))
window.addEventListener('unhandledrejection', event =>
  recordBrowserDiagnostic(`unhandled-rejection: ${String(event.reason)}`))

const signalId = '8'.repeat(64)
const draftId = 'e'.repeat(64)
const launchId = 'd'.repeat(64)
const reviewId = 'c'.repeat(64)
const workspaceId = '11111111-1111-4111-8111-111111111111'
const sessionId = 'browser-evolution-session'

const internalOpportunityEvidence = {
  kind: 'internal-experience-v2' as const,
  eligibilityBasis: 'two-or-more-distinct-goals' as const,
  correctionSignals: {
    association: 'same-session-single-skill-gap' as const,
    count: 1,
    ids: ['2'.repeat(64)],
    referencesTruncated: false,
  },
  deliveryOutcomes: {
    association: 'same-goal-single-skill-gap' as const,
    total: 2,
    passed: 1,
    failed: 1,
    unknown: 0,
    ids: ['3'.repeat(64), '4'.repeat(64)],
    referencesTruncated: false,
  },
  causalClaim: 'none' as const,
}
const search = new URLSearchParams(window.location.search)
const qualifiedMode = search.has('qualified')
const reviewMode = search.has('review')
const reviewExpiryEligibleMode = search.has('expired')
const staleReviewMode = search.has('stale')
const outcomeMode = search.has('outcomes')
const semanticMode = search.has('semantic')
const calls = { author: 0, approve: 0, reject: 0, shadow: 0, reviewApprove: 0 }
let reviewApproved = false
const runs: Array<{
  workspaceId: string
  launchId: string
  targetId: string
  skillName: string
  phase: 'prepared'
  startedAt: string
  updatedAt: string
}> = []

const semanticLineage = {
  kind: 'internal-skill-candidate-lineage-v2' as const,
  candidateId: '4'.repeat(64),
  workspaceId,
  skillName: 'publish-dsh-plugin',
  opportunityId: '7'.repeat(64),
  policyId: 'publish-author',
  versionKind: 'experience-authored-bundle-v1' as const,
  contentHash: 'a'.repeat(64),
  candidateTreeHash: 'c'.repeat(64),
  admissionId: 'e'.repeat(64),
  evaluationEnvelopeId: 'e'.repeat(64),
  releaseAuthority: 'none' as const,
}

const draft = {
  workspaceId,
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
  workspaceId,
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
  automaticReviewExpiry: {
    eligibleAt: '2026-08-23T00:00:00.000Z',
    eligible: reviewExpiryEligibleMode,
    trigger: 'next-same-skill-automatic-signal' as const,
  },
}

const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const browserGoalMetrics = {
  schemaVersion: 1 as const,
  source: 'dsh-session-projections' as const,
  goalId: 'goal-browser-metrics',
  throughEventSeq: 12,
  attributedTurns: 2,
  closedSteps: 1,
  activeWallMs: 300,
  providerUsage: {
    uncachedInputTokens: 30,
    outputTokens: 9,
    cacheReadTokens: 70,
    cacheWriteTokens: 5,
  },
  latency: {
    llmMs: 180,
    toolMs: 50,
    ttftMs: 45,
    ttftSteps: 2,
    decodeMs: 135,
    decodeTokens: 9,
  },
  monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
}
const browserMetricRollup = (measured: number, unmeasured: number, factor: number) => ({
  measured,
  unmeasured,
  attributedTurns: browserGoalMetrics.attributedTurns * factor,
  closedSteps: browserGoalMetrics.closedSteps * factor,
  activeWallMs: browserGoalMetrics.activeWallMs * factor,
  providerUsage: {
    uncachedInputTokens: browserGoalMetrics.providerUsage.uncachedInputTokens * factor,
    outputTokens: browserGoalMetrics.providerUsage.outputTokens * factor,
    cacheReadTokens: browserGoalMetrics.providerUsage.cacheReadTokens * factor,
    cacheWriteTokens: browserGoalMetrics.providerUsage.cacheWriteTokens * factor,
  },
  latency: {
    llmMs: browserGoalMetrics.latency.llmMs * factor,
    toolMs: browserGoalMetrics.latency.toolMs * factor,
    ttftMs: browserGoalMetrics.latency.ttftMs * factor,
    ttftSteps: browserGoalMetrics.latency.ttftSteps * factor,
    decodeMs: browserGoalMetrics.latency.decodeMs * factor,
    decodeTokens: browserGoalMetrics.latency.decodeTokens * factor,
  },
  monetaryCost: browserGoalMetrics.monetaryCost,
})
const remote: EvolutionRemoteClient = {
  overview: () => ok({
    schemaVersion: 1,
    workspaceId,
    ...(outcomeMode || semanticMode
      ? {
          active: {
            id: 'a'.repeat(64),
            workspaceId,
            rollbackTargetId: 'b'.repeat(64),
            createdAt: 1_786_896_000_000,
            evaluatorVersion: 'browser-review-v1',
            policyVersion: 'human-review-v1',
            artifacts: semanticMode
              ? [{
                  kind: 'skill' as const,
                  name: 'publish-dsh-plugin',
                  gitCommit: 'f'.repeat(40),
                  treeHash: 'e'.repeat(40),
                  lineage: semanticLineage,
                }]
              : [],
          },
          ...(outcomeMode ? { deliveryOutcomes: {
            all: { total: 8, passed: 5, failed: 2, unknown: 1 },
            selected: { total: 4, passed: 3, failed: 1, unknown: 0 },
            baseline: { total: 4, passed: 2, failed: 1, unknown: 1 },
            metrics: {
              all: browserMetricRollup(2, 6, 2),
              selected: browserMetricRollup(1, 3, 1),
              baseline: browserMetricRollup(1, 3, 1),
              recent: [{
                outcomeId: '0'.repeat(64),
                observedAt: 1_786_896_000_200,
                generationId: 'a'.repeat(64),
                status: 'passed' as const,
                goal: { id: 'goal-browser-metrics', revision: 2 },
                metrics: browserGoalMetrics,
              }],
            },
          } } : {}),
        }
      : {}),
    recovery: { available: false },
    automaticPromotion: { enabled: false, skills: [] },
    ...(semanticMode
      ? {
          capabilityMap: {
            status: 'complete' as const,
            catalogHash: '6'.repeat(64),
            capabilities: [],
          },
          capabilityGaps: {
            confirmedCount: 1,
            items: [{
              id: '5'.repeat(64),
              observedAt: 1_786_896_000_000,
              requestedSkill: 'publish-dsh-plugin',
              catalogHash: '6'.repeat(64),
              catalogSize: 0,
              goal: {
                id: 'goal-semantic-browser',
                revision: 1,
                objective: 'Publish a verified native DSH extension.',
              },
              status: 'confirmed' as const,
              evidence: {
                kind: 'model-declared-skill-gap' as const,
                catalog: 'complete' as const,
                routing: 'model-declared-no-applicable-skill' as const,
                providers: 'settled' as const,
              },
            }],
          },
          skillOpportunities: {
            eligibleCount: 1,
            items: [{
              id: '1'.repeat(64),
              skillName: 'publish-dsh-plugin',
              gapIds: ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64)],
              goalIds: ['goal-semantic-browser', 'goal-semantic-browser-2', 'goal-semantic-browser-3', 'goal-semantic-browser-4'],
              gapCount: 4,
              goalCount: 4,
              firstObservedAt: 1_786_895_900_000,
              lastObservedAt: 1_786_896_000_000,
              evidence: internalOpportunityEvidence,
              evaluationReadiness: {
                status: 'sealed' as const,
                evidenceId: 'e'.repeat(64),
                observedGoalCount: 4,
                authoringGoalCount: 2,
                admissionGoalCount: 1,
                holdoutGoalCount: 1,
                proposerCanReadProtectedSamples: false as const,
                releaseAuthority: 'none' as const,
              },
              status: 'eligible-for-authoring' as const,
              releaseAuthority: 'none' as const,
            }],
          },
          slowLoopAuthoring: {
            configuredPolicyCount: 1,
            warningCount: 0,
            runs: [{
              id: '4'.repeat(64),
              targetId: 'publish-author',
              skillName: 'publish-dsh-plugin',
              opportunityId: '1'.repeat(64),
              gapCount: 4,
              goalCount: 4,
              phase: 'candidate-ready' as const,
              createdAt: '2026-08-18T01:00:00.000Z',
              updatedAt: '2026-08-18T01:00:01.000Z',
              modelCalls: 1 as const,
              inputTokens: 320,
              outputTokens: 120,
              candidateId: '3'.repeat(64),
              releaseAuthority: 'none' as const,
            }],
          },
          skillCandidates: {
            quarantinedCount: 1,
            items: [{
              id: '7'.repeat(64),
              createdAt: 1_786_896_000_100,
              skillName: 'release-native-extension',
              description: 'Publish and verify a native extension release.',
              opportunity: {
                kind: 'internal-experience-v1' as const,
                id: '1'.repeat(64),
                gapIds: ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64)],
                goalCount: 4,
              },
              authorship: {
                kind: 'bounded-model-authoring-v1' as const,
                policyId: 'internal-experience-author',
                modelIdentityHash: '4'.repeat(64),
                inputDigest: '5'.repeat(64),
              },
              scope: 'workspace' as const,
              version: {
                kind: 'experience-authored-bundle-v1' as const,
                artifactDigest: '9'.repeat(64),
                treeHash: 'b'.repeat(64),
              },
              contentHash: 'a'.repeat(64),
              package: {
                path: 'release-native-extension',
                fileCount: 2,
                totalBytes: 640,
                hasScripts: false,
                hasReferences: true,
              },
              permissions: {
                declared: false,
                executableContent: false,
                externalEffects: 'unknown' as const,
              },
              license: { status: 'declared' as const, value: 'MIT' },
              safety: {
                status: 'quarantined' as const,
                checks: [
                  { name: 'artifact-digest-integrity' as const, status: 'passed' as const },
                  { name: 'regular-files-only' as const, status: 'passed' as const },
                  { name: 'skill-identity' as const, status: 'passed' as const },
                  { name: 'effect-review' as const, status: 'required' as const },
                ],
              },
              lifecycle: 'inactive' as const,
              verification: 'unevaluated' as const,
              execution: 'never' as const,
            }],
          },
          skillAdmission: {
            configuredPolicyCount: 1,
            warningCount: 0,
            results: [{
              id: 'e'.repeat(64),
              candidateId: '4'.repeat(64),
              skillName: 'publish-dsh-plugin',
              status: 'qualified-for-shadow' as const,
              reasons: ['candidate-improves-deterministic-admission' as const],
              envelopeId: 'e'.repeat(64),
              releaseAuthority: 'none' as const,
              evidence: {
                baseline: 'fail' as const,
                candidate: 'pass' as const,
                calibrationPassed: true,
                candidateExecuted: false as const,
                evaluatorClass: 'deterministic-filesystem' as const,
                trialCount: 4 as const,
              },
            }],
          },
        }
      : {}),
    automaticFeedbackBudget: {
      warningCount: 0,
      targets: [{
        workspaceId,
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
      signals: [],
      targets: [],
      runs,
    },
    evaluatorAuthoring: {
      available: true,
      actionableCount: 1,
      warningCount: 0,
      signals: [{
        workspaceId,
        id: signalId,
        sourceUpdatedAt: 1_786_896_000_000,
        generationId: 'a'.repeat(64),
        eligibleTargetIds: ['plugin-delivery'],
      }],
      targets: [{ workspaceId, id: 'plugin-delivery', skillName: 'build-dsh-plugin' }],
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
  authorEvaluator: (selectedWorkspace, selectedSignal, selectedTarget) => {
    if (selectedWorkspace !== workspaceId) throw new Error('wrong Workspace')
    if (selectedSignal !== signalId || selectedTarget !== 'plugin-delivery') throw new Error('wrong author selection')
    calls.author += 1
    return ok({
      schemaVersion: 1,
      workspaceId,
      action: 'author-evaluator',
      launchId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'scheduled',
      jobId: 'evolution-2',
    })
  },
  approveEvaluator: (selectedWorkspace, selectedDraft, note) => {
    if (selectedWorkspace !== workspaceId) throw new Error('wrong Workspace')
    if (selectedDraft !== draftId || note !== 'independent semantics reviewed') throw new Error('wrong approval')
    calls.approve += 1
    return ok({
      schemaVersion: 1,
      workspaceId,
      action: 'approve-evaluator',
      launchId,
      draftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'qualified',
    })
  },
  approveAndStartEvaluatorShadow: (selectedWorkspace, selectedDraft, note) => {
    if (selectedWorkspace !== workspaceId
      || qualifiedMode
      || selectedDraft !== draftId
      || note !== 'independent semantics reviewed') {
      throw new Error('wrong combined qualification')
    }
    calls.approve += 1
    calls.shadow += 1
    return ok({
      schemaVersion: 1,
      workspaceId,
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
      workspaceId,
      action: 'reject-evaluator',
      launchId,
      draftId,
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      draftStatus: 'rejected',
    })
  },
  startEvaluatorShadow: (selectedWorkspace, selectedDraft) => {
    if (selectedWorkspace !== workspaceId || !qualifiedMode || selectedDraft !== draftId) throw new Error('wrong qualified Shadow selection')
    calls.shadow += 1
    if (runs.length === 0) runs.push({
      workspaceId,
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      phase: 'prepared',
      startedAt: '2026-08-17T00:00:02.000Z',
      updatedAt: '2026-08-17T00:00:02.000Z',
    })
    return ok({
      schemaVersion: 1,
      workspaceId,
      action: 'start-shadow',
      launchId: '9'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'build-dsh-plugin',
      runStatus: 'scheduled',
      jobId: 'evolution-3',
    })
  },
  review: (selectedWorkspace, selectedReview) => {
    if (selectedWorkspace !== workspaceId || !reviewMode || selectedReview !== reviewId) throw new Error('wrong review selection')
    if (staleReviewMode) return Promise.resolve({
      ok: false as const,
      error: {
        code: 'not_found',
        message: 'Candidate was already rejected by the automatic review expiry policy; refresh authoritative state.',
        details: {},
      },
    })
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
  approveReview: (selectedWorkspace, selectedReview, note) => {
    if (selectedWorkspace !== workspaceId || !reviewMode || selectedReview !== reviewId || note !== 'evidence and limitation reviewed') {
      throw new Error('wrong review approval')
    }
    calls.reviewApprove += 1
    reviewApproved = true
    return ok({
      schemaVersion: 1,
      workspaceId,
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
  ...en,
  'trigger.label': 'Evolution',
  'panel.title': 'Evolution control',
  'panel.close': 'Close',
  'status.loading': 'Loading',
  'status.native': 'Native DSH',
  'status.active': 'Active',
  'status.recovery': 'Recovery',
  'status.unavailable': 'Unavailable',
  'status.reviews': 'Reviews',
  'status.actions': 'Actionable',
  'status.auto': 'Automatic',
  'status.off': 'Off',
  'status.budgetUnknown': 'Budget state unknown; automatic action is blocked',
  'section.budget': 'Automatic evolution budget',
  'section.outcomes': 'Observed delivery outcomes',
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
  'action.rollback': 'Rollback',
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
  'confirm.approve': 'Publish an inactive Generation without changing current or future Sessions?',
  'confirm.authorEvaluator': 'Paid disclosure confirmation',
  'confirm.approveEvaluator': 'Execute generated code in sealed qualification?',
  'confirm.approveAndShadow': 'Approve this exact Evaluator Draft and start one potentially paid Shadow only if sealed qualification succeeds? A failed qualification makes no proposer call; success sends bounded user text and correction to the configured model. This does not modify a Skill or authorize Promotion.',
  'confirm.qualifiedShadow': 'Start paid Qualified Shadow?',
  'confirm.rejectEvaluator': 'Reject without execution?',
  'notice.done': 'Done',
  'error.workspaceRequired': 'Open a Session owned by a native Workspace first.',
  'error.prefix': 'Error: ',
}

Object.assign(window, { __EVOFORGE_E2E__: calls, __EVOFORGE_BROWSER_DIAGNOSTICS__: browserDiagnostics })
const productStyle = document.createElement('style')
productStyle.textContent = cssText
document.head.append(productStyle)
createRoot(document.getElementById('root')!).render(
  <EvolutionAction
    remote={remote}
    t={key => labels[key] ?? key}
    wide
    useSessions={selector => selector({ current: sessionId } as never)}
    useWorkspaces={selector => selector({
      items: [{ workspaceId, sessionIds: [sessionId] }],
    } as never)}
  />,
)
