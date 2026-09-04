import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { RemoteResult as DshRemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ControlSurfaceProps, ControlTone } from 'dsh-control-center/client'
import type { FeishuCredentialReferences } from '../feishu-credentials-remote.js'
import { parseFeishuHealthCommand, type FeishuHealthSnapshot, type FeishuHealthStatus } from '../health.js'

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface FeishuCommandsClient {
  list(sessionId: SessionId): Promise<RemoteResult<readonly CommandDescriptor[]>>
  execute(sessionId: SessionId, line: string, images?: readonly never[]): Promise<RemoteResult<CommandExecution | undefined>>
}

/** Native DSH credential seam; values only travel to Host and are never read back. */
export interface FeishuCredentialsClient {
  describe(refs: readonly string[]): Promise<DshRemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<DshRemoteResult<void>>
}

export interface FeishuCredentialReferencesClient {
  references(): Promise<DshRemoteResult<FeishuCredentialReferences>>
}

export type FeishuSurfaceProps = ControlSurfaceProps & {
  readonly commands: FeishuCommandsClient
  readonly credentials?: FeishuCredentialsClient
  readonly credentialReferences?: FeishuCredentialReferencesClient
  readonly t: (key: string) => string
}

const RC2_COMMAND_ARITY = 'client api: commands/execute expected 3 business argument(s) plus an optional AbortSignal, got 2'
const FEISHU_APP_ID_REF = 'DSH_FEISHU_APP_ID'
const FEISHU_APP_SECRET_REF = 'DSH_FEISHU_APP_SECRET'
const commandApiModes = new WeakMap<FeishuCommandsClient, 'legacy' | 'images'>()

/** Feishu Adapter for the common DSH Control Surface; pairing remains Gateway-owned. */
export function FeishuSurface({ commands, credentials, credentialReferences, t, sessionId, ui: UI }: FeishuSurfaceProps) {
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const [available, setAvailable] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [health, setHealth] = useState<FeishuHealthSnapshot>()
  const [credentialRefs, setCredentialRefs] = useState({ appIdRef: FEISHU_APP_ID_REF, appSecretRef: FEISHU_APP_SECRET_REF })
  const [credentialInfo, setCredentialInfo] = useState<Record<string, CredentialInfo>>()
  const [credentialDraft, setCredentialDraft] = useState({ appId: '', appSecret: '' })
  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialMessage, setCredentialMessage] = useState<string>()
  const [credentialError, setCredentialError] = useState<string>()
  const appIdInputId = `${sessionId}-feishu-app-id`
  const appSecretInputId = `${sessionId}-feishu-app-secret`

  const refreshCredentials = async (refs = credentialRefs) => {
    if (credentials === undefined) return
    try {
      const response = await credentials.describe([refs.appIdRef, refs.appSecretRef])
      if (!response.ok) throw new Error(t('credentials.error'))
      setCredentialInfo(response.value)
    } catch {
      setCredentialInfo(undefined)
      setCredentialError(t('credentials.error'))
    }
  }

  const saveCredentials = async () => {
    if (credentials === undefined) return
    const appId = credentialDraft.appId.trim()
    const appSecret = credentialDraft.appSecret.trim()
    if (appId.length === 0 && appSecret.length === 0) {
      setCredentialError(t('credentials.enterOne'))
      return
    }
    setCredentialBusy(true)
    setCredentialError(undefined)
    setCredentialMessage(undefined)
    try {
      if (appId.length > 0) {
        const response = await credentials.set(credentialRefs.appIdRef, appId)
        if (!response.ok) throw new Error(t('credentials.error'))
      }
      if (appSecret.length > 0) {
        const response = await credentials.set(credentialRefs.appSecretRef, appSecret)
        if (!response.ok) throw new Error(t('credentials.error'))
      }
      setCredentialDraft({ appId: '', appSecret: '' })
      setCredentialMessage(t('credentials.saved'))
      await refreshCredentials(credentialRefs)
    } catch {
      setCredentialError(t('credentials.error'))
    } finally {
      setCredentialBusy(false)
    }
  }

  const refresh = async () => {
    const target = sessionId
    setBusy(true)
    setError(undefined)
    try {
      const response = await executeCommand(commands, target, '/feishu')
      if (!response.ok) throw new Error(t('error.unavailable'))
      if (response.value === undefined) throw new Error(t('error.unavailable'))
      if (sessionRef.current !== target) return
      const result = response.value.result
      if (result.kind === 'error') throw new Error(t('error.unavailable'))
      setHealth(parseFeishuHealthCommand(result.text ?? ''))
    } catch (cause) {
      if (sessionRef.current === target) setError(presentError(cause, t('error.unavailable')))
    } finally {
      if (sessionRef.current === target) setBusy(false)
    }
  }

  useEffect(() => {
    let current = true
    setAvailable(undefined)
    setBusy(false)
    setError(undefined)
    setHealth(undefined)
    void commands.list(sessionId).then((result) => {
      if (!current || sessionRef.current !== sessionId) return
      if (!result.ok) {
        setAvailable(true)
        setError(t('error.unavailable'))
        return
      }
      const next = result.value.some(command => command.name === 'feishu')
      setAvailable(next)
      if (next) void refresh()
    }, (cause: unknown) => {
      if (current && sessionRef.current === sessionId) {
        setAvailable(true)
        setError(presentError(cause, t('error.unavailable')))
      }
    })
    return () => { current = false }
  }, [commands, sessionId])

  useEffect(() => {
    setCredentialInfo(undefined)
    setCredentialRefs({ appIdRef: FEISHU_APP_ID_REF, appSecretRef: FEISHU_APP_SECRET_REF })
    setCredentialDraft({ appId: '', appSecret: '' })
    setCredentialMessage(undefined)
    setCredentialError(undefined)
    if (credentials === undefined) return
    let current = true
    void (async () => {
      let refs = { appIdRef: FEISHU_APP_ID_REF, appSecretRef: FEISHU_APP_SECRET_REF }
      if (credentialReferences !== undefined) {
        const response = await credentialReferences.references()
        if (!response.ok) throw new Error(t('credentials.error'))
        refs = response.value
      }
      if (!current) return
      setCredentialRefs(refs)
      await refreshCredentials(refs)
    })().catch(() => {
      if (current) {
        setCredentialInfo(undefined)
        setCredentialError(t('credentials.error'))
      }
    })
    return () => { current = false }
  }, [credentials, credentialReferences, sessionId])

  const anomalies = health === undefined ? 0 : health.deliveries.uncertain + health.deliveries.failed
  const active = health === undefined ? 0 : health.deliveries.prepared + health.deliveries.sending + health.deliveries.retrying

  const credentialsConfigured = credentialInfo?.[credentialRefs.appIdRef]?.configured === true
    && credentialInfo?.[credentialRefs.appSecretRef]?.configured === true

  return <UI.Surface ariaLabel={t('health.title')}>
    <UI.Header
      eyebrow={t('surface.eyebrow')}
      title={t('health.title')}
      description={t('surface.description')}
      status={health === undefined ? undefined : <UI.Status tone={healthTone(health.status)}>{t(`health.status.${health.status}`)}</UI.Status>}
      actions={<UI.Button type="button" disabled={busy || available !== true} onClick={() => { void refresh() }}>
        {busy ? t('health.refreshing') : t('health.refresh')}
      </UI.Button>}
    />

    {available === undefined && <UI.Loading cards={4} />}
    {available === false && <UI.Notice tone="attention" title={t('surface.unavailableTitle')}>{error ?? t('surface.unavailable')}</UI.Notice>}
    {available === true && error !== undefined && <UI.Notice tone="danger" role="alert" title={t('error.title')}>{error}</UI.Notice>}
    {available === true && health === undefined && error === undefined && <UI.Loading cards={4} />}

    {credentials !== undefined && <UI.Section
      title={t('credentials.title')}
      description={t('credentials.description')}
      actions={<UI.Status tone={credentialsConfigured ? 'healthy' : 'attention'}>
        {t(credentialsConfigured ? 'credentials.configured' : 'credentials.missing')}
      </UI.Status>}
    >
      <div className="dsh-cc-form">
        <p>{t('credentials.writeOnly')}</p>
        <label htmlFor={appIdInputId}>{t('credentials.appId')}</label>
        <div className="dsh-cc-form-row">
          <input
            id={appIdInputId}
            type="text"
            value={credentialDraft.appId}
            autoComplete="off"
            spellCheck={false}
            placeholder={credentialInfo?.[credentialRefs.appIdRef]?.configured === true ? t('credentials.replacePlaceholder') : t('credentials.requiredPlaceholder')}
            onChange={event => { setCredentialDraft(current => ({ ...current, appId: event.target.value })) }}
          />
        </div>
        <label htmlFor={appSecretInputId}>{t('credentials.appSecret')}</label>
        <div className="dsh-cc-form-row">
          <input
            id={appSecretInputId}
            type="password"
            value={credentialDraft.appSecret}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={credentialInfo?.[credentialRefs.appSecretRef]?.configured === true ? t('credentials.replacePlaceholder') : t('credentials.requiredPlaceholder')}
            onChange={event => { setCredentialDraft(current => ({ ...current, appSecret: event.target.value })) }}
          />
          <UI.Button type="button" tone="primary" disabled={credentialBusy} onClick={() => { void saveCredentials() }}>
            {credentialBusy ? t('credentials.saving') : t('credentials.save')}
          </UI.Button>
        </div>
        {credentialMessage !== undefined && <UI.Notice tone="healthy">{credentialMessage}</UI.Notice>}
        {credentialError !== undefined && <UI.Notice tone="danger" role="alert">{credentialError}</UI.Notice>}
      </div>
    </UI.Section>}

    {health !== undefined && <>
      <UI.Metrics items={[
        { label: t('health.routes'), value: health.routeCount, hint: t('metric.authorized') },
        { label: t('metric.delivered'), value: health.deliveries.delivered, hint: `${health.deliveries.total} ${t('metric.total')}`, tone: 'healthy' },
        { label: t('metric.active'), value: active, hint: `${health.deliveries.retrying} ${t('health.retrying')}`, tone: active > 0 ? 'working' : 'neutral' },
        { label: t('metric.anomalies'), value: anomalies, hint: `${health.pendingApprovals} ${t('health.approvals')}`, tone: anomalies > 0 ? 'danger' : health.pendingApprovals > 0 ? 'attention' : 'healthy' },
      ]} />

      <UI.Section title={t('section.connection')} description={t('section.connectionDescription')}>
        <UI.Entity
          icon="飞"
          title={t('entity.websocket')}
          description={t('entity.websocketDescription')}
          status={<UI.Status tone={transportTone(health.transport.state)}>{transportLabel(t, health.transport.state)}</UI.Status>}
          details={<details>
            <summary>{t('technical.details')}</summary>
            <div><code>{health.transport.kind}</code></div>
            <div><code>{health.accountId}</code></div>
            <div>{t('transport.lastInboundAt')}: {health.transport.lastInboundAt === undefined
              ? t('transport.noInbound')
              : new Date(health.transport.lastInboundAt).toLocaleString()}</div>
            <div>{t('transport.lastPolicyReject')}: {health.transport.lastPolicyRejectReason === undefined
              ? t('transport.noPolicyReject')
              : `${t(`transport.policyReject.${health.transport.lastPolicyRejectReason}`)} · ${new Date(health.transport.lastPolicyRejectAt ?? health.observedAt).toLocaleString()}`}</div>
          </details>}
        />
        {health.platformAccess === undefined
          ? <UI.Notice tone="neutral">{t('platformAccess.legacy')}</UI.Notice>
          : <UI.Entity
            icon={health.platformAccess.status === 'verified' ? '✓' : '!'}
            title={t('platformAccess.title')}
            description={t(`platformAccess.description.${health.platformAccess.status}`)}
            status={<UI.Status tone={platformAccessTone(health.platformAccess.status)}>{t(`platformAccess.status.${health.platformAccess.status}`)}</UI.Status>}
            details={<details>
              <summary>{t('technical.details')}</summary>
              <div>{t('platformAccess.botIdentity')}: {health.platformAccess.botIdentity}</div>
              <div>{t('platformAccess.scopeList')}: {health.platformAccess.scopeList}</div>
              <div>{t('platformAccess.eventSubscription')}: {health.platformAccess.eventSubscription}</div>
              <div>{t('platformAccess.requiredScopes')}: {health.platformAccess.requiredScopes.map(scope => `${scope.name}=${scope.granted ? 'ok' : 'missing'}`).join(', ')}</div>
              {health.platformAccess.reason !== undefined && <div>{t('platformAccess.reason')}: {t(`platformAccess.reason.${health.platformAccess.reason}`)}</div>}
              <div>{t('platformAccess.checkedAt')}: {new Date(health.platformAccess.checkedAt).toLocaleString()}</div>
            </details>}
          />}
        {health.routes.map(route => <UI.Entity
          key={route.id}
          icon="#"
          title={route.threadScoped ? t('health.thread') : t('health.chat')}
          description={t('entity.routeDescription')}
          status={<UI.Status tone="healthy">{t('entity.authorized')}</UI.Status>}
          details={<details><summary>{t('technical.details')}</summary><code>{route.id}</code></details>}
        />)}
        {health.routesTruncated && <UI.Notice tone="neutral">{t('health.routesTruncated')}</UI.Notice>}
      </UI.Section>

      <UI.Section title={t('section.delivery')} description={t('section.deliveryDescription')}>
        {health.deliveries.last === undefined
          ? <UI.Empty title={t('delivery.emptyTitle')} description={t('delivery.empty')} />
          : <UI.Entity
            icon="↗"
            title={t('health.lastDelivery')}
            description={`${new Date(health.deliveries.last.updatedAt).toLocaleString()} · ${health.deliveries.last.attempts} ${t('health.attempts')}`}
            status={<UI.Status tone={deliveryTone(health.deliveries.last.status)}>{health.deliveries.last.status}</UI.Status>}
          />}
      </UI.Section>

      <UI.Section title={t('health.contentTitle')} description={t('section.contentDescription')} actions={<UI.Status tone={contentTone(health.content.status)}>{t(`health.content.status.${health.content.status}`)}</UI.Status>}>
        <div className="dsh-cc-permissions">
          {health.content.permissions.map(permission => <div key={permission.name}>
            <span>{t(`health.content.permission.${permission.name}`)}</span>
            <strong className={permission.enabled ? 'is-enabled' : 'is-disabled'}>{t(permission.enabled ? 'health.content.enabled' : 'health.content.disabled')}</strong>
          </div>)}
          <div><span>{t('health.content.tool')}</span><strong className={health.content.toolAvailable ? 'is-enabled' : 'is-disabled'}>{t(health.content.toolAvailable ? 'health.content.available' : 'health.content.unavailable')}</strong></div>
          <div><span>{t('health.content.approval')}</span><strong className={health.content.approvalAvailable ? 'is-enabled' : 'is-disabled'}>{t(health.content.approvalAvailable ? 'health.content.available' : 'health.content.unavailable')}</strong></div>
        </div>
        <UI.Notice tone="neutral">{t('health.content.platformUnverified')}</UI.Notice>
      </UI.Section>

      <UI.Notice tone={anomalies > 0 ? 'attention' : 'neutral'}>
        {t('health.observed')} {new Date(health.observedAt).toLocaleString()} · {t('health.noModel')}
      </UI.Notice>
    </>}
  </UI.Surface>
}

export const FeishuAction = FeishuSurface
export type FeishuActionProps = FeishuSurfaceProps

function presentError(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message === fallback) return cause.message
  return fallback
}

async function executeCommand(
  commands: FeishuCommandsClient,
  sessionId: SessionId,
  line: string,
): Promise<RemoteResult<CommandExecution | undefined>> {
  const mode = commandApiModes.get(commands)
  if (mode === 'images') return commands.execute(sessionId, line, [])
  if (mode === 'legacy') return commands.execute(sessionId, line)
  try {
    const result = await commands.execute(sessionId, line)
    commandApiModes.set(commands, 'legacy')
    return result
  } catch (cause) {
    if (!(cause instanceof Error) || cause.message !== RC2_COMMAND_ARITY) throw cause
    const result = await commands.execute(sessionId, line, [])
    commandApiModes.set(commands, 'images')
    return result
  }
}

function healthTone(status: FeishuHealthStatus): ControlTone {
  if (status === 'ready') return 'healthy'
  if (status === 'busy') return 'working'
  if (status === 'attention') return 'attention'
  if (status === 'degraded') return 'danger'
  return 'neutral'
}

function transportTone(state: FeishuHealthSnapshot['transport']['state']): ControlTone {
  if (state === 'ready') return 'healthy'
  if (state === 'connecting') return 'working'
  if (state === 'degraded') return 'danger'
  return 'neutral'
}

function contentTone(status: FeishuHealthSnapshot['content']['status']): ControlTone {
  if (status === 'ready') return 'healthy'
  if (status === 'disabled') return 'neutral'
  return 'attention'
}

function platformAccessTone(status: NonNullable<FeishuHealthSnapshot['platformAccess']>['status']): ControlTone {
  if (status === 'verified') return 'healthy'
  if (status === 'attention') return 'danger'
  return 'attention'
}

function deliveryTone(status: NonNullable<FeishuHealthSnapshot['deliveries']['last']>['status']): ControlTone {
  if (status === 'delivered') return 'healthy'
  if (status === 'failed' || status === 'uncertain') return 'danger'
  return 'working'
}

function transportLabel(t: (key: string) => string, state: string): string {
  return t(`transport.state.${state}`)
}
