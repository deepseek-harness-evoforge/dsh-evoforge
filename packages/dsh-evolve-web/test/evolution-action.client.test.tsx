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
const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'
const sessionId = 'session-1'

function internalOpportunityEvidence() {
  return {
    kind: 'internal-experience-v3' as const,
    eligibilityBasis: 'two-or-more-distinct-goals' as const,
    correctionSignals: {
      association: 'exact-durable-skill-invocation' as const,
      count: 1,
      goalCount: 1,
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
}

const discoveredLineage = {
  kind: 'internal-skill-candidate-lineage-v3' as const,
  candidateId: '8'.repeat(64),
  workspaceId,
  skillName: 'build-dsh-plugin',
  opportunityId: '7'.repeat(64),
  evaluationEvidenceId: '6'.repeat(64),
  policyId: 'bounded-author',
  versionKind: 'experience-authored-bundle-v1' as const,
  contentHash: '9'.repeat(64),
  candidateTreeHash: '1'.repeat(64),
  admissionId: 'a'.repeat(64),
  evaluationEnvelopeId: 'e'.repeat(64),
  releaseAuthority: 'none' as const,
}

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function remote(
  withActive = false,
  withInactive = false,
): EvolutionRemoteClient {
  const overview = {
    schemaVersion: 1 as const,
    workspaceId,
    recovery: { available: true, paused: false },
    skillEvaluationGovernance: {
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [],
    },
    reviews: {
      available: true,
      pendingCount: 1,
      actionableCount: 1,
      warningCount: 0,
      inactiveGenerations: withInactive
        ? [{
            workspaceId,
            generationId,
            reviewId,
            skillName: 'build-dsh-plugin',
            lineage: discoveredLineage,
            promotion: {
              status: 'eligible' as const,
              reason: 'exact-retention-retained' as const,
              retentionId: 'f'.repeat(64),
            },
          }]
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
        lineage: discoveredLineage,
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
      workspaceId,
      rollbackTargetId: 'b'.repeat(64),
      createdAt: 1_786_896_000_000,
      evaluatorVersion: 'case-pack-v1',
      policyVersion: 'human-review-v1',
      artifacts: [{
        kind: 'skill-bundle' as const,
        name: 'build-dsh-plugin',
        artifactDigest: 'f'.repeat(64),
        treeHash: '3'.repeat(64),
        lineage: discoveredLineage,
      }],
    },
    deliveryOutcomes: {
      all: { total: 6, passed: 3, failed: 2, unknown: 1 },
      selected: { total: 3, passed: 2, failed: 1, unknown: 0 },
      baseline: { total: 3, passed: 1, failed: 1, unknown: 1 },
      metrics: {
        all: webMetricRollup(2, 4, 2),
        selected: webMetricRollup(1, 2, 1),
        baseline: webMetricRollup(1, 2, 1),
        recent: [{
          outcomeId: '0'.repeat(64),
          observedAt: 1_786_896_000_200,
          generationId,
          status: 'passed' as const,
          goal: { id: 'goal-metrics', revision: 2 },
          metrics: webGoalMetrics(),
        }],
      },
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
  'onboarding.verificationMissing': 'Corrections are available, but independent evaluation governance is not configured',
  'onboarding.verificationMissingHelp': 'You can still leave a correction under an answer. Until independent evaluation governance is configured, EvoForge records internal evidence without pretending that evolution ran.',
  'onboarding.feedbackBlocked': 'A correction is recorded, but verification is not configured',
  'onboarding.feedbackBlockedHelp': 'Your correction remains safely in this Workspace. Independent evaluation governance must be configured before the system can author and isolate a Candidate from internal experience.',
  'onboarding.feedbackReady': 'Correction recorded for autonomous evaluation',
  'onboarding.feedbackReadyHelp': 'EvoForge will attribute and cluster this evidence internally. It will surface a review only after an isolated Candidate passes governance.',
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
  'skills.gaps.inactive': 'No Skill was installed or executed.',
  'skills.gaps.goalProtected': 'Goal content withheld from browser',
  'skills.opportunities': 'Self-Skill Candidate opportunities',
  'skills.opportunities.empty': 'Internal experience has not produced a reliable Skill opportunity yet.',
  'skills.opportunities.goals': 'distinct Goals',
  'skills.opportunities.observations': 'Gap observations',
  'skills.opportunities.evidence': 'Discovered from repeated capability gaps across DSH Goals',
  'skills.opportunities.flow': 'Evidence Goals',
  'skills.opportunities.context': 'Associated internal evidence',
  'skills.opportunities.corrections': 'explicit corrections',
  'skills.opportunities.correctionGoals': 'exactly attributed Goals',
  'skills.opportunities.delivery': 'delivery outcomes',
  'skills.opportunities.passed': 'passed',
  'skills.opportunities.failed': 'failed',
  'skills.opportunities.unknown': 'unknown',
  'skills.opportunities.correctionAttribution': 'Correction attribution · exact durable Session Skill invocation and Goal revision',
  'skills.opportunities.deliveryAssociation': 'Delivery association · same-Goal single-gap-Skill context',
  'skills.opportunities.causalBoundary': 'No causal claim · no Opportunity or authoring-eligibility effect',
  'skills.opportunities.references': 'Evidence references',
  'skills.opportunities.reference.correction': 'correction',
  'skills.opportunities.reference.outcome': 'outcome',
  'skills.opportunities.references.truncated': 'more references retained by the Host',
  'skills.opportunities.evaluation.readyToSeal': 'Independent evaluation evidence ready to seal',
  'skills.opportunities.evaluation.sealed': 'Independent evaluation evidence sealed',
  'skills.opportunities.evaluation.authoring': 'author-visible',
  'skills.opportunities.evaluation.admission': 'admission',
  'skills.opportunities.evaluation.holdout': 'holdout',
  'skills.opportunities.evaluation.retention': 'retention',
  'skills.opportunities.evaluation.protected': 'Candidate proposer cannot read protected samples',
  'skills.opportunities.evaluation.protectedWithRetention': 'Candidate proposer cannot read admission, holdout, or retention samples',
  'skills.opportunities.evaluation.waiting': 'Waiting for independent Goals; no Candidate authored',
  'skills.opportunities.evaluation.invalid': 'Invalid internal evidence',
  'skills.opportunities.evaluation.unavailable': 'Evaluation governance not configured',
  'skills.opportunities.state': 'Eligible for quarantined authoring · No install, activation, or release authority',
  'skills.improvements': 'Existing-Skill improvement investigations',
  'skills.improvements.empty': 'No repeated exact-version corrections.',
  'skills.improvements.corrections': 'exact corrections',
  'skills.improvements.version': 'Invocation content version',
  'skills.improvements.attribution': 'Exact association · durable Session invocation-content hash and Goal revision',
  'skills.improvements.causalBoundary': 'No causal claim · same-name different-content versions never merge',
  'skills.improvements.waiting': 'Waiting for a sealed complete baseline bundle · no Candidate, install, or release',
  'skills.slow-loop': 'Internal experience-driven Skill authoring',
  'skills.slow-loop.policies': 'Workspace safety policies',
  'skills.slow-loop.warnings': 'unreadable durable states',
  'skills.slow-loop.empty': 'No authoring run has met the threshold.',
  'skills.slow-loop.phase.candidate-ready': 'Quarantined candidate ready',
  'skills.slow-loop.cost': 'Model calls · input/output tokens',
  'skills.slow-loop.candidate': 'Candidate',
  'skills.slow-loop.retry': 'Earliest retry',
  'skills.slow-loop.release.none': 'Quarantined Candidate only · No install, activation, or release',
  'skills.governance': 'Independent evaluation governance',
  'skills.governance.policies': 'Workspace governance policies',
  'skills.governance.warnings': 'unreadable governance states',
  'skills.governance.empty': 'No independent admission/holdout governance record yet.',
  'skills.governance.phase.ready': 'Admission and assembled holdout ready',
  'skills.governance.phase.readyWithRetention': 'Admission, assembled holdout, and independent retention ready',
  'skills.governance.cost': 'Governance model calls · input/output tokens',
  'skills.governance.separation': 'Candidate proposer separated · protected samples only',
  'skills.governance.release.none': 'No promotion or release authority',
  'skills.discovery': 'Internally authored Skill candidates',
  'skills.discovery.quarantined': 'Quarantined candidate',
  'skills.discovery.author': 'Internal author policy',
  'skills.lineage.evidence': 'Evaluation evidence seal',
  'skills.discovery.version.experience-bundle': 'Internal-experience whole-Skill bundle v1',
  'skills.discovery.input': 'input digest',
  'skills.discovery.demand': 'Internal Skill opportunity evidence',
  'skills.discovery.artifact': 'artifact digest',
  'skills.discovery.tree': 'tree',
  'skills.discovery.content': 'Content hash',
  'skills.discovery.license': 'Declared license',
  'skills.discovery.license.unknown': 'License not declared',
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
  'skills.admission': 'Deterministic admission',
  'skills.admission.empty': 'No completed deterministic admission.',
  'skills.admission.status.abstained': 'Admission abstained',
  'skills.admission.status.protected': 'Protected candidate',
  'skills.admission.status.incomplete': 'Admission incomplete',
  'skills.admission.status.rejected': 'Admission rejected',
  'skills.admission.status.review': 'Admission needs review',
  'skills.admission.status.qualified-for-shadow': 'Qualified for later Shadow',
  'skills.admission.envelope': 'Evaluation Envelope',
  'skills.admission.policies': 'Workspace governance policies',
  'skills.admission.baseline': 'Baseline',
  'skills.admission.candidate': 'Candidate',
  'skills.admission.outcome.pass': 'pass',
  'skills.admission.outcome.fail': 'fail',
  'skills.admission.trials': 'trials',
  'skills.admission.governance': 'Deterministic filesystem · Candidate code not executed',
  'skills.admission.release.none': 'No release authority · Not installed or activated',
  'skills.admission.reason.candidate-improves-deterministic-admission': 'Candidate improved the deterministic admission case',
  'skills.evaluation': 'Assembled Shadow and Retention',
  'skills.evaluation.roots': 'configured Retention roots',
  'skills.evaluation.warnings': 'unpaired or invalid evaluation states',
  'skills.evaluation.empty': 'No assembled internal Candidate Shadow yet.',
  'skills.evaluation.shadow': 'Assembled Shadow',
  'skills.evaluation.recommendation.promote': 'Holdout recommends promotion',
  'skills.evaluation.recommendation.review': 'Holdout requires review',
  'skills.evaluation.baseline': 'Baseline',
  'skills.evaluation.candidate': 'Candidate',
  'skills.evaluation.outcome.pass': 'pass',
  'skills.evaluation.outcome.fail': 'fail',
  'skills.evaluation.outcome.incomplete': 'incomplete',
  'skills.evaluation.trials': 'trials',
  'skills.evaluation.composition.stable': 'Non-target composition stable',
  'skills.evaluation.composition.changed': 'Non-target composition changed',
  'skills.evaluation.retention': 'Independent Retention',
  'skills.evaluation.retention.notRun': 'Not run for this Shadow',
  'skills.evaluation.retention.status.prepared': 'Prepared; waiting for sealed Trial',
  'skills.evaluation.retention.status.retained': 'Retained prior behavior',
  'skills.evaluation.retention.status.regressed': 'Regressed on prior behavior',
  'skills.evaluation.retention.status.incomplete': 'Retention incomplete',
  'skills.evaluation.retention.reason.candidate-retained-prior-case': 'Exact Candidate passed the independent prior case',
  'skills.evaluation.calibration.pass': 'Calibration passed',
  'skills.evaluation.calibration.fail': 'Calibration failed',
  'skills.evaluation.proposerCalls': 'Candidate proposer calls',
  'skills.evaluation.modelCalls': 'Evaluator model calls · baseline/candidate',
  'skills.evaluation.usage': 'Input/cache-read tokens · baseline/candidate',
  'skills.evaluation.release.none': 'No release authority · Evidence only',
  'skills.canary': 'Counterfactual canary',
  'skills.canary.roots': 'configured canary roots',
  'skills.canary.warnings': 'invalid canary states',
  'skills.canary.empty': 'No failed active-Generation Outcome has triggered a canary.',
  'skills.canary.status.prepared': 'Prepared for sealed replay',
  'skills.canary.status.keep': 'Keep active Candidate',
  'skills.canary.status.review': 'Human review required',
  'skills.canary.status.rollback-eligible': 'Future-Session rollback eligible',
  'skills.canary.reason.candidate-regressed-sealed-canary': 'Baseline passed while the exact active Candidate failed',
  'skills.canary.pointer.stable': 'Active pointer remained stable',
  'skills.canary.integrity.stable': 'Sealed inputs remained exact',
  'skills.canary.release.none': 'Evidence only · Cannot move the Generation pointer',
  'skills.active': 'In use',
  'skills.ready': 'Verified, waiting to be enabled',
  'skills.reviewing': 'Waiting for review',
  'skills.lineage.title': 'Exact evolution lineage',
  'skills.lineage.policy': 'Internal author policy',
  'skills.lineage.opportunity': 'Skill Opportunity',
  'skills.lineage.candidate': 'Candidate',
  'skills.lineage.admission': 'Admission',
  'skills.lineage.release.none': 'Candidate had no release authority',
  'status.native': 'Native DSH',
  'status.actions': 'Actionable',
  'action.refresh': 'Refresh',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.inspect': 'Inspect',
  'action.approve': 'Publish inactive',
  'action.reject': 'Reject',
  'action.promote': 'Promote',
  'promotion.status.eligible': 'Eligible for future Sessions',
  'promotion.status.waiting': 'Waiting for independent evidence',
  'promotion.status.blocked': 'Promotion blocked',
  'promotion.retention': 'Retention',
  'promotion.reason.exact-retention-retained': 'Exact Candidate retained prior behavior',
  'promotion.reason.retention-regressed': 'Exact Candidate regressed on prior behavior',
  'action.rollback': 'Rollback',
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'field.note': 'Decision note',
  'section.outcomes': 'Observed delivery outcomes',
  'outcomes.active': 'Active',
  'outcomes.current': 'Current selection',
  'outcomes.parent': 'Parent',
  'outcomes.total': 'total',
  'outcomes.passed': 'passed',
  'outcomes.failed': 'failed',
  'outcomes.unknown': 'unknown',
  'outcomes.metrics.title': 'Measured Goal execution',
  'outcomes.metrics.workspace': 'Workspace metrics',
  'outcomes.metrics.active': 'Active metrics',
  'outcomes.metrics.current': 'Current selection metrics',
  'outcomes.metrics.baseline': 'Parent metrics',
  'outcomes.metrics.measured': 'measured',
  'outcomes.metrics.unmeasured': 'unmeasured',
  'outcomes.metrics.uncachedInput': 'uncached input',
  'outcomes.metrics.output': 'output',
  'outcomes.metrics.cacheRead': 'cache read',
  'outcomes.metrics.cacheWrite': 'cache write',
  'outcomes.metrics.llm': 'LLM',
  'outcomes.metrics.tools': 'tools',
  'outcomes.metrics.ttft': 'TTFT',
  'outcomes.metrics.activeWall': 'active wall',
  'outcomes.metrics.turns': 'attributed turns',
  'outcomes.metrics.closedSteps': 'closed steps',
  'outcomes.metrics.recent': 'Recent measured Outcomes',
  'outcomes.metrics.outcome': 'outcome',
  'outcomes.metrics.event': 'event',
  'outcomes.metrics.priceUnavailable': 'Provider price is unavailable; monetary cost is not inferred.',
  'outcomes.disclaimer': 'Observed counts are descriptive; they do not prove that a Generation caused the difference.',
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
    expect(screen.getByText('Corrections are available, but independent evaluation governance is not configured')).toBeTruthy()
    expect(screen.getByText(/without pretending that evolution ran/u)).toBeTruthy()
    expect(screen.getByText('Mark the assistant answer as problematic')).toBeTruthy()
    expect(screen.getByText(/select “Bad response”, then “Add a note”/u)).toBeTruthy()
    expect(screen.queryByText(/Generation|Shadow|Evaluator/)).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))
    expect(screen.getByText('No evolved Skills yet.')).toBeTruthy()
  })

  it('does not hide a recorded correction when evaluation governance is missing', async () => {
    const api = remote()
    vi.mocked(api.overview).mockImplementationOnce(() => success({
      schemaVersion: 1,
      workspaceId,
      recovery: { available: true, paused: false },
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
    expect(screen.getByText(/governance must be configured before the system can author/u)).toBeTruthy()
    expect(screen.getByText('recorded corrections').parentElement?.textContent).toBe('1recorded corrections')
    expect(screen.queryByText('Nothing needs your attention')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Process recorded correction' })).toBeNull()
  })

  it('records a correction for autonomous internal evaluation without offering a route', async () => {
    const api = remote()
    const configured = remote()
    vi.mocked(api.overview).mockImplementationOnce(async (requestedWorkspaceId: string) => {
      const result = await configured.overview(requestedWorkspaceId)
      if (!result.ok) return result
      return success({
        ...result.value,
        feedbackSignals: { all: 1, selected: 1 },
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
    expect(await screen.findByText('Correction recorded for autonomous evaluation')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Process|Shadow|Evaluator/u })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }))

    expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Independent evaluation governance')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Start Shadow/u })).toBeNull()
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
    expect(screen.getAllByText('Exact evolution lineage')).toHaveLength(3)
    expect(screen.getAllByText(/Candidate · 8{8}…/u)).toHaveLength(3)
    expect(screen.getAllByText(/Admission · a{8}…/u)).toHaveLength(3)
    expect(screen.getAllByText('Candidate had no release authority')).toHaveLength(3)
    expect(screen.queryByText('8'.repeat(64))).toBeNull()
    expect(api.overview).toHaveBeenCalledTimes(1)
  })

  it('shows failed-Outcome canary rollback eligibility without claiming that it rolled back', async () => {
    const api = remote(true)
    const configured = remote(true)
    vi.mocked(api.overview).mockImplementationOnce(async (requestedWorkspaceId) => {
      const result = await configured.overview(requestedWorkspaceId)
      if (!result.ok) return result
      return success({
        ...result.value,
        counterfactualCanary: {
          configuredRootCount: 1,
          warningCount: 0,
          runs: [{
            id: '4'.repeat(64),
            generationId,
            outcomeId: '0'.repeat(64),
            candidateId: discoveredLineage.candidateId,
            skillName: 'build-dsh-plugin',
            reviewId,
            retentionId: 'f'.repeat(64),
            admissionId: discoveredLineage.admissionId,
            evaluationEnvelopeId: discoveredLineage.evaluationEnvelopeId,
            status: 'rollback-eligible' as const,
            reason: 'candidate-regressed-sealed-canary' as const,
            startedAt: '2026-08-21T00:00:00.000Z',
            finishedAt: '2026-08-21T00:01:00.000Z',
            evidence: {
              baseline: 'pass' as const,
              candidate: 'fail' as const,
              calibrationPassed: true,
              assembled: true,
              compositionStable: true,
              inputIntegrityStable: true,
              activePointerStable: true,
              proposerCalls: 0 as const,
              trialCount: 4 as const,
            },
            releaseAuthority: 'none' as const,
          }],
        },
      })
    })
    renderEvolution(api)

    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'Skills' }))

    expect(screen.getByText('Counterfactual canary')).toBeTruthy()
    expect(screen.getByText('Future-Session rollback eligible')).toBeTruthy()
    expect(screen.getByText('Baseline passed while the exact active Candidate failed')).toBeTruthy()
    expect(screen.getByText('Active pointer remained stable')).toBeTruthy()
    expect(screen.getByText('Sealed inputs remained exact')).toBeTruthy()
    expect(screen.getByText('Evidence only · Cannot move the Generation pointer')).toBeTruthy()
    expect(api.rollback).not.toHaveBeenCalled()
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
        skillOpportunities: {
          eligibleCount: 1,
          items: [{
            id: '1'.repeat(64),
            skillName: 'release-native-extension',
            gapIds: ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64), '9'.repeat(64)],
            goalIds: ['goal-1', 'goal-2', 'goal-3', 'goal-4', 'goal-5'],
            gapCount: 5,
            goalCount: 5,
            firstObservedAt: 1_786_895_900_000,
            lastObservedAt: 1_786_896_000_000,
            evidence: internalOpportunityEvidence(),
            evaluationReadiness: {
              status: 'sealed' as const,
              evidenceId: 'e'.repeat(64),
              observedGoalCount: 5,
              authoringGoalCount: 2,
              admissionGoalCount: 1,
              holdoutGoalCount: 1,
              retentionGoalCount: 1,
              proposerCanReadProtectedSamples: false as const,
              releaseAuthority: 'none' as const,
            },
            status: 'eligible-for-authoring' as const,
            releaseAuthority: 'none' as const,
          }],
        },
        skillImprovementOpportunities: {
          waitingCount: 1,
          items: [{
            id: 'c'.repeat(64),
            skillName: 'build-dsh-plugin',
            invocationContentHash: 'd'.repeat(64),
            feedbackSignalIds: ['a'.repeat(64), 'b'.repeat(64)],
            goalIds: ['goal-fix-1', 'goal-fix-2'],
            signalCount: 2,
            goalCount: 2,
            firstObservedAt: 1_786_895_950_000,
            lastObservedAt: 1_786_896_000_000,
            evidence: {
              kind: 'internal-exact-skill-corrections-v1' as const,
              association: 'exact-durable-skill-invocation-content' as const,
              eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content' as const,
              referencesTruncated: false,
              causalClaim: 'none' as const,
            },
            status: 'waiting-for-baseline-bundle' as const,
            releaseAuthority: 'none' as const,
          }],
        },
        slowLoopAuthoring: {
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: '4'.repeat(64),
            targetId: 'missing-release-author',
            skillName: 'missing-release-skill',
            opportunityId: '1'.repeat(64),
            gapCount: 5,
            goalCount: 5,
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
        skillEvaluationGovernance: {
          configuredPolicyCount: 1,
          warningCount: 0,
          runs: [{
            id: '2'.repeat(64),
            policyId: 'workspace-governance',
            skillName: 'release-native-extension',
            opportunityId: '1'.repeat(64),
            evaluationEvidenceId: 'e'.repeat(64),
            phase: 'ready' as const,
            createdAt: '2026-08-18T01:00:01.000Z',
            updatedAt: '2026-08-18T01:00:02.000Z',
            modelCalls: 3,
            inputTokens: 960,
            outputTokens: 360,
            retentionIncluded: true,
            releaseAuthority: 'none' as const,
          }],
        },
        skillCandidates: {
          quarantinedCount: 1,
          items: [{
            id: '7'.repeat(64),
            createdAt: 1_786_896_000_100,
            skillName: 'release-native-extension',
            description: 'Prepare and verify a native DSH release.',
            opportunity: {
              kind: 'internal-experience-v1' as const,
              id: '1'.repeat(64),
              gapIds: ['5'.repeat(64), '6'.repeat(64), '7'.repeat(64), '8'.repeat(64), '9'.repeat(64)],
              goalCount: 5,
            },
            authorship: {
              kind: 'bounded-model-authoring-v1' as const,
              policyId: 'internal-experience-author',
              modelIdentityHash: '4'.repeat(64),
              evaluationEvidenceId: 'e'.repeat(64),
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
            candidateId: '7'.repeat(64),
            skillName: 'release-native-extension',
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
        skillEvaluationRuns: {
          configuredRetentionRootCount: 1,
          warningCount: 0,
          items: [{
            candidateId: '7'.repeat(64),
            skillName: 'release-native-extension',
            lineage: {
              kind: 'internal-skill-candidate-lineage-v3' as const,
              candidateId: '7'.repeat(64),
              workspaceId,
              skillName: 'release-native-extension',
              opportunityId: '1'.repeat(64),
              evaluationEvidenceId: 'e'.repeat(64),
              policyId: 'internal-experience-author',
              versionKind: 'experience-authored-bundle-v1' as const,
              contentHash: 'a'.repeat(64),
              candidateTreeHash: 'b'.repeat(64),
              admissionId: 'e'.repeat(64),
              evaluationEnvelopeId: 'e'.repeat(64),
              releaseAuthority: 'none' as const,
            },
            shadow: {
              runId: 'c'.repeat(64),
              status: 'complete' as const,
              recommendation: 'promote' as const,
              cases: [{
                id: 'assembled-holdout',
                baseline: 'fail' as const,
                candidate: 'pass' as const,
                passedChecks: 8,
                totalChecks: 8,
              }],
              cost: { inputTokens: 0, outputTokens: 0, trialCount: 4 },
              compositionStable: true,
              startedAt: '2026-08-18T01:00:03.000Z',
            },
            retention: {
              id: 'd'.repeat(64),
              status: 'retained' as const,
              reason: 'candidate-retained-prior-case' as const,
              evidence: {
                baseline: 'pass' as const,
                candidate: 'pass' as const,
                calibrationPassed: true,
                compositionStable: true,
                proposerCalls: 0 as const,
                trialCount: 4 as const,
                modelCalls: { baseline: 1, candidate: 1 },
                usage: {
                  baseline: {
                    inputTokens: 12,
                    outputTokens: 2,
                    cacheReadTokens: 4,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0,
                  },
                  candidate: {
                    inputTokens: 10,
                    outputTokens: 2,
                    cacheReadTokens: 6,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0,
                  },
                },
              },
              releaseAuthority: 'none' as const,
            },
            releaseAuthority: 'none' as const,
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
    expect(screen.getByText('goal-1 r3 · Goal content withheld from browser')).toBeTruthy()
    expect(screen.getByText('Confirmed by complete DSH catalog')).toBeTruthy()
    expect(screen.getByText('No Skill was installed or executed.')).toBeTruthy()
    expect(screen.getByText('Self-Skill Candidate opportunities')).toBeTruthy()
    expect(screen.getAllByText('5 distinct Goals · 5 Gap observations')).toHaveLength(2)
    expect(screen.getByText('Discovered from repeated capability gaps across DSH Goals')).toBeTruthy()
    expect(screen.getByText('Evidence Goals · goal-1 · goal-2 · goal-3 · goal-4 · goal-5')).toBeTruthy()
    expect(screen.getByText('Associated internal evidence · explicit corrections: 1 · 1 exactly attributed Goals · delivery outcomes: 2 (passed 1 / failed 1 / unknown 0)')).toBeTruthy()
    expect(screen.getByText('Correction attribution · exact durable Session Skill invocation and Goal revision')).toBeTruthy()
    expect(screen.getByText('Delivery association · same-Goal single-gap-Skill context')).toBeTruthy()
    expect(screen.getByText('No causal claim · no Opportunity or authoring-eligibility effect')).toBeTruthy()
    expect(screen.getByText(`Evidence references · correction ${'2'.repeat(8)}… · outcome ${'3'.repeat(8)}… · outcome ${'4'.repeat(8)}…`)).toBeTruthy()
    expect(screen.getByText(/Independent evaluation evidence sealed · author-visible 2 \/ admission 1 \/ holdout 1 \/ retention 1/u)).toBeTruthy()
    expect(screen.getByText('Candidate proposer cannot read admission, holdout, or retention samples')).toBeTruthy()
    expect(screen.getByText('Eligible for quarantined authoring · No install, activation, or release authority')).toBeTruthy()
    expect(screen.getByText('Existing-Skill improvement investigations')).toBeTruthy()
    expect(screen.getByText('2 distinct Goals · 2 exact corrections')).toBeTruthy()
    expect(screen.getByText(`Invocation content version · ${'d'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText('Evidence Goals · goal-fix-1 · goal-fix-2')).toBeTruthy()
    expect(screen.getByText('Exact association · durable Session invocation-content hash and Goal revision')).toBeTruthy()
    expect(screen.getByText('No causal claim · same-name different-content versions never merge')).toBeTruthy()
    expect(screen.getByText(`Evidence references · correction ${'a'.repeat(8)}… · correction ${'b'.repeat(8)}…`)).toBeTruthy()
    expect(screen.getByText('Waiting for a sealed complete baseline bundle · no Candidate, install, or release')).toBeTruthy()
    expect(screen.getByText('Internal experience-driven Skill authoring')).toBeTruthy()
    expect(screen.getByText('Quarantined candidate ready')).toBeTruthy()
    expect(screen.getByText('Model calls · input/output tokens · 1 · 320/120')).toBeTruthy()
    expect(screen.getByText(`Candidate · ${'3'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText('Quarantined Candidate only · No install, activation, or release')).toBeTruthy()
    expect(screen.getByText('Internally authored Skill candidates')).toBeTruthy()
    expect(screen.getAllByText('release-native-extension').length).toBeGreaterThan(1)
    expect(screen.getByText('Prepare and verify a native DSH release.')).toBeTruthy()
    expect(screen.getByText('Quarantined candidate')).toBeTruthy()
    expect(screen.getByText(`Internal Skill opportunity evidence · 5 distinct Goals · 5 Gap observations · ${'1'.repeat(8)}…`)).toBeTruthy()
    expect(screen.getByText(`Internal author policy · internal-experience-author · input digest ${'5'.repeat(8)}…`)).toBeTruthy()
    expect(screen.getAllByText(`Evaluation evidence seal · ${'e'.repeat(12)}`)).toHaveLength(2)
    expect(screen.getByText(`Internal-experience whole-Skill bundle v1 · artifact digest ${'9'.repeat(12)} · tree ${'b'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText(`Content hash · ${'a'.repeat(12)}`)).toBeTruthy()
    expect(screen.getByText('Declared license · MIT')).toBeTruthy()
    expect(screen.getByText('Whole package · 2 files · 640 bytes · references')).toBeTruthy()
    expect(screen.getByText('Permissions not declared · External effects unknown')).toBeTruthy()
    expect(screen.getByText('Quarantined · Inactive · Never executed · Unevaluated')).toBeTruthy()
    expect(screen.getByText('Independent evaluation governance')).toBeTruthy()
    expect(screen.getByText('Admission, assembled holdout, and independent retention ready')).toBeTruthy()
    expect(screen.getByText('Governance model calls · input/output tokens · 3 · 960/360')).toBeTruthy()
    expect(screen.getByText('Candidate proposer separated · protected samples only')).toBeTruthy()
    expect(screen.getByText('No promotion or release authority')).toBeTruthy()
    expect(screen.queryByText(/Agent Skills|Local Git|Distribution|research Holdout|research revision/u)).toBeNull()
    expect(screen.getByText('Deterministic admission')).toBeTruthy()
    expect(screen.getByText('Qualified for later Shadow')).toBeTruthy()
    expect(screen.getByText(`Evaluation Envelope · ${'e'.repeat(64)}`)).toBeTruthy()
    expect(screen.getAllByText('Baseline fail → Candidate pass · 4 trials')).toHaveLength(2)
    expect(screen.getByText('Deterministic filesystem · Candidate code not executed')).toBeTruthy()
    expect(screen.getByText('No release authority · Not installed or activated')).toBeTruthy()
    expect(screen.getByText('Assembled Shadow and Retention')).toBeTruthy()
    expect(screen.getByText('Assembled Shadow · Holdout recommends promotion')).toBeTruthy()
    expect(screen.getByText('Independent Retention · Retained prior behavior')).toBeTruthy()
    expect(screen.getByText('Baseline pass → Candidate pass · 4 trials')).toBeTruthy()
    expect(screen.getByText('Calibration passed · Non-target composition stable · Candidate proposer calls 0')).toBeTruthy()
    expect(screen.getByText('Evaluator model calls · baseline/candidate · 1/1')).toBeTruthy()
    expect(screen.getByText('Input/cache-read tokens · baseline/candidate · 12/4 · 10/6')).toBeTruthy()
    expect(screen.getByText('No release authority · Evidence only')).toBeTruthy()
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
    expect(within(screen.getByRole('button', { name: 'Evolution' })).getByText('1')).toBeTruthy()
    expect(screen.getByText('Actionable')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    await screen.findByText((_content, element) => element?.tagName === 'PRE' && element.textContent?.includes('-stop') === true)
    expect(api.review).toHaveBeenCalledWith(workspaceId, reviewId)
    expect(screen.getByText('Continue safe work.')).toBeTruthy()
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(screen.getByText('passed')).toBeTruthy()
    expect(screen.getByText('bounded case')).toBeTruthy()
    expect(screen.getAllByText('label.tokens')).toHaveLength(1)

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
    expect(screen.getByText('Measured Goal execution')).toBeTruthy()
    const activeMetrics = screen.getByRole('group', { name: 'Active metrics' })
    expect(within(activeMetrics).getByText(/Active metrics · 1 measured · 2 unmeasured/)).toBeTruthy()
    expect(within(activeMetrics).getByText(/30 uncached input · 9 output · cache read 70 · cache write 5/)).toBeTruthy()
    expect(within(activeMetrics).getByText(/LLM 180 ms · tools 50 ms · TTFT 45 ms · active wall 300 ms/)).toBeTruthy()
    const recent = screen.getByText(/goal-metrics r2 · passed · outcome 00000000… · event 12/).closest('li')!
    expect(within(recent).getByText(/30 uncached input · 9 output · cache read 70 · cache write 5/)).toBeTruthy()
    expect(screen.getByText('Provider price is unavailable; monetary cost is not inferred.')).toBeTruthy()
    expect(screen.getByText(
      'Observed counts are descriptive; they do not prove that a Generation caused the difference.',
    )).toBeTruthy()
  })

  it('shows measured native-DSH outcomes before any evolved Generation exists', async () => {
    const configured = remote(true)
    const api = remote(false)
    vi.mocked(api.overview).mockImplementation(async (requestedWorkspaceId, requestedSessionId) => {
      const result = await configured.overview(requestedWorkspaceId, requestedSessionId)
      if (!result.ok) return result
      const { active: _active, ...value } = result.value
      const { baseline: _baselineCounts, metrics: configuredMetrics, ...deliveryOutcomes } =
        value.deliveryOutcomes!
      const { baseline: _baselineMetrics, ...metrics } = configuredMetrics
      return success({
        ...value,
        deliveryOutcomes: {
          ...deliveryOutcomes,
          metrics,
        },
      })
    })
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await selectAdvanced()

    expect(await screen.findByText('Observed delivery outcomes')).toBeTruthy()
    expect(screen.getByText(/Current selection · Native DSH · 3 total/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Current selection metrics' })).toBeTruthy()
  })

  it('refreshes the currently inspected review from host authority without polling', async () => {
    const api = remote()
    const refreshedResult = await remote().review(workspaceId, reviewId)
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    await screen.findByText('Continue safe work.')
    vi.mocked(api.review).mockResolvedValueOnce(refreshedResult)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Continue safe work.')).toBeTruthy()
    expect(api.review).toHaveBeenCalledTimes(2)
  })

  it('shows the authoritative failure when a listed review is no longer pending before inspection', async () => {
    const api = remote()
    vi.mocked(api.review).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'not_found',
        message: 'Candidate is no longer pending; refresh authoritative state.',
        details: {},
      },
    })
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Candidate is no longer pending; refresh authoritative state.',
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

  it('shows a regressed Retention verdict and disables future-Session promotion', async () => {
    const configured = remote(false, true)
    const api = remote(false, true)
    vi.mocked(api.overview).mockImplementation(async (requestedWorkspaceId, requestedSessionId) => {
      const result = await configured.overview(requestedWorkspaceId, requestedSessionId)
      if (!result.ok) return result
      const inactive = result.value.reviews.inactiveGenerations[0]!
      return success({
        ...result.value,
        reviews: {
          ...result.value.reviews,
          inactiveGenerations: [{
            ...inactive,
            promotion: {
              status: 'blocked' as const,
              reason: 'retention-regressed' as const,
              retentionId: 'f'.repeat(64),
            },
          }],
        },
      })
    })
    renderEvolution(api)
    fireEvent.click(screen.getByRole('button', { name: 'Evolution' }))
    await screen.findByRole('dialog')
    await selectAdvanced()

    expect(screen.getByText(/Promotion blocked · Exact Candidate regressed on prior behavior/u)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Promote' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))
    expect(api.promote).not.toHaveBeenCalled()
  })

})

function webGoalMetrics() {
  return {
    schemaVersion: 1 as const,
    source: 'dsh-session-projections' as const,
    goalId: 'goal-metrics',
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
}

function webMetricRollup(measured: number, unmeasured: number, factor: number) {
  const metrics = webGoalMetrics()
  return {
    measured,
    unmeasured,
    attributedTurns: metrics.attributedTurns * factor,
    closedSteps: metrics.closedSteps * factor,
    activeWallMs: metrics.activeWallMs * factor,
    providerUsage: Object.fromEntries(
      Object.entries(metrics.providerUsage).map(([key, value]) => [key, value * factor]),
    ) as typeof metrics.providerUsage,
    latency: Object.fromEntries(
      Object.entries(metrics.latency).map(([key, value]) => [key, value * factor]),
    ) as typeof metrics.latency,
    monetaryCost: metrics.monetaryCost,
  }
}

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
