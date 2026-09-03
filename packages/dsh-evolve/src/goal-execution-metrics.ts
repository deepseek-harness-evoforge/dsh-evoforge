import { SessionLogOffset, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-goal'
import { z } from 'zod'
import { sessionEvents } from './session-log.ts'

const tokenUsageSchema = z.strictObject({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
})

const sessionStatsSchema = z.strictObject({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
})

type TokenUsageProjection = z.infer<typeof tokenUsageSchema>
type SessionStatsProjection = z.infer<typeof sessionStatsSchema>

export const goalExecutionMetricsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.literal('dsh-session-projections'),
  goalId: z.string().min(1).max(256),
  throughEventSeq: z.number().int().nonnegative(),
  attributedTurns: z.number().int().positive(),
  closedSteps: z.number().int().nonnegative(),
  activeWallMs: z.number().int().nonnegative(),
  providerUsage: tokenUsageSchema,
  latency: sessionStatsSchema.omit({ turns: true, steps: true }),
  monetaryCost: z.strictObject({
    status: z.literal('unavailable'),
    reason: z.literal('provider-price-not-projected'),
  }),
})

export type GoalExecutionMetrics = z.infer<typeof goalExecutionMetricsSchema>

type ProjectionReader = Pick<SessionProjectionRegistry, 'restore'>

interface AttributedTurn {
  startSeq: number
  endSeq: number
  startTime: number
  endTime: number
}

interface ProjectionCut {
  usage: TokenUsageProjection
  stats: SessionStatsProjection
}

/**
 * Attribute exact native Goal-owned turns through one immutable Session event
 * and subtract DSH's own cumulative token/stats projections at each boundary.
 * Missing units, forged Goal attribution, ambiguous turn ownership, malformed
 * projection values, and counter regressions all abstain.
 */
export function projectGoalExecutionMetrics(
  session: Session,
  goalId: string,
  throughEventSeq: number,
  projections: ProjectionReader,
): GoalExecutionMetrics | undefined {
  if (goalId.length === 0 || goalId.length > 256
    || !Number.isSafeInteger(throughEventSeq) || throughEventSeq < 0) return undefined
  const events = sessionEvents(session)
  const throughEvent = events[throughEventSeq]
  if (throughEvent?.seq !== throughEventSeq) return undefined
  const selectedEvents = events.slice(0, throughEventSeq + 1)
  const turns = attributedTurns(selectedEvents, goalId)
  if (turns.length === 0) return undefined
  const cuts = projectionCuts(
    session,
    selectedEvents,
    turns.flatMap(turn => [turn.startSeq - 1, turn.endSeq]),
    projections,
  )
  if (cuts === undefined) return undefined

  const zero = zeroMetrics()
  let total = zero
  for (const turn of turns) {
    const before = cuts.get(turn.startSeq - 1)
    const after = cuts.get(turn.endSeq)
    if (before === undefined || after === undefined) return undefined
    const delta = subtractCut(after, before)
    if (delta === undefined) return undefined
    total = addMetrics(total, delta)
    total.activeWallMs += Math.max(0, turn.endTime - turn.startTime)
    total.attributedTurns += 1
  }

  const result = goalExecutionMetricsSchema.safeParse({
    schemaVersion: 1,
    source: 'dsh-session-projections',
    goalId,
    throughEventSeq,
    attributedTurns: total.attributedTurns,
    closedSteps: total.closedSteps,
    activeWallMs: total.activeWallMs,
    providerUsage: total.providerUsage,
    latency: total.latency,
    monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
  })
  return result.success ? result.data : undefined
}

function attributedTurns(
  events: readonly SessionEvent[],
  goalId: string,
): AttributedTurn[] {
  const selected: AttributedTurn[] = []
  let currentTargetRevision: number | undefined
  let open: {
    turn: number
    startSeq: number
    startTime: number
    owner: 'unknown' | 'target' | 'other' | 'ambiguous'
    revision?: number
  } | undefined

  for (const event of events) {
    if (event.type === 'goal/change' && event.data.kind === 'goal/change') {
      if (event.data.operation === 'clear') {
        if (String(event.data.cleared.id) === goalId) currentTargetRevision = undefined
      } else {
        currentTargetRevision = String(event.data.goal.id) === goalId
          && event.data.goal.phase === 'active'
          ? event.data.goal.revision
          : undefined
      }
    }
    if (event.type === 'turn/start') {
      open = {
        turn: event.data.turn,
        startSeq: event.seq,
        startTime: event.time,
        owner: 'unknown',
      }
      continue
    }
    if (open === undefined) continue
    if (event.type === 'user/message') {
      const source = event.data.source
      if (open.owner === 'unknown') {
        if (source.kind === 'goal'
          && String(source.goalId) === goalId
          && source.revision === currentTargetRevision) {
          open.owner = 'target'
          open.revision = source.revision
        } else {
          open.owner = 'other'
        }
      } else if (source.kind === 'goal' && open.owner === 'target'
        && (String(source.goalId) !== goalId || source.revision !== open.revision)) {
        open.owner = 'ambiguous'
      }
    }
    if (event.type === 'turn/end' && event.data.turn === open.turn) {
      if (open.owner === 'target') {
        selected.push({
          startSeq: open.startSeq,
          endSeq: event.seq,
          startTime: open.startTime,
          endTime: event.time,
        })
      }
      open = undefined
    }
  }

  if (open?.owner === 'target') {
    const end = events.at(-1)!
    selected.push({
      startSeq: open.startSeq,
      endSeq: end.seq,
      startTime: open.startTime,
      endTime: end.time,
    })
  }
  return selected
}

function projectionCuts(
  session: Session,
  events: readonly SessionEvent[],
  requested: readonly number[],
  projections: ProjectionReader,
): Map<number, ProjectionCut> | undefined {
  const boundaries = [...new Set(requested)].sort((left, right) => left - right)
  const cuts = new Map<number, ProjectionCut>()
  let checkpoint: ReturnType<ProjectionReader['restore']>['checkpoint'] = {}
  let baseSeq = 0
  for (const boundary of boundaries) {
    if (boundary < -1 || boundary >= events.length) return undefined
    const tail = boundary < baseSeq ? [] : events.slice(baseSeq, boundary + 1)
    let restored: ReturnType<ProjectionReader['restore']>
    try {
      restored = projections.restore(checkpoint, tail, SessionLogOffset(baseSeq), session.header, session.inheritedEventCount)
    } catch {
      return undefined
    }
    if (restored.snapshot.asOfSeq !== boundary) return undefined
    const values: Readonly<Record<string, unknown>> = restored.snapshot.values
    const usage = tokenUsageSchema.safeParse(values['tokenUsage'])
    const stats = sessionStatsSchema.safeParse(values['sessionStats'])
    if (!usage.success || !stats.success) return undefined
    cuts.set(boundary, { usage: usage.data, stats: stats.data })
    checkpoint = restored.checkpoint
    baseSeq = boundary + 1
  }
  return cuts
}

function subtractCut(after: ProjectionCut, before: ProjectionCut): MutableGoalMetrics | undefined {
  const values = {
    closedSteps: after.stats.steps - before.stats.steps,
    providerUsage: {
      uncachedInputTokens: after.usage.uncachedInputTokens - before.usage.uncachedInputTokens,
      outputTokens: after.usage.outputTokens - before.usage.outputTokens,
      cacheReadTokens: after.usage.cacheReadTokens - before.usage.cacheReadTokens,
      cacheWriteTokens: after.usage.cacheWriteTokens - before.usage.cacheWriteTokens,
    },
    latency: {
      llmMs: after.stats.llmMs - before.stats.llmMs,
      toolMs: after.stats.toolMs - before.stats.toolMs,
      ttftMs: after.stats.ttftMs - before.stats.ttftMs,
      ttftSteps: after.stats.ttftSteps - before.stats.ttftSteps,
      decodeMs: after.stats.decodeMs - before.stats.decodeMs,
      decodeTokens: after.stats.decodeTokens - before.stats.decodeTokens,
    },
  }
  if (flattenNumbers(values).some(value => !Number.isFinite(value) || value < 0)) return undefined
  return { attributedTurns: 0, activeWallMs: 0, ...values }
}

interface MutableGoalMetrics {
  attributedTurns: number
  closedSteps: number
  activeWallMs: number
  providerUsage: TokenUsageProjection
  latency: Omit<SessionStatsProjection, 'turns' | 'steps'>
}

function zeroMetrics(): MutableGoalMetrics {
  return {
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
  }
}

function addMetrics(left: MutableGoalMetrics, right: MutableGoalMetrics): MutableGoalMetrics {
  return {
    attributedTurns: left.attributedTurns + right.attributedTurns,
    closedSteps: left.closedSteps + right.closedSteps,
    activeWallMs: left.activeWallMs + right.activeWallMs,
    providerUsage: {
      uncachedInputTokens: left.providerUsage.uncachedInputTokens + right.providerUsage.uncachedInputTokens,
      outputTokens: left.providerUsage.outputTokens + right.providerUsage.outputTokens,
      cacheReadTokens: left.providerUsage.cacheReadTokens + right.providerUsage.cacheReadTokens,
      cacheWriteTokens: left.providerUsage.cacheWriteTokens + right.providerUsage.cacheWriteTokens,
    },
    latency: {
      llmMs: left.latency.llmMs + right.latency.llmMs,
      toolMs: left.latency.toolMs + right.latency.toolMs,
      ttftMs: left.latency.ttftMs + right.latency.ttftMs,
      ttftSteps: left.latency.ttftSteps + right.latency.ttftSteps,
      decodeMs: left.latency.decodeMs + right.latency.decodeMs,
      decodeTokens: left.latency.decodeTokens + right.latency.decodeTokens,
    },
  }
}

function flattenNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(flattenNumbers)
}
