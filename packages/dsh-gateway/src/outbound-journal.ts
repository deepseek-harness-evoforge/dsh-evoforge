import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  GatewayOutboundPolicy,
  GatewayOutboundSendResult,
  GatewayDeliveryIntent,
} from './outbound.js'

const commonOutboundSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  routeId: z.string().min(1).max(64),
  intentKey: z.string().min(1).max(1_024),
  replyToExternalId: z.string().min(1).max(512).optional(),
  replyInThread: z.boolean().optional(),
  waitForTurnEnd: z.number().int().positive().optional(),
  status: z.enum(['prepared', 'sending', 'retrying', 'delivered', 'uncertain', 'failed']),
  attempts: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  nextAttemptAt: z.number().int().nonnegative().optional(),
  externalMessageId: z.string().min(1).max(512).optional(),
  error: z.string().min(1).max(512).optional(),
})

const textOutboundSchema = commonOutboundSchema.extend({
  kind: z.enum(['turn', 'response', 'notice']),
  text: z.string().min(1).max(30_000),
})
const fileOutboundSchema = commonOutboundSchema.extend({
  kind: z.literal('file'),
  destinationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  file: z.strictObject({
    attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    name: z.string().min(1).refine(value => Buffer.byteLength(value) <= 255
      && value.trim() === value && value !== '.' && value !== '..'
      && !/[/\\\u0000-\u001f\u007f]/u.test(value)),
    bytes: z.number().int().positive().max(30_000_000),
  }),
})
const outboundSchema = z.union([textOutboundSchema,
  fileOutboundSchema.refine(record => record.waitForTurnEnd === undefined),
])

export type GatewayOutboundRecord = z.infer<typeof outboundSchema>
export type GatewayOutboundStatus = GatewayOutboundRecord['status']

const gatewayOutboundDomainSpec = defineDomain({
  name: 'evoforge_gateway_outbound',
  version: 1,
  global: { schema: z.strictObject({}), initial: {} },
  tables: { outbound: domainTable<string, GatewayOutboundRecord>(textOutboundSchema) },
})

// Keep the legacy native unit byte/schema compatible; file metadata is a sibling
// Domain owned by this same journal/coordinator, never a second sending authority.
const gatewayFileOutboundDomainSpec = defineDomain({
  name: 'evoforge_gateway_file_outbound',
  version: 1,
  global: { schema: z.strictObject({}), initial: {} },
  tables: { files: domainTable<string, GatewayOutboundRecord>(
    fileOutboundSchema.refine(record => record.waitForTurnEnd === undefined),
  ) },
})

type GatewayOutboundDomain = Domain<typeof gatewayOutboundDomainSpec>
type GatewayFileOutboundDomain = Domain<typeof gatewayFileOutboundDomainSpec>
const DEFAULT_MAX_RECORDS = 10_000
const TERMINAL = new Set<GatewayOutboundStatus>(['delivered', 'uncertain', 'failed'])

export interface GatewayOutboundJournal {
  prepare(
    input: GatewayDeliveryIntent & { readonly now: number },
  ): Promise<{ created: boolean; record: GatewayOutboundRecord }>
  get(id: string): GatewayOutboundRecord | undefined
  list(): GatewayOutboundRecord[]
  begin(id: string, now: number): Promise<GatewayOutboundRecord>
  finish(
    id: string,
    result: GatewayOutboundSendResult,
    policy: GatewayOutboundPolicy,
    now: number,
  ): Promise<GatewayOutboundRecord>
  recoverInflight(now: number): Promise<number>
  close(): Promise<void>
}

class DomainGatewayOutboundJournal implements GatewayOutboundJournal {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: GatewayOutboundDomain,
    private readonly files: GatewayFileOutboundDomain,
    private readonly maxRecords: number,
  ) {
    const seen = new Set<string>()
    for (const table of this.tables()) {
      for (const [id, record] of table.entries()) {
        if (id !== record.id || id !== outboundId(record.routeId, exactIntentKey(record.intentKey)) || seen.has(id)) {
          throw new Error('Gateway outbound durable identity is inconsistent')
        }
        seen.add(id)
      }
    }
  }

  async prepare(
    input: GatewayDeliveryIntent & { readonly now: number },
  ): Promise<{ created: boolean; record: GatewayOutboundRecord }> {
    const snapshot = structuredClone(input)
    return this.write(async () => {
      const { now: rawNow, ...intent } = snapshot
      const now = exactTime(rawNow)
      const intentKey = exactIntentKey(snapshot.intentKey)
      const id = outboundId(snapshot.routeId, intentKey)
      if ('waitForTurnEnd' in snapshot && snapshot.waitForTurnEnd !== undefined && snapshot.kind !== 'turn') {
        throw new Error('Only a Gateway turn delivery may wait for native turn/end')
      }
      const candidate = outboundSchema.parse({
        ...intent,
        intentKey,
        ...(snapshot.replyToExternalId === undefined
          ? {}
          : { replyToExternalId: exactExternalId(snapshot.replyToExternalId) }),
        id,
        schemaVersion: 1,
        status: 'prepared',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      const table = this.tableFor(candidate)
      const existing = this.get(id)
      if (existing !== undefined) {
        assertSameIntent(existing, candidate)
        return { created: false, record: copy(existing) }
      }
      await prune(this.tables(), this.maxRecords - 1)
      await table.put(id, candidate)
      return { created: true, record: copy(candidate) }
    })
  }

  get(id: string): GatewayOutboundRecord | undefined {
    const text = this.domain.table('outbound').get(id)
    const file = this.files.table('files').get(id)
    if (text !== undefined && file !== undefined) throw new Error('Gateway outbound identity exists in both native domains')
    const value = text ?? file
    return value === undefined ? undefined : copy(value)
  }

  list(): GatewayOutboundRecord[] {
    return this.tables().flatMap(table => [...table.entries()])
      .map(([, value]) => value)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copy)
  }

  begin(id: string, now: number): Promise<GatewayOutboundRecord> {
    return this.update(id, (current) => {
      if (current.status !== 'prepared' && current.status !== 'retrying') {
        throw new Error(`cannot begin Gateway outbound delivery from ${current.status}`)
      }
      return clean({
        ...current,
        status: 'sending',
        attempts: current.attempts + 1,
        updatedAt: exactTime(now),
      })
    })
  }

  finish(
    id: string,
    result: GatewayOutboundSendResult,
    policy: GatewayOutboundPolicy,
    now: number,
  ): Promise<GatewayOutboundRecord> {
    return this.update(id, (current) => {
      if (current.status !== 'sending') {
        throw new Error(`cannot finish Gateway outbound delivery from ${current.status}`)
      }
      const updatedAt = exactTime(now)
      if (result.kind === 'delivered') {
        return clean({
          ...current,
          status: 'delivered',
          updatedAt,
          externalMessageId: exactExternalId(result.externalMessageId),
        })
      }
      if (result.kind === 'rate-limited') {
        const retryAfterMs = result.retryAfterMs
        if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 1
          || retryAfterMs > policy.maxRetryAfterMs) {
          return clean({
            ...current,
            status: 'failed',
            updatedAt,
            error: 'Adapter rate-limit delay was invalid or exceeded the configured safety bound.',
          })
        }
        if (current.attempts < policy.maxAttempts) {
          return clean({
            ...current,
            status: 'retrying',
            updatedAt,
            nextAttemptAt: updatedAt + retryAfterMs,
            error: 'Adapter rejected the request with a proven pre-acceptance rate limit.',
          })
        }
        return clean({
          ...current,
          status: 'failed',
          updatedAt,
          error: 'Adapter rate-limit retry bound was exhausted.',
        })
      }
      if (result.kind === 'rejected') {
        return clean({
          ...current,
          status: 'failed',
          updatedAt,
          error: `Adapter rejected the message before acceptance (${exactCode(result.code)}).`,
        })
      }
      return clean({
        ...current,
        status: 'uncertain',
        updatedAt,
        error: 'Adapter did not prove whether the message was accepted; automatic retry is disabled.',
      })
    })
  }

  recoverInflight(now: number): Promise<number> {
    return this.write(async () => {
      exactTime(now)
      let recovered = 0
      for (const record of this.list()) {
        if (record.status !== 'sending') continue
        await this.tableFor(record).put(record.id, outboundSchema.parse(clean({
          ...record,
          status: 'uncertain',
          updatedAt: now,
          error: 'The prior send may have reached its Adapter; automatic retry is disabled.',
        })))
        recovered += 1
      }
      await prune(this.tables(), this.maxRecords)
      return recovered
    })
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(async () => {
      const results = await Promise.allSettled([this.domain.close(), this.files.close()])
      const failed = results.filter(result => result.status === 'rejected')
      if (failed.length > 0) throw new AggregateError(failed.map(result => result.reason), 'Gateway outbound close failed')
    })
    return this.closing
  }

  private update(
    id: string,
    transform: (current: GatewayOutboundRecord) => GatewayOutboundRecord,
  ): Promise<GatewayOutboundRecord> {
    return this.write(async () => {
      const current = this.get(id)
      if (current === undefined) throw new Error('Gateway outbound record is missing')
      const table = this.tableFor(current)
      const value = await table.update(id, current => outboundSchema.parse(transform(current)))
      if (TERMINAL.has(value.status)) await prune(this.tables(), this.maxRecords)
      return copy(value)
    })
  }

  private tables(): KvTable<string, GatewayOutboundRecord>[] {
    return [this.domain.table('outbound'), this.files.table('files')]
  }

  private tableFor(record: GatewayOutboundRecord): KvTable<string, GatewayOutboundRecord> {
    return record.kind === 'file' ? this.files.table('files') : this.domain.table('outbound')
  }

  private write<T>(job: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('Gateway outbound journal is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openGatewayOutboundJournal(
  facility: DomainFacility,
  options: { readonly maxRecords?: number } = {},
): Promise<GatewayOutboundJournal> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
    throw new Error('Gateway outbound maxRecords must be from 1 to 100000')
  }
  const domain = await facility.open(gatewayOutboundDomainSpec)
  let files: GatewayFileOutboundDomain | undefined
  try {
    files = await facility.open(gatewayFileOutboundDomainSpec)
    return new DomainGatewayOutboundJournal(domain, files, maxRecords)
  } catch (error) {
    const cleanup = await Promise.allSettled([domain.close(), ...(files === undefined ? [] : [files.close()])])
    const failed = cleanup.filter(result => result.status === 'rejected')
    if (failed.length > 0) throw new AggregateError([error, ...failed.map(result => result.reason)], 'Gateway outbound open cleanup failed')
    throw error
  }
}

function assertSameIntent(existing: GatewayOutboundRecord, candidate: GatewayOutboundRecord): void {
  if (existing.routeId !== candidate.routeId || existing.kind !== candidate.kind
    || existing.intentKey !== candidate.intentKey
    || (existing.kind === 'file' ? candidate.kind !== 'file'
      || existing.destinationDigest !== candidate.destinationDigest
      || existing.file.attachmentId !== candidate.file.attachmentId
      || existing.file.name !== candidate.file.name || existing.file.bytes !== candidate.file.bytes
      : candidate.kind === 'file' || existing.text !== candidate.text)
    || existing.replyToExternalId !== candidate.replyToExternalId
    || existing.replyInThread !== candidate.replyInThread
    || existing.waitForTurnEnd !== candidate.waitForTurnEnd) {
    throw new Error(`Gateway outbound intent '${existing.id}' content or destination changed`)
  }
}

async function prune(
  tables: readonly KvTable<string, GatewayOutboundRecord>[],
  maxSize: number,
): Promise<void> {
  const size = () => tables.reduce((total, table) => total + table.size, 0)
  if (size() <= maxSize) return
  const candidates = tables.flatMap(table => [...table.entries()].map(([id, value]) => ({ table, id, value })))
    .filter(({ value }) => TERMINAL.has(value.status))
    .sort((left, right) => left.value.createdAt - right.value.createdAt || left.id.localeCompare(right.id))
  for (const { table, id } of candidates) {
    if (size() <= maxSize) return
    await table.delete(id)
  }
  if (size() > maxSize) throw new Error('Gateway outbound journal is full of active records')
}

function outboundId(routeId: string, intentKey: string): string {
  return createHash('sha256').update(`${routeId}\0${intentKey}`).digest('hex')
}

function clean<T extends GatewayOutboundRecord>(record: T): T {
  const value = { ...record }
  if (record.status !== 'retrying') Reflect.deleteProperty(value, 'nextAttemptAt')
  if (record.status !== 'delivered') Reflect.deleteProperty(value, 'externalMessageId')
  if (record.status === 'delivered') Reflect.deleteProperty(value, 'error')
  return value as T
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Gateway outbound time must be non-negative')
  return value
}

function exactExternalId(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Gateway outbound external message id is invalid')
  }
  return value
}

function exactIntentKey(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value) > 1_024
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Gateway outbound intent key must be non-empty, trimmed, control-free, and at most 1024 bytes')
  }
  return value
}

function exactCode(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Gateway outbound rejection code is invalid')
  }
  return value
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
