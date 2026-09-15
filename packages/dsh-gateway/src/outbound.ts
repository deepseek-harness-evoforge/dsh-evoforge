import { setTimeout as wait } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import type { ResolvedGatewayRoute, ResolvedGatewayRoutes } from './routing.js'
import type {
  GatewayOutboundJournal,
  GatewayOutboundRecord,
  GatewayOutboundStatus,
} from './outbound-journal.js'

export interface GatewayTextDeliveryIntent {
  readonly routeId: string
  readonly kind: 'turn' | 'response' | 'notice'
  readonly intentKey: string
  readonly text: string
  readonly replyToExternalId?: string
  readonly replyInThread?: boolean
  /** Persist now, but do not send until this native DSH turn has ended. */
  readonly waitForTurnEnd?: number
}

/** The audited native FileAttachmentRef wire shape; Gateway never stores file bytes or host paths. */
export interface GatewayFileReference {
  readonly attachmentId: string
  readonly name: string
  readonly bytes: number
}

/** Host-only: native permission and an immutable attachment must be established before submission. */
export interface GatewayFileDeliveryIntent {
  readonly routeId: string
  readonly kind: 'file'
  readonly intentKey: string
  readonly file: GatewayFileReference
  readonly destinationDigest: string
  readonly replyToExternalId?: string
  readonly replyInThread?: boolean
}

export type GatewayDeliveryIntent = GatewayTextDeliveryIntent | GatewayFileDeliveryIntent

export interface GatewayFileSendInput {
  readonly routeId: string
  readonly file: GatewayFileReference
  readonly destinationDigest: string
  readonly replyToExternalId?: string
  readonly replyInThread?: boolean
}

/** Bind both the external recipient and native owner, not a mutable route label alone. */
export function gatewayFileDestinationDigest(route: ResolvedGatewayRoute): string {
  return createHash('sha256').update(JSON.stringify([
    'gateway-file-destination-v1', route.id, route.adapter, route.accountId,
    route.conversationId, route.threadId ?? null, route.userId,
    route.workspaceId, route.sessionId, route.agentPreset,
  ])).digest('hex')
}

export interface GatewayOutboundPolicy {
  readonly maxAttempts: number
  readonly maxRetryAfterMs: number
  readonly sendTimeoutMs: number
}

export interface GatewayOutboundSendInput {
  readonly routeId: string
  readonly text: string
  readonly replyToExternalId?: string
  readonly replyInThread?: boolean
}

export type GatewayOutboundSendResult =
  | { readonly kind: 'delivered'; readonly externalMessageId: string }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'uncertain' }

export interface GatewayTextAdapterConfig extends GatewayOutboundPolicy {
  readonly adapter: string
  readonly accountId: string
  readonly routeIds: readonly string[]
  /** Own future exact routes created by this Gateway's pairing authority for the same account. */
  readonly pairedRoutes?: boolean
  send(input: GatewayOutboundSendInput, signal: AbortSignal): Promise<GatewayOutboundSendResult>
  /** Must recheck destinationDigest against the live route before reading/sending the native attachment. */
  sendFile?(input: GatewayFileSendInput, signal: AbortSignal): Promise<GatewayOutboundSendResult>
}

export interface GatewayOutboundReceipt {
  readonly id: string
  readonly created: boolean
  readonly status: GatewayOutboundStatus
}

export interface GatewayTextAdapterRegistration {
  submit(intent: GatewayDeliveryIntent): Promise<GatewayOutboundReceipt>
  /** Read-only observation. A deadline returns the current durable status, not a delivery claim.
   * Aborting observation does not withdraw an already accepted intent or cancel its external effect.
   */
  waitForReceipt(id: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<GatewayOutboundReceipt>
  dispose(): Promise<void>
}

export interface GatewayOutboundHealth {
  readonly registrations: number
  readonly scheduled: number
  readonly total: number
  readonly prepared: number
  readonly sending: number
  readonly retrying: number
  readonly delivered: number
  readonly uncertain: number
  readonly failed: number
  readonly last?: {
    readonly id: string
    readonly routeId: string
    readonly kind: GatewayOutboundRecord['kind']
    readonly status: GatewayOutboundStatus
    readonly attempts: number
    readonly updatedAt: number
  }
}

/** Host-only terminal observation; it contains no message body or credentials. */
export interface GatewayOutboundObservation {
  readonly recordId: string
  readonly routeId: string
  readonly adapter: string
  readonly intentKeyHash: string
  readonly operationKeyHash: string
  readonly status: 'applied' | 'unknown'
  readonly attempts: number
  readonly observedAt: number
}

export class GatewayOutboundCoordinator {
  private readonly registrations = new Map<string, GatewayTextAdapterRegistrationImpl>()
  private started = false
  private stopping?: Promise<void>

  constructor(
    private readonly routes: ResolvedGatewayRoutes,
    private readonly journal: GatewayOutboundJournal,
    private readonly isTurnEnded: (
      route: ResolvedGatewayRoute,
      turn: number,
      signal: AbortSignal,
    ) => Promise<boolean>,
    private readonly pairedRoute: (id: string) => ResolvedGatewayRoute | undefined = () => undefined,
    private readonly onTerminal: (record: GatewayOutboundRecord) => void = () => {},
  ) {}

  async start(now: number): Promise<number> {
    if (this.stopping !== undefined) throw new Error('Gateway outbound coordinator is stopping')
    if (this.started) return 0
    const recovered = await this.journal.recoverInflight(now)
    this.started = true
    return recovered
  }

  register(config: GatewayTextAdapterConfig): GatewayTextAdapterRegistration {
    if (!this.started) throw new Error('Gateway outbound coordinator has not started')
    if (this.stopping !== undefined) throw new Error('Gateway outbound coordinator is stopping')
    validatePolicy(config)
    const ownedRoutes = exactRegistrationRoutes(this.routes, config)
    const key = registrationKey(config.adapter, config.accountId)
    if (this.registrations.has(key)) {
      throw new Error(`Gateway text Adapter account '${config.adapter}/${config.accountId}' is already registered`)
    }
    const registration = new GatewayTextAdapterRegistrationImpl(
      config,
      ownedRoutes,
      this.journal,
      this.isTurnEnded,
      this.pairedRoute,
      this.onTerminal,
      () => {
        if (this.registrations.get(key) === registration) this.registrations.delete(key)
      },
    )
    this.registrations.set(key, registration)
    registration.resumePending()
    return registration
  }

  /** Wake durable turn intents after the authoritative native Session records turn/end. */
  wakeEndedTurn(sessionId: string, turn: number): void {
    if (!Number.isSafeInteger(turn) || turn < 1) return
    for (const registration of this.registrations.values()) {
      registration.wakeEndedTurn(sessionId, turn)
    }
  }

  health(routeIds: ReadonlySet<string>, includeUnboundPaired = false): GatewayOutboundHealth {
    const counts: GatewayOutboundHealth = {
      registrations: [...this.registrations.values()]
        .filter(registration => registration.ownsAny(routeIds, includeUnboundPaired)).length,
      scheduled: [...this.registrations.values()]
        .reduce((total, registration) => total + registration.scheduledCount(routeIds), 0),
      total: 0,
      prepared: 0,
      sending: 0,
      retrying: 0,
      delivered: 0,
      uncertain: 0,
      failed: 0,
    }
    let latest: GatewayOutboundRecord | undefined
    for (const record of this.journal.list()) {
      if (!routeIds.has(record.routeId)) continue
      mutable(counts).total += 1
      mutable(counts)[record.status] += 1
      if (latest === undefined || record.updatedAt > latest.updatedAt
        || (record.updatedAt === latest.updatedAt && record.id.localeCompare(latest.id) > 0)) latest = record
    }
    return Object.freeze({
      ...counts,
      ...(latest === undefined ? {} : {
        last: Object.freeze({
          id: latest.id,
          routeId: latest.routeId,
          kind: latest.kind,
          status: latest.status,
          attempts: latest.attempts,
          updatedAt: latest.updatedAt,
        }),
      }),
    })
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      await Promise.allSettled([...this.registrations.values()].map(item => item.dispose()))
      await this.journal.close()
    })()
    return this.stopping
  }
}

class GatewayTextAdapterRegistrationImpl implements GatewayTextAdapterRegistration {
  private readonly lifecycle = new AbortController()
  private readonly routeIds: ReadonlySet<string>
  private readonly scheduled = new Set<string>()
  private readonly reschedule = new Set<string>()
  private tail: Promise<void> = Promise.resolve()
  /**
   * Submission calls can be between validation and the journal write when a
   * resident Gateway is disposed. Keep the journal open until those calls
   * have settled so unload cannot race a late prepare().
   */
  private activeSubmits = 0
  private submitIdle: Promise<void> | undefined
  private resolveSubmitIdle: (() => void) | undefined
  private disposed?: Promise<void>
  private readonly receiptWaiters = new Map<string, Set<(error?: Error) => void>>()

  constructor(
    private readonly config: GatewayTextAdapterConfig,
    routes: readonly ResolvedGatewayRoute[],
    private readonly journal: GatewayOutboundJournal,
    private readonly isTurnEnded: (
      route: ResolvedGatewayRoute,
      turn: number,
      signal: AbortSignal,
    ) => Promise<boolean>,
    private readonly pairedRoute: (id: string) => ResolvedGatewayRoute | undefined,
    private readonly onTerminal: (record: GatewayOutboundRecord) => void,
    private readonly onDispose: () => void,
  ) {
    this.routeIds = new Set(routes.map(route => route.id))
    this.routesById = new Map(routes.map(route => [route.id, route]))
  }

  private readonly routesById: ReadonlyMap<string, ResolvedGatewayRoute>

  async submit(intent: GatewayDeliveryIntent): Promise<GatewayOutboundReceipt> {
    this.beginSubmit()
    try {
      if (this.disposed !== undefined || this.lifecycle.signal.aborted) {
        throw new Error('Gateway text Adapter registration is disposed')
      }
      const route = this.route(intent.routeId)
      if (route === undefined) {
        throw new Error(`Gateway text Adapter does not own route '${intent.routeId}'`)
      }
      if (intent.kind === 'file') {
        if (this.config.sendFile === undefined) throw new Error('Gateway Adapter does not support file delivery')
        if (intent.destinationDigest !== gatewayFileDestinationDigest(route)) {
          throw new Error('Gateway file destination changed')
        }
      }
      const prepared = await this.journal.prepare({ ...intent, now: Date.now() })
      if (prepared.record.status === 'prepared' || prepared.record.status === 'retrying') {
        this.enqueue(prepared.record.id)
      }
      return Object.freeze({
        id: prepared.record.id,
        created: prepared.created,
        status: prepared.record.status,
      })
    } finally {
      this.endSubmit()
    }
  }

  async waitForReceipt(
    id: string,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<GatewayOutboundReceipt> {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120_000) {
      throw new Error('Gateway receipt timeoutMs must be from 1 to 120000')
    }
    const signal = options.signal === undefined ? this.lifecycle.signal
      : AbortSignal.any([this.lifecycle.signal, options.signal])
    signal.throwIfAborted()
    const current = this.readReceipt(id)
    if (isTerminal(current.status)) return current
    return new Promise<GatewayOutboundReceipt>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        const waiters = this.receiptWaiters.get(id)
        waiters?.delete(settle)
        if (waiters?.size === 0) this.receiptWaiters.delete(id)
      }
      const settle = (error?: Error): void => {
        cleanup()
        if (error !== undefined) { reject(error); return }
        try { resolve(this.readReceipt(id)) } catch (failure) { reject(failure) }
      }
      const onAbort = (): void => {
        cleanup()
        reject(signal.reason)
      }
      const timer = setTimeout(settle, options.timeoutMs)
      const waiters = this.receiptWaiters.get(id) ?? new Set<(error?: Error) => void>()
      waiters.add(settle)
      this.receiptWaiters.set(id, waiters)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  }

  private readReceipt(id: string): GatewayOutboundReceipt {
    const record = this.journal.get(id)
    const route = record === undefined ? undefined : this.route(record.routeId)
    if (record === undefined || route === undefined
      || (record.kind === 'file' && record.destinationDigest !== gatewayFileDestinationDigest(route))) {
      throw new Error('Gateway receipt is missing or no longer owned by this Adapter')
    }
    return Object.freeze({ id: record.id, created: false, status: record.status })
  }

  private settleReceiptWaiters(id: string, error?: Error): void {
    for (const settle of [...this.receiptWaiters.get(id) ?? []]) settle(error)
  }

  ownsAny(routeIds: ReadonlySet<string>, includeUnboundPaired = false): boolean {
    return [...routeIds].some(id => this.route(id) !== undefined)
      || (includeUnboundPaired && this.config.pairedRoutes === true)
  }

  scheduledCount(routeIds: ReadonlySet<string>): number {
    let count = 0
    for (const id of this.scheduled) {
      const record = this.journal.get(id)
      if (record !== undefined && routeIds.has(record.routeId)) count += 1
    }
    return count
  }

  resumePending(): void {
    for (const record of this.journal.list()) {
      if (this.route(record.routeId) !== undefined
        && (record.status === 'prepared' || record.status === 'retrying')) this.enqueue(record.id)
    }
  }

  wakeEndedTurn(sessionId: string, turn: number): void {
    for (const record of this.journal.list()) {
      if (record.status !== 'prepared' || record.waitForTurnEnd !== turn) continue
      const route = this.route(record.routeId)
      if (route?.sessionId === sessionId) this.enqueue(record.id)
    }
  }

  dispose(): Promise<void> {
    this.disposed ??= (async () => {
      this.lifecycle.abort(new Error('Gateway text Adapter registration disposed'))
      await this.waitForSubmits()
      await this.tail
      this.onDispose()
    })()
    return this.disposed
  }

  private beginSubmit(): void {
    if (this.activeSubmits === 0) {
      this.submitIdle = new Promise<void>((resolve) => {
        this.resolveSubmitIdle = resolve
      })
    }
    this.activeSubmits += 1
  }

  private endSubmit(): void {
    this.activeSubmits -= 1
    if (this.activeSubmits !== 0) return
    const resolve = this.resolveSubmitIdle
    this.resolveSubmitIdle = undefined
    this.submitIdle = undefined
    resolve?.()
  }

  private waitForSubmits(): Promise<void> {
    return this.activeSubmits === 0 ? Promise.resolve() : this.submitIdle ?? Promise.resolve()
  }

  private enqueue(id: string): void {
    if (this.lifecycle.signal.aborted) return
    if (this.scheduled.has(id)) {
      this.reschedule.add(id)
      return
    }
    this.scheduled.add(id)
    const task = this.tail.then(() => this.deliver(id))
    this.tail = task.then(
      () => {
        this.scheduled.delete(id)
        const requested = this.reschedule.delete(id)
        if (requested || this.journal.get(id)?.status === 'retrying') this.enqueue(id)
      },
      () => {
        this.scheduled.delete(id)
        this.settleReceiptWaiters(id, new Error('Gateway receipt could not be committed; delivery is not confirmed'))
        if (this.reschedule.delete(id)) this.enqueue(id)
      },
    )
  }

  private async deliver(id: string): Promise<void> {
    let record = this.journal.get(id)
    if (record === undefined || (record.status !== 'prepared' && record.status !== 'retrying')) return
    if (record.waitForTurnEnd !== undefined) {
      const route = this.route(record.routeId)
      if (route === undefined
        || !await this.isTurnEnded(route, record.waitForTurnEnd, this.lifecycle.signal)) return
    }
    if (record.status === 'retrying' && record.nextAttemptAt !== undefined) {
      await delay(Math.max(0, record.nextAttemptAt - Date.now()), this.lifecycle.signal)
      if (this.lifecycle.signal.aborted) return
      record = this.journal.get(id)
      if (record === undefined || record.status !== 'retrying') return
    }
    const sending = await this.journal.begin(id, Date.now())
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new Error('Gateway Adapter send exceeded its wall-clock limit'))
    }, this.config.sendTimeoutMs)
    const signal = AbortSignal.any([this.lifecycle.signal, timeout.signal])
    let result: GatewayOutboundSendResult
    try {
      result = normalizeResult(await raceWithAbort(
        () => {
          if (sending.kind !== 'file') return this.config.send(sendInput(sending), signal)
          const route = this.route(sending.routeId)
          if (route === undefined || gatewayFileDestinationDigest(route) !== sending.destinationDigest) {
            return Promise.resolve({ kind: 'rejected', code: 'file-destination-changed' } as const)
          }
          if (this.config.sendFile === undefined) {
            return Promise.resolve({ kind: 'rejected', code: 'file-delivery-unavailable' } as const)
          }
          return this.config.sendFile(Object.freeze({
            routeId: sending.routeId,
            file: Object.freeze({ ...sending.file }),
            destinationDigest: sending.destinationDigest,
            ...(sending.replyToExternalId === undefined ? {} : { replyToExternalId: sending.replyToExternalId }),
            ...(sending.replyInThread === undefined ? {} : { replyInThread: sending.replyInThread }),
          }), signal)
        },
        signal,
      ))
    } catch {
      result = { kind: 'uncertain' }
    } finally {
      clearTimeout(timer)
    }
    const finished = await this.journal.finish(id, result,
      sending.kind === 'file' ? { ...this.config, maxAttempts: 1 } : this.config, Date.now())
    if (isTerminal(finished.status)) this.settleReceiptWaiters(id)
    try {
      this.onTerminal(finished)
    } catch {
      // Evidence projection is best effort and must never alter delivery state.
    }
  }

  private route(id: string): ResolvedGatewayRoute | undefined {
    const configured = this.routesById.get(id)
    if (configured !== undefined) return configured
    if (this.config.pairedRoutes !== true) return undefined
    const paired = this.pairedRoute(id)
    if (paired?.adapter !== this.config.adapter || paired.accountId !== this.config.accountId) return undefined
    return paired
  }
}

function isTerminal(status: GatewayOutboundStatus): boolean {
  return status === 'delivered' || status === 'failed' || status === 'uncertain'
}

function sendInput(record: Exclude<GatewayOutboundRecord, { kind: 'file' }>): GatewayOutboundSendInput {
  return Object.freeze({
    routeId: record.routeId,
    text: record.text,
    ...(record.replyToExternalId === undefined ? {} : { replyToExternalId: record.replyToExternalId }),
    ...(record.replyInThread === undefined ? {} : { replyInThread: record.replyInThread }),
  })
}

function normalizeResult(value: GatewayOutboundSendResult): GatewayOutboundSendResult {
  if (value?.kind === 'delivered' && typeof value.externalMessageId === 'string'
    && value.externalMessageId.length >= 1 && value.externalMessageId.length <= 512
    && value.externalMessageId.trim() === value.externalMessageId
    && !/[\u0000-\u001f\u007f]/u.test(value.externalMessageId)) return value
  if (value?.kind === 'rate-limited' && Number.isSafeInteger(value.retryAfterMs)) return value
  if (value?.kind === 'rejected' && typeof value.code === 'string'
    && value.code.length >= 1 && value.code.length <= 128
    && !/[\u0000-\u001f\u007f]/u.test(value.code)) return value
  return { kind: 'uncertain' }
}

function validatePolicy(config: GatewayTextAdapterConfig): void {
  if (!Number.isSafeInteger(config.maxAttempts) || config.maxAttempts < 1 || config.maxAttempts > 5) {
    throw new Error('Gateway text Adapter maxAttempts must be from 1 to 5')
  }
  if (!Number.isSafeInteger(config.maxRetryAfterMs)
    || config.maxRetryAfterMs < 1 || config.maxRetryAfterMs > 300_000) {
    throw new Error('Gateway text Adapter maxRetryAfterMs must be from 1 to 300000')
  }
  if (!Number.isSafeInteger(config.sendTimeoutMs)
    || config.sendTimeoutMs < 1 || config.sendTimeoutMs > 120_000) {
    throw new Error('Gateway text Adapter sendTimeoutMs must be from 1 to 120000')
  }
}

function exactRegistrationRoutes(
  routes: ResolvedGatewayRoutes,
  config: GatewayTextAdapterConfig,
): readonly ResolvedGatewayRoute[] {
  if (!Array.isArray(config.routeIds) || config.routeIds.length > 100
    || (config.routeIds.length === 0 && config.pairedRoutes !== true)) {
    throw new Error('Gateway text Adapter must register exact route ids or opt into paired routes')
  }
  const seen = new Set<string>()
  return config.routeIds.map((id) => {
    if (seen.has(id)) throw new Error(`Gateway text Adapter route '${id}' is duplicated`)
    seen.add(id)
    const route = routes.byId.get(id)
    if (route === undefined) throw new Error(`Gateway text Adapter route '${id}' is unknown`)
    if (route.adapter !== config.adapter || route.accountId !== config.accountId) {
      throw new Error(`Gateway text Adapter route '${id}' does not belong to '${config.adapter}/${config.accountId}'`)
    }
    return route
  })
}

function registrationKey(adapter: string, accountId: string): string {
  return `${adapter}\0${accountId}`
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await wait(ms, undefined, { signal })
  } catch {
    // The registration lifecycle owns cancellation; retry state stays durable.
  }
}

function raceWithAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const resolveOnce = (value: T): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = (): void => {
      rejectOnce(signal.reason ?? new Error('Gateway Adapter send was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    let pending: Promise<T>
    try {
      pending = operation()
    } catch (error: unknown) {
      rejectOnce(error)
      return
    }
    void pending.then(resolveOnce, rejectOnce)
  })
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function mutable<T>(value: T): Mutable<T> {
  return value as Mutable<T>
}
