import type { FeishuDeliveryRecord } from './delivery-store.js'

export const FEISHU_HEALTH_PREFIX = 'EVOFORGE_FEISHU_HEALTH_V1 '

export type FeishuTransportState = 'connecting' | 'ready' | 'degraded' | 'stopping'
export type FeishuHealthStatus = 'ready' | 'busy' | 'attention' | 'degraded' | 'stopping'

export interface FeishuHealthRoute {
  readonly id: string
  readonly threadScoped: boolean
}

export interface FeishuHealthRouteInput extends FeishuHealthRoute {
  readonly workspaceId: string
  readonly sessionId: string
}

export interface FeishuHealthSnapshot {
  readonly schemaVersion: 1
  readonly observedAt: number
  readonly accountId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly status: FeishuHealthStatus
  readonly transport: {
    readonly kind: 'official-feishu-websocket'
    readonly state: FeishuTransportState
    readonly connectedAt?: number
    readonly lastActivityAt?: number
    readonly lastErrorAt?: number
  }
  readonly routeCount: number
  readonly routesTruncated: boolean
  readonly routes: readonly FeishuHealthRoute[]
  readonly deliveries: {
    readonly total: number
    readonly prepared: number
    readonly sending: number
    readonly retrying: number
    readonly delivered: number
    readonly uncertain: number
    readonly failed: number
    readonly scheduled: number
    readonly last?: {
      readonly id: string
      readonly routeId: string
      readonly source: FeishuDeliveryRecord['source']['kind']
      readonly status: FeishuDeliveryRecord['status']
      readonly attempts: number
      readonly updatedAt: number
    }
  }
  readonly pendingApprovals: number
  readonly modelCalls: 0
  readonly authority: 'native-dsh-command'
}

export interface SummarizeFeishuHealthInput {
  readonly now: number
  readonly accountId: string
  readonly transport: {
    readonly state: FeishuTransportState
    readonly connectedAt?: number
    readonly lastActivityAt?: number
    readonly lastErrorAt?: number
  }
  readonly routes: readonly FeishuHealthRouteInput[]
  readonly records: readonly FeishuDeliveryRecord[]
  readonly scheduled: number
  readonly pendingApprovals: number
}

/** Build a redacted, Session-scoped view from the durable Host authorities. */
export function summarizeFeishuHealth(input: SummarizeFeishuHealthInput): FeishuHealthSnapshot {
  if (input.routes.length === 0) throw new Error('Feishu health requires at least one exact route')
  const workspaceId = input.routes[0]!.workspaceId
  const sessionId = input.routes[0]!.sessionId
  if (input.routes.some(route => route.workspaceId !== workspaceId || route.sessionId !== sessionId)) {
    throw new Error('Feishu health routes must belong to one native Workspace and Session')
  }
  const routeIds = new Set(input.routes.map(route => route.id))
  const records = input.records.filter(record => routeIds.has(record.routeId))
  const counts = {
    prepared: 0,
    sending: 0,
    retrying: 0,
    delivered: 0,
    uncertain: 0,
    failed: 0,
  }
  for (const record of records) counts[record.status] += 1
  const latest = records.reduce<FeishuDeliveryRecord | undefined>((current, record) =>
    current === undefined
      || record.updatedAt > current.updatedAt
      || (record.updatedAt === current.updatedAt && record.id.localeCompare(current.id) > 0)
      ? record
      : current, undefined)
  const active = counts.prepared + counts.sending + counts.retrying
  const visibleRoutes = [...input.routes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 20)
    .map(route => Object.freeze({ id: route.id, threadScoped: route.threadScoped }))
  const status: FeishuHealthStatus = input.transport.state === 'stopping'
    ? 'stopping'
    : input.transport.state === 'degraded'
      ? 'degraded'
      : input.transport.state === 'connecting'
        ? 'busy'
        : counts.uncertain + counts.failed > 0
          ? 'attention'
          : active > 0 || input.scheduled > 0 || input.pendingApprovals > 0
            ? 'busy'
            : 'ready'
  return Object.freeze({
    schemaVersion: 1,
    observedAt: input.now,
    accountId: input.accountId,
    workspaceId,
    sessionId,
    status,
    transport: Object.freeze({
      kind: 'official-feishu-websocket',
      state: input.transport.state,
      ...(input.transport.connectedAt === undefined ? {} : { connectedAt: input.transport.connectedAt }),
      ...(input.transport.lastActivityAt === undefined ? {} : { lastActivityAt: input.transport.lastActivityAt }),
      ...(input.transport.lastErrorAt === undefined ? {} : { lastErrorAt: input.transport.lastErrorAt }),
    }),
    routeCount: input.routes.length,
    routesTruncated: input.routes.length > visibleRoutes.length,
    routes: Object.freeze(visibleRoutes),
    deliveries: Object.freeze({
      total: records.length,
      ...counts,
      scheduled: input.scheduled,
      ...(latest === undefined ? {} : {
        last: Object.freeze({
          id: latest.id,
          routeId: latest.routeId,
          source: latest.source.kind,
          status: latest.status,
          attempts: latest.attempts,
          updatedAt: latest.updatedAt,
        }),
      }),
    }),
    pendingApprovals: input.pendingApprovals,
    modelCalls: 0,
    authority: 'native-dsh-command',
  })
}

/** Human-readable command output plus one machine-readable line for native DSH Web. */
export function renderFeishuHealthCommand(snapshot: FeishuHealthSnapshot): string {
  return [
    `Feishu: ${snapshot.status.toUpperCase()} (${snapshot.routes.map(route => route.id).join(', ')}${snapshot.routesTruncated ? ', …' : ''}).`,
    `Transport: ${snapshot.transport.kind}; lifecycle ${snapshot.transport.state}.`,
    `Deliveries: ${snapshot.deliveries.total} total; ${snapshot.deliveries.retrying} retrying; ${snapshot.deliveries.uncertain} uncertain; ${snapshot.deliveries.failed} failed.`,
    `Approvals: ${snapshot.pendingApprovals} pending. Model surface: ${snapshot.modelCalls} calls.`,
    `${FEISHU_HEALTH_PREFIX}${JSON.stringify(snapshot)}`,
  ].join('\n')
}

/** Parse only the bounded v1 projection; arbitrary Command text is never trusted as state. */
export function parseFeishuHealthCommand(text: string): FeishuHealthSnapshot {
  const line = text.split('\n').find(value => value.startsWith(FEISHU_HEALTH_PREFIX))
  if (line === undefined || line.length > 100_000) throw new Error('invalid health payload')
  let value: unknown
  try {
    value = JSON.parse(line.slice(FEISHU_HEALTH_PREFIX.length))
  } catch {
    throw new Error('invalid health payload')
  }
  if (!isHealth(value)) throw new Error('invalid health payload')
  return value
}

function isHealth(value: unknown): value is FeishuHealthSnapshot {
  if (!record(value) || value.schemaVersion !== 1 || !integer(value.observedAt) || !text(value.accountId)
    || !text(value.workspaceId) || !text(value.sessionId) || !integer(value.routeCount)
    || typeof value.routesTruncated !== 'boolean'
    || !oneOf(value.status, ['ready', 'busy', 'attention', 'degraded', 'stopping'])
    || value.modelCalls !== 0 || value.authority !== 'native-dsh-command'
    || !record(value.transport) || value.transport.kind !== 'official-feishu-websocket'
    || !oneOf(value.transport.state, ['connecting', 'ready', 'degraded', 'stopping'])
    || !optionalInteger(value.transport.connectedAt) || !optionalInteger(value.transport.lastActivityAt)
    || !optionalInteger(value.transport.lastErrorAt) || !Array.isArray(value.routes)
    || value.routes.length > 20 || !value.routes.every(route)
    || !record(value.deliveries) || !deliveries(value.deliveries)
    || !integer(value.pendingApprovals)) return false
  const routeIds = value.routes.map(item => item.id)
  if (new Set(routeIds).size !== routeIds.length || value.routeCount < value.routes.length
    || value.routesTruncated !== (value.routeCount > value.routes.length)) return false
  return true
}

function route(value: unknown): value is FeishuHealthRoute {
  return record(value) && text(value.id) && typeof value.threadScoped === 'boolean'
}

function deliveries(value: Record<string, unknown>): boolean {
  const numeric = ['total', 'prepared', 'sending', 'retrying', 'delivered', 'uncertain', 'failed', 'scheduled']
  if (!numeric.every(key => integer(value[key]))) return false
  if (value.last === undefined) return true
  return record(value.last) && text(value.last.id) && text(value.last.routeId)
    && oneOf(value.last.source, ['turn', 'response', 'notice'])
    && oneOf(value.last.status, ['prepared', 'sending', 'retrying', 'delivered', 'uncertain', 'failed'])
    && integer(value.last.attempts) && integer(value.last.updatedAt)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || integer(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T)
}
