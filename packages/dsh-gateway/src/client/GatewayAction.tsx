import { useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ControlSurfaceProps, ControlTone } from 'dsh-control-center/client'
import type {
  GatewayHealthSnapshot,
  GatewayPairingPendingRequest,
  GatewayPairingRevocationReceipt,
  GatewayPairingSessionApprovalReceipt,
} from '../client-types.ts'

export interface GatewayRemoteClient {
  overview(): Promise<RemoteResult<GatewayHealthSnapshot>>
  pendingPairings(): Promise<RemoteResult<readonly GatewayPairingPendingRequest[]>>
  approvePairing(
    code: string,
    adapter: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<RemoteResult<GatewayPairingSessionApprovalReceipt>>
  approvePairingRequest(
    requestId: string,
    workspaceId: string,
    sessionId: string,
  ): Promise<RemoteResult<GatewayPairingSessionApprovalReceipt>>
  revokePairing(routeId: string): Promise<RemoteResult<GatewayPairingRevocationReceipt>>
}

export type GatewaySurfaceProps = ControlSurfaceProps & {
  readonly remote: GatewayRemoteClient
  readonly t: (key: string) => string
}

type ViewStatus = 'ready' | 'busy' | 'attention' | 'degraded' | 'stopping'
const PENDING_POLL_INTERVAL_MS = 5_000

/** Gateway Adapter for the common DSH Control Surface. */
export function GatewaySurface({ remote, t, sessionId, useWorkspaces, ui: UI }: GatewaySurfaceProps) {
  const requestRef = useRef(0)
  const pendingRequestRef = useRef(0)
  const workspaceId = useWorkspaces(state => state.items.find(workspace => workspace.sessionIds.includes(sessionId))?.workspaceId)
  const [busy, setBusy] = useState(false)
  const [pairingBusy, setPairingBusy] = useState(false)
  const [pairingCode, setPairingCode] = useState('')
  const [pairingReceipt, setPairingReceipt] = useState<GatewayPairingSessionApprovalReceipt>()
  const [revokingRoute, setRevokingRoute] = useState<string>()
  const [confirmingRoute, setConfirmingRoute] = useState<string>()
  const [revocationReceipt, setRevocationReceipt] = useState<GatewayPairingRevocationReceipt>()
  const [snapshot, setSnapshot] = useState<GatewayHealthSnapshot>()
  const [pendingPairings, setPendingPairings] = useState<readonly GatewayPairingPendingRequest[]>([])
  const [error, setError] = useState<string>()

  const refresh = async () => {
    const request = ++requestRef.current
    const pendingRequest = ++pendingRequestRef.current
    setBusy(true)
    setError(undefined)
    try {
      const [result, pendingResult] = await Promise.all([remote.overview(), remote.pendingPairings()])
      if (request !== requestRef.current) return
      if (!result.ok) throw new Error(t('error.unavailable'))
      if (!pendingResult.ok) throw new Error(t('error.unavailable'))
      setSnapshot(result.value)
      if (pendingRequest === pendingRequestRef.current) setPendingPairings(pendingResult.value)
      setConfirmingRoute(undefined)
    } catch (cause) {
      if (request === requestRef.current) setError(presentError(cause, t('error.unavailable')))
    } finally {
      if (request === requestRef.current) setBusy(false)
    }
  }

  const refreshPending = async () => {
    const request = ++pendingRequestRef.current
    try {
      const result = await remote.pendingPairings()
      if (request !== pendingRequestRef.current || !result.ok) return
      setPendingPairings(result.value)
    } catch {
      // A transient polling failure must not erase the last authoritative list.
    }
  }

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => { void refreshPending() }, PENDING_POLL_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      requestRef.current += 1
      pendingRequestRef.current += 1
    }
  }, [remote])

  const revokePairing = async (routeId: string) => {
    if (confirmingRoute !== routeId) {
      setConfirmingRoute(routeId)
      return
    }
    setRevokingRoute(routeId)
    setRevocationReceipt(undefined)
    setError(undefined)
    try {
      const result = await remote.revokePairing(routeId)
      if (!result.ok) throw new Error(t('error.actionFailed'))
      setRevocationReceipt(result.value)
      await refresh()
    } catch (cause) {
      setError(presentError(cause, t('error.actionFailed')))
    } finally {
      setRevokingRoute(undefined)
    }
  }

  const approvePairing = async () => {
    const code = pairingCode.trim().toUpperCase()
    setPairingReceipt(undefined)
    setError(undefined)
    if (workspaceId === undefined) {
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
      if (!result.ok) throw new Error(t('error.actionFailed'))
      setPairingReceipt(result.value)
      setPairingCode('')
      await refresh()
    } catch (cause) {
      setError(presentError(cause, t('error.actionFailed')))
    } finally {
      setPairingBusy(false)
    }
  }

  const approvePendingPairing = async (requestId: string) => {
    setPairingReceipt(undefined)
    setError(undefined)
    if (workspaceId === undefined) {
      setError(t('pairing.noTarget'))
      return
    }
    setPairingBusy(true)
    try {
      const result = await remote.approvePairingRequest(requestId, workspaceId, sessionId)
      if (!result.ok) throw new Error(t('error.actionFailed'))
      setPairingReceipt(result.value)
      await refresh()
    } catch (cause) {
      setError(presentError(cause, t('error.actionFailed')))
    } finally {
      setPairingBusy(false)
    }
  }

  const status = snapshot === undefined ? undefined : viewStatus(snapshot)
  const pending = snapshot === undefined ? 0 : snapshot.outbound.prepared + snapshot.outbound.sending + snapshot.outbound.retrying
  const anomalies = snapshot === undefined ? 0 : snapshot.ingress.uncertain + snapshot.outbound.uncertain + snapshot.outbound.failed

  return <UI.Surface ariaLabel={t('surface.title')}>
    <UI.Header
      eyebrow={t('surface.eyebrow')}
      title={t('surface.title')}
      description={t('surface.description')}
      status={status === undefined ? undefined : <UI.Status tone={statusTone(status)}>{t(`health.${status}`)}</UI.Status>}
      actions={<UI.Button type="button" disabled={busy} onClick={() => { void refresh() }}>
        {busy ? t('status.refreshing') : t('status.refresh')}
      </UI.Button>}
    />

    {error !== undefined && <UI.Notice tone="danger" role="alert" title={t('error.title')}>{error}</UI.Notice>}
    {snapshot === undefined
      ? <UI.Loading cards={4} />
      : <>
        <UI.Metrics items={[
          { label: t('metric.routes'), value: snapshot.routes.total, hint: format(t('summary.sessions'), snapshot.routes.liveSessions) },
          { label: t('delivery.ingress'), value: snapshot.ingress.total, hint: t('metric.durable') },
          { label: t('delivery.outbound'), value: snapshot.outbound.total, hint: t('metric.durable') },
          { label: t('metric.anomalies'), value: anomalies, hint: pending === 0 ? t('metric.noPending') : format(t('metric.pending'), pending), tone: anomalies > 0 ? 'danger' : pending > 0 ? 'working' : 'healthy' },
        ]} />

        <UI.Section title={t('transport.title')} description={t('transport.description')}>
          {snapshot.transports.items.length === 0
            ? <UI.Empty title={t('transport.emptyTitle')} description={t('transport.empty')} />
            : snapshot.transports.items.map(item => <UI.Entity
              key={`${item.adapter}:${item.kind}`}
              icon={item.adapter.slice(0, 1).toUpperCase()}
              title={adapterLabel(item.adapter)}
              description={item.kind}
              status={<UI.Status tone={transportTone(item.state)}>{transportLabel(t, item.state)}</UI.Status>}
              details={<details><summary>{format(t('technical.routes'), item.routeIds.length)}</summary>
                {item.routeIds.map(id => <div key={id}><code>{id}</code></div>)}
                <div>{t('transport.connectedAt')}: {formatTimestamp(item.connectedAt, t)}</div>
                <div>{t('transport.lastActivityAt')}: {formatTimestamp(item.lastActivityAt, t)}</div>
                <div>{t('transport.lastErrorAt')}: {formatTimestamp(item.lastErrorAt, t)}</div>
              </details>}
            />)}
        </UI.Section>

        <UI.Section title={t('routes.title')} description={t('routes.help')}>
          {snapshot.routes.items.length === 0
            ? <UI.Empty title={t('routes.emptyTitle')} description={t('routes.empty')} />
            : snapshot.routes.items.map(route => <UI.Entity
              key={route.id}
              icon={route.adapter.slice(0, 1).toUpperCase()}
              title={adapterLabel(route.adapter)}
              description={t(route.paired ? 'routes.pairedDescription' : 'routes.configuredDescription')}
              status={<UI.Status tone={route.paired ? 'healthy' : 'neutral'}>{t(route.paired ? 'routes.paired' : 'routes.configured')}</UI.Status>}
              details={<details><summary>{t('technical.details')}</summary><code>{route.id}</code></details>}
              actions={route.paired && <UI.Button
                type="button"
                tone={confirmingRoute === route.id ? 'danger' : 'quiet'}
                disabled={revokingRoute !== undefined}
                aria-label={routeLabel(t(confirmingRoute === route.id ? 'routes.confirmRevoke' : 'routes.revoke'), route.id)}
                onClick={() => { void revokePairing(route.id) }}
              >
                {revokingRoute === route.id ? t('routes.revoking') : t(confirmingRoute === route.id ? 'routes.confirm' : 'routes.revokeShort')}
              </UI.Button>}
            />)}
        </UI.Section>

        <UI.Section title={t('pairing.pendingTitle')} description={t('pairing.pendingHelp')}>
          {pendingPairings.length === 0
            ? <UI.Empty title={t('pairing.pendingEmptyTitle')} description={t('pairing.pendingEmpty')} />
            : pendingPairings.map(request => <UI.Entity
              key={request.requestId}
              icon={request.adapter.slice(0, 1).toUpperCase()}
              title={adapterLabel(request.adapter)}
              description={format(t('pairing.pendingExpires'), formatRemaining(request.expiresAt))}
              status={<UI.Status tone="attention">{t('pairing.pendingStatus')}</UI.Status>}
              details={<details><summary>{t('technical.details')}</summary><code>{request.requestId}</code><br /><small>{t('pairing.accountHash')}: {request.accountIdHash}</small></details>}
              actions={<UI.Button
                type="button"
                tone="primary"
                disabled={pairingBusy || workspaceId === undefined}
                aria-label={t('pairing.approvePending')}
                onClick={() => { void approvePendingPairing(request.requestId) }}
              >{pairingBusy ? t('pairing.approving') : t('pairing.approvePending')}</UI.Button>}
            />)}
        </UI.Section>

        {revocationReceipt !== undefined && <UI.Notice tone="healthy">{t('routes.revokedShort')}</UI.Notice>}

        <UI.Section title={t('pairing.title')} description={t('pairing.help')}>
          <div className="dsh-cc-form">
            <label htmlFor="dsh-gateway-pairing-code">{t('pairing.code')}</label>
            <div className="dsh-cc-form-row">
              <input
                id="dsh-gateway-pairing-code"
                value={pairingCode}
                maxLength={10}
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCDEFGH23"
                onChange={event => { setPairingCode(event.target.value.toUpperCase()) }}
              />
              <UI.Button type="button" tone="primary" disabled={pairingBusy || workspaceId === undefined} onClick={() => { void approvePairing() }}>
                {pairingBusy ? t('pairing.approving') : t('pairing.approve')}
              </UI.Button>
            </div>
            <p>{workspaceId === undefined ? t('pairing.noTarget') : t('pairing.currentTarget')}</p>
            {pairingReceipt !== undefined && <UI.Notice tone="healthy">{t('pairing.approvedShort')}</UI.Notice>}
          </div>
        </UI.Section>

        <UI.Notice tone={anomalies > 0 ? 'attention' : 'neutral'}>
          {t('foot.noModel')} · {new Date(snapshot.observedAt).toLocaleString()}
        </UI.Notice>
      </>}
  </UI.Surface>
}

export const GatewayAction = GatewaySurface
export type GatewayActionProps = GatewaySurfaceProps

function viewStatus(snapshot: GatewayHealthSnapshot): ViewStatus {
  if (snapshot.lifecycle === 'stopping' || snapshot.transports.stopping > 0) return 'stopping'
  if (snapshot.transports.degraded > 0) return 'degraded'
  if (snapshot.ingress.uncertain + snapshot.outbound.uncertain + snapshot.outbound.failed > 0) return 'attention'
  if (snapshot.lifecycle === 'starting' || snapshot.transports.connecting > 0
    || snapshot.ingress.prepared + snapshot.ingress.executing
      + snapshot.outbound.prepared + snapshot.outbound.sending + snapshot.outbound.retrying > 0) return 'busy'
  return 'ready'
}

function statusTone(status: ViewStatus): ControlTone {
  if (status === 'ready') return 'healthy'
  if (status === 'busy') return 'working'
  if (status === 'attention') return 'attention'
  if (status === 'degraded') return 'danger'
  return 'neutral'
}

function transportTone(state: GatewayHealthSnapshot['transports']['items'][number]['state']): ControlTone {
  if (state === 'ready') return 'healthy'
  if (state === 'connecting') return 'working'
  if (state === 'degraded') return 'danger'
  return 'neutral'
}

function transportLabel(t: (key: string) => string, state: string): string {
  return t(`transport.state.${state}`)
}

function adapterLabel(adapter: string): string {
  if (adapter === 'feishu') return '飞书'
  if (adapter === 'telegram') return 'Telegram'
  return adapter
}

function format(template: string, count: number | string): string {
  return template.replace('{count}', String(count))
}

function routeLabel(template: string, routeId: string): string {
  return template.replace('{routeId}', routeId)
}

function formatRemaining(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now())
  const minutes = Math.ceil(remaining / 60_000)
  return `${minutes} min`
}

function formatTimestamp(value: number | undefined, t: (key: string) => string): string {
  return value === undefined ? t('transport.never') : new Date(value).toLocaleString()
}

function presentError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && (cause.message === fallback || cause.message.startsWith('配对码'))) return cause.message
  return fallback
}
