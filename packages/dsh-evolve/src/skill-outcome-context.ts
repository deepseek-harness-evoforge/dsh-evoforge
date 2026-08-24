import type {
  DeliveryOutcome,
  DeliveryOutcomeMetricRollup,
  DeliveryOutcomeStore,
} from './delivery-outcome-monitor.ts'
import type { SkillUse, SkillUseStore } from './skill-use-monitor.ts'

const MAX_CONTEXT_ITEMS = 20
const REQUIRED_LATEST_FAILED_GOAL_CONTEXTS = 2

export interface ExactSkillBetweenAttemptWork {
  readonly transitionCount: number
  readonly ambiguousOrderGoalContextCount: number
  readonly metrics: DeliveryOutcomeMetricRollup
}

export interface ExactSkillFailureContextInvestigation {
  readonly status: 'insufficient-latest-failed-goals' | 'eligible-for-review'
  readonly latestFailedGoalContextCount: number
  readonly requiredLatestFailedGoalContextCount: 2
  readonly trigger: 'exact-cross-goal-unique-latest-failure'
  readonly causalClaim: 'none'
  readonly candidateAuthority: 'none'
  readonly releaseAuthority: 'none'
}

export interface ExactSkillFailureContextInvestigationRollup {
  readonly eligibleSkillVersionCount: number
  readonly latestFailedGoalContextCount: number
}

export interface ExactSkillOutcomeContextRollup {
  readonly skillVersionCount: number
  readonly goalContextCount: number
  readonly outcomeObservedGoalContextCount: number
  readonly outcomeUnobservedGoalContextCount: number
  readonly outcomeAttemptCount: number
  readonly repeatedOutcomeGoalContextCount: number
  readonly recoveredGoalContextCount: number
  readonly ambiguousLatestGoalContextCount: number
  readonly betweenAttempts: ExactSkillBetweenAttemptWork
  readonly failureInvestigations: ExactSkillFailureContextInvestigationRollup
  readonly latest: {
    readonly passed: number
    readonly failed: number
    readonly unknown: number
  }
  readonly metrics: DeliveryOutcomeMetricRollup
}

export interface ExactSkillOutcomeContextEvidence {
  readonly skillName: string
  readonly invocationContentHash: string
  readonly generationId?: string | undefined
  readonly useCount: number
  readonly goalContextCount: number
  readonly outcomeObservedGoalContextCount: number
  readonly outcomeUnobservedGoalContextCount: number
  readonly outcomeAttemptCount: number
  readonly repeatedOutcomeGoalContextCount: number
  readonly recoveredGoalContextCount: number
  readonly ambiguousLatestGoalContextCount: number
  readonly betweenAttempts: ExactSkillBetweenAttemptWork
  readonly failureInvestigation: ExactSkillFailureContextInvestigation
  readonly latest: ExactSkillOutcomeContextRollup['latest']
  readonly metrics: DeliveryOutcomeMetricRollup
  readonly attribution: 'same-session-goal-generation-after-use'
  readonly causalClaim: 'none'
  readonly improvementClaim: 'none'
  readonly releaseAuthority: 'none'
}

export interface ExactSkillOutcomeContextSummary {
  readonly all: ExactSkillOutcomeContextRollup
  readonly selected: ExactSkillOutcomeContextRollup
  readonly baseline?: ExactSkillOutcomeContextRollup | undefined
  readonly items: readonly ExactSkillOutcomeContextEvidence[]
}

export interface ExactSkillOutcomeContextReader {
  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): ExactSkillOutcomeContextSummary
}

export class ExactSkillOutcomeContextProjection implements ExactSkillOutcomeContextReader {
  private readonly skillUses: Pick<SkillUseStore, 'list'>
  private readonly deliveryOutcomes: Pick<DeliveryOutcomeStore, 'list'>

  constructor(
    skillUses: Pick<SkillUseStore, 'list'>,
    deliveryOutcomes: Pick<DeliveryOutcomeStore, 'list'>,
  ) {
    this.skillUses = skillUses
    this.deliveryOutcomes = deliveryOutcomes
  }

  summarize(
    workspaceId: string,
    selectedGenerationId?: string,
    options?: { readonly baselineGenerationId?: string },
  ): ExactSkillOutcomeContextSummary {
    return summarizeExactSkillOutcomeContext(
      this.skillUses.list(workspaceId),
      this.deliveryOutcomes.list(workspaceId),
      workspaceId,
      selectedGenerationId,
      options,
    )
  }
}

/**
 * Join two independently durable DSH facts without converting temporal
 * proximity into causality. Only exact cross-Goal Skill versions are shown.
 */
export function summarizeExactSkillOutcomeContext(
  skillUses: readonly SkillUse[],
  deliveryOutcomes: readonly DeliveryOutcome[],
  workspaceId: string,
  selectedGenerationId?: string,
  options?: { readonly baselineGenerationId?: string },
): ExactSkillOutcomeContextSummary {
  const uses = skillUses.filter(use => use.workspaceId === workspaceId)
  const outcomes = deliveryOutcomes.filter(outcome => outcome.workspaceId === workspaceId)
  const allItems = exactSkillGroups(uses)
    .filter(group => new Set(group.uses.map(use => use.goal.id)).size >= 2)
    .map(group => projectGroup(group, outcomes))
    .sort(compareEvidence)
  return immutableCopy({
    all: rollup(allItems),
    selected: rollup(allItems.filter(item => item.generationId === selectedGenerationId)),
    ...(options === undefined
      ? {}
      : { baseline: rollup(allItems.filter(item => item.generationId === options.baselineGenerationId)) }),
    items: allItems.slice(0, MAX_CONTEXT_ITEMS),
  })
}

interface ExactSkillGroup {
  readonly skillName: string
  readonly invocationContentHash: string
  readonly generationId?: string | undefined
  readonly uses: SkillUse[]
}

function exactSkillGroups(uses: readonly SkillUse[]): ExactSkillGroup[] {
  const groups = new Map<string, ExactSkillGroup>()
  for (const use of uses) {
    const key = JSON.stringify([use.generationId ?? null, use.skillName, use.invocationContentHash])
    let group = groups.get(key)
    if (group === undefined) {
      group = {
        skillName: use.skillName,
        invocationContentHash: use.invocationContentHash,
        ...(use.generationId === undefined ? {} : { generationId: use.generationId }),
        uses: [],
      }
      groups.set(key, group)
    }
    group.uses.push(use)
  }
  return [...groups.values()]
}

function projectGroup(
  group: ExactSkillGroup,
  outcomes: readonly DeliveryOutcome[],
): ExactSkillOutcomeContextEvidence {
  const contexts = goalContexts(group.uses).map(uses => projectGoalContext(uses, outcomes))
  const latest = { passed: 0, failed: 0, unknown: 0 }
  const metrics = emptyMetrics()
  for (const context of contexts) {
    if (context.latest !== undefined) {
      latest[context.latest.status] += 1
      incrementMetrics(metrics, context.latest)
    }
  }
  const latestFailedGoalContextCount = contexts.filter(
    context => context.latest?.status === 'failed',
  ).length
  return {
    skillName: group.skillName,
    invocationContentHash: group.invocationContentHash,
    ...(group.generationId === undefined ? {} : { generationId: group.generationId }),
    useCount: group.uses.length,
    goalContextCount: contexts.length,
    outcomeObservedGoalContextCount: contexts.filter(context => context.attemptCount > 0).length,
    outcomeUnobservedGoalContextCount: contexts.filter(context => context.attemptCount === 0).length,
    outcomeAttemptCount: contexts.reduce((sum, context) => sum + context.attemptCount, 0),
    repeatedOutcomeGoalContextCount: contexts.filter(context => context.attemptCount > 1).length,
    recoveredGoalContextCount: contexts.filter(context => context.recovered).length,
    ambiguousLatestGoalContextCount: contexts.filter(context => context.ambiguousLatest).length,
    betweenAttempts: rollupBetweenAttempts(contexts.map(context => context.betweenAttempts)),
    failureInvestigation: {
      status: latestFailedGoalContextCount >= REQUIRED_LATEST_FAILED_GOAL_CONTEXTS
        ? 'eligible-for-review'
        : 'insufficient-latest-failed-goals',
      latestFailedGoalContextCount,
      requiredLatestFailedGoalContextCount: REQUIRED_LATEST_FAILED_GOAL_CONTEXTS,
      trigger: 'exact-cross-goal-unique-latest-failure',
      causalClaim: 'none',
      candidateAuthority: 'none',
      releaseAuthority: 'none',
    },
    latest,
    metrics,
    attribution: 'same-session-goal-generation-after-use',
    causalClaim: 'none',
    improvementClaim: 'none',
    releaseAuthority: 'none',
  }
}

function goalContexts(uses: readonly SkillUse[]): SkillUse[][] {
  const contexts = new Map<string, SkillUse[]>()
  for (const use of uses) {
    const key = JSON.stringify([use.sessionId, use.goal.id])
    const group = contexts.get(key) ?? []
    group.push(use)
    contexts.set(key, group)
  }
  return [...contexts.values()]
}

interface ProjectedGoalContext {
  readonly attemptCount: number
  readonly latest?: DeliveryOutcome | undefined
  readonly recovered: boolean
  readonly ambiguousLatest: boolean
  readonly betweenAttempts: ExactSkillBetweenAttemptWork
}

function projectGoalContext(
  uses: readonly SkillUse[],
  outcomes: readonly DeliveryOutcome[],
): ProjectedGoalContext {
  const first = [...uses].sort((left, right) => left.observedAt - right.observedAt
    || left.invocationSeq - right.invocationSeq
    || left.id.localeCompare(right.id))[0]!
  const attempts = outcomes.filter(outcome =>
    outcome.sessionId === first.sessionId
      && outcome.goal.id === first.goal.id
      && outcome.generationId === first.generationId
      && outcome.observedAt >= first.observedAt
      && outcome.goal.revision >= first.goal.revision)
  const betweenAttempts = projectBetweenAttempts(attempts)
  if (attempts.length === 0) {
    return { attemptCount: 0, recovered: false, ambiguousLatest: false, betweenAttempts }
  }
  const latestObservedAt = Math.max(...attempts.map(outcome => outcome.observedAt))
  const latestCandidates = attempts.filter(outcome => outcome.observedAt === latestObservedAt)
  if (latestCandidates.length !== 1) {
    return {
      attemptCount: attempts.length,
      recovered: false,
      ambiguousLatest: true,
      betweenAttempts,
    }
  }
  const latest = latestCandidates[0]!
  return {
    attemptCount: attempts.length,
    latest,
    recovered: latest.status === 'passed' && attempts.some(outcome =>
      outcome.observedAt < latest.observedAt && outcome.status !== 'passed'),
    ambiguousLatest: false,
    betweenAttempts,
  }
}

function projectBetweenAttempts(
  attempts: readonly DeliveryOutcome[],
): ExactSkillBetweenAttemptWork {
  if (attempts.length < 2) return emptyBetweenAttempts()
  if (new Set(attempts.map(outcome => outcome.observedAt)).size !== attempts.length) {
    return {
      ...emptyBetweenAttempts(),
      ambiguousOrderGoalContextCount: 1,
    }
  }
  const ordered = [...attempts].sort((left, right) => left.observedAt - right.observedAt)
  const metrics = emptyMetrics()
  for (let index = 1; index < ordered.length; index += 1) {
    const delta = subtractGoalMetrics(ordered[index]!, ordered[index - 1]!)
    if (delta === undefined) {
      metrics.unmeasured += 1
    } else {
      metrics.measured += 1
      addMetricValues(metrics, delta)
    }
  }
  return {
    transitionCount: ordered.length - 1,
    ambiguousOrderGoalContextCount: 0,
    metrics,
  }
}

function subtractGoalMetrics(
  later: DeliveryOutcome,
  earlier: DeliveryOutcome,
): MetricValues | undefined {
  const after = later.goalMetrics
  const before = earlier.goalMetrics
  if (after === undefined || before === undefined
    || after.goalId !== later.goal.id
    || before.goalId !== earlier.goal.id
    || after.goalId !== before.goalId
    || after.source !== before.source
    || after.throughEventSeq <= before.throughEventSeq) return undefined
  const attributedTurns = subtractCounter(after.attributedTurns, before.attributedTurns)
  const closedSteps = subtractCounter(after.closedSteps, before.closedSteps)
  const activeWallMs = subtractCounter(after.activeWallMs, before.activeWallMs)
  const uncachedInputTokens = subtractCounter(
    after.providerUsage.uncachedInputTokens,
    before.providerUsage.uncachedInputTokens,
  )
  const outputTokens = subtractCounter(after.providerUsage.outputTokens, before.providerUsage.outputTokens)
  const cacheReadTokens = subtractCounter(
    after.providerUsage.cacheReadTokens,
    before.providerUsage.cacheReadTokens,
  )
  const cacheWriteTokens = subtractCounter(
    after.providerUsage.cacheWriteTokens,
    before.providerUsage.cacheWriteTokens,
  )
  const llmMs = subtractCounter(after.latency.llmMs, before.latency.llmMs)
  const toolMs = subtractCounter(after.latency.toolMs, before.latency.toolMs)
  const ttftMs = subtractCounter(after.latency.ttftMs, before.latency.ttftMs)
  const ttftSteps = subtractCounter(after.latency.ttftSteps, before.latency.ttftSteps)
  const decodeMs = subtractCounter(after.latency.decodeMs, before.latency.decodeMs)
  const decodeTokens = subtractCounter(after.latency.decodeTokens, before.latency.decodeTokens)
  const values = [
    attributedTurns,
    closedSteps,
    activeWallMs,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    llmMs,
    toolMs,
    ttftMs,
    ttftSteps,
    decodeMs,
    decodeTokens,
  ]
  if (values.some(value => value === undefined)) return undefined
  return {
    attributedTurns: attributedTurns!,
    closedSteps: closedSteps!,
    activeWallMs: activeWallMs!,
    providerUsage: {
      uncachedInputTokens: uncachedInputTokens!,
      outputTokens: outputTokens!,
      cacheReadTokens: cacheReadTokens!,
      cacheWriteTokens: cacheWriteTokens!,
    },
    latency: {
      llmMs: llmMs!,
      toolMs: toolMs!,
      ttftMs: ttftMs!,
      ttftSteps: ttftSteps!,
      decodeMs: decodeMs!,
      decodeTokens: decodeTokens!,
    },
  }
}

interface MetricValues {
  readonly attributedTurns: number
  readonly closedSteps: number
  readonly activeWallMs: number
  readonly providerUsage: DeliveryOutcomeMetricRollup['providerUsage']
  readonly latency: DeliveryOutcomeMetricRollup['latency']
}

function subtractCounter(after: number, before: number): number | undefined {
  if (!Number.isFinite(after) || !Number.isFinite(before) || after < before) return undefined
  return after - before
}

function rollup(items: readonly ExactSkillOutcomeContextEvidence[]): ExactSkillOutcomeContextRollup {
  const result = emptyRollup()
  result.skillVersionCount = items.length
  for (const item of items) {
    result.goalContextCount += item.goalContextCount
    result.outcomeObservedGoalContextCount += item.outcomeObservedGoalContextCount
    result.outcomeUnobservedGoalContextCount += item.outcomeUnobservedGoalContextCount
    result.outcomeAttemptCount += item.outcomeAttemptCount
    result.repeatedOutcomeGoalContextCount += item.repeatedOutcomeGoalContextCount
    result.recoveredGoalContextCount += item.recoveredGoalContextCount
    result.ambiguousLatestGoalContextCount += item.ambiguousLatestGoalContextCount
    addBetweenAttempts(result.betweenAttempts, item.betweenAttempts)
    result.failureInvestigations.latestFailedGoalContextCount +=
      item.failureInvestigation.latestFailedGoalContextCount
    if (item.failureInvestigation.status === 'eligible-for-review') {
      result.failureInvestigations.eligibleSkillVersionCount += 1
    }
    result.latest.passed += item.latest.passed
    result.latest.failed += item.latest.failed
    result.latest.unknown += item.latest.unknown
    addMetricRollup(result.metrics, item.metrics)
  }
  return result
}

function emptyRollup(): Mutable<ExactSkillOutcomeContextRollup> {
  return {
    skillVersionCount: 0,
    goalContextCount: 0,
    outcomeObservedGoalContextCount: 0,
    outcomeUnobservedGoalContextCount: 0,
    outcomeAttemptCount: 0,
    repeatedOutcomeGoalContextCount: 0,
    recoveredGoalContextCount: 0,
    ambiguousLatestGoalContextCount: 0,
    betweenAttempts: emptyBetweenAttempts(),
    failureInvestigations: {
      eligibleSkillVersionCount: 0,
      latestFailedGoalContextCount: 0,
    },
    latest: { passed: 0, failed: 0, unknown: 0 },
    metrics: emptyMetrics(),
  }
}

function emptyBetweenAttempts(): Mutable<ExactSkillBetweenAttemptWork> {
  return {
    transitionCount: 0,
    ambiguousOrderGoalContextCount: 0,
    metrics: emptyMetrics(),
  }
}

function rollupBetweenAttempts(
  items: readonly ExactSkillBetweenAttemptWork[],
): ExactSkillBetweenAttemptWork {
  const result = emptyBetweenAttempts()
  for (const item of items) addBetweenAttempts(result, item)
  return result
}

function addBetweenAttempts(
  target: Mutable<ExactSkillBetweenAttemptWork>,
  source: ExactSkillBetweenAttemptWork,
): void {
  target.transitionCount += source.transitionCount
  target.ambiguousOrderGoalContextCount += source.ambiguousOrderGoalContextCount
  addMetricRollup(target.metrics, source.metrics)
}

function emptyMetrics(): Mutable<DeliveryOutcomeMetricRollup> {
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
  rollup: Mutable<DeliveryOutcomeMetricRollup>,
  outcome: DeliveryOutcome,
): void {
  const metrics = outcome.goalMetrics?.goalId === outcome.goal.id ? outcome.goalMetrics : undefined
  if (metrics === undefined) {
    rollup.unmeasured += 1
    return
  }
  rollup.measured += 1
  addMetricValues(rollup, metrics)
}

function addMetricValues(
  rollup: Mutable<DeliveryOutcomeMetricRollup>,
  metrics: MetricValues,
): void {
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

function addMetricRollup(
  target: Mutable<DeliveryOutcomeMetricRollup>,
  source: DeliveryOutcomeMetricRollup,
): void {
  target.measured += source.measured
  target.unmeasured += source.unmeasured
  target.attributedTurns += source.attributedTurns
  target.closedSteps += source.closedSteps
  target.activeWallMs += source.activeWallMs
  target.providerUsage.uncachedInputTokens += source.providerUsage.uncachedInputTokens
  target.providerUsage.outputTokens += source.providerUsage.outputTokens
  target.providerUsage.cacheReadTokens += source.providerUsage.cacheReadTokens
  target.providerUsage.cacheWriteTokens += source.providerUsage.cacheWriteTokens
  target.latency.llmMs += source.latency.llmMs
  target.latency.toolMs += source.latency.toolMs
  target.latency.ttftMs += source.latency.ttftMs
  target.latency.ttftSteps += source.latency.ttftSteps
  target.latency.decodeMs += source.latency.decodeMs
  target.latency.decodeTokens += source.latency.decodeTokens
}

function compareEvidence(
  left: ExactSkillOutcomeContextEvidence,
  right: ExactSkillOutcomeContextEvidence,
): number {
  return Number(right.failureInvestigation.status === 'eligible-for-review')
    - Number(left.failureInvestigation.status === 'eligible-for-review')
    || right.outcomeObservedGoalContextCount - left.outcomeObservedGoalContextCount
    || right.goalContextCount - left.goalContextCount
    || left.skillName.localeCompare(right.skillName)
    || left.invocationContentHash.localeCompare(right.invocationContentHash)
    || (left.generationId ?? '').localeCompare(right.generationId ?? '')
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] }

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
