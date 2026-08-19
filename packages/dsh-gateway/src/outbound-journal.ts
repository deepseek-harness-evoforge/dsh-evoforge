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
  GatewayTextDeliveryIntent,
} from './outbound.js'

const outboundSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  routeId: z.string().min(1).max(64),
  kind: z.enum(['turn', 'response', 'notice']),
  intentKey: z.string().min(1).max(1_024),
  text: z.string().min(1).max(30_000),
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

export type GatewayOutboundRecord = z.infer<typeof outboundSchema>
export type GatewayOutboundStatus = GatewayOutboundRecord['status']

const gatewayOutboundDomainSpec = defineDomain({
  name: 'evoforge_gateway_outbound',
  version: 1,
  global: { schema: z.strictObject({}), initial: {} },
  tables: { outbound: domainTable<string, GatewayOutboundRecord>(outboundSchema) },
})

type GatewayOutboundDomain = Domain<typeof gatewayOutboundDomainSpec>
const DEFAULT_MAX_RECORDS = 10_000
const TERMINAL = new Set<GatewayOutboundStatus>(['delivered', 'uncertain', 'failed'])

export interface GatewayOutboundJournal {
  prepare(
    input: GatewayTextDeliveryIntent & { readonly now: number },
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

  constructor(private readonly domain: GatewayOutboundDomain, private readonly maxRecords: number) {}

  prepare(
    input: GatewayTextDeliveryIntent & { readonly now: number },
  ): Promise<{ created: boolean; record: GatewayOutboundRecord }> {
    return this.write(async () => {
      const { now: rawNow, ...intent } = input
      const now = exactTime(rawNow)
      const intentKey = exactIntentKey(input.intentKey)
      const id = outboundId(input.routeId, intentKey)
      if (input.waitForTurnEnd !== undefined && input.kind !== 'turn') {
        throw new Error('Only a Gateway turn delivery may wait for native turn/end')
      }
      const candidate = outboundSchema.parse({
        ...intent,
        intentKey,
        ...(input.replyToExternalId === undefined
          ? {}
          : { replyToExternalId: exactExternalId(input.replyToExternalId) }),
        id,
        schemaVersion: 1,
        status: 'prepared',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
      const table = this.domain.table('outbound')
      const existing = table.get(id)
      if (existing !== undefined) {
        assertSameIntent(existing, candidate)
        return { created: false, record: copy(existing) }
      }
      await prune(table, this.maxRecords - 1)
      await table.put(id, candidate)
      return { created: true, record: copy(candidate) }
    })
  }

  get(id: string): GatewayOutboundRecord | undefined {
    const value = this.domain.table('outbound').get(id)
    return value === undefined ? undefined : copy(value)
  }

  list(): GatewayOutboundRecord[] {
    return [...this.domain.table('outbound').entries()]
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
      const table = this.domain.table('outbound')
      let recovered = 0
      for (const [id, record] of table.entries()) {
        if (record.status !== 'sending') continue
        await table.put(id, outboundSchema.parse(clean({
          ...record,
          status: 'uncertain',
          updatedAt: now,
          error: 'The prior send may have reached its Adapter; automatic retry is disabled.',
        })))
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

  private update(
    id: string,
    transform: (current: GatewayOutboundRecord) => GatewayOutboundRecord,
  ): Promise<GatewayOutboundRecord> {
    return this.write(async () => {
      const table = this.domain.table('outbound')
      const value = await table.update(id, current => outboundSchema.parse(transform(current)))
      if (TERMINAL.has(value.status)) await prune(table, this.maxRecords)
      return copy(value)
    })
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
  return new DomainGatewayOutboundJournal(await facility.open(gatewayOutboundDomainSpec), maxRecords)
}

function assertSameIntent(existing: GatewayOutboundRecord, candidate: GatewayOutboundRecord): void {
  if (existing.routeId !== candidate.routeId || existing.kind !== candidate.kind
    || existing.intentKey !== candidate.intentKey || existing.text !== candidate.text
    || existing.replyToExternalId !== candidate.replyToExternalId
    || existing.replyInThread !== candidate.replyInThread
    || existing.waitForTurnEnd !== candidate.waitForTurnEnd) {
    throw new Error(`Gateway outbound intent '${existing.id}' content or destination changed`)
  }
}

async function prune(
  table: KvTable<string, GatewayOutboundRecord>,
  maxSize: number,
): Promise<void> {
  if (table.size <= maxSize) return
  const candidates = [...table.entries()]
    .filter(([, value]) => TERMINAL.has(value.status))
    .sort((left, right) => left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]))
  for (const [id] of candidates) {
    if (table.size <= maxSize) return
    await table.delete(id)
  }
  if (table.size > maxSize) throw new Error('Gateway outbound journal is full of active records')
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
