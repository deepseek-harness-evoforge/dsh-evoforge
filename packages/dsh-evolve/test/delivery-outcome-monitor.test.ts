import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  installDeliveryOutcomeMonitor,
  type DeliveryOutcomeStore,
} from '../src/delivery-outcome-monitor.js'
import type { EvolutionStore } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationId = 'a'.repeat(64)

describe('verified delivery outcome monitor', () => {
  it('records only the durable complete_delivery call/result pair, never the live result', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    const flushSession = installSessionDurabilityFixture(ctx)
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)

    const agent = testAgent()
    emitToolResult(ctx, execution('delivery-call-1', agent), successfulDeliveryResult({
      repository: { worktree: '/private/repo', branch: 'feature/private' },
      checks: [{ name: 'secret-check', stdoutPreview: 'must-not-persist' }],
      draftPr: {
        status: 'passed',
        reason: 'created-draft',
        artifact: {
          kind: 'github-draft-pr',
          number: 7,
          url: 'https://github.com/private/repo/pull/7',
          head: 'feature/private',
          base: 'main',
          commit: 'b'.repeat(40),
          reused: false,
        },
        steps: [],
      },
    }))

    await monitor.flush()
    expect(outcomes.record).not.toHaveBeenCalled()

    appendDurablePair(ctx, agent, 'delivery-call-1', successfulDeliveryValue({
      repository: { worktree: '/private/repo', branch: 'feature/private' },
      checks: [{ name: 'secret-check', stdoutPreview: 'must-not-persist' }],
      draftPr: {
        status: 'passed',
        reason: 'created-draft',
        artifact: {
          kind: 'github-draft-pr',
          number: 7,
          url: 'https://github.com/private/repo/pull/7',
          head: 'feature/private',
          base: 'main',
          commit: 'b'.repeat(40),
          reused: false,
        },
        steps: [],
      },
    }), 1_723_456_789_000)
    await monitor.flush()
    expect(outcomes.record).toHaveBeenCalledOnce()
    expect(flushSession).toHaveBeenCalledWith(agent.session)
    const recorded = outcomes.record.mock.calls[0]?.[0]
    expect(recorded).toEqual({
      observedAt: 1_723_456_789_000,
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      callId: 'delivery-call-1',
      generationId,
      goal: { id: 'goal-1', revision: 4, phase: 'complete' },
      status: 'passed',
      reason: 'verified',
      commit: 'b'.repeat(40),
      draftPrNumber: 7,
    })
    expect(JSON.stringify(recorded)).not.toContain('private/repo')
    expect(JSON.stringify(recorded)).not.toContain('must-not-persist')

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('replays a checkpointed pair after a crash between Session durability and projection', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    const flushSession = installSessionDurabilityFixture(ctx)
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)
    const agent = testAgent()
    appendDurablePair(undefined, agent, 'recovered-call', successfulDeliveryValue(), 1_723_456_789_111)

    emitAgentSessionStart(ctx, agent)
    await monitor.flush()

    expect(outcomes.record).toHaveBeenCalledOnce()
    expect(flushSession).toHaveBeenCalledWith(agent.session)
    expect(outcomes.record.mock.calls[0]?.[0]).toMatchObject({
      observedAt: 1_723_456_789_111,
      callId: 'recovered-call',
      generationId,
      status: 'passed',
    })
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('ignores other Tools, failures, and malformed delivery values', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    installSessionDurabilityFixture(ctx)
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)

    const agent = testAgent()
    appendDurablePair(ctx, agent, 'other', successfulDeliveryValue(), 1, 'bash')
    appendDurablePair(ctx, agent, 'failed', successfulDeliveryValue(), 2, 'complete_delivery', true)
    appendDurablePair(
      ctx,
      agent,
      'malformed',
      { schemaVersion: 1, status: 'passed', reason: 'missing goal' },
      3,
    )
    await monitor.flush()

    expect(outcomes.record).not.toHaveBeenCalled()
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('contains persistence failures and keeps later observations usable', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    installSessionDurabilityFixture(ctx)
    const outcomes = fakeOutcomes()
    outcomes.record
      .mockRejectedValueOnce(new Error('disk temporarily unavailable'))
      .mockResolvedValueOnce({ created: true, outcome: {} as never })
    const evolution = {
      getSessionGeneration: vi.fn(),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)

    const agent = testAgent()
    appendDurablePair(ctx, agent, 'first', successfulDeliveryValue(), 1)
    appendDurablePair(ctx, agent, 'second', successfulDeliveryValue(), 2)
    await expect(monitor.flush()).resolves.toBeUndefined()
    expect(outcomes.record).toHaveBeenCalledTimes(2)

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('fails closed when the native Session durability checkpoint fails, then handles later pairs', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    const flushSession = installSessionDurabilityFixture(ctx)
      .mockRejectedValueOnce(new Error('session disk unavailable'))
      .mockResolvedValueOnce(true)
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)
    const agent = testAgent()

    appendDurablePair(ctx, agent, 'not-durable', successfulDeliveryValue(), 1)
    appendDurablePair(ctx, agent, 'durable', successfulDeliveryValue(), 2)
    await expect(monitor.flush()).resolves.toBeUndefined()

    expect(flushSession).toHaveBeenCalledTimes(2)
    expect(outcomes.record).toHaveBeenCalledOnce()
    expect(outcomes.record.mock.calls[0]?.[0]).toMatchObject({ callId: 'durable' })
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('wakes downstream monitoring only after a new durable Outcome is recorded', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    installSessionDurabilityFixture(ctx)
    const outcomes = fakeOutcomes()
    const onOutcome = vi.fn()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution, { onOutcome })
    const agent = testAgent()

    appendDurablePair(ctx, agent, 'wake-canary', successfulDeliveryValue({
      status: 'failed',
      reason: 'verified failure',
      goal: { id: 'goal-1', revision: 4, phase: 'failed' },
    }), 10)
    await monitor.flush()

    expect(onOutcome).toHaveBeenCalledOnce()
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({
      id: 'f'.repeat(64),
      workspaceId: WORKSPACE_ID,
      generationId,
      status: 'failed',
    }))
    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

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

type TestAgent = ReturnType<typeof testAgent>

function testAgent() {
  return {
    session: {
      header: { id: 'session-1', createdAt: 1_723_456_700_000, cwd: '/repo' },
      events: [] as object[],
    },
  }
}

function execution(callId: string, agent = testAgent()) {
  return {
    callId,
    rootCallId: callId,
    name: 'complete_delivery',
    arguments: {},
    agent,
    signal: new AbortController().signal,
    token: Symbol(callId),
  }
}

function successfulDeliveryValue(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'passed',
    reason: 'verified',
    goal: { id: 'goal-1', revision: 4, phase: 'complete' },
    artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature' },
    repository: {},
    checks: [],
    ...overrides,
  }
}

function successfulDeliveryResult(overrides: Record<string, unknown> = {}) {
  return {
    isError: false,
    value: successfulDeliveryValue(overrides),
    content: [],
  }
}

function appendDurablePair(
  ctx: Context | undefined,
  agent: TestAgent,
  callId: string,
  value: unknown,
  observedAt: number,
  name = 'complete_delivery',
  isError = false,
): void {
  const callSeq = agent.session.events.length
  const call = {
    type: 'tool/call',
    seq: callSeq,
    time: Math.max(0, observedAt - 1),
    data: { turn: 1, step: 1, callId, name, arguments: '{}' },
  }
  const result = {
    type: 'tool/result',
    seq: callSeq + 1,
    time: observedAt,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `message-${callId}`,
        role: 'user',
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: JSON.stringify(value) }],
          ...(isError ? { isError: true } : {}),
        }],
      },
    },
    surfaceOp: 'append',
    sourceEventSeqs: [callSeq],
  }
  agent.session.events.push(call, result)
  if (ctx !== undefined) emitSessionEvent(ctx, agent, result)
}

function emitToolResult(ctx: Context, executionValue: object, result: object): void {
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', executionValue, result)
}

function emitSessionEvent(ctx: Context, agent: TestAgent, event: object): void {
  const emitter = ctx as unknown as {
    emit(name: 'session/event', session: object, event: object): void
  }
  emitter.emit('session/event', agent.session, event)
}

function emitAgentSessionStart(ctx: Context, agent: TestAgent): void {
  const emitter = ctx as unknown as {
    emit(name: 'agent/session-start', payload: { agent: object }): void
  }
  emitter.emit('agent/session-start', { agent })
}

function installWorkspaceFixture(ctx: Context): void {
  Object.defineProperty(ctx, 'workspaceRegistry', {
    configurable: true,
    value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
  })
}

function installSessionDurabilityFixture(ctx: Context) {
  const flush = vi.fn(async () => true)
  Object.defineProperty(ctx, 'sessions', {
    configurable: true,
    value: { flush },
  })
  return flush
}
