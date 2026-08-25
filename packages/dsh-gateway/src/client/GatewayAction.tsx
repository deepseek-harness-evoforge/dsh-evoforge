import { useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  GatewayHealthSnapshot,
  GatewayPairingSessionApprovalReceipt,
} from '../client-types.ts'

export interface GatewayRemoteClient {
  overview(): Promise<RemoteResult<GatewayHealthSnapshot>>
  approvePairing(
    code: string,
    adapter: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<RemoteResult<GatewayPairingSessionApprovalReceipt>>
}

export type GatewayActionProps = PropsRuntime<'sidebar.footer.action'> & {
  readonly remote: GatewayRemoteClient
  readonly t: (key: string) => string
}

type ViewStatus = 'ready' | 'busy' | 'attention' | 'degraded' | 'stopping'

/** Global DSH Web control surface for Gateway health and Host-owned pairing. */
export function GatewayAction({ remote, t, useSessions, useWorkspaces, wide }: GatewayActionProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const requestRef = useRef(0)
  const sessionId = useSessions(state => state.current)
  const workspaceId = useWorkspaces(state => sessionId === undefined
    ? undefined
    : state.items.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingReceipt, setPairingReceipt] = useState<GatewayPairingSessionApprovalReceipt>()
  const [snapshot, setSnapshot] = useState<GatewayHealthSnapshot>()
  const [error, setError] = useState<string>()

  const refresh = async () => {
    const request = ++requestRef.current
    setBusy(true)
    setError(undefined)
    try {
      const result = await remote.overview()
      if (request !== requestRef.current) return
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setSnapshot(result.value)
    } catch (cause) {
      if (request === requestRef.current) {
        setSnapshot(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (request === requestRef.current) setBusy(false)
    }
  }
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void refresh()
  }
  const close = () => {
    requestRef.current += 1
    setOpen(false)
    triggerRef.current?.focus()
  }
  const approvePairing = async () => {
    const code = pairingCode.trim().toUpperCase()
    setPairingReceipt(undefined)
    setError(undefined)
    if (workspaceId === undefined || sessionId === undefined) {
      setError(t('pairing.noTarget'))
      return
    }
    if (!/^[A-HJ-NP-Z2-9]{10}$/u.test(code)) {
      setError(t('pairing.invalidCode'))
      return
    }
    setPairingBusy(true)
    try {
      const result = await remote.approvePairing(code, 'feishu', workspaceId, sessionId)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setPairingReceipt(result.value)
      setPairingCode('')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPairingBusy(false)
    }
  }
  const status = snapshot === undefined ? undefined : viewStatus(snapshot)

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="dsh-gateway-trigger"
      aria-label={t('trigger.label')}
      aria-expanded={open}
      onClick={toggle}
    >
      <span aria-hidden="true">◎</span>
      {wide && <span>{t('trigger.label')}</span>}
    </button>
    {open && <section className="dsh-gateway-panel" role="dialog" aria-label={t('panel.title')}>
      <header className="dsh-gateway-head">
        <div>
          <h2>{t('panel.title')}</h2>
          <p>{t('panel.subtitle')}</p>
        </div>
        <button type="button" className="dsh-gateway-close" aria-label={t('panel.close')} onClick={close}>×</button>
      </header>
      <div className="dsh-gateway-body">
        {status !== undefined && <span className={`dsh-gateway-status is-${status}`}>{t(`health.${status}`)}</span>}
        {error !== undefined && <div className="dsh-gateway-message is-error" role="alert">{t('error.prefix')}{error}</div>}
        {snapshot === undefined && error === undefined && <div className="dsh-gateway-message" role="status">{t('status.loading')}</div>}
        {snapshot !== undefined && <>
          <div className="dsh-gateway-summary">
            <strong>{format(t('summary.routes'), snapshot.routes.total)}</strong>
            <strong>{format(t('summary.sessions'), snapshot.routes.liveSessions)}</strong>
            <span>{t(`lifecycle.${snapshot.lifecycle}`)}</span>
          </div>
          <section className="dsh-gateway-section dsh-gateway-pairing">
            <h3>{t('pairing.title')}</h3>
            <p>{t('pairing.help')}</p>
            <label htmlFor="dsh-gateway-pairing-code">{t('pairing.code')}</label>
            <div className="dsh-gateway-pairing-row">
              <input
                id="dsh-gateway-pairing-code"
                value={pairingCode}
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCDEFGH23"
                onChange={event => setPairingCode(event.target.value.toUpperCase())}
              />
              <button
                type="button"
                disabled={pairingBusy || workspaceId === undefined || sessionId === undefined}
                onClick={() => { void approvePairing() }}
              >
                {pairingBusy ? t('pairing.approving') : t('pairing.approve')}
              </button>
            </div>
            {workspaceId === undefined || sessionId === undefined
              ? <small>{t('pairing.noTarget')}</small>
              : <small>{t('pairing.target')} <code>{workspaceId}</code> / <code>{sessionId}</code></small>}
            {pairingReceipt !== undefined && <div className="dsh-gateway-message is-success" role="status">
              {t('pairing.approved')} <code>{pairingReceipt.routeId}</code>
            </div>}
          </section>
          <section className="dsh-gateway-section">
            <h3>{t('transport.title')}</h3>
            {snapshot.transports.items.length === 0
              ? <p>{t('transport.empty')}</p>
              : snapshot.transports.items.map(item => <article key={`${item.adapter}:${item.kind}`} className="dsh-gateway-transport">
                <div><strong>{item.adapter}</strong><code>{item.kind}</code></div>
                <span className={`dsh-gateway-pill is-${item.state}`}>{item.state}</span>
                <div className="dsh-gateway-routes">{item.routeIds.map(id => <code key={id}>{id}</code>)}</div>
              </article>)}
          </section>
          <section className="dsh-gateway-section">
            <h3>{t('delivery.title')}</h3>
            <dl className="dsh-gateway-grid">
              <div><dt>{t('delivery.ingress')}</dt><dd>{snapshot.ingress.total}</dd></div>
              <div><dt>{t('delivery.outbound')}</dt><dd>{snapshot.outbound.total}</dd></div>
              <div><dt>{t('delivery.pending')}</dt><dd>{snapshot.outbound.prepared + snapshot.outbound.sending + snapshot.outbound.retrying}</dd></div>
              <div><dt>{t('delivery.uncertain')}</dt><dd>{snapshot.ingress.uncertain + snapshot.outbound.uncertain}</dd></div>
              <div><dt>{t('delivery.failed')}</dt><dd>{snapshot.outbound.failed}</dd></div>
            </dl>
          </section>
          <p className="dsh-gateway-foot">{t('foot.noModel')} · {new Date(snapshot.observedAt).toLocaleString()}</p>
        </>}
        <button type="button" className="dsh-gateway-refresh" disabled={busy} onClick={() => { void refresh() }}>
          {busy ? t('status.refreshing') : t('status.refresh')}
        </button>
      </div>
    </section>}
  </>
}

function viewStatus(snapshot: GatewayHealthSnapshot): ViewStatus {
  if (snapshot.lifecycle === 'stopping' || snapshot.transports.stopping > 0) return 'stopping'
  if (snapshot.transports.degraded > 0) return 'degraded'
  if (snapshot.ingress.uncertain + snapshot.outbound.uncertain + snapshot.outbound.failed > 0) return 'attention'
  if (snapshot.lifecycle === 'starting' || snapshot.transports.connecting > 0
    || snapshot.ingress.prepared + snapshot.ingress.executing
      + snapshot.outbound.prepared + snapshot.outbound.sending + snapshot.outbound.retrying > 0) return 'busy'
  return 'ready'
}

function format(template: string, count: number): string {
  return template.replace('{count}', String(count))
}
