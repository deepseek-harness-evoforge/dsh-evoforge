import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { ControlSurfaceProps, ControlTone } from 'dsh-control-center/client'
import type { DoctorCommandsClient, RemoteResult } from './types.ts'

export interface DoctorCheck {
  readonly id: string
  readonly status: 'passed' | 'failed' | 'unknown'
  readonly summary: string
  readonly action?: string
}

export interface DoctorReport {
  readonly status: 'ready' | 'not-ready' | 'unknown'
  readonly checks: readonly DoctorCheck[]
}

export type DoctorSurfaceProps = ControlSurfaceProps & {
  readonly commands: DoctorCommandsClient
  readonly t: (key: string) => string
}

/** Read-only Adapter for the existing dsh-doctor human Command. */
export function DoctorSurface({ commands, t, sessionId, ui: UI }: DoctorSurfaceProps) {
  const requestRef = useRef(0)
  const [available, setAvailable] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [report, setReport] = useState<DoctorReport>()
  const [observedAt, setObservedAt] = useState<number>()

  const refresh = async () => {
    const request = ++requestRef.current
    setBusy(true)
    setError(undefined)
    try {
      const response = await executeCommand(commands, sessionId, '/doctor')
      if (!response.ok || response.value === undefined) throw new Error(t('error.unavailable'))
      const result = response.value.result
      if (result.kind === 'error') throw new Error(t('error.unavailable'))
      const parsed = parseDoctorReport(result.text ?? '')
      if (request !== requestRef.current) return
      setReport(parsed)
      setObservedAt(Date.now())
    } catch (cause) {
      if (request === requestRef.current) setError(presentError(cause, t('error.unavailable')))
    } finally {
      if (request === requestRef.current) setBusy(false)
    }
  }

  useEffect(() => {
    let current = true
    const generation = ++requestRef.current
    setAvailable(undefined)
    setReport(undefined)
    setObservedAt(undefined)
    setError(undefined)
    void commands.list(sessionId).then((result) => {
      if (!current || requestRef.current !== generation) return
      if (!result.ok) {
        setAvailable(true)
        setError(t('error.unavailable'))
        return
      }
      const next = result.value.some(command => command.name === 'doctor')
      setAvailable(next)
      if (next) void refresh()
    }, (cause: unknown) => {
      if (current && requestRef.current === generation) {
        setAvailable(true)
        setError(presentError(cause, t('error.unavailable')))
      }
    })
    return () => { current = false; requestRef.current += 1 }
  }, [commands, sessionId])

  const failed = report?.checks.filter(check => check.status === 'failed').length ?? 0
  const unknown = report?.checks.filter(check => check.status === 'unknown').length ?? 0
  const tone = report === undefined ? undefined : reportTone(report.status)

  return <UI.Surface ariaLabel={t('surface.title')}>
    <UI.Header
      eyebrow={t('surface.eyebrow')}
      title={t('surface.title')}
      description={t('surface.description')}
      status={tone === undefined ? undefined : <UI.Status tone={tone}>{t(`status.${report!.status}`)}</UI.Status>}
      actions={<UI.Button type="button" disabled={busy || available !== true} onClick={() => { void refresh() }}>
        {busy ? t('status.refreshing') : t('status.refresh')}
      </UI.Button>}
    />
    {available === false && <UI.Notice tone="attention" title={t('surface.unavailableTitle')}>{t('surface.unavailable')}</UI.Notice>}
    {available === true && error !== undefined && <UI.Notice tone="danger" role="alert" title={t('error.title')}>{error}</UI.Notice>}
    {available === undefined && <UI.Loading cards={3} />}
    {available === true && report === undefined && error === undefined && <UI.Loading cards={3} />}
    {report !== undefined && <>
      <UI.Metrics items={[
        { label: t('metric.checks'), value: report.checks.length, hint: `${report.checks.filter(check => check.status === 'passed').length} ${t('metric.passed')}`, tone: 'neutral' },
        { label: t('metric.failures'), value: failed, hint: failed === 0 ? t('metric.passed') : t('check.failed'), tone: failed > 0 ? 'danger' : 'healthy' },
        { label: t('metric.unknown'), value: unknown, hint: unknown === 0 ? t('metric.passed') : t('status.unknown'), tone: unknown > 0 ? 'attention' : 'healthy' },
      ]} />
      <UI.Section title={t('section.checks')} description={t('section.checksDescription')}>
        {report.checks.length === 0
          ? <UI.Empty title={t('surface.unavailableTitle')} description={t('surface.unavailable')} />
          : report.checks.map(check => <UI.Entity
            key={check.id}
            icon={check.status === 'passed' ? '✓' : check.status === 'failed' ? '!' : '?'}
            title={check.id}
            description={check.summary}
            status={<UI.Status tone={checkTone(check.status)}>{t(`check.${check.status}`)}</UI.Status>}
            details={check.action === undefined ? undefined : <details><summary>{t('technical.action')}</summary><span>{check.action}</span></details>}
          />)}
      </UI.Section>
      <UI.Notice tone={failed > 0 ? 'attention' : 'neutral'}>
        {t('foot.noModel')} · {t('technical.observed')} {observedAt === undefined ? '—' : new Date(observedAt).toLocaleString()}
      </UI.Notice>
    </>}
  </UI.Surface>
}

export function parseDoctorReport(text: string): DoctorReport {
  const lines = text.split(/\r?\n/u)
  const statusLine = lines[0]?.trim() ?? ''
  const status = statusLine.endsWith('NOT READY') ? 'not-ready'
    : statusLine.endsWith('UNKNOWN') ? 'unknown' : 'ready'
  const checks: DoctorCheck[] = []
  let current: DoctorCheck | undefined
  for (const line of lines.slice(1)) {
    const match = /^(✓|✗|\?)\s+([^:]+):\s*(.*)$/u.exec(line.trim())
    if (match !== null) {
      const mark = match[1] ?? '?'
      const id = match[2] ?? 'unknown'
      const summary = match[3] ?? ''
      const check: DoctorCheck = { id, status: mark === '✓' ? 'passed' : mark === '✗' ? 'failed' : 'unknown', summary }
      current = check
      checks.push(check)
      continue
    }
    const action = /^Next:\s*(.*)$/u.exec(line.trim())
    if (action !== null && current !== undefined && action[1] !== undefined) {
      const next: DoctorCheck = { ...current, action: action[1] }
      checks[checks.length - 1] = next
      current = next
    }
  }
  return { status, checks }
}

function reportTone(status: DoctorReport['status']): ControlTone {
  if (status === 'ready') return 'healthy'
  if (status === 'not-ready') return 'danger'
  return 'attention'
}

function checkTone(status: DoctorCheck['status']): ControlTone {
  if (status === 'passed') return 'healthy'
  if (status === 'failed') return 'danger'
  return 'attention'
}

function presentError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message === fallback ? cause.message : fallback
}

const commandApiModes = new WeakMap<DoctorCommandsClient, 'legacy' | 'images'>()
const RC2_COMMAND_ARITY = 'client api: commands/execute expected 3 business argument(s) plus an optional AbortSignal, got 2'

async function executeCommand(
  commands: DoctorCommandsClient,
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
