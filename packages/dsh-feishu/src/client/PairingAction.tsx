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

export interface PairingCommandsClient {
  list(sessionId: SessionId): Promise<RemoteResult<readonly CommandDescriptor[]>>
  execute(sessionId: SessionId, line: string): Promise<RemoteResult<CommandExecution | undefined>>
}

export type PairingActionProps = PropsRuntime<'sidebar.footer.action'> & {
  readonly commands: PairingCommandsClient
  readonly t: (key: string) => string
}

const PHRASE = /EVOFORGE PAIR [A-Z2-9]{16}/u
const YAML = /```yaml\n([\s\S]*?)\n```/u

/** Native DSH Web setup surface over the existing human Command authority. */
export function PairingAction({ commands, t, useSessions, wide }: PairingActionProps) {
  const sessionId = useSessions(state => state.current)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [surface, setSurface] = useState<'pairing' | 'health'>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [expiresAt, setExpiresAt] = useState<number>()
  const [now, setNow] = useState(Date.now())
  const [health, setHealth] = useState<FeishuHealthSnapshot>()

  useEffect(() => {
    let current = true
    setSurface(undefined)
    setOpen(false)
    setBusy(false)
    setText(undefined)
    setError(undefined)
    setNotice(undefined)
    setExpiresAt(undefined)
    setHealth(undefined)
    if (sessionId === undefined) return () => { current = false }
    void commands.list(sessionId).then((result) => {
      if (current && sessionRef.current === sessionId) {
        if (!result.ok) setSurface(undefined)
        else if (result.value.some(command => command.name === 'feishu')) setSurface('health')
        else if (result.value.some(command => command.name === 'feishu-pair')) setSurface('pairing')
        else setSurface(undefined)
      }
    }, () => {
      if (current && sessionRef.current === sessionId) setSurface(undefined)
    })
    return () => { current = false }
  }, [commands, sessionId])

  useEffect(() => {
    if (!open || expiresAt === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [expiresAt, open])

  if (surface === undefined || sessionId === undefined) return null

  const run = async (action: 'start' | 'status' | 'cancel') => {
    const target = sessionId
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const response = await commands.execute(target, `/feishu-pair ${action}`)
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      if (response.value === undefined) throw new Error('feishu-pair command is unavailable')
      if (sessionRef.current !== target) return
      const result = response.value.result
      if (result.kind === 'error') throw new Error(result.text)
      const next = result.text ?? ''
      setText(next)
      if (action === 'start' && PHRASE.test(next)) setExpiresAt(Date.now() + 120_000)
      if (action === 'cancel' || YAML.test(next)) setExpiresAt(undefined)
    } catch (cause) {
      if (sessionRef.current === target) setError(message(cause))
    } finally {
      if (sessionRef.current === target) setBusy(false)
    }
  }

  const refreshHealth = async () => {
    const target = sessionId
    setBusy(true)
    setError(undefined)
    try {
      const response = await commands.execute(target, '/feishu')
      if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
      if (response.value === undefined) throw new Error('feishu command is unavailable')
      if (sessionRef.current !== target) return
      const result = response.value.result
      if (result.kind === 'error') throw new Error(result.text)
      setHealth(parseFeishuHealthCommand(result.text ?? ''))
    } catch (cause) {
      if (sessionRef.current === target) {
        setHealth(undefined)
        setError(message(cause))
      }
    } finally {
      if (sessionRef.current === target) setBusy(false)
    }
  }

  const phrase = text?.match(PHRASE)?.[0]
  const config = text?.match(YAML)?.[1]
  const remaining = expiresAt === undefined ? undefined : Math.max(0, Math.ceil((expiresAt - now) / 1_000))
  const copy = async (value: string) => {
    try {
      await copyText(value)
      setError(undefined)
      setNotice(t('status.copied'))
    } catch (cause) {
      setError(message(cause))
    }
  }
  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && surface === 'health') void refreshHealth()
  }
  const title = surface === 'health' ? t('health.title') : t('panel.title')

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="dsh-feishu-trigger"
      aria-label={surface === 'health' ? t('health.trigger') : t('trigger.label')}
      aria-expanded={open}
      onClick={toggle}
    >
      <span aria-hidden="true">{surface === 'health' ? '◉' : '⇄'}</span>
      {wide && <span>{surface === 'health' ? t('health.trigger') : t('trigger.label')}</span>}
    </button>
    {open && <section className="dsh-feishu-panel" role="dialog" aria-label={title}>
      <header className="dsh-feishu-head">
        <h2 className="dsh-feishu-title">{title}</h2>
        <button type="button" className="dsh-feishu-close" aria-label={t('panel.close')} onClick={close}>×</button>
      </header>
      {surface === 'health'
        ? <div className="dsh-feishu-body">
          <div className="dsh-feishu-health-head">
            <div>
              <h3>{t('health.hostTitle')}</h3>
              <p>{t('health.readOnly')}</p>
            </div>
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
            {health.deliveries.last !== undefined && <div className="dsh-feishu-message">
              {t('health.lastDelivery')} <code>{health.deliveries.last.status}</code> · {health.deliveries.last.attempts} {t('health.attempts')}
            </div>}
            <p className="dsh-feishu-health-foot">
              {t('health.observed')} {new Date(health.observedAt).toLocaleString()} · {t('health.noModel')}
            </p>
          </>}
          <div className="dsh-feishu-actions">
            <button type="button" className="dsh-feishu-button dsh-feishu-primary" disabled={busy} onClick={() => { void refreshHealth() }}>
              {busy ? t('health.refreshing') : t('health.refresh')}
            </button>
          </div>
        </div>
        :
      <div className="dsh-feishu-body">
        <div className="dsh-feishu-intro">
          <h3>{t('intro.title')}</h3>
          <p>{t('intro.body')}</p>
        </div>
        <div className="dsh-feishu-steps">
          <span>{t('step.one')}</span><span>{t('step.two')}</span><span>{t('step.three')}</span>
        </div>
        {notice !== undefined && <div className="dsh-feishu-message" role="status">{notice}</div>}
        {error !== undefined && <div className="dsh-feishu-message dsh-feishu-error" role="alert">{t('error.prefix')}{error}</div>}
        {phrase !== undefined && <div className="dsh-feishu-phrase">
          <span className="dsh-feishu-label">{t('phrase.label')}</span>
          <code className="dsh-feishu-code">{phrase}</code>
          {remaining !== undefined && remaining > 0
            ? <span className="dsh-feishu-countdown">{t('countdown.label')} {remaining} {t('countdown.unit')}</span>
            : expiresAt !== undefined && <span className="dsh-feishu-error">{t('status.expired')}</span>}
          <button type="button" className="dsh-feishu-button" onClick={() => { void copy(phrase) }}>{t('action.copyPhrase')}</button>
        </div>}
        {config !== undefined && <div className="dsh-feishu-config">
          <h3>{t('config.title')}</h3><p>{t('config.body')}</p>
          <pre>{config}</pre>
          <button type="button" className="dsh-feishu-button" onClick={() => { void copy(config) }}>{t('action.copyConfig')}</button>
        </div>}
        {text !== undefined && phrase === undefined && config === undefined && <div className="dsh-feishu-message">
          <strong>{t('result.title')}</strong><br />{text}
        </div>}
        <div className="dsh-feishu-actions">
          <button type="button" className="dsh-feishu-button dsh-feishu-primary" disabled={busy} onClick={() => { void run('start') }}>
            {busy ? t('status.running') : t('action.start')}
          </button>
          <button type="button" className="dsh-feishu-button" disabled={busy || phrase === undefined} onClick={() => { void run('status') }}>
            {t('action.check')}
          </button>
          <button type="button" className="dsh-feishu-button" disabled={busy} onClick={() => { void run('cancel') }}>
            {t('action.cancel')}
          </button>
        </div>
      </div>}
    </section>}
  </>
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Sandboxed Web shells can expose Clipboard API while denying the call.
    }
  }
  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('browser copy is unavailable; select the text and copy it manually')
}
