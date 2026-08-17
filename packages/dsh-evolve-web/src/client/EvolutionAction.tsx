import { useEffect, useRef, useState } from 'react'
import type {
  EvolutionActionReceipt,
  EvolutionEvaluatorDraftDetail,
  EvolutionOverview,
  EvolutionReviewDetail,
} from 'dsh-evolve/client'
import { remoteValue, type EvolutionRemoteClient } from './remote.ts'

export interface EvolutionActionProps {
  readonly remote: EvolutionRemoteClient
  readonly t: (key: string) => string
  readonly wide?: boolean
}

type ConfirmAction = 'approve' | 'reject' | 'promote' | 'rollback' | 'shadow' | 'authorEvaluator' | 'approveEvaluator' | 'approveAndShadow' | 'rejectEvaluator' | 'qualifiedShadow'

/** Sidebar trigger and bounded global evolution control panel. */
export function EvolutionAction({ remote, t, wide = true }: EvolutionActionProps) {
  const [open, setOpen] = useState(false)
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

  const loadOverview = async () => {
    setError(undefined)
    try {
      setOverview(await remoteValue(remote.overview()))
    } catch (cause) {
      setError(message(cause))
    }
  }

  const refreshVisibleState = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const nextOverview = await remoteValue(remote.overview())
      setOverview(nextOverview)
      if (detail !== undefined) {
        try {
          setDetail(await remoteValue(remote.review(detail.review.id)))
        } catch (cause) {
          setDetail(undefined)
          throw cause
        }
      } else if (evaluatorDetail !== undefined) {
        try {
          setEvaluatorDetail(await remoteValue(remote.evaluatorDraft(evaluatorDetail.draft.id)))
        } catch (cause) {
          setEvaluatorDetail(undefined)
          throw cause
        }
      }
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (open && overview === undefined && error === undefined) void loadOverview()
  }, [open])

  const inspect = async (id: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setDetail(await remoteValue(remote.review(id)))
      setEvaluatorDetail(undefined)
      setNote('')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const inspectEvaluator = async (id: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setEvaluatorDetail(await remoteValue(remote.evaluatorDraft(id)))
      setDetail(undefined)
      setNote('')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const run = async (request: () => Promise<EvolutionActionReceipt>) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    setConfirm(undefined)
    try {
      const receipt = await request()
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
      await loadOverview()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const executeConfirmed = () => {
    if (confirm === 'approve' && detail !== undefined) {
      void run(() => remoteValue(remote.approveReview(detail.review.id, note.trim())))
    } else if (confirm === 'reject' && detail !== undefined) {
      void run(() => remoteValue(remote.rejectReview(detail.review.id, note.trim())))
    } else if (confirm === 'promote' && promotionTarget !== undefined) {
      void run(() => remoteValue(remote.promote(promotionTarget)))
    } else if (confirm === 'rollback') {
      void run(() => remoteValue(remote.rollback()))
    } else if (confirm === 'shadow' && shadowSelection !== undefined) {
      void run(() => remoteValue(remote.startFeedbackShadow(
        shadowSelection.signalId,
        shadowSelection.targetId,
      )))
    } else if (confirm === 'authorEvaluator' && evaluatorSelection !== undefined) {
      void run(() => remoteValue(remote.authorEvaluator(
        evaluatorSelection.signalId,
        evaluatorSelection.targetId,
      )))
    } else if (confirm === 'approveEvaluator' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.approveEvaluator(evaluatorDetail.draft.id, note.trim())))
    } else if (confirm === 'approveAndShadow' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.approveAndStartEvaluatorShadow(
        evaluatorDetail.draft.id,
        note.trim(),
      )))
    } else if (confirm === 'rejectEvaluator' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.rejectEvaluator(evaluatorDetail.draft.id, note.trim())))
    } else if (confirm === 'qualifiedShadow' && evaluatorDetail !== undefined) {
      void run(() => remoteValue(remote.startEvaluatorShadow(evaluatorDetail.draft.id)))
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
          <div className="dsh-evolve-body">
            {overview === undefined && error === undefined && <div className="dsh-evolve-message">{t('status.loading')}</div>}
            {overview !== undefined && <Overview summary={overview} t={t} />}
            <div className="dsh-evolve-actions">
              <button type="button" className="dsh-evolve-button" disabled={busy} onClick={() => { void refreshVisibleState() }}>{t('action.refresh')}</button>
              {overview?.recovery.available === true && (
                <button
                  type="button"
                  className="dsh-evolve-button"
                  disabled={busy}
                  onClick={() => { void run(() => remoteValue(overview.recovery.paused === true ? remote.resume() : remote.pause())) }}
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
            {notice !== undefined && <div className="dsh-evolve-message" role="status">{notice}</div>}
            {error !== undefined && <div className="dsh-evolve-message dsh-evolve-error" role="alert">{t('error.prefix')}{error}</div>}
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
                {feedbackShadow.targets.map(target => (
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
              {evaluatorAuthoring.targets.map(target => (
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
