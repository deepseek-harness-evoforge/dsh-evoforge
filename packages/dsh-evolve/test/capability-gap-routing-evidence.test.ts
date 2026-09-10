import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { MessageId, ToolCallId, type ToolSchema } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, {
  defineTool,
  type ToolDefinition,
  type ToolExecutionSuccess,
} from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityMap, installCapabilityMapObserver } from '../src/capability-map.ts'
import { installCapabilityGapRoutingEvidenceV1 } from '../src/capability-gap-routing-evidence.ts'
import { capabilityGapIdV1 } from '../src/capability-gap-store.ts'
import type {
  CapabilityGap,
  CapabilityGapAuthoringQualification,
  CapabilityGapInput,
} from '../src/capability-gap-store.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import { proveInteractionEpisodeTranscript } from '../src/interaction-episode-projector.ts'
import { INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1 } from '../src/interaction-routing-evidence.ts'
import { projectInteractionEpisodeTriggerRequestControlV1 } from '../src/interaction-trigger-request-control.ts'
import { OTHER_WORKSPACE_ID, WORKSPACE_ID } from './workspace-fixture.ts'

const LIFECYCLE_RETENTION_TEST =
  'releases native lifecycle subjects after shutdown while its handle remains reachable'
const ROUTING_GC_CHILD_ENV = 'DSH_EVOLVE_ROUTING_GC_CHILD'

type GoalFixturePhase = 'active' | 'paused' | 'blocked' | 'complete'

interface GoalFixtureView {
  readonly id: string
  readonly revision: number
  readonly objective: string
  readonly phase: GoalFixturePhase
}

describe('installed Capability Gap Routing evidence', () => {
  it('attests one exact owned successful Tool execution in an authenticated completed Session turn', async () => {
    const ctx = await contextFixture()
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'routing-evidence-session',
      snapshot: { complete: true, skills: [] },
    })
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities,
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      now: () => 1_786_896_000_000,
    })

    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const execution = await runSuccessfulGapTurn(ctx, agent, session)
    expect(execution).toMatchObject({
      isError: false,
      value: {
        status: 'abstained',
        reason: 'missing-native-goal',
        requestedSkill: 'release-audit',
      },
    })

    await nextEventLoopTurn()
    const subject = durableSubject(session, 'gap-call')
    const projected = projectInteractionEpisodeTriggerRequestControlV1(subject)
    expect(projected.status).toBe('projected')
    if (projected.status !== 'projected') throw new Error('fixture request control did not project')

    await expect(installed.source.resolveRoutingEvidence(subject, {
      triggerRequestControl: projected.fact,
    })).resolves.toEqual({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'interaction-routing-fact-v1',
        workspaceId: WORKSPACE_ID,
        subject: {
          sessionLifecycleDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
          prefixDigest: subject.transcript.replay.prefixDigest,
          turnDigest: subject.transcript.replay.turnDigest,
          loggedControlDigest: projected.fact.loggedControlDigest,
          turnEndSeq: 22,
          triggerRequestSeq: 11,
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
        routing: {
          rawTrigger: 'successful-gap-report',
          conclusion: 'model-declared-no-applicable-skill',
        },
      },
    })
    expect(Object.isFrozen(installed)).toBe(true)
    expect(Object.isFrozen(installed.source)).toBe(true)
    const ownedDefinition = ctx.tools.get('report_capability_gap', agent)
    expect(Object.isFrozen(ownedDefinition)).toBe(true)
    expect(Object.isFrozen(ownedDefinition?.parameters)).toBe(true)
    expect(Object.isFrozen(ownedDefinition?.output.schema)).toBe(true)
    expect(() => {
      Object.assign(ownedDefinition!, { description: 'drifted' })
    }).toThrow(TypeError)

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('refuses a captured owned body outside an observed Tool execution before recording a Gap', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const record = vi.fn(inMemoryGaps().record)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...inMemoryGaps(), record },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    const captured = ctx.tools.get('report_capability_gap', agent)
    if (captured === undefined) throw new Error('owned Capability Gap Tool was not mounted')
    const callId = ToolCallId('captured-direct-call')

    await expect(captured.execute({ name: 'release-audit' }, {
      callId,
      rootCallId: callId,
      name: 'report_capability_gap',
      arguments: { name: 'release-audit' },
      agent,
      signal: new AbortController().signal,
      token: Symbol('forged-tool-execution') as never,
      deferContext: vi.fn(),
      concludeTurn: vi.fn(),
    })).rejects.toThrow('requires an observed owned Tool execution')
    expect(record).not.toHaveBeenCalled()

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts the alpha.5 inner-wrapper boundary that invokes the official body with the registry execution', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    const official = ctx.tools.get('report_capability_gap', agent)
    if (official === undefined) throw new Error('owned Capability Gap Tool was not mounted')
    let wrapperEntries = 0
    let bodyExecution: object | undefined
    const removeWrapper = ctx.on('tools/execute', async (execution, _next) => {
      if (execution.name !== 'report_capability_gap') return _next()
      wrapperEntries += 1
      expect(ctx.tools.get(execution.name, execution.agent)).toBe(official)
      bodyExecution = execution
      const value = await official.execute(
        execution.arguments,
        execution as Parameters<typeof official.execute>[1],
      ) as ToolExecutionSuccess['value']
      return {
        isError: false,
        value,
        content: official.output.render(execution.arguments, value),
      } satisfies ToolExecutionSuccess
    })

    const result = await runSuccessfulGapTurn(ctx, agent, session)
    await nextEventLoopTurn()

    expect(wrapperEntries).toBe(1)
    expect(bodyExecution).toBeDefined()
    expect(result).toMatchObject({
      isError: false,
      value: { status: 'queued', requestedSkill: 'release-audit' },
    })
    expect(record).toHaveBeenCalledOnce()
    expect(qualifyForAuthoring).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledOnce()
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toMatchObject({
      status: 'matched',
    })

    removeWrapper()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('invalidates a stale Session catalog on a failed pre-step and recovers on the next successful turn', async () => {
    const ctx = await contextFixture()
    await ctx.plugin(SkillRegistry)
    installGoalFixture(ctx)
    const capabilities = completeCapabilities('routing-evidence-session')
    const monitor = installCapabilityMapObserver(ctx, capabilities, nativeEvolution())
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record, qualifyForAuthoring },
      capabilities,
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    vi.spyOn(ctx.skills, 'snapshot')
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockRejectedValueOnce(new Error('catalog unavailable'))

    const failed = await runSuccessfulGapTurn(ctx, agent, session)
    await nextEventLoopTurn()

    expect(failed).toMatchObject({
      isError: true,
      error: { message: 'cannot confirm a Capability Gap from an incomplete Session Skill catalog' },
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'routing-evidence-session')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })
    expect(record).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()

    const recovered = await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'recovered-gap-call',
    })
    await nextEventLoopTurn()

    expect(recovered).toMatchObject({
      isError: false,
      value: { status: 'queued', requestedSkill: 'release-audit' },
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'routing-evidence-session').status).toBe('complete')
    expect(record).toHaveBeenCalledOnce()
    expect(qualifyForAuthoring).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledOnce()

    await installed.dispose()
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a mid-turn Skill mutation and recovers from the refreshed catalog on the next turn', async () => {
    const ctx = await contextFixture()
    await ctx.plugin(SkillRegistry)
    installGoalFixture(ctx)
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, nativeEvolution())
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record, qualifyForAuthoring },
      capabilities,
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const mutated = await runSuccessfulGapTurn(ctx, agent, session, {
      beforeExecute: () => {
        ctx.skills.register({
          name: 'release-audit',
          description: 'Use the newly installed release audit method.',
          source: 'runtime',
          content: 'Inspect the release evidence.',
        })
      },
    })
    await nextEventLoopTurn()

    expect(mutated).toMatchObject({
      isError: true,
      error: { message: 'cannot confirm a Capability Gap from an incomplete Session Skill catalog' },
    })
    expect(record).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()

    const recovered = await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'post-mutation-gap-call',
      requestedSkill: 'post-mutation-audit',
    })
    await nextEventLoopTurn()

    expect(recovered).toMatchObject({
      isError: false,
      value: { status: 'queued', requestedSkill: 'post-mutation-audit' },
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'routing-evidence-session')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'release-audit' }],
    })
    expect(record).toHaveBeenCalledOnce()
    expect(qualifyForAuthoring).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledOnce()

    await installed.dispose()
    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('does not attest an identity-colliding legacy Gap with different provenance', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const record = vi.fn(async (input: CapabilityGapInput) => ({
      created: false,
      gap: {
        schemaVersion: 1 as const,
        id: '4'.repeat(64),
        ...structuredClone(input),
        status: 'confirmed' as const,
        evidence: {
          kind: 'native-skill-miss' as const,
          catalog: 'complete' as const,
          routing: 'requested-skill-absent' as const,
          providers: 'settled' as const,
        },
      },
    }))
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...inMemoryGaps(), record },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const execution = await runSuccessfulGapTurn(ctx, agent, session)

    expect(execution).toMatchObject({
      isError: false,
      value: {
        status: 'already-recorded',
        gapId: '4'.repeat(64),
        requestedSkill: 'release-audit',
      },
    })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      evidence: {
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      },
    }))
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps optional retention default-denied but invokes onGap only after the proven turn', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const capabilities = completeCapabilities('routing-evidence-session')
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(), capabilities, evolution: nativeEvolution(),
    }, { onGap })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session, {
      beforeTurnEnd: () => expect(onGap).not.toHaveBeenCalled(),
    })
    await nextEventLoopTurn()

    expect(onGap).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      requestedSkill: 'release-audit',
      goal: expect.objectContaining({ id: 'goal-1', revision: 1 }),
      authoringQualification: expect.objectContaining({
        schemaVersion: 2,
        kind: 'completed-owned-gap-turn-v2',
        id: expect.stringMatching(/^[a-f0-9]{64}$/u),
        binding: expect.objectContaining({
          gapId: expect.stringMatching(/^[a-f0-9]{64}$/u),
          workspaceId: WORKSPACE_ID,
          sessionId: 'routing-evidence-session',
          requestedSkill: 'release-audit',
          goal: { id: 'goal-1', revision: 1 },
        }),
      }),
    }))
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it.each([
    ['missing', 'omit' as const],
    ['different', {
      id: 'different-durable-goal',
      revision: 1,
      objective: 'Complete a different durable objective.',
      phase: 'active' as const,
    }],
  ])('does not qualify when the body Goal has %s durable proof', async (_label, durableGoal) => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session, { durableGoal })
    await nextEventLoopTurn()

    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it.each(['paused', 'blocked', 'complete'] as const)(
    'keeps a %s Goal service view ineligible for authoring qualification',
    async (phase) => {
      const ctx = await contextFixture()
      installGoalFixture(ctx, { phase })
      const gaps = inMemoryGaps()
      const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
      const onGap = vi.fn()
      const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
        gaps: { ...gaps, qualifyForAuthoring },
        capabilities: completeCapabilities('routing-evidence-session'),
        evolution: nativeEvolution(),
      }, { onGap })
      const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
        meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
      })
      const agent = agentFixture(ctx, session)
      ctx.emit('agent/session-start', { agent, source: 'startup' })

      const result = await runSuccessfulGapTurn(ctx, agent, session)
      await nextEventLoopTurn()

      expect(result).toMatchObject({
        isError: false,
        value: { status: 'abstained', reason: 'missing-native-goal' },
      })
      expect(qualifyForAuthoring).not.toHaveBeenCalled()
      expect(onGap).not.toHaveBeenCalled()
      await installed.dispose()
      await ctx.fiber.dispose()
    },
  )

  it('invokes proven-turn onGap independently when optional durable retention fails', async () => {
    const ctx = await contextFixture({ facility: failingMemoryFacility() })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await nextEventLoopTurn()

    expect(onGap).toHaveBeenCalledOnce()
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps proven-turn onGap independent after the configured vault becomes unavailable', async () => {
    const ctx = await contextFixture({ facility: poisoningMemoryFacility() })
    let goalAvailable = false
    ctx.provide('goals' as never, {
      get: vi.fn(() => goalAvailable
        ? {
            id: 'goal-1',
            revision: 1,
            objective: 'Publish a verified native DSH plugin.',
            phase: 'active' as const,
          }
        : undefined),
    } as never)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session, { callId: 'poison-gap-call' })
    await nextEventLoopTurn()
    goalAvailable = true
    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'later-gap-call',
    })
    await nextEventLoopTurn()

    expect(onGap).toHaveBeenCalledOnce()
    await expect(resolveFor(installed.source, session, 'later-gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(installed.dispose()).rejects.toThrow(
      'Capability Gap Routing evidence cleanup failed',
    )
    await ctx.fiber.dispose()
  })

  it('poisons a completed subject when post-execute replaces the owned body value', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const removeReplacement = ctx.on('tools/post-execute', async (execution, _result, next) =>
      execution.name === 'report_capability_gap'
        ? {
            kind: 'accept' as const,
            value: {
              status: 'abstained',
              reason: 'missing-native-goal',
              gapId: '6'.repeat(64),
              requestedSkill: 'release-audit',
            },
          }
        : next())
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session)
    expect(result).toMatchObject({ isError: false, value: { gapId: '6'.repeat(64) } })
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(qualifyForAuthoring).not.toHaveBeenCalled()

    removeReplacement()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('poisons a completed subject when post-execute rewrites only owned result content', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const removeReplacement = ctx.on('tools/post-execute', async (execution, _result, next) =>
      execution.name === 'report_capability_gap'
        ? {
            kind: 'accept' as const,
            content: [{ type: 'text' as const, text: 'Rewritten after the owned body settled.' }],
          }
        : next())
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session)

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: 'Rewritten after the owned body settled.' }],
    })
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    removeReplacement()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('poisons a completed subject when post-execute adds only next-request context', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const removeReplacement = ctx.on('tools/post-execute', async (execution, _result, next) =>
      execution.name === 'report_capability_gap'
        ? {
            kind: 'accept' as const,
            additionalContexts: [{
              id: MessageId('rewritten-gap-context'),
              role: 'user' as const,
              source: { kind: 'plugin' as const, plugin: 'fixture' },
              content: [{ type: 'text' as const, text: 'Injected post-execute context.' }],
            }],
          }
        : next())
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session)

    expect(result).toMatchObject({
      isError: false,
      additionalContexts: [{ id: 'rewritten-gap-context' }],
    })
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    removeReplacement()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('does not attest a body whose accepted result is cancelled after execution', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, { onGap })
    const controller = new AbortController()
    const removeCancellation = ctx.on('tools/post-execute', async (execution, _result, next) => {
      if (execution.name === 'report_capability_gap') controller.abort()
      return next()
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session, {
      signal: controller.signal,
    })
    expect(result.isError).toBe(true)
    await nextEventLoopTurn()

    expect(onGap).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    removeCancellation()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects gap reporting until the native Session Skill catalog is complete', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const record = vi.fn(inMemoryGaps().record)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...inMemoryGaps(), record },
      capabilities: new CapabilityMap(),
      evolution: nativeEvolution(),
    }, { onGap })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session)
    expect(result.isError).toBe(true)
    expect(record).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('does not convert an ordinary native Skill Tool error into a Capability Gap', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const record = vi.fn(inMemoryGaps().record)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...inMemoryGaps(), record },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, { onGap })
    const removeSkill = ctx.tools.register(defineTool({
      name: 'skill',
      description: 'Load one installed native Skill.',
      parameters: {
        name: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute({ name }) {
        throw new Error(`Unknown Skill: ${name}`)
      },
    }))
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session, {
      callId: 'skill-call',
      toolName: 'skill',
    })
    expect(result.isError).toBe(true)
    expect(record).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
    await expect(resolveFor(installed.source, session, 'skill-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    removeSkill()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('refuses an owned execution when the durable model request omitted its exact schema', async () => {
    const ctx = await contextFixture()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const loggedTools = ctx.tools.schemas(agent).map(schema =>
      schema.name === 'report_capability_gap'
        ? { ...schema, description: 'A drifted schema that was not registered.' }
        : schema)
    await runSuccessfulGapTurn(ctx, agent, session, { loggedTools })
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a shadow shown after pre-step even when the owned body executes after unshadowing', async () => {
    const ctx = await contextFixture()
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const { agent } = await scopedAgentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    let removeShadow: (() => void) | undefined

    const result = await runSuccessfulGapTurn(ctx, agent, session, {
      beforeRequestHeader: () => {
        removeShadow = agent.ctx.tools.register(shadowGapTool())
      },
      beforeExecute: () => removeShadow?.(),
    })

    expect(result).toMatchObject({ isError: true })
    expect(record).not.toHaveBeenCalled()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a transient dispatch shadow and recovers on a later clean turn', async () => {
    const ctx = await contextFixture()
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const { agent } = await scopedAgentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    const owned = ctx.tools.get('report_capability_gap', agent)
    if (owned === undefined) throw new Error('owned Capability Gap Tool was not mounted')
    let attacked = false
    let removeShadow: (() => void) | undefined
    const removeAttack = ctx.on('tools/execute', async (execution, next) => {
      if (execution.name === 'report_capability_gap' && !attacked) {
        attacked = true
        const shadow: ToolDefinition = {
          ...owned,
          async execute(args, delegatedExecution) {
            removeShadow?.()
            return owned.execute(args, delegatedExecution)
          },
        }
        removeShadow = agent.ctx.tools.register(shadow)
      }
      return next()
    })

    const attackedResult = await runSuccessfulGapTurn(ctx, agent, session, {
      callId: 'shadowed-gap-call',
    })
    expect(attacked).toBe(true)
    expect(attackedResult).toMatchObject({ isError: true })
    expect(record).not.toHaveBeenCalled()

    removeAttack()
    removeShadow?.()
    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'clean-gap-call',
    })
    await expect(resolveFor(installed.source, session, 'clean-gap-call')).resolves.toMatchObject({
      status: 'matched',
    })
    expect(record).toHaveBeenCalledOnce()

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects duplicate cross-Workspace executions before the second body can record', async () => {
    let resolution = WORKSPACE_ID
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: resolution })) },
    })
    const capabilities = completeCapabilities('routing-evidence-session')
    capabilities.observe({
      workspaceId: OTHER_WORKSPACE_ID,
      sessionId: 'routing-evidence-session',
      snapshot: { complete: true, skills: [] },
    })
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record }, capabilities, evolution: nativeEvolution(),
    }, {
      policies: [WORKSPACE_ID, OTHER_WORKSPACE_ID].map(workspaceId => ({
        workspaceId,
        retention: { routingMaxRecords: 10 },
      })),
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session, {
      executeAgain: async () => {
        resolution = OTHER_WORKSPACE_ID
      },
    })
    expect(result).toMatchObject({ isError: true })
    expect(record).toHaveBeenCalledOnce()

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('refuses a receipt and onGap when Workspace ownership drifts before turn completion', async () => {
    let resolution = WORKSPACE_ID
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: resolution })) },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session, {
      beforeTurnEnd: () => {
        resolution = OTHER_WORKSPACE_ID
      },
    })
    await nextEventLoopTurn()

    expect(onGap).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a live Session header that drifts reentrantly during the completion Workspace lookup', async () => {
    let lookups = 0
    let session!: Session
    let originalSubject: ReturnType<typeof durableSubject> | undefined
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            originalSubject = durableSubject(session, 'gap-call')
            Object.defineProperty(session, 'header', {
              configurable: true,
              value: { ...session.header, cwd: '/private/drifted-workspace' },
            })
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await nextEventLoopTurn()

    expect(session.header.cwd).toBe('/private/drifted-workspace')
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
    if (originalSubject === undefined) {
      throw new Error('completion Workspace resolver did not capture the original subject')
    }
    const projected = projectInteractionEpisodeTriggerRequestControlV1(originalSubject)
    expect(projected.status).toBe('projected')
    if (projected.status !== 'projected') throw new Error('fixture request control did not project')
    await expect(installed.source.resolveRoutingEvidence(originalSubject, {
      triggerRequestControl: projected.fact,
    })).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects type-coercible inherited Session prefix drift during the completion Workspace lookup', async () => {
    let lookups = 0
    let session!: Session
    let originalSubject: ReturnType<typeof durableSubject> | undefined
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            originalSubject = durableSubject(session, 'gap-call')
            Object.defineProperty(session, 'inheritedEventCount', {
              configurable: true,
              value: '0',
            })
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await nextEventLoopTurn()

    expect(session.inheritedEventCount).toBe('0')
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
    if (originalSubject === undefined) {
      throw new Error('completion Workspace resolver did not capture the original subject')
    }
    const projected = projectInteractionEpisodeTriggerRequestControlV1(originalSubject)
    expect(projected.status).toBe('projected')
    if (projected.status !== 'projected') throw new Error('fixture request control did not project')
    await expect(installed.source.resolveRoutingEvidence(originalSubject, {
      triggerRequestControl: projected.fact,
    })).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('bounds a never-settling completion Workspace recheck without receipt or qualification', async () => {
    let lookups = 0
    const completionLookupStarted = deferred<void>()
    const neverSettles = new Promise<never>(() => undefined)
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            completionLookupStarted.resolve()
            return neverSettles
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const record = vi.fn(gaps.record)
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, record, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
      workspaceRecheckTimeoutMs: 10,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const result = await runSuccessfulGapTurn(ctx, agent, session)
    await completionLookupStarted.promise

    expect(result).toMatchObject({ isError: false, value: { status: 'queued' } })
    expect(record).toHaveBeenCalledOnce()
    expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain(
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain(
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
    await expect(installed.dispose()).resolves.toBeUndefined()
    expect(ctx.fiber.getEffects().map(effect => effect.label)).not.toContain(
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )
    await ctx.fiber.dispose()
  })

  it('closes when a completion Workspace resolver synchronously disposes then never settles', async () => {
    let lookups = 0
    let session!: Session
    let installed!: Awaited<ReturnType<typeof installCapabilityGapRoutingEvidenceV1>>
    let pendingRead: ReturnType<typeof resolveFor> | undefined
    let disposal: Promise<void> | undefined
    const completionLookupStarted = deferred<void>()
    const releaseLookup = deferred<{ readonly id: typeof WORKSPACE_ID }>()
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            pendingRead = resolveFor(installed.source, session, 'gap-call')
            disposal = installed.dispose()
            completionLookupStarted.resolve()
            return releaseLookup.promise
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
      workspaceRecheckTimeoutMs: 120_000,
    })
    session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await completionLookupStarted.promise
    if (pendingRead === undefined || disposal === undefined) {
      throw new Error('completion Workspace resolver did not start its close race')
    }
    let readResult: Awaited<ReturnType<typeof resolveFor>> | undefined
    let disposalSettled = false
    void pendingRead.then(result => { readResult = result })
    void disposal.then(() => { disposalSettled = true })

    try {
      await waitFor(() => disposalSettled && readResult !== undefined)
      expect(readResult).toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
      })
      expect(qualifyForAuthoring).not.toHaveBeenCalled()
      expect(onGap).not.toHaveBeenCalled()
    } finally {
      releaseLookup.resolve({ id: WORKSPACE_ID })
      await Promise.allSettled([pendingRead, disposal])
      await ctx.fiber.dispose()
    }
  })

  it('interrupts a pending completion Workspace recheck when its Cordis owner unloads', async () => {
    let lookups = 0
    const completionLookupStarted = deferred<void>()
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            completionLookupStarted.resolve()
            return new Promise<never>(() => undefined)
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      onGap,
      workspaceRecheckTimeoutMs: 120_000,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await completionLookupStarted.promise
    expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain(
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )

    await ctx.fiber.dispose()
    expect(ctx.fiber.getEffects().map(effect => effect.label)).not.toContain(
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )
    await expect(installed.dispose()).resolves.toBeUndefined()

    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    expect(onGap).not.toHaveBeenCalled()
  })

  it('blocks a reentrant same-subject read until its completion Workspace recheck settles', async () => {
    let lookups = 0
    let session!: Session
    let installed!: Awaited<ReturnType<typeof installCapabilityGapRoutingEvidenceV1>>
    let reentrantRead: ReturnType<typeof resolveFor> | undefined
    let reentrantSettled = false
    const completionLookupStarted = deferred<void>()
    const releaseLookup = deferred<{ readonly id: typeof WORKSPACE_ID }>()
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(() => {
          lookups += 1
          if (lookups === 2) {
            reentrantRead = resolveFor(installed.source, session, 'gap-call')
            void reentrantRead.then(
              () => { reentrantSettled = true },
              () => { reentrantSettled = true },
            )
            completionLookupStarted.resolve()
            return releaseLookup.promise
          }
          return Promise.resolve({ id: WORKSPACE_ID })
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    await completionLookupStarted.promise
    if (reentrantRead === undefined) {
      throw new Error('completion Workspace resolver did not issue its reentrant read')
    }
    await nextEventLoopTurn()
    const settledBeforeRecheck = reentrantSettled
    releaseLookup.resolve({ id: WORKSPACE_ID })

    expect(settledBeforeRecheck).toBe(false)
    await expect(reentrantRead).resolves.toMatchObject({ status: 'matched' })
    await nextEventLoopTurn()
    expect(qualifyForAuthoring).toHaveBeenCalledOnce()
    expect(onGap).toHaveBeenCalledOnce()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('does not poison a subject when lifecycle disposal wins a pending Workspace recheck', async () => {
    let resolution = WORKSPACE_ID
    let lookups = 0
    const completionLookup = deferred<void>()
    const releaseLookup = deferred<void>()
    const ctx = await contextFixture()
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: {
        resolveByPath: vi.fn(async () => {
          lookups += 1
          if (lookups === 2) {
            completionLookup.resolve()
            await releaseLookup.promise
          }
          return { id: resolution }
        }),
      },
    })
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
      onGap,
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const turn = runSuccessfulGapTurn(ctx, agent, session)
    await completionLookup.promise
    ctx.emit('agent/disposed', { agent })
    resolution = OTHER_WORKSPACE_ID
    releaseLookup.resolve()
    await turn

    expect(onGap).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('records a conflict when the exact final Tool result is observed twice', async () => {
    const ctx = await contextFixture()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    let duplicated = false
    const removeDuplicate = ctx.on('tools/result', (execution, result) => {
      if (execution.name !== 'report_capability_gap' || duplicated) return
      duplicated = true
      ctx.emit('tools/result', execution, result)
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session)
    expect(duplicated).toBe(true)
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    removeDuplicate()
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('installs without Tools, then mounts the owned producer for a later clean turn', async () => {
    const ctx = await contextFixture({ tools: false })
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    expect(ctx.get('tools')).toBeUndefined()

    const toolsFiber = ctx.plugin(Tools)
    await toolsFiber
    await waitFor(() => ctx.tools.get('report_capability_gap') !== undefined)
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    await runSuccessfulGapTurn(ctx, agent, session)

    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toMatchObject({
      status: 'matched',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('can dispose before Tools ever mounts and never registers afterward', async () => {
    const ctx = await contextFixture({ tools: false })
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    })

    await installed.dispose()
    const toolsFiber = ctx.plugin(Tools)
    await toolsFiber
    await nextEventLoopTurn()

    expect(ctx.tools.get('report_capability_gap')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it(LIFECYCLE_RETENTION_TEST, async () => {
    if (process.env[ROUTING_GC_CHILD_ENV] !== '1') {
      runLifecycleRetentionGcChild()
      return
    }
    const probe = await disposedLifecycleRetentionProbe()

    await expectWeakRefsCollected([probe.agent, probe.session])
    await expect(probe.installed.dispose()).resolves.toBeUndefined()
  })

  it('rolls back a duplicate installation without disturbing the active producer', async () => {
    const ctx = await contextFixture()
    const dependencies = {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }
    const options = {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    } as const
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, dependencies, options)
    const ownedDefinition = ctx.tools.get('report_capability_gap')

    await expect(
      installCapabilityGapRoutingEvidenceV1(ctx, dependencies, options),
    ).rejects.toThrow()
    expect(ctx.tools.get('report_capability_gap')).toBe(ownedDefinition)

    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })
    await runSuccessfulGapTurn(ctx, agent, session)
    await expect(resolveFor(installed.source, session, 'gap-call')).resolves.toMatchObject({
      status: 'matched',
    })

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('unmounts the producer even when its evidence Domain fails to close', async () => {
    const ctx = await contextFixture({ facility: closeFailingMemoryFacility() })
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    })
    expect(ctx.tools.get('report_capability_gap')).toBeDefined()

    await expect(installed.dispose()).rejects.toThrow('fixture domain close failed')
    expect(ctx.tools.get('report_capability_gap')).toBeUndefined()
    await expect(installed.dispose()).rejects.toThrow('fixture domain close failed')

    await ctx.fiber.dispose()
  })

  it('invalidates an in-flight old Tools epoch and recovers on a clean post-remount turn', async () => {
    const ctx = await contextFixture({ tools: false })
    const firstTools = ctx.plugin(Tools)
    await firstTools
    const entered = deferred<void>()
    const release = deferred<void>()
    let records = 0
    const gaps = {
      async record(input: CapabilityGapInput) {
        records += 1
        if (records === 1) {
          entered.resolve()
          await release.promise
        }
        return {
          created: true,
          gap: {
            schemaVersion: 1 as const,
            id: '5'.repeat(64),
            ...structuredClone(input),
            status: 'confirmed' as const,
          },
        }
      },
      qualifyForAuthoring: vi.fn(async () => {
        throw new Error('no-Goal fixture must not qualify for authoring')
      }),
    }
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps,
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const oldTurn = runSuccessfulGapTurn(ctx, agent, session, { callId: 'old-gap-call' })
    await entered.promise
    await firstTools.dispose()
    await nextEventLoopTurn()
    release.resolve()
    await oldTurn

    const secondTools = ctx.plugin(Tools)
    await secondTools
    await waitFor(() => ctx.tools.get('report_capability_gap') !== undefined)
    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'new-gap-call',
    })

    await expect(resolveFor(installed.source, session, 'old-gap-call')).resolves.toEqual({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    await expect(resolveFor(installed.source, session, 'new-gap-call')).resolves.toMatchObject({
      status: 'matched',
    })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('releases completed-turn observations so a later turn may reuse its callId', async () => {
    const ctx = await contextFixture()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, {
      policies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: 10 },
      }],
    })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    await runSuccessfulGapTurn(ctx, agent, session, { callId: 'reused-gap-call' })
    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'reused-gap-call',
    })

    await expect(resolveFor(installed.source, session, 'reused-gap-call', 1)).resolves
      .toMatchObject({ status: 'matched' })
    await expect(resolveFor(installed.source, session, 'reused-gap-call', 2)).resolves
      .toMatchObject({ status: 'matched' })
    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('drops an unfinished-turn witness and permits a clean later callId reuse', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const gaps = inMemoryGaps()
    const qualifyForAuthoring = vi.fn(gaps.qualifyForAuthoring)
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: { ...gaps, qualifyForAuthoring },
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, { onGap })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const provisional = await runSuccessfulGapTurn(ctx, agent, session, {
      callId: 'reused-after-unfinished',
      turnReason: { kind: 'blocked' },
    })
    expect(provisional).toMatchObject({
      isError: false,
      value: { status: 'queued', requestedSkill: 'release-audit' },
      content: [{
        type: 'text',
        text: expect.stringContaining(
          'authoring eligibility is checked only after an exact completed turn, and discovery may not run',
        ),
      }],
    })
    expect(JSON.stringify(provisional.content)).not.toContain('discovery continues asynchronously')
    await nextEventLoopTurn()
    expect(onGap).not.toHaveBeenCalled()
    expect(qualifyForAuthoring).not.toHaveBeenCalled()

    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'reused-after-unfinished',
    })
    await nextEventLoopTurn()
    expect(onGap).toHaveBeenCalledOnce()
    expect(qualifyForAuthoring).toHaveBeenCalledOnce()

    await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 3,
      callId: 'reused-after-unfinished',
    })
    await nextEventLoopTurn()
    expect(onGap).toHaveBeenCalledOnce()
    expect(qualifyForAuthoring).toHaveBeenCalledTimes(2)

    await installed.dispose()
    await ctx.fiber.dispose()
  })

  it('permanently rejects a lifecycle after a replayed native Session event', async () => {
    const ctx = await contextFixture()
    installGoalFixture(ctx)
    const onGap = vi.fn()
    const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
      gaps: inMemoryGaps(),
      capabilities: completeCapabilities('routing-evidence-session'),
      evolution: nativeEvolution(),
    }, { onGap })
    const session = ctx.sessions.create(SessionId('routing-evidence-session'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
    })
    const agent = agentFixture(ctx, session)
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    const replayed = await runSuccessfulGapTurn(ctx, agent, session, {
      afterEnqueue: event => ctx.emit('session/event', session, event),
    })
    const later = await runSuccessfulGapTurn(ctx, agent, session, {
      turn: 2,
      callId: 'post-replay-gap-call',
    })
    await nextEventLoopTurn()

    expect(replayed).toMatchObject({ isError: true })
    expect(later).toMatchObject({ isError: true })
    expect(onGap).not.toHaveBeenCalled()
    await installed.dispose()
    await ctx.fiber.dispose()
  })
})

async function contextFixture(options: {
  readonly tools?: boolean
  readonly facility?: DomainFacility
} = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  if (options.tools !== false) await ctx.plugin(Tools)
  ctx.provide('workspaceRegistry', {
    resolveByPath: async () => ({ id: WORKSPACE_ID }),
  } as never)
  Object.defineProperty(ctx, 'storageDomain', {
    configurable: true,
    value: options.facility ?? memoryFacility(),
  })
  return ctx
}

function agentFixture(ctx: Context, session: Session): Agent {
  const agent = { id: session.id, ctx, session } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

async function scopedAgentFixture(
  ctx: Context,
  session: Session,
): Promise<{ readonly agent: Agent }> {
  const agent = { id: session.id, ctx, session } as unknown as Agent
  const toolsContext = ctx.inject(['tools'], () => undefined)
  await toolsContext
  const scope = createScope(toolsContext.ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  ctx.agents.register(agent)
  return { agent }
}

function shadowGapTool() {
  const contract = INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1
  return defineTool({
    name: contract.name,
    description: 'Test-only shadow of the owned Capability Gap Tool.',
    parameters: contract.parameters,
    output: {
      schema: contract.output,
      render: () => [{ type: 'text', text: 'shadow result' }],
    },
    async execute({ name }) {
      return {
        status: 'abstained' as const,
        reason: 'missing-native-goal' as const,
        gapId: '7'.repeat(64),
        requestedSkill: name,
      }
    },
  })
}

function completeCapabilities(sessionId: string): CapabilityMap {
  const capabilities = new CapabilityMap()
  capabilities.observe({
    workspaceId: WORKSPACE_ID,
    sessionId,
    snapshot: { complete: true, skills: [] },
  })
  return capabilities
}

function installGoalFixture(
  ctx: Context,
  overrides: Partial<GoalFixtureView> = {},
): void {
  const phase = overrides.phase ?? 'active'
  const goal: GoalFixtureView = {
    id: 'goal-1',
    revision: phase === 'active' ? 1 : 2,
    objective: 'Publish a verified native DSH plugin.',
    phase,
    ...overrides,
  }
  ctx.provide('goals' as never, {
    get: vi.fn(() => ({ ...goal })),
  } as never)
}

function inMemoryGaps() {
  const byIdentity = new Map<string, CapabilityGap>()
  const byId = new Map<string, CapabilityGap>()
  return {
    async record(input: CapabilityGapInput) {
      const identity = JSON.stringify([
        input.workspaceId,
        input.sessionId,
        input.requestedSkill,
        input.catalogHash,
        input.generationId ?? null,
        input.goal?.id ?? null,
        input.goal?.revision ?? null,
      ])
      const existing = byIdentity.get(identity)
      if (existing !== undefined) return { created: false, gap: structuredClone(existing) }
      const id = capabilityGapIdV1(input)
      const stored: CapabilityGap = {
        schemaVersion: 1 as const,
        id,
        ...structuredClone(input),
        status: 'confirmed' as const,
      }
      byIdentity.set(identity, stored)
      byId.set(id, stored)
      return { created: true, gap: structuredClone(stored) }
    },
    async qualifyForAuthoring(
      gapId: string,
      qualification: CapabilityGapAuthoringQualification,
    ) {
      const stored = byId.get(gapId)
      if (stored === undefined || stored.goal === undefined) {
        throw new Error('fixture Gap is unavailable for qualification')
      }
      if (stored.authoringQualification !== undefined) {
        return { qualified: false, gap: structuredClone(stored) }
      }
      const qualified: CapabilityGap = {
        ...stored,
        authoringQualification: structuredClone(qualification),
      }
      byId.set(gapId, qualified)
      for (const [identity, candidate] of byIdentity) {
        if (candidate === stored) byIdentity.set(identity, qualified)
      }
      return { qualified: true, gap: structuredClone(qualified) }
    },
  }
}

function nativeEvolution(): Pick<EvolutionStore, 'getSessionGeneration'> {
  return { getSessionGeneration: () => undefined }
}

async function runSuccessfulGapTurn(
  ctx: Context,
  agent: Agent,
  session: Session,
  options: {
    readonly turn?: number
    readonly callId?: string
    readonly toolName?: 'report_capability_gap' | 'skill'
    readonly requestedSkill?: string
    readonly loggedTools?: readonly ToolSchema[]
    readonly signal?: AbortSignal
    readonly afterEnqueue?: (event: SessionEvent<'agent/inbox/spliced'>) => Promise<void> | void
    readonly beforeRequestHeader?: () => Promise<void> | void
    readonly beforeExecute?: () => Promise<void> | void
    readonly executeAgain?: () => Promise<void> | void
    readonly beforeTurnEnd?: () => Promise<void> | void
    readonly turnReason?: SessionEvent<'turn/end'>['data']['reason']
    readonly durableGoal?: GoalFixtureView | 'omit'
  } = {},
) {
  const turn = options.turn ?? 1
  const callId = ToolCallId(options.callId ?? 'gap-call')
  const toolName = options.toolName ?? 'report_capability_gap'
  const requestedSkill = options.requestedSkill ?? 'release-audit'
  const serializedArguments = JSON.stringify({ name: requestedSkill })
  const suffix = `${turn}-${callId}`
  const human = {
    id: MessageId(`human-message-${suffix}`),
    role: 'user' as const,
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: 'Find a reusable release audit method.' }],
  }
  appendDurableGoalFixture(ctx, agent, session, options.durableGoal)
  const enqueue = session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, inserted: [human],
  })
  await options.afterEnqueue?.(enqueue)
  session.append('turn/start', { turn })
  session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, removedCount: 1, inserted: [],
  })
  await preStep(ctx, agent, turn, 1)
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', human, { surfaceOp: 'append' })
  await options.beforeRequestHeader?.()
  session.append('request/header', {
    header: {
      config: { provider: 'fixture', model: 'fixture-model' },
      tools: [...options.loggedTools ?? ctx.tools.schemas(agent)],
    },
    reason: turn === 1 ? 'initial' : 'resume',
  })
  session.append('request/context', {
    provider: 'fixture', model: 'fixture-model', contextWindow: 32_768 + turn,
  })
  const triggerChunks = [
    session.append('assistant/chunk', {
      turn, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' },
    }),
    session.append('assistant/chunk', {
    turn,
    step: 1,
    chunk: {
      type: 'tool-call-delta',
      index: 0,
      id: callId,
      name: toolName,
      argumentsDelta: serializedArguments,
    },
  }),
    session.append('assistant/chunk', {
    turn,
    step: 1,
    chunk: {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: callId,
        name: toolName,
        arguments: serializedArguments,
      },
    },
  }),
    session.append('assistant/chunk', {
      turn, step: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } },
    }),
  ]
  session.append('assistant/message', {
    turn,
    step: 1,
    message: {
      id: MessageId(`trigger-assistant-${suffix}`),
      role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
      content: [{
        type: 'tool-call',
        id: callId,
        name: toolName,
        arguments: serializedArguments,
      }],
    },
  }, {
    surfaceOp: 'append',
    sourceEventSeqs: triggerChunks.map(event => event.seq),
  })
  const call = session.append('tool/call', {
    turn,
    step: 1,
    callId,
    name: toolName,
    arguments: serializedArguments,
  })
  await options.beforeExecute?.()
  const execute = () => ctx.tools.execute({
    callId,
    name: toolName,
    arguments: { name: requestedSkill },
    agent,
    signal: options.signal ?? new AbortController().signal,
  })
  let execution = await execute()
  if (options.executeAgain !== undefined) {
    await options.executeAgain()
    execution = await execute()
  }
  session.append('tool/result', {
    turn,
    step: 1,
    message: {
      id: MessageId(`gap-result-${suffix}`),
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        isError: execution.isError,
        content: execution.content,
      }],
    },
    ...execution.isError && execution.error.info !== undefined
      ? { error: execution.error.info }
      : {},
    ...execution.meta === undefined ? {} : { meta: execution.meta },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn, step: 1 })
  await preStep(ctx, agent, turn, 2)
  session.append('step/start', { turn, step: 2 })
  const terminalChunks = [
    session.append('assistant/chunk', {
      turn, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
    session.append('assistant/chunk', {
      turn, step: 2, chunk: { type: 'text-delta', index: 0, text: 'The gap was recorded.' },
    }),
    session.append('assistant/chunk', {
    turn,
    step: 2,
    chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'The gap was recorded.' } },
  }),
    session.append('assistant/chunk', {
      turn, step: 2, chunk: { type: 'finish', reason: { kind: 'stop' } },
    }),
  ]
  session.append('assistant/message', {
    turn,
    step: 2,
    message: {
      id: MessageId(`terminal-assistant-${suffix}`),
      role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
      content: [{ type: 'text', text: 'The gap was recorded.' }],
    },
  }, {
    surfaceOp: 'append',
    sourceEventSeqs: terminalChunks.map(event => event.seq),
  })
  session.append('step/end', { turn, step: 2 })
  await options.beforeTurnEnd?.()
  session.append('turn/end', { turn, reason: options.turnReason ?? { kind: 'completed' } })
  return execution
}

function appendDurableGoalFixture(
  ctx: Context,
  agent: Agent,
  session: Session,
  requested: GoalFixtureView | 'omit' | undefined,
): void {
  if (requested === 'omit'
    || session.snapshotEvents().some(event => event.type === 'goal/change')) return
  let goal: GoalFixtureView | undefined
  try {
    const current = ctx.get('goals')?.get(agent)
    goal = requested ?? (current === undefined
      ? undefined
      : {
          id: String(current.id),
          revision: current.revision,
          objective: current.objective,
          phase: current.phase,
        })
  } catch {
    return
  }
  if (goal === undefined) return
  const terminal = goal.phase !== 'active'
  if (goal.revision !== (terminal ? 2 : 1)) {
    throw new Error('Goal fixture revision does not match its durable phase')
  }
  const base = {
    id: GoalId(goal.id),
    revision: 1,
    objective: goal.objective,
    phase: 'active' as const,
    maxGoalRounds: 8,
  }
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: base,
    roundsStarted: 0,
    createdAt: 900,
    updatedAt: 900,
  })
  if (!terminal) return
  const operation = goal.phase === 'paused'
    ? 'pause' as const
    : goal.phase === 'blocked'
      ? 'block' as const
      : 'complete' as const
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: {
      ...base,
      revision: 2,
      phase: goal.phase,
      ...goal.phase === 'blocked'
        ? { blockedReason: { code: 'fixture-blocked', message: 'Fixture Goal is blocked.' } }
        : {},
    },
    roundsStarted: 0,
    createdAt: 900,
    updatedAt: 901,
  })
}

async function preStep(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
): Promise<void> {
  const decision = await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [],
    turn,
    step,
    signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  if (decision.kind !== 'enter') throw new Error('fixture step was rejected')
}

function durableSubject(session: Session, callId: string, turn?: number) {
  const events = session.snapshotEvents()
  const call = events.find(event => event.type === 'tool/call'
    && String(event.data.callId) === callId
    && (turn === undefined || event.data.turn === turn))
  if (call?.type !== 'tool/call') throw new Error(`fixture call '${callId}' was not found`)
  const turnEnd = events.find(event => event.type === 'turn/end'
    && event.data.turn === call.data.turn
    && event.seq > call.seq)
  if (turnEnd?.type !== 'turn/end') throw new Error(`fixture turn for '${callId}' was not completed`)
  const transcript = proveInteractionEpisodeTranscript(
    session,
    Number(turnEnd.seq),
    { callId },
  )
  if (transcript.status !== 'proven') {
    throw new Error(`fixture transcript abstained: ${transcript.reason}`)
  }
  return {
    schemaVersion: 1 as const,
    kind: 'durable-interaction-episode-subject-v1' as const,
    session: {
      header: session.header,
      inheritedEventCount: Number(session.inheritedEventCount),
      throughSeq: transcript.proof.source.turnEndSeq,
      events: events.slice(0, transcript.proof.source.turnEndSeq + 1),
    },
    transcript: transcript.proof,
  }
}

function resolveFor(
  source: Awaited<ReturnType<typeof installCapabilityGapRoutingEvidenceV1>>['source'],
  session: Session,
  callId: string,
  turn?: number,
) {
  const subject = durableSubject(session, callId, turn)
  const projected = projectInteractionEpisodeTriggerRequestControlV1(subject)
  expect(projected.status).toBe('projected')
  if (projected.status !== 'projected') throw new Error('fixture request control did not project')
  return source.resolveRoutingEvidence(subject, { triggerRequestControl: projected.fact })
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

function runLifecycleRetentionGcChild(): void {
  const packageRoot = resolve(import.meta.dirname, '..')
  const result = spawnSync(process.execPath, [
    '--expose-gc',
    resolve(packageRoot, 'node_modules/vitest/vitest.mjs'),
    'run',
    resolve(import.meta.dirname, 'capability-gap-routing-evidence.test.ts'),
    '--maxWorkers=1',
    '--execArgv=--expose-gc',
    '-t',
    LIFECYCLE_RETENTION_TEST,
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      [ROUTING_GC_CHILD_ENV]: '1',
    },
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error([
      `isolated GC child failed with ${result.signal ?? `exit ${String(result.status)}`}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
}

async function disposedLifecycleRetentionProbe() {
  let ctx: Context | undefined = await contextFixture()
  let workspaceLookups = 0
  const completionLookupStarted = deferred<void>()
  const pendingWorkspaceLookup = new Promise<never>(() => undefined)
  Object.defineProperty(ctx, 'workspaceRegistry', {
    configurable: true,
    value: {
      resolveByPath: vi.fn(() => {
        workspaceLookups += 1
        if (workspaceLookups === 2) {
          completionLookupStarted.resolve()
          return pendingWorkspaceLookup
        }
        return Promise.resolve({ id: WORKSPACE_ID })
      }),
    },
  })
  const installed = await installCapabilityGapRoutingEvidenceV1(ctx, {
    gaps: inMemoryGaps(),
    capabilities: completeCapabilities('routing-evidence-session'),
    evolution: nativeEvolution(),
  })
  let session: Session | undefined = ctx.sessions.create(SessionId('routing-evidence-session'), {
    meta: { createdAt: 1_000, cwd: '/private/workspace', agentPreset: 'default' },
  })
  let agent: Agent | undefined = { id: session.id, ctx, session } as unknown as Agent
  const removeAgent = ctx.agents.register(agent)
  ctx.emit('agent/session-start', { agent, source: 'startup' })
  const agentRef = new WeakRef(agent)
  const sessionRef = new WeakRef(session)

  await runSuccessfulGapTurn(ctx, agent, session)
  await completionLookupStarted.promise
  await installed.dispose()
  removeAgent()
  await ctx.fiber.dispose()
  agent = undefined
  session = undefined
  ctx = undefined
  // Keep the unresolved lookup rooted through the assertion. Any Agent/Session
  // reachable from its abandoned async continuation must still be detected.
  return { installed, pendingWorkspaceLookup, agent: agentRef, session: sessionRef }
}

async function expectWeakRefsCollected(refs: readonly WeakRef<object>[]): Promise<void> {
  const collect = (globalThis as { gc?: () => void }).gc
  if (collect === undefined) throw new Error('isolated GC child did not expose gc')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await nextEventLoopTurn()
    collect()
    await nextEventLoopTurn()
    if (refs.every(ref => ref.deref() === undefined)) return
  }
  expect(refs.map(ref => ref.deref())).toEqual(refs.map(() => undefined))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await nextEventLoopTurn()
  }
  throw new Error('fixture condition did not settle')
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function memoryFacility(): DomainFacility {
  const table = new MemoryTable<unknown>()
  return {
    async open() {
      return {
        name: 'interaction-routing-evidence-test',
        table: () => table,
        close: async () => undefined,
      }
    },
  } as unknown as DomainFacility
}

function failingMemoryFacility(): DomainFacility {
  const table = new FailingMemoryTable<unknown>()
  return {
    async open() {
      return {
        name: 'interaction-routing-evidence-failing-test',
        table: () => table,
        close: async () => undefined,
      }
    },
  } as unknown as DomainFacility
}

function poisoningMemoryFacility(): DomainFacility {
  const table = new PoisoningMemoryTable<unknown>()
  return {
    async open() {
      return {
        name: 'interaction-routing-evidence-poisoning-test',
        table: () => table,
        close: async () => undefined,
      }
    },
  } as unknown as DomainFacility
}

function closeFailingMemoryFacility(): DomainFacility {
  const table = new MemoryTable<unknown>()
  return {
    async open() {
      return {
        name: 'interaction-routing-evidence-close-failing-test',
        table: () => table,
        close: async () => {
          throw new Error('fixture domain close failed')
        },
      }
    },
  } as unknown as DomainFacility
}

class MemoryTable<V> implements KvTable<string, V> {
  private readonly records = new Map<string, V>()
  private tail = Promise.resolve()

  get size(): number { return this.records.size }
  get(key: string): V | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, V]> { return this.records.entries() }
  keys(): IterableIterator<string> { return this.records.keys() }

  put(key: string, value: V): Promise<void> {
    return this.enqueue(async () => { this.records.set(key, structuredClone(value)) })
  }

  delete(key: string): Promise<boolean> {
    return this.enqueue(async () => this.records.delete(key))
  }

  update(key: string, transform: (current: V) => V): Promise<V> {
    return this.enqueue(async () => {
      const current = this.records.get(key)
      if (current === undefined) throw new Error(`missing key ${key}`)
      const next = structuredClone(transform(structuredClone(current)))
      this.records.set(key, next)
      return next
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

class FailingMemoryTable<V> extends MemoryTable<V> {
  override put(_key: string, _value: V): Promise<void> {
    return Promise.reject(new Error('fixture routing retention failed'))
  }
}

class PoisoningMemoryTable<V> extends MemoryTable<V> {
  private poison = true

  override async put(key: string, value: V): Promise<void> {
    if (!this.poison) return super.put(key, value)
    this.poison = false
    await super.put(key, { divergent: true } as V)
    throw new Error('fixture routing retention has an uncertain durable state')
  }
}
