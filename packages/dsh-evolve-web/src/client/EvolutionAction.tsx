import { useLayoutEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  EvolutionActionReceipt,
  EvolutionCapabilityView,
  EvolutionEvaluatorDraftDetail,
  EvolutionOverview,
  EvolutionReviewDetail,
} from 'dsh-evolve/client'
import { remoteValue, type EvolutionRemoteClient } from './remote.ts'

export type EvolutionActionProps = PropsRuntime<'sidebar.footer.action'> & {
  readonly remote: EvolutionRemoteClient
  readonly t: (key: string) => string
}

type ConfirmAction = 'approve' | 'reject' | 'promote' | 'rollback' | 'shadow' | 'authorEvaluator' | 'approveEvaluator' | 'approveAndShadow' | 'rejectEvaluator' | 'qualifiedShadow'
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
  const [evaluatorDetail, setEvaluatorDetail] = useState<EvolutionEvaluatorDraftDetail>()
  const [note, setNote] = useState('')
  const [promotionTarget, setPromotionTarget] = useState<string>()
  const [shadowSelection, setShadowSelection] = useState<{ signalId: string; targetId: string }>()
  const [evaluatorSelection, setEvaluatorSelection] = useState<{ signalId: string; targetId: string }>()
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
    setEvaluatorDetail(undefined)
    setNote('')
    setPromotionTarget(undefined)
    setShadowSelection(undefined)
    setEvaluatorSelection(undefined)
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
      } else if (evaluatorDetail !== undefined) {
        try {
          const nextDetail = requireWorkspace(
            targetWorkspaceId,
            await remoteValue(remote.evaluatorDraft(targetWorkspaceId, evaluatorDetail.draft.id)),
            value => value.draft.workspaceId,
          )
          if (workspaceRef.current === targetWorkspaceId) setEvaluatorDetail(nextDetail)
        } catch (cause) {
          setEvaluatorDetail(undefined)
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
      setEvaluatorDetail(undefined)
      setNote('')
    } catch (cause) {
      if (workspaceRef.current === targetWorkspaceId) setError(message(cause))
    } finally {
      if (workspaceRef.current === targetWorkspaceId) setBusy(false)
    }
  }

  const inspectEvaluator = async (id: string) => {
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
        await remoteValue(remote.evaluatorDraft(targetWorkspaceId, id)),
        value => value.draft.workspaceId,
      )
      if (workspaceRef.current !== targetWorkspaceId) return
      setEvaluatorDetail(next)
      setDetail(undefined)
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
      if (receipt.action === 'approve-review' || receipt.action === 'reject-review') {
        setDetail(undefined)
      }
      if (receipt.action === 'approve-evaluator' || receipt.action === 'reject-evaluator') {
        setEvaluatorDetail(undefined)
      }
      if (receipt.action === 'start-shadow' && evaluatorDetail !== undefined) {
        setEvaluatorDetail(undefined)
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
      void run(() => remoteValue(remote.rollback(workspaceId)))
    } else if (confirm === 'shadow' && shadowSelection !== undefined) {
      void run(() => remoteValue(remote.startFeedbackShadow(
        workspaceId,
        shadowSelection.signalId,
        shadowSelection.targetId,
      )))
    } else if (confirm === 'authorEvaluator' && evaluatorSelection !== undefined) {
      void run(() => remoteValue(remote.authorEvaluator(
        workspaceId,
        evaluatorSelection.signalId,
        evaluatorSelection.targetId,
      )))
    } else if (confirm === 'approveEvaluator' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.approveEvaluator(workspaceId, evaluatorDetail.draft.id, note.trim())))
    } else if (confirm === 'approveAndShadow' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.approveAndStartEvaluatorShadow(
        workspaceId,
        evaluatorDetail.draft.id,
        note.trim(),
      )))
    } else if (confirm === 'rejectEvaluator' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.rejectEvaluator(workspaceId, evaluatorDetail.draft.id, note.trim())))
    } else if (confirm === 'qualifiedShadow' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.startEvaluatorShadow(workspaceId, evaluatorDetail.draft.id)))
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
                  setEvaluatorDetail(undefined)
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
            {overview !== undefined && view === 'skills' && <SkillsView summary={overview} t={t} />}
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
                  <button type="button" className="dsh-evolve-button dsh-evolve-danger" disabled={busy} onClick={() => setConfirm('rollback')}>
                    {t('action.rollback')}
                  </button>
                )}
              </div>
              {detail === undefined && evaluatorDetail === undefined
              ? <ReviewQueue
                  overview={overview}
                  busy={busy}
                  inspect={inspect}
                  promote={(generationId) => {
                    setPromotionTarget(generationId)
                    setConfirm('promote')
                  }}
                  startShadow={(signalId, targetId) => {
                    setShadowSelection({ signalId, targetId })
                    setConfirm('shadow')
                  }}
                  authorEvaluator={(signalId, targetId) => {
                    setEvaluatorSelection({ signalId, targetId })
                    setConfirm('authorEvaluator')
                  }}
                  inspectEvaluator={inspectEvaluator}
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
                ) : evaluatorDetail !== undefined ? (
                  <EvaluatorDetail
                    detail={evaluatorDetail}
                    note={note}
                    busy={busy}
                    setNote={setNote}
                    back={() => setEvaluatorDetail(undefined)}
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
              <button type="button" className="dsh-evolve-button" onClick={() => setConfirm(undefined)}>{t('action.cancel')}</button>
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
  const activeSkills = summary.active?.artifacts.filter(artifact => artifact.kind === 'skill').length ?? 0
  const corrections = recordedCorrectionCount(summary)
  const verificationConfigured = hasVerificationTarget(summary)
  const verificationReady = hasEligibleVerificationTarget(summary)
  const headline = pending > 0
    ? `${pending} ${t('onboarding.actionable')}`
    : corrections > 0
      ? t(verificationReady
          ? 'onboarding.feedbackReady'
          : verificationConfigured ? 'onboarding.feedbackIneligible' : 'onboarding.feedbackBlocked')
      : verificationConfigured
        ? t('onboarding.idle')
        : t('onboarding.verificationMissing')
  const explanation = pending > 0 || (corrections === 0 && verificationConfigured)
    ? t('onboarding.intro')
    : corrections > 0
      ? t(verificationReady
          ? 'onboarding.feedbackReadyHelp'
          : verificationConfigured ? 'onboarding.feedbackIneligibleHelp' : 'onboarding.feedbackBlockedHelp')
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
      {pending === 0 && corrections > 0 && verificationReady && (
        <button type="button" className="dsh-evolve-button dsh-evolve-primary" onClick={openAdvanced}>
          {t('onboarding.processFeedback')}
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
  if (summary.feedbackSignals !== undefined) return summary.feedbackSignals.all
  return new Set([
    ...(summary.feedbackShadow?.signals ?? []).map(signal => signal.id),
    ...(summary.evaluatorAuthoring?.signals ?? []).map(signal => signal.id),
  ]).size
}

function hasVerificationTarget(summary: EvolutionOverview): boolean {
  return (summary.feedbackShadow?.available === true && summary.feedbackShadow.targets.length > 0)
    || (summary.evaluatorAuthoring?.available === true && summary.evaluatorAuthoring.targets.length > 0)
}

function hasEligibleVerificationTarget(summary: EvolutionOverview): boolean {
  return [...(summary.feedbackShadow?.signals ?? []), ...(summary.evaluatorAuthoring?.signals ?? [])]
    .some(signal => signal.eligibleTargetIds.length > 0)
}

function SkillsView({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const active = summary.active?.artifacts.filter(artifact => artifact.kind === 'skill') ?? []
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
    <SkillDiscovery summary={summary} t={t} />
    <SkillAdmission summary={summary} t={t} />
    {empty && <div className="dsh-evolve-message">{t('skills.empty')}</div>}
    {active.length > 0 && <SkillGroup label={t('skills.active')} items={active.map(artifact => ({
      key: `active:${artifact.gitCommit}:${artifact.name}`,
      name: artifact.name,
      detail: t('skills.activeHelp'),
    }))} />}
    {ready.length > 0 && <SkillGroup label={t('skills.ready')} items={ready.map(item => ({
      key: `ready:${item.generationId}:${item.skillName}`,
      name: item.skillName,
      detail: t('skills.readyHelp'),
    }))} />}
    {reviewing.length > 0 && <SkillGroup label={t('skills.reviewing')} items={reviewing.map(item => ({
      key: `review:${item.id}:${item.skillName}`,
      name: item.skillName,
      detail: item.claim,
    }))} />}
    <p className="dsh-evolve-guidance">{t('skills.native')}</p>
  </>
}

function SkillAdmission({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const admission = summary.skillAdmission
  if (admission === undefined) return null
  return <section>
    <div className="dsh-evolve-capability-head">
      <h3 className="dsh-evolve-section-title">{t('skills.admission')}</h3>
      <span className="dsh-evolve-catalog-status">
        {admission.configuredTargetCount} {t('skills.admission.targets')}
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
            {value.targetId !== undefined && <div className="dsh-evolve-meta">
              {t('skills.admission.target')} · {value.targetId}
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

function admissionComparison(
  value: NonNullable<EvolutionOverview['skillAdmission']>['results'][number]['evidence'] & {},
  t: (key: string) => string,
): string {
  return `${t('skills.admission.baseline')} ${t(`skills.admission.outcome.${value.baseline}`)}`
    + ` → ${t('skills.admission.candidate')} ${t(`skills.admission.outcome.${value.candidate}`)}`
    + ` · ${value.trialCount} ${t('skills.admission.trials')}`
}

function SkillDiscovery({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const discovery = summary.skillDiscovery
  if (discovery === undefined) return null
  return <>
    <section>
      <h3 className="dsh-evolve-section-title">{t('skills.discovery')}</h3>
      {discovery.candidates.length === 0
        ? <div className="dsh-evolve-message">{t('skills.discovery.empty')}</div>
        : <ul className="dsh-evolve-list">{discovery.candidates.map(candidate => (
            <li className="dsh-evolve-skill-card" key={candidate.id}>
              <div className="dsh-evolve-review-skill">{candidate.requestedSkill}</div>
              <p>{candidate.description}</p>
              <div className="dsh-evolve-capability-route">{t('skills.discovery.quarantined')}</div>
              <div className="dsh-evolve-meta">
                {candidate.source.id} · {t(`skills.discovery.source.${candidate.source.kind}`)} · {t(`skills.discovery.trust.${candidate.source.trust}`)}
              </div>
              <div className="dsh-evolve-meta">
                {t('skills.discovery.version')} · {candidate.version.commit.slice(0, 12)} · {t('skills.discovery.tree')} {candidate.version.treeHash.slice(0, 12)}
              </div>
              <div className="dsh-evolve-meta">
                {t('skills.discovery.content')} · {candidate.contentHash.slice(0, 12)}
              </div>
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
    <section>
      <h3 className="dsh-evolve-section-title">{t('skills.discovery.attempts')}</h3>
      {discovery.attempts.length === 0
        ? <div className="dsh-evolve-message">{t('skills.discovery.attempts.empty')}</div>
        : <ul className="dsh-evolve-list">{discovery.attempts.map(attempt => (
            <li className="dsh-evolve-skill-card" key={attempt.id}>
              <div className="dsh-evolve-review-skill">{attempt.requestedSkill}</div>
              <div className="dsh-evolve-capability-route">
                {t(`skills.discovery.attempt.${attempt.status}`)}
              </div>
              {attempt.sources.length > 0 && <div className="dsh-evolve-meta">
                {attempt.sources.map(source => `${source.id} · ${t(`skills.discovery.source-status.${source.status}`)}`).join(' · ')}
              </div>}
              {attempt.reasons.map(reason => (
                <div className="dsh-evolve-meta" key={reason}>{t(`skills.discovery.reason.${reason}`)}</div>
              ))}
            </li>
          ))}</ul>}
    </section>
  </>
}

function skillPackageSummary(
  value: NonNullable<EvolutionOverview['skillDiscovery']>['candidates'][number]['package'],
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
  value: NonNullable<EvolutionOverview['skillDiscovery']>['candidates'][number]['permissions'],
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
            {gap.goal !== undefined && <p>{gap.goal.objective}</p>}
            <div className="dsh-evolve-capability-route">{t('skills.gaps.confirmed')}</div>
            <div className="dsh-evolve-meta">
              {t('skills.gaps.catalog')} · {gap.catalogSize} · {gap.catalogHash.slice(0, 12)}
            </div>
            <div className="dsh-evolve-meta">{t('skills.gaps.inactive')}</div>
          </li>
        ))}</ul>}
  </section>
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

function SkillGroup({ label, items }: {
  label: string
  items: readonly { key: string; name: string; detail: string }[]
}) {
  return <section>
    <h3 className="dsh-evolve-section-title">{label}</h3>
    <ul className="dsh-evolve-list">{items.map(item => (
      <li className="dsh-evolve-skill-card" key={item.key}>
        <div className="dsh-evolve-review-skill">{item.name}</div>
        <p>{item.detail}</p>
      </li>
    ))}</ul>
  </section>
}

function Overview({ summary, t }: { summary: EvolutionOverview; t: (key: string) => string }) {
  const stats = [
    [t('status.active'), summary.active === undefined ? t('status.native') : shortId(summary.active.id)],
    [t('status.recovery'), !summary.recovery.available
      ? t('status.unavailable')
      : t(summary.recovery.paused === true ? 'status.paused' : 'status.running')],
    [t('status.actions'), String(actionableCount(summary))],
    [t('status.auto'), t(summary.automaticPromotion.enabled ? 'status.on' : 'status.off')],
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
    + (overview.evaluatorAuthoring?.actionableCount ?? 0)
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

function ReviewQueue({ overview, busy, inspect, promote, startShadow, authorEvaluator, inspectEvaluator, t }: {
  overview: EvolutionOverview | undefined
  busy: boolean
  inspect: (id: string) => Promise<void>
  promote: (generationId: string) => void
  startShadow: (signalId: string, targetId: string) => void
  authorEvaluator: (signalId: string, targetId: string) => void
  inspectEvaluator: (id: string) => Promise<void>
  t: (key: string) => string
}) {
  if (overview === undefined) return null
  const feedbackShadow = overview.feedbackShadow
  const automaticBudgets = [
    ...(overview.automaticFeedbackBudget?.targets ?? []).map(target => ({
      workflow: 'label.feedbackShadow',
      target,
    })),
    ...(overview.automaticEvaluatorBudget?.targets ?? []).map(target => ({
      workflow: 'label.evaluatorDraft',
      target,
    })),
  ]
  const evaluatorAuthoring = overview.evaluatorAuthoring
  return <>
    {overview.deliveryOutcomes?.baseline !== undefined && overview.active !== undefined && <section>
      <h3 className="dsh-evolve-section-title">{t('section.outcomes')}</h3>
      <ul className="dsh-evolve-list">
        <li className="dsh-evolve-review">
          <div className="dsh-evolve-review-skill">{t('outcomes.active')} · {shortId(overview.active.id)} · {renderOutcomeCounts(overview.deliveryOutcomes.selected, t)}</div>
        </li>
        <li className="dsh-evolve-review">
          <div className="dsh-evolve-review-skill">{t('outcomes.parent')} · {overview.active.rollbackTargetId === undefined ? t('status.native') : shortId(overview.active.rollbackTargetId)} · {renderOutcomeCounts(overview.deliveryOutcomes.baseline, t)}</div>
        </li>
      </ul>
      <p className="dsh-evolve-meta">{t('outcomes.disclaimer')}</p>
    </section>}
    {automaticBudgets.length > 0 && <section>
      <h3 className="dsh-evolve-section-title">{t('section.budget')}</h3>
      <ul className="dsh-evolve-list">{automaticBudgets.map(({ workflow, target }) => (
        <li className="dsh-evolve-review" key={`${workflow}:${target.targetId}`}>
          <div className="dsh-evolve-review-skill">{t(workflow)} · {target.targetId} · {target.skillName}</div>
          <div className="dsh-evolve-meta">{target.status === 'unknown'
            ? t('status.budgetUnknown')
            : `${target.used}/${target.limit} ${t('label.attemptsUsed')} · ${target.remaining} ${t('label.remaining')} · ${target.utcDay} UTC`}</div>
        </li>
      ))}</ul>
    </section>}
    {feedbackShadow !== undefined && <section>
      <h3 className="dsh-evolve-section-title">{t('section.feedback')}</h3>
      {feedbackShadow.signals.length === 0
        ? <div className="dsh-evolve-message">{t('empty.feedback')}</div>
        : <ul className="dsh-evolve-list">{feedbackShadow.signals.map(signal => (
          <li className="dsh-evolve-review" key={signal.id}>
            <div className="dsh-evolve-review-head">
              <div className="dsh-evolve-review-copy">
                <div className="dsh-evolve-review-skill">{shortId(signal.id)}</div>
                <div className="dsh-evolve-meta">{signal.generationId === undefined ? t('status.native') : shortId(signal.generationId)}</div>
              </div>
              <div className="dsh-evolve-actions">
                {feedbackShadow.targets
                  .filter(target => signal.eligibleTargetIds.includes(target.id))
                  .map(target => (
                  <button
                    type="button"
                    className="dsh-evolve-button dsh-evolve-primary"
                    disabled={busy || !feedbackShadow.available}
                    key={target.id}
                    title={`${target.id}: ${target.skillName}`}
                    onClick={() => startShadow(signal.id, target.id)}
                  >
                    {t('action.startShadow')} · {target.id}
                  </button>
                  ))}
              </div>
            </div>
          </li>
        ))}</ul>}
    </section>}
    {feedbackShadow !== undefined && feedbackShadow.runs.length > 0 && <section>
      <h3 className="dsh-evolve-section-title">{t('section.runs')}</h3>
      <ul className="dsh-evolve-list">{feedbackShadow.runs.map(run => (
        <li className="dsh-evolve-review" key={run.launchId}>
          <div className="dsh-evolve-review-skill">{run.skillName}</div>
          <div className="dsh-evolve-meta">{run.phase} · {shortId(run.launchId)}</div>
        </li>
      ))}</ul>
    </section>}
    {evaluatorAuthoring !== undefined && <section>
      <h3 className="dsh-evolve-section-title">{t('section.evaluators')}</h3>
      {evaluatorAuthoring.signals.length > 0 && <ul className="dsh-evolve-list">{evaluatorAuthoring.signals.map(signal => (
        <li className="dsh-evolve-review" key={`author-${signal.id}`}>
          <div className="dsh-evolve-review-head">
            <div className="dsh-evolve-review-copy">
              <div className="dsh-evolve-review-skill">{shortId(signal.id)}</div>
              <div className="dsh-evolve-meta">{signal.generationId === undefined ? t('status.native') : shortId(signal.generationId)}</div>
            </div>
            <div className="dsh-evolve-actions">
              {evaluatorAuthoring.targets
                .filter(target => signal.eligibleTargetIds.includes(target.id))
                .map(target => (
                <button
                  type="button"
                  className="dsh-evolve-button dsh-evolve-primary"
                  disabled={busy || !evaluatorAuthoring.available}
                  key={target.id}
                  title={`${target.id}: ${target.skillName}`}
                  onClick={() => authorEvaluator(signal.id, target.id)}
                >
                  {t('action.authorEvaluator')} · {target.id}
                </button>
                ))}
            </div>
          </div>
        </li>
      ))}</ul>}
      {evaluatorAuthoring.drafts.length === 0
        ? <div className="dsh-evolve-message">{t('empty.evaluators')}</div>
        : <ul className="dsh-evolve-list">{evaluatorAuthoring.drafts.map(draft => (
          <li className="dsh-evolve-review" key={draft.id}>
            <div className="dsh-evolve-review-head">
              <div className="dsh-evolve-review-copy">
                <div className="dsh-evolve-review-skill">{draft.skillName}</div>
                <div className="dsh-evolve-meta">{draft.status} · {shortId(draft.id)} · {draft.cost.inputTokens}/{draft.cost.outputTokens} tokens</div>
              </div>
              {draft.status !== 'authoring-pending' && draft.status !== 'uncertain' && <button
                type="button"
                className="dsh-evolve-button"
                disabled={busy}
                onClick={() => { void inspectEvaluator(draft.id) }}
              >{t('action.inspectEvaluator')}</button>}
            </div>
          </li>
        ))}</ul>}
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
                {review.automaticReviewExpiry !== undefined && <div className="dsh-evolve-meta">
                  {t(review.automaticReviewExpiry.eligible ? 'review.expiryEligible' : 'review.expiryOpen')} · {review.automaticReviewExpiry.eligibleAt}
                </div>}
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
            </div>
            <button type="button" className="dsh-evolve-button dsh-evolve-primary" disabled={busy} onClick={() => promote(generation.generationId)}>{t('action.promote')}</button>
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

function EvaluatorDetail({ detail, note, busy, setNote, back, confirm, t }: {
  detail: EvolutionEvaluatorDraftDetail
  note: string
  busy: boolean
  setNote: (value: string) => void
  back: () => void
  confirm: (action: ConfirmAction) => void
  t: (key: string) => string
}) {
  const validNote = note.trim().length > 0
  const hasDraft = detail.draft.id !== detail.draft.launchId
  const canApprove = hasDraft && ['draft-ready', 'qualification-running', 'incomplete'].includes(detail.draft.status)
  const canReject = !['qualified', 'rejected'].includes(detail.draft.status)
  return <section>
    <h3 className="dsh-evolve-section-title">{t('section.evaluatorDetail')}</h3>
    <dl className="dsh-evolve-detail-grid">
      <dt>{t('label.skill')}</dt><dd>{detail.draft.skillName}</dd>
      <dt>{t('label.status')}</dt><dd>{detail.draft.status}</dd>
      <dt>{t('label.tokens')}</dt><dd>{detail.draft.cost.inputTokens} in / {detail.draft.cost.outputTokens} out</dd>
      <dt>{t('label.limitations')}</dt><dd>{detail.limitations.join('; ')}</dd>
    </dl>
    {detail.files.map(file => <section key={file.path}>
      <h4 className="dsh-evolve-section-title">{file.path}</h4>
      <pre className="dsh-evolve-diff">{file.content}</pre>
    </section>)}
    <label>
      <span className="dsh-evolve-section-title">{t('field.note')}</span>
      <textarea className="dsh-evolve-note" aria-label={t('field.note')} value={note} maxLength={500} onChange={event => setNote(event.currentTarget.value)} />
    </label>
    <div className="dsh-evolve-actions">
      <button type="button" className="dsh-evolve-button" disabled={busy} onClick={back}>{t('action.back')}</button>
      {(canApprove || canReject) && <>
        <button type="button" className="dsh-evolve-button dsh-evolve-danger" disabled={busy || !validNote} onClick={() => confirm('rejectEvaluator')}>{t('action.reject')}</button>
        {canApprove && <>
          <button type="button" className="dsh-evolve-button" disabled={busy || !validNote} onClick={() => confirm('approveEvaluator')}>{t('action.approveEvaluator')}</button>
          {detail.qualifiedShadowAvailable && <button type="button" className="dsh-evolve-button dsh-evolve-primary" disabled={busy || !validNote} onClick={() => confirm('approveAndShadow')}>{t('action.approveAndShadow')}</button>}
        </>}
      </>}
      {detail.draft.status === 'qualified' && detail.qualifiedShadowAvailable && (
        <button type="button" className="dsh-evolve-button dsh-evolve-primary" disabled={busy} onClick={() => confirm('qualifiedShadow')}>{t('action.startQualifiedShadow')}</button>
      )}
    </div>
  </section>
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
      {detail.review.automaticReviewExpiry !== undefined && <>
        <dt>{t('label.reviewExpiry')}</dt>
        <dd>{t(detail.review.automaticReviewExpiry.eligible ? 'review.expiryEligible' : 'review.expiryOpen')} {detail.review.automaticReviewExpiry.eligibleAt}. {t('review.expiryTrigger')}</dd>
      </>}
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
