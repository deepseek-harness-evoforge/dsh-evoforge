import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { EvolutionStore } from './generation-store.ts'
import {
  goalExecutionMetricsSchema,
  projectGoalExecutionMetrics,
  type GoalExecutionMetrics,
} from './goal-execution-metrics.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const DEFAULT_MAX_RECORDS = 1_000
const MAX_RECENT_METRIC_ROWS = 20
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
  readonly workspaceId: string
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
  readonly goalMetrics?: GoalExecutionMetrics | undefined
}

export interface DeliveryOutcome extends DeliveryOutcomeInput {
  readonly id: string
  readonly schemaVersion: 2
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
  readonly baseline?: DeliveryOutcomeCounts
  readonly metrics: DeliveryOutcomeMetricsSummary
}

export interface DeliveryOutcomeMetricRollup {
  readonly measured: number
  readonly unmeasured: number
  readonly attributedTurns: number
  readonly closedSteps: number
  readonly activeWallMs: number
  readonly providerUsage: GoalExecutionMetrics['providerUsage']
  readonly latency: GoalExecutionMetrics['latency']
  readonly monetaryCost: GoalExecutionMetrics['monetaryCost']
}

export interface DeliveryOutcomeMetricEvidence {
  readonly outcomeId: string
  readonly observedAt: number
  readonly generationId?: string | undefined
  readonly status: DeliveryOutcome['status']
  readonly goal: Pick<DeliveryOutcome['goal'], 'id' | 'revision'>
  readonly metrics: GoalExecutionMetrics
}

export interface DeliveryOutcomeMetricsSummary {
  readonly all: DeliveryOutcomeMetricRollup
  readonly selected: DeliveryOutcomeMetricRollup
  readonly baseline?: DeliveryOutcomeMetricRollup
  readonly recent: readonly DeliveryOutcomeMetricEvidence[]
}

export interface DeliveryOutcomeStore {
  record(input: DeliveryOutcomeInput): Promise<{ created: boolean; outcome: DeliveryOutcome }>
  list(workspaceId?: string): DeliveryOutcome[]
  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): DeliveryOutcomeSummary
  close(): Promise<void>
}

export interface DeliveryOutcomeMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

const outcomeContentSchema = z.strictObject({
  schemaVersion: z.literal(2),
  observedAt: z.number().int().nonnegative(),
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  callId: z.string().min(1).max(512),
  generationId: hashSchema.optional(),
  goal: goalSchema,
  status: z.enum(['passed', 'failed', 'unknown']),
  reason: z.string().min(1).max(MAX_REASON_LENGTH),
  commit: gitCommitSchema.optional(),
  draftPrNumber: z.number().int().positive().optional(),
  goalMetrics: goalExecutionMetricsSchema.optional(),
})
const outcomeSchema = outcomeContentSchema.extend({ id: hashSchema })

const deliveryOutcomeDomainSpec = defineDomain({
  name: 'evoforge_delivery_outcomes',
  version: 2,
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

  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): DeliveryOutcomeSummary {
    const all = emptyCounts()
    const selected = emptyCounts()
    const baseline = options === undefined ? undefined : emptyCounts()
    const allMetrics = emptyMetricRollup()
    const selectedMetrics = emptyMetricRollup()
    const baselineMetrics = options === undefined ? undefined : emptyMetricRollup()
    const recent: DeliveryOutcomeMetricEvidence[] = []
    for (const [, outcome] of this.domain.table('outcomes').entries()) {
      if (outcome.workspaceId !== workspaceId) continue
      increment(all, outcome.status)
      incrementMetrics(allMetrics, outcome.goalMetrics)
      if (outcome.goalMetrics !== undefined) recent.push({
        outcomeId: outcome.id,
        observedAt: outcome.observedAt,
        ...(outcome.generationId === undefined ? {} : { generationId: outcome.generationId }),
        status: outcome.status,
        goal: { id: outcome.goal.id, revision: outcome.goal.revision },
        metrics: outcome.goalMetrics,
      })
      if (outcome.generationId === selectedGenerationId) {
        increment(selected, outcome.status)
        incrementMetrics(selectedMetrics, outcome.goalMetrics)
      }
      if (baseline !== undefined
        && baselineMetrics !== undefined
        && outcome.generationId === options?.baselineGenerationId) {
        increment(baseline, outcome.status)
        incrementMetrics(baselineMetrics, outcome.goalMetrics)
      }
    }
    recent.sort((left, right) => right.observedAt - left.observedAt
      || right.outcomeId.localeCompare(left.outcomeId))
    return immutableCopy({
      all,
      selected,
      ...(baseline === undefined ? {} : { baseline }),
      metrics: {
        all: allMetrics,
        selected: selectedMetrics,
        ...(baselineMetrics === undefined ? {} : { baseline: baselineMetrics }),
        recent: recent.slice(0, MAX_RECENT_METRIC_ROWS),
      },
    })
  }

  list(workspaceId?: string): DeliveryOutcome[] {
    return [...this.domain.table('outcomes').entries()].map(([, outcome]) => outcome)
      .filter(outcome => workspaceId === undefined || outcome.workspaceId === workspaceId)
      .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private async recordNow(input: DeliveryOutcomeInput): Promise<{
    created: boolean
    outcome: DeliveryOutcome
  }> {
    const content = outcomeContentSchema.parse({ schemaVersion: 2, ...input })
    const id = createHash('sha256')
      .update(JSON.stringify([content.workspaceId, content.sessionId, content.callId]))
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

/**
 * Project compact delivery outcomes only from durable Session call/result
 * pairs. The projection first crosses DSH's awaited Session durability
 * checkpoint. Cold Session start can then replay a persisted pair after a
 * crash between that checkpoint and the StorageDomain projection.
 */
export function installDeliveryOutcomeMonitor(
  ctx: Context,
  outcomes: DeliveryOutcomeStore,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
  options: {
    readonly onOutcome?: (outcome: DeliveryOutcome) => void | Promise<void>
  } = {},
): DeliveryOutcomeMonitor {
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const enqueue = (session: Session, event: SessionEvent<'tool/result'>) => {
    if (disposed) return
    const parsed = parseDurableDeliveryResult(session, event)
    if (parsed === undefined) return
    tail = tail.then(async () => {
      try {
        if (!(await ctx.sessions.flush(session))) {
          throw new Error('native Session has no durability checkpoint listener')
        }
        const { id, createdAt, cwd } = session.header
        const identity = {
          workspaceId: await workspaceIdForCwd(ctx, cwd),
          sessionId: String(id),
          createdAt,
          ...(cwd === undefined ? {} : { cwd }),
        }
        const generationId = evolution.getSessionGeneration(identity)?.id
        const projections = ctx.get('sessionProjections')
        const goalMetrics = projections === undefined
          ? undefined
          : projectGoalExecutionMetrics(session, parsed.goal.id, event.seq, projections)
        const recorded = await outcomes.record({
          observedAt: event.time,
          workspaceId: identity.workspaceId,
          sessionId: identity.sessionId,
          callId: parsed.callId,
          goal: parsed.goal,
          status: parsed.status,
          reason: parsed.reason,
          ...(parsed.commit === undefined ? {} : { commit: parsed.commit }),
          ...(parsed.draftPrNumber === undefined ? {} : { draftPrNumber: parsed.draftPrNumber }),
          ...(generationId === undefined ? {} : { generationId }),
          ...(goalMetrics === undefined ? {} : { goalMetrics }),
        })
        if (recorded.created) {
          try {
            await options.onOutcome?.(recorded.outcome)
          } catch (error) {
            ctx.logger.warn(`dsh-evolve outcome wakeup failed: ${errorMessage(error)}`)
          }
        }
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one delivery outcome: ${errorMessage(error)}`)
      }
    })
  }
  const removeEvent = ctx.on('session/event', (session, event) => {
    if (event.type === 'tool/result') enqueue(session, event)
  })
  const removeStart = ctx.on('agent/session-start', ({ agent }) => {
    for (const event of agent.session.events) {
      if (event.type === 'tool/result') enqueue(agent.session, event)
    }
  })

  return {
    async flush() {
      await tail
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        removeEvent()
        removeStart()
      }
      await tail
    },
  }
}

function parseDurableDeliveryResult(
  session: Session,
  event: SessionEvent<'tool/result'>,
): {
  callId: string
  goal: DeliveryOutcomeInput['goal']
  status: DeliveryOutcomeInput['status']
  reason: string
  commit?: string
  draftPrNumber?: number
} | undefined {
  const sourceSeqs = event.sourceEventSeqs
  if (sourceSeqs?.length !== 1) return undefined
  const call = session.events[sourceSeqs[0]!]
  if (call?.type !== 'tool/call'
    || call.data.name !== 'complete_delivery'
    || String(call.data.callId) !== String(event.data.message.source.callId)) return undefined
  const block = event.data.message.content[0]
  if (block.type !== 'tool-result'
    || block.isError === true
    || String(block.toolCallId) !== String(call.data.callId)
    || block.content.length !== 1
    || block.content[0]?.type !== 'text') return undefined
  let value: unknown
  try {
    value = JSON.parse(block.content[0].text)
  } catch {
    return undefined
  }
  const parsed = deliveryResultSchema.safeParse(value)
  if (!parsed.success) return undefined
  if (parsed.data.status === 'passed' && parsed.data.goal.phase !== 'complete') return undefined
  const reason = compactReason(parsed.data.reason)
  if (reason === '') return undefined
  const draftPrNumber = parsed.data.draftPr?.status === 'passed'
    ? parsed.data.draftPr.artifact?.number
    : undefined
  return {
    callId: String(call.data.callId),
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

function emptyMetricRollup(): DeliveryOutcomeMetricRollup {
  return {
    measured: 0,
    unmeasured: 0,
    attributedTurns: 0,
    closedSteps: 0,
    activeWallMs: 0,
    providerUsage: {
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    latency: {
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
    },
    monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
  }
}

function incrementMetrics(
  rollup: DeliveryOutcomeMetricRollup,
  metrics: GoalExecutionMetrics | undefined,
): void {
  if (metrics === undefined) {
    mutable(rollup).unmeasured += 1
    return
  }
  const target = mutable(rollup)
  target.measured += 1
  target.attributedTurns += metrics.attributedTurns
  target.closedSteps += metrics.closedSteps
  target.activeWallMs += metrics.activeWallMs
  target.providerUsage.uncachedInputTokens += metrics.providerUsage.uncachedInputTokens
  target.providerUsage.outputTokens += metrics.providerUsage.outputTokens
  target.providerUsage.cacheReadTokens += metrics.providerUsage.cacheReadTokens
  target.providerUsage.cacheWriteTokens += metrics.providerUsage.cacheWriteTokens
  target.latency.llmMs += metrics.latency.llmMs
  target.latency.toolMs += metrics.latency.toolMs
  target.latency.ttftMs += metrics.latency.ttftMs
  target.latency.ttftSteps += metrics.latency.ttftSteps
  target.latency.decodeMs += metrics.latency.decodeMs
  target.latency.decodeTokens += metrics.latency.decodeTokens
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] }

function mutable<T>(value: T): Mutable<T> {
  return value as Mutable<T>
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
