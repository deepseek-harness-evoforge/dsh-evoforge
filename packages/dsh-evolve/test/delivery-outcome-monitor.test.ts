import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  installDeliveryOutcomeMonitor,
  type DeliveryOutcomeStore,
} from '../src/delivery-outcome-monitor.js'
import type { EvolutionStore } from '../src/generation-store.js'

const generationId = 'a'.repeat(64)

describe('verified delivery outcome monitor', () => {
  it('observes native tools/result without delaying the originating Tool result', async () => {
    const ctx = new Context()
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution, {
      now: () => 1_723_456_789_000,
    })

    emitToolResult(ctx, execution('delivery-call-1'), successfulDelivery({
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

    expect(outcomes.record).not.toHaveBeenCalled()
    await monitor.flush()
    expect(outcomes.record).toHaveBeenCalledOnce()
    const recorded = outcomes.record.mock.calls[0]?.[0]
    expect(recorded).toEqual({
      observedAt: 1_723_456_789_000,
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

  it('ignores other Tools, failures, and malformed delivery values', async () => {
    const ctx = new Context()
    const outcomes = fakeOutcomes()
    const evolution = {
      getSessionGeneration: vi.fn(),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)

    emitToolResult(ctx, { ...execution('other'), name: 'bash' }, successfulDelivery())
    emitToolResult(ctx, execution('failed'), {
      isError: true,
      error: { message: 'policy denied' },
      content: [],
    })
    emitToolResult(ctx, execution('malformed'), {
      isError: false,
      value: { schemaVersion: 1, status: 'passed', reason: 'missing goal' },
      content: [],
    })
    await monitor.flush()

    expect(outcomes.record).not.toHaveBeenCalled()
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('contains persistence failures and keeps later observations usable', async () => {
    const ctx = new Context()
    const outcomes = fakeOutcomes()
    outcomes.record
      .mockRejectedValueOnce(new Error('disk temporarily unavailable'))
      .mockResolvedValueOnce({ created: true, outcome: {} as never })
    const evolution = {
      getSessionGeneration: vi.fn(),
    } as unknown as EvolutionStore
    const monitor = installDeliveryOutcomeMonitor(ctx, outcomes, evolution)

    emitToolResult(ctx, execution('first'), successfulDelivery())
    emitToolResult(ctx, execution('second'), successfulDelivery())
    await expect(monitor.flush()).resolves.toBeUndefined()
    expect(outcomes.record).toHaveBeenCalledTimes(2)

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function fakeOutcomes() {
  return {
    record: vi.fn<DeliveryOutcomeStore['record']>(async input => ({
      created: true,
      outcome: { ...input, id: 'f'.repeat(64), schemaVersion: 1 },
    })),
    summarize: vi.fn(),
    close: vi.fn(),
  }
}

function execution(callId: string) {
  return {
    callId,
    rootCallId: callId,
    name: 'complete_delivery',
    arguments: {},
    agent: {
      session: {
        header: { id: 'session-1', createdAt: 1_723_456_700_000, cwd: '/repo' },
      },
    },
    signal: new AbortController().signal,
    token: Symbol(callId),
  }
}

function successfulDelivery(overrides: Record<string, unknown> = {}) {
  return {
    isError: false,
    value: {
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      goal: { id: 'goal-1', revision: 4, phase: 'complete' },
      artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature' },
      repository: {},
      checks: [],
      ...overrides,
    },
    content: [],
  }
}

function emitToolResult(ctx: Context, executionValue: object, result: object): void {
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', executionValue, result)
}
