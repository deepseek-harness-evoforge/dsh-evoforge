import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { Inbox } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry, { type SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, {
  type ToolDispatchExecution,
  type ToolExecutionResult,
  type ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'
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
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
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
    await emitSkillResult(ctx, agent, false)
    await monitor.flush()

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-observed')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'build-dsh-plugin', route: 'model-selected' }],
    })
    await emitSkillResult(ctx, agent, true)
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

  it('revokes the prior Session observation when current identity resolution fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const resolveByPath = vi.fn(async () => ({ id: WORKSPACE_ID }))
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-identity-failure')
    const observe = (turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    await observe(1)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-identity-failure').status).toBe('complete')
    resolveByPath.mockRejectedValueOnce(new Error('Workspace unavailable'))

    await observe(2)

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-identity-failure')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })
    await observe(3)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-identity-failure').status).toBe('complete')

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes the prior Session observation when disposed identity resolution fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const resolveByPath = vi.fn(async () => ({ id: WORKSPACE_ID }))
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-disposed-identity-failure')
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-disposed-identity-failure').status)
      .toBe('complete')
    resolveByPath.mockRejectedValueOnce(new Error('Workspace unavailable'))

    agentEvents(ctx, agent).emit('agent/disposed', {})
    await monitor.flush()

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-disposed-identity-failure')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps the newest same-epoch snapshot when overlapping observations settle out of order', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-overlapping-success')
    const observe = (turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    let firstSnapshotStarted!: () => void
    let releaseFirstSnapshot!: () => void
    const started = new Promise<void>((resolve) => { firstSnapshotStarted = resolve })
    const released = new Promise<void>((resolve) => { releaseFirstSnapshot = resolve })
    vi.spyOn(ctx.skills, 'snapshot')
      .mockImplementationOnce(async () => {
        firstSnapshotStarted()
        await released
        return catalog('write-release-notes')
      })
      .mockResolvedValueOnce(catalog('build-dsh-plugin'))

    const older = observe(1)
    await started
    await observe(2)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-overlapping-success')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'build-dsh-plugin' }],
    })

    releaseFirstSnapshot()
    await older
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-overlapping-success')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'build-dsh-plugin' }],
    })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('does not let an older rejected snapshot revoke a newer same-epoch observation', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-overlapping-rejection')
    const observe = (turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    let firstSnapshotStarted!: () => void
    let rejectFirstSnapshot!: (reason: Error) => void
    const started = new Promise<void>((resolve) => { firstSnapshotStarted = resolve })
    const rejected = new Promise<SkillCatalogSnapshot>((_resolve, reject) => {
      rejectFirstSnapshot = reject
    })
    vi.spyOn(ctx.skills, 'snapshot')
      .mockImplementationOnce(async () => {
        firstSnapshotStarted()
        return rejected
      })
      .mockResolvedValueOnce(catalog('build-dsh-plugin'))

    const older = observe(1)
    await started
    await observe(2)
    rejectFirstSnapshot(new Error('stale snapshot failed'))
    await older

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-overlapping-rejection')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'build-dsh-plugin' }],
    })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes a prior observation when the current Skill snapshot rejects and later recovers', async () => {
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
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-snapshot-rejection')
    const observe = (turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )

    await observe(1)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-snapshot-rejection').status).toBe('complete')
    vi.spyOn(ctx.skills, 'snapshot').mockRejectedValueOnce(new Error('snapshot unavailable'))
    await observe(2)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-snapshot-rejection')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })

    await observe(3)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-snapshot-rejection').status).toBe('complete')

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes every mount observation across a catalog change and rejects an in-flight stale snapshot', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const first = sessionAgent('session-change-a')
    const second = sessionAgent('session-change-b')
    const observe = (agent: Agent, turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    await observe(first, 1)
    await observe(second, 1)
    let snapshotStarted!: () => void
    let releaseSnapshot!: () => void
    const started = new Promise<void>((resolve) => { snapshotStarted = resolve })
    const released = new Promise<void>((resolve) => { releaseSnapshot = resolve })
    vi.spyOn(ctx.skills, 'snapshot').mockImplementationOnce(async () => {
      snapshotStarted()
      await released
      return { complete: true, skills: [] }
    })

    const inFlight = observe(first, 2)
    await started
    ctx.skills.register({
      name: 'newly-installed-skill',
      description: 'Use after the catalog mutation.',
      source: 'runtime',
      content: 'New native Skill body.',
    })

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-a').status).toBe('unobserved')
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-b').status).toBe('unobserved')
    releaseSnapshot()
    await inFlight
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-a').status).toBe('unobserved')

    await observe(first, 3)
    await observe(second, 2)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-a')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'newly-installed-skill' }],
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-b')).toMatchObject({
      status: 'complete',
      capabilities: [{ name: 'newly-installed-skill' }],
    })

    await monitor.dispose()
    capabilities.observe({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-change-a',
      snapshot: catalog('write-release-notes'),
    })
    ctx.skills.register({
      name: 'post-dispose-skill',
      description: 'Mutation after observer disposal.',
      source: 'runtime',
      content: 'Post-dispose body.',
    })
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-change-a').status).toBe('complete')

    await ctx.fiber.dispose()
  })

  it('revokes every catalog observed by one Skill-registry mount when that mount disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-mount-revoked')

    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-mount-revoked').status).toBe('complete')

    await monitor.dispose()

    expect(capabilities.snapshot(WORKSPACE_ID, 'session-mount-revoked')).toEqual({
      status: 'unobserved',
      capabilities: [],
    })
    await ctx.fiber.dispose()
  })

  it('does not attribute an old Skill result to a refreshed catalog after mutation', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    const resolveByPath = vi.fn(async () => ({ id: WORKSPACE_ID }))
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath },
    })
    ctx.skills.register({
      name: 'build-dsh-plugin',
      description: 'Use for native DSH plugin work.',
      source: 'project-agents',
      provider: 'runtime',
      content: 'private body',
    })
    const capabilities = new CapabilityMap()
    const monitor = installCapabilityMapObserver(ctx, capabilities, {
      getSessionGeneration: vi.fn(),
    })
    const agent = sessionAgent('session-route-mutation')
    const observe = (turn: number) => agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    await observe(1)
    const { execution, result } = skillResult(agent, false)
    await dispatchSkillExecution(ctx, agent, execution, result)
    ctx.skills.register({
      name: 'newly-installed-skill',
      description: 'Use after the catalog mutation.',
      source: 'runtime',
      content: 'New native Skill body.',
    })
    let routeIdentityStarted!: () => void
    let releaseRouteIdentity!: () => void
    const started = new Promise<void>((resolve) => { routeIdentityStarted = resolve })
    const released = new Promise<void>((resolve) => { releaseRouteIdentity = resolve })
    resolveByPath.mockImplementationOnce(async () => {
      routeIdentityStarted()
      await released
      return { id: WORKSPACE_ID }
    })

    emitSkillResultEvent(ctx, agent, execution, result)
    await started
    await observe(2)
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-route-mutation').capabilities)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'build-dsh-plugin', route: 'available' }),
        expect.objectContaining({ name: 'newly-installed-skill', route: 'available' }),
      ]))

    releaseRouteIdentity()
    await monitor.flush()
    expect(capabilities.snapshot(WORKSPACE_ID, 'session-route-mutation').capabilities)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'build-dsh-plugin', route: 'available' }),
        expect.objectContaining({ name: 'newly-installed-skill', route: 'available' }),
      ]))

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

async function emitSkillResult(ctx: Context, agent: Agent, isError: boolean): Promise<void> {
  const { execution, result } = skillResult(agent, isError)
  await dispatchSkillExecution(ctx, agent, execution, result)
  emitSkillResultEvent(ctx, agent, execution, result)
}

function skillResult(agent: Agent, isError: boolean): {
  readonly execution: ToolDispatchExecution
  readonly result: ToolExecutionResult
} {
  const callId = ToolCallId('skill-call')
  const execution: ToolDispatchExecution = {
    callId,
    rootCallId: callId,
    name: 'skill',
    arguments: { name: 'build-dsh-plugin' },
    agent,
    signal: new AbortController().signal,
    token: Symbol('skill-call') as ToolExecutionToken,
  }
  const result: ToolExecutionResult = isError
    ? { isError: true, error: { message: 'failed' }, content: [] }
    : { isError: false, value: { name: 'build-dsh-plugin', provider: 'runtime', content: 'private body' }, content: [] }
  return { execution, result }
}

async function dispatchSkillExecution(
  ctx: Context,
  agent: Agent,
  execution: ToolDispatchExecution,
  result: ToolExecutionResult,
): Promise<void> {
  await ctx.waterfall(scopeTarget(ctx.tools, agent), 'tools/execute', execution, () => Promise.resolve(result))
}

function emitSkillResultEvent(
  ctx: Context,
  agent: Agent,
  execution: ToolDispatchExecution,
  result: ToolExecutionResult,
): void {
  ctx.emit(scopeTarget(ctx.tools, agent), 'tools/result', execution, result)
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
