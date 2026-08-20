import { useLayoutEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  EvolutionActionReceipt,
  EvolutionArtifactView,
  EvolutionCapabilityView,
  EvolutionDeliveryMetricEvidenceView,
  EvolutionDeliveryMetricRollupView,
  EvolutionExistingSkillEvaluationEvidenceReadinessView,
  EvolutionSkillCandidateLineageView,
  EvolutionOverview,
  EvolutionReviewDetail,
} from 'dsh-evolve/client'
import { remoteValue, type EvolutionRemoteClient } from './remote.ts'

export type EvolutionActionProps = PropsRuntime<'sidebar.footer.action'> & {
  readonly remote: EvolutionRemoteClient
  readonly t: (key: string) => string
}

type ConfirmAction = 'approve' | 'reject' | 'promote' | 'rollback'
type EvolutionView = 'overview' | 'skills' | 'advanced'

/** Sidebar trigger and bounded global evolution control panel. */
export function EvolutionAction({ remote, t, useSessions, useWorkspaces, wide }: EvolutionActionProps) {
  const currentSessionId = useSessions(state => state.current)
  const workspaceId = useWorkspaces(state => currentSessionId === undefined
    ? undefined
    : state.items.find(workspace => workspace.sessionIds.includes(currentSessionId))?.workspaceId)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<EvolutionView>('overview')
  const [overview, setOverview] = useState<EvolutionOverview>()
  const [detail, setDetail] = useState<EvolutionReviewDetail>()
  const [note, setNote] = useState('')
  const [promotionTarget, setPromotionTarget] = useState<string>()
  const [rollbackCanaryId, setRollbackCanaryId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [confirm, setConfirm] = useState<ConfirmAction>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const workspaceRef = useRef(workspaceId)
  const sessionRef = useRef(currentSessionId)
  workspaceRef.current = workspaceId
  sessionRef.current = currentSessionId

  const resetWorkspaceState = () => {
    setView('overview')
    setOverview(undefined)
    setDetail(undefined)
    setNote('')
    setPromotionTarget(undefined)
    setRollbackCanaryId(undefined)
    setNotice(undefined)
    setConfirm(undefined)
  }

  const loadOverview = async (
    targetWorkspaceId = workspaceId,
    targetSessionId = currentSessionId,
  ) => {
    if (targetWorkspaceId === undefined || targetSessionId === undefined) {
      setError(t('error.workspaceRequired'))
      return
    }
    setError(undefined)
    try {
      const next = requireWorkspace(
        targetWorkspaceId,
        await remoteValue(remote.overview(targetWorkspaceId, targetSessionId)),
        value => value.workspaceId,
      )
      if (workspaceRef.current === targetWorkspaceId && sessionRef.current === targetSessionId) setOverview(next)
    } catch (cause) {
      if (workspaceRef.current === targetWorkspaceId && sessionRef.current === targetSessionId) setError(message(cause))
    }
  }

  const refreshVisibleState = async () => {
    if (workspaceId === undefined || currentSessionId === undefined) {
      setError(t('error.workspaceRequired'))
      return
    }
    const targetWorkspaceId = workspaceId
    const targetSessionId = currentSessionId
    setBusy(true)
    setError(undefined)
    try {
      const nextOverview = requireWorkspace(
        targetWorkspaceId,
        await remoteValue(remote.overview(targetWorkspaceId, targetSessionId)),
        value => value.workspaceId,
      )
      if (workspaceRef.current !== targetWorkspaceId || sessionRef.current !== targetSessionId) return
      setOverview(nextOverview)
      if (detail !== undefined) {
        try {
          const nextDetail = requireWorkspace(
            targetWorkspaceId,
            await remoteValue(remote.review(targetWorkspaceId, detail.review.id)),
            value => value.review.workspaceId,
          )
          if (workspaceRef.current === targetWorkspaceId) setDetail(nextDetail)
        } catch (cause) {
          setDetail(undefined)
          throw cause
        }
      }
    } catch (cause) {
      if (workspaceRef.current === targetWorkspaceId && sessionRef.current === targetSessionId) setError(message(cause))
    } finally {
      if (workspaceRef.current === targetWorkspaceId && sessionRef.current === targetSessionId) setBusy(false)
    }
  }

  useLayoutEffect(() => {
    resetWorkspaceState()
    setError(undefined)
    setBusy(false)
    if (open) void loadOverview(workspaceId, currentSessionId)
  }, [open, workspaceId, currentSessionId])

  const inspect = async (id: string) => {
    if (workspaceId === undefined) {
      setError(t('error.workspaceRequired'))
      return
    }
    const targetWorkspaceId = workspaceId
    setBusy(true)
    setError(undefined)
    try {
      const next = requireWorkspace(
        targetWorkspaceId,
        await remoteValue(remote.review(targetWorkspaceId, id)),
        value => value.review.workspaceId,
      )
      if (workspaceRef.current !== targetWorkspaceId) return
      setDetail(next)
      setNote('')
    } catch (cause) {
      if (workspaceRef.current === targetWorkspaceId) setError(message(cause))
    } finally {
      if (workspaceRef.current === targetWorkspaceId) setBusy(false)
    }
  }

  const run = async (request: () => Promise<EvolutionActionReceipt>) => {
    if (workspaceId === undefined) {
      setError(t('error.workspaceRequired'))
      return
    }
    const targetWorkspaceId = workspaceId
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    setConfirm(undefined)
    try {
      const receipt = requireWorkspace(targetWorkspaceId, await request(), value => value.workspaceId)
      if (workspaceRef.current !== targetWorkspaceId) return
      if (receipt.action === 'promote') setPromotionTarget(undefined)
      if (receipt.action === 'rollback') setRollbackCanaryId(undefined)
      if (receipt.action === 'approve-review' || receipt.action === 'reject-review') {
        setDetail(undefined)
      }
      setNotice(t('notice.done'))
      await loadOverview(targetWorkspaceId)
    } catch (cause) {
      if (workspaceRef.current === targetWorkspaceId) setError(message(cause))
    } finally {
      if (workspaceRef.current === targetWorkspaceId) setBusy(false)
    }
  }

  const executeConfirmed = () => {
    if (workspaceId === undefined) {
      setConfirm(undefined)
      setError(t('error.workspaceRequired'))
      return
    }
    if (confirm === 'approve' && detail !== undefined) {
      void run(() => remoteValue(remote.approveReview(workspaceId, detail.review.id, note.trim())))
    } else if (confirm === 'reject' && detail !== undefined) {
      void run(() => remoteValue(remote.rejectReview(workspaceId, detail.review.id, note.trim())))
    } else if (confirm === 'promote' && promotionTarget !== undefined) {
      void run(() => remoteValue(remote.promote(workspaceId, promotionTarget)))
    } else if (confirm === 'rollback') {
      void run(() => remoteValue(remote.rollback(workspaceId, rollbackCanaryId)))
    }
  }

  const close = () => {
    setOpen(false)
    setConfirm(undefined)
    triggerRef.current?.focus()
  }

  const pending = actionableCount(overview)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dsh-evolve-trigger"
        aria-label={t('trigger.label')}
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span aria-hidden="true">↻</span>
        {wide && <span>{t('trigger.label')}</span>}
        {pending > 0 && <span className="dsh-evolve-badge">{pending}</span>}
      </button>
      {open && (
        <section className="dsh-evolve-panel" role="dialog" aria-label={t('panel.title')}>
          <header className="dsh-evolve-head">
            <h2 className="dsh-evolve-title">{t('panel.title')}</h2>
            <button type="button" className="dsh-evolve-close" aria-label={t('panel.close')} onClick={close}>×</button>
          </header>
          <nav className="dsh-evolve-tabs" role="tablist" aria-label={t('view.label')}>
            {(['overview', 'skills', 'advanced'] as const).map(item => (
              <button
                type="button"
                role="tab"
                aria-selected={view === item}
                className={`dsh-evolve-tab${view === item ? ' dsh-evolve-tab-active' : ''}`}
                key={item}
                onClick={() => {
                  setView(item)
                  setDetail(undefined)
                }}
              >
                {t(`view.${item}`)}
              </button>
            ))}
          </nav>
          <div className="dsh-evolve-body">
            {overview === undefined && error === undefined && <div className="dsh-evolve-message">{t('status.loading')}</div>}
            {notice !== undefined && <div className="dsh-evolve-message" role="status">{notice}</div>}
            {error !== undefined && <div className="dsh-evolve-message dsh-evolve-error" role="alert">{t('error.prefix')}{error}</div>}
            {overview !== undefined && view === 'overview' && (
              <BeginnerOverview summary={overview} openAdvanced={() => setView('advanced')} t={t} />
            )}
            {overview !== undefined && view === 'skills' && (
              <SkillsView
                summary={overview}
                busy={busy}
                rollbackEligible={(canaryId) => {
                  setRollbackCanaryId(canaryId)
                  setConfirm('rollback')
                }}
                t={t}
              />
            )}
            {view === 'advanced' && <>
              {overview !== undefined && <Overview summary={overview} t={t} />}
              <div className="dsh-evolve-actions">
                <button type="button" className="dsh-evolve-button" disabled={busy} onClick={() => { void refreshVisibleState() }}>{t('action.refresh')}</button>
                {overview?.recovery.available === true && (
                  <button
                    type="button"
                    className="dsh-evolve-button"
                    disabled={busy}
                    onClick={() => { void run(() => remoteValue(overview.recovery.paused === true ? remote.resume(workspaceId!) : remote.pause(workspaceId!))) }}
                  >
                    {t(overview.recovery.paused === true ? 'action.resume' : 'action.pause')}
                  </button>
                )}
                {overview?.active !== undefined && (
                  <button type="button" className="dsh-evolve-button dsh-evolve-danger" disabled={busy} onClick={() => {
                    setRollbackCanaryId(undefined)
                    setConfirm('rollback')
                  }}>
                    {t('action.rollback')}
                  </button>
                )}
              </div>
              {detail === undefined
              ? <ReviewQueue
                  overview={overview}
                  busy={busy}
                  inspect={inspect}
                  promote={(generationId) => {
                    setPromotionTarget(generationId)
                    setConfirm('promote')
                  }}
                  t={t}
                />
              : detail !== undefined ? (
                  <ReviewDetail
                    detail={detail}
                    note={note}
                    busy={busy}
                    setNote={setNote}
                    back={() => setDetail(undefined)}
                    confirm={setConfirm}
                    t={t}
                  />
                ) : null}
            </>}
          </div>
        </section>
      )}
      {confirm !== undefined && (
        <div className="dsh-evolve-confirm-backdrop">
          <div className="dsh-evolve-confirm" role="alertdialog" aria-modal="true">
            <p>{t(`confirm.${confirm}`)}</p>
            <div className="dsh-evolve-actions">
              <button type="button" className="dsh-evolve-button" onClick={() => {
                setConfirm(undefined)
                if (confirm === 'rollback') setRollbackCanaryId(undefined)
              }}>{t('action.cancel')}</button>
              <button type="button" className="dsh-evolve-button dsh-evolve-primary" onClick={executeConfirmed}>{t('action.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function BeginnerOverview({ summary, openAdvanced, t }: {
  summary: EvolutionOverview
  openAdvanced: () => void
  t: (key: string) => string
}) {
  const pending = actionableCount(summary)
  const activeSkills = summary.active?.artifacts.filter(isSkillArtifact).length ?? 0
  const corrections = recordedCorrectionCount(summary)
  const verificationConfigured = hasVerificationTarget(summary)
  const headline = pending > 0
    ? `${pending} ${t('onboarding.actionable')}`
    : corrections > 0
      ? t(verificationConfigured ? 'onboarding.feedbackReady' : 'onboarding.feedbackBlocked')
      : verificationConfigured
        ? t('onboarding.idle')
        : t('onboarding.verificationMissing')
  const explanation = pending > 0 || (corrections === 0 && verificationConfigured)
    ? t('onboarding.intro')
    : corrections > 0
      ? t(verificationConfigured ? 'onboarding.feedbackReadyHelp' : 'onboarding.feedbackBlockedHelp')
      : t('onboarding.verificationMissingHelp')
  return <>
    <section className="dsh-evolve-welcome">
      <div className="dsh-evolve-eyebrow">{t('onboarding.eyebrow')}</div>
      <h3>{headline}</h3>
      <p>{explanation}</p>
      {pending > 0 && (
        <button type="button" className="dsh-evolve-button dsh-evolve-primary" onClick={openAdvanced}>
          {t('onboarding.review')}
        </button>
      )}
    </section>
    <div className="dsh-evolve-simple-summary">
      <div><strong>{activeSkills}</strong><span>{t('onboarding.activeSkills')}</span></div>
      <div><strong>{pending}</strong><span>{t('onboarding.pending')}</span></div>
      <div><strong>{corrections}</strong><span>{t('onboarding.recorded')}</span></div>
    </div>
    <section>
      <h3 className="dsh-evolve-section-title">{t('onboarding.how')}</h3>
      <ol className="dsh-evolve-steps">
        <li><span>1</span><div><strong>{t('onboarding.step.correct')}</strong><p>{t('onboarding.step.correctHelp')}</p></div></li>
        <li><span>2</span><div><strong>{t('onboarding.step.verify')}</strong><p>{t('onboarding.step.verifyHelp')}</p></div></li>
        <li><span>3</span><div><strong>{t('onboarding.step.decide')}</strong><p>{t('onboarding.step.decideHelp')}</p></div></li>
      </ol>
      <p className="dsh-evolve-guidance">{t('onboarding.hint')}</p>
    </section>
  </>
}

function recordedCorrectionCount(summary: EvolutionOverview): number {
  return summary.feedbackSignals?.all ?? 0
}

function hasVerificationTarget(summary: EvolutionOverview): boolean {
  return (summary.skillEvaluationGovernance?.configuredPolicyCount ?? 0) > 0
    || (summary.skillAdmission?.configuredPolicyCount ?? 0) > 0
}

function SkillsView({ summary, busy, rollbackEligible, t }: {
  summary: EvolutionOverview
  busy: boolean
  rollbackEligible: (canaryId: string) => void
  t: (key: string) => string
}) {
  const active = summary.active?.artifacts.filter(isSkillArtifact) ?? []
  const ready = summary.reviews.inactiveGenerations
  const reviewing = summary.reviews.items.filter(review => review.status === 'pending')
  const empty = active.length === 0 && ready.length === 0 && reviewing.length === 0
  return <>
    <section className="dsh-evolve-skill-intro">
      <h3>{t('skills.title')}</h3>
      <p>{t('skills.description')}</p>
    </section>
    <CapabilityMap summary={summary} t={t} />
    <CapabilityGapQueue summary={summary} t={t} />
    <SkillOpportunities summary={summary} t={t} />
    <SkillImprovementOpportunities summary={summary} t={t} />
    <ExistingSkillAuthoring summary={summary} t={t} />
    <SlowLoopAuthoring summary={summary} t={t} />
    <SkillCandidates summary={summary} t={t} />
    <ExistingSkillCandidates summary={summary} t={t} />
    <SkillEvaluationGovernance summary={summary} t={t} />
    <SkillAdmission summary={summary} t={t} />
    <SkillEvaluationRuns summary={summary} t={t} />
    <CounterfactualCanaryRuns
      summary={summary}
      busy={busy}
      rollbackEligible={rollbackEligible}
      t={t}
    />
    {empty && <div className="dsh-evolve-message">{t('skills.empty')}</div>}
    {active.length > 0 && <SkillGroup t={t} label={t('skills.active')} items={active.map(artifact => ({
      key: `active:${artifact.gitCommit ?? artifact.artifactDigest}:${artifact.name}`,
      name: artifact.name,
      detail: t('skills.activeHelp'),
      ...(artifact.lineage === undefined ? {} : { lineage: artifact.lineage }),
    }))} />}
    {ready.length > 0 && <SkillGroup t={t} label={t('skills.ready')} items={ready.map(item => ({
      key: `ready:${item.generationId}:${item.skillName}`,
      name: item.skillName,
      detail: `${t(`promotion.status.${item.promotion.status}`)} · ${t(`promotion.reason.${item.promotion.reason}`)}`,
      ...(item.lineage === undefined ? {} : { lineage: item.lineage }),
    }))} />}
    {reviewing.length > 0 && <SkillGroup t={t} label={t('skills.reviewing')} items={reviewing.map(item => ({
      key: `review:${item.id}:${item.skillName}`,
      name: item.skillName,
      detail: item.claim,
      ...(item.lineage === undefined ? {} : { lineage: item.lineage }),
    }))} />}
    <p className="dsh-evolve-guidance">{t('skills.native')}</p>
  </>
}

function isSkillArtifact(artifact: EvolutionArtifactView): boolean {
  return artifact.kind === 'skill' || artifact.kind === 'skill-bundle'
}

function SkillAdmission({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const admission = summary.skillAdmission
  if (admission === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.admission')}</h3>
      <span className="dsh-evolve-catalog-status">
        {admission.configuredPolicyCount} {t('skills.admission.policies')}
      </span>
    </div>
    {admission.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {admission.warningCount} {t('skills.admission.warnings')}
    </div>}
    {admission.results.length === 0
      ? <div className="dsh-evolve-message">{t('skills.admission.empty')}</div>
      : <ul className="dsh-evolve-list">{admission.results.map(value => (
          <li className="dsh-evolve-skill-card" key={value.id}>
            <div className="dsh-evolve-review-skill">{value.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t(`skills.admission.status.${value.status}`)}
            </div>
            {value.envelopeId !== undefined && <div className="dsh-evolve-meta">
              {t('skills.admission.envelope')} · {value.envelopeId}
            </div>}
            {value.evidence !== undefined && <>
              <div className="dsh-evolve-meta">{admissionComparison(value.evidence, t)}</div>
              <div className="dsh-evolve-meta">{t('skills.admission.governance')}</div>
            </>}
            {value.reasons.map(reason => (
              <div className="dsh-evolve-meta" key={reason}>{t(`skills.admission.reason.${reason}`)}</div>
            ))}
            <div className="dsh-evolve-discovery-state">{t('skills.admission.release.none')}</div>
          </li>
        ))}</ul>}
  </section>
}

function SkillEvaluationRuns({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const evaluation = summary.skillEvaluationRuns
  if (evaluation === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.evaluation')}</h3>
      <span className="dsh-evolve-catalog-status">
        {evaluation.configuredRetentionRootCount} {t('skills.evaluation.roots')}
      </span>
    </div>
    {evaluation.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {evaluation.warningCount} {t('skills.evaluation.warnings')}
    </div>}
    {evaluation.items.length === 0
      ? <div className="dsh-evolve-message">{t('skills.evaluation.empty')}</div>
      : <ul className="dsh-evolve-list">{evaluation.items.map(run => (
          <li className="dsh-evolve-skill-card" key={`${run.candidateId}:${run.shadow.runId}`}>
            <div className="dsh-evolve-review-skill">{run.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t('skills.evaluation.shadow')} · {t(`skills.evaluation.recommendation.${run.shadow.recommendation}`)}
            </div>
            {run.shadow.cases.map(value => <div className="dsh-evolve-meta" key={value.id}>
              {evaluationComparison(value.baseline, value.candidate, run.shadow.cost.trialCount, t)}
            </div>)}
            <div className="dsh-evolve-meta">
              {t(run.shadow.compositionStable
                ? 'skills.evaluation.composition.stable'
                : 'skills.evaluation.composition.changed')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.lineage.candidate')} · {shortId(run.candidateId)}
              {' · '}{t('skills.lineage.admission')} · {shortId(run.lineage.admissionId)}
              {' · '}{t('skills.admission.envelope')} · {shortId(run.lineage.evaluationEnvelopeId)}
            </div>
            {run.retention === undefined
              ? <div className="dsh-evolve-capability-route">
                  {t('skills.evaluation.retention')} · {t('skills.evaluation.retention.notRun')}
                </div>
              : <>
                  <div className="dsh-evolve-capability-route">
                    {t('skills.evaluation.retention')} · {t(`skills.evaluation.retention.status.${run.retention.status}`)}
                  </div>
                  {run.retention.evidence !== undefined && <>
                    <div className="dsh-evolve-meta">
                      {evaluationComparison(
                        run.retention.evidence.baseline,
                        run.retention.evidence.candidate,
                        run.retention.evidence.trialCount,
                        t,
                      )}
                    </div>
                    <div className="dsh-evolve-meta">
                      {t(run.retention.evidence.calibrationPassed
                        ? 'skills.evaluation.calibration.pass'
                        : 'skills.evaluation.calibration.fail')}
                      {' · '}{t(run.retention.evidence.compositionStable
                        ? 'skills.evaluation.composition.stable'
                        : 'skills.evaluation.composition.changed')}
                      {' · '}{t('skills.evaluation.proposerCalls')} {run.retention.evidence.proposerCalls}
                    </div>
                    {run.retention.evidence.modelCalls !== undefined && <div className="dsh-evolve-meta">
                      {t('skills.evaluation.modelCalls')} · {run.retention.evidence.modelCalls.baseline}/{run.retention.evidence.modelCalls.candidate}
                    </div>}
                    {run.retention.evidence.usage !== undefined && <div className="dsh-evolve-meta">
                      {t('skills.evaluation.usage')} · {run.retention.evidence.usage.baseline.inputTokens}/{run.retention.evidence.usage.baseline.cacheReadTokens}
                      {' · '}{run.retention.evidence.usage.candidate.inputTokens}/{run.retention.evidence.usage.candidate.cacheReadTokens}
                    </div>}
                  </>}
                  {run.retention.reason !== undefined && <div className="dsh-evolve-meta">
                    {t(`skills.evaluation.retention.reason.${run.retention.reason}`)}
                  </div>}
                </>}
            <div className="dsh-evolve-discovery-state">{t('skills.evaluation.release.none')}</div>
          </li>
        ))}</ul>}
  </section>
}

function evaluationComparison(
  baseline: 'pass' | 'fail' | 'incomplete',
  candidate: 'pass' | 'fail' | 'incomplete',
  trialCount: number,
  t: (key: string) => string,
): string {
  return `${t('skills.evaluation.baseline')} ${t(`skills.evaluation.outcome.${baseline}`)}`
    + ` → ${t('skills.evaluation.candidate')} ${t(`skills.evaluation.outcome.${candidate}`)}`
    + ` · ${trialCount} ${t('skills.evaluation.trials')}`
}

function CounterfactualCanaryRuns({
  summary,
  busy,
  rollbackEligible,
  t,
}: {
  summary: EvolutionOverview
  busy: boolean
  rollbackEligible: (canaryId: string) => void
  t: (key: string) => string
}) {
  const canary = summary.counterfactualCanary
  if (canary === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.canary')}</h3>
      <span className="dsh-evolve-catalog-status">
        {canary.configuredRootCount} {t('skills.canary.roots')}
      </span>
    </div>
    {canary.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {canary.warningCount} {t('skills.canary.warnings')}
    </div>}
    {canary.runs.length === 0
      ? <div className="dsh-evolve-message">{t('skills.canary.empty')}</div>
      : <ul className="dsh-evolve-list">{canary.runs.map(run => (
          <li className="dsh-evolve-skill-card" key={run.id}>
            <div className="dsh-evolve-review-skill">{run.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t(`skills.canary.status.${run.status}`)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.lineage.candidate')} · {shortId(run.candidateId)}
              {' · '}{t('skills.canary.outcome')} · {shortId(run.outcomeId)}
            </div>
            {run.evidence !== undefined && <>
              <div className="dsh-evolve-meta">
                {evaluationComparison(
                  run.evidence.baseline,
                  run.evidence.candidate,
                  run.evidence.trialCount,
                  t,
                )}
              </div>
              <div className="dsh-evolve-meta">
                {t(run.evidence.activePointerStable
                  ? 'skills.canary.pointer.stable'
                  : 'skills.canary.pointer.changed')}
              </div>
              <div className="dsh-evolve-meta">
                {t(run.evidence.inputIntegrityStable
                  ? 'skills.canary.integrity.stable'
                  : 'skills.canary.integrity.changed')}
              </div>
              <div className="dsh-evolve-meta">
                {t(run.evidence.assembled
                  ? 'skills.canary.assembled'
                  : 'skills.canary.notAssembled')}
                {' · '}{t(run.evidence.calibrationPassed
                  ? 'skills.evaluation.calibration.pass'
                  : 'skills.evaluation.calibration.fail')}
                {' · '}{t(run.evidence.compositionStable
                  ? 'skills.evaluation.composition.stable'
                  : 'skills.evaluation.composition.changed')}
              </div>
              {run.evidence.modelCalls !== undefined && <div className="dsh-evolve-meta">
                {t('skills.evaluation.modelCalls')} · {run.evidence.modelCalls.baseline}/{run.evidence.modelCalls.candidate}
              </div>}
              {run.evidence.usage !== undefined && <div className="dsh-evolve-meta">
                {t('skills.evaluation.usage')} · {run.evidence.usage.baseline.inputTokens}/{run.evidence.usage.baseline.cacheReadTokens}
                {' · '}{run.evidence.usage.candidate.inputTokens}/{run.evidence.usage.candidate.cacheReadTokens}
              </div>}
            </>}
            {run.reason !== undefined && <div className="dsh-evolve-meta">
              {t(`skills.canary.reason.${run.reason}`)}
            </div>}
            <div className="dsh-evolve-discovery-state">{t('skills.canary.release.none')}</div>
            {run.status === 'rollback-eligible' && <button
              type="button"
              className="dsh-evolve-button dsh-evolve-danger"
              disabled={busy}
              onClick={() => rollbackEligible(run.id)}
            >
              {t('skills.canary.action.rollback')}
            </button>}
          </li>
        ))}</ul>}
  </section>
}

function SkillEvaluationGovernance({
  summary,
  t,
}: {
  summary: EvolutionOverview
  t: (key: string) => string
}) {
  const governance = summary.skillEvaluationGovernance
  if (governance === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.governance')}</h3>
      <span className="dsh-evolve-catalog-status">
        {governance.configuredPolicyCount} {t('skills.governance.policies')}
      </span>
    </div>
    {governance.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {governance.warningCount} {t('skills.governance.warnings')}
    </div>}
    {governance.runs.length === 0
      ? <div className="dsh-evolve-message">{t('skills.governance.empty')}</div>
      : <ul className="dsh-evolve-list">{governance.runs.map(run => (
          <li className="dsh-evolve-skill-card" key={run.id}>
            <div className="dsh-evolve-review-skill">{run.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t(run.phase === 'ready' && run.retentionIncluded
                ? 'skills.governance.phase.readyWithRetention'
                : `skills.governance.phase.${run.phase}`)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.governance.cost')} · {run.modelCalls} · {run.inputTokens}/{run.outputTokens}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.lineage.evidence')} · {run.evaluationEvidenceId.slice(0, 12)}
            </div>
            <div className="dsh-evolve-meta">{t('skills.governance.separation')}</div>
            {run.pendingRole !== undefined && <div className="dsh-evolve-meta">
              {t('skills.governance.pending')} · {t(`skills.governance.role.${run.pendingRole}`)}
            </div>}
            {run.retryAt !== undefined && <div className="dsh-evolve-meta">
              {t('skills.governance.retry')} · {new Date(run.retryAt).toLocaleString()}
            </div>}
            {run.failure !== undefined && <div className="dsh-evolve-meta">
              {t(`skills.governance.failure.${run.failure}`)}
            </div>}
            <div className="dsh-evolve-discovery-state">{t('skills.governance.release.none')}</div>
          </li>
        ))}</ul>}
  </section>
}

function admissionComparison(
  value: NonNullable<EvolutionOverview['skillAdmission']>['results'][number]['evidence'] & {},
  t: (key: string) => string,
): string {
  return `${t('skills.admission.baseline')} ${t(`skills.admission.outcome.${value.baseline}`)}`
    + ` → ${t('skills.admission.candidate')} ${t(`skills.admission.outcome.${value.candidate}`)}`
    + ` · ${value.trialCount} ${t('skills.admission.trials')}`
}

function SkillCandidates({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const candidates = summary.skillCandidates
  if (candidates === undefined) return null
  return <>
    <section>
      <h3 className="dsh-evolve-section-title">{t('skills.discovery')}</h3>
      {candidates.items.length === 0
        ? <div className="dsh-evolve-message">{t('skills.discovery.empty')}</div>
        : <ul className="dsh-evolve-list">{candidates.items.map(candidate => (
            <li className="dsh-evolve-skill-card" key={candidate.id}>
              <div className="dsh-evolve-review-skill">{candidate.skillName}</div>
              <p>{candidate.description}</p>
              <div className="dsh-evolve-meta">
                {t('skills.discovery.demand')} · {candidate.opportunity.goalCount} {t('skills.opportunities.goals')}
                {' · '}{candidate.opportunity.gapIds.length} {t('skills.opportunities.observations')}
                {' · '}{shortId(candidate.opportunity.id)}
              </div>
              <div className="dsh-evolve-capability-route">{t('skills.discovery.quarantined')}</div>
              <div className="dsh-evolve-meta">
                {t('skills.discovery.author')} · {candidate.authorship.policyId}
                {' · '}{t('skills.discovery.input')} {shortId(candidate.authorship.inputDigest)}
              </div>
              <div className="dsh-evolve-meta">
                {t('skills.lineage.evidence')} · {candidate.authorship.evaluationEvidenceId.slice(0, 12)}
              </div>
              <div className="dsh-evolve-meta">
                {skillVersionSummary(candidate.version, t)}
              </div>
              <div className="dsh-evolve-meta">
                {t('skills.discovery.content')} · {candidate.contentHash.slice(0, 12)}
              </div>
              {candidate.license !== undefined && <div className="dsh-evolve-meta">
                {candidate.license.status === 'declared'
                  ? `${t('skills.discovery.license')} · ${candidate.license.value}`
                  : t('skills.discovery.license.unknown')}
              </div>}
              <div className="dsh-evolve-meta">
                {skillPackageSummary(candidate.package, t)}
              </div>
              <div className="dsh-evolve-meta">
                {skillPermissionSummary(candidate.permissions, t)}
              </div>
              <div className="dsh-evolve-discovery-state">{t('skills.discovery.state')}</div>
            </li>
          ))}</ul>}
    </section>
  </>
}

function ExistingSkillCandidates({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const candidates = summary.existingSkillCandidates
  if (candidates === undefined) return null
  return <section>
    <h3 className="dsh-evolve-section-title">{t('skills.improvements.candidates')}</h3>
    {candidates.items.length === 0
      ? <div className="dsh-evolve-message">{t('skills.improvements.candidates.empty')}</div>
      : <ul className="dsh-evolve-list">{candidates.items.map(candidate => (
          <li className="dsh-evolve-skill-card" key={candidate.id}>
            <div className="dsh-evolve-review-skill">{candidate.skillName}</div>
            <p>{candidate.description}</p>
            <div className="dsh-evolve-capability-route">
              {candidate.opportunity.goalCount} {t('skills.opportunities.goals')}
              {' · '}{candidate.opportunity.signalCount} {t('skills.improvements.corrections')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.improvements.candidates.baseline')} · {shortId(candidate.baseline.id)}
              {' · '}{shortId(candidate.baseline.treeHash)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.improvements.candidates.candidate')} · {shortId(candidate.version.treeHash)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.improvements.candidates.changed')} · {candidate.diff.changedPaths.join(' · ')}
            </div>
            {candidate.diff.addedPaths.length > 0 && <div className="dsh-evolve-meta">
              {t('skills.improvements.candidates.added')} · {candidate.diff.addedPaths.join(' · ')}
            </div>}
            <div className="dsh-evolve-meta">
              {t('skills.improvements.candidates.preserved')} · {candidate.diff.preservedFileCount} {t('skills.improvements.files')}
              {' · '}{candidate.diff.preservedBinaryFileCount} {t('skills.improvements.candidates.binary')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.discovery.author')} · {candidate.authorship.policyId}
              {' · '}{t('skills.lineage.evidence')} · {shortId(candidate.authorship.evaluationEvidenceId)}
            </div>
            <div className="dsh-evolve-discovery-state">{t('skills.improvements.candidates.state')}</div>
          </li>
        ))}</ul>}
  </section>
}

function ExistingSkillAuthoring({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const authoring = summary.existingSkillAuthoring
  if (authoring === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.improvements.authoring')}</h3>
      <span className="dsh-evolve-catalog-status">
        {authoring.configuredPolicyCount} {t('skills.improvements.authoring.policies')}
      </span>
    </div>
    {authoring.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {authoring.warningCount} {t('skills.improvements.authoring.warnings')}
    </div>}
    {authoring.runs.length === 0
      ? <div className="dsh-evolve-message">{t('skills.improvements.authoring.empty')}</div>
      : <ul className="dsh-evolve-list">{authoring.runs.map(run => (
          <li className="dsh-evolve-skill-card" key={run.id}>
            <div className="dsh-evolve-review-skill">{run.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t(`skills.slow-loop.phase.${run.phase}`)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.improvements.authoring.baseline')} · {shortId(run.baselineId)} / {shortId(run.qualificationId)} / {shortId(run.evaluationEvidenceId)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.slow-loop.cost')} · {run.modelCalls} · {run.inputTokens}/{run.outputTokens}
            </div>
            {run.candidateId !== undefined && <div className="dsh-evolve-meta">
              {t('skills.slow-loop.candidate')} · {run.candidateId.slice(0, 12)}
            </div>}
            {run.retryAt !== undefined && <div className="dsh-evolve-meta">
              {t('skills.slow-loop.retry')} · {new Date(run.retryAt).toLocaleString()}
            </div>}
            <div className="dsh-evolve-discovery-state">{t('skills.slow-loop.release.none')}</div>
          </li>
        ))}</ul>}
  </section>
}

function skillVersionSummary(
  value: NonNullable<EvolutionOverview['skillCandidates']>['items'][number]['version'],
  t: (key: string) => string,
): string {
  return `${t('skills.discovery.version.experience-bundle')}`
    + ` · ${t('skills.discovery.artifact')} ${value.artifactDigest.slice(0, 12)}`
    + ` · ${t('skills.discovery.tree')} ${value.treeHash.slice(0, 12)}`
}

function SlowLoopAuthoring({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const authoring = summary.slowLoopAuthoring
  if (authoring === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.slow-loop')}</h3>
      <span className="dsh-evolve-catalog-status">
        {authoring.configuredPolicyCount} {t('skills.slow-loop.policies')}
      </span>
    </div>
    {authoring.warningCount > 0 && <div className="dsh-evolve-message dsh-evolve-error">
      {authoring.warningCount} {t('skills.slow-loop.warnings')}
    </div>}
    {authoring.runs.length === 0
      ? <div className="dsh-evolve-message">{t('skills.slow-loop.empty')}</div>
      : <ul className="dsh-evolve-list">{authoring.runs.map(run => (
          <li className="dsh-evolve-skill-card" key={run.id}>
            <div className="dsh-evolve-review-skill">{run.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {t(`skills.slow-loop.phase.${run.phase}`)}
            </div>
            <div className="dsh-evolve-meta">
              {run.goalCount} {t('skills.opportunities.goals')} · {run.gapCount} {t('skills.opportunities.observations')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.slow-loop.cost')} · {run.modelCalls} · {run.inputTokens}/{run.outputTokens}
            </div>
            {run.candidateId !== undefined && <div className="dsh-evolve-meta">
              {t('skills.slow-loop.candidate')} · {run.candidateId.slice(0, 12)}
            </div>}
            {run.retryAt !== undefined && <div className="dsh-evolve-meta">
              {t('skills.slow-loop.retry')} · {new Date(run.retryAt).toLocaleString()}
            </div>}
            <div className="dsh-evolve-discovery-state">{t('skills.slow-loop.release.none')}</div>
          </li>
        ))}</ul>}
  </section>
}

function skillPackageSummary(
  value: NonNullable<EvolutionOverview['skillCandidates']>['items'][number]['package'],
  t: (key: string) => string,
): string {
  return [
    t('skills.discovery.package'),
    `${value.fileCount} ${t('skills.discovery.files')}`,
    `${value.totalBytes} ${t('skills.discovery.bytes')}`,
    ...(value.hasScripts ? [t('skills.discovery.scripts')] : []),
    ...(value.hasReferences ? [t('skills.discovery.references')] : []),
  ].join(' · ')
}

function skillPermissionSummary(
  value: NonNullable<EvolutionOverview['skillCandidates']>['items'][number]['permissions'],
  t: (key: string) => string,
): string {
  return [
    t(value.declared
      ? 'skills.discovery.permissions.declared'
      : 'skills.discovery.permissions.undeclared'),
    ...(value.executableContent ? [t('skills.discovery.executable')] : []),
    t(`skills.discovery.effects.${value.externalEffects}`),
  ].join(' · ')
}

function CapabilityGapQueue({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const items = summary.capabilityGaps?.items ?? []
  return <section>
      <h3 className="dsh-evolve-section-title">{t('skills.gaps')}</h3>
      {items.length === 0
        ? <div className="dsh-evolve-message">{t('skills.gaps.empty')}</div>
        : <ul className="dsh-evolve-list">{items.map(gap => (
            <li className="dsh-evolve-skill-card" key={gap.id}>
              <div className="dsh-evolve-review-skill">{gap.requestedSkill}</div>
              {gap.goal !== undefined && <p>{gap.goal.objective
                ?? `${gap.goal.id} r${gap.goal.revision} · ${t('skills.gaps.goalProtected')}`}</p>}
              <div className="dsh-evolve-capability-route">{t('skills.gaps.confirmed')}</div>
              <div className="dsh-evolve-meta">
                {t('skills.gaps.catalog')} · {gap.catalogSize} · {gap.catalogHash.slice(0, 12)}
              </div>
              <div className="dsh-evolve-meta">{t('skills.gaps.inactive')}</div>
            </li>
          ))}</ul>}
    </section>
}

function SkillOpportunities({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const opportunities = summary.skillOpportunities?.items ?? []
  return <section>
    <h3 className="dsh-evolve-section-title">{t('skills.opportunities')}</h3>
    {opportunities.length === 0
      ? <div className="dsh-evolve-message">{t('skills.opportunities.empty')}</div>
      : <ul className="dsh-evolve-list">{opportunities.map((opportunity) => {
          const correctionReferences = opportunity.evidence.correctionSignals.ids.slice(-3)
            .map(id => `${t('skills.opportunities.reference.correction')} ${shortId(id)}`)
          const outcomeReferences = opportunity.evidence.deliveryOutcomes.ids.slice(-3)
            .map(id => `${t('skills.opportunities.reference.outcome')} ${shortId(id)}`)
          const references = [...correctionReferences, ...outcomeReferences]
          const referencesTruncated = opportunity.evidence.correctionSignals.referencesTruncated
            || opportunity.evidence.deliveryOutcomes.referencesTruncated
            || opportunity.evidence.correctionSignals.ids.length > correctionReferences.length
            || opportunity.evidence.deliveryOutcomes.ids.length > outcomeReferences.length
          const readiness = opportunity.evaluationReadiness
          return <li className="dsh-evolve-skill-card" key={opportunity.id}>
            <div className="dsh-evolve-review-skill">{opportunity.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {opportunity.goalCount} {t('skills.opportunities.goals')} · {opportunity.gapCount} {t('skills.opportunities.observations')}
            </div>
            <div className="dsh-evolve-meta">{t('skills.opportunities.evidence')}</div>
            <div className="dsh-evolve-meta">
              {t('skills.opportunities.flow')} · {opportunity.goalIds.join(' · ')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.opportunities.context')}
              {' · '}{t('skills.opportunities.corrections')}: {opportunity.evidence.correctionSignals.count}
              {' · '}{opportunity.evidence.correctionSignals.goalCount} {t('skills.opportunities.correctionGoals')}
              {' · '}{t('skills.opportunities.delivery')}: {opportunity.evidence.deliveryOutcomes.total}
              {' ('}{t('skills.opportunities.passed')} {opportunity.evidence.deliveryOutcomes.passed}
              {' / '}{t('skills.opportunities.failed')} {opportunity.evidence.deliveryOutcomes.failed}
              {' / '}{t('skills.opportunities.unknown')} {opportunity.evidence.deliveryOutcomes.unknown}{')'}
            </div>
            <div className="dsh-evolve-meta">{t('skills.opportunities.correctionAttribution')}</div>
            <div className="dsh-evolve-meta">{t('skills.opportunities.deliveryAssociation')}</div>
            <div className="dsh-evolve-meta">{t('skills.opportunities.causalBoundary')}</div>
            {references.length > 0 && <div className="dsh-evolve-meta">
              {t('skills.opportunities.references')} · {references.join(' · ')}
              {referencesTruncated && <> · {t('skills.opportunities.references.truncated')}</>}
            </div>}
            {readiness.status === 'sealed' || readiness.status === 'ready-to-seal'
              ? <>
                  <div className="dsh-evolve-discovery-state">
                    {t(readiness.status === 'sealed'
                      ? 'skills.opportunities.evaluation.sealed'
                      : 'skills.opportunities.evaluation.readyToSeal')}
                    {' · '}{t('skills.opportunities.evaluation.authoring')} {readiness.authoringGoalCount}
                    {' / '}{t('skills.opportunities.evaluation.admission')} {readiness.admissionGoalCount}
                    {' / '}{t('skills.opportunities.evaluation.holdout')} {readiness.holdoutGoalCount}
                    {readiness.retentionGoalCount > 0 && <>
                      {' / '}{t('skills.opportunities.evaluation.retention')} {readiness.retentionGoalCount}
                    </>}
                    {' · '}{shortId(readiness.evidenceId)}
                  </div>
                  <div className="dsh-evolve-meta">{t(readiness.retentionGoalCount > 0
                    ? 'skills.opportunities.evaluation.protectedWithRetention'
                    : 'skills.opportunities.evaluation.protected')}</div>
                </>
              : readiness.status === 'waiting'
                ? <div className="dsh-evolve-discovery-state">
                    {t('skills.opportunities.evaluation.waiting')}
                    {' · '}{readiness.observedGoalCount}/{readiness.requiredGoalCount}
                  </div>
                : readiness.status === 'invalid'
                  ? <div className="dsh-evolve-discovery-state">
                      {t('skills.opportunities.evaluation.invalid')}
                    </div>
                  : <div className="dsh-evolve-discovery-state">
                      {t('skills.opportunities.evaluation.unavailable')}
                    </div>}
            <div className="dsh-evolve-discovery-state">{t('skills.opportunities.state')}</div>
          </li>
        })}</ul>}
  </section>
}

function SkillImprovementOpportunities({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const queue = summary.skillImprovementOpportunities
  if (queue === undefined) return null
  return <section>
    <h3 className="dsh-evolve-section-title">{t('skills.improvements')}</h3>
    {queue.items.length === 0
      ? <div className="dsh-evolve-message">{t('skills.improvements.empty')}</div>
      : <ul className="dsh-evolve-list">{queue.items.map(opportunity => {
          const references = opportunity.feedbackSignalIds.slice(-3)
            .map(id => `${t('skills.opportunities.reference.correction')} ${shortId(id)}`)
          const referencesTruncated = opportunity.evidence.referencesTruncated
            || opportunity.feedbackSignalIds.length > references.length
          return <li className="dsh-evolve-skill-card" key={opportunity.id}>
            <div className="dsh-evolve-review-skill">{opportunity.skillName}</div>
            <div className="dsh-evolve-capability-route">
              {opportunity.goalCount} {t('skills.opportunities.goals')}
              {' · '}{opportunity.signalCount} {t('skills.improvements.corrections')}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.improvements.version')} · {opportunity.invocationContentHash.slice(0, 12)}
            </div>
            <div className="dsh-evolve-meta">
              {t('skills.opportunities.flow')} · {opportunity.goalIds.join(' · ')}
            </div>
            <div className="dsh-evolve-meta">{t('skills.improvements.attribution')}</div>
            <div className="dsh-evolve-meta">{t('skills.improvements.causalBoundary')}</div>
            {references.length > 0 && <div className="dsh-evolve-meta">
              {t('skills.opportunities.references')} · {references.join(' · ')}
              {referencesTruncated && <> · {t('skills.opportunities.references.truncated')}</>}
            </div>}
            {opportunity.baselineQualification.status === 'qualified'
              ? <>
                  <div className="dsh-evolve-discovery-state">{t('skills.improvements.qualified')}</div>
                  <div className="dsh-evolve-meta">
                    {t('skills.improvements.baseline')}
                    {' · '}{opportunity.baselineQualification.baseline.provider}/{opportunity.baselineQualification.baseline.source}
                    {' · '}{shortId(opportunity.baselineQualification.baseline.id)}
                    {' · '}{opportunity.baselineQualification.baseline.fileCount} {t('skills.improvements.files')}
                  </div>
                  <div className="dsh-evolve-meta">
                    {t('skills.improvements.evidence')}
                    {' · '}{opportunity.baselineQualification.evidence.invocationCount} {t('skills.improvements.invocations')}
                    {' / '}{opportunity.baselineQualification.evidence.goalCount} {t('skills.opportunities.goals')}
                  </div>
                </>
              : opportunity.baselineQualification.status === 'waiting'
                ? <div className="dsh-evolve-discovery-state">
                    {t('skills.improvements.waiting')}
                    {' · '}{t(`skills.improvements.reason.${opportunity.baselineQualification.reason}`)}
                    {' · '}{opportunity.baselineQualification.observedInvocationCount} {t('skills.improvements.invocations')}
                  </div>
                : opportunity.baselineQualification.status === 'invalid'
                  ? <div className="dsh-evolve-discovery-state">
                      {t('skills.improvements.invalid')}
                      {' · '}{t(`skills.improvements.reason.${opportunity.baselineQualification.reason}`)}
                    </div>
                  : <div className="dsh-evolve-discovery-state">
                      {t('skills.improvements.unavailable')}
                    </div>}
            <ExistingSkillEvidenceReadiness readiness={opportunity.evaluationReadiness} t={t} />
          </li>
        })}</ul>}
  </section>
}

function ExistingSkillEvidenceReadiness({
  readiness,
  t,
}: {
  readiness: EvolutionExistingSkillEvaluationEvidenceReadinessView
  t: (key: string) => string
}) {
  if (!('reason' in readiness)) {
    return <>
      <div className="dsh-evolve-discovery-state">
        {t(`skills.improvements.evaluation.${readiness.status}`)}
      </div>
      <div className="dsh-evolve-meta">
        {t('skills.improvements.evaluation.partition')}
        {' · '}{t('skills.opportunities.evaluation.authoring')} {readiness.authoringGoalCount}
        {' / '}{t('skills.opportunities.evaluation.admission')} {readiness.admissionGoalCount}
        {' / '}{t('skills.opportunities.evaluation.holdout')} {readiness.holdoutGoalCount}
        {' / '}{t('skills.opportunities.evaluation.retention')} {readiness.retentionGoalCount}
      </div>
      <div className="dsh-evolve-meta">
        {t('skills.improvements.evaluation.identity')}
        {' · '}{shortId(readiness.evidenceId)} / {shortId(readiness.qualificationId)} / {shortId(readiness.baselineId)}
      </div>
      <div className="dsh-evolve-meta">{t('skills.improvements.evaluation.protected')}</div>
    </>
  }
  return <div className="dsh-evolve-discovery-state">
    {t(`skills.improvements.evaluation.${readiness.status}`)}
    {' · '}{t(`skills.improvements.evaluation.reason.${readiness.reason}`)}
    {' · '}{readiness.observedGoalCount}/{readiness.requiredGoalCount} {t('skills.opportunities.goals')}
  </div>
}

function CapabilityMap({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const map = summary.capabilityMap ?? { status: 'unobserved' as const, capabilities: [] }
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.catalog')}</h3>
      <span className={`dsh-evolve-catalog-status dsh-evolve-catalog-${map.status}`}>
        {t(`skills.catalog.${map.status}`)}
      </span>
    </div>
    {map.capabilities.length > 0 && <ul className="dsh-evolve-list">{map.capabilities.map(capability => (
      <li className="dsh-evolve-skill-card" key={`${capability.name}:${capability.version ?? capability.provider}`}>
        <div className="dsh-evolve-review-skill">{capability.name}</div>
        <p>{capability.description}</p>
        <div className="dsh-evolve-capability-route">{t(`skills.route.${capability.route}`)}</div>
        <div className="dsh-evolve-meta">{capability.source} · {capability.provider}</div>
        <div className="dsh-evolve-meta">{capabilityVersion(capability, t)}</div>
        <div className="dsh-evolve-meta">{capabilityInvocation(capability, t)}</div>
      </li>
    ))}</ul>}
  </section>
}

function capabilityVersion(capability: EvolutionCapabilityView, t: (key: string) => string): string {
  const label = t(`skills.version.${capability.versionKind}`)
  return capability.version === undefined ? label : `${label} · ${capability.version.slice(0, 12)}`
}

function capabilityInvocation(capability: EvolutionCapabilityView, t: (key: string) => string): string {
  if (capability.invocation.model && capability.invocation.user) return t('skills.invocation.both')
  if (capability.invocation.model) return t('skills.invocation.model')
  if (capability.invocation.user) return t('skills.invocation.user')
  return t('skills.invocation.none')
}

function SkillGroup({ label, items, t }: {
  label: string
  t: (key: string) => string
  items: readonly {
    key: string
    name: string
    detail: string
    lineage?: EvolutionSkillCandidateLineageView
  }[]
}) {
  return <section>
    <h3 className="dsh-evolve-section-title">{label}</h3>
    <ul className="dsh-evolve-list">{items.map(item => (
      <li className="dsh-evolve-skill-card" key={item.key}>
        <div className="dsh-evolve-review-skill">{item.name}</div>
        <p>{item.detail}</p>
        {item.lineage !== undefined && <SkillCandidateLineage lineage={item.lineage} t={t} />}
      </li>
    ))}</ul>
  </section>
}

function SkillCandidateLineage({ lineage, t }: {
  lineage: EvolutionSkillCandidateLineageView
  t: (key: string) => string
}) {
  return <div className="dsh-evolve-lineage">
    <div className="dsh-evolve-lineage-head">
      <strong>{t('skills.lineage.title')}</strong>
      <span>{t('skills.discovery.version.experience-bundle')}</span>
    </div>
    <div className="dsh-evolve-lineage-meta">
      {t('skills.lineage.policy')} · {lineage.policyId}
    </div>
    <ol className="dsh-evolve-lineage-flow">
      <LineageStep label={t('skills.lineage.opportunity')} id={lineage.opportunityId} />
      <LineageStep label={t('skills.lineage.evidence')} id={lineage.evaluationEvidenceId} />
      <LineageStep
        label={t('skills.lineage.candidate')}
        id={lineage.candidateId}
        detail={shortId(lineage.candidateTreeHash)}
      />
      <LineageStep
        label={t('skills.lineage.admission')}
        id={lineage.admissionId}
        detail={lineage.evaluationEnvelopeId}
      />
    </ol>
    <div className="dsh-evolve-lineage-release">{t('skills.lineage.release.none')}</div>
  </div>
}

function LineageStep({ label, id, detail }: { label: string; id: string; detail?: string }) {
  return <li>
    <span aria-hidden="true" />
    <div>
      <strong>{label} · {shortId(id)}</strong>
      {detail !== undefined && <small>{detail}</small>}
    </div>
  </li>
}

function Overview({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const stats = [
    [t('status.active'), summary.active === undefined ? t('status.native') : shortId(summary.active.id)],
    [t('status.recovery'), !summary.recovery.available
      ? t('status.unavailable')
      : t(summary.recovery.paused === true ? 'status.paused' : 'status.running')],
    [t('status.actions'), String(actionableCount(summary))],
  ]
  return <div className="dsh-evolve-summary">{stats.map(([label, value]) => (
    <div className="dsh-evolve-stat" key={label}>
      <span className="dsh-evolve-stat-label">{label}</span>
      <span className="dsh-evolve-stat-value" title={value}>{value}</span>
    </div>
  ))}</div>
}

function actionableCount(overview: EvolutionOverview | undefined): number {
  if (overview === undefined) return 0
  return overview.reviews.actionableCount
}

function requireWorkspace<T>(
  expectedWorkspaceId: string,
  value: T,
  workspaceOf: (value: T) => string,
): T {
  const actualWorkspaceId = workspaceOf(value)
  if (actualWorkspaceId !== expectedWorkspaceId) {
    throw new Error(`Workspace authority mismatch: expected ${expectedWorkspaceId}, received ${actualWorkspaceId}`)
  }
  return value
}

function ReviewQueue({ overview, busy, inspect, promote, t }: {
  overview: EvolutionOverview | undefined
  busy: boolean
  inspect: (id: string) => Promise<void>
  promote: (generationId: string) => void
  t: (key: string) => string
}) {
  if (overview === undefined) return null
  return <>
    {overview.deliveryOutcomes !== undefined && <section>
      <h3 className="dsh-evolve-section-title">{t('section.outcomes')}</h3>
      <ul className="dsh-evolve-list">
        <li className="dsh-evolve-review">
          <div className="dsh-evolve-review-skill">
            {t(overview.active === undefined ? 'outcomes.current' : 'outcomes.active')}
            {' · '}{overview.active === undefined ? t('status.native') : shortId(overview.active.id)}
            {' · '}{renderOutcomeCounts(overview.deliveryOutcomes.selected, t)}
          </div>
        </li>
        {overview.deliveryOutcomes.baseline !== undefined && overview.active !== undefined && <li className="dsh-evolve-review">
          <div className="dsh-evolve-review-skill">{t('outcomes.parent')} · {overview.active.rollbackTargetId === undefined ? t('status.native') : shortId(overview.active.rollbackTargetId)} · {renderOutcomeCounts(overview.deliveryOutcomes.baseline, t)}</div>
        </li>}
      </ul>
      <OutcomeMetrics
        metrics={overview.deliveryOutcomes.metrics}
        selectedLabel={t(overview.active === undefined ? 'outcomes.metrics.current' : 'outcomes.metrics.active')}
        t={t}
      />
      <p className="dsh-evolve-meta">{t('outcomes.disclaimer')}</p>
    </section>}
    <section>
      <h3 className="dsh-evolve-section-title">{t('section.reviews')}</h3>
      {overview.reviews.items.length === 0
        ? <div className="dsh-evolve-message">{t('empty.reviews')}</div>
        : <ul className="dsh-evolve-list">{overview.reviews.items.map(review => (
          <li className="dsh-evolve-review" key={review.id}>
            <div className="dsh-evolve-review-head">
              <div className="dsh-evolve-review-copy">
                <div className="dsh-evolve-review-skill">{review.skillName}</div>
                <p className="dsh-evolve-review-claim">{review.claim}</p>
                <div className="dsh-evolve-meta">{review.recommendation} · {review.cases.length} cases · {shortId(review.id)}</div>
              </div>
              <button type="button" className="dsh-evolve-button" disabled={busy} onClick={() => { void inspect(review.id) }}>{t('action.inspect')}</button>
            </div>
          </li>
        ))}</ul>}
    </section>
    {overview.reviews.inactiveGenerations.length > 0 && <section>
      <h3 className="dsh-evolve-section-title">{t('section.inactive')}</h3>
      <ul className="dsh-evolve-list">{overview.reviews.inactiveGenerations.map(generation => (
        <li className="dsh-evolve-review" key={generation.generationId}>
          <div className="dsh-evolve-review-head">
            <div className="dsh-evolve-review-copy">
              <div className="dsh-evolve-review-skill">{generation.skillName}</div>
              <div className="dsh-evolve-meta">{shortId(generation.generationId)}</div>
              <div className="dsh-evolve-meta">
                {t(`promotion.status.${generation.promotion.status}`)} · {t(`promotion.reason.${generation.promotion.reason}`)}
                {generation.promotion.retentionId === undefined
                  ? ''
                  : ` · ${t('promotion.retention')} ${shortId(generation.promotion.retentionId)}`}
              </div>
            </div>
            <button
              type="button"
              className="dsh-evolve-button dsh-evolve-primary"
              disabled={busy || generation.promotion.status !== 'eligible'}
              onClick={() => promote(generation.generationId)}
            >{t('action.promote')}</button>
          </div>
        </li>
      ))}</ul>
    </section>}
  </>
}

function renderOutcomeCounts(
  counts: { total: number; passed: number; failed: number; unknown: number },
  t: (key: string) => string,
): string {
  return `${counts.total} ${t('outcomes.total')} · ${counts.passed} ${t('outcomes.passed')} · ${counts.failed} ${t('outcomes.failed')} · ${counts.unknown} ${t('outcomes.unknown')}`
}

function OutcomeMetrics({ metrics, selectedLabel, t }: {
  metrics: NonNullable<EvolutionOverview['deliveryOutcomes']>['metrics']
  selectedLabel: string
  t: (key: string) => string
}) {
  const rollups: Array<{ key: string; label: string; value: EvolutionDeliveryMetricRollupView }> = [
    { key: 'workspace', label: t('outcomes.metrics.workspace'), value: metrics.all },
    { key: 'active', label: selectedLabel, value: metrics.selected },
    ...(metrics.baseline === undefined
      ? []
      : [{ key: 'baseline', label: t('outcomes.metrics.baseline'), value: metrics.baseline }]),
  ]
  return <div className="dsh-evolve-outcome-metrics">
    <h4 className="dsh-evolve-section-title">{t('outcomes.metrics.title')}</h4>
    <div className="dsh-evolve-metric-grid">{rollups.map(rollup => (
      <OutcomeMetricRollup key={rollup.key} label={rollup.label} value={rollup.value} t={t} />
    ))}</div>
    {metrics.recent.length > 0 && <>
      <h4 className="dsh-evolve-section-title dsh-evolve-subsection-title">{t('outcomes.metrics.recent')}</h4>
      <ul className="dsh-evolve-list">{metrics.recent.map(item => (
        <OutcomeMetricEvidence key={item.outcomeId} value={item} t={t} />
      ))}</ul>
    </>}
    <p className="dsh-evolve-meta">{t('outcomes.metrics.priceUnavailable')}</p>
  </div>
}

function OutcomeMetricRollup({ label, value, t }: {
  label: string
  value: EvolutionDeliveryMetricRollupView
  t: (key: string) => string
}) {
  return <div className="dsh-evolve-metric-card" role="group" aria-label={label}>
    <div className="dsh-evolve-review-skill">
      {label} · {value.measured} {t('outcomes.metrics.measured')} · {value.unmeasured} {t('outcomes.metrics.unmeasured')}
    </div>
    <div className="dsh-evolve-meta">{renderProviderUsage(value.providerUsage, t)}</div>
    <div className="dsh-evolve-meta">{renderLatency(value, t)}</div>
    <div className="dsh-evolve-meta">
      {value.attributedTurns} {t('outcomes.metrics.turns')} · {value.closedSteps} {t('outcomes.metrics.closedSteps')}
    </div>
  </div>
}

function OutcomeMetricEvidence({ value, t }: {
  value: EvolutionDeliveryMetricEvidenceView
  t: (key: string) => string
}) {
  return <li className="dsh-evolve-review">
    <div className="dsh-evolve-review-skill">
      {value.goal.id} r{value.goal.revision} · {t(`outcomes.${value.status}`)} · {t('outcomes.metrics.outcome')} {shortId(value.outcomeId)} · {t('outcomes.metrics.event')} {value.metrics.throughEventSeq}
    </div>
    <div className="dsh-evolve-meta">{renderProviderUsage(value.metrics.providerUsage, t)}</div>
    <div className="dsh-evolve-meta">{renderLatency(value.metrics, t)}</div>
  </li>
}

function renderProviderUsage(
  value: EvolutionDeliveryMetricRollupView['providerUsage'],
  t: (key: string) => string,
): string {
  return `${value.uncachedInputTokens} ${t('outcomes.metrics.uncachedInput')}`
    + ` · ${value.outputTokens} ${t('outcomes.metrics.output')}`
    + ` · ${t('outcomes.metrics.cacheRead')} ${value.cacheReadTokens}`
    + ` · ${t('outcomes.metrics.cacheWrite')} ${value.cacheWriteTokens}`
}

function renderLatency(
  value: Pick<EvolutionDeliveryMetricRollupView, 'activeWallMs' | 'latency'>,
  t: (key: string) => string,
): string {
  return `${t('outcomes.metrics.llm')} ${value.latency.llmMs} ms`
    + ` · ${t('outcomes.metrics.tools')} ${value.latency.toolMs} ms`
    + ` · ${t('outcomes.metrics.ttft')} ${value.latency.ttftMs} ms`
    + ` · ${t('outcomes.metrics.activeWall')} ${value.activeWallMs} ms`
}

function ReviewDetail({ detail, note, busy, setNote, back, confirm, t }: {
  detail: EvolutionReviewDetail
  note: string
  busy: boolean
  setNote: (value: string) => void
  back: () => void
  confirm: (action: ConfirmAction) => void
  t: (key: string) => string
}) {
  const validNote = note.trim().length > 0
  return <section>
    <h3 className="dsh-evolve-section-title">{t('section.detail')}</h3>
    <div className="dsh-evolve-claim-card">
      <span className="dsh-evolve-stat-label">{t('label.claim')}</span>
      <p>{detail.review.claim}</p>
    </div>
    <dl className="dsh-evolve-detail-grid">
      <dt>{t('label.skill')}</dt><dd>{detail.review.skillName}</dd>
      <dt>{t('label.changedFiles')}</dt><dd>{detail.review.changedFiles.join(', ')}</dd>
      <dt>{t('label.reasons')}</dt><dd>{detail.review.reasons.join('; ')}</dd>
      <dt>{t('label.limitations')}</dt><dd>{detail.review.limitations.join('; ')}</dd>
      <dt>{t('label.cases')}</dt><dd>{detail.review.cases.map(item => `${item.id}: ${item.baseline}→${item.candidate} ${item.passedChecks}/${item.totalChecks}`).join('; ')}</dd>
      <dt>{t('label.tokens')}</dt><dd>{detail.review.cost.inputTokens} in / {detail.review.cost.outputTokens} out</dd>
      <dt>{t('label.impact')}</dt><dd>{detail.diff.impact.indicators.length === 0 ? 'none' : detail.diff.impact.indicators.join(', ')}</dd>
    </dl>
    <h4 className="dsh-evolve-section-title">{t('label.diff')}</h4>
    <pre className="dsh-evolve-diff">{detail.diff.patch}</pre>
    <label>
      <span className="dsh-evolve-section-title">{t('field.note')}</span>
      <textarea className="dsh-evolve-note" aria-label={t('field.note')} value={note} maxLength={500} onChange={event => setNote(event.currentTarget.value)} />
    </label>
    <div className="dsh-evolve-actions">
      <button type="button" className="dsh-evolve-button" disabled={busy} onClick={back}>{t('action.back')}</button>
      {detail.review.status === 'pending' && <>
        <button type="button" className="dsh-evolve-button dsh-evolve-danger" disabled={busy || !validNote} onClick={() => confirm('reject')}>{t('action.reject')}</button>
        <button type="button" className="dsh-evolve-button dsh-evolve-primary" disabled={busy || !validNote} onClick={() => confirm('approve')}>{t('action.approve')}</button>
      </>}
    </div>
  </section>
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
