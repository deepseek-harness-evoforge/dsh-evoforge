import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry, { type SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityMap, installCapabilityMapObserver } from '../src/capability-map.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationId = 'a'.repeat(64)

describe('CapabilityMap', () => {
  it('projects one exact Session catalog and records the Skill selected by the model', () => {
    const capabilities = new CapabilityMap()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-a',
      snapshot: catalog('build-dsh-plugin'),
      generation: generation('build-dsh-plugin'),
    })
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-b',
      snapshot: catalog('write-release-notes'),
    })

    capabilities.recordRoute(WORKSPACE_ID, 'session-a', 'build-dsh-plugin', 'model-selected')

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-a')).toEqual({
      status: 'complete',
      catalogHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      capabilities: [{
        name: 'build-dsh-plugin',
        description: 'Use for native DSH plugin work.',
        source: 'project-agents',
        provider: 'filesystem',
        scope: 'workspace-session',
        invocation: { model: true, user: true },
        versionKind: 'evolved-tree',
        version: 'e'.repeat(40),
        generationId,
        route: 'model-selected',
      }],
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-b')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'write-release-notes', route: 'available', versionKind: 'provider-managed' }],
    })
    expect(JSON.stringify(capabilities.snapshot(WORKSPACE_ID, 'session-a'))).not.toContain('/private/skills')
  })

  it('observes the native scoped catalog and records only a successful native skill result', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    ctx.skills.register({
      name: 'build-dsh-plugin',
      description: 'Use for native DSH plugin work.',
      source: 'project-agents',
      provider: 'runtime',
      content: 'private body',
    })
    const capabilities = new CapabilityMap()
    const store = {
      getSessionGeneration: vi.fn(() => generation('build-dsh-plugin')),
    } as unknown as EvolutionStore
    const monitor = installCapabilityMapObserver(ctx, capabilities, store)
    const agent = sessionAgent('session-observed')

    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    emitSkillResult(ctx, agent, false)
    await monitor.flush()

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-observed')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'build-dsh-plugin', route: 'model-selected' }],
    })
    emitSkillResult(ctx, agent, true)
    await monitor.flush()
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-observed').capabilities[0]?.route)
      .toBe('model-selected')

    agentEvents(ctx, agent).emit('agent/disposed', {})
    await monitor.flush()
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-observed')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function sessionAgent(id: string): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, [], { version: 0, id: sessionId, createdAt: 1, cwd: '/repo', isSeeded: false })
  return {
    ctx: new Context(),
    id: sessionId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function emitSkillResult(ctx: Context, agent: Agent, isError: boolean): void {
  const execution = {
    callId: 'skill-call',
    rootCallId: 'skill-call',
    name: 'skill',
    arguments: { name: 'build-dsh-plugin' },
    agent,
    signal: new AbortController().signal,
    token: Symbol('skill-call'),
  }
  const result = isError
    ? { isError: true, error: { message: 'failed' }, content: [] }
    : { isError: false, value: { name: 'build-dsh-plugin', provider: 'runtime', content: 'private body' }, content: [] }
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', execution, result)
}

function catalog(name: string): SkillCatalogSnapshot {
  return {
    complete: true,
    skills: [{
      name,
      description: name === 'build-dsh-plugin'
        ? 'Use for native DSH plugin work.'
        : 'Use for release notes.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'project-agents',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: `/private/skills/${name}` },
    }],
  }
}

function generation(skillName: string): CapabilityGeneration {
  return {
    id: generationId,
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_786_896_000_000,
    artifacts: [{
      kind: 'skill',
      name: skillName,
      gitCommit: 'd'.repeat(40),
      treeHash: 'e'.repeat(40),
    }],
    evaluatorVersion: 'case-pack-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}
