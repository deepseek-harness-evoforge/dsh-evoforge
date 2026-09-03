import { createHash } from 'node:crypto'
import { foldGoal } from '@deepseek-ai/dsh-goal'
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
  durableSkillInvocations,
  hashDurableSkillInvocationContent,
  type DurableSkillInvocation,
} from './durable-skill-invocation.ts'
import { sessionEvents } from './session-log.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const DEFAULT_MAX_RECORDS = 5_000
const MAX_SUMMARY_ITEMS = 20
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const skillUseContentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  observedAt: nonNegativeSafeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  generationId: hashSchema.optional(),
  skillName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  route: z.enum(['user-explicit', 'model-tool']),
  invocationSeq: nonNegativeSafeInteger,
  invocationContentHash: hashSchema,
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
})
const skillUseSchema = skillUseContentSchema.extend({ id: hashSchema })

const skillUseDomainSpec = defineDomain({
  name: 'evoforge_skill_uses',
  version: 1,
  tables: {
    uses: domainTable<string, SkillUse>(skillUseSchema),
  },
})

type SkillUseDomain = Domain<typeof skillUseDomainSpec>

export interface SkillUseInput {
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly generationId?: string | undefined
  readonly skillName: string
  readonly route: 'user-explicit' | 'model-tool'
  readonly invocationSeq: number
  readonly invocationContentHash: string
  readonly goal: {
    readonly id: string
    readonly revision: number
  }
}

export interface SkillUse extends SkillUseInput {
  readonly schemaVersion: 1
  readonly id: string
}

export interface SkillReuseCounts {
  readonly useCount: number
  readonly goalCount: number
  readonly skillVersionCount: number
  readonly crossGoalSkillVersionCount: number
}

export interface SkillReuseEvidence {
  readonly skillName: string
  readonly invocationContentHash: string
  readonly generationId?: string | undefined
  readonly useCount: number
  readonly goalCount: number
  readonly routes: {
    readonly userExplicit: number
    readonly modelTool: number
  }
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly status: 'observed' | 'cross-goal-observed'
  readonly causalClaim: 'none'
  readonly releaseAuthority: 'none'
}

export interface SkillReuseSummary {
  readonly all: SkillReuseCounts
  readonly selected: SkillReuseCounts
  readonly baseline?: SkillReuseCounts | undefined
  readonly items: readonly SkillReuseEvidence[]
}

export interface SkillUseStore {
  record(input: SkillUseInput): Promise<{ created: boolean; use: SkillUse }>
  list(workspaceId?: string): SkillUse[]
  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): SkillReuseSummary
  close(): Promise<void>
}

export interface SkillUseMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

class DomainSkillUseStore implements SkillUseStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: SkillUseDomain
  private readonly maxRecords: number

  constructor(domain: SkillUseDomain, maxRecords: number) {
    this.domain = domain
    this.maxRecords = maxRecords
  }

  record(input: SkillUseInput): Promise<{ created: boolean; use: SkillUse }> {
    if (this.closing !== undefined) return Promise.reject(new Error('Skill use store is closing'))
    const result = this.writeTail.then(() => this.recordNow(input))
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  list(workspaceId?: string): SkillUse[] {
    return [...this.domain.table('uses').entries()]
      .map(([, use]) => use)
      .filter(use => workspaceId === undefined || use.workspaceId === workspaceId)
      .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): SkillReuseSummary {
    const uses = this.list(workspaceId)
    const all = reuseCounts(uses)
    const selected = reuseCounts(uses.filter(use => use.generationId === selectedGenerationId))
    const baseline = options === undefined
      ? undefined
      : reuseCounts(uses.filter(use => use.generationId === options.baselineGenerationId))
    const items = groupedEvidence(uses).slice(0, MAX_SUMMARY_ITEMS)
    return immutableCopy({ all, selected, ...(baseline === undefined ? {} : { baseline }), items })
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private async recordNow(input: SkillUseInput): Promise<{ created: boolean; use: SkillUse }> {
    const content = skillUseContentSchema.parse({ schemaVersion: 1, ...input })
    const id = hashJson([content.workspaceId, content.sessionId, content.invocationSeq])
    const table = this.domain.table('uses')
    const existing = table.get(id)
    if (existing !== undefined) {
      const { id: _existingId, ...expected } = existing
      if (JSON.stringify(expected) !== JSON.stringify(content)) {
        throw new Error('exact Skill use source identity changed')
      }
      return { created: false, use: immutableCopy(existing) }
    }
    const use = immutableCopy(skillUseSchema.parse({ ...content, id }))
    await table.put(id, use)
    if (table.size > this.maxRecords) {
      const expired = [...table.entries()]
        .sort((left, right) => left[1].observedAt - right[1].observedAt
          || left[0].localeCompare(right[0]))
        .slice(0, table.size - this.maxRecords)
      for (const [expiredId] of expired) await table.delete(expiredId)
    }
    return { created: true, use }
  }
}

export async function openSkillUseStore(
  facility: DomainFacility,
  options: { readonly maxRecords?: number } = {},
): Promise<SkillUseStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('Skill use maxRecords must be a positive integer')
  }
  return new DomainSkillUseStore(await facility.open(skillUseDomainSpec), maxRecords)
}

function reuseCounts(uses: readonly SkillUse[]): SkillReuseCounts {
  const groups = groupUses(uses)
  return {
    useCount: uses.length,
    goalCount: new Set(uses.map(use => use.goal.id)).size,
    skillVersionCount: groups.size,
    crossGoalSkillVersionCount: [...groups.values()]
      .filter(group => group.goalIds.size >= 2).length,
  }
}

interface MutableReuseGroup {
  readonly skillName: string
  readonly invocationContentHash: string
  readonly generationId?: string | undefined
  useCount: number
  readonly goalIds: Set<string>
  readonly routes: { userExplicit: number; modelTool: number }
  firstObservedAt: number
  lastObservedAt: number
}

function groupUses(uses: readonly SkillUse[]): Map<string, MutableReuseGroup> {
  const groups = new Map<string, MutableReuseGroup>()
  for (const use of uses) {
    const key = JSON.stringify([use.generationId ?? null, use.skillName, use.invocationContentHash])
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        skillName: use.skillName,
        invocationContentHash: use.invocationContentHash,
        ...(use.generationId === undefined ? {} : { generationId: use.generationId }),
        useCount: 0,
        goalIds: new Set<string>(),
        routes: { userExplicit: 0, modelTool: 0 },
        firstObservedAt: use.observedAt,
        lastObservedAt: use.observedAt,
      }
      groups.set(key, group)
    }
    group.useCount += 1
    group.goalIds.add(use.goal.id)
    if (use.route === 'user-explicit') group.routes.userExplicit += 1
    else group.routes.modelTool += 1
    group.firstObservedAt = Math.min(group.firstObservedAt, use.observedAt)
    group.lastObservedAt = Math.max(group.lastObservedAt, use.observedAt)
  }
  return groups
}

function groupedEvidence(uses: readonly SkillUse[]): SkillReuseEvidence[] {
  return [...groupUses(uses).values()]
    .map(group => ({
      skillName: group.skillName,
      invocationContentHash: group.invocationContentHash,
      ...(group.generationId === undefined ? {} : { generationId: group.generationId }),
      useCount: group.useCount,
      goalCount: group.goalIds.size,
      routes: { ...group.routes },
      firstObservedAt: group.firstObservedAt,
      lastObservedAt: group.lastObservedAt,
      status: group.goalIds.size >= 2 ? 'cross-goal-observed' as const : 'observed' as const,
      causalClaim: 'none' as const,
      releaseAuthority: 'none' as const,
    }))
    .sort((left, right) => Number(right.status === 'cross-goal-observed')
      - Number(left.status === 'cross-goal-observed')
      || right.lastObservedAt - left.lastObservedAt
      || left.skillName.localeCompare(right.skillName)
      || left.invocationContentHash.localeCompare(right.invocationContentHash)
      || (left.generationId ?? '').localeCompare(right.generationId ?? ''))
}

/**
 * Project exact native Skill uses only after the owning Session crosses its
 * DSH durability checkpoint. The projection stores identity, never content.
 */
export function installSkillUseMonitor(
  ctx: Context,
  uses: SkillUseStore,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
): SkillUseMonitor {
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const replayed = new WeakSet<object>()

  const enqueue = (session: Session, invocation: DurableSkillInvocation, observedAt: number) => {
    if (disposed) return
    tail = tail.then(async () => {
      try {
        if (!(await ctx.sessions.flush(session))) {
          throw new Error('native Session has no durability checkpoint listener')
        }
        const events = sessionEvents(session).filter(event => event.seq <= invocation.seq)
        const goal = foldGoal(events).goal
        if (goal === undefined || goal.phase !== 'active') return
        const { id, createdAt, cwd } = session.header
        const workspaceId = await workspaceIdForCwd(ctx, cwd)
        const identity = {
          workspaceId,
          sessionId: String(id),
          createdAt,
          ...(cwd === undefined ? {} : { cwd }),
        }
        const generationId = evolution.getSessionGeneration(identity)?.id
        await uses.record({
          observedAt,
          workspaceId,
          sessionId: identity.sessionId,
          ...(generationId === undefined ? {} : { generationId }),
          skillName: invocation.skillName,
          route: invocation.route,
          invocationSeq: invocation.seq,
          invocationContentHash: hashDurableSkillInvocationContent(invocation.content),
          goal: { id: String(goal.id), revision: goal.revision },
        })
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one exact Skill use: ${errorMessage(error)}`)
      }
    })
  }

  const removeEvent = ctx.on('session/event', (session, event) => {
    for (const observation of observationsForEvent(session, event)) {
      enqueue(session, observation.invocation, observation.observedAt)
    }
  })
  const removePreStep = ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!replayed.has(agent)) {
      replayed.add(agent)
      for (const observation of durableObservations(agent.session)) {
        enqueue(agent.session, observation.invocation, observation.observedAt)
      }
      await tail
    }
    return next()
  })

  return {
    async flush() {
      await tail
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        removeEvent()
        removePreStep()
      }
      await tail
    },
  }
}

interface SkillUseObservation {
  readonly invocation: DurableSkillInvocation
  readonly observedAt: number
}

function observationsForEvent(
  session: Session,
  event: SessionEvent,
): SkillUseObservation[] {
  if (event.type === 'user/message') {
    return durableSkillInvocations(sessionEvents(session))
      .filter(invocation => invocation.route === 'user-explicit' && invocation.seq === Number(event.seq))
      .map(invocation => ({ invocation, observedAt: event.time }))
  }
  if (event.type !== 'tool/result') return []
  const sources = new Set((event.sourceEventSeqs ?? []).map(Number))
  return durableSkillInvocations(sessionEvents(session))
    .filter(invocation => invocation.route === 'model-tool' && sources.has(invocation.seq))
    .map(invocation => ({ invocation, observedAt: event.time }))
}

function durableObservations(session: Session): SkillUseObservation[] {
  const events = sessionEvents(session)
  return durableSkillInvocations(events).flatMap(invocation => {
    const observedAt = invocation.route === 'user-explicit'
      ? events.find(event => Number(event.seq) === invocation.seq)?.time
      : events.find(event =>
          event.type === 'tool/result'
          && event.sourceEventSeqs?.some(seq => Number(seq) === invocation.seq) === true)?.time
    return observedAt === undefined ? [] : [{ invocation, observedAt }]
  })
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
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
