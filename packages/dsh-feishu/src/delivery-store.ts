import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  beginFeishuDelivery,
  classifyFeishuSendFailure,
  recoverFeishuDelivery,
  type FeishuDeliveryStatus,
  type FeishuSendFailure,
} from './delivery-state.js'

const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('turn'),
    turn: z.number().int().positive(),
    text: z.string().min(1).max(30_000),
  }),
  z.strictObject({
    kind: z.literal('response'),
    eventId: z.string().min(1).max(1_024),
    text: z.string().min(1).max(30_000),
  }),
  z.strictObject({
    kind: z.literal('notice'),
    noticeId: z.string().regex(/^[a-f0-9]{64}$/u),
    text: z.string().min(1).max(30_000),
  }),
])

const deliverySchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  routeId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(512),
  chatId: z.string().min(1).max(512),
  threadId: z.string().min(1).max(512).optional(),
  replyToMessageId: z.string().min(1).max(512).optional(),
  source: sourceSchema,
  status: z.enum(['prepared', 'sending', 'retrying', 'delivered', 'uncertain', 'failed']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative().optional(),
  feishuMessageId: z.string().min(1).max(512).optional(),
  error: z.string().min(1).optional(),
})

export type FeishuDeliveryRecord = z.infer<typeof deliverySchema>

const feishuDomainSpec = defineDomain({
  name: 'evoforge_feishu',
  version: 1,
  global: { schema: z.strictObject({}), initial: {} },
  tables: { deliveries: domainTable<string, FeishuDeliveryRecord>(deliverySchema) },
})

type FeishuDomain = Domain<typeof feishuDomainSpec>
const DEFAULT_MAX_RECORDS = 10_000
const TERMINAL = new Set<FeishuDeliveryStatus>(['delivered', 'uncertain', 'failed'])

interface BasePrepareInput {
  readonly routeId: string
  readonly sessionId: string
  readonly chatId: string
  readonly threadId?: string
  readonly replyToMessageId?: string
  readonly now: number
}

export interface PrepareFeishuTurnInput extends BasePrepareInput {
  readonly turn: number
  readonly text: string
}

export interface PrepareFeishuResponseInput extends BasePrepareInput {
  readonly eventId: string
  readonly text: string
}

export interface PrepareFeishuNoticeInput extends BasePrepareInput {
  readonly noticeId: string
  readonly text: string
}

export interface FeishuDeliveryStore {
  prepareTurn(input: PrepareFeishuTurnInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }>
  prepareResponse(input: PrepareFeishuResponseInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }>
  prepareNotice(input: PrepareFeishuNoticeInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }>
  get(id: string): FeishuDeliveryRecord | undefined
  list(statuses?: readonly FeishuDeliveryStatus[]): FeishuDeliveryRecord[]
  markSending(id: string, now: number): Promise<FeishuDeliveryRecord>
  markDelivered(id: string, messageId: string, now: number): Promise<FeishuDeliveryRecord>
  markFailure(
    id: string,
    failure: FeishuSendFailure,
    now: number,
    maxAttempts: number,
    maxRetryAfterMs: number,
  ): Promise<FeishuDeliveryRecord>
  recoverInflight(now: number): Promise<number>
  close(): Promise<void>
}

class DomainFeishuDeliveryStore implements FeishuDeliveryStore {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(private readonly domain: FeishuDomain, private readonly maxRecords: number) {}

  prepareTurn(input: PrepareFeishuTurnInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }> {
    return this.write(() => this.prepare(input, { kind: 'turn', turn: input.turn, text: input.text }))
  }

  prepareResponse(input: PrepareFeishuResponseInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }> {
    return this.write(() => this.prepare(input, { kind: 'response', eventId: input.eventId, text: input.text }))
  }

  prepareNotice(input: PrepareFeishuNoticeInput): Promise<{ created: boolean; record: FeishuDeliveryRecord }> {
    return this.write(() => this.prepare(input, { kind: 'notice', noticeId: input.noticeId, text: input.text }))
  }

  get(id: string): FeishuDeliveryRecord | undefined {
    const value = this.domain.table('deliveries').get(id)
    return value === undefined ? undefined : structuredClone(value)
  }

  list(statuses?: readonly FeishuDeliveryStatus[]): FeishuDeliveryRecord[] {
    const allowed = statuses === undefined ? undefined : new Set(statuses)
    return [...this.domain.table('deliveries').entries()]
      .map(([, value]) => value)
      .filter(value => allowed === undefined || allowed.has(value.status))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(value => structuredClone(value))
  }

  markSending(id: string, now: number): Promise<FeishuDeliveryRecord> {
    return this.update(id, value => deliverySchema.parse(beginFeishuDelivery(value, now)))
  }

  markDelivered(id: string, messageId: string, now: number): Promise<FeishuDeliveryRecord> {
    exactText(messageId, 'messageId')
    exactTime(now)
    return this.update(id, (current) => {
      if (current.status !== 'sending') throw new Error(`cannot deliver Feishu record from ${current.status}`)
      const { nextAttemptAt: _next, error: _error, feishuMessageId: _message, ...rest } = current
      return deliverySchema.parse({
        ...rest,
        status: 'delivered',
        updatedAt: now,
        feishuMessageId: messageId,
      })
    })
  }

  markFailure(
    id: string,
    failure: FeishuSendFailure,
    now: number,
    maxAttempts: number,
    maxRetryAfterMs: number,
  ): Promise<FeishuDeliveryRecord> {
    return this.update(id, value => deliverySchema.parse(
      classifyFeishuSendFailure(failure, value, now, maxAttempts, maxRetryAfterMs),
    ))
  }

  recoverInflight(now: number): Promise<number> {
    return this.write(async () => {
      exactTime(now)
      const table = this.domain.table('deliveries')
      let recovered = 0
      for (const [id, record] of table.entries()) {
        if (record.status !== 'sending') continue
        await table.put(id, deliverySchema.parse(recoverFeishuDelivery(record, now)))
        recovered += 1
      }
      await prune(table, this.maxRecords)
      return recovered
    })
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private async prepare(
    input: BasePrepareInput,
    source: FeishuDeliveryRecord['source'],
  ): Promise<{ created: boolean; record: FeishuDeliveryRecord }> {
    const id = deliveryId(input.routeId, input.sessionId, source)
    const table = this.domain.table('deliveries')
    const existing = table.get(id)
    if (existing !== undefined) return { created: false, record: structuredClone(existing) }
    await prune(table, this.maxRecords - 1)
    const record = deliverySchema.parse({
      id,
      schemaVersion: 1,
      routeId: input.routeId,
      sessionId: input.sessionId,
      chatId: input.chatId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
      source,
      status: 'prepared',
      attempts: 0,
      createdAt: exactTime(input.now),
      updatedAt: input.now,
    })
    await table.put(id, record)
    return { created: true, record: structuredClone(record) }
  }

  private update(
    id: string,
    transform: (value: FeishuDeliveryRecord) => FeishuDeliveryRecord,
  ): Promise<FeishuDeliveryRecord> {
    return this.write(async () => {
      const table = this.domain.table('deliveries')
      const value = await table.update(id, current => deliverySchema.parse(transform(current)))
      if (TERMINAL.has(value.status)) await prune(table, this.maxRecords)
      return structuredClone(value)
    })
  }

  private write<T>(job: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('Feishu delivery store is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openFeishuDeliveryStore(
  facility: DomainFacility,
  options: { readonly maxRecords?: number } = {},
): Promise<FeishuDeliveryStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
    throw new Error('Feishu delivery store maxRecords must be from 1 to 100000')
  }
  return new DomainFeishuDeliveryStore(await facility.open(feishuDomainSpec), maxRecords)
}

async function prune(
  table: {
    size: number
    entries(): IterableIterator<[string, FeishuDeliveryRecord]>
    delete(key: string): Promise<boolean>
  },
  maxSize: number,
): Promise<void> {
  if (table.size <= maxSize) return
  const candidates = [...table.entries()]
    .filter(([, value]) => TERMINAL.has(value.status))
    .sort((left, right) => left[1].createdAt - right[1].createdAt)
  for (const [id] of candidates) {
    if (table.size <= maxSize) return
    await table.delete(id)
  }
  if (table.size > maxSize) throw new Error('Feishu delivery journal is full of active records')
}

function deliveryId(routeId: string, sessionId: string, source: FeishuDeliveryRecord['source']): string {
  const suffix = source.kind === 'turn'
    ? `turn:${source.turn}`
    : source.kind === 'response'
      ? `response:${source.eventId}`
      : `notice:${source.noticeId}`
  return createHash('sha256').update(`${routeId}\0${sessionId}\0${suffix}`).digest('hex')
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('time must be non-negative')
  return value
}

function exactText(value: string, label: string): string {
  if (value.length === 0 || value.length > 512) throw new Error(`${label} is invalid`)
  return value
}
