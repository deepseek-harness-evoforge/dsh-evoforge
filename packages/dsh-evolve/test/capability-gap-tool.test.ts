import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityMap } from '../src/capability-map.ts'
import { installCapabilityGapTool } from '../src/capability-gap-tool.ts'
import type { CapabilityGapStore } from '../src/capability-gap-store.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('autonomous Capability Gap Tool', () => {
  it('queues trusted discovery from a natural-language Goal after the complete catalog has no suitable Skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    installWorkspaceFixture(ctx)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      snapshot: { complete: true, skills: [] },
    })
    const gaps = fakeGaps()
    const onGap = vi.fn()
    installCapabilityGapTool(
      ctx,
      gaps,
      capabilities,
      { getSessionGeneration: vi.fn(() => ({ id: 'a'.repeat(64) })) } as unknown as EvolutionStore,
      { now: () => 1_786_896_000_000, onGap },
    )
    const agent = {
      session: { header: { id: 'session-1', createdAt: 1_786_895_000_000, cwd: '/repo' } },
    }

    const result = await ctx.tools.execute({
      callId: 'capability-gap-call' as never,
      name: 'report_capability_gap',
      arguments: { name: 'publish-dsh-plugin' },
      agent: agent as never,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      isError: false,
      value: {
        status: 'queued',
        gapId: '5'.repeat(64),
        requestedSkill: 'publish-dsh-plugin',
      },
    })
    expect(gaps.record).toHaveBeenCalledWith({
      observedAt: 1_786_896_000_000,
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      requestedSkill: 'publish-dsh-plugin',
      catalogHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      catalogSize: 0,
      generationId: 'a'.repeat(64),
      goal: {
        id: 'goal-1',
        revision: 3,
        objective: 'Publish a verified native DSH plugin.',
      },
      evidence: {
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      },
    })
    expect(onGap).toHaveBeenCalledWith(expect.objectContaining({
      id: '5'.repeat(64),
      requestedSkill: 'publish-dsh-plugin',
    }))

    await ctx.fiber.dispose()
  })

  it('rejects an unbounded model-proposed Skill name before durable persistence', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    installWorkspaceFixture(ctx)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      snapshot: { complete: true, skills: [] },
    })
    const gaps = fakeGaps()
    installCapabilityGapTool(ctx, gaps, capabilities, { getSessionGeneration: vi.fn() })

    const result = await ctx.tools.execute({
      callId: 'unbounded-capability-gap-call' as never,
      name: 'report_capability_gap',
      arguments: { name: 'a'.repeat(129) },
      agent: {
        session: { header: { id: 'session-1', createdAt: 1_786_895_000_000, cwd: '/repo' } },
      } as never,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('invalid proposed Skill name') },
    })
    expect(gaps.record).not.toHaveBeenCalled()

    await ctx.fiber.dispose()
  })

  it('keeps the durable receipt successful when asynchronous discovery scheduling fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    installWorkspaceFixture(ctx)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-1',
      snapshot: { complete: true, skills: [] },
    })
    const gaps = fakeGaps()
    installCapabilityGapTool(
      ctx,
      gaps,
      capabilities,
      { getSessionGeneration: vi.fn() },
      { onGap: () => { throw new Error('discovery scheduler unavailable') } },
    )

    const result = await executeGapTool(ctx, 'session-1', 'publish-dsh-plugin')

    expect(result).toMatchObject({
      isError: false,
      value: {
        status: 'queued',
        gapId: '5'.repeat(64),
        requestedSkill: 'publish-dsh-plugin',
      },
    })
    expect(gaps.record).toHaveBeenCalledOnce()

    await ctx.fiber.dispose()
  })

  it('fails closed when the proposed Skill exists or the native catalog is incomplete', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    installWorkspaceFixture(ctx)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-existing',
      snapshot: {
        complete: true,
        skills: [{
          name: 'publish-dsh-plugin',
          description: 'Publish a verified native DSH plugin.',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'project-agents',
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
    installCapabilityGapTool(ctx, gaps, capabilities, { getSessionGeneration: vi.fn() })

    const existing = await executeGapTool(ctx, 'session-existing', 'publish-dsh-plugin')
    const incomplete = await executeGapTool(ctx, 'session-incomplete', 'another-skill')

    expect(existing).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('already available') },
    })
    expect(incomplete).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('incomplete Session Skill catalog') },
    })
    expect(gaps.record).not.toHaveBeenCalled()

    await ctx.fiber.dispose()
  })
})

function executeGapTool(ctx: Context, sessionId: string, name: string) {
  return ctx.tools.execute({
    callId: `${sessionId}:${name}` as never,
    name: 'report_capability_gap',
    arguments: { name },
    agent: {
      session: { header: { id: sessionId, createdAt: 1_786_895_000_000, cwd: '/repo' } },
    } as never,
    signal: new AbortController().signal,
  })
}

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
