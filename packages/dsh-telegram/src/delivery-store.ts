import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  beginDelivery,
  classifySendFailure,
  recoverDelivery,
  type DeliveryStatus,
  type SendFailure,
} from './delivery-state.js'

const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('turn'), turn: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal('command'),
    updateId: z.number().int().nonnegative(),
    text: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    kind: z.literal('notice'),
    noticeId: z.string().regex(/^[a-f0-9]{64}$/u),
    text: z.string().min(1).max(4_096),
  }),
])

const deliverySchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  replyToMessageId: z.number().int().positive().optional(),
  status: z.enum(['prepared', 'sending', 'retrying', 'delivered', 'uncertain', 'failed']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative().optional(),
  telegramMessageId: z.number().int().positive().optional(),
  error: z.string().min(1).optional(),
})

// Read compatibility for pre-Gateway domains; new command admission lives in
// evoforge_gateway and this value is never advanced by the Adapter.
const checkpointSchema = z.strictObject({
  acceptedCommandUpdateId: z.number().int().nonnegative().optional(),
})

export type TelegramDeliveryRecord = z.infer<typeof deliverySchema>
type TelegramCheckpoint = z.infer<typeof checkpointSchema>

const telegramDomainSpec = defineDomain({
  name: 'evoforge_telegram',
  version: 1,
  global: {
    schema: checkpointSchema,
    initial: {} as TelegramCheckpoint,
  },
  tables: {
    deliveries: domainTable<string, TelegramDeliveryRecord>(deliverySchema),
  },
})

type TelegramDomain = Domain<typeof telegramDomainSpec>
const DEFAULT_MAX_RECORDS = 10_000
const TERMINAL_STATUSES = new Set<DeliveryStatus>(['delivered', 'uncertain', 'failed'])

export interface TelegramDeliveryStoreOptions {
  /** Hard journal bound. Live deliveries are never pruned. */
  readonly maxRecords?: number
}

export interface PrepareTurnInput {
  readonly now: number
  readonly replyToMessageId?: number
  readonly sessionId: string
  readonly turn: number
}

export interface PrepareCommandInput {
  readonly now: number
  readonly replyToMessageId?: number
  readonly sessionId: string
  readonly text: string
  readonly updateId: number
}

export interface PrepareNoticeInput {
  readonly id: string
  readonly now: number
  readonly sessionId: string
  readonly text: string
}

export interface TelegramDeliveryStore {
  prepareTurn(input: PrepareTurnInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }>
  prepareCommand(input: PrepareCommandInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }>
  prepareNotice(input: PrepareNoticeInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }>
  get(id: string): TelegramDeliveryRecord | undefined
  list(statuses?: readonly DeliveryStatus[]): TelegramDeliveryRecord[]
  markSending(id: string, now: number): Promise<TelegramDeliveryRecord>
  markDelivered(id: string, telegramMessageId: number, now: number): Promise<TelegramDeliveryRecord>
  markFailure(id: string, failure: SendFailure, now: number, maxAttempts: number): Promise<TelegramDeliveryRecord>
  markLocallyFailed(id: string, error: string, now: number): Promise<TelegramDeliveryRecord>
  recoverInflight(now: number): Promise<number>
  close(): Promise<void>
}

class DomainTelegramDeliveryStore implements TelegramDeliveryStore {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: TelegramDomain,
    private readonly maxRecords: number,
  ) {}

  prepareTurn(input: PrepareTurnInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }> {
    return this.write(() => this.prepare({
      now: input.now,
      sessionId: input.sessionId,
      source: { kind: 'turn', turn: input.turn },
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
    }))
  }

  prepareCommand(input: PrepareCommandInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }> {
    return this.write(() => this.prepare({
      now: input.now,
      sessionId: input.sessionId,
      source: { kind: 'command', updateId: input.updateId, text: input.text },
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
    }))
  }

  prepareNotice(input: PrepareNoticeInput): Promise<{ created: boolean; record: TelegramDeliveryRecord }> {
    return this.write(() => this.prepare({
      now: input.now,
      sessionId: input.sessionId,
      source: { kind: 'notice', noticeId: input.id, text: input.text },
    }))
  }

  get(id: string): TelegramDeliveryRecord | undefined {
    const record = this.domain.table('deliveries').get(id)
    return record === undefined ? undefined : copy(record)
  }

  list(statuses?: readonly DeliveryStatus[]): TelegramDeliveryRecord[] {
    const allowed = statuses === undefined ? undefined : new Set(statuses)
    return [...this.domain.table('deliveries').entries()]
      .map(([, record]) => record)
      .filter(record => allowed === undefined || allowed.has(record.status))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copy)
  }

  markSending(id: string, now: number): Promise<TelegramDeliveryRecord> {
    return this.update(id, current => deliverySchema.parse(beginDelivery(current, now)))
  }

  markDelivered(id: string, telegramMessageId: number, now: number): Promise<TelegramDeliveryRecord> {
    exactTime(now)
    if (!Number.isSafeInteger(telegramMessageId) || telegramMessageId < 1) {
      return Promise.reject(new Error('telegramMessageId must be a positive safe integer'))
    }
    return this.update(id, (current) => {
      if (current.status !== 'sending') throw new Error(`cannot deliver Telegram record from ${current.status}`)
      const {
        nextAttemptAt: _nextAttemptAt,
        error: _error,
        telegramMessageId: _telegramMessageId,
        ...rest
      } = current
      return deliverySchema.parse({
        ...rest,
        status: 'delivered',
        updatedAt: now,
        telegramMessageId,
      })
    })
  }

  markFailure(id: string, failure: SendFailure, now: number, maxAttempts: number): Promise<TelegramDeliveryRecord> {
    return this.update(id, current => deliverySchema.parse(
      classifySendFailure(failure, current, now, maxAttempts),
    ))
  }

  markLocallyFailed(id: string, error: string, now: number): Promise<TelegramDeliveryRecord> {
    exactTime(now)
    if (error.length === 0) return Promise.reject(new Error('local failure must be non-empty'))
    return this.update(id, (current) => {
      if (current.status !== 'prepared' && current.status !== 'retrying') {
        throw new Error(`cannot fail Telegram record locally from ${current.status}`)
      }
      const { nextAttemptAt: _nextAttemptAt, ...rest } = current
      return deliverySchema.parse({ ...rest, status: 'failed', updatedAt: now, error })
    })
  }

  recoverInflight(now: number): Promise<number> {
    return this.write(async () => {
      exactTime(now)
      const table = this.domain.table('deliveries')
      let recovered = 0
      for (const [id, record] of table.entries()) {
        if (record.status !== 'sending') continue
        await table.put(id, deliverySchema.parse(recoverDelivery(record, now)))
        recovered += 1
      }
      await pruneOldest(
        table,
        this.maxRecords,
        record => record.createdAt,
        record => TERMINAL_STATUSES.has(record.status),
      )
      return recovered
    })
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private async prepare(input: {
    now: number
    sessionId: string
    source: TelegramDeliveryRecord['source']
    replyToMessageId?: number
  }): Promise<{ created: boolean; record: TelegramDeliveryRecord }> {
    const id = deliveryId(input.sessionId, input.source)
    const table = this.domain.table('deliveries')
    const existing = table.get(id)
    if (existing !== undefined) return { created: false, record: copy(existing) }
    await pruneOldest(
      table,
      this.maxRecords - 1,
      record => record.createdAt,
      record => TERMINAL_STATUSES.has(record.status),
    )
    const record = deliverySchema.parse({
      id,
      schemaVersion: 1,
      sessionId: input.sessionId,
      source: input.source,
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
      status: 'prepared',
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    await table.put(id, record)
    return { created: true, record: copy(record) }
  }

  private update(
    id: string,
    transform: (current: TelegramDeliveryRecord) => TelegramDeliveryRecord,
  ): Promise<TelegramDeliveryRecord> {
    return this.write(async () => {
      const table = this.domain.table('deliveries')
      const record = await table.update(id, current => deliverySchema.parse(transform(current)))
      if (TERMINAL_STATUSES.has(record.status)) {
        await pruneOldest(
          table,
          this.maxRecords,
          candidate => candidate.createdAt,
          candidate => TERMINAL_STATUSES.has(candidate.status),
        )
      }
      return copy(record)
    })
  }

  private write<T>(job: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('Telegram delivery store is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openTelegramDeliveryStore(
  facility: DomainFacility,
  options: TelegramDeliveryStoreOptions = {},
): Promise<TelegramDeliveryStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('Telegram delivery store maxRecords must be a positive safe integer')
  }
  return new DomainTelegramDeliveryStore(await facility.open(telegramDomainSpec), maxRecords)
}

async function pruneOldest<K, V>(
  table: { size: number; entries(): IterableIterator<[K, V]>; delete(key: K): Promise<boolean> },
  maxSize: number,
  timestamp: (value: V) => number,
  eligible: (value: V) => boolean = () => true,
): Promise<void> {
  if (table.size <= maxSize) return
  const candidates = [...table.entries()]
    .filter(([, value]) => eligible(value))
    .sort((left, right) => timestamp(left[1]) - timestamp(right[1]))
  for (const [key] of candidates) {
    if (table.size <= maxSize) return
    await table.delete(key)
  }
}

function deliveryId(sessionId: string, source: TelegramDeliveryRecord['source']): string {
  const suffix = source.kind === 'turn'
    ? `turn:${source.turn}`
    : source.kind === 'command'
      ? `command:${source.updateId}`
      : `notice:${source.noticeId}`
  return createHash('sha256').update(`${sessionId}\0${suffix}`).digest('hex')
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('time must be a non-negative safe integer')
  return value
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
