import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  installSkillUseMonitor,
  type SkillUseStore,
} from '../src/skill-use-monitor.js'
import type { EvolutionStore } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationId = 'a'.repeat(64)

describe('exact Skill use monitor', () => {
  it('records a source-linked successful native Skill invocation only after Session durability', async () => {
    const ctx = new Context()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const flush = vi.fn(async () => true)
    Object.defineProperty(ctx, 'sessions', {
      configurable: true,
      value: { flush },
    })
    const uses = fakeUses()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: generationId })),
    } as unknown as EvolutionStore
    const monitor = installSkillUseMonitor(ctx, uses, evolution)
    const session = testSession()

    appendSuccessfulSkillInvocation(ctx, session, 1_723_456_789_000)
    await monitor.flush()

    expect(flush).toHaveBeenCalledWith(session)
    expect(uses.record).toHaveBeenCalledOnce()
    expect(uses.record).toHaveBeenCalledWith({
      observedAt: 1_723_456_789_000,
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      generationId,
      skillName: 'release-dsh-plugin',
      route: 'model-tool',
      invocationSeq: 3,
      invocationContentHash: createHash('sha256')
        .update(JSON.stringify([{ type: 'text', text: '<skill_content>exact</skill_content>' }]))
        .digest('hex'),
      goal: { id: 'goal-release', revision: 1 },
    })
    expect(JSON.stringify(uses.record.mock.calls[0]?.[0])).not.toContain('<skill_content>')

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('replays checkpointed uses on cold Session start and abstains from failed Skill results', async () => {
    const ctx = new Context()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const flush = vi.fn(async () => true)
    Object.defineProperty(ctx, 'sessions', {
      configurable: true,
      value: { flush },
    })
    const uses = fakeUses()
    const evolution = { getSessionGeneration: vi.fn() } as unknown as EvolutionStore
    const monitor = installSkillUseMonitor(ctx, uses, evolution)
    const session = testSession()
    appendSuccessfulSkillInvocation(undefined, session, 1_723_456_789_111)
    appendFailedSkillInvocation(session, 1_723_456_789_222)

    const emitter = ctx as unknown as {
      waterfall(
        name: 'agent/pre-step',
        payload: { agent: { session: object } },
        next: () => Promise<{ kind: 'enter' }>,
      ): Promise<{ kind: 'enter' }>
    }
    await emitter.waterfall(
      'agent/pre-step',
      { agent: { session } },
      () => Promise.resolve({ kind: 'enter' }),
    )
    await monitor.flush()

    expect(flush).toHaveBeenCalledOnce()
    expect(uses.record).toHaveBeenCalledOnce()
    expect(uses.record.mock.calls[0]?.[0]).toMatchObject({
      observedAt: 1_723_456_789_111,
      invocationSeq: 3,
      skillName: 'release-dsh-plugin',
      goal: { id: 'goal-release', revision: 1 },
    })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function fakeUses() {
  return {
    record: vi.fn<SkillUseStore['record']>(async input => ({
      created: true,
      use: { ...input, id: 'f'.repeat(64), schemaVersion: 1 },
    })),
    list: vi.fn(() => []),
    summarize: vi.fn(),
    close: vi.fn(),
  }
}

function testSession() {
  return {
    header: { id: 'session-1', createdAt: 1_723_456_700_000, cwd: '/repo' },
    events: [
      event('goal/change', 0, 1, {
        kind: 'goal/change',
        version: 1,
        operation: 'create',
        goal: {
          id: 'goal-release',
          revision: 1,
          objective: 'Release one verified native DSH plugin.',
          phase: 'active',
          maxGoalRounds: 8,
        },
        roundsStarted: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
      event('turn/start', 1, 2, { turn: 1 }),
      event('user/message', 2, 3, {
        id: 'user-1',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Release it.' }],
      }),
    ] as object[],
  }
}

function appendSuccessfulSkillInvocation(
  ctx: Context | undefined,
  session: ReturnType<typeof testSession>,
  observedAt: number,
): void {
  const call = event('tool/call', 3, observedAt - 1, {
    turn: 1,
    step: 1,
    callId: 'call-skill',
    name: 'skill',
    arguments: '{"name":"release-dsh-plugin"}',
  })
  const result = {
    ...event('tool/result', 4, observedAt, {
      turn: 1,
      step: 1,
      message: {
        id: 'skill-result',
        role: 'tool',
        source: { type: 'tool-result', callId: 'call-skill' },
        content: [{
          type: 'tool-result',
          toolCallId: 'call-skill',
          content: [{ type: 'text', text: '<skill_content>exact</skill_content>' }],
          isError: false,
        }],
      },
    }),
    sourceEventSeqs: [3],
  }
  session.events.push(call, result)
  if (ctx !== undefined) {
    const emitter = ctx as unknown as {
      emit(name: 'session/event', session: object, event: object): void
    }
    emitter.emit('session/event', session, result)
  }
}

function appendFailedSkillInvocation(
  session: ReturnType<typeof testSession>,
  observedAt: number,
): void {
  const callSeq = session.events.length
  session.events.push(
    event('tool/call', callSeq, observedAt - 1, {
      turn: 1,
      step: 2,
      callId: 'call-failed-skill',
      name: 'skill',
      arguments: '{"name":"release-dsh-plugin"}',
    }),
    {
      ...event('tool/result', callSeq + 1, observedAt, {
        turn: 1,
        step: 2,
        message: {
          id: 'failed-skill-result',
          role: 'tool',
          source: { type: 'tool-result', callId: 'call-failed-skill' },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-failed-skill',
            content: [{ type: 'text', text: 'load failed' }],
            isError: true,
          }],
        },
      }),
      sourceEventSeqs: [callSeq],
    },
  )
}

function event(type: string, seq: number, time: number, data: unknown): Record<string, unknown> {
  return { type, seq, time, data }
}
