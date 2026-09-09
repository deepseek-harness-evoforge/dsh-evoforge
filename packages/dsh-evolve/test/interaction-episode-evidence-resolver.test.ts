import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import {
  freezeMessage,
  MessageId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  SessionLogOffset,
  SessionStore,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import {
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  type SessionEventSuffix,
} from '@deepseek-ai/dsh-session-persistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  InteractionEpisodeHostBindingV1,
  InteractionEpisodeHostEvidenceResolutionV1,
} from '../src/interaction-episode-assembler.ts'
import {
  createInteractionEpisodeEvidenceResolver,
  createStockDshAlpha5InteractionEpisodeEvidenceResolver,
  type DurableInteractionEpisodeSubjectV1,
  type InteractionEpisodeDerivedEvidenceV1,
} from '../src/interaction-episode-evidence-resolver.ts'
import * as publicApi from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Interaction Episode evidence resolver', () => {
  it('keeps the injectable evidence authority outside the package root', () => {
    expect(publicApi).not.toHaveProperty('createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver')
    expect(publicApi).not.toHaveProperty('createInteractionEpisodeEvidenceResolver')
    expect(publicApi).not.toHaveProperty('createStockDshAlpha5InteractionEpisodeEvidenceResolver')
  })

  it('proves the physical Session cut before the stock Host honestly abstains', async () => {
    const fixture = completedGapTurn()
    const sessions = {
      get: vi.fn(() => fixture.session),
      flush: vi.fn(async () => true),
    }
    const sessionPersistence = {
      readFrom: vi.fn(async () => structuredClone(fixture.stored)),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions,
      sessionPersistence,
    })

    const result = await resolver.resolve({
      session: fixture.session,
      turnEndSeq: fixture.turnEndSeq,
      trigger: { callId: 'gap-call' },
    })

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: [
        'workspace',
        'capability-boundary',
        'catalog',
        'generation',
        'routing',
        'replay-environment',
        'workspace-snapshot',
        'composition',
        'model',
        'permissions',
        'sandbox',
        'budget',
        'dsh-revision',
        'external-effects',
      ],
    })
    expect(sessions.flush).toHaveBeenCalledWith(fixture.session)
    expect(sessionPersistence.readFrom).toHaveBeenCalledWith(
      fixture.session.id,
      SessionLogOffset(0),
    )
    expect(sessions.flush).toHaveBeenCalledOnce()
    expect(sessionPersistence.readFrom).toHaveBeenCalledOnce()
    if (result.status === 'assembled') throw new Error('stock resolver unexpectedly assembled')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.dimensions)).toBe(true)
    expect('input' in result).toBe(false)
  })

  it('yields once so later synchronous event observers can enqueue before flush', async () => {
    const fixture = completedGapTurn()
    let laterObserverRan = false
    const flush = vi.fn(async () => {
      expect(laterObserverRan).toBe(true)
      return true
    })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush },
      sessionPersistence: {
        readFrom: async () => structuredClone(fixture.stored),
      },
    })

    const pending = resolver.resolve(targetFor(fixture))
    laterObserverRan = true
    await pending

    expect(flush).toHaveBeenCalledOnce()
  })

  it('waits for a later real SessionStore event listener before its flush barrier', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    try {
      let durable: SessionEventSuffix | undefined
      const queued: SessionEvent[] = []
      const sessionPersistence = {
        readFrom: vi.fn(async () => {
          if (durable === undefined) throw new Error('turn/end was not flushed')
          return structuredClone(durable)
        }),
      }
      const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: ctx.sessions,
        sessionPersistence,
      })
      let resolution: ReturnType<typeof resolver.resolve> | undefined

      // Registered first: this starts resolution while SessionStore is still
      // dispatching the post-commit firehose callback list.
      ctx.on('session/event', (session, event) => {
        if (event.type !== 'turn/end') return
        resolution = resolver.resolve({
          session,
          turnEndSeq: Number(event.seq),
          trigger: { callId: 'gap-call' },
        })
      })
      // Registered later: it must synchronously enqueue turn/end before the
      // resolver's microtask continuation asks SessionStore to flush.
      ctx.on('session/event', (_session, event) => {
        queued.push(structuredClone(event))
      })
      ctx.on('session/flush', (session) => {
        durable = {
          meta: structuredClone(session.header),
          inheritedEventCount: SessionLogOffset(Number(session.inheritedEventCount)),
          fromSeq: SessionLogOffset(0),
          events: structuredClone(queued),
        }
      })

      const session = ctx.sessions.create(SessionId('episode-session'), {
        meta: { cwd: '/private/workspace', agentPreset: 'default' },
      })
      completedGapTurn('successful-gap-report', session)
      if (resolution === undefined) throw new Error('resolver was not invoked')

      await expect(resolution).resolves.toMatchObject({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-unavailable',
      })
      expect(sessionPersistence.readFrom).toHaveBeenCalledOnce()
      expect(durable?.events.at(-1)?.type).toBe('turn/end')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a detached Session before asking for a flush or physical read', async () => {
    const fixture = completedGapTurn()
    const flush = vi.fn(async () => true)
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => undefined, flush },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'session-not-live',
      dimensions: ['session-durability'],
    })
    expect(flush).not.toHaveBeenCalled()
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('contains a throwing Session liveness lookup', async () => {
    const fixture = completedGapTurn()
    const flush = vi.fn(async () => true)
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: {
        get: () => { throw new Error('liveness implementation detail') },
        flush,
      },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'liveness-check-failed',
      dimensions: ['session-durability'],
    })
    expect(flush).not.toHaveBeenCalled()
    expect(readFrom).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid turn coordinate', -1, 'gap-call', 'turn-not-found'],
    ['missing turn coordinate', 10_000, 'gap-call', 'turn-not-found'],
    ['empty trigger identity', 22, '', 'trigger-not-proven'],
  ] as const)(
    'classifies %s before consulting persistence',
    async (_label, turnEndSeq, callId, reason) => {
      const fixture = completedGapTurn()
      const get = vi.fn(() => fixture.session)
      const flush = vi.fn(async () => true)
      const readFrom = vi.fn(async () => structuredClone(fixture.stored))
      const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: { get, flush },
        sessionPersistence: { readFrom },
      })

      await expect(resolver.resolve({
        session: fixture.session,
        turnEndSeq: callId === '' ? fixture.turnEndSeq : turnEndSeq,
        trigger: { callId },
      })).resolves.toEqual({
        status: 'abstained',
        stage: 'transcript',
        reason,
        dimensions: ['subject'],
      })
      expect(get).not.toHaveBeenCalled()
      expect(flush).not.toHaveBeenCalled()
      expect(readFrom).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['no listener', async (): Promise<boolean> => false, 'flush-unobserved'],
    ['synchronous throw', (): Promise<boolean> => { throw new Error('flush failure') }, 'flush-failed'],
    ['non-Error rejection', async (): Promise<boolean> => { throw 'opaque failure' }, 'flush-failed'],
  ] as const)('fails closed when flush reports %s', async (_label, flushImpl, reason) => {
    const fixture = completedGapTurn()
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const flush = vi.fn(flushImpl)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: {
        get: () => fixture.session,
        flush,
      },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason,
      dimensions: ['session-durability'],
    })
    expect(flush).toHaveBeenCalledOnce()
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('requires the exact boolean true from the alpha.5 flush contract', async () => {
    const fixture = completedGapTurn()
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: {
        get: () => fixture.session,
        flush: async () => 'true' as unknown as boolean,
      },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'flush-unobserved',
      dimensions: ['session-durability'],
    })
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('does not mistake a participating telemetry listener for a durability watermark', async () => {
    const fixture = completedGapTurn()
    const truncated = structuredClone(fixture.stored) as Mutable<SessionEventSuffix>
    truncated.events = truncated.events.slice(0, fixture.turnEndSeq)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: {
        get: () => fixture.session,
        // Alpha.5 returns true when any session/flush listener participates.
        flush: async () => true,
      },
      sessionPersistence: {
        readFrom: async () => truncated as unknown as SessionEventSuffix,
      },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-unavailable',
      dimensions: ['session-durability'],
    })
  })

  it('contains physical read failures without leaking provider error details', async () => {
    const fixture = completedGapTurn()
    const readFrom = vi.fn(async () => { throw { backendSecret: 'do-not-emit' } })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(readFrom).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('do-not-emit')
  })

  it('classifies the official absent durable Session as unavailable evidence', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => {
          throw new SessionPersistenceNotFoundError(fixture.session.id)
        },
      },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-unavailable',
      dimensions: ['session-durability'],
    })
  })

  it.each([
    [
      'foreign NotFound error',
      () => new SessionPersistenceNotFoundError(SessionId('other-session')),
      'stored-read-failed',
      ['session-durability'],
    ],
    [
      'unsupported format',
      () => new SessionFormatUnsupportedError('future format'),
      'stored-cut-unavailable',
      ['session-durability'],
    ],
    [
      'corrupt stored log',
      () => new SessionPersistenceCorruptionError('corrupt log', {
        cause: new Error('validation detail'),
      }),
      'stored-cut-conflict',
      ['subject', 'session-durability'],
    ],
  ] as const)(
    'classifies an official %s without exposing its message',
    async (_label, createError, reason, dimensions) => {
      const fixture = completedGapTurn()
      const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          readFrom: async () => { throw createError() },
        },
      })

      const result = await resolver.resolve(targetFor(fixture))

      expect(result).toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason,
        dimensions,
      })
      expect(JSON.stringify(result)).not.toMatch(/future|corrupt|validation/u)
    },
  )

  it('contains a hostile rejection whose prototype lookup throws', async () => {
    const fixture = completedGapTurn()
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('backend prototype secret')
      },
    })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => { throw hostile },
      },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(JSON.stringify(result)).not.toContain('prototype secret')
  })

  it('contains a hostile successful physical-read fulfillment', async () => {
    const fixture = completedGapTurn()
    const hostile = new Proxy({}, {
      get(_target, key) {
        if (key === 'then') return undefined
        throw new Error('hostile persistence getter')
      },
    }) as SessionEventSuffix
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => hostile },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
  })

  it('requires the same live Session identity after both awaited authority reads', async () => {
    const fixture = completedGapTurn()
    const replacement = completedGapTurn().session
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const get = vi.fn()
      .mockReturnValueOnce(fixture.session)
      .mockReturnValueOnce(fixture.session)
      .mockReturnValue(replacement)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get, flush: async () => true },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'session-not-live',
      dimensions: ['session-durability'],
    })
    expect(readFrom).toHaveBeenCalledOnce()
  })

  it('stops before physical read when the live identity changes during flush', async () => {
    const fixture = completedGapTurn()
    const replacement = completedGapTurn().session
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const get = vi.fn()
      .mockReturnValueOnce(fixture.session)
      .mockReturnValue(replacement)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get, flush: async () => true },
      sessionPersistence: { readFrom },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toMatchObject({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'session-not-live',
    })
    expect(readFrom).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong offset', (stored: Mutable<SessionEventSuffix>) => { stored.fromSeq = SessionLogOffset(1) }],
    ['header id', (stored: Mutable<SessionEventSuffix>) => {
      stored.meta.id = SessionId('other-session')
    }],
    ['header version', (stored: Mutable<SessionEventSuffix>) => { stored.meta.version += 1 }],
    ['header createdAt', (stored: Mutable<SessionEventSuffix>) => { stored.meta.createdAt += 1 }],
    ['header cwd', (stored: Mutable<SessionEventSuffix>) => { stored.meta.cwd = '/other/workspace' }],
    ['header seeded marker', (stored: Mutable<SessionEventSuffix>) => {
      stored.meta.isSeeded = true
    }],
    ['header parent', (stored: Mutable<SessionEventSuffix>) => {
      stored.meta.parentSession = SessionId('foreign-parent')
    }],
    ['header origin', (stored: Mutable<SessionEventSuffix>) => { stored.meta.origin = 'subagent' }],
    ['header depth', (stored: Mutable<SessionEventSuffix>) => {
      stored.meta.delegationDepth = 1
    }],
    ['header preset', (stored: Mutable<SessionEventSuffix>) => {
      stored.meta.agentPreset = 'other-preset'
    }],
    ['wrong inherited cut', (stored: Mutable<SessionEventSuffix>) => {
      stored.inheritedEventCount = SessionLogOffset(1)
    }],
    ['first event', (stored: Mutable<SessionEventSuffix>) => { stored.events[0]!.time += 1 }],
    ['middle event', (stored: Mutable<SessionEventSuffix>) => {
      stored.events[Math.floor(stored.events.length / 2)]!.time += 1
    }],
    ['final event', (stored: Mutable<SessionEventSuffix>) => {
      stored.events[stored.events.length - 1]!.time += 1
    }],
  ] as const)('rejects a physically divergent Session cut: %s', async (_label, mutate) => {
    const fixture = completedGapTurn()
    const stored = structuredClone(fixture.stored) as Mutable<SessionEventSuffix>
    mutate(stored)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => stored as unknown as SessionEventSuffix,
      },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
  })

  it('accepts an exact durable suffix after the selected completed turn', async () => {
    const fixture = completedGapTurn()
    fixture.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [],
    })
    const stored = physicalSnapshot(fixture.session)
    let observedSubject: DurableInteractionEpisodeSubjectV1 | undefined
    let observedDerived: InteractionEpisodeDerivedEvidenceV1 | undefined
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => stored },
      attestor: {
        resolve: async (subject, derived) => {
          observedSubject = subject
          observedDerived = derived
          return completeHostResolution(subject)
        },
      },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toMatchObject({
      status: 'assembled',
    })
    expect(observedSubject?.session.events).toHaveLength(fixture.turnEndSeq + 1)
    expect(observedSubject?.session.throughSeq).toBe(fixture.turnEndSeq)
    expect(observedDerived).toMatchObject({
      triggerRequestControl: {
        schemaVersion: 1,
        kind: 'interaction-episode-trigger-request-control-fact-v1',
        sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
        subject: {
          sessionId: 'episode-session',
          throughSeq: fixture.turnEndSeq,
        },
        boundary: {
          kind: 'trigger-assistant-and-tool-pair',
          requestHeaderSeq: 5,
          requestContextSeq: 6,
          assistantMessageSeq: 11,
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
        declaredRoute: { provider: 'fixture', model: 'fixture-model' },
      },
    })
    expect(Object.isFrozen(observedDerived)).toBe(true)
    expect(Object.isFrozen(observedDerived?.triggerRequestControl)).toBe(true)
    expect(JSON.stringify(observedDerived)).not.toContain('Find a reusable release audit method.')
  })

  it('never invokes Host attestation when the durable transcript cannot prove the target call', async () => {
    const fixture = completedGapTurn()
    const attestor = vi.fn(async (subject: DurableInteractionEpisodeSubjectV1) =>
      completeHostResolution(subject))
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      attestor: { resolve: attestor },
    })

    await expect(resolver.resolve({
      ...targetFor(fixture),
      trigger: { callId: 'some-other-call' },
    })).resolves.toEqual({
      status: 'abstained',
      stage: 'transcript',
      reason: 'trigger-not-proven',
      dimensions: ['subject'],
    })
    expect(attestor).not.toHaveBeenCalled()
  })

  it.each(['native', 'evolved'] as const)(
    'assembles only after a trusted complete %s Host resolution',
    async (generation) => {
      const fixture = completedGapTurn()
      let observedSubject: DurableInteractionEpisodeSubjectV1 | undefined
      const attestor = vi.fn(async (subject: DurableInteractionEpisodeSubjectV1) => {
        observedSubject = subject
        return completeHostResolution(subject, generation)
      })
      const resolver = createInteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        attestor: { resolve: attestor },
      })

      const result = await resolver.resolve(targetFor(fixture))

      expect(result).toMatchObject({
        status: 'assembled',
        input: {
          workspaceId: WORKSPACE_ID,
          session: { id: 'episode-session' },
          source: { turnEndSeq: fixture.turnEndSeq },
          trigger: {
            kind: 'model-declared-skill-gap',
            requestedSkill: 'release-audit',
            ...(generation === 'evolved' ? { generationId: HASH_E } : {}),
          },
          replay: {
            environment: 'sealed',
            externalEffects: 'none',
          },
        },
      })
      expect(attestor).toHaveBeenCalledOnce()
      expect(observedSubject).toMatchObject({
        schemaVersion: 1,
        kind: 'durable-interaction-episode-subject-v1',
        session: {
          header: fixture.stored.meta,
          inheritedEventCount: 0,
          throughSeq: fixture.turnEndSeq,
        },
      })
      expect(observedSubject?.session.events).toHaveLength(fixture.turnEndSeq + 1)
      expect(Object.isFrozen(observedSubject)).toBe(true)
      expect(Object.isFrozen(observedSubject?.session.events)).toBe(true)
      expect(Object.isFrozen(observedSubject?.session.events[0])).toBe(true)
      expect(Object.isFrozen(observedSubject?.session.events[0]?.data)).toBe(true)
      expect(Object.isFrozen(result)).toBe(true)
      if (result.status === 'assembled') expect(Object.isFrozen(result.input)).toBe(true)
    },
  )

  it('captures the target before awaits and ignores a later Session suffix and caller mutation', async () => {
    const fixture = completedGapTurn()
    const target = targetFor(fixture)
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: {
        get: () => fixture.session,
        flush: async () => {
          fixture.session.append('agent/inbox/spliced', {
            target: 'next-turn',
            start: 0,
            inserted: [],
          })
          return true
        },
      },
      sessionPersistence: {
        readFrom: async () => physicalSnapshot(fixture.session),
      },
      attestor: {
        resolve: async subject => completeHostResolution(subject),
      },
    })

    const pending = resolver.resolve(target)
    target.turnEndSeq = 0
    target.trigger.callId = 'changed-after-call'
    const result = await pending

    expect(result).toMatchObject({
      status: 'assembled',
      input: {
        source: { turnEndSeq: fixture.turnEndSeq },
        trigger: { callId: 'gap-call' },
      },
    })
  })

  it('maps only a proven Skill Tool error to a native Skill miss', async () => {
    const fixture = completedGapTurn('skill-tool-error')
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      attestor: {
        resolve: async subject => completeHostResolution(subject),
      },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toMatchObject({
      status: 'assembled',
      input: {
        trigger: {
          kind: 'native-skill-miss',
          requestedSkill: 'release-audit',
        },
      },
    })
  })

  it.each([
    ['string offset', (stored: Record<string, unknown>) => { stored.fromSeq = '0' }],
    ['null offset', (stored: Record<string, unknown>) => { stored.fromSeq = null }],
    ['negative-zero offset', (stored: Record<string, unknown>) => { stored.fromSeq = -0 }],
    ['string inherited cut', (stored: Record<string, unknown>) => {
      stored.inheritedEventCount = '0'
    }],
    ['null inherited cut', (stored: Record<string, unknown>) => {
      stored.inheritedEventCount = null
    }],
    ['negative-zero inherited cut', (stored: Record<string, unknown>) => {
      stored.inheritedEventCount = -0
    }],
  ] as const)('rejects a malformed physical scalar: %s', async (_label, mutate) => {
    const fixture = completedGapTurn()
    const stored = structuredClone(fixture.stored) as unknown as Record<string, unknown>
    mutate(stored)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => stored as unknown as SessionEventSuffix,
      },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
  })

  it.each([
    [
      'Host transcript',
      (resolved: Mutable<ResolvedHostResolution>, _subject: DurableInteractionEpisodeSubjectV1) => {
        resolved.binding.subject.transcript.session.createdAt += 1
      },
      'subject-mismatch',
      ['subject'],
    ],
    [
      'durability watermark',
      (resolved: Mutable<ResolvedHostResolution>, subject: DurableInteractionEpisodeSubjectV1) => {
        resolved.binding.durability.throughSeq = subject.transcript.source.turnEndSeq - 1
      },
      'subject-mismatch',
      ['session-durability'],
    ],
  ] as const)(
    'independently cross-checks the %s against the physically proven subject',
    async (_label, mutate, reason, dimensions) => {
      const fixture = completedGapTurn()
      const resolver = createInteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        attestor: {
          resolve: async (subject) => {
            const resolved = structuredClone(
              completeHostResolution(subject),
            ) as Mutable<ResolvedHostResolution>
            mutate(resolved, subject)
            return resolved as ResolvedHostResolution
          },
        },
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'assembly',
        reason,
        dimensions,
      })
    },
  )

  it('contains a hostile attestor Proxy whose status access throws', async () => {
    const fixture = completedGapTurn()
    const hostile = new Proxy({}, {
      get(_target, key) {
        if (key === 'then') return undefined
        throw new Error('hostile status getter')
      },
    }) as InteractionEpisodeHostEvidenceResolutionV1
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      attestor: { resolve: async () => hostile },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['binding'],
    })
  })

  it.each([
    ['throwing attestor', async () => { throw new Error('secret failure detail') }],
    ['non-Error rejection', async () => Promise.reject({ private: 'detail' })],
  ] as const)('distinguishes a %s from evidence conclusions', async (_label, resolve) => {
    const fixture = completedGapTurn()
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      attestor: { resolve },
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|private|detail/u)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('classifies a malformed resolved response as incomplete assembly evidence', async () => {
    const fixture = completedGapTurn()
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      attestor: { resolve: async () => ({ status: 'resolved' }) as never },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'assembly',
      reason: 'evidence-unavailable',
      dimensions: ['binding'],
    })
  })
})

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const HASH_F = 'f'.repeat(64)
type ResolvedHostResolution = Extract<
  InteractionEpisodeHostEvidenceResolutionV1,
  { readonly status: 'resolved' }
>

function targetFor(fixture: ReturnType<typeof completedGapTurn>) {
  return {
    session: fixture.session,
    turnEndSeq: fixture.turnEndSeq,
    trigger: { callId: 'gap-call' },
  }
}

function physicalSnapshot(session: Session): SessionEventSuffix {
  return {
    meta: structuredClone(session.header),
    inheritedEventCount: SessionLogOffset(Number(session.inheritedEventCount)),
    fromSeq: SessionLogOffset(0),
    events: structuredClone(session.snapshotEvents()),
  }
}

function completeHostResolution(
  subject: DurableInteractionEpisodeSubjectV1,
  generation: 'native' | 'evolved' = 'native',
): InteractionEpisodeHostEvidenceResolutionV1 {
  const proof = subject.transcript
  const generationBinding: InteractionEpisodeHostBindingV1['capability']['generation'] =
    generation === 'native'
      ? {
          kind: 'native',
          pin: 'settled',
          effectiveMount: { kind: 'native' },
        }
      : {
          kind: 'evolved',
          pin: 'settled',
          generationId: HASH_E,
          effectiveMount: { kind: 'evolved', generationId: HASH_E },
        }
  return {
    status: 'resolved',
    binding: {
      schemaVersion: 1,
      kind: 'interaction-episode-host-binding-v1',
      subject: {
        workspaceId: WORKSPACE_ID,
        transcript: structuredClone(proof),
      },
      durability: {
        session: 'flushed-through-turn-end',
        throughSeq: proof.source.turnEndSeq,
      },
      capability: {
        observation: {
          boundary: 'trigger-assistant-and-tool-pair',
          triggerRequestSeq: proof.witness.triggerRequestSeq,
          triggerCallSeq: proof.source.triggerCallSeq,
          triggerResultSeq: proof.source.triggerResultSeq,
          compositionDigest: HASH_A,
        },
        catalog: {
          status: 'complete',
          providers: 'settled',
          hash: HASH_B,
          size: 7,
          requestedSkill: {
            name: proof.trigger.requestedSkill,
            presence: 'absent',
          },
        },
        generation: generationBinding,
        routing: proof.trigger.kind === 'successful-gap-report'
          ? {
              rawTrigger: 'successful-gap-report',
              conclusion: 'model-declared-no-applicable-skill',
            }
          : {
              rawTrigger: 'skill-tool-error',
              conclusion: 'requested-skill-absent',
            },
      },
      environment: {
        coverage: 'complete-replay-cut',
        workspaceSnapshot: {
          at: 'before-inbox-insertion',
          digest: HASH_C,
        },
        compositionDigest: HASH_A,
        modelDigest: HASH_D,
        permission: {
          evidenceRetention: 'authorized',
          digest: HASH_E,
        },
        sandboxDigest: HASH_F,
        budgetDigest: HASH_A,
        dshRevision: '1'.repeat(40),
      },
      externalEffects: {
        coverage: 'all-effect-capable-tools-and-providers',
        compositionDigest: HASH_A,
        fromSeq: 0,
        throughSeq: proof.source.turnEndSeq,
        pending: 'none',
        uncertain: 'none',
        result: 'none',
      },
    },
  }
}

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T

function completedGapTurn(
  triggerKind: 'successful-gap-report' | 'skill-tool-error' = 'successful-gap-report',
  existingSession?: Session,
): {
  readonly session: Session
  readonly turnEndSeq: number
  readonly stored: SessionEventSuffix
} {
  vi.spyOn(Date, 'now').mockReturnValue(2_000)
  const sessionId = SessionId('episode-session')
  const session = existingSession ?? Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 1_000,
    cwd: '/private/workspace',
    isSeeded: false,
    agentPreset: 'default',
  })
  const callId = ToolCallId('gap-call')
  const toolName = triggerKind === 'successful-gap-report'
    ? 'report_capability_gap'
    : 'skill'
  const toolIsError = triggerKind === 'skill-tool-error'
  const human = freezeMessage({
    id: MessageId('human-message'),
    role: 'user' as const,
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: 'Find a reusable release audit method.' }],
  })
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [human],
  })
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    removedCount: 1,
    inserted: [],
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', human, { surfaceOp: 'append' })
  session.append('request/header', {
    header: { config: { provider: 'fixture', model: 'fixture-model' } },
    reason: 'initial',
  })
  session.append('request/context', { provider: 'fixture', model: 'fixture-model' })
  const triggerChunks = [
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'tool-call' },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: {
        type: 'tool-call-delta',
        index: 0,
        id: callId,
        name: toolName,
        argumentsDelta: '{"name":"release-audit"}',
      },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: callId,
          name: toolName,
          arguments: '{"name":"release-audit"}',
        },
      },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'finish', reason: { kind: 'tool-calls' } },
    }),
  ]
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: freezeMessage({
      id: MessageId('assistant-message'),
      role: 'assistant' as const,
      source: { kind: 'model' as const, provider: 'fixture', model: 'fixture-model' },
      content: [{
        type: 'tool-call' as const,
        id: callId,
        name: toolName,
        arguments: '{"name":"release-audit"}',
      }],
    }),
  }, {
    sourceEventSeqs: triggerChunks.map(event => event.seq),
    surfaceOp: 'append',
  })
  const call = session.append('tool/call', {
    turn: 1,
    step: 1,
    callId,
    name: toolName,
    arguments: '{"name":"release-audit"}',
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: freezeMessage({
      id: MessageId('gap-result'),
      role: 'user' as const,
      source: { kind: 'tool' as const, callId },
      content: [{
        type: 'tool-result' as const,
        toolCallId: callId,
        isError: toolIsError,
        content: [{
          type: 'text' as const,
          text: toolIsError
            ? 'Unknown Skill: release-audit'
            : `Capability Gap ${'a'.repeat(64)} recorded for release-audit; discovery abstained because no native DSH Goal is active.`,
        }],
      }],
    }),
  }, {
    sourceEventSeqs: [call.seq],
    surfaceOp: 'append',
  })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  const terminalChunks = [
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: {
        type: 'text-delta',
        index: 0,
        text: 'The missing capability was recorded.',
      },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'The missing capability was recorded.' },
      },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'finish', reason: { kind: 'stop' } },
    }),
  ]
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: freezeMessage({
      id: MessageId('terminal-assistant-message'),
      role: 'assistant' as const,
      source: { kind: 'model' as const, provider: 'fixture', model: 'fixture-model' },
      content: [{ type: 'text' as const, text: 'The missing capability was recorded.' }],
    }),
  }, {
    sourceEventSeqs: terminalChunks.map(event => event.seq),
    surfaceOp: 'append',
  })
  session.append('step/end', { turn: 1, step: 2 })
  const turnEnd = session.append('turn/end', {
    turn: 1,
    reason: { kind: 'completed' },
  })
  const turnEndSeq = Number(turnEnd.seq)
  return {
    session,
    turnEndSeq,
    stored: {
      meta: structuredClone(session.header),
      inheritedEventCount: SessionLogOffset(Number(session.inheritedEventCount)),
      fromSeq: SessionLogOffset(0),
      events: structuredClone(session.snapshotEvents(
        SessionLogOffset(0),
        SessionLogOffset(turnEndSeq + 1),
      )),
    },
  }
}
