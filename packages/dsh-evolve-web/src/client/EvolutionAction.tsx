import { useEffect, useRef, useState } from 'react'
import type { EvolutionActionReceipt, EvolutionOverview, EvolutionReviewDetail } from 'dsh-evolve/client'
import { remoteValue, type EvolutionRemoteClient } from './remote.ts'

export interface EvolutionActionProps {
  readonly remote: EvolutionRemoteClient
  readonly t: (key: string) => string
  readonly wide?: boolean
}

type ConfirmAction = 'approve' | 'reject' | 'promote' | 'rollback'

/** Sidebar trigger and bounded global evolution control panel. */
export function EvolutionAction({ remote, t, wide = true }: EvolutionActionProps) {
  const [open, setOpen] = useState(false)
  const [overview, setOverview] = useState<EvolutionOverview>()
  const [detail, setDetail] = useState<EvolutionReviewDetail>()
  const [note, setNote] = useState('')
  const [promotionTarget, setPromotionTarget] = useState<string>()
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

  useEffect(() => {
    if (open && overview === undefined && error === undefined) void loadOverview()
  }, [open])

  const inspect = async (id: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setDetail(await remoteValue(remote.review(id)))
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
    }
  }

  const close = () => {
    setOpen(false)
    setConfirm(undefined)
    triggerRef.current?.focus()
  }

  const pending = overview?.reviews.actionableCount ?? 0
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
              <button type="button" className="dsh-evolve-button" disabled={busy} onClick={() => { void loadOverview() }}>{t('action.refresh')}</button>
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
              : (
                  <ReviewDetail
                    detail={detail}
                    note={note}
                    busy={busy}
                    setNote={setNote}
                    back={() => setDetail(undefined)}
                    confirm={setConfirm}
                    t={t}
                  />
                )}
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
    [t('status.reviews'), String(summary.reviews.actionableCount)],
    [t('status.auto'), t(summary.automaticPromotion.enabled ? 'status.on' : 'status.off')],
  ]
  return <div className="dsh-evolve-summary">{stats.map(([label, value]) => (
    <div className="dsh-evolve-stat" key={label}>
      <span className="dsh-evolve-stat-label">{label}</span>
      <span className="dsh-evolve-stat-value" title={value}>{value}</span>
    </div>
  ))}</div>
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
            </div>
            <button type="button" className="dsh-evolve-button dsh-evolve-primary" disabled={busy} onClick={() => promote(generation.generationId)}>{t('action.promote')}</button>
          </div>
        </li>
      ))}</ul>
    </section>}
  </>
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
    <dl className="dsh-evolve-detail-grid">
      <dt>{t('label.skill')}</dt><dd>{detail.review.skillName}</dd>
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
