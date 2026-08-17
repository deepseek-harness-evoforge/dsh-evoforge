import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const commandResultSchema = z.strictObject({
  kind: z.enum(['success', 'error']),
  text: z.string().max(16_384).optional(),
})

const ingressSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal(1),
  routeId: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(512),
  sessionId: z.string().min(1).max(512),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.enum(['message', 'command']),
  status: z.enum(['prepared', 'executing', 'settled', 'uncertain']),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  commandResult: commandResultSchema.optional(),
  error: z.string().min(1).max(16_384).optional(),
})

const channelIngressDomainSpec = defineDomain({
  name: 'evoforge_channel_router',
  version: 1,
  global: {
    schema: z.strictObject({}),
    initial: {},
  },
  tables: {
    ingress: domainTable<string, ChannelIngressRecord>(ingressSchema),
  },
})

export type ChannelIngressRecord = z.infer<typeof ingressSchema>
export type ChannelCommandResult = z.infer<typeof commandResultSchema>
type ChannelIngressDomain = Domain<typeof channelIngressDomainSpec>

export interface PrepareChannelIngressInput {
  readonly id: string
  readonly routeId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly eventHash: string
  readonly contentHash: string
  readonly kind: ChannelIngressRecord['kind']
  readonly now: number
}

export interface ChannelIngressStoreOptions {
  /** Hard journal bound. Prepared and executing effects are never pruned. */
  readonly maxRecords?: number
}

export interface ChannelIngressStore {
  prepare(input: PrepareChannelIngressInput): Promise<{ created: boolean; record: ChannelIngressRecord }>
  get(id: string): ChannelIngressRecord | undefined
  list(): ChannelIngressRecord[]
  begin(id: string, now: number): Promise<ChannelIngressRecord>
  settleMessage(id: string, now: number): Promise<ChannelIngressRecord>
  settleCommand(id: string, result: ChannelCommandResult, now: number): Promise<ChannelIngressRecord>
  markUncertain(id: string, error: string, now: number): Promise<ChannelIngressRecord>
  recoverInflight(now: number): Promise<number>
  close(): Promise<void>
}

const DEFAULT_MAX_RECORDS = 10_000
const RECOVERY_ERROR = 'Prior channel action outcome is unknown and must not be retried automatically.'

class DomainChannelIngressStore implements ChannelIngressStore {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: ChannelIngressDomain,
    private readonly maxRecords: number,
  ) {}

  prepare(input: PrepareChannelIngressInput): Promise<{ created: boolean; record: ChannelIngressRecord }> {
    return this.write(async () => {
      exactTime(input.now)
      const { now, ...identity } = input
      const candidate = ingressSchema.parse({
        ...identity,
        schemaVersion: 1,
        status: 'prepared',
        createdAt: now,
        updatedAt: now,
      })
      const table = this.domain.table('ingress')
      const existing = table.get(candidate.id)
      if (existing !== undefined) {
        assertSameIntent(existing, candidate)
        return { created: false, record: copy(existing) }
      }
      await pruneOldestSettled(table, this.maxRecords - 1)
      if (table.size >= this.maxRecords) {
        throw new Error('channel ingress journal is full of non-terminal effects; refusing new ingress')
      }
      await table.put(candidate.id, candidate)
      return { created: true, record: copy(candidate) }
    })
  }

  get(id: string): ChannelIngressRecord | undefined {
    const value = this.domain.table('ingress').get(id)
    return value === undefined ? undefined : copy(value)
  }

  list(): ChannelIngressRecord[] {
    return [...this.domain.table('ingress').entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copy)
  }

  begin(id: string, now: number): Promise<ChannelIngressRecord> {
    return this.update(id, now, (current) => {
      if (current.status !== 'prepared') throw new Error(`cannot begin channel ingress from ${current.status}`)
      return { ...current, status: 'executing' }
    })
  }

  settleMessage(id: string, now: number): Promise<ChannelIngressRecord> {
    return this.update(id, now, (current) => {
      if (current.kind !== 'message') throw new Error('cannot settle command ingress as a message')
      if (current.status !== 'executing') throw new Error(`cannot settle channel ingress from ${current.status}`)
      return { ...current, status: 'settled' }
    })
  }

  settleCommand(id: string, result: ChannelCommandResult, now: number): Promise<ChannelIngressRecord> {
    const commandResult = commandResultSchema.parse(result)
    return this.update(id, now, (current) => {
      if (current.kind !== 'command') throw new Error('cannot settle message ingress as a command')
      if (current.status !== 'executing') throw new Error(`cannot settle channel ingress from ${current.status}`)
      return { ...current, status: 'settled', commandResult }
    })
  }

  markUncertain(id: string, error: string, now: number): Promise<ChannelIngressRecord> {
    if (error.length === 0) return Promise.reject(new Error('uncertain channel ingress requires an error'))
    return this.update(id, now, (current) => {
      if (current.status !== 'executing') throw new Error(`cannot mark channel ingress uncertain from ${current.status}`)
      return { ...current, status: 'uncertain', error }
    })
  }

  recoverInflight(now: number): Promise<number> {
    return this.write(async () => {
      exactTime(now)
      const table = this.domain.table('ingress')
      let recovered = 0
      for (const [id, record] of table.entries()) {
        if (record.status !== 'executing') continue
        await table.put(id, ingressSchema.parse({
          ...record,
          status: 'uncertain',
          updatedAt: now,
          error: RECOVERY_ERROR,
        }))
        recovered += 1
      }
      await pruneOldestSettled(table, this.maxRecords)
      return recovered
    })
  }

  close(): Promise<void> {
    this.closing ??= this.tail.then(() => this.domain.close())
    return this.closing
  }

  private update(
    id: string,
    now: number,
    transform: (current: ChannelIngressRecord) => ChannelIngressRecord,
  ): Promise<ChannelIngressRecord> {
    return this.write(async () => {
      exactTime(now)
      const table = this.domain.table('ingress')
      const record = await table.update(id, (current) => ingressSchema.parse({
        ...transform(current),
        updatedAt: now,
      }))
      if (record.status === 'settled' || record.status === 'uncertain') {
        await pruneOldestSettled(table, this.maxRecords)
      }
      return copy(record)
    })
  }

  private write<T>(job: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('channel ingress store is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openChannelIngressStore(
  facility: DomainFacility,
  options: ChannelIngressStoreOptions = {},
): Promise<ChannelIngressStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('channel ingress store maxRecords must be a positive safe integer')
  }
  return new DomainChannelIngressStore(await facility.open(channelIngressDomainSpec), maxRecords)
}

function assertSameIntent(existing: ChannelIngressRecord, candidate: ChannelIngressRecord): void {
  if (existing.contentHash !== candidate.contentHash) {
    throw new Error(`channel ingress '${existing.id}' content changed for the same external event`)
  }
  for (const field of ['routeId', 'workspaceId', 'sessionId', 'eventHash', 'kind'] as const) {
    if (existing[field] !== candidate[field]) {
      throw new Error(`channel ingress '${existing.id}' ${field} changed for the same external event`)
    }
  }
}

async function pruneOldestSettled(
  table: KvTable<string, ChannelIngressRecord>,
  maxSize: number,
): Promise<void> {
  if (table.size <= maxSize) return
  const candidates = [...table.entries()]
    .filter(([, record]) => record.status === 'settled' || record.status === 'uncertain')
    .sort((left, right) => left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]))
  for (const [id] of candidates) {
    if (table.size <= maxSize) return
    await table.delete(id)
  }
}

function exactTime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('time must be a non-negative safe integer')
  return value
}

function copy<T>(value: T): T {
  return structuredClone(value)
}
