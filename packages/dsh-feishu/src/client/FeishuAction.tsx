import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { parseFeishuHealthCommand, type FeishuHealthSnapshot } from '../health.js'

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export interface FeishuCommandsClient {
  list(sessionId: SessionId): Promise<RemoteResult<readonly CommandDescriptor[]>>
  execute(sessionId: SessionId, line: string, images?: readonly never[]): Promise<RemoteResult<CommandExecution | undefined>>
}

export type FeishuActionProps = PropsRuntime<'sidebar.footer.action'> & {
  readonly commands: FeishuCommandsClient
  readonly t: (key: string) => string
}

const RC2_COMMAND_ARITY = 'client api: commands/execute expected 3 business argument(s) plus an optional AbortSignal, got 2'
const commandApiModes = new WeakMap<FeishuCommandsClient, 'legacy' | 'images'>()

/** Read-only Feishu projection; pairing is owned by the global Gateway control surface. */
export function FeishuAction({ commands, t, useSessions, wide }: FeishuActionProps) {
  const sessionId = useSessions(state => state.current)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [available, setAvailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [health, setHealth] = useState<FeishuHealthSnapshot>()

  useEffect(() => {
    let current = true
    setAvailable(false)
    setOpen(false)
    setBusy(false)
    setError(undefined)
    setHealth(undefined)
    if (sessionId === undefined) return () => { current = false }
    void commands.list(sessionId).then((result) => {
      if (current && sessionRef.current === sessionId) {
        setAvailable(result.ok && result.value.some(command => command.name === 'feishu'))
      }
    }, () => {
      if (current && sessionRef.current === sessionId) setAvailable(false)
    })
    return () => { current = false }
  }, [commands, sessionId])

  if (!available || sessionId === undefined) return null

  const refresh = async () => {
    const target = sessionId
    setBusy(true)
    setError(undefined)
    try {
      const response = await executeCommand(commands, target, '/feishu')
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      if (response.value === undefined) throw new Error('feishu command is unavailable')
      if (sessionRef.current !== target) return
      const result = response.value.result
      if (result.kind === 'error') throw new Error(result.text)
      setHealth(parseFeishuHealthCommand(result.text ?? ''))
    } catch (cause) {
      if (sessionRef.current === target) {
        setHealth(undefined)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (sessionRef.current === target) setBusy(false)
    }
  }
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void refresh()
  }
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="dsh-feishu-trigger"
      aria-label={t('health.trigger')}
      aria-expanded={open}
      onClick={toggle}
    >
      <span aria-hidden="true">◉</span>
      {wide && <span>{t('health.trigger')}</span>}
    </button>
    {open && <section className="dsh-feishu-panel" role="dialog" aria-label={t('health.title')}>
      <header className="dsh-feishu-head">
        <h2 className="dsh-feishu-title">{t('health.title')}</h2>
        <button type="button" className="dsh-feishu-close" aria-label={t('panel.close')} onClick={close}>×</button>
      </header>
      <div className="dsh-feishu-body">
        <div className="dsh-feishu-health-head">
          <div><h3>{t('health.hostTitle')}</h3><p>{t('health.readOnly')}</p></div>
          {health !== undefined && <span className={`dsh-feishu-health-status is-${health.status}`}>
            {t(`health.status.${health.status}`)}
          </span>}
        </div>
        {error !== undefined && <div className="dsh-feishu-message dsh-feishu-error" role="alert">{t('error.prefix')}{error}</div>}
        {health === undefined && error === undefined && <div className="dsh-feishu-message" role="status">{t('health.loading')}</div>}
        {health !== undefined && <>
          <dl className="dsh-feishu-health-grid">
            <div><dt>{t('health.account')}</dt><dd>{health.accountId}</dd></div>
            <div><dt>{t('health.transport')}</dt><dd>{health.transport.kind}</dd></div>
            <div><dt>{t('health.lifecycle')}</dt><dd>{health.transport.state}</dd></div>
            <div><dt>{t('health.routes')}</dt><dd>{health.routeCount}</dd></div>
            <div><dt>{t('health.deliveries')}</dt><dd>{health.deliveries.total}</dd></div>
            <div><dt>{t('health.retrying')}</dt><dd>{health.deliveries.retrying}</dd></div>
            <div><dt>{t('health.uncertain')}</dt><dd>{health.deliveries.uncertain}</dd></div>
            <div><dt>{t('health.failed')}</dt><dd>{health.deliveries.failed}</dd></div>
            <div><dt>{t('health.approvals')}</dt><dd>{health.pendingApprovals}</dd></div>
          </dl>
          <div className="dsh-feishu-health-routes">
            <h3>{t('health.routeTitle')}</h3>
            {health.routes.map(route => <div key={route.id} className="dsh-feishu-health-route">
              <code>{route.id}</code><span>{route.threadScoped ? t('health.thread') : t('health.chat')}</span>
            </div>)}
            {health.routesTruncated && <p className="dsh-feishu-health-foot">{t('health.routesTruncated')}</p>}
          </div>
          <div className="dsh-feishu-content">
            <div className="dsh-feishu-content-head">
              <h3>{t('health.contentTitle')}</h3>
              <span className={`dsh-feishu-content-status is-${health.content.status}`}>
                {t(`health.content.status.${health.content.status}`)}
              </span>
            </div>
            <div className="dsh-feishu-content-permissions">
              {health.content.permissions.map(permission => <div key={permission.name}>
                <span>{t(`health.content.permission.${permission.name}`)}</span>
                <strong className={permission.enabled ? 'is-enabled' : 'is-disabled'}>
                  {t(permission.enabled ? 'health.content.enabled' : 'health.content.disabled')}
                </strong>
              </div>)}
            </div>
            <dl className="dsh-feishu-content-facts">
              <div><dt>{t('health.content.tool')}</dt><dd>{t(health.content.toolAvailable ? 'health.content.available' : 'health.content.unavailable')}</dd></div>
              <div><dt>{t('health.content.approval')}</dt><dd>{t(health.content.approvalAvailable ? 'health.content.available' : 'health.content.unavailable')}</dd></div>
              <div><dt>{t('health.content.charLimit')}</dt><dd>{health.content.maxContentChars}</dd></div>
              <div><dt>{t('health.content.recordLimit')}</dt><dd>{health.content.maxBitableRecords}</dd></div>
            </dl>
            <p className="dsh-feishu-health-foot">{t('health.content.platformUnverified')}</p>
          </div>
          {health.deliveries.last !== undefined && <div className="dsh-feishu-message">
            {t('health.lastDelivery')} <code>{health.deliveries.last.status}</code> · {health.deliveries.last.attempts} {t('health.attempts')}
          </div>}
          <p className="dsh-feishu-health-foot">
            {t('health.observed')} {new Date(health.observedAt).toLocaleString()} · {t('health.noModel')}
          </p>
        </>}
        <div className="dsh-feishu-actions">
          <button type="button" className="dsh-feishu-button dsh-feishu-primary" disabled={busy} onClick={() => { void refresh() }}>
            {busy ? t('health.refreshing') : t('health.refresh')}
          </button>
        </div>
      </div>
    </section>}
  </>
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
