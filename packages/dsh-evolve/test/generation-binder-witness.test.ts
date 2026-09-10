import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, {
  Session,
  SessionId,
  SessionSeq,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import SkillRegistry, { type SkillProvider } from '@deepseek-ai/dsh-skill'
import { describe, expect, it, vi } from 'vitest'
import { installGenerationBinder } from '../src/generation-binder.js'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import {
  type InteractionGenerationEvidenceSinkV1,
} from '../src/interaction-generation-evidence.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const plannedEvents = new WeakMap<Session, readonly SessionEvent[]>()

describe('Generation binder completed-turn evidence', () => {
  it('retains a native Generation receipt for one continuously gated multi-step trigger turn', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    const sink: InteractionGenerationEvidenceSinkV1 & {
      retain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['retain']>>
      drain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['drain']>>
    } = {
      allows: vi.fn(() => true),
      retain: vi.fn<InteractionGenerationEvidenceSinkV1['retain']>(async () => undefined),
      drain: vi.fn<InteractionGenerationEvidenceSinkV1['drain']>(async () => undefined),
    }
    const dispose = installGenerationBinder(
      ctx,
      store,
      { providerFor: vi.fn() },
      sink,
    )

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    emitSessionEvent(ctx, session, 2)
    await preStep(ctx, agent, 1, 1)
    emitSessionEvent(ctx, session, 3)
    emitSessionEvent(ctx, session, 14)
    await preStep(ctx, agent, 1, 2)
    emitSessionEvent(ctx, session, 15)
    emitSessionEvent(ctx, session, 21)
    emitSessionEvent(ctx, session, 22)
    await ctx.parallel('session/flush', session)

    expect(sink.retain).toHaveBeenCalledOnce()
    expect(sink.retain.mock.calls[0]?.[0]).toMatchObject({
      kind: 'interaction-generation-evidence-receipt-v1',
      workspaceId: WORKSPACE_ID,
      subject: {
        sessionLifecycleDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        turnEndSeq: 22,
        triggerRequestSeq: 11,
        triggerCallSeq: 12,
        triggerResultSeq: 13,
      },
      generation: {
        kind: 'native',
        pin: 'settled',
        effectiveMount: { kind: 'native' },
      },
      provenance: {
        kind: 'native',
        lifecycleCutoffDigest: 'ccead6d27c994b81f4b73cb8236815d0265b073f2631280c414642e042a9aede',
      },
    })
    expect(sink.retain.mock.calls[0]?.[0]).not.toHaveProperty('provenance.mountEpochDigest')
    expect(sink.retain.mock.calls[0]?.[0]).not.toHaveProperty('catalog')

    await dispose()
    await ctx.fiber.dispose()
  })

  it('binds a live nonzero Session cutoff without replaying the earlier prefix', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const first = plannedEvents.get(session)?.[0]
    if (first === undefined) throw new Error('prefix fixture event is missing')
    appendPlannedEvent(session, first)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).toHaveBeenCalledOnce()
    expect(sink.retain.mock.calls[0]?.[0]).toMatchObject({
      provenance: {
        lifecycleCutoffDigest: '269f6c535bb7cd504fb24af60681b2ec002848b14357b81323fc803f80c7c4d0',
      },
    })

    await dispose()
    await ctx.fiber.dispose()
  })

  it('retains an evolved receipt only after its canonical provider registration is ACTIVE', async () => {
    const ctx = await contextFixture()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const skillFiber = ctx.plugin(SkillRegistry)
    await skillFiber
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const generation = generationFixture()
    const store = storeFixture(generation)
    const provider: SkillProvider = {
      name: 'evoforge-generation',
      list: async () => [],
      get: async () => undefined,
    }
    const source = { providerFor: vi.fn(async () => provider) }
    const sink = sinkFixture()
    const dispose = installGenerationBinder(ctx, store, source, sink)

    await runCompletedTurn(ctx, agent, session)

    expect(warn).not.toHaveBeenCalled()
    expect(source.providerFor).toHaveBeenCalledWith(generation)
    expect(sink.retain).toHaveBeenCalledOnce()
    expect(sink.retain.mock.calls[0]?.[0]).toMatchObject({
      generation: {
        kind: 'evolved',
        pin: 'settled',
        generationId: generation.id,
        effectiveMount: { kind: 'evolved', generationId: generation.id },
      },
      provenance: {
        kind: 'evolved',
        binderEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        lifecycleCutoffDigest: 'ccead6d27c994b81f4b73cb8236815d0265b073f2631280c414642e042a9aede',
        mountEpochDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        generationDigest: generation.id,
      },
    })
    expect(sink.retain.mock.calls[0]?.[0]).not.toHaveProperty('catalog')

    await dispose()
    await ctx.fiber.dispose()
  })

  it('retains native evidence only after a malformed evolved pin is durably replaced', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const generation = generationFixture()
    const store = storeFixture(generation)
    vi.mocked(store.getGeneration).mockReturnValue({
      ...generation,
      evaluatorVersion: 'drifted-without-a-new-content-address',
    })
    const source = { providerFor: vi.fn() }
    const sink = sinkFixture()
    const dispose = installGenerationBinder(ctx, store, source, sink)

    await runCompletedTurn(ctx, agent, session)

    expect(store.fallbackSessionToNative).toHaveBeenCalledOnce()
    expect(source.providerFor).not.toHaveBeenCalled()
    expect(sink.retain).toHaveBeenCalledOnce()
    expect(sink.retain.mock.calls[0]?.[0]).toMatchObject({
      generation: {
        kind: 'native',
        pin: 'settled',
        effectiveMount: { kind: 'native' },
      },
      provenance: { kind: 'native' },
    })

    await dispose()
    await ctx.fiber.dispose()
  })

  it('continues without evidence when native fallback cannot be persisted', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const generation = generationFixture()
    const store = storeFixture(generation)
    vi.mocked(store.getGeneration).mockReturnValue({
      ...generation,
      evaluatorVersion: 'drifted-without-a-new-content-address',
    })
    vi.mocked(store.fallbackSessionToNative).mockRejectedValue(new Error('fallback write failed'))
    const sink = sinkFixture()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

    await expect(runCompletedTurn(ctx, agent, session)).resolves.toBeUndefined()

    expect(store.fallbackSessionToNative).toHaveBeenCalledOnce()
    expect(sink.retain).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback write failed'))

    await dispose()
    await ctx.fiber.dispose()
  })

  it('continues without evidence and never claims native when evolved unmount rejects', async () => {
    const ctx = await contextFixture()
    const skillFiber = ctx.plugin(SkillRegistry)
    await skillFiber
    const session = liveCompletedTriggerSession(ctx)
    const generation = generationFixture()
    const store = storeFixture(generation)
    const provider: SkillProvider = {
      name: 'evoforge-generation',
      list: async () => [],
      get: async () => undefined,
    }
    const providerFiber = {
      state: 1,
      await: vi.fn(async () => {
        throw new Error('mount failed')
      }),
      dispose: vi.fn(async () => {
        throw new Error('unmount failed')
      }),
    }
    const agent = {
      id: session.id,
      session,
      ctx: { inject: vi.fn(() => providerFiber) },
    } as unknown as Agent
    ctx.agents.register(agent)
    const sink = sinkFixture()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const dispose = installGenerationBinder(
      ctx,
      store,
      { providerFor: vi.fn(async () => provider) },
      sink,
    )

    await expect(runCompletedTurn(ctx, agent, session)).resolves.toBeUndefined()

    expect(providerFiber.dispose).toHaveBeenCalledOnce()
    expect(store.fallbackSessionToNative).not.toHaveBeenCalled()
    expect(sink.retain).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mount failed'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unmount failed'))

    await expect(dispose()).rejects.toThrow(/unmount failed/u)
    await ctx.fiber.dispose()
  })

  it.each(['session pin', 'canonical row'] as const)(
    'abstains when the evolved %s drifts before the completed turn boundary',
    async (drift) => {
      const ctx = await contextFixture()
      const skillFiber = ctx.plugin(SkillRegistry)
      await skillFiber
      const session = liveCompletedTriggerSession(ctx)
      const agent = agentFixture(ctx, session)
      const generation = generationFixture()
      const store = storeFixture(generation)
      const provider: SkillProvider = {
        name: 'evoforge-generation',
        list: async () => [],
        get: async () => undefined,
      }
      const sink = sinkFixture()
      const dispose = installGenerationBinder(
        ctx,
        store,
        { providerFor: vi.fn(async () => provider) },
        sink,
      )

      await runTurnBeforeEnd(ctx, agent, session)
      if (drift === 'session pin') {
        vi.mocked(store.getSessionGenerationPin!).mockReturnValue({ kind: 'missing' })
      } else {
        vi.mocked(store.getGeneration).mockReturnValue({
          ...generation,
          policyVersion: 'drifted-without-a-new-content-address',
        })
      }
      emitSessionEvent(ctx, session, 22)
      await ctx.parallel('session/flush', session)

      expect(sink.retain).not.toHaveBeenCalled()

      await dispose()
      await ctx.fiber.dispose()
    },
  )

  it.each(['missing', 'identity-conflict'] as const)(
    'does not treat an exact %s pin state as native evidence',
    async (kind) => {
      const ctx = await contextFixture()
      const session = liveCompletedTriggerSession(ctx)
      const agent = agentFixture(ctx, session)
      const store = storeFixture(undefined)
      vi.mocked(store.getSessionGenerationPin!).mockReturnValue({ kind })
      const sink = sinkFixture()
      const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

      await runCompletedTurn(ctx, agent, session)

      expect(sink.retain).not.toHaveBeenCalled()

      await dispose()
      await ctx.fiber.dispose()
    },
  )

  it('abstains when an older EvolutionStore does not expose exact Session pin state', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    delete store.getSessionGenerationPin
    const sink = sinkFixture()
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('rejects post-hoc replay of an already-built log even when its Agent and Session are live', async () => {
    const ctx = await contextFixture()
    const session = completedTriggerSession()
    const detachSession = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    detachSession()
    await ctx.fiber.dispose()
  })

  it.each([
    'synthetic-event',
    'replayed-event',
    'out-of-order-event',
    'duplicate-session-start',
  ] as const)(
    'permanently invalidates live lifecycle evidence after a %s observation',
    async (corruption) => {
      const ctx = await contextFixture()
      const session = liveCompletedTriggerSession(ctx)
      const agent = agentFixture(ctx, session)
      const sink = sinkFixture()
      const dispose = installGenerationBinder(
        ctx,
        storeFixture(undefined),
        { providerFor: vi.fn() },
        sink,
      )

      ctx.emit('agent/session-start', { agent, source: 'startup' })
      if (corruption === 'synthetic-event') {
        const synthetic = plannedEvents.get(session)?.[0]
        if (synthetic === undefined) throw new Error('synthetic fixture event is missing')
        ctx.emit('session/event', session, synthetic)
      } else if (corruption === 'out-of-order-event') {
        const future = plannedEvents.get(session)?.[1]
        if (future === undefined) throw new Error('out-of-order fixture event is missing')
        ctx.emit('session/event', session, future)
      } else if (corruption === 'replayed-event') {
        emitSessionEvent(ctx, session, 0)
        const replayed = session.eventAt(SessionSeq(0))
        if (replayed === undefined) throw new Error('replay fixture event is missing')
        ctx.emit('session/event', session, replayed)
      } else {
        ctx.emit('agent/session-start', { agent, source: 'resume' })
      }
      await runTurnAfterSessionStart(ctx, agent, session)
      emitSessionEvent(ctx, session, 22)

      expect(sink.retain).not.toHaveBeenCalled()

      await dispose()
      await ctx.fiber.dispose()
    },
  )

  it('does not forget a corrupted lifecycle when the same Agent is disposed and announced again', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )
    const synthetic = plannedEvents.get(session)?.[0]
    if (synthetic === undefined) throw new Error('synthetic fixture event is missing')

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    ctx.emit('session/event', session, synthetic)
    ctx.emit('agent/disposed', { agent })
    ctx.emit('agent/session-start', { agent, source: 'resume' })
    await runTurnAfterSessionStart(ctx, agent, session)
    emitSessionEvent(ctx, session, 22)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('does not forget a pre-step observed before session-start after the Agent is announced again', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    await preStep(ctx, agent, 1, 1)
    ctx.emit('agent/disposed', { agent })
    ctx.emit('agent/session-start', { agent, source: 'resume' })
    await runTurnAfterSessionStart(ctx, agent, session)
    emitSessionEvent(ctx, session, 22)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('keeps a live Session ineligible after a synthetic event arrives before session-start', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )
    const synthetic = plannedEvents.get(session)?.[0]
    if (synthetic === undefined) throw new Error('synthetic fixture event is missing')

    ctx.emit('session/event', session, synthetic)
    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('poisons the canonical lifecycle when a same-id Session impostor emits before session-start', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )
    const impostor = Session.create(session.id, undefined, session.header)
    const synthetic = plannedEvents.get(session)?.[0]
    if (synthetic === undefined) throw new Error('synthetic fixture event is missing')

    ctx.emit('session/event', impostor, synthetic)
    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('does not bind a synthetic session-start subject absent from the live registries', async () => {
    const ctx = await contextFixture()
    const session = completedTriggerSession()
    const agent = { id: session.id, ctx, session } as unknown as Agent
    const store = storeFixture(undefined)
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sinkFixture())

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    await Promise.resolve()

    expect(store.pinSession).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a session-start whose Agent is not the exact live registry instance', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    agentFixture(ctx, session)
    const impostor = { id: session.id, ctx, session } as unknown as Agent
    const store = storeFixture(undefined)
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sinkFixture())

    ctx.emit('agent/session-start', { agent: impostor, source: 'startup' })
    await Promise.resolve()

    expect(store.pinSession).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a session-start whose Session is not the exact live store instance', async () => {
    const ctx = await contextFixture()
    const live = ctx.sessions.create(SessionId('generation-session-impostor'), {
      meta: { createdAt: 1_000, cwd: '/private/workspace' },
    })
    const impostor = Session.create(live.id, undefined, live.header)
    const agent = { id: impostor.id, ctx, session: impostor } as unknown as Agent
    ctx.agents.register(agent)
    const store = storeFixture(undefined)
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sinkFixture())

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    await Promise.resolve()

    expect(store.pinSession).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('invalidates a turn when the same evolved provider endpoint reloads between steps', async () => {
    const ctx = await contextFixture()
    const firstSkillFiber = ctx.plugin(SkillRegistry)
    await firstSkillFiber
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const generation = generationFixture()
    const store = storeFixture(generation)
    const provider: SkillProvider = {
      name: 'evoforge-generation',
      list: async () => [],
      get: async () => undefined,
    }
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      store,
      { providerFor: vi.fn(async () => provider) },
      sink,
    )

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    emitSessionEvent(ctx, session, 2)
    await preStep(ctx, agent, 1, 1)
    emitSessionEvent(ctx, session, 3)
    emitSessionEvent(ctx, session, 14)

    await firstSkillFiber.dispose()
    const reloadedSkillFiber = ctx.plugin(SkillRegistry)
    await reloadedSkillFiber

    await preStep(ctx, agent, 1, 2)
    emitSessionEvent(ctx, session, 15)
    emitSessionEvent(ctx, session, 21)
    emitSessionEvent(ctx, session, 22)
    await ctx.parallel('session/flush', session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('keeps turns usable when the optional evidence sink is absent', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() })

    await expect(runCompletedTurn(ctx, agent, session)).resolves.toBeUndefined()
    expect(store.pinSession).toHaveBeenCalledOnce()

    await expect(dispose()).resolves.toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('contains optional sink retain and drain rejections without blocking the turn', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    const sink: InteractionGenerationEvidenceSinkV1 = {
      allows: vi.fn(() => true),
      retain: vi.fn(async () => {
        throw new Error('retain unavailable')
      }),
      drain: vi.fn(async () => {
        throw new Error('drain unavailable')
      }),
    }
    const warn = vi.spyOn(ctx.logger, 'warn')
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

    await expect(runCompletedTurn(ctx, agent, session)).resolves.toBeUndefined()
    expect(sink.retain).toHaveBeenCalledOnce()
    expect(sink.drain).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retain unavailable'))

    await expect(dispose()).resolves.toBeUndefined()
    expect(sink.drain).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('drain unavailable'))
    await ctx.fiber.dispose()
  })

  it('retains nothing when a completed turn contains two competing gap triggers', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx, { secondTrigger: true })
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    emitSessionEvent(ctx, session, 2)
    await preStep(ctx, agent, 1, 1)
    emitSessionEvent(ctx, session, 3)
    emitSessionEvent(ctx, session, 16)
    await preStep(ctx, agent, 1, 2)
    emitSessionEvent(ctx, session, 17)
    emitSessionEvent(ctx, session, 23)
    emitSessionEvent(ctx, session, 24)
    await ctx.parallel('session/flush', session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('retains nothing when one durable step/start lacks its matching pre-step gate', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    emitSessionEvent(ctx, session, 2)
    await preStep(ctx, agent, 1, 1)
    emitSessionEvent(ctx, session, 3)
    emitSessionEvent(ctx, session, 14)
    emitSessionEvent(ctx, session, 15)
    emitSessionEvent(ctx, session, 21)
    emitSessionEvent(ctx, session, 22)
    await ctx.parallel('session/flush', session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('retains nothing for a fully gated turn that did not complete', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx, { turnEndReason: 'interrupted' })
    const agent = agentFixture(ctx, session)
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    await runCompletedTurn(ctx, agent, session)

    expect(sink.retain).not.toHaveBeenCalled()

    await dispose()
    await ctx.fiber.dispose()
  })

  it('removes listeners and drains accepted evidence before binder disposal completes', async () => {
    const ctx = await contextFixture()
    const session = liveCompletedTriggerSession(ctx)
    const agent = agentFixture(ctx, session)
    const store = storeFixture(undefined)
    let settleRetain!: () => void
    const retained = new Promise<void>(resolve => {
      settleRetain = resolve
    })
    const sink: InteractionGenerationEvidenceSinkV1 & {
      retain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['retain']>>
      drain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['drain']>>
    } = {
      allows: vi.fn(() => true),
      retain: vi.fn<InteractionGenerationEvidenceSinkV1['retain']>(() => retained),
      drain: vi.fn<InteractionGenerationEvidenceSinkV1['drain']>(async () => undefined),
    }
    const dispose = installGenerationBinder(ctx, store, { providerFor: vi.fn() }, sink)

    await runTurnBeforeEnd(ctx, agent, session)
    emitSessionEvent(ctx, session, 22)
    expect(sink.retain).toHaveBeenCalledOnce()

    let disposed = false
    const pendingDispose = dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    expect(sink.drain).not.toHaveBeenCalled()

    settleRetain()
    await pendingDispose
    expect(sink.drain).toHaveBeenCalledOnce()

    ctx.emit('agent/session-start', { agent, source: 'startup' })
    await ctx.parallel('session/flush', session)
    await Promise.resolve()
    expect(store.pinSession).toHaveBeenCalledOnce()
    expect(sink.drain).toHaveBeenCalledOnce()

    await ctx.fiber.dispose()
  })

  it('does not participate in the native Session flush checkpoint', async () => {
    const ctx = await contextFixture()
    const session = ctx.sessions.create(SessionId('generation-flush-participation'), {
      meta: { cwd: '/private/workspace' },
    })
    const sink = sinkFixture()
    const dispose = installGenerationBinder(
      ctx,
      storeFixture(undefined),
      { providerFor: vi.fn() },
      sink,
    )

    await expect(ctx.sessions.flush(session)).resolves.toBe(false)
    expect(sink.drain).not.toHaveBeenCalled()

    await dispose()
    expect(sink.drain).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })
})

async function contextFixture(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.provide('workspaceRegistry', {
    resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })),
  } as never)
  return ctx
}

function storeFixture(
  generation: Awaited<ReturnType<EvolutionStore['pinSession']>>,
): EvolutionStore {
  let sessionGeneration = generation
  return {
    publishGeneration: vi.fn(),
    getGeneration: vi.fn(id => generation?.id === id ? generation : undefined),
    getActiveGeneration: vi.fn(),
    promoteGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    listGenerationSelectionEvents: vi.fn(() => []),
    pinSession: vi.fn(async () => generation),
    fallbackSessionToNative: vi.fn(async () => {
      sessionGeneration = undefined
    }),
    getSessionGenerationPin: vi.fn(() => sessionGeneration === undefined
      ? { kind: 'native' as const }
      : { kind: 'evolved' as const, generation: sessionGeneration }),
    getSessionGeneration: vi.fn(() => sessionGeneration),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(async () => undefined),
  }
}

function sinkFixture(): InteractionGenerationEvidenceSinkV1 & {
  retain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['retain']>>
  drain: ReturnType<typeof vi.fn<InteractionGenerationEvidenceSinkV1['drain']>>
} {
  return {
    allows: vi.fn(() => true),
    retain: vi.fn<InteractionGenerationEvidenceSinkV1['retain']>(async () => undefined),
    drain: vi.fn<InteractionGenerationEvidenceSinkV1['drain']>(async () => undefined),
  }
}

function generationFixture(): CapabilityGeneration {
  const content = {
    schemaVersion: 2 as const,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill' as const,
      name: 'release-audit',
      gitCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
    }],
    evaluatorVersion: 'fixture-evaluator-v1',
    policyVersion: 'fixture-policy-v1',
    compositionFingerprint: 'c'.repeat(64),
  }
  return {
    ...content,
    id: createHash('sha256').update(canonicalJson(content)).digest('hex'),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string'
    || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function agentFixture(ctx: Context, session: Session): Agent {
  const agent = { id: session.id, ctx, session } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}

async function preStep(ctx: Context, agent: Agent, turn: number, step: number): Promise<void> {
  const decision = await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [],
    turn,
    step,
    signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  expect(decision.kind).toBe('enter')
}

async function runCompletedTurn(ctx: Context, agent: Agent, session: Session): Promise<void> {
  await runTurnBeforeEnd(ctx, agent, session)
  emitSessionEvent(ctx, session, 22)
  await ctx.parallel('session/flush', session)
}

async function runTurnBeforeEnd(ctx: Context, agent: Agent, session: Session): Promise<void> {
  ctx.emit('agent/session-start', { agent, source: 'startup' })
  await runTurnAfterSessionStart(ctx, agent, session)
}

async function runTurnAfterSessionStart(ctx: Context, agent: Agent, session: Session): Promise<void> {
  emitSessionEvent(ctx, session, 2)
  await preStep(ctx, agent, 1, 1)
  emitSessionEvent(ctx, session, 3)
  emitSessionEvent(ctx, session, 14)
  await preStep(ctx, agent, 1, 2)
  emitSessionEvent(ctx, session, 15)
  emitSessionEvent(ctx, session, 21)
}

function emitSessionEvent(ctx: Context, session: Session, seq: number): void {
  const plan = plannedEvents.get(session)
  if (plan !== undefined) {
    while (Number(session.seq) <= seq) {
      const planned = plan[Number(session.seq)]
      if (planned === undefined) throw new Error(`fixture event ${session.seq} is missing`)
      appendPlannedEvent(session, planned)
    }
    return
  }
  const event = session.eventAt(SessionSeq(seq))
  if (event === undefined) throw new Error(`fixture event ${seq} is missing`)
  ctx.emit('session/event', session, event)
}

function liveCompletedTriggerSession(
  ctx: Context,
  options?: {
    readonly secondTrigger?: boolean
    readonly turnEndReason?: 'completed' | 'interrupted'
  },
): Session {
  const template = completedTriggerSession(options)
  const session = ctx.sessions.create(SessionId('generation-witness-session'), {
    meta: {
      createdAt: 1_000,
      cwd: '/private/workspace',
      agentPreset: 'default',
    },
  })
  plannedEvents.set(session, template.snapshotEvents())
  return session
}

function appendPlannedEvent(session: Session, event: SessionEvent): void {
  const surfaceOp = 'surfaceOp' in event ? event.surfaceOp : undefined
  const sourceEventSeqs = 'sourceEventSeqs' in event ? event.sourceEventSeqs : undefined
  append(
    session,
    event.type,
    event.data,
    surfaceOp === 'append'
      ? {
          surfaceOp,
          ...sourceEventSeqs === undefined
            ? {}
            : { sourceEventSeqs: sourceEventSeqs.map(Number) },
        }
      : undefined,
  )
}

function completedTriggerSession(options?: {
  readonly secondTrigger?: boolean
  readonly turnEndReason?: 'completed' | 'interrupted'
}): Session {
  const session = Session.create(
    SessionId('generation-witness-session'),
    undefined,
    {
      version: 0,
      id: SessionId('generation-witness-session'),
      createdAt: 1_000,
      cwd: '/private/workspace',
      isSeeded: false,
      agentPreset: 'default',
    } satisfies SessionHeader,
  )
  const human = {
    id: 'human-message',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Find a reusable release audit method.' }],
  }
  append(session, 'agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [human],
  })
  append(session, 'turn/start', { turn: 1 })
  append(session, 'agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    removedCount: 1,
    inserted: [],
  })
  append(session, 'step/start', { turn: 1, step: 1 })
  append(session, 'user/message', human, { surfaceOp: 'append' })
  append(session, 'request/header', {
    header: {
      config: {
        provider: 'fixture',
        model: 'fixture-model',
        reasoningEffort: 'high',
        temperature: 0.2,
        maxTokens: 4_096,
        stop: ['END', 'STOP'],
      },
      adapterDefaults: { maxTokens: true },
      system: 'private system control',
      tools: [{
        name: 'report_capability_gap',
        description: 'Record one capability gap.',
        parameters: { type: 'object', properties: { name: { type: 'string' } } },
      }],
    },
    reason: 'initial',
  })
  append(session, 'request/context', {
    provider: 'fixture',
    model: 'fixture-model',
    contextWindow: 32_768,
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'block-start', index: 0, blockType: 'tool-call' },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: {
      type: 'tool-call-delta',
      index: 0,
      id: 'gap-call',
      name: 'report_capability_gap',
      argumentsDelta: '{"name":"release-audit"}',
    },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: {
      type: 'block-end',
      index: 0,
      block: {
        type: 'tool-call',
        id: 'gap-call',
        name: 'report_capability_gap',
        arguments: '{"name":"release-audit"}',
      },
    },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'finish', reason: { kind: 'tool-calls' } },
  })
  append(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'trigger-assistant',
      role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
      content: [{
        type: 'tool-call',
        id: 'gap-call',
        name: 'report_capability_gap',
        arguments: '{"name":"release-audit"}',
      }],
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [7, 8, 9, 10] })
  append(session, 'tool/call', {
    turn: 1,
    step: 1,
    callId: 'gap-call',
    name: 'report_capability_gap',
    arguments: '{"name":"release-audit"}',
  })
  append(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'gap-result',
      role: 'user',
      source: { kind: 'tool', callId: 'gap-call' },
      content: [{
        type: 'tool-result',
        toolCallId: 'gap-call',
        isError: false,
        content: [{ type: 'text', text: 'Capability Gap recorded.' }],
      }],
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [12] })
  if (options?.secondTrigger === true) {
    append(session, 'tool/call', {
      turn: 1,
      step: 1,
      callId: 'second-gap-call',
      name: 'report_capability_gap',
      arguments: '{"name":"second-release-audit"}',
    })
    append(session, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'second-gap-result',
        role: 'user',
        source: { kind: 'tool', callId: 'second-gap-call' },
        content: [{
          type: 'tool-result',
          toolCallId: 'second-gap-call',
          isError: false,
          content: [{ type: 'text', text: 'Capability Gap recorded.' }],
        }],
      },
    }, { surfaceOp: 'append', sourceEventSeqs: [14] })
  }
  append(session, 'step/end', { turn: 1, step: 1 })
  append(session, 'step/start', { turn: 1, step: 2 })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 2,
    chunk: { type: 'block-start', index: 0, blockType: 'text' },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 2,
    chunk: { type: 'text-delta', index: 0, text: 'The gap was recorded.' },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 2,
    chunk: {
      type: 'block-end',
      index: 0,
      block: { type: 'text', text: 'The gap was recorded.' },
    },
  })
  append(session, 'assistant/chunk', {
    turn: 1,
    step: 2,
    chunk: { type: 'finish', reason: { kind: 'stop' } },
  })
  append(session, 'assistant/message', {
    turn: 1,
    step: 2,
    message: {
      id: 'terminal-assistant',
      role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
      content: [{ type: 'text', text: 'The gap was recorded.' }],
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [16, 17, 18, 19] })
  append(session, 'step/end', { turn: 1, step: 2 })
  append(session, 'turn/end', {
    turn: 1,
    reason: { kind: options?.turnEndReason ?? 'completed' },
  })
  return session
}

function append(
  session: Session,
  type: string,
  data: unknown,
  options?: { readonly surfaceOp: 'append'; readonly sourceEventSeqs?: number[] },
): SessionEvent {
  const appendEvent = session.append as unknown as (
    type: string,
    data: unknown,
    options?: { readonly surfaceOp: 'append'; readonly sourceEventSeqs?: number[] },
  ) => SessionEvent
  return options === undefined
    ? appendEvent.call(session, type, data)
    : appendEvent.call(session, type, data, options)
}
