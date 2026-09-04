import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { CapabilityMap } from './capability-map.ts'
import { sessionIdentityOf } from './generation-binder.ts'
import type { EvolutionStore } from './generation-store.ts'

const DEFAULT_MAX_RECORDS = 1_000
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const evidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('native-skill-miss'),
    catalog: z.literal('complete'),
    routing: z.literal('requested-skill-absent'),
    providers: z.literal('settled'),
  }),
  z.strictObject({
    kind: z.literal('model-declared-skill-gap'),
    catalog: z.literal('complete'),
    routing: z.literal('model-declared-no-applicable-skill'),
    providers: z.literal('settled'),
  }),
])

const gapSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: hashSchema,
  observedAt: safeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  requestedSkill: z.string().min(1).max(128),
  catalogHash: hashSchema,
  catalogSize: safeInteger,
  generationId: hashSchema.optional(),
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: safeInteger,
    objective: z.string().min(1).max(8_192),
  }).optional(),
  /**
   * A durable decision that this observation is not eligible for the legacy
   * Goal-qualified authoring loop.  It is optional so schema-version 1 rows
   * written before the conversation-first transition remain readable.
   */
  abstention: z.strictObject({
    reason: z.literal('missing-native-goal'),
  }).optional(),
  status: z.literal('confirmed'),
  evidence: evidenceSchema,
})

export type CapabilityGap = z.infer<typeof gapSchema>
export type CapabilityGapAbstentionReason = 'missing-native-goal'

export interface CapabilityGapInput {
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly requestedSkill: string
  readonly catalogHash: string
  readonly catalogSize: number
  readonly generationId?: string | undefined
  readonly goal?: {
    readonly id: string
    readonly revision: number
    readonly objective: string
  } | undefined
  readonly abstention?: {
    readonly reason: CapabilityGapAbstentionReason
  } | undefined
  readonly evidence: CapabilityGap['evidence']
}

export interface CapabilityGapStore {
  record(input: CapabilityGapInput): Promise<{ created: boolean; gap: CapabilityGap }>
  list(workspaceId?: string): CapabilityGap[]
  close(): Promise<void>
}

export interface CapabilityGapMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

const gapDomainSpec = defineDomain({
  name: 'evoforge_capability_gaps',
  version: 1,
  tables: {
    gaps: domainTable<string, CapabilityGap>(gapSchema),
  },
})

type CapabilityGapDomain = Domain<typeof gapDomainSpec>

class DomainCapabilityGapStore implements CapabilityGapStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: CapabilityGapDomain
  private readonly maxRecords: number

  constructor(
    domain: CapabilityGapDomain,
    maxRecords: number,
  ) {
    this.domain = domain
    this.maxRecords = maxRecords
  }

  record(input: CapabilityGapInput): Promise<{ created: boolean; gap: CapabilityGap }> {
    let captured: CapabilityGapInput
    try {
      captured = structuredClone(input)
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      const id = gapId(captured)
      const table = this.domain.table('gaps')
      const existing = table.get(id)
      if (existing !== undefined) return { created: false, gap: immutableCopy(existing) }
      const gap = immutableCopy(gapSchema.parse({
        schemaVersion: 1,
        id,
        ...captured,
        status: 'confirmed',
      }))
      await table.put(id, gap)
      if (table.size > this.maxRecords) {
        const expired = [...table.entries()]
          .sort((left, right) => left[1].observedAt - right[1].observedAt
            || left[0].localeCompare(right[0]))
          .slice(0, table.size - this.maxRecords)
        for (const [expiredId] of expired) await table.delete(expiredId)
      }
      return { created: true, gap }
    })
  }

  list(workspaceId?: string): CapabilityGap[] {
    return [...this.domain.table('gaps').entries()]
      .map(([, gap]) => gap)
      .filter(gap => workspaceId === undefined || gap.workspaceId === workspaceId)
      .sort((left, right) => right.observedAt - left.observedAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('capability gap store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

export async function openCapabilityGapStore(
  facility: DomainFacility,
  options: { maxRecords?: number } = {},
): Promise<CapabilityGapStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('capability gap maxRecords must be a positive integer')
  }
  return new DomainCapabilityGapStore(await facility.open(gapDomainSpec), maxRecords)
}

/**
 * Record only an exact native Skill miss against a complete Session catalog.
 * Generic Tool failures and incomplete catalogs are deliberately not gaps.
 */
export function installCapabilityGapMonitor(
  ctx: Context,
  gaps: Pick<CapabilityGapStore, 'record'>,
  capabilities: Pick<CapabilityMap, 'snapshot'>,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
  options: {
    now?: () => number
    onGap?: (gap: CapabilityGap) => Promise<void> | void
  } = {},
): CapabilityGapMonitor {
  const now = options.now ?? Date.now
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const remove = ctx.on('tools/result', (execution, result) => {
    if (disposed || execution.name !== 'skill' || execution.agent === undefined || !result.isError) return
    const requestedSkill = requestedSkillName(execution.arguments)
    if (requestedSkill === undefined) return
    tail = tail.then(async () => {
      try {
        const identity = await sessionIdentityOf(ctx, execution.agent!)
        const catalog = capabilities.snapshot(identity.workspaceId, identity.sessionId)
        if (catalog.status !== 'complete'
          || catalog.catalogHash === undefined
          || catalog.capabilities.some(capability => capability.name === requestedSkill)) return
        const generationId = evolution.getSessionGeneration(identity)?.id
        const goal = currentGoal(ctx, execution.agent!)
        const recorded = await gaps.record({
          observedAt: now(),
          workspaceId: identity.workspaceId,
          sessionId: identity.sessionId,
          requestedSkill,
          catalogHash: catalog.catalogHash,
          catalogSize: catalog.capabilities.length,
          ...(generationId === undefined ? {} : { generationId }),
          ...(goal === undefined
            ? { abstention: { reason: 'missing-native-goal' as const } }
            : { goal }),
          evidence: {
            kind: 'native-skill-miss',
            catalog: 'complete',
            routing: 'requested-skill-absent',
            providers: 'settled',
          },
        })
        // A no-Goal observation is durable evidence for the Interaction-first
        // path, but it cannot enter the legacy Goal-qualified authoring loop.
        if (recorded.created && goal !== undefined) await options.onGap?.(recorded.gap)
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one Capability Gap observation: ${errorMessage(error)}`)
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

function requestedSkillName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const name = (value as Readonly<Record<string, unknown>>).name
  return typeof name === 'string' && isSkillName(name) ? name : undefined
}

function currentGoal(
  ctx: Context,
  agent: Agent,
): CapabilityGapInput['goal'] | undefined {
  const goalService = (ctx as unknown as {
    get(name: string): { get(agent: Agent): unknown } | undefined
  }).get('goals')
  if (goalService === undefined) return undefined
  try {
    const value = goalService.get(agent)
    if (typeof value !== 'object' || value === null) return undefined
    const goal = value as Readonly<Record<string, unknown>>
    if (typeof goal.id !== 'string'
      || !Number.isSafeInteger(goal.revision)
      || typeof goal.objective !== 'string') return undefined
    return { id: goal.id, revision: goal.revision as number, objective: goal.objective }
  } catch {
    return undefined
  }
}

function gapId(input: CapabilityGapInput): string {
  return createHash('sha256').update(JSON.stringify([
    input.workspaceId,
    input.sessionId,
    input.requestedSkill,
    input.catalogHash,
    input.generationId ?? null,
    input.goal?.id ?? null,
    input.goal?.revision ?? null,
  ])).digest('hex')
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
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
