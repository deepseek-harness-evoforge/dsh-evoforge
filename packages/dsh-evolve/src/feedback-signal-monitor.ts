import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { EvolutionStore, SessionIdentity } from './generation-store.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const DEFAULT_MAX_SESSIONS = 1_000
const MAX_SIGNALS_PER_SESSION = 100
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const sourceFeedbackItemSchema = z.object({
  messageId: z.string().min(1).max(512),
  rating: z.enum(['positive', 'negative']),
  note: z.string().optional(),
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

const storedSignalItemSchema = z.strictObject({
  id: hashSchema,
  messageId: z.string().min(1).max(512),
  feedbackVersion: z.uuid(),
  sourceUpdatedAt: nonNegativeSafeInteger,
})

const storedSignalSessionSchema = z.strictObject({
  schemaVersion: z.literal(2),
  observedAt: nonNegativeSafeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
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
}

export interface FeedbackSignalSummary {
  readonly all: number
  readonly selected: number
}

interface FeedbackSignalSessionInput {
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly generationId?: string | undefined
  readonly items: readonly z.infer<typeof storedSignalItemSchema>[]
}

export interface FeedbackSignalStore {
  replaceSession(input: FeedbackSignalSessionInput): Promise<void>
  removeSession(sessionId: string): Promise<void>
  get(id: string, workspaceId?: string): FeedbackSignal | undefined
  list(workspaceId?: string): FeedbackSignal[]
  summarize(workspaceId: string, selectedGenerationId?: string): FeedbackSignalSummary
  close(): Promise<void>
}

export interface FeedbackSignalMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
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

  replaceSession(input: FeedbackSignalSessionInput): Promise<void> {
    return this.enqueue(async () => {
      const table = this.domain.table('sessions')
      if (input.items.length === 0) {
        await table.delete(input.sessionId)
        return
      }
      const session = immutableCopy(storedSignalSessionSchema.parse({
        schemaVersion: 2,
        ...input,
        items: [...input.items]
          .sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt
            || left.id.localeCompare(right.id))
          .slice(0, MAX_SIGNALS_PER_SESSION)
          .sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt
            || left.id.localeCompare(right.id)),
      }))
      await table.put(session.sessionId, session)
      if (table.size <= this.maxSessions) return
      const expired = [...table.entries()]
        .sort((left, right) => left[1].observedAt - right[1].observedAt
          || left[0].localeCompare(right[0]))
        .slice(0, table.size - this.maxSessions)
      for (const [sessionId] of expired) await table.delete(sessionId)
    })
  }

  removeSession(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
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

  private enqueue(operation: () => Promise<void>): Promise<void> {
    if (this.closing !== undefined) return Promise.reject(new Error('feedback signal store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
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
  options: { now?: () => number } = {},
): FeedbackSignalMonitor {
  const now = options.now ?? Date.now
  let disposed = false
  let tail: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<void>) => {
    tail = tail.then(operation).catch((error) => {
      ctx.logger.warn(`dsh-evolve skipped one feedback signal update: ${errorMessage(error)}`)
    })
  }

  const remove = ctx.on('domain/changed', (change) => {
    if (disposed || change.domain !== 'message_feedback' || change.table !== 'sessions') return
    const sessionId = change.key
    if (change.operation === 'deleted') {
      enqueue(() => signals.removeSession(sessionId))
      return
    }

    const parsed = sourceFeedbackRowSchema.safeParse(change.value)
    if (!parsed.success) {
      ctx.logger.warn(`dsh-evolve ignored invalid message feedback row '${sessionId}'`)
      return
    }
    enqueue(async () => {
      const workspaceId = await workspaceIdForCwd(ctx, parsed.data.session.cwd)
      const identity: SessionIdentity = {
        workspaceId,
        sessionId,
        createdAt: parsed.data.session.createdAt,
        ...(parsed.data.session.cwd === undefined ? {} : { cwd: parsed.data.session.cwd }),
      }
      const generationId = evolution.getSessionGeneration(identity)?.id
      const items = parsed.data.items.flatMap((item) => {
        if (item.rating !== 'negative' || item.note === undefined || item.note.trim() === '') return []
        return [{
          id: hashJson([workspaceId, identity.sessionId, item.messageId, item.version]),
          messageId: item.messageId,
          feedbackVersion: item.version,
          sourceUpdatedAt: item.updatedAt,
        }]
      })
      await signals.replaceSession({
        observedAt: now(),
        workspaceId,
        sessionId,
        ...(generationId === undefined ? {} : { generationId }),
        items,
      })
    })
  })

  return {
    async flush() {
      await tail
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        remove()
      }
      await tail
    },
  }
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
