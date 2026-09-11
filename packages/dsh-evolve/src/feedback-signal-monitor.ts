import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  DurableFeedbackStoredSession,
  DurableFeedbackAttribution,
  ExactSkillInvocationAttribution,
} from './durable-feedback-attribution.ts'
import type { EvolutionStore, SessionIdentity } from './generation-store.ts'
import { createLifecycleTimerScope } from './lifecycle-deadline.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const DEFAULT_MAX_SESSIONS = 1_000
const MAX_SIGNALS_PER_SESSION = 100
const FEEDBACK_RECOVERY_RETRY_MS = 1_000
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const exactSkillInvocationAttributionSchema = z.strictObject({
  kind: z.literal('exact-skill-invocation-v1'),
  skillName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  route: z.enum(['user-explicit', 'model-tool']),
  invocationSeq: nonNegativeSafeInteger,
  // Optional only for backward compatibility with v2 rows written before V4.21.
  invocationContentHash: hashSchema.optional(),
  assistantSeq: nonNegativeSafeInteger,
  turn: nonNegativeSafeInteger,
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
})

const sourceFeedbackItemSchema = z.object({
  messageId: z.string().min(1),
  rating: z.enum(['positive', 'negative']),
  note: z.string().optional(),
  category: z.enum([
    'task-result',
    'instruction-following',
    'product-interaction',
    'service-stability',
    'resource-cost',
    'security-privacy-permission',
    'other',
  ]).optional(),
  version: z.uuid(),
  createdAt: nonNegativeSafeInteger,
  updatedAt: nonNegativeSafeInteger,
}).refine(item => item.updatedAt >= item.createdAt)

const sourceFeedbackRowSchema = z.object({
  session: z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
  }),
  items: z.array(sourceFeedbackItemSchema),
})

const currentFeedbackPutSchema = z.object({
  sessionId: z.string().min(1),
  item: sourceFeedbackItemSchema,
})

const currentFeedbackDeleteSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
})

const storedSignalItemSchema = z.strictObject({
  id: hashSchema,
  messageId: z.string().min(1),
  feedbackVersion: z.uuid(),
  sourceUpdatedAt: nonNegativeSafeInteger,
  attribution: exactSkillInvocationAttributionSchema.optional(),
})

const storedSignalSessionSchema = z.strictObject({
  schemaVersion: z.literal(2),
  observedAt: nonNegativeSafeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1),
  generationId: hashSchema.optional(),
  items: z.array(storedSignalItemSchema).max(MAX_SIGNALS_PER_SESSION),
})

type StoredSignalSession = z.infer<typeof storedSignalSessionSchema>

const feedbackSignalDomainSpec = defineDomain({
  name: 'evoforge_feedback_signals',
  version: 2,
  tables: {
    sessions: domainTable<string, StoredSignalSession>(storedSignalSessionSchema),
  },
})

type FeedbackSignalDomain = Domain<typeof feedbackSignalDomainSpec>

export interface FeedbackSignal {
  readonly schemaVersion: 2
  readonly id: string
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly messageId: string
  readonly feedbackVersion: string
  readonly sourceUpdatedAt: number
  readonly generationId?: string | undefined
  readonly attribution?: ExactSkillInvocationAttribution | undefined
}

export interface FeedbackSignalSummary {
  readonly all: number
  readonly selected: number
}

export interface DurableMessageFeedbackItem {
  readonly messageId: string
  readonly rating: 'positive' | 'negative'
  readonly note?: string | undefined
  readonly category?: string | undefined
  readonly version: string
  readonly createdAt: number
  readonly updatedAt: number
}

interface FeedbackSignalSessionInput {
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly generationId?: string | undefined
  readonly items: readonly z.infer<typeof storedSignalItemSchema>[]
}

export interface FeedbackSignalStore {
  replaceSession(input: FeedbackSignalSessionInput, isActive?: () => boolean): Promise<void | boolean>
  removeSession(sessionId: string, isActive?: () => boolean): Promise<void>
  get(id: string, workspaceId?: string): FeedbackSignal | undefined
  list(workspaceId?: string): FeedbackSignal[]
  summarize(workspaceId: string, selectedGenerationId?: string): FeedbackSignalSummary
  close(): Promise<void>
}

export interface FeedbackSignalMonitor {
  flush(): Promise<void>
  /** Rebuild current-DSH projections from durable Session prefixes. */
  reconcileCurrent(): Promise<void>
  dispose(): Promise<void>
}

interface CurrentFeedbackSessionReconciler {
  readonly dialect?: 'alpha5' | 'current'
  /** Join the message-feedback queue, then return its view and physical prefix. */
  reconcile(sessionId: string): Promise<CurrentFeedbackReconciliation | undefined>
  /** Re-enable path may durably flush an already-live Session before reading. */
  recover?(sessionId: string): Promise<CurrentFeedbackReconciliation | undefined>
  /** List current-DSH Session ids, or abstain on the alpha.5 dialect. */
  listSessionIds?(): Promise<readonly string[] | undefined>
}

interface CurrentFeedbackReconciliation {
  readonly dialect: 'alpha5' | 'current'
  readonly stored: DurableFeedbackStoredSession
  readonly listedItems: unknown
  readonly sourceRow?: unknown
}

class DomainFeedbackSignalStore implements FeedbackSignalStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: FeedbackSignalDomain
  private readonly maxSessions: number

  constructor(
    domain: FeedbackSignalDomain,
    maxSessions: number,
  ) {
    this.domain = domain
    this.maxSessions = maxSessions
  }

  replaceSession(input: FeedbackSignalSessionInput, isActive?: () => boolean): Promise<boolean> {
    let captured: FeedbackSignalSessionInput
    try {
      captured = structuredClone(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      if (isActive?.() === false) return false
      const table = this.domain.table('sessions')
      if (captured.items.length === 0) {
        return await table.delete(captured.sessionId)
      }
      const previous = table.get(captured.sessionId)
      const session = immutableCopy(storedSignalSessionSchema.parse({
        schemaVersion: 2,
        ...captured,
        ...(previous === undefined ? {} : { observedAt: previous.observedAt }),
        items: [...captured.items]
          .sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt
            || left.id.localeCompare(right.id))
          .slice(0, MAX_SIGNALS_PER_SESSION)
          .sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt
            || left.id.localeCompare(right.id)),
      }))
      if (previous !== undefined && isDeepStrictEqual(previous, session)) return false
      await table.put(session.sessionId, session)
      if (table.size <= this.maxSessions) return true
      const expired = [...table.entries()]
        .sort((left, right) => sessionFreshness(left[1]) - sessionFreshness(right[1])
          || left[0].localeCompare(right[0]))
        .slice(0, table.size - this.maxSessions)
      for (const [sessionId] of expired) await table.delete(sessionId)
      return true
    })
  }

  removeSession(sessionId: string, isActive?: () => boolean): Promise<void> {
    return this.enqueue(async () => {
      if (isActive?.() === false) return
      await this.domain.table('sessions').delete(sessionId)
    })
  }

  get(id: string, workspaceId?: string): FeedbackSignal | undefined {
    for (const [, session] of this.domain.table('sessions').entries()) {
      if (workspaceId !== undefined && session.workspaceId !== workspaceId) continue
      const item = session.items.find(candidate => candidate.id === id)
      if (item === undefined) continue
      return immutableCopy({
        schemaVersion: 2,
        id: item.id,
        observedAt: session.observedAt,
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        messageId: item.messageId,
        feedbackVersion: item.feedbackVersion,
        sourceUpdatedAt: item.sourceUpdatedAt,
        ...(session.generationId === undefined ? {} : { generationId: session.generationId }),
        ...(item.attribution === undefined ? {} : { attribution: item.attribution }),
      })
    }
    return undefined
  }

  list(workspaceId?: string): FeedbackSignal[] {
    return [...this.domain.table('sessions').entries()]
      .filter(([, session]) => workspaceId === undefined || session.workspaceId === workspaceId)
      .flatMap(([, session]) => session.items.map(item => immutableCopy({
        schemaVersion: 2 as const,
        id: item.id,
        observedAt: session.observedAt,
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        messageId: item.messageId,
        feedbackVersion: item.feedbackVersion,
        sourceUpdatedAt: item.sourceUpdatedAt,
        ...(session.generationId === undefined ? {} : { generationId: session.generationId }),
        ...(item.attribution === undefined ? {} : { attribution: item.attribution }),
      })))
      .sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt
        || left.id.localeCompare(right.id))
  }

  summarize(workspaceId: string, selectedGenerationId?: string): FeedbackSignalSummary {
    let all = 0
    let selected = 0
    for (const [, session] of this.domain.table('sessions').entries()) {
      if (session.workspaceId !== workspaceId) continue
      all += session.items.length
      if (session.generationId === selectedGenerationId) selected += session.items.length
    }
    return { all, selected }
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('feedback signal store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

function sessionFreshness(session: StoredSignalSession): number {
  return session.items.reduce(
    (freshest, item) => Math.max(freshest, item.sourceUpdatedAt),
    0,
  )
}

export async function openFeedbackSignalStore(
  facility: DomainFacility,
  options: { maxSessions?: number } = {},
): Promise<FeedbackSignalStore> {
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error('feedback signal maxSessions must be a positive integer')
  }
  return new DomainFeedbackSignalStore(
    await facility.open(feedbackSignalDomainSpec),
    maxSessions,
  )
}

/**
 * Project current negative-with-note feedback into reference-only evolution
 * signals. It never writes the note, cwd, transcript, Prompt, or Tool surface.
 */
export function installFeedbackSignalMonitor(
  ctx: Context,
  signals: FeedbackSignalStore,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
  options: {
    now?: () => number
    attribution?: Pick<DurableFeedbackAttribution, 'resolve'>
      & Partial<Pick<DurableFeedbackAttribution, 'resolveStored'>>
    currentSession?: CurrentFeedbackSessionReconciler
    onSignalsChanged?: (workspaceId: string) => void
    /** Provider-generation fence checked before durable writes and callbacks. */
    isActive?: () => boolean
    onRecoveryReady?: () => void
  } = {},
): FeedbackSignalMonitor {
  const now = options.now ?? Date.now
  let disposed = false
  const isActive = (): boolean => !disposed && (options.isActive?.() ?? true)
  let tail: Promise<void> = Promise.resolve()
  const pendingLive = new Map<string, PendingLiveFeedback>()
  const pendingCold = new Map<string, PendingColdFeedback>()
  const pendingAlpha5 = new Map<string, PendingAlpha5Feedback>()
  const recoveryTimers = createLifecycleTimerScope(
    ctx,
    'dsh-evolve.feedbackSignal.recoveryTimers',
  )
  let recoveryTimerCancel: (() => void) | undefined
  let currentScanDirty = false
  let catalogJob: Promise<void> | undefined
  let catalogRemaining: Set<string> | undefined
  const sessionVersions = new Map<string, number>()
  const changedSession = (sessionId: string): void => {
    sessionVersions.set(sessionId, (sessionVersions.get(sessionId) ?? 0) + 1)
  }
  const notifyRecoveryReady = (): void => {
    if (isActive() && !currentScanDirty && pendingLive.size === 0
      && pendingCold.size === 0 && pendingAlpha5.size === 0) {
      options.onRecoveryReady?.()
    }
  }

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    tail = tail.then(operation).catch((error) => {
      ctx.logger.warn(`dsh-evolve skipped one feedback signal update: ${errorMessage(error)}`)
    })
    return tail
  }

  const project = async (
    sessionId: string,
    row: z.infer<typeof sourceFeedbackRowSchema>,
    stored?: DurableFeedbackStoredSession,
    isCurrent: () => boolean = isActive,
  ): Promise<void> => {
    const mayPublish = (): boolean => isActive() && isCurrent()
    if (!mayPublish()) return
    const workspaceId = await workspaceIdForCwd(ctx, row.session.cwd)
    const identity: SessionIdentity = {
      workspaceId,
      sessionId,
      createdAt: row.session.createdAt,
      ...(row.session.cwd === undefined ? {} : { cwd: row.session.cwd }),
    }
    const generationId = evolution.getSessionGeneration(identity)?.id
    const items: FeedbackSignalSessionInput['items'][number][] = []
    for (const item of row.items) {
      if (!mayPublish()) return
      if (item.rating !== 'negative' || item.note === undefined || item.note.trim() === '') continue
      let attribution: ExactSkillInvocationAttribution | undefined
      try {
        attribution = stored !== undefined && options.attribution?.resolveStored !== undefined
          ? options.attribution.resolveStored(stored, identity.sessionId, String(item.messageId))
          : await options.attribution?.resolve(identity.sessionId, String(item.messageId))
      } catch {
        ctx.logger.warn('dsh-evolve could not attribute one feedback signal; it remains non-causal')
      }
      items.push({
        id: hashJson([workspaceId, identity.sessionId, item.messageId, item.version]),
        messageId: item.messageId,
        feedbackVersion: item.version,
        sourceUpdatedAt: item.updatedAt,
        ...(attribution === undefined ? {} : { attribution }),
      })
    }
    if (!mayPublish()) return
    const projection = {
      observedAt: now(),
      workspaceId,
      sessionId,
      ...(generationId === undefined ? {} : { generationId }),
      items,
    }
    const changed = options.isActive === undefined
      ? await signals.replaceSession(projection)
      : await signals.replaceSession(projection, mayPublish)
    if (mayPublish() && changed !== false) options.onSignalsChanged?.(workspaceId)
  }

  const removeDomain = ctx.on('domain/changed', (change) => {
    if (!isActive() || options.currentSession?.dialect === 'current'
      || change.domain !== 'message_feedback' || change.table !== 'sessions') return
    const sessionId = change.key
    changedSession(sessionId)
    if (change.operation === 'deleted') {
      const pending = { kind: 'deleted' as const, sessionId }
      pendingAlpha5.set(sessionId, pending)
      enqueueAlpha5Projection(pending)
      return
    }

    const parsed = sourceFeedbackRowSchema.safeParse(change.value)
    if (!parsed.success) {
      ctx.logger.warn(`dsh-evolve ignored invalid message feedback row '${sessionId}'`)
      return
    }
    const pending = { kind: 'replaced' as const, sessionId, row: parsed.data }
    pendingAlpha5.set(sessionId, pending)
    enqueueAlpha5Projection(pending)
  })

  const currentEvents = ctx as unknown as {
    on(event: 'session/event', listener: (session: unknown, event: unknown) => void): () => void
    on(event: 'session/disposed', listener: (session: unknown) => void): () => void
    on(event: 'feedback/committed', listener: (inspection: unknown) => void): () => void
  }
  const reconcileLive = async (pending: PendingLiveFeedback): Promise<void> => {
    const sessionId = pending.trigger.sessionId
    let reconciled: CurrentFeedbackReconciliation | undefined
    reconciled = await (
      options.currentSession?.recover ?? options.currentSession?.reconcile
    )?.call(options.currentSession, sessionId)
    if (reconciled === undefined) {
      throw new Error('current feedback Session reconciliation is unavailable')
    }
    if (reconciled.dialect !== 'current') {
      throw new Error('live feedback reconciliation returned the wrong persistence dialect')
    }
    const row = currentFeedbackReconciliationRow(reconciled, pending.trigger)
    await project(sessionId, row, reconciled.stored, () => pendingLive.get(sessionId) === pending)
    if (pendingLive.get(sessionId) === pending) {
      pendingLive.delete(sessionId)
    }
    notifyRecoveryReady()
  }
  const reconcileCold = async (pending: PendingColdFeedback): Promise<void> => {
    const sessionId = pending.trigger.sessionId
    const reconciled = await (
      options.currentSession?.recover ?? options.currentSession?.reconcile
    )?.call(options.currentSession, sessionId)
    if (reconciled === undefined || reconciled.dialect !== 'current') {
      throw new Error('cold feedback reconciliation returned no current persistence cut')
    }
    const row = currentFeedbackReconciliationRow(reconciled, pending.trigger)
    await project(sessionId, row, reconciled.stored, () => pendingCold.get(sessionId) === pending)
    if (pendingCold.get(sessionId) === pending) pendingCold.delete(sessionId)
    const live = pendingLive.get(sessionId)
    if (live === undefined || storedContainsTrigger(reconciled.stored, live.trigger)) {
      pendingLive.delete(sessionId)
    }
    notifyRecoveryReady()
  }
  let retryDirtyFeedback: () => Promise<void>
  const scheduleRecoveryRetry = (): void => {
    if (!isActive() || recoveryTimerCancel !== undefined) return
    recoveryTimerCancel = recoveryTimers.register(
      FEEDBACK_RECOVERY_RETRY_MS,
      () => {
        recoveryTimerCancel = undefined
        void enqueue(retryDirtyFeedback)
        if (currentScanDirty) void startCatalogRecovery().catch(() => undefined)
      },
      () => { recoveryTimerCancel = undefined },
    )
  }
  const enqueueLiveReconciliation = (pending: PendingLiveFeedback): void => {
    void enqueue(async () => {
      if (!isActive() || pendingLive.get(pending.trigger.sessionId) !== pending) return
      try {
        await reconcileLive(pending)
      } catch (error) {
        scheduleRecoveryRetry()
        throw error
      }
    })
  }
  const enqueueColdReconciliation = (pending: PendingColdFeedback): void => {
    void enqueue(async () => {
      if (!isActive() || pendingCold.get(pending.trigger.sessionId) !== pending) return
      try {
        await reconcileCold(pending)
      } catch (error) {
        scheduleRecoveryRetry()
        throw error
      }
    })
  }
  function enqueueAlpha5Projection(pending: PendingAlpha5Feedback): void {
    void enqueue(async () => {
      if (!isActive() || pendingAlpha5.get(pending.sessionId) !== pending) return
      try {
        if (pending.kind === 'deleted') await signals.removeSession(pending.sessionId, isActive)
        else await project(pending.sessionId, pending.row)
        if (pendingAlpha5.get(pending.sessionId) === pending) {
          pendingAlpha5.delete(pending.sessionId)
        }
        notifyRecoveryReady()
      } catch (error) {
        scheduleRecoveryRetry()
        throw error
      }
    })
  }
  const removeLive = currentEvents.on('session/event', (session, event) => {
    if (!isActive() || options.currentSession?.dialect === 'alpha5') return
    const trigger = currentFeedbackTrigger(session, event)
    if (trigger === undefined) return
    changedSession(trigger.sessionId)
    const pending = { session, trigger }
    pendingLive.set(trigger.sessionId, pending)
    enqueueLiveReconciliation(pending)
  })
  const removeDisposed = currentEvents.on('session/disposed', (session) => {
    if (!isActive()) return
    const sessionId = currentLiveSessionId(session)
    if (sessionId === undefined) return
    const pending = pendingLive.get(sessionId)
    if (pending === undefined || pending.session !== session) return
    // Persistence drains this notification asynchronously. Attempt once, but
    // retain a failed trigger for a later activation scan instead of claiming
    // that disposal itself proved durability.
    enqueueLiveReconciliation(pending)
  })
  const removeCold = currentEvents.on('feedback/committed', (inspection) => {
    if (!isActive() || options.currentSession?.dialect === 'alpha5') return
    let captured: unknown
    try {
      // The current MessageFeedback service lends this prefix only for the
      // synchronous observer call. Never enqueue the borrowed object itself.
      captured = structuredClone(inspection)
    } catch {
      ctx.logger.warn('dsh-evolve ignored unclonable committed message feedback')
      return
    }
    let trigger: CurrentFeedbackTrigger | undefined
    try {
      trigger = currentFeedbackTriggerFromStored(currentFeedbackStoredSession(captured))
    } catch {
      ctx.logger.warn('dsh-evolve ignored malformed committed message feedback')
      return
    }
    if (trigger === undefined) return
    changedSession(trigger.sessionId)
    const pending = { trigger }
    pendingCold.set(trigger.sessionId, pending)
    enqueueColdReconciliation(pending)
  })

  const reconcileCurrentCatalog = async (): Promise<void> => {
    const sessionIds = catalogRemaining === undefined
      ? await options.currentSession?.listSessionIds?.()
      : [...catalogRemaining]
    if (sessionIds === undefined) {
      currentScanDirty = false
      return
    }
    const unique = new Set<string>()
    for (const sessionId of sessionIds) {
      if (typeof sessionId !== 'string' || sessionId.length === 0
        || unique.has(sessionId)) {
        throw new Error('current feedback Session listing is malformed')
      }
      unique.add(sessionId)
    }
    catalogRemaining = unique
    const failures: unknown[] = []
    for (const sessionId of unique) {
      if (!isActive()) return
      // Enqueue one Session at a time. Notifications received during its
      // physical read run before the next catalog entry.
      const operation = tail.then(async () => {
        if (!isActive()) return
        const version = sessionVersions.get(sessionId) ?? 0
        try {
          const reconciled = await (
            options.currentSession?.recover ?? options.currentSession?.reconcile
          )?.call(options.currentSession, sessionId)
          if (reconciled === undefined) throw new Error('feedback recovery provider is unavailable')
          const trigger = reconciled.dialect === 'current'
            ? currentFeedbackTriggerFromStored(reconciled.stored)
            : undefined
          // A current Session with no feedback cannot prove provenance for a
          // pre-existing alpha sidecar row, so leave it untouched.
          if (reconciled.dialect === 'current' && trigger === undefined) {
            catalogRemaining?.delete(sessionId)
            return
          }
          await project(
            sessionId,
            reconciled.dialect === 'current'
              ? currentFeedbackReconciliationRow(reconciled)
              : alpha5FeedbackReconciliationRow(reconciled, sessionId),
            reconciled.stored,
            () => (sessionVersions.get(sessionId) ?? 0) === version,
          )
          catalogRemaining?.delete(sessionId)
          const pending = pendingLive.get(sessionId)
          if (pending === undefined || storedContainsTrigger(reconciled.stored, pending.trigger)) {
            pendingLive.delete(sessionId)
          }
        } catch (error) {
          failures.push(error)
          ctx.logger.warn(
            `dsh-evolve skipped current feedback recovery for Session '${sessionId}': ${errorMessage(error)}`,
          )
        }
      })
      tail = operation.catch(error => {
        failures.push(error)
      })
      await tail
    }
    if (failures.length > 0) {
      scheduleRecoveryRetry()
      throw new AggregateError(failures, 'current feedback recovery pass was incomplete')
    }
    currentScanDirty = false
    catalogRemaining = undefined
    notifyRecoveryReady()
  }
  const startCatalogRecovery = (): Promise<void> => {
    if (catalogJob !== undefined) return catalogJob
    currentScanDirty = true
    const operation = reconcileCurrentCatalog().catch(error => {
      scheduleRecoveryRetry()
      throw error
    })
    catalogJob = operation
    const clear = (): void => { if (catalogJob === operation) catalogJob = undefined }
    void operation.then(clear, clear)
    return operation
  }
  retryDirtyFeedback = async (): Promise<void> => {
    const failures: unknown[] = []
    for (const pending of [...pendingLive.values()]) {
      if (!isActive() || pendingLive.get(pending.trigger.sessionId) !== pending) continue
      try {
        await reconcileLive(pending)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const pending of [...pendingCold.values()]) {
      if (!isActive() || pendingCold.get(pending.trigger.sessionId) !== pending) continue
      try {
        await reconcileCold(pending)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const pending of [...pendingAlpha5.values()]) {
      if (!isActive() || pendingAlpha5.get(pending.sessionId) !== pending) continue
      try {
        if (pending.kind === 'deleted') await signals.removeSession(pending.sessionId, isActive)
        else await project(pending.sessionId, pending.row)
        if (pendingAlpha5.get(pending.sessionId) === pending) {
          pendingAlpha5.delete(pending.sessionId)
        }
        notifyRecoveryReady()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      scheduleRecoveryRetry()
      throw new AggregateError(failures, 'feedback recovery retry was incomplete')
    }
  }

  return {
    async flush() {
      let pending: Promise<void>
      do {
        pending = tail
        await pending
      } while (pending !== tail)
    },
    reconcileCurrent() {
      return startCatalogRecovery()
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        recoveryTimerCancel?.()
        recoveryTimerCancel = undefined
        removeCold()
        removeDisposed()
        removeLive()
        removeDomain()
        await Promise.resolve(recoveryTimers.dispose())
      }
      await Promise.allSettled([tail, ...(catalogJob === undefined ? [] : [catalogJob])])
      pendingAlpha5.clear()
      pendingCold.clear()
      pendingLive.clear()
    },
  }
}

interface PendingLiveFeedback {
  readonly session: unknown
  readonly trigger: CurrentFeedbackTrigger
}

interface PendingColdFeedback {
  readonly trigger: CurrentFeedbackTrigger
}

type PendingAlpha5Feedback =
  | { readonly kind: 'deleted'; readonly sessionId: string }
  | {
      readonly kind: 'replaced'
      readonly sessionId: string
      readonly row: z.infer<typeof sourceFeedbackRowSchema>
    }

function currentLiveSessionId(candidate: unknown): string | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined
  try {
    const id = Reflect.get(candidate, 'id')
    return typeof id === 'string' && id.length > 0 ? id : undefined
  } catch {
    return undefined
  }
}

interface CurrentFeedbackTrigger {
  readonly sessionId: string
  readonly event: Record<string, unknown>
  readonly seq: number
}

function currentFeedbackTrigger(session: unknown, candidate: unknown): CurrentFeedbackTrigger | undefined {
  if (session === null || typeof session !== 'object') return undefined
  const sessionId = String((session as { readonly id?: unknown }).id ?? '')
  const trigger = currentFeedbackEvent(candidate, sessionId)
  if (trigger === undefined) return undefined
  const eventAt = (session as { readonly eventAt?: unknown }).eventAt
  if (typeof eventAt !== 'function') return undefined
  try {
    if (Reflect.apply(eventAt, session, [trigger.seq]) !== candidate) return undefined
  } catch {
    return undefined
  }
  return trigger
}

function currentFeedbackTriggerFromStored(
  stored: DurableFeedbackStoredSession,
): CurrentFeedbackTrigger | undefined {
  for (let index = stored.events.length - 1; index >= 0; index -= 1) {
    const candidate = stored.events[index] as unknown as { readonly type?: unknown }
    if (candidate?.type !== 'feedback/message-put'
      && candidate?.type !== 'feedback/message-delete') continue
    const trigger = currentFeedbackEvent(candidate, String(stored.meta.id))
    if (trigger === undefined) {
      throw new Error('current message feedback trigger is malformed')
    }
    return trigger
  }
  return undefined
}

function storedContainsTrigger(
  stored: DurableFeedbackStoredSession,
  trigger: CurrentFeedbackTrigger,
): boolean {
  return stored.events.some(event => Number(event.seq) === trigger.seq
    && isDeepStrictEqual(event, trigger.event))
}

function currentFeedbackEvent(
  candidate: unknown,
  expectedSessionId: string,
): CurrentFeedbackTrigger | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  const event = candidate as Record<string, unknown>
  if (event.type !== 'feedback/message-put' && event.type !== 'feedback/message-delete') return undefined
  if (!isNonNegativeSafeInteger(event.seq)) return undefined
  const parsed = event.type === 'feedback/message-put'
    ? currentFeedbackPutSchema.safeParse(event.data)
    : currentFeedbackDeleteSchema.safeParse(event.data)
  if (!parsed.success || parsed.data.sessionId !== expectedSessionId) return undefined
  let detached: Record<string, unknown>
  try {
    detached = structuredClone(event)
  } catch {
    return undefined
  }
  return {
    sessionId: expectedSessionId,
    event: detached,
    seq: event.seq,
  }
}

function currentFeedbackStoredSession(candidate: unknown): DurableFeedbackStoredSession {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('committed message feedback has no Session inspection')
  }
  const inspection = candidate as {
    readonly meta?: unknown
    readonly inheritedEventCount?: unknown
    readonly events?: unknown
  }
  if (inspection.meta === null || typeof inspection.meta !== 'object' || Array.isArray(inspection.meta)
    || !isNonNegativeSafeInteger(inspection.inheritedEventCount)
    || !Array.isArray(inspection.events)) {
    throw new Error('committed message feedback has a malformed Session inspection')
  }
  const meta = inspection.meta as { readonly id?: unknown; readonly createdAt?: unknown; readonly cwd?: unknown }
  if (typeof meta.id !== 'string' || meta.id.length === 0
    || !isNonNegativeSafeInteger(meta.createdAt)
    || (meta.cwd !== undefined && typeof meta.cwd !== 'string')) {
    throw new Error('committed message feedback has malformed Session metadata')
  }
  return {
    meta: structuredClone(inspection.meta) as DurableFeedbackStoredSession['meta'],
    inheritedEventCount: inspection.inheritedEventCount,
    fromSeq: 0,
    events: structuredClone(inspection.events) as DurableFeedbackStoredSession['events'],
  }
}

function currentFeedbackRow(
  stored: DurableFeedbackStoredSession,
  trigger?: CurrentFeedbackTrigger,
): z.infer<typeof sourceFeedbackRowSchema> {
  const meta = stored.meta as { readonly id?: unknown; readonly createdAt?: unknown; readonly cwd?: unknown }
  const sessionId = String(meta.id)
  if ((trigger !== undefined && sessionId !== trigger.sessionId)
    || !isNonNegativeSafeInteger(meta.createdAt)
    || (meta.cwd !== undefined && typeof meta.cwd !== 'string')) {
    throw new Error('current message feedback has malformed Session metadata')
  }
  if (trigger !== undefined) {
    const exactTrigger = stored.events.find(event => Number(event.seq) === trigger.seq)
    if (!isDeepStrictEqual(exactTrigger, trigger.event)) {
      throw new Error('current message feedback trigger is not in the durable Session prefix')
    }
  }
  const items = new Map<string, z.infer<typeof sourceFeedbackItemSchema>>()
  for (const event of stored.events as unknown as ReadonlyArray<{
    readonly type?: unknown
    readonly data?: unknown
  }>) {
    if (event.type === 'feedback/message-put') {
      const parsed = currentFeedbackPutSchema.safeParse(event.data)
      if (!parsed.success) throw new Error('current message feedback put event is malformed')
      if (parsed.data.sessionId === sessionId) {
        items.set(parsed.data.item.messageId, parsed.data.item)
      }
    } else if (event.type === 'feedback/message-delete') {
      const parsed = currentFeedbackDeleteSchema.safeParse(event.data)
      if (!parsed.success) throw new Error('current message feedback delete event is malformed')
      if (parsed.data.sessionId === sessionId) items.delete(parsed.data.messageId)
    }
  }
  return sourceFeedbackRowSchema.parse({
    session: {
      createdAt: meta.createdAt,
      ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
    },
    items: [...items.values()],
  })
}

/** Fold the exact current-DSH feedback state carried by one physical prefix. */
export function currentMessageFeedbackItemsFromStoredSession(
  stored: DurableFeedbackStoredSession,
  sessionId: string,
): readonly DurableMessageFeedbackItem[] {
  if (String(stored.meta.id) !== sessionId) {
    throw new Error('current message feedback prefix belongs to the wrong Session')
  }
  return structuredClone(currentFeedbackRow(stored).items)
}

function currentFeedbackReconciliationRow(
  reconciled: CurrentFeedbackReconciliation,
  trigger?: CurrentFeedbackTrigger,
): z.infer<typeof sourceFeedbackRowSchema> {
  const row = currentFeedbackRow(reconciled.stored, trigger)
  const listedItems = z.array(sourceFeedbackItemSchema).safeParse(reconciled.listedItems)
  if (!listedItems.success || !isDeepStrictEqual(row.items, listedItems.data)) {
    throw new Error('current message feedback list and durable Session prefix disagree')
  }
  return row
}

function alpha5FeedbackReconciliationRow(
  reconciled: CurrentFeedbackReconciliation,
  sessionId: string,
): z.infer<typeof sourceFeedbackRowSchema> {
  const meta = reconciled.stored.meta as {
    readonly id?: unknown
    readonly createdAt?: unknown
    readonly cwd?: unknown
  }
  const source = sourceFeedbackRowSchema.safeParse(reconciled.sourceRow)
  if (!source.success
    || String(meta.id) !== sessionId
    || !isNonNegativeSafeInteger(meta.createdAt)
    || (meta.cwd !== undefined && typeof meta.cwd !== 'string')
    || source.data.session.createdAt !== meta.createdAt
    || source.data.session.cwd !== meta.cwd
    || !isDeepStrictEqual(source.data.items, reconciled.listedItems)) {
    throw new Error('alpha.5 message feedback has malformed Session metadata')
  }
  return source.data
}

function isNonNegativeSafeInteger(candidate: unknown): candidate is number {
  return typeof candidate === 'number'
    && Number.isSafeInteger(candidate)
    && candidate >= 0
    && !Object.is(candidate, -0)
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value))
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
