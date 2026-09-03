import type {
  GatewayOutboundHealth,
  GatewayOutboundStatus,
  GatewayTransportHealthItem,
  GatewayTransportState,
} from 'dsh-gateway'
import {
  FEISHU_CONTENT_PERMISSIONS,
  type FeishuContentPermission,
} from './config.js'
import type { FeishuPlatformRejectReason } from './platform.js'

export const FEISHU_HEALTH_PREFIX = 'EVOFORGE_FEISHU_HEALTH_V2 '

export type FeishuTransportState = GatewayTransportState
export type FeishuHealthStatus = 'ready' | 'busy' | 'attention' | 'degraded' | 'stopping'
export type FeishuContentHealthStatus = 'disabled' | 'ready' | 'future-session-only'
  | 'approval-unavailable' | 'tool-unavailable'

export interface FeishuHealthRoute {
  readonly id: string
  readonly threadScoped: boolean
}

export interface FeishuHealthRouteInput extends FeishuHealthRoute {
  readonly workspaceId: string
  readonly sessionId: string
}

export interface FeishuContentHealth {
  readonly status: FeishuContentHealthStatus
  readonly enabledCount: number
  readonly permissions: readonly {
    readonly name: FeishuContentPermission
    readonly enabled: boolean
  }[]
  readonly toolAvailable: boolean
  readonly approvalAvailable: boolean
  readonly maxContentChars: number
  readonly maxBitableRecords: number
  /** Health never turns a read-only refresh into a live Feishu permission probe. */
  readonly platformAccess: 'not-verified'
}

export interface FeishuHealthSnapshot {
  readonly schemaVersion: 2
  readonly observedAt: number
  readonly accountId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly status: FeishuHealthStatus
  readonly transport: {
    readonly kind: 'official-feishu-websocket'
    readonly state: FeishuTransportState
    readonly connectedAt?: number
    /** Last inbound platform event observed by this Adapter, not merely any transport activity. */
    readonly lastInboundAt?: number
    readonly lastActivityAt?: number
    readonly lastErrorAt?: number
    /** Last event rejected by the official Feishu policy gate (identifiers are never exposed). */
    readonly lastPolicyRejectAt?: number
    readonly lastPolicyRejectReason?: FeishuPlatformRejectReason
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
      readonly source: 'turn' | 'response' | 'notice'
      readonly status: GatewayOutboundStatus
      readonly attempts: number
      readonly updatedAt: number
    }
  }
  readonly pendingApprovals: number
  readonly content: FeishuContentHealth
  readonly modelCalls: 0
  readonly authority: 'native-dsh-command'
}

export interface SummarizeFeishuContentHealthInput {
  readonly permissions: ReadonlySet<FeishuContentPermission>
  readonly toolAvailable: boolean
  readonly approvalAvailable: boolean
  readonly futureSessionOnly: boolean
  readonly maxContentChars: number
  readonly maxBitableRecords: number
}

export interface SummarizeFeishuHealthInput {
  readonly now: number
  readonly accountId: string
  readonly transport: GatewayTransportHealthItem
  readonly routes: readonly FeishuHealthRouteInput[]
  readonly outbound: GatewayOutboundHealth
  readonly pendingApprovals: number
  readonly lastInboundAt?: number
  readonly lastPolicyRejectAt?: number
  readonly lastPolicyRejectReason?: FeishuPlatformRejectReason
  readonly content: SummarizeFeishuContentHealthInput
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
  if (input.transport.adapter !== 'feishu' || input.transport.kind !== 'official-feishu-websocket'
    || input.transport.routeIds.length !== routeIds.size
    || input.transport.routeIds.some(routeId => !routeIds.has(routeId))) {
    throw new Error('Feishu health transport facts must belong to its exact Gateway routes')
  }
  if (input.outbound.last !== undefined && !routeIds.has(input.outbound.last.routeId)) {
    throw new Error('Feishu health outbound facts must belong to one of its exact routes')
  }
  const counts = input.outbound
  const active = counts.prepared + counts.sending + counts.retrying
  const content = summarizeFeishuContentHealth(input.content)
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
          : content.status !== 'disabled' && content.status !== 'ready'
            ? 'attention'
            : active > 0 || counts.scheduled > 0 || input.pendingApprovals > 0
              ? 'busy'
              : 'ready'
  return Object.freeze({
    schemaVersion: 2,
    observedAt: input.now,
    accountId: input.accountId,
    workspaceId,
    sessionId,
    status,
    transport: Object.freeze({
      kind: 'official-feishu-websocket',
      state: input.transport.state,
      ...(input.transport.connectedAt === undefined ? {} : { connectedAt: input.transport.connectedAt }),
      ...(input.lastInboundAt === undefined ? {} : { lastInboundAt: input.lastInboundAt }),
      ...(input.transport.lastActivityAt === undefined ? {} : { lastActivityAt: input.transport.lastActivityAt }),
      ...(input.transport.lastErrorAt === undefined ? {} : { lastErrorAt: input.transport.lastErrorAt }),
      ...(input.lastPolicyRejectAt === undefined ? {} : { lastPolicyRejectAt: input.lastPolicyRejectAt }),
      ...(input.lastPolicyRejectReason === undefined ? {} : { lastPolicyRejectReason: input.lastPolicyRejectReason }),
    }),
    routeCount: input.routes.length,
    routesTruncated: input.routes.length > visibleRoutes.length,
    routes: Object.freeze(visibleRoutes),
    deliveries: Object.freeze({
      total: counts.total,
      prepared: counts.prepared,
      sending: counts.sending,
      retrying: counts.retrying,
      delivered: counts.delivered,
      uncertain: counts.uncertain,
      failed: counts.failed,
      scheduled: counts.scheduled,
      ...(counts.last === undefined ? {} : {
        last: Object.freeze({
          id: counts.last.id,
          routeId: counts.last.routeId,
          source: counts.last.kind,
          status: counts.last.status,
          attempts: counts.last.attempts,
          updatedAt: counts.last.updatedAt,
        }),
      }),
    }),
    pendingApprovals: input.pendingApprovals,
    content,
    modelCalls: 0,
    authority: 'native-dsh-command',
  })
}

/** Resolve configured policy against the exact current Agent surface, without probing Feishu. */
export function summarizeFeishuContentHealth(
  input: SummarizeFeishuContentHealthInput,
): FeishuContentHealth {
  const permissions = Object.freeze(FEISHU_CONTENT_PERMISSIONS.map(name => Object.freeze({
    name,
    enabled: input.permissions.has(name),
  })))
  const enabledCount = permissions.filter(permission => permission.enabled).length
  const status: FeishuContentHealthStatus = enabledCount === 0
    ? 'disabled'
    : input.toolAvailable && input.approvalAvailable
      ? 'ready'
      : input.toolAvailable
        ? 'approval-unavailable'
        : input.futureSessionOnly
          ? 'future-session-only'
          : 'tool-unavailable'
  return Object.freeze({
    status,
    enabledCount,
    permissions,
    toolAvailable: input.toolAvailable,
    approvalAvailable: input.approvalAvailable,
    maxContentChars: input.maxContentChars,
    maxBitableRecords: input.maxBitableRecords,
    platformAccess: 'not-verified',
  })
}

/** Human-readable command output plus one machine-readable line for native DSH Web. */
export function renderFeishuHealthCommand(snapshot: FeishuHealthSnapshot): string {
  return [
    `Feishu: ${snapshot.status.toUpperCase()} (${snapshot.routes.map(route => route.id).join(', ')}${snapshot.routesTruncated ? ', …' : ''}).`,
    `Transport: ${snapshot.transport.kind}; lifecycle ${snapshot.transport.state}.`,
    `Deliveries: ${snapshot.deliveries.total} total; ${snapshot.deliveries.retrying} retrying; ${snapshot.deliveries.uncertain} uncertain; ${snapshot.deliveries.failed} failed.`,
    `Content: ${snapshot.content.status.toUpperCase()}; ${snapshot.content.enabledCount} permissions enabled; Tool ${snapshot.content.toolAvailable ? 'available' : 'unavailable'}; Approval ${snapshot.content.approvalAvailable ? 'available' : 'unavailable'}; platform access not verified.`,
    `Policy rejects: ${snapshot.transport.lastPolicyRejectReason === undefined ? 'none observed' : `${snapshot.transport.lastPolicyRejectReason} at ${new Date(snapshot.transport.lastPolicyRejectAt ?? snapshot.observedAt).toISOString()}`}.`,
    `Approvals: ${snapshot.pendingApprovals} pending. Model surface: ${snapshot.modelCalls} calls.`,
    `${FEISHU_HEALTH_PREFIX}${JSON.stringify(snapshot)}`,
  ].join('\n')
}

/** Parse only the bounded v2 projection; arbitrary Command text is never trusted as state. */
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
  const policyRejectAt = record(value) && record(value.transport) ? value.transport.lastPolicyRejectAt : undefined
  const policyRejectReason = record(value) && record(value.transport) ? value.transport.lastPolicyRejectReason : undefined
  const hasPolicyRejectAt = policyRejectAt !== undefined
  const hasPolicyRejectReason = policyRejectReason !== undefined
  if (!record(value) || value.schemaVersion !== 2 || !integer(value.observedAt) || !text(value.accountId)
    || !text(value.workspaceId) || !text(value.sessionId) || !integer(value.routeCount)
    || typeof value.routesTruncated !== 'boolean'
    || !oneOf(value.status, ['ready', 'busy', 'attention', 'degraded', 'stopping'])
    || value.modelCalls !== 0 || value.authority !== 'native-dsh-command'
    || !record(value.transport) || value.transport.kind !== 'official-feishu-websocket'
    || !oneOf(value.transport.state, ['connecting', 'ready', 'degraded', 'stopping'])
    || !optionalInteger(value.transport.connectedAt) || !optionalInteger(value.transport.lastInboundAt)
    || !optionalInteger(value.transport.lastActivityAt)
    || !optionalInteger(value.transport.lastErrorAt)
    || !optionalInteger(value.transport.lastPolicyRejectAt)
    || hasPolicyRejectAt !== hasPolicyRejectReason
    || (hasPolicyRejectReason
      && !oneOf(policyRejectReason, ['group_not_allowed', 'sender_not_allowed', 'no_mention', 'dm_disabled', 'mention_all_blocked']))
    || !Array.isArray(value.routes)
    || value.routes.length > 20 || !value.routes.every(route)
    || !record(value.deliveries) || !deliveries(value.deliveries)
    || !integer(value.pendingApprovals) || !contentHealth(value.content)) return false
  const routeIds = value.routes.map(item => item.id)
  if (new Set(routeIds).size !== routeIds.length || value.routeCount < value.routes.length
    || value.routesTruncated !== (value.routeCount > value.routes.length)) return false
  return true
}

function contentHealth(value: unknown): value is FeishuContentHealth {
  if (!record(value)
    || !oneOf(value.status, ['disabled', 'ready', 'future-session-only', 'approval-unavailable', 'tool-unavailable'])
    || !integer(value.enabledCount)
    || typeof value.toolAvailable !== 'boolean'
    || typeof value.approvalAvailable !== 'boolean'
    || !integerRange(value.maxContentChars, 1_024, 100_000)
    || !integerRange(value.maxBitableRecords, 1, 100)
    || value.platformAccess !== 'not-verified'
    || !Array.isArray(value.permissions)
    || value.permissions.length !== FEISHU_CONTENT_PERMISSIONS.length) return false
  let enabledCount = 0
  for (let index = 0; index < FEISHU_CONTENT_PERMISSIONS.length; index += 1) {
    const permission = value.permissions[index]
    if (!record(permission) || permission.name !== FEISHU_CONTENT_PERMISSIONS[index]
      || typeof permission.enabled !== 'boolean') return false
    if (permission.enabled) enabledCount += 1
  }
  if (value.enabledCount !== enabledCount) return false
  if (enabledCount === 0) return value.status === 'disabled'
  if (value.status === 'ready') return value.toolAvailable && value.approvalAvailable
  if (value.status === 'approval-unavailable') return value.toolAvailable && !value.approvalAvailable
  if (value.status === 'future-session-only' || value.status === 'tool-unavailable') return !value.toolAvailable
  return false
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

function integerRange(value: unknown, minimum: number, maximum: number): value is number {
  return integer(value) && value >= minimum && value <= maximum
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
