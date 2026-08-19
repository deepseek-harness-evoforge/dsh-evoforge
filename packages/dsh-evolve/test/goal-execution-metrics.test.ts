import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  createMessage,
  createToolResultMessage,
  createUserMessage,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { GoalId } from '@deepseek-ai/dsh-goal'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStats from '@deepseek-ai/dsh-session-stats'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import {
  installDeliveryOutcomeMonitor,
  type DeliveryOutcomeStore,
} from '../src/delivery-outcome-monitor.ts'
import { projectGoalExecutionMetrics } from '../src/goal-execution-metrics.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const targetGoalId = GoalId('goal-target')
const otherGoalId = GoalId('goal-other')
let now: ReturnType<typeof vi.spyOn>
const contexts: Context[] = []

beforeEach(() => {
  now = vi.spyOn(Date, 'now').mockReturnValue(0)
})

afterEach(async () => {
  now.mockRestore()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('Goal execution metrics', () => {
  it('subtracts official DSH projection cuts for only exact stable-Goal turns', async () => {
    const { ctx, session } = await harness(true)
    appendGoalChange(session, 800, otherGoalId, 1, 'create')
    appendTurn(session, {
      turn: 1,
      startAt: 1_000,
      owner: { kind: 'goal', goalId: otherGoalId, revision: 1, round: 1 },
      usage: { inputTokens: 500, outputTokens: 60, cacheReadTokens: 70 },
    })
    appendGoalClear(session, 1_800, otherGoalId, 2)
    appendGoalChange(session, 1_900, targetGoalId, 1, 'create')
    appendTurn(session, {
      turn: 2,
      startAt: 2_000,
      owner: { kind: 'goal', goalId: targetGoalId, revision: 1, round: 1 },
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 30, cacheWriteTokens: 5 },
      toolDurationMs: 20,
    })
    appendTurn(session, {
      turn: 3,
      startAt: 3_000,
      owner: { kind: 'user' },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 2 },
    })
    appendGoalChange(session, 3_900, targetGoalId, 2, 'edit', 1_900)
    const through = appendTurn(session, {
      turn: 4,
      startAt: 4_000,
      owner: { kind: 'goal', goalId: targetGoalId, revision: 2, round: 2 },
      usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 40 },
      toolDurationMs: 30,
      leaveOpenAtToolResult: true,
    })

    const projected = projectGoalExecutionMetrics(
      session,
      String(targetGoalId),
      through,
      ctx.sessionProjections,
    )

    expect(projected).toEqual({
      schemaVersion: 1,
      source: 'dsh-session-projections',
      goalId: 'goal-target',
      throughEventSeq: through,
      attributedTurns: 2,
      closedSteps: 1,
      activeWallMs: 300,
      providerUsage: {
        uncachedInputTokens: 30,
        outputTokens: 9,
        cacheReadTokens: 70,
        cacheWriteTokens: 5,
      },
      latency: {
        llmMs: 180,
        toolMs: 50,
        ttftMs: 45,
        ttftSteps: 2,
        decodeMs: 135,
        decodeTokens: 9,
      },
      monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
    })

    appendTurn(session, {
      turn: 5,
      startAt: 9_000,
      owner: { kind: 'user' },
      usage: { inputTokens: 999, outputTokens: 999, cacheReadTokens: 999 },
    })
    expect(projectGoalExecutionMetrics(
      session,
      String(targetGoalId),
      through,
      ctx.sessionProjections,
    )).toEqual(projected)
  })

  it('abstains without the official projections, a durable Goal, or an unambiguous owning message', async () => {
    const withoutUnits = await harness(false)
    appendGoalChange(withoutUnits.session, 100, targetGoalId, 1, 'create')
    const noUnitsThrough = appendTurn(withoutUnits.session, {
      turn: 1,
      startAt: 200,
      owner: { kind: 'goal', goalId: targetGoalId, revision: 1, round: 1 },
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(projectGoalExecutionMetrics(
      withoutUnits.session,
      String(targetGoalId),
      noUnitsThrough,
      withoutUnits.ctx.sessionProjections,
    )).toBeUndefined()

    const noGoal = await harness(true)
    const noGoalThrough = appendTurn(noGoal.session, {
      turn: 1,
      startAt: 300,
      owner: { kind: 'goal', goalId: targetGoalId, revision: 1, round: 1 },
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    expect(projectGoalExecutionMetrics(
      noGoal.session,
      String(targetGoalId),
      noGoalThrough,
      noGoal.ctx.sessionProjections,
    )).toBeUndefined()

    const ambiguous = await harness(true)
    appendGoalChange(ambiguous.session, 400, targetGoalId, 1, 'create')
    at(500, () => ambiguous.session.append('turn/start', { turn: 1 }))
    at(510, () => ambiguous.session.append('step/start', { turn: 1, step: 1 }))
    at(520, () => ambiguous.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'target owns this turn first' }],
      source: { kind: 'goal', goalId: targetGoalId, revision: 1, round: 1 },
    }), { surfaceOp: 'append' }))
    const conflictingGoal = at(530, () => ambiguous.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'another Goal conflicts with ownership' }],
      source: { kind: 'goal', goalId: otherGoalId, revision: 1, round: 1 },
    }), { surfaceOp: 'append' }))
    expect(projectGoalExecutionMetrics(
      ambiguous.session,
      String(targetGoalId),
      conflictingGoal.seq,
      ambiguous.ctx.sessionProjections,
    )).toBeUndefined()
  })

  it('attaches the exact through-result projection to a durable Delivery Outcome', async () => {
    const { ctx, session } = await harness(true, '/repo')
    installWorkspaceFixture(ctx)
    ctx.on('session/flush', () => undefined)
    const outcomes = fakeOutcomes()
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, {
      getSessionGeneration: () => undefined,
    } as unknown as EvolutionStore)
    appendGoalChange(session, 900, targetGoalId, 1, 'create')

    const through = appendTurn(session, {
      turn: 1,
      startAt: 1_000,
      owner: { kind: 'goal', goalId: targetGoalId, revision: 1, round: 1 },
      usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 30, cacheWriteTokens: 5 },
      toolDurationMs: 20,
      toolResult: {
        schemaVersion: 1,
        status: 'passed',
        reason: 'verified',
        goal: { id: String(targetGoalId), revision: 2, phase: 'complete' },
        artifact: { commit: 'b'.repeat(40) },
      },
      goalCompletion: { goalId: targetGoalId, revision: 2, createdAt: 900 },
    })
    await monitor.flush()

    expect(outcomes.record).toHaveBeenCalledOnce()
    expect(outcomes.record.mock.calls[0]?.[0]).toMatchObject({
      callId: 'call-1',
      goalMetrics: {
        source: 'dsh-session-projections',
        goalId: String(targetGoalId),
        throughEventSeq: through,
        attributedTurns: 1,
        closedSteps: 0,
        activeWallMs: 130,
        providerUsage: {
          uncachedInputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 30,
          cacheWriteTokens: 5,
        },
        latency: { llmMs: 90, toolMs: 20, ttftMs: 20, ttftSteps: 1, decodeMs: 70, decodeTokens: 4 },
        monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
      },
    })
    await monitor.dispose()
  })
})

async function harness(withUnits: boolean, cwd?: string): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withUnits) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SessionStats)
  }
  return {
    ctx,
    session: ctx.sessions.create(SessionId('metrics-session'), {
      ...(cwd === undefined ? {} : { meta: { cwd } }),
    }),
  }
}

function appendGoalChange(
  session: Session,
  time: number,
  id: ReturnType<typeof GoalId>,
  revision: number,
  operation: 'create' | 'edit',
  createdAt: number = time,
): void {
  at(time, () => session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: {
      id,
      revision,
      objective: 'Measure exact Goal work.',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: revision - 1,
    createdAt,
    updatedAt: time,
  }))
}

function appendGoalClear(
  session: Session,
  time: number,
  id: ReturnType<typeof GoalId>,
  revision: number,
): void {
  at(time, () => session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'clear',
    cleared: { id, revision },
    clearedAt: time,
  }))
}

function appendTurn(session: Session, input: {
  turn: number
  startAt: number
  owner:
    | { kind: 'user' }
    | { kind: 'goal'; goalId: ReturnType<typeof GoalId>; revision: number; round: number }
  usage: TokenUsage
  toolDurationMs?: number
  leaveOpenAtToolResult?: boolean
  toolResult?: unknown
  goalCompletion?: {
    goalId: ReturnType<typeof GoalId>
    revision: number
    createdAt: number
  }
}): number {
  const { turn, startAt, owner, usage } = input
  const step = 1
  at(startAt, () => session.append('turn/start', { turn }))
  at(startAt + 10, () => session.append('step/start', { turn, step }))
  at(startAt + 15, () => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'work' }],
    source: owner.kind === 'goal'
      ? { kind: 'goal', goalId: owner.goalId, revision: owner.revision, round: owner.round }
      : { kind: 'user' },
  }), { surfaceOp: 'append' }))
  const firstToken = at(startAt + (turn === 4 ? 35 : 30), () => session.append('assistant/chunk', {
    turn,
    step,
    chunk: { type: 'text-delta', index: 0, text: 'answer' },
  }))
  const usageChunk = at(startAt + 70, () => session.append('assistant/chunk', {
    turn,
    step,
    chunk: { type: 'usage', usage },
  }))
  at(startAt + 100, () => session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
    usage,
  }, { surfaceOp: 'append', sourceEventSeqs: [firstToken.seq, usageChunk.seq] }))

  let through = session.seq - 1
  let toolResultSeq: number | undefined
  if (input.toolDurationMs !== undefined) {
    const callId = `call-${turn}` as never
    const resultAt = startAt + (input.leaveOpenAtToolResult === true ? 150 : 130)
    const call = at(resultAt - input.toolDurationMs, () => session.append('tool/call', {
      turn,
      step,
      callId,
      name: 'complete_delivery',
      arguments: '{}',
    }))
    if (input.goalCompletion !== undefined) {
      const completion = input.goalCompletion
      at(resultAt - 1, () => session.append('goal/change', {
        kind: 'goal/change',
        version: 1,
        operation: 'complete',
        goal: {
          id: completion.goalId,
          revision: completion.revision,
          objective: 'Measure exact Goal work.',
          phase: 'complete',
          maxGoalRounds: 8,
        },
        roundsStarted: completion.revision - 1,
        createdAt: completion.createdAt,
        updatedAt: resultAt - 1,
      }))
    }
    through = at(resultAt, () => session.append('tool/result', {
      turn,
      step,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: JSON.stringify(input.toolResult ?? {}) }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })).seq
    toolResultSeq = through
  }
  if (input.leaveOpenAtToolResult !== true) {
    at(startAt + 140, () => session.append('step/end', { turn, step }))
    through = at(startAt + 150, () => session.append('turn/end', {
      turn,
      reason: { kind: 'completed' },
    })).seq
  }
  return input.toolResult === undefined ? through : toolResultSeq!
}

function at<T>(time: number, action: () => T): T {
  now.mockReturnValue(time)
  return action()
}

function installWorkspaceFixture(ctx: Context): void {
  Object.defineProperty(ctx, 'workspaceRegistry', {
    configurable: true,
    value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
  })
}

function fakeOutcomes() {
  return {
    record: vi.fn<DeliveryOutcomeStore['record']>(async input => ({
      created: true,
      outcome: { ...input, id: 'f'.repeat(64), schemaVersion: 2 },
    })),
    list: vi.fn(() => []),
    summarize: vi.fn(),
    close: vi.fn(),
  }
}
