import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import type { ControlSurfaceProps, ControlTone } from 'dsh-control-center/client'
import type { RemoteResult, TelegramCommandsClient } from './types.ts'

export interface TelegramDelivery {
  readonly status: 'delivered' | 'prepared' | 'sending' | 'retrying' | 'uncertain' | 'failed'
  readonly updatedAt: number
  readonly attempts: number
}

export interface TelegramHealthSnapshot {
  readonly status: 'ready' | 'connecting' | 'degraded' | 'stopping' | 'unavailable'
  readonly transportKind?: string
  readonly lifecycle?: string
  readonly routeId?: string
  readonly sessionId?: string
  readonly delivered: number
  readonly pending: number
  readonly uncertain: number
  readonly failed: number
  readonly last?: TelegramDelivery
}

export type TelegramSurfaceProps = ControlSurfaceProps & {
  readonly commands: TelegramCommandsClient
  readonly t: (key: string) => string
}

/** Small Adapter projection; Gateway remains the delivery and pairing authority. */
export function TelegramSurface({ commands, t, sessionId, ui: UI }: TelegramSurfaceProps) {
  const requestRef = useRef(0)
  const [available, setAvailable] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [snapshot, setSnapshot] = useState<TelegramHealthSnapshot>()
  const [observedAt, setObservedAt] = useState<number>()

  const refresh = async () => {
    const request = ++requestRef.current
    setBusy(true)
    setError(undefined)
    try {
      const response = await executeCommand(commands, sessionId, '/telegram')
      if (!response.ok || response.value === undefined) throw new Error(t('error.unavailable'))
      const result = response.value.result
      if (result.kind === 'error') throw new Error(t('error.unavailable'))
      const parsed = parseTelegramHealth(result.text ?? '')
      if (request !== requestRef.current) return
      setSnapshot(parsed)
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
    setSnapshot(undefined)
    setObservedAt(undefined)
    setError(undefined)
    void commands.list(sessionId).then((result) => {
      if (!current || requestRef.current !== generation) return
      if (!result.ok) {
        setAvailable(true)
        setError(t('error.unavailable'))
        return
      }
      const next = result.value.some(command => command.name === 'telegram')
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

  const anomalies = snapshot === undefined ? 0 : snapshot.uncertain + snapshot.failed
  const tone = snapshot === undefined ? undefined : statusTone(snapshot.status)
  return <UI.Surface ariaLabel={t('surface.title')}>
    <UI.Header
      eyebrow={t('surface.eyebrow')}
      title={t('surface.title')}
      description={t('surface.description')}
      status={tone === undefined ? undefined : <UI.Status tone={tone}>{t(`status.${snapshot!.status}`)}</UI.Status>}
      actions={<UI.Button type="button" disabled={busy || available !== true} onClick={() => { void refresh() }}>
        {busy ? t('status.refreshing') : t('status.refresh')}
      </UI.Button>}
    />
    {available === false && <UI.Notice tone="attention" title={t('surface.unavailableTitle')}>{t('surface.unavailable')}</UI.Notice>}
    {available === true && error !== undefined && <UI.Notice tone="danger" role="alert" title={t('error.title')}>{error}</UI.Notice>}
    {available === undefined && <UI.Loading cards={3} />}
    {available === true && snapshot === undefined && error === undefined && <UI.Loading cards={3} />}
    {snapshot !== undefined && <>
      <UI.Metrics items={[
        { label: t('metric.delivered'), value: snapshot.delivered, hint: t('metric.deliveryHint'), tone: 'healthy' },
        { label: t('metric.pending'), value: snapshot.pending, hint: t('status.connecting'), tone: snapshot.pending > 0 ? 'working' : 'neutral' },
        { label: t('metric.uncertain'), value: snapshot.uncertain, hint: anomalies > 0 ? t('status.degraded') : t('metric.deliveryHint'), tone: snapshot.uncertain > 0 ? 'attention' : 'healthy' },
        { label: t('metric.failed'), value: snapshot.failed, hint: snapshot.failed === 0 ? t('metric.deliveryHint') : t('status.degraded'), tone: snapshot.failed > 0 ? 'danger' : 'healthy' },
      ]} />
      <UI.Section title={t('section.connection')} description={t('section.connectionDescription')}>
        <UI.Entity
          icon="T"
          title={t('entity.transport')}
          description={t('entity.transportDescription')}
          status={<UI.Status tone={statusTone(snapshot.status)}>{t(`status.${snapshot.status}`)}</UI.Status>}
          details={<details><summary>{t('technical.details')}</summary><div><code>{snapshot.transportKind ?? '—'}</code></div><div><code>{snapshot.lifecycle ?? '—'}</code></div></details>}
        />
        <UI.Entity
          icon="#"
          title={t('entity.route')}
          description={t('entity.routeDescription')}
          status={<UI.Status tone={snapshot.status === 'ready' ? 'healthy' : 'neutral'}>{snapshot.status === 'ready' ? t('status.ready') : t(`status.${snapshot.status}`)}</UI.Status>}
          details={<details><summary>{t('technical.details')}</summary><div><code>{snapshot.routeId ?? '—'}</code></div><div>{t('entity.session')}: <code>{snapshot.sessionId ?? '—'}</code></div></details>}
        />
      </UI.Section>
      <UI.Section title={t('section.delivery')} description={t('section.deliveryDescription')}>
        {snapshot.last === undefined
          ? <UI.Empty title={t('delivery.emptyTitle')} description={t('delivery.empty')} />
          : <UI.Entity
            icon="↗"
            title={t('delivery.last')}
            description={`${new Date(snapshot.last.updatedAt).toLocaleString()} · ${snapshot.last.attempts} ${t('delivery.attempts')}`}
            status={<UI.Status tone={deliveryTone(snapshot.last.status)}>{t(`delivery.status.${snapshot.last.status}`)}</UI.Status>}
          />}
      </UI.Section>
      <UI.Notice tone={anomalies > 0 ? 'attention' : 'neutral'}>
        {t('foot.noModel')} · {t('technical.observed')} {observedAt === undefined ? '—' : new Date(observedAt).toLocaleString()}
      </UI.Notice>
    </>}
  </UI.Surface>
}

export function parseTelegramHealth(text: string): TelegramHealthSnapshot {
  const route = /^Telegram route:\s+([^\s(]+).*?Gateway\s+([^,]+),\s+session\s+([^,]+),/u.exec(text)
  const transport = /^Transport:\s+([^;]+);\s+lifecycle\s+([^\.]+)\./mu.exec(text)
  const delivery = /^Retained delivery:\s+(\d+) delivered;\s+(\d+) pending;\s+(\d+) uncertain;\s+(\d+) failed\./mu.exec(text)
  const status = normalizeStatus(route?.[1] ?? transport?.[2] ?? 'unavailable')
  return {
    status,
    ...(transport?.[1] === undefined ? {} : { transportKind: transport[1].trim() }),
    ...(transport?.[2] === undefined ? {} : { lifecycle: transport[2].trim() }),
    ...(route?.[2] === undefined ? {} : { routeId: route[2].trim() }),
    ...(route?.[3] === undefined ? {} : { sessionId: route[3].trim() }),
    delivered: Number(delivery?.[1] ?? 0),
    pending: Number(delivery?.[2] ?? 0),
    uncertain: Number(delivery?.[3] ?? 0),
    failed: Number(delivery?.[4] ?? 0),
  }
}

function normalizeStatus(value: string): TelegramHealthSnapshot['status'] {
  if (value.toLowerCase() === 'ready') return 'ready'
  if (value.toLowerCase() === 'connecting') return 'connecting'
  if (value.toLowerCase() === 'degraded') return 'degraded'
  if (value.toLowerCase() === 'stopping') return 'stopping'
  return 'unavailable'
}

function statusTone(status: TelegramHealthSnapshot['status']): ControlTone {
  if (status === 'ready') return 'healthy'
  if (status === 'connecting') return 'working'
  if (status === 'degraded') return 'danger'
  if (status === 'stopping') return 'neutral'
  return 'attention'
}

function deliveryTone(status: TelegramDelivery['status']): ControlTone {
  if (status === 'delivered') return 'healthy'
  if (status === 'failed') return 'danger'
  if (status === 'uncertain') return 'attention'
  return 'working'
}

function presentError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message === fallback ? cause.message : fallback
}

const commandApiModes = new WeakMap<TelegramCommandsClient, 'legacy' | 'images'>()
const RC2_COMMAND_ARITY = 'client api: commands/execute expected 3 business argument(s) plus an optional AbortSignal, got 2'

async function executeCommand(
  commands: TelegramCommandsClient,
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
