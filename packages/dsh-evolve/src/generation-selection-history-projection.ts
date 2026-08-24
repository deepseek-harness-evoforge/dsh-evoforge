import type {
  DeliveryOutcome,
  DeliveryOutcomeMetricRollup,
} from './delivery-outcome-monitor.ts'
import type {
  EvolutionGenerationSelectionHistoryView,
  EvolutionGenerationSelectionOutcomeBucketView,
  EvolutionGenerationSelectionOutcomeWindowView,
} from './control-types.ts'
import type { GenerationSelectionEvent } from './generation-store.ts'

const DEFAULT_MAX_ROWS = 20
type MutableDeliveryOutcomeMetricRollup = {
  -readonly [Key in keyof DeliveryOutcomeMetricRollup]: DeliveryOutcomeMetricRollup[Key]
}

/**
 * Project immutable pointer facts and bounded post-selection Outcome context.
 * The temporal association is descriptive and never grants mutation authority.
 */
export function projectGenerationSelectionHistory(
  events: readonly GenerationSelectionEvent[],
  outcomes?: readonly DeliveryOutcome[],
  maxRows = DEFAULT_MAX_ROWS,
): EvolutionGenerationSelectionHistoryView {
  const ordered = [...events]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const nextById = new Map(ordered.slice(0, -1).map((event, index) => [event.id, ordered[index + 1]!]))
  const previousById = new Map(ordered.slice(1).map((event, index) => [event.id, ordered[index]!]))
  return {
    totalCount: events.length,
    promotionCount: events.filter(event => event.kind === 'promotion').length,
    rollbackCount: events.filter(event => event.kind === 'rollback').length,
    canaryRollbackCount: events.filter(event => event.kind === 'rollback'
      && (event.evidence.authority === 'counterfactual-canary'
        || event.evidence.authority === 'existing-skill-counterfactual-canary')).length,
    explicitRollbackCount: events.filter(event => event.kind === 'rollback'
      && event.evidence.authority === 'explicit-human').length,
    items: ordered
      .slice(-maxRows)
      .reverse()
      .map(event => ({
        id: event.id,
        sequence: event.sequence,
        kind: event.kind,
        recordedAt: event.recordedAt,
        ...(event.previousGenerationId === undefined
          ? {}
          : { previousGenerationId: event.previousGenerationId }),
        ...(event.activeGenerationId === undefined
          ? {}
          : { activeGenerationId: event.activeGenerationId }),
        evidence: { ...event.evidence },
        ...(outcomes === undefined
          ? {}
          : {
              outcomeWindow: projectOutcomeWindow(
                event,
                previousById.get(event.id),
                nextById.get(event.id),
                outcomes,
              ),
            }),
      })),
    outcomeClaim: 'none',
    releaseAuthority: 'none',
  }
}

function projectOutcomeWindow(
  event: GenerationSelectionEvent,
  previous: GenerationSelectionEvent | undefined,
  next: GenerationSelectionEvent | undefined,
  outcomes: readonly DeliveryOutcome[],
): EvolutionGenerationSelectionOutcomeWindowView {
  if ((previous !== undefined && previous.recordedAt >= event.recordedAt)
    || (next !== undefined && next.recordedAt <= event.recordedAt)) {
    return {
      status: 'abstained',
      fromExclusive: event.recordedAt,
      ...(next === undefined ? {} : { untilExclusive: next.recordedAt }),
      reason: 'selection-time-not-strictly-increasing',
      coverage: 'bounded-retained-evidence',
      causalClaim: 'none',
      mutationAuthority: 'none',
    }
  }
  const workspaceOutcomes = outcomes.filter(outcome => outcome.workspaceId === event.workspaceId)
  const ambiguousBoundaryOutcomeCount = workspaceOutcomes.filter(outcome =>
    outcome.observedAt === event.recordedAt
      || (next !== undefined && outcome.observedAt === next.recordedAt)).length
  const inside = workspaceOutcomes.filter(outcome => outcome.observedAt > event.recordedAt
    && (next === undefined || outcome.observedAt < next.recordedAt))
  return {
    status: 'observed',
    fromExclusive: event.recordedAt,
    ...(next === undefined ? {} : { untilExclusive: next.recordedAt }),
    selected: summarizeBucket(inside.filter(outcome =>
      outcome.generationId === event.activeGenerationId)),
    previous: summarizeBucket(inside.filter(outcome =>
      outcome.generationId === event.previousGenerationId)),
    other: summarizeBucket(inside.filter(outcome =>
      outcome.generationId !== event.activeGenerationId
        && outcome.generationId !== event.previousGenerationId)),
    ambiguousBoundaryOutcomeCount,
    coverage: 'bounded-retained-evidence',
    causalClaim: 'none',
    mutationAuthority: 'none',
  }
}

function summarizeBucket(outcomes: readonly DeliveryOutcome[]): EvolutionGenerationSelectionOutcomeBucketView {
  const counts = { total: 0, passed: 0, failed: 0, unknown: 0 }
  const goalIds = new Set<string>()
  const metrics = emptyMetricRollup()
  for (const outcome of outcomes) {
    counts.total += 1
    counts[outcome.status] += 1
    goalIds.add(outcome.goal.id)
    incrementMetrics(metrics, outcome.goalMetrics)
  }
  return { counts, goalCount: goalIds.size, metrics }
}

function emptyMetricRollup(): MutableDeliveryOutcomeMetricRollup {
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
  rollup: MutableDeliveryOutcomeMetricRollup,
  metrics: DeliveryOutcome['goalMetrics'],
): void {
  if (metrics === undefined) {
    rollup.unmeasured += 1
    return
  }
  rollup.measured += 1
  rollup.attributedTurns += metrics.attributedTurns
  rollup.closedSteps += metrics.closedSteps
  rollup.activeWallMs += metrics.activeWallMs
  rollup.providerUsage.uncachedInputTokens += metrics.providerUsage.uncachedInputTokens
  rollup.providerUsage.outputTokens += metrics.providerUsage.outputTokens
  rollup.providerUsage.cacheReadTokens += metrics.providerUsage.cacheReadTokens
  rollup.providerUsage.cacheWriteTokens += metrics.providerUsage.cacheWriteTokens
  rollup.latency.llmMs += metrics.latency.llmMs
  rollup.latency.toolMs += metrics.latency.toolMs
  rollup.latency.ttftMs += metrics.latency.ttftMs
  rollup.latency.ttftSteps += metrics.latency.ttftSteps
  rollup.latency.decodeMs += metrics.latency.decodeMs
  rollup.latency.decodeTokens += metrics.latency.decodeTokens
}
