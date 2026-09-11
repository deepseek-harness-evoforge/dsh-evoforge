import type { Context } from '@deepseek-ai/cordis'
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { runWithLifecycleDeadline } from './lifecycle-deadline.ts'

const DEFAULT_SESSION_PERSISTENCE_READ_TIMEOUT_MS = 30_000
const MAX_SESSION_PERSISTENCE_READ_TIMEOUT_MS = 120_000

type PersistenceMethod = (...args: never[]) => unknown

/**
 * Compile-time bridge while EvoForge still builds against DSH alpha.5.
 * Runtime capability selection remains exact and one-shot: alpha.5 exposes
 * `readFrom`; current DSH exposes `open` and a closeable read handle.
 */
export interface InteractionSessionPersistenceReadPortV1 {
  readonly readFrom?: PersistenceMethod
  readonly open?: PersistenceMethod
}

export interface InteractionSessionPersistenceReadOptionsV1 {
  readonly lifecycle: Pick<Context, 'effect'>
  readonly timeoutMs: number
  readonly requiredEventCount: number
}

export interface NormalizedInteractionSessionStoredCutV1 {
  readonly meta: SessionHeader
  readonly inheritedEventCount: number
  readonly fromSeq: number
  readonly events: readonly SessionEvent[]
}

/** Fulfilled current-handle data violated the physical cut contract. */
export class InteractionSessionStoredCutConflictError extends Error {
  override readonly name = 'InteractionSessionStoredCutConflictError'
}

/** Persistence capabilities or handle operations violated the invocation contract. */
export class InteractionSessionPersistenceReadProtocolError extends Error {
  override readonly name = 'InteractionSessionPersistenceReadProtocolError'
}

export function sessionPersistenceReadTimeoutMs(configured: number | undefined): number {
  const timeoutMs = configured ?? DEFAULT_SESSION_PERSISTENCE_READ_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_SESSION_PERSISTENCE_READ_TIMEOUT_MS) {
    throw new Error('Session persistence read timeout must be from 1 to 120000 milliseconds')
  }
  return timeoutMs
}

/** Identify the one supported physical-read dialect without invoking it. */
export function interactionSessionPersistenceReadDialectV1(
  persistence: InteractionSessionPersistenceReadPortV1,
): 'alpha5' | 'current' {
  return persistenceReadDialect(persistence).kind
}

/**
 * Read one durable Session prefix without recovery, cache publication, or
 * write ownership. The deadline covers capability selection plus the entire
 * alpha.5 read, or current open/read/close lifecycle.
 */
export async function readInteractionSessionStoredCutV1(
  persistence: InteractionSessionPersistenceReadPortV1,
  sessionId: Session['id'],
  options: InteractionSessionPersistenceReadOptionsV1,
): Promise<unknown> {
  const timeoutMs = sessionPersistenceReadTimeoutMs(options.timeoutMs)
  if (!Number.isSafeInteger(options.requiredEventCount)
    || options.requiredEventCount < 0
    || Object.is(options.requiredEventCount, -0)) {
    throw new InteractionSessionPersistenceReadProtocolError(
      'Required Session event count must be a non-negative safe integer',
    )
  }
  const controller = new AbortController()
  const deadlineAt = globalThis.performance.now() + timeoutMs
  const currentLease: { value?: CurrentReadHandleLease } = {}
  let primary: { error: unknown } | undefined
  let completed = false
  try {
    const stored = await runWithLifecycleDeadline(options.lifecycle, async () => {
      const dialect = persistenceReadDialect(persistence)
      if (dialect.kind === 'alpha5') {
        const suffix = await Reflect.apply(dialect.readFrom, persistence, [
          sessionId,
          SessionLogOffset(0),
          controller.signal,
        ])
        throwIfAborted(controller.signal)
        return suffix
      }
      return readCurrentStoredCut(
        persistence,
        dialect.open,
        sessionId,
        options.requiredEventCount,
        currentLease,
        options.lifecycle,
        controller,
        deadlineAt,
        error => { if (!controller.signal.aborted && primary === undefined) primary = { error } },
      )
    }, {
      timeoutMs,
      label: 'dsh-evolve.interactionEpisode.sessionPersistenceRead',
      timeoutMessage: 'Session persistence read timed out',
      signal: controller.signal,
      onDeadline: () => { controller.abort() },
    })
    completed = true
    return stored
  } catch (error) {
    throw primary === undefined ? error : primary.error
  } finally {
    if (!completed) {
      controller.abort()
      // A backend may ignore cancellation. Start uncancellable close now when
      // a handle exists; the still-observed invocation joins this same promise.
      try {
        await currentLease.value?.release(controller.signal)
      } catch {
        // The primary read/deadline failure remains the public result.
      }
    }
  }
}

type PersistenceReadDialect =
  | { readonly kind: 'alpha5'; readonly readFrom: PersistenceMethod }
  | { readonly kind: 'current'; readonly open: PersistenceMethod }

function persistenceReadDialect(
  persistence: InteractionSessionPersistenceReadPortV1,
): PersistenceReadDialect {
  let readFrom: unknown
  let open: unknown
  try {
    readFrom = Reflect.get(persistence, 'readFrom')
    open = Reflect.get(persistence, 'open')
  } catch {
    throw new InteractionSessionPersistenceReadProtocolError(
      'Session persistence capability inspection failed',
    )
  }
  const hasReadFrom = typeof readFrom === 'function'
  const hasOpen = typeof open === 'function'
  if ((readFrom !== undefined && !hasReadFrom)
    || (open !== undefined && !hasOpen)
    || hasReadFrom === hasOpen) {
    throw new InteractionSessionPersistenceReadProtocolError(
      'Session persistence must expose exactly one supported read dialect',
    )
  }
  return hasReadFrom
    ? { kind: 'alpha5', readFrom: readFrom as PersistenceMethod }
    : { kind: 'current', open: open as PersistenceMethod }
}

async function readCurrentStoredCut(
  persistence: InteractionSessionPersistenceReadPortV1,
  open: PersistenceMethod,
  sessionId: Session['id'],
  requiredEventCount: number,
  leaseSlot: { value?: CurrentReadHandleLease },
  lifecycle: Pick<Context, 'effect'>,
  controller: AbortController,
  deadlineAt: number,
  recordPrimary: (error: unknown) => void,
): Promise<NormalizedInteractionSessionStoredCutV1> {
  const signal = controller.signal
  const candidate = await Reflect.apply(open, persistence, [
    sessionId,
    'read',
    { signal },
  ])
  const lease = CurrentReadHandleLease.capture(candidate)
  leaseSlot.value = lease

  let primaryFailed = false
  try {
    throwIfAborted(signal)
    lease.bindLifecycle(lifecycle, controller, deadlineAt)
    const handle = lease.snapshot(sessionId)
    const raw = await Reflect.apply(handle.read, lease.receiver, [
      0,
      requiredEventCount,
      { signal },
    ])
    throwIfAborted(signal)
    const events = currentReadEvents(raw, requiredEventCount)
    return {
      meta: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      fromSeq: SessionLogOffset(0),
      events,
    }
  } catch (error) {
    primaryFailed = true
    recordPrimary(error)
    throw error
  } finally {
    try {
      await lease.release(signal)
    } catch (error) {
      // Preserve an official read failure's evidence classification. A close
      // failure after a successful read remains an invocation failure.
      if (!primaryFailed) {
        throw new InteractionSessionPersistenceReadProtocolError(
          'Session read handle close failed',
        )
      }
    }
  }
}

interface CurrentHandleSnapshot {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly read: PersistenceMethod
}

class CurrentReadHandleLease {
  private closeStarted = false
  private closePromise: Promise<void> | undefined
  private lifecycleDispose: (() => unknown) | undefined
  private lifecycleDetachPromise: Promise<void> | undefined
  private suppressLifecycleAbort = false
  readonly receiver: object
  private readonly close: PersistenceMethod

  private constructor(
    receiver: object,
    close: PersistenceMethod,
  ) {
    this.receiver = receiver
    this.close = close
  }

  static capture(candidate: unknown): CurrentReadHandleLease {
    if ((typeof candidate !== 'object' || candidate === null)
      && typeof candidate !== 'function') {
      throw new InteractionSessionPersistenceReadProtocolError(
        'Session persistence open returned no handle',
      )
    }
    const receiver = candidate as object
    const close = readCallable(receiver, 'close')
    return new CurrentReadHandleLease(receiver, close)
  }

  bindLifecycle(
    owner: Pick<Context, 'effect'>,
    controller: AbortController,
    deadlineAt: number,
  ): void {
    this.lifecycleDispose = owner.effect(() => () => {
      if (!this.suppressLifecycleAbort) controller.abort()
      // Cordis reports disposer rejections through its logger. A physical
      // close failure is private backend detail during owner teardown; the
      // public read race already fails closed through lifecycle disposal.
      return this.closeUntil(deadlineAt).catch(() => undefined)
    }, 'dsh-evolve.interactionEpisode.sessionPersistenceHandle')
  }

  snapshot(expectedSessionId: Session['id']): CurrentHandleSnapshot {
    const read = readCallable(this.receiver, 'read')
    let id: unknown
    let access: unknown
    let header: unknown
    let inheritedEventCount: unknown
    try {
      id = Reflect.get(this.receiver, 'id')
      access = Reflect.get(this.receiver, 'access')
      header = Reflect.get(this.receiver, 'header')
      inheritedEventCount = Reflect.get(this.receiver, 'inheritedEventCount')
    } catch {
      throw new InteractionSessionPersistenceReadProtocolError(
        'Session read handle metadata inspection failed',
      )
    }
    if (id !== expectedSessionId || access !== 'read') {
      throw new InteractionSessionPersistenceReadProtocolError(
        'Session persistence returned the wrong read handle',
      )
    }
    if (header === null || typeof header !== 'object' || Array.isArray(header)) {
      throw new InteractionSessionStoredCutConflictError(
        'Session read handle returned malformed metadata',
      )
    }
    let detachedHeader: SessionHeader
    try {
      detachedHeader = structuredClone(header) as SessionHeader
    } catch {
      throw new InteractionSessionStoredCutConflictError(
        'Session read handle returned malformed metadata',
      )
    }
    if (typeof inheritedEventCount !== 'number'
      || !Number.isSafeInteger(inheritedEventCount)
      || inheritedEventCount < 0
      || Object.is(inheritedEventCount, -0)) {
      throw new InteractionSessionStoredCutConflictError(
        'Session read handle returned malformed inherited metadata',
      )
    }
    return { header: detachedHeader, inheritedEventCount, read }
  }

  closeOnce(): Promise<void> {
    if (this.closeStarted) return this.closePromise!
    this.closeStarted = true
    let resolveClose!: () => void
    let rejectClose!: (error: unknown) => void
    this.closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve
      rejectClose = reject
    })
    try {
      void Promise.resolve(
        Reflect.apply(this.close, this.receiver, []),
      ).then(resolveClose, rejectClose)
    } catch (error) {
      rejectClose(error)
    }
    return this.closePromise
  }

  async release(signal: AbortSignal): Promise<void> {
    const close = this.closeOnce()
    if (signal.aborted) {
      await this.releaseAfterAbort()
      return
    }
    const closed = Symbol('closed')
    const aborted = Symbol('aborted')
    let resolveAborted!: (value: typeof aborted) => void
    const abortOutcome = new Promise<typeof aborted>((resolve) => {
      resolveAborted = resolve
    })
    const onAbort = (): void => { resolveAborted(aborted) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const outcome = await Promise.race([
        close.then(() => closed),
        abortOutcome,
      ])
      if (outcome === aborted) {
        await this.releaseAfterAbort()
        return
      }
      await this.detachLifecycle()
    } catch (error) {
      try {
        await this.detachLifecycle()
      } catch {
        // Preserve the physical close failure as the primary invocation error.
      }
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async releaseAfterAbort(): Promise<void> {
    // The handle effect can already be detached, or a late open can arrive
    // after its owner is inactive. Observe close independently of that owner.
    void this.closeOnce().catch(() => undefined)
    try {
      await this.detachLifecycle()
    } catch {
      // The deadline already owns the public failure. `closeOnce()` remains
      // observed by the lifecycle disposer even when its bounded join ends.
    }
  }

  private detachLifecycle(): Promise<void> {
    if (this.lifecycleDispose === undefined) return Promise.resolve()
    if (this.lifecycleDetachPromise !== undefined) return this.lifecycleDetachPromise
    this.suppressLifecycleAbort = true
    try {
      this.lifecycleDetachPromise = Promise.resolve(this.lifecycleDispose())
        .then(() => undefined)
        .finally(() => { this.suppressLifecycleAbort = false })
    } catch (error) {
      this.suppressLifecycleAbort = false
      this.lifecycleDetachPromise = Promise.reject(error)
    }
    return this.lifecycleDetachPromise
  }

  private async closeUntil(deadlineAt: number): Promise<void> {
    const close = this.closeOnce()
    const remainingMs = deadlineAt - globalThis.performance.now()
    if (remainingMs <= 0) {
      void close.catch(() => undefined)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, remainingMs)
    })
    try {
      await Promise.race([close, deadline])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

function readCallable(receiver: object, key: 'read' | 'close'): PersistenceMethod {
  const visited = new Set<object>()
  let cursor: object | null = receiver
  try {
    while (cursor !== null) {
      if (visited.has(cursor)) {
        throw new TypeError('cyclic prototype chain')
      }
      visited.add(cursor)
      const descriptor = Reflect.getOwnPropertyDescriptor(cursor, key)
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
          throw new TypeError('accessor or non-callable method')
        }
        return descriptor.value as PersistenceMethod
      }
      cursor = Reflect.getPrototypeOf(cursor)
    }
  } catch {
    throw new InteractionSessionPersistenceReadProtocolError(
      `Session read handle ${key} inspection failed`,
    )
  }
  throw new InteractionSessionPersistenceReadProtocolError(
    `Session read handle has no callable ${key}`,
  )
}

function currentReadEvents(
  candidate: unknown,
  requiredEventCount: number,
): readonly SessionEvent[] {
  const snapshot = plainDataRecord(candidate)
  if (snapshot === undefined
    || !hasExactKeys(snapshot, ['eventState', 'events'])
    || (snapshot.eventState !== 'detached' && snapshot.eventState !== 'shared-frozen')
    || !Array.isArray(snapshot.events)
    || snapshot.events.length > requiredEventCount) {
    throw new InteractionSessionStoredCutConflictError(
      'Session read handle returned a malformed event slice',
    )
  }
  try {
    return structuredClone(snapshot.events) as readonly SessionEvent[]
  } catch {
    throw new InteractionSessionStoredCutConflictError(
      'Session read handle returned unclonable events',
    )
  }
}

function plainDataRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return undefined
  }
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]
    if (typeof key !== 'string'
      || descriptor === undefined
      || !descriptor.enumerable
      || !('value' in descriptor)) return undefined
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function hasExactKeys(
  snapshot: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return Reflect.ownKeys(snapshot).length === keys.length
    && keys.every(key => Object.hasOwn(snapshot, key))
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason ?? new Error('Session persistence read aborted')
}
