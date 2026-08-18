import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityMap } from '../src/capability-map.ts'
import {
  installCapabilityGapMonitor,
  type CapabilityGapStore,
} from '../src/capability-gap-store.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const catalogHash = /^[a-f0-9]{64}$/

describe('Capability Gap monitor', () => {
  it('records only a failed request for a valid Skill absent from one complete exact-Session catalog', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      snapshot: {
        complete: true,
        skills: [{
          name: 'existing-skill',
          description: 'Already available.',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'project-dsh',
          provider: 'filesystem',
        }],
      },
    })
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-incomplete',
      snapshot: { complete: false, skills: [] },
    })
    const gaps = fakeGaps()
    const evolution = {
      getSessionGeneration: vi.fn(() => ({ id: 'a'.repeat(64) })),
    } as unknown as EvolutionStore
    const onGap = vi.fn()
    const monitor = installCapabilityGapMonitor(ctx, gaps, capabilities, evolution, {
      now: () => 1_786_896_000_000,
      onGap,
    })

    emitSkillResult(ctx, 'session-1', 'missing-skill', true)
    emitSkillResult(ctx, 'session-1', 'existing-skill', true)
    emitSkillResult(ctx, 'session-incomplete', 'another-skill', true)
    emitSkillResult(ctx, 'session-1', 'Not Valid', true)
    emitSkillResult(ctx, 'session-1', 'missing-skill', false)
    await monitor.flush()

    expect(gaps.record).toHaveBeenCalledOnce()
    expect(gaps.record).toHaveBeenCalledWith({
      observedAt: 1_786_896_000_000,
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      requestedSkill: 'missing-skill',
      catalogHash: expect.stringMatching(catalogHash),
      catalogSize: 1,
      generationId: 'a'.repeat(64),
      goal: {
        id: 'goal-1',
        revision: 3,
        objective: 'Publish a verified native DSH plugin.',
      },
      evidence: {
        kind: 'native-skill-miss',
        catalog: 'complete',
        routing: 'requested-skill-absent',
        providers: 'settled',
      },
    })
    expect(onGap).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledWith(expect.objectContaining({
      id: '5'.repeat(64),
      requestedSkill: 'missing-skill',
    }))

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('contains one persistence failure and continues observing later exact misses', async () => {
    const ctx = new Context()
    installWorkspaceFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      snapshot: { complete: true, skills: [] },
    })
    const gaps = fakeGaps()
    gaps.record.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValueOnce({
      created: true,
      gap: {} as never,
    })
    const monitor = installCapabilityGapMonitor(
      ctx,
      gaps,
      { snapshot: capabilities.snapshot.bind(capabilities) },
      { getSessionGeneration: vi.fn() },
    )

    emitSkillResult(ctx, 'session-1', 'first-missing', true)
    emitSkillResult(ctx, 'session-1', 'second-missing', true)
    await expect(monitor.flush()).resolves.toBeUndefined()
    expect(gaps.record).toHaveBeenCalledTimes(2)

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function fakeGaps() {
  return {
    record: vi.fn<CapabilityGapStore['record']>(async input => ({
      created: true,
      gap: { schemaVersion: 1, id: '5'.repeat(64), ...input, status: 'confirmed' as const },
    })),
    list: vi.fn(() => []),
    close: vi.fn(),
  }
}

function emitSkillResult(
  ctx: Context,
  sessionId: string,
  name: string,
  isError: boolean,
): void {
  const agent = {
    session: { header: { id: sessionId, createdAt: 1_786_895_000_000, cwd: '/repo' } },
  }
  const execution = {
    callId: `${sessionId}:${name}`,
    rootCallId: `${sessionId}:${name}`,
    name: 'skill',
    arguments: { name },
    agent,
    signal: new AbortController().signal,
    token: Symbol(name),
  }
  const result = isError
    ? { isError: true, error: { message: 'skill unavailable' }, content: [] }
    : { isError: false, value: { name, provider: 'runtime', content: 'private' }, content: [] }
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', execution, result)
}

function installWorkspaceFixture(ctx: Context): void {
  Object.defineProperty(ctx, 'workspaceRegistry', {
    configurable: true,
    value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
  })
}

function installGoalFixture(ctx: Context): void {
  ctx.provide('goals' as never, {
    get: vi.fn(() => ({
      id: 'goal-1',
      revision: 3,
      objective: 'Publish a verified native DSH plugin.',
    })),
  } as never)
}
