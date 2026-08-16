import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { sessionIdentityOf } from './generation-binder.ts'
import type { EvolutionStore } from './generation-store.ts'

const DEFAULT_MAX_RECORDS = 1_000
const MAX_REASON_LENGTH = 160
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitCommitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const goalSchema = z.strictObject({
  id: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  phase: z.string().min(1).max(32),
})
const deliveryResultSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['passed', 'failed', 'unknown']),
  reason: z.string().min(1),
  goal: goalSchema,
  artifact: z.object({ commit: gitCommitSchema }).nullable().optional(),
  draftPr: z.object({
    status: z.enum(['passed', 'failed', 'unknown']),
    artifact: z.object({ number: z.number().int().positive() }).optional(),
  }).optional(),
})

export interface DeliveryOutcomeInput {
  readonly observedAt: number
  readonly sessionId: string
  readonly callId: string
  readonly generationId?: string | undefined
  readonly goal: {
    readonly id: string
    readonly revision: number
    readonly phase: string
  }
  readonly status: 'passed' | 'failed' | 'unknown'
  readonly reason: string
  readonly commit?: string | undefined
  readonly draftPrNumber?: number | undefined
}

export interface DeliveryOutcome extends DeliveryOutcomeInput {
  readonly id: string
  readonly schemaVersion: 1
}

export interface DeliveryOutcomeCounts {
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly unknown: number
}

export interface DeliveryOutcomeSummary {
  readonly all: DeliveryOutcomeCounts
  readonly selected: DeliveryOutcomeCounts
}

export interface DeliveryOutcomeStore {
  record(input: DeliveryOutcomeInput): Promise<{ created: boolean; outcome: DeliveryOutcome }>
  summarize(selectedGenerationId?: string): DeliveryOutcomeSummary
  close(): Promise<void>
}

export interface DeliveryOutcomeMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

const outcomeContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: z.number().int().nonnegative(),
  sessionId: z.string().min(1).max(256),
  callId: z.string().min(1).max(512),
  generationId: hashSchema.optional(),
  goal: goalSchema,
  status: z.enum(['passed', 'failed', 'unknown']),
  reason: z.string().min(1).max(MAX_REASON_LENGTH),
  commit: gitCommitSchema.optional(),
  draftPrNumber: z.number().int().positive().optional(),
})
const outcomeSchema = outcomeContentSchema.extend({ id: hashSchema })

const deliveryOutcomeDomainSpec = defineDomain({
  name: 'evoforge_delivery_outcomes',
  version: 1,
  tables: {
    outcomes: domainTable<string, DeliveryOutcome>(outcomeSchema),
  },
})

type DeliveryOutcomeDomain = Domain<typeof deliveryOutcomeDomainSpec>

class DomainDeliveryOutcomeStore implements DeliveryOutcomeStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: DeliveryOutcomeDomain
  private readonly maxRecords: number

  constructor(domain: DeliveryOutcomeDomain, maxRecords: number) {
    this.domain = domain
    this.maxRecords = maxRecords
  }

  record(input: DeliveryOutcomeInput): Promise<{ created: boolean; outcome: DeliveryOutcome }> {
    if (this.closing !== undefined) return Promise.reject(new Error('delivery outcome store is closing'))
    const result = this.writeTail.then(() => this.recordNow(input))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  summarize(selectedGenerationId?: string): DeliveryOutcomeSummary {
    const all = emptyCounts()
    const selected = emptyCounts()
    for (const [, outcome] of this.domain.table('outcomes').entries()) {
      increment(all, outcome.status)
      if (outcome.generationId === selectedGenerationId) increment(selected, outcome.status)
    }
    return { all, selected }
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private async recordNow(input: DeliveryOutcomeInput): Promise<{
    created: boolean
    outcome: DeliveryOutcome
  }> {
    const content = outcomeContentSchema.parse({ schemaVersion: 1, ...input })
    const id = createHash('sha256')
      .update(JSON.stringify([content.sessionId, content.callId]))
      .digest('hex')
    const table = this.domain.table('outcomes')
    const existing = table.get(id)
    if (existing !== undefined) return { created: false, outcome: immutableCopy(existing) }

    const outcome = immutableCopy(outcomeSchema.parse({ ...content, id }))
    await table.put(id, outcome)
    if (table.size > this.maxRecords) {
      const excess = [...table.entries()]
        .sort((left, right) => left[1].observedAt - right[1].observedAt || left[0].localeCompare(right[0]))
        .slice(0, table.size - this.maxRecords)
      for (const [expiredId] of excess) await table.delete(expiredId)
    }
    return { created: true, outcome }
  }
}

export async function openDeliveryOutcomeStore(
  facility: DomainFacility,
  options: { maxRecords?: number } = {},
): Promise<DeliveryOutcomeStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('delivery outcome maxRecords must be a positive integer')
  }
  return new DomainDeliveryOutcomeStore(await facility.open(deliveryOutcomeDomainSpec), maxRecords)
}

/** Observe only the compact canonical result; never delay or reshape the Tool execution. */
export function installDeliveryOutcomeMonitor(
  ctx: Context,
  outcomes: DeliveryOutcomeStore,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
  options: { now?: () => number } = {},
): DeliveryOutcomeMonitor {
  const now = options.now ?? Date.now
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const remove = ctx.on('tools/result', (execution, result) => {
    if (disposed || execution.name !== 'complete_delivery' || execution.agent === undefined) return
    const parsed = parseDeliveryResult(result)
    if (parsed === undefined) return
    const identity = sessionIdentityOf(execution.agent)
    const input = {
      observedAt: now(),
      sessionId: identity.sessionId,
      callId: String(execution.callId),
      goal: parsed.goal,
      status: parsed.status,
      reason: parsed.reason,
      ...(parsed.commit === undefined ? {} : { commit: parsed.commit }),
      ...(parsed.draftPrNumber === undefined ? {} : { draftPrNumber: parsed.draftPrNumber }),
    } satisfies Omit<DeliveryOutcomeInput, 'generationId'>
    tail = tail.then(async () => {
      try {
        const generationId = evolution.getSessionGeneration(identity)?.id
        await outcomes.record({
          ...input,
          ...(generationId === undefined ? {} : { generationId }),
        })
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one delivery outcome: ${errorMessage(error)}`)
      }
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

function parseDeliveryResult(result: Readonly<ToolExecutionResult>): {
  goal: DeliveryOutcomeInput['goal']
  status: DeliveryOutcomeInput['status']
  reason: string
  commit?: string
  draftPrNumber?: number
} | undefined {
  if (result.isError) return undefined
  const parsed = deliveryResultSchema.safeParse(result.value)
  if (!parsed.success) return undefined
  if (parsed.data.status === 'passed' && parsed.data.goal.phase !== 'complete') return undefined
  const reason = compactReason(parsed.data.reason)
  if (reason === '') return undefined
  const draftPrNumber = parsed.data.draftPr?.status === 'passed'
    ? parsed.data.draftPr.artifact?.number
    : undefined
  return {
    goal: parsed.data.goal,
    status: parsed.data.status,
    reason,
    ...(parsed.data.artifact?.commit === undefined ? {} : { commit: parsed.data.artifact.commit }),
    ...(draftPrNumber === undefined ? {} : { draftPrNumber }),
  }
}

function compactReason(reason: string): string {
  return reason.replace(/\s+/gu, ' ').trim().slice(0, MAX_REASON_LENGTH)
}

function emptyCounts(): { total: number; passed: number; failed: number; unknown: number } {
  return { total: 0, passed: 0, failed: 0, unknown: 0 }
}

function increment(
  counts: { total: number; passed: number; failed: number; unknown: number },
  status: DeliveryOutcomeInput['status'],
): void {
  counts.total += 1
  counts[status] += 1
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
