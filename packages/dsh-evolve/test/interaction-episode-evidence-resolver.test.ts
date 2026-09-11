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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  InteractionEpisodeHostBindingV1,
  InteractionEpisodeHostEvidenceResolutionV1,
} from '../src/interaction-episode-assembler.ts'
import {
  createInteractionEpisodeEvidenceResolver as createResolver,
  createStockDshAlpha5InteractionEpisodeEvidenceResolver as createStockResolver,
  type DurableInteractionEpisodeSubjectV1,
  type InteractionEpisodeDerivedEvidenceV1,
} from '../src/interaction-episode-evidence-resolver.ts'
import * as publicApi from '../src/index.ts'

const lifecycle = new Context()

type StockResolverDependencies = Parameters<typeof createStockResolver>[0]
type ResolverDependencies = Parameters<typeof createResolver>[0]

function createInteractionEpisodeEvidenceResolver(
  dependencies: Omit<ResolverDependencies, 'lifecycle'>,
) {
  return createResolver({ ...dependencies, lifecycle })
}

function createStockDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: Omit<StockResolverDependencies, 'lifecycle'>,
) {
  return createStockResolver({ ...dependencies, lifecycle })
}

afterAll(async () => {
  await lifecycle.fiber.dispose()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Interaction Episode evidence resolver', () => {
  it('keeps the injectable evidence authority outside the package root', () => {
    expect(publicApi).not.toHaveProperty('createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver')
    expect(publicApi).not.toHaveProperty('createInteractionEpisodeEvidenceResolver')
    expect(publicApi).not.toHaveProperty('createStockDshAlpha5InteractionEpisodeEvidenceResolver')
    expect(publicApi).not.toHaveProperty('readInteractionSessionStoredCutV1')
    expect(publicApi).not.toHaveProperty('createDshAlpha5HostEvidenceAttestor')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceReceiptV1')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceSource')
    expect(publicApi).not.toHaveProperty('createInteractionGenerationEvidenceSink')
    expect(publicApi).not.toHaveProperty('openInteractionGenerationEvidenceVault')
    expect(publicApi).not.toHaveProperty('interactionGenerationSessionLifecycleDigest')
    expect(publicApi).not.toHaveProperty('installCapabilityGapRoutingEvidenceV1')
    expect(publicApi).not.toHaveProperty('createInteractionRoutingEvidenceReceiptV1')
    expect(publicApi).not.toHaveProperty('createInteractionRoutingEvidenceSource')
    expect(publicApi).not.toHaveProperty('createInteractionRoutingEvidenceSink')
    expect(publicApi).not.toHaveProperty('openInteractionRoutingEvidenceVault')
    expect(publicApi).not.toHaveProperty('INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1')
    expect(publicApi).not.toHaveProperty('interactionRoutingSessionLifecycleDigest')
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
      expect.any(AbortSignal),
    )
    expect(sessions.flush).toHaveBeenCalledOnce()
    expect(sessionPersistence.readFrom).toHaveBeenCalledOnce()
    if (result.status === 'assembled') throw new Error('stock resolver unexpectedly assembled')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.dimensions)).toBe(true)
    expect('input' in result).toBe(false)
  })

  it('treats an omitted live root delegation depth as the physical zero default', async () => {
    const fixture = completedGapTurn()
    expect(Object.hasOwn(fixture.session.header, 'delegationDepth')).toBe(false)
    const stored = structuredClone(fixture.stored) as Mutable<SessionEventSuffix>
    stored.meta.delegationDepth = 0
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => stored as SessionEventSuffix },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toMatchObject({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
    })
  })

  it('reads and closes one exact current Session persistence handle', async () => {
    const fixture = completedGapTurn()
    const read = vi.fn(async () => ({
      eventState: 'detached',
      events: structuredClone(fixture.stored.events),
    }))
    const close = vi.fn(async () => {})
    let openSignal: AbortSignal | undefined
    const open = vi.fn(async (
      _id: string,
      _access: string,
      options?: { readonly signal?: AbortSignal },
    ) => {
      openSignal = options?.signal
      return {
        id: fixture.session.id,
        header: structuredClone(fixture.stored.meta),
        inheritedEventCount: fixture.stored.inheritedEventCount,
        access: 'read',
        read,
        close,
      }
    })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { open },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toMatchObject({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
    })
    expect(open).toHaveBeenCalledWith(
      fixture.session.id,
      'read',
      { signal: expect.any(AbortSignal) },
    )
    expect(read).toHaveBeenCalledWith(
      0,
      fixture.turnEndSeq + 1,
      { signal: openSignal },
    )
    expect(close).toHaveBeenCalledOnce()
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceRead')).toBe(0)
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceHandle')).toBe(0)
  })

  it('refuses an ambiguous persistence object without invoking either dialect', async () => {
    const fixture = completedGapTurn()
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    const open = vi.fn(async () => { throw new Error('must not open') })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom, open },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(readFrom).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('closes a current handle after read failure and preserves the primary classification', async () => {
    const fixture = completedGapTurn()
    const readFailure = new SessionPersistenceCorruptionError('corrupt current read', {
      cause: new Error('private cause'),
    })
    const read = vi.fn(async () => { throw readFailure })
    const close = vi.fn(async () => { throw new Error('private close failure') })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read,
          close,
        }),
      },
      lifecycle,
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
    expect(read).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toMatch(/private|corrupt|close/u)
  })

  it('preserves a corrupt read classification when handle close exhausts the read budget', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const close = vi.fn(() => new Promise<void>(() => {}))
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => { throw new SessionPersistenceCorruptionError('corrupt physical cut', { cause: undefined }) },
          close,
        }),
      },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
    })
    try {
      const resolving = resolver.resolve(targetFor(fixture))
      await vi.advanceTimersByTimeAsync(10)
      await expect(resolving).resolves.toMatchObject({ reason: 'stored-cut-conflict' })
      expect(close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a successful current read whose close rejects as a read failure', async () => {
    const fixture = completedGapTurn()
    const close = vi.fn(async () => { throw new Error('private close failure') })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => ({
            eventState: 'detached',
            events: structuredClone(fixture.stored.events),
          }),
          close,
        }),
      },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([
    ['not-found', () => new SessionPersistenceNotFoundError(SessionId('episode-session'))],
    ['unsupported-format', () => new SessionFormatUnsupportedError('future format')],
    ['corruption', () => new SessionPersistenceCorruptionError('corrupt close', {
      cause: new Error('private cause'),
    })],
  ] as const)(
    'never treats an official-looking %s close failure as stored evidence',
    async (_label, closeFailure) => {
      const fixture = completedGapTurn()
      const close = vi.fn(async () => { throw closeFailure() })
      const resolver = createStockResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          open: async () => ({
            id: fixture.session.id,
            header: structuredClone(fixture.stored.meta),
            inheritedEventCount: fixture.stored.inheritedEventCount,
            access: 'read',
            read: async () => ({
              eventState: 'detached',
              events: structuredClone(fixture.stored.events),
            }),
            close,
          }),
        },
        lifecycle,
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
        dimensions: ['session-durability'],
      })
      expect(close).toHaveBeenCalledOnce()
    },
  )

  it('times out a late current open, then closes it without starting a late read', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const pendingOpen = deferred<unknown>()
    const read = vi.fn(async () => ({
      eventState: 'detached',
      events: structuredClone(fixture.stored.events),
    }))
    const close = vi.fn(async () => {})
    let signal: AbortSignal | undefined
    const open = vi.fn((
      _id: string,
      _access: string,
      options?: { readonly signal?: AbortSignal },
    ) => {
      signal = options?.signal
      return pendingOpen.promise
    })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { open },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(0)
    expect(open).toHaveBeenCalledOnce()
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceRead')).toBe(1)
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(signal?.aborted).toBe(true)
    pendingOpen.resolve({
      id: fixture.session.id,
      header: structuredClone(fixture.stored.meta),
      inheritedEventCount: fixture.stored.inheritedEventCount,
      access: 'read',
      read,
      close,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(read).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceRead')).toBe(0)
  })

  it('observes a rejecting close from a handle returned after the read deadline', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const pendingOpen = deferred<unknown>()
    const read = vi.fn()
    const close = vi.fn(async () => {
      throw new Error('private late handle close failure')
    })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { open: () => pendingOpen.promise },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(10)
    await expect(resolution).resolves.toMatchObject({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
    })

    pendingOpen.resolve({
      id: fixture.session.id,
      header: structuredClone(fixture.stored.meta),
      inheritedEventCount: fixture.stored.inheritedEventCount,
      access: 'read',
      read,
      close,
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(read).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('times out a current read, closes immediately, and discards its late result', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    const read = vi.fn(() => pendingRead.promise)
    const close = vi.fn(async () => {})
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read,
          close,
        }),
      },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toMatchObject({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
    })
    expect(close).toHaveBeenCalledOnce()
    pendingRead.resolve({
      eventState: 'detached',
      events: structuredClone(fixture.stored.events),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('waits for current handle close before invoking Host attestation', async () => {
    const fixture = completedGapTurn()
    const pendingClose = deferred<void>()
    const attestor = vi.fn(async (subject: DurableInteractionEpisodeSubjectV1) =>
      completeHostResolution(subject))
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => ({
            eventState: 'detached',
            events: structuredClone(fixture.stored.events),
          }),
          close: vi.fn(() => pendingClose.promise),
        }),
      },
      attestor: { resolve: attestor },
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.waitFor(() => {
      expect(deadlineEffectCount(lifecycle, 'sessionPersistenceRead')).toBe(1)
    })
    expect(attestor).not.toHaveBeenCalled()

    pendingClose.resolve()
    await expect(resolution).resolves.toMatchObject({ status: 'assembled' })
    expect(attestor).toHaveBeenCalledOnce()
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceRead')).toBe(0)
  })

  it('bounds a current close that never settles and never invokes Host attestation', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const close = vi.fn(() => new Promise<never>(() => {}))
    const attestor = vi.fn(async (subject: DurableInteractionEpisodeSubjectV1) =>
      completeHostResolution(subject))
    const resolver = createResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => ({
            eventState: 'detached',
            events: structuredClone(fixture.stored.events),
          }),
          close,
        }),
      },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
      attestor: { resolve: attestor },
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledOnce()
    expect(attestor).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(close).toHaveBeenCalledOnce()
    expect(attestor).not.toHaveBeenCalled()
    expect(deadlineEffectCount(lifecycle, 'sessionPersistenceHandle')).toBe(0)
  })

  it('aborts and closes a pending current read when its lifecycle owner is disposed', async () => {
    const owner = new Context()
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    const close = vi.fn(async () => {})
    let openSignal: AbortSignal | undefined
    let readSignal: AbortSignal | undefined
    let ownerDisposed = false
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          open: async (
            _id: string,
            _access: string,
            options?: { readonly signal?: AbortSignal },
          ) => {
            openSignal = options?.signal
            return {
              id: fixture.session.id,
              header: structuredClone(fixture.stored.meta),
              inheritedEventCount: fixture.stored.inheritedEventCount,
              access: 'read',
              read: (
                _offset: number,
                _length: number,
                options?: { readonly signal?: AbortSignal },
              ) => {
                readSignal = options?.signal
                return pendingRead.promise
              },
              close,
            }
          },
        },
        lifecycle: owner,
        sessionPersistenceReadTimeoutMs: 120_000,
        attestor: { resolve: vi.fn() },
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.waitFor(() => expect(readSignal).toBeDefined())
      expect(openSignal).toBe(readSignal)
      expect(deadlineEffectCount(owner, 'sessionPersistenceRead')).toBe(1)

      await owner.fiber.dispose()
      ownerDisposed = true

      await expect(resolution).resolves.toMatchObject({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
      })
      expect(readSignal?.aborted).toBe(true)
      expect(close).toHaveBeenCalledOnce()
      expect(deadlineEffectCount(owner, 'sessionPersistenceRead')).toBe(0)
      pendingRead.reject(new Error('late private read failure'))
      await Promise.resolve()
    } finally {
      if (!ownerDisposed) await owner.fiber.dispose()
    }
  })

  it('contains a current close rejection during lifecycle disposal', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    const observedLogs: unknown[][] = []
    vi.spyOn(owner.ctx.logger, 'error').mockImplementation((...args: unknown[]) => {
      observedLogs.push(args)
    })
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          open: async () => ({
            id: fixture.session.id,
            header: structuredClone(fixture.stored.meta),
            inheritedEventCount: fixture.stored.inheritedEventCount,
            access: 'read',
            read: () => pendingRead.promise,
            close: async () => {
              throw new Error('PRIVATE-CLOSE-MARKER')
            },
          }),
        },
        lifecycle: owner.ctx,
        sessionPersistenceReadTimeoutMs: 120_000,
        attestor: { resolve: vi.fn() },
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.waitFor(() => {
        expect(deadlineEffectCount(owner.ctx, 'sessionPersistenceHandle')).toBe(1)
      })
      await owner.dispose()
      pendingRead.reject(new Error('late private read failure'))

      await expect(resolution).resolves.toMatchObject({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
      })
      expect(JSON.stringify(observedLogs)).not.toContain('PRIVATE-CLOSE-MARKER')
    } finally {
      pendingRead.reject(new Error('test cleanup'))
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('joins an acquired current handle close before lifecycle disposal settles', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    const pendingClose = deferred<void>()
    const close = vi.fn(() => pendingClose.promise)
    let readStarted = false
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          open: async () => ({
            id: fixture.session.id,
            header: structuredClone(fixture.stored.meta),
            inheritedEventCount: fixture.stored.inheritedEventCount,
            access: 'read',
            read: () => {
              readStarted = true
              return pendingRead.promise
            },
            close,
          }),
        },
        lifecycle: owner.ctx,
        sessionPersistenceReadTimeoutMs: 120_000,
        attestor: { resolve: vi.fn() },
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.waitFor(() => expect(readStarted).toBe(true))
      let disposalSettled = false
      const disposal = owner.dispose().then(() => { disposalSettled = true })
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
      await Promise.resolve()
      expect(disposalSettled).toBe(false)

      pendingClose.resolve()
      await disposal
      expect(disposalSettled).toBe(true)
      pendingRead.reject(new Error('late read after closed handle'))
      await expect(resolution).resolves.toMatchObject({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
      })
      expect(close).toHaveBeenCalledOnce()
    } finally {
      pendingClose.resolve()
      pendingRead.reject(new Error('test cleanup'))
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('bounds lifecycle joining when an acquired current handle never closes', async () => {
    vi.useFakeTimers()
    const root = new Context()
    const owner = await root.plugin(() => {})
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    const close = vi.fn(() => new Promise<never>(() => {}))
    let readStarted = false
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: {
          open: async () => ({
            id: fixture.session.id,
            header: structuredClone(fixture.stored.meta),
            inheritedEventCount: fixture.stored.inheritedEventCount,
            access: 'read',
            read: () => {
              readStarted = true
              return pendingRead.promise
            },
            close,
          }),
        },
        lifecycle: owner.ctx,
        sessionPersistenceReadTimeoutMs: 10,
        attestor: { resolve: vi.fn() },
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.advanceTimersByTimeAsync(0)
      expect(readStarted).toBe(true)
      await vi.advanceTimersByTimeAsync(6)
      const wallNow = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(wallNow - 3_600_000)
      let disposalSettled = false
      const disposal = owner.dispose().then(() => { disposalSettled = true })
      await vi.advanceTimersByTimeAsync(3)
      expect(close).toHaveBeenCalledOnce()
      expect(disposalSettled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await disposal
      expect(disposalSettled).toBe(true)
      await expect(resolution).resolves.toMatchObject({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
      })
      pendingRead.reject(new Error('late read after lifecycle deadline'))
      await vi.advanceTimersByTimeAsync(0)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      pendingRead.reject(new Error('test cleanup'))
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('aborts before a same-owner late open continuation can start a read during disposal', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    const fixture = completedGapTurn()
    let resolveOpen!: (handle: unknown) => void
    let signal: AbortSignal | undefined
    const read = vi.fn(() => new Promise<never>(() => {}))
    const close = vi.fn(async () => {})
    const open = vi.fn((
      _id: string,
      _access: string,
      options?: { readonly signal?: AbortSignal },
    ) => {
      signal = options?.signal
      owner.ctx.effect(() => () => {
        resolveOpen({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read,
          close,
        })
      }, 'test.lateOpenOnDispose')
      return new Promise<unknown>((resolve) => { resolveOpen = resolve })
    })
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { open },
        lifecycle: owner.ctx,
        sessionPersistenceReadTimeoutMs: 120_000,
        attestor: { resolve: vi.fn() },
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
      await owner.dispose()

      await expect(resolution).resolves.toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
        dimensions: ['session-durability'],
      })
      expect(signal?.aborted).toBe(true)
      expect(read).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('does not invoke persistence through an inactive lifecycle owner', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    const fixture = completedGapTurn()
    const open = vi.fn()
    await owner.dispose()
    try {
      const resolver = createResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { open },
        lifecycle: owner.ctx,
        attestor: { resolve: vi.fn() },
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
        dimensions: ['session-durability'],
      })
      expect(open).not.toHaveBeenCalled()
    } finally {
      await root.fiber.dispose()
    }
  })

  it('bounds an alpha.5 read and passes its AbortSignal positionally', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const pendingRead = deferred<unknown>()
    let signal: AbortSignal | undefined
    const readFrom = vi.fn((
      _id: string,
      _offset: number,
      readSignal?: AbortSignal,
    ) => {
      signal = readSignal
      return pendingRead.promise
    })
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom },
      lifecycle,
      sessionPersistenceReadTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(0)
    expect(readFrom).toHaveBeenCalledWith(
      fixture.session.id,
      SessionLogOffset(0),
      expect.any(AbortSignal),
    )
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toMatchObject({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
    })
    expect(signal?.aborted).toBe(true)
    pendingRead.resolve(structuredClone(fixture.stored))
    await vi.advanceTimersByTimeAsync(0)
  })

  it.each([
    ['bare event array', (fixture: ReturnType<typeof completedGapTurn>) =>
      structuredClone(fixture.stored.events)],
    ['missing event state', (fixture: ReturnType<typeof completedGapTurn>) => ({
      events: structuredClone(fixture.stored.events),
    })],
    ['unknown event state', (fixture: ReturnType<typeof completedGapTurn>) => ({
      eventState: 'borrowed',
      events: structuredClone(fixture.stored.events),
    })],
    ['non-array events', () => ({ eventState: 'detached', events: {} })],
    ['oversized slice', (fixture: ReturnType<typeof completedGapTurn>) => ({
      eventState: 'detached',
      events: [...structuredClone(fixture.stored.events), fixture.stored.events[0]],
    })],
  ] as const)('rejects and closes a malformed current fulfillment: %s', async (_label, result) => {
    const fixture = completedGapTurn()
    const close = vi.fn(async () => {})
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => result(fixture),
          close,
        }),
      },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects a current close accessor without invoking it', async () => {
    const fixture = completedGapTurn()
    const closeGetter = vi.fn(() => vi.fn(async () => {}))
    const handle = {
      id: fixture.session.id,
      header: structuredClone(fixture.stored.meta),
      inheritedEventCount: fixture.stored.inheritedEventCount,
      access: 'read',
      read: vi.fn(async () => ({
        eventState: 'detached',
        events: structuredClone(fixture.stored.events),
      })),
      get close() { return closeGetter() },
    }
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { open: async () => handle },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(closeGetter).not.toHaveBeenCalled()
    expect(handle.read).not.toHaveBeenCalled()
  })

  it.each(['alpha5', 'current'] as const)(
    'contains a null physical header from the %s persistence dialect',
    async (dialect) => {
      const fixture = completedGapTurn()
      const close = vi.fn(async () => {})
      const sessionPersistence = dialect === 'alpha5'
        ? {
            readFrom: async () => ({
              ...structuredClone(fixture.stored),
              meta: null,
            }),
          }
        : {
            open: async () => ({
              id: fixture.session.id,
              header: null,
              inheritedEventCount: fixture.stored.inheritedEventCount,
              access: 'read',
              read: async () => ({
                eventState: 'detached',
                events: structuredClone(fixture.stored.events),
              }),
              close,
            }),
          }
      const resolver = createStockResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence,
        lifecycle,
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-cut-conflict',
        dimensions: ['subject', 'session-durability'],
      })
      expect(close).toHaveBeenCalledTimes(dialect === 'current' ? 1 : 0)
    },
  )

  it('classifies a current handle with missing header metadata as a physical conflict', async () => {
    const fixture = completedGapTurn()
    const close = vi.fn(async () => {})
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          id: fixture.session.id,
          inheritedEventCount: fixture.stored.inheritedEventCount,
          access: 'read',
          read: async () => ({
            eventState: 'detached',
            events: structuredClone(fixture.stored.events),
          }),
          close,
        }),
      },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects an array decorated to resemble the exact physical header', async () => {
    const fixture = completedGapTurn()
    const decoratedHeader = Object.assign([], structuredClone(fixture.stored.meta))
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => ({
          ...structuredClone(fixture.stored),
          meta: decoratedHeader,
        }),
      },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
  })

  it.each([
    ['wrong handle id', { id: 'other-session', access: 'read', read: async () => undefined }],
    ['write handle', { id: 'episode-session', access: 'write', read: async () => undefined }],
    ['missing read', { id: 'episode-session', access: 'read' }],
    ['non-callable read', { id: 'episode-session', access: 'read', read: true }],
  ] as const)('fails and closes a malformed current handle: %s', async (_label, shape) => {
    const fixture = completedGapTurn()
    const close = vi.fn(async () => {})
    const resolver = createStockResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        open: async () => ({
          ...shape,
          header: structuredClone(fixture.stored.meta),
          inheritedEventCount: fixture.stored.inheritedEventCount,
          close,
        }),
      },
      lifecycle,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([0, 1.5, 120_001, Number.NaN])(
    'rejects an invalid Session persistence read timeout: %s',
    (timeoutMs) => {
      const fixture = completedGapTurn()
      expect(() => createStockResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        lifecycle,
        sessionPersistenceReadTimeoutMs: timeoutMs,
      })).toThrow(
        'Session persistence read timeout must be from 1 to 120000 milliseconds',
      )
    },
  )

  it.each([
    ['SessionPersistenceNotFoundError', 'episode-session', 'stored-cut-unavailable'],
    ['SessionPersistenceNotFoundError', 'other-session', 'stored-read-failed'],
    ['SessionFormatUnsupportedError', undefined, 'stored-cut-unavailable'],
    ['SessionPersistenceCorruptionError', undefined, 'stored-cut-conflict'],
  ] as const)(
    'classifies a foreign-copy %s without relying on instanceof',
    async (name, sessionId, reason) => {
      const fixture = completedGapTurn()
      const foreignError = foreignPersistenceError(name, sessionId)
      const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => { throw foreignError } },
      })

      const result = await resolver.resolve(targetFor(fixture))

      expect(result).toMatchObject({
        status: 'abstained',
        stage: 'session-durability',
        reason,
      })
      expect(JSON.stringify(result)).not.toContain('private')
    },
  )

  it('does not trust a renamed plain Error as an official persistence conclusion', async () => {
    const fixture = completedGapTurn()
    const spoof = new Error('private spoof') as Error & { sessionId?: string }
    spoof.name = 'SessionPersistenceNotFoundError'
    spoof.sessionId = String(fixture.session.id)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => { throw spoof } },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-read-failed',
      dimensions: ['session-durability'],
    })
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
    expect(Object.keys(observedDerived ?? {})).toEqual(['triggerRequestControl'])
    expect(Object.isFrozen(observedDerived)).toBe(true)
    expect(Object.isFrozen(observedDerived?.triggerRequestControl)).toBe(true)
    expect(JSON.stringify(observedDerived)).not.toContain('Find a reusable release audit method.')
  })

  it('keeps the captured logical root header after verifying a materialized physical depth', async () => {
    const fixture = completedGapTurn()
    const stored = structuredClone(fixture.stored) as Mutable<SessionEventSuffix>
    stored.meta.delegationDepth = 0
    let observedSubject: DurableInteractionEpisodeSubjectV1 | undefined
    const resolver = createInteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => stored as unknown as SessionEventSuffix },
      attestor: {
        resolve: async subject => {
          observedSubject = subject
          return completeHostResolution(subject)
        },
      },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toMatchObject({
      status: 'assembled',
    })
    expect(observedSubject?.session.header).toEqual(fixture.session.header)
    expect(Object.hasOwn(
      observedSubject?.session.header ?? {},
      'delegationDepth',
    )).toBe(false)
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

  it('does not accept owned-gap Routing evidence for a native Skill error', async () => {
    const fixture = completedGapTurn('skill-tool-error')
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence: {
        resolveRoutingEvidence: async (subject, derived) => ({
          status: 'matched',
          fact: {
            schemaVersion: 1,
            kind: 'interaction-routing-fact-v1',
            workspaceId: WORKSPACE_ID,
            subject: {
              sessionLifecycleDigest: HASH_A,
              prefixDigest: subject.transcript.replay.prefixDigest,
              turnDigest: subject.transcript.replay.turnDigest,
              loggedControlDigest: derived.triggerRequestControl.loggedControlDigest,
              turnEndSeq: subject.transcript.source.turnEndSeq,
              triggerRequestSeq: derived.triggerRequestControl.boundary.assistantMessageSeq,
              triggerCallSeq: subject.transcript.source.triggerCallSeq,
              triggerResultSeq: subject.transcript.source.triggerResultSeq,
            },
            routing: {
              rawTrigger: 'successful-gap-report',
              conclusion: 'model-declared-no-applicable-skill',
            },
          },
        }),
      },
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill
    reject = fail
  })
  return { promise, resolve, reject }
}

function deadlineEffectCount(owner: Context, suffix: string): number {
  return owner.fiber.getEffects().filter(
    effect => effect.label === `dsh-evolve.interactionEpisode.${suffix}`,
  ).length
}

function foreignPersistenceError(
  name:
    | 'SessionPersistenceNotFoundError'
    | 'SessionFormatUnsupportedError'
    | 'SessionPersistenceCorruptionError',
  sessionId: string | undefined,
): Error {
  if (name === 'SessionPersistenceNotFoundError') {
    return new (class SessionPersistenceNotFoundError extends Error {
      override readonly name = 'SessionPersistenceNotFoundError'
      constructor(readonly sessionId: string | undefined) {
        super('foreign private persistence detail')
      }
    })(sessionId)
  }
  if (name === 'SessionFormatUnsupportedError') {
    return new (class SessionFormatUnsupportedError extends Error {
      override readonly name = 'SessionFormatUnsupportedError'
    })('foreign private persistence detail')
  }
  return new (class SessionPersistenceCorruptionError extends Error {
    override readonly name = 'SessionPersistenceCorruptionError'
  })('foreign private persistence detail')
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
