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

const gatewayIngressDomainSpec = defineDomain({
  name: 'evoforge_gateway',
  version: 1,
  global: {
    schema: z.strictObject({}),
    initial: {},
  },
  tables: {
    ingress: domainTable<string, GatewayIngressRecord>(ingressSchema),
  },
})

export type GatewayIngressRecord = z.infer<typeof ingressSchema>
export type GatewayCommandResult = z.infer<typeof commandResultSchema>
type GatewayIngressDomain = Domain<typeof gatewayIngressDomainSpec>

export interface PrepareGatewayIngressInput {
  readonly id: string
  readonly routeId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly eventHash: string
  readonly contentHash: string
  readonly kind: GatewayIngressRecord['kind']
  readonly now: number
}

export interface GatewayIngressJournalOptions {
  /** Hard journal bound. Prepared and executing effects are never pruned. */
  readonly maxRecords?: number
}

export interface GatewayIngressJournal {
  prepare(input: PrepareGatewayIngressInput): Promise<{ created: boolean; record: GatewayIngressRecord }>
  get(id: string): GatewayIngressRecord | undefined
  list(): GatewayIngressRecord[]
  begin(id: string, now: number): Promise<GatewayIngressRecord>
  settleMessage(id: string, now: number): Promise<GatewayIngressRecord>
  settleCommand(id: string, result: GatewayCommandResult, now: number): Promise<GatewayIngressRecord>
  markUncertain(id: string, error: string, now: number): Promise<GatewayIngressRecord>
  recoverInflight(now: number): Promise<number>
  close(): Promise<void>
}

const DEFAULT_MAX_RECORDS = 10_000
const RECOVERY_ERROR = 'Prior gateway action outcome is unknown and must not be retried automatically.'

class DomainGatewayIngressJournal implements GatewayIngressJournal {
  private tail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(
    private readonly domain: GatewayIngressDomain,
    private readonly maxRecords: number,
  ) {}

  prepare(input: PrepareGatewayIngressInput): Promise<{ created: boolean; record: GatewayIngressRecord }> {
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
        throw new Error('gateway ingress journal is full of non-terminal effects; refusing new ingress')
      }
      await table.put(candidate.id, candidate)
      return { created: true, record: copy(candidate) }
    })
  }

  get(id: string): GatewayIngressRecord | undefined {
    const value = this.domain.table('ingress').get(id)
    return value === undefined ? undefined : copy(value)
  }

  list(): GatewayIngressRecord[] {
    return [...this.domain.table('ingress').entries()]
      .map(([, record]) => record)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copy)
  }

  begin(id: string, now: number): Promise<GatewayIngressRecord> {
    return this.update(id, now, (current) => {
      if (current.status !== 'prepared') throw new Error(`cannot begin gateway ingress from ${current.status}`)
      return { ...current, status: 'executing' }
    })
  }

  settleMessage(id: string, now: number): Promise<GatewayIngressRecord> {
    return this.update(id, now, (current) => {
      if (current.kind !== 'message') throw new Error('cannot settle command ingress as a message')
      if (current.status !== 'executing') throw new Error(`cannot settle gateway ingress from ${current.status}`)
      return { ...current, status: 'settled' }
    })
  }

  settleCommand(id: string, result: GatewayCommandResult, now: number): Promise<GatewayIngressRecord> {
    const commandResult = commandResultSchema.parse(result)
    return this.update(id, now, (current) => {
      if (current.kind !== 'command') throw new Error('cannot settle message ingress as a command')
      if (current.status !== 'executing') throw new Error(`cannot settle gateway ingress from ${current.status}`)
      return { ...current, status: 'settled', commandResult }
    })
  }

  markUncertain(id: string, error: string, now: number): Promise<GatewayIngressRecord> {
    if (error.length === 0) return Promise.reject(new Error('uncertain gateway ingress requires an error'))
    return this.update(id, now, (current) => {
      if (current.status !== 'executing') throw new Error(`cannot mark gateway ingress uncertain from ${current.status}`)
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
    transform: (current: GatewayIngressRecord) => GatewayIngressRecord,
  ): Promise<GatewayIngressRecord> {
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
    if (this.closing !== undefined) return Promise.reject(new Error('gateway ingress journal is closing'))
    const result = this.tail.then(job)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openGatewayIngressJournal(
  facility: DomainFacility,
  options: GatewayIngressJournalOptions = {},
): Promise<GatewayIngressJournal> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('gateway ingress journal maxRecords must be a positive safe integer')
  }
  return new DomainGatewayIngressJournal(await facility.open(gatewayIngressDomainSpec), maxRecords)
}

function assertSameIntent(existing: GatewayIngressRecord, candidate: GatewayIngressRecord): void {
  if (existing.contentHash !== candidate.contentHash) {
    throw new Error(`gateway ingress '${existing.id}' content changed for the same external event`)
  }
  for (const field of ['routeId', 'workspaceId', 'sessionId', 'eventHash', 'kind'] as const) {
    if (existing[field] !== candidate[field]) {
      throw new Error(`gateway ingress '${existing.id}' ${field} changed for the same external event`)
    }
  }
}

async function pruneOldestSettled(
  table: KvTable<string, GatewayIngressRecord>,
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
