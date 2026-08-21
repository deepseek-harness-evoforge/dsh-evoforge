import { describe, expect, it } from 'vitest'
import {
  summarizeExactSkillOutcomeContext,
  type ExactSkillOutcomeContextSummary,
} from '../src/skill-outcome-context.js'
import type { DeliveryOutcome } from '../src/delivery-outcome-monitor.js'
import type { SkillUse } from '../src/skill-use-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationA = 'a'.repeat(64)
const generationB = 'b'.repeat(64)
const contentA = '1'.repeat(64)
const contentB = '2'.repeat(64)

describe('exact Skill Outcome Context', () => {
  it('joins only later same-Session Goal outcomes for one exact cross-Goal Skill version', () => {
    const summary = summarizeExactSkillOutcomeContext(
      [
        use('session-a', 1, 10, 'goal-1', 1, generationA, contentA),
        use('session-a', 2, 12, 'goal-1', 1, generationA, contentA),
        use('session-b', 1, 20, 'goal-2', 1, generationA, contentA),
        use('session-c', 1, 30, 'goal-3', 2, generationA, contentA),
        use('session-d', 1, 40, 'goal-4', 1, generationA, contentB),
      ],
      [
        outcome('before-use', 'session-b', 19, 'goal-2', 1, generationA, 'passed'),
        outcome('goal-1-failed', 'session-a', 11, 'goal-1', 1, generationA, 'failed', metrics('goal-1', 4)),
        outcome('goal-1-passed', 'session-a', 15, 'goal-1', 2, generationA, 'passed', metrics('goal-1', 10)),
        outcome('goal-2-unknown', 'session-b', 21, 'goal-2', 1, generationA, 'unknown', metrics('goal-2', 20)),
        outcome('older-revision', 'session-c', 31, 'goal-3', 1, generationA, 'failed'),
        outcome('other-generation', 'session-c', 32, 'goal-3', 2, generationB, 'passed'),
        outcome('other-session', 'session-z', 33, 'goal-3', 2, generationA, 'passed'),
      ],
      WORKSPACE_ID,
      generationA,
      { baselineGenerationId: generationB },
    )

    expect(summary).toEqual<ExactSkillOutcomeContextSummary>({
      all: rollup({
        skillVersionCount: 1,
        goalContextCount: 3,
        outcomeObservedGoalContextCount: 2,
        outcomeUnobservedGoalContextCount: 1,
        outcomeAttemptCount: 3,
        repeatedOutcomeGoalContextCount: 1,
        recoveredGoalContextCount: 1,
        ambiguousLatestGoalContextCount: 0,
        betweenAttempts: betweenAttempts({ transitionCount: 1, metricSeed: 6, metricMeasured: 1 }),
        latest: { passed: 1, failed: 0, unknown: 1 },
        metricSeed: 30,
      }),
      selected: rollup({
        skillVersionCount: 1,
        goalContextCount: 3,
        outcomeObservedGoalContextCount: 2,
        outcomeUnobservedGoalContextCount: 1,
        outcomeAttemptCount: 3,
        repeatedOutcomeGoalContextCount: 1,
        recoveredGoalContextCount: 1,
        ambiguousLatestGoalContextCount: 0,
        betweenAttempts: betweenAttempts({ transitionCount: 1, metricSeed: 6, metricMeasured: 1 }),
        latest: { passed: 1, failed: 0, unknown: 1 },
        metricSeed: 30,
      }),
      baseline: rollup({}),
      items: [{
        skillName: 'release-dsh-plugin',
        invocationContentHash: contentA,
        generationId: generationA,
        useCount: 4,
        goalContextCount: 3,
        outcomeObservedGoalContextCount: 2,
        outcomeUnobservedGoalContextCount: 1,
        outcomeAttemptCount: 3,
        repeatedOutcomeGoalContextCount: 1,
        recoveredGoalContextCount: 1,
        ambiguousLatestGoalContextCount: 0,
        betweenAttempts: betweenAttempts({ transitionCount: 1, metricSeed: 6, metricMeasured: 1 }),
        latest: { passed: 1, failed: 0, unknown: 1 },
        metrics: metricRollup(30),
        attribution: 'same-session-goal-generation-after-use',
        causalClaim: 'none',
        improvementClaim: 'none',
        releaseAuthority: 'none',
      }],
    })
  })

  it('abstains from latest status, recovery, and metrics when the latest durable fact is ambiguous', () => {
    const summary = summarizeExactSkillOutcomeContext(
      [
        use('session-a', 1, 10, 'goal-1', 1, generationA, contentA),
        use('session-b', 1, 20, 'goal-2', 1, generationA, contentA),
      ],
      [
        outcome('goal-1-failed', 'session-a', 11, 'goal-1', 1, generationA, 'failed'),
        outcome('goal-1-passed', 'session-a', 11, 'goal-1', 2, generationA, 'passed', metrics('goal-1', 10)),
        outcome('goal-2-passed', 'session-b', 21, 'goal-2', 1, generationA, 'passed', metrics('goal-2', 20)),
      ],
      WORKSPACE_ID,
      generationA,
    )

    expect(summary.all).toEqual(rollup({
      skillVersionCount: 1,
      goalContextCount: 2,
      outcomeObservedGoalContextCount: 2,
      outcomeAttemptCount: 3,
      repeatedOutcomeGoalContextCount: 1,
      ambiguousLatestGoalContextCount: 1,
      betweenAttempts: betweenAttempts({ ambiguousOrderGoalContextCount: 1 }),
      latest: { passed: 1, failed: 0, unknown: 0 },
      metricSeed: 20,
      metricMeasured: 1,
    }))
    expect(summary.items[0]).toMatchObject({
      recoveredGoalContextCount: 0,
      ambiguousLatestGoalContextCount: 1,
      causalClaim: 'none',
      improvementClaim: 'none',
      releaseAuthority: 'none',
    })
  })

  it('counts ordered transitions but abstains from deltas when metrics are missing or regress', () => {
    const summary = summarizeExactSkillOutcomeContext(
      [
        use('session-a', 1, 10, 'goal-1', 1, generationA, contentA),
        use('session-b', 1, 20, 'goal-2', 1, generationA, contentA),
      ],
      [
        outcome('goal-1-failed', 'session-a', 11, 'goal-1', 1, generationA, 'failed', metrics('goal-1', 10)),
        outcome('goal-1-passed', 'session-a', 12, 'goal-1', 2, generationA, 'passed', metrics('goal-1', 8)),
        outcome('goal-2-failed', 'session-b', 21, 'goal-2', 1, generationA, 'failed'),
        outcome('goal-2-passed', 'session-b', 22, 'goal-2', 2, generationA, 'passed', metrics('goal-2', 20)),
      ],
      WORKSPACE_ID,
      generationA,
    )

    expect(summary.all.betweenAttempts).toEqual(betweenAttempts({
      transitionCount: 2,
      metricMeasured: 0,
      metricUnmeasured: 2,
    }))
    expect(summary.items[0]).toMatchObject({
      recoveredGoalContextCount: 2,
      causalClaim: 'none',
      improvementClaim: 'none',
      releaseAuthority: 'none',
    })
  })

  it('keeps Workspace rollups complete while bounding detailed evidence rows', () => {
    const uses = Array.from({ length: 21 }, (_, version) => {
      const contentHash = version.toString(16).padStart(64, '0')
      return [
        use(`session-${version}-a`, 1, version * 10 + 1, `goal-${version}-a`, 1, generationA, contentHash),
        use(`session-${version}-b`, 1, version * 10 + 2, `goal-${version}-b`, 1, generationA, contentHash),
      ]
    }).flat()

    const summary = summarizeExactSkillOutcomeContext(uses, [], WORKSPACE_ID, generationA)

    expect(summary.all.skillVersionCount).toBe(21)
    expect(summary.all.goalContextCount).toBe(42)
    expect(summary.selected.skillVersionCount).toBe(21)
    expect(summary.items).toHaveLength(20)
  })
})

function use(
  sessionId: string,
  invocationSeq: number,
  observedAt: number,
  goalId: string,
  goalRevision: number,
  generationId: string,
  invocationContentHash: string,
): SkillUse {
  return {
    schemaVersion: 1,
    id: `${sessionId}-${invocationSeq}`.padEnd(64, '0').slice(0, 64),
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId,
    generationId,
    skillName: 'release-dsh-plugin',
    route: 'model-tool',
    invocationSeq,
    invocationContentHash,
    goal: { id: goalId, revision: goalRevision },
  }
}

function outcome(
  id: string,
  sessionId: string,
  observedAt: number,
  goalId: string,
  goalRevision: number,
  generationId: string,
  status: DeliveryOutcome['status'],
  goalMetrics?: DeliveryOutcome['goalMetrics'],
): DeliveryOutcome {
  return {
    schemaVersion: 2,
    id: id.padEnd(64, '0').slice(0, 64),
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId,
    callId: id,
    generationId,
    goal: { id: goalId, revision: goalRevision, phase: status === 'passed' ? 'complete' : 'active' },
    status,
    reason: id,
    ...(goalMetrics === undefined ? {} : { goalMetrics }),
  }
}

function metrics(goalId: string, seed: number): NonNullable<DeliveryOutcome['goalMetrics']> {
  return {
    schemaVersion: 1,
    source: 'dsh-session-projections',
    goalId,
    throughEventSeq: seed,
    attributedTurns: seed,
    closedSteps: seed,
    activeWallMs: seed,
    providerUsage: {
      uncachedInputTokens: seed,
      outputTokens: seed,
      cacheReadTokens: seed,
      cacheWriteTokens: seed,
    },
    latency: {
      llmMs: seed,
      toolMs: seed,
      ttftMs: seed,
      ttftSteps: seed,
      decodeMs: seed,
      decodeTokens: seed,
    },
    monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
  }
}

function rollup(input: {
  skillVersionCount?: number
  goalContextCount?: number
  outcomeObservedGoalContextCount?: number
  outcomeUnobservedGoalContextCount?: number
  outcomeAttemptCount?: number
  repeatedOutcomeGoalContextCount?: number
  recoveredGoalContextCount?: number
  ambiguousLatestGoalContextCount?: number
  betweenAttempts?: ReturnType<typeof betweenAttempts>
  latest?: { passed: number; failed: number; unknown: number }
  metricSeed?: number
  metricMeasured?: number
}) {
  return {
    skillVersionCount: input.skillVersionCount ?? 0,
    goalContextCount: input.goalContextCount ?? 0,
    outcomeObservedGoalContextCount: input.outcomeObservedGoalContextCount ?? 0,
    outcomeUnobservedGoalContextCount: input.outcomeUnobservedGoalContextCount ?? 0,
    outcomeAttemptCount: input.outcomeAttemptCount ?? 0,
    repeatedOutcomeGoalContextCount: input.repeatedOutcomeGoalContextCount ?? 0,
    recoveredGoalContextCount: input.recoveredGoalContextCount ?? 0,
    ambiguousLatestGoalContextCount: input.ambiguousLatestGoalContextCount ?? 0,
    betweenAttempts: input.betweenAttempts ?? betweenAttempts(),
    latest: input.latest ?? { passed: 0, failed: 0, unknown: 0 },
    metrics: metricRollup(input.metricSeed, input.metricMeasured),
  }
}

function betweenAttempts(input: {
  transitionCount?: number
  ambiguousOrderGoalContextCount?: number
  metricSeed?: number
  metricMeasured?: number
  metricUnmeasured?: number
} = {}) {
  return {
    transitionCount: input.transitionCount ?? 0,
    ambiguousOrderGoalContextCount: input.ambiguousOrderGoalContextCount ?? 0,
    metrics: {
      ...metricRollup(input.metricSeed, input.metricMeasured),
      unmeasured: input.metricUnmeasured ?? 0,
    },
  }
}

function metricRollup(seed?: number, measured?: number) {
  const value = seed ?? 0
  return {
    measured: measured ?? (seed === undefined ? 0 : 2),
    unmeasured: 0,
    attributedTurns: value,
    closedSteps: value,
    activeWallMs: value,
    providerUsage: {
      uncachedInputTokens: value,
      outputTokens: value,
      cacheReadTokens: value,
      cacheWriteTokens: value,
    },
    latency: {
      llmMs: value,
      toolMs: value,
      ttftMs: value,
      ttftSteps: value,
      decodeMs: value,
      decodeTokens: value,
    },
    monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
  }
}
