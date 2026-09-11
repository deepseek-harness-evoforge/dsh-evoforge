import { Context } from '@deepseek-ai/cordis'
import {
  freezeMessage,
  MessageId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  SessionLogOffset,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionEventSuffix } from '@deepseek-ai/dsh-session-persistence'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { interactionGenerationSessionLifecycleDigest } from '../src/interaction-generation-evidence.ts'
import { interactionRoutingSessionLifecycleDigest } from '../src/interaction-routing-evidence.ts'
import {
  createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver as createGatewayAwareResolver,
  createStockDshAlpha5InteractionEpisodeEvidenceResolver as createStockResolver,
  type DurableInteractionEpisodeSubjectV1,
  type InteractionEpisodeDerivedEvidenceV1,
} from '../src/interaction-episode-evidence-resolver.ts'

const lifecycle = new Context()

type StockResolverDependencies = Parameters<typeof createStockResolver>[0]
type GatewayAwareResolverDependencies = Parameters<typeof createGatewayAwareResolver>[0]

function createStockDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: Omit<StockResolverDependencies, 'lifecycle'>,
) {
  return createStockResolver({ ...dependencies, lifecycle })
}

function createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: Omit<GatewayAwareResolverDependencies, 'lifecycle'>,
) {
  return createGatewayAwareResolver({ ...dependencies, lifecycle })
}

afterAll(async () => {
  await lifecycle.fiber.dispose()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Gateway-aware Interaction Episode evidence resolver', () => {
  it('turns a matched Workspace fact into 13 missing dimensions without assembling', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: WORKSPACE_ID,
      },
    })
    const resolver = resolverFor(fixture, gateway)

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_WORKSPACE,
    })
    expect(result).not.toHaveProperty('input')
    expect(gateway.resolveIngressEvidence).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'gateway-ingress-evidence-query-v1',
      session: {
        header: fixture.stored.meta,
        inheritedEventCount: fixture.stored.inheritedEventCount,
      },
      enqueue: fixture.stored.events[0],
    })
  })

  it('retains all 14 missing dimensions when Gateway evidence is unavailable', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await expect(
      resolverFor(fixture, gateway).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: ALL_MISSING_DIMENSIONS,
    })
  })

  it('narrows a Gateway evidence conflict to Workspace', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await expect(
      resolverFor(fixture, gateway).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('treats a malformed Gateway result as a Workspace conflict', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: WORKSPACE_ID,
      },
      unexpectedAuthorityExpansion: true,
    })

    await expect(
      resolverFor(fixture, gateway).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('rejects a Gateway fact with a non-native Workspace UUID version', async () => {
    const fixture = completedGapTurn()

    await expect(
      resolverFor(
        fixture,
        gatewayReturning(matchedGatewayWorkspace(NON_NATIVE_WORKSPACE_ID)),
      ).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved when a matched Gateway result has a symbol property', async () => {
    const fixture = completedGapTurn()
    const result = {
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: WORKSPACE_ID,
      },
    }
    Object.defineProperty(result, Symbol('privateState'), {
      enumerable: true,
      value: 'must-not-be-ignored',
    })

    await expect(
      resolverFor(fixture, gatewayReturning(result)).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved when a matched Gateway fact has a non-enumerable property', async () => {
    const fixture = completedGapTurn()
    const fact = {
      schemaVersion: 1,
      kind: 'gateway-ingress-workspace-fact-v1',
      workspaceId: WORKSPACE_ID,
    }
    Object.defineProperty(fact, 'privateState', {
      enumerable: false,
      value: 'must-not-be-ignored',
    })

    await expect(
      resolverFor(fixture, gatewayReturning({
        status: 'matched',
        fact,
      })).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved without evaluating an accessor-backed Gateway fact', async () => {
    const fixture = completedGapTurn()
    const fact = {
      schemaVersion: 1,
      kind: 'gateway-ingress-workspace-fact-v1',
      workspaceId: WORKSPACE_ID,
    }
    let reads = 0
    Object.defineProperty(fact, 'workspaceId', {
      enumerable: true,
      get() {
        reads += 1
        return WORKSPACE_ID
      },
    })

    await expect(
      resolverFor(fixture, gatewayReturning({
        status: 'matched',
        fact,
      })).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
    expect(reads).toBe(0)
  })

  it('keeps Workspace unresolved when an inherited required field is balanced by an extra field', async () => {
    const fixture = completedGapTurn()
    const priorStatus = Object.getOwnPropertyDescriptor(Object.prototype, 'status')
    Object.defineProperty(Object.prototype, 'status', {
      configurable: true,
      writable: true,
      value: 'matched',
    })
    let resolved: Awaited<ReturnType<ReturnType<typeof resolverFor>['resolve']>>
    try {
      resolved = await resolverFor(fixture, gatewayReturning({
        fact: {
          schemaVersion: 1,
          kind: 'gateway-ingress-workspace-fact-v1',
          workspaceId: WORKSPACE_ID,
        },
        unexpectedAuthorityExpansion: true,
      })).resolve(targetFor(fixture))
    } finally {
      if (priorStatus === undefined) {
        delete (Object.prototype as { status?: unknown }).status
      } else {
        Object.defineProperty(Object.prototype, 'status', priorStatus)
      }
    }

    expect(resolved).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved when an abstained Gateway result has a symbol property', async () => {
    const fixture = completedGapTurn()
    const result = {
      status: 'abstained',
      reason: 'evidence-unavailable',
    }
    Object.defineProperty(result, Symbol('privateState'), {
      enumerable: true,
      value: 'must-not-be-ignored',
    })

    await expect(
      resolverFor(fixture, gatewayReturning(result)).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved when a hidden required field is balanced by an extra field', async () => {
    const fixture = completedGapTurn()
    const result = {
      status: 'abstained',
      reason: 'evidence-unavailable',
      unexpectedAuthorityExpansion: true,
    }
    Object.defineProperty(result, 'status', {
      enumerable: false,
      value: 'abstained',
    })

    await expect(
      resolverFor(fixture, gatewayReturning(result)).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('keeps Workspace unresolved without evaluating an accessor-backed abstention', async () => {
    const fixture = completedGapTurn()
    const result = {
      status: 'abstained',
      reason: 'evidence-unavailable',
    }
    let reads = 0
    Object.defineProperty(result, 'status', {
      enumerable: true,
      get() {
        reads += 1
        return 'abstained'
      },
    })

    await expect(
      resolverFor(fixture, gatewayReturning(result)).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
    expect(reads).toBe(0)
  })

  it.each([
    [
      'matched',
      Object.freeze({
        status: 'matched',
        fact: Object.freeze({
          schemaVersion: 1,
          kind: 'gateway-ingress-workspace-fact-v1',
          workspaceId: WORKSPACE_ID,
        }),
      }),
      {
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-unavailable',
        dimensions: MISSING_EXCEPT_WORKSPACE,
      },
    ],
    [
      'abstained',
      Object.freeze({
        status: 'abstained',
        reason: 'evidence-unavailable',
      }),
      {
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-unavailable',
        dimensions: ALL_MISSING_DIMENSIONS,
      },
    ],
  ] as const)('accepts a valid frozen %s Gateway result', async (_name, result, expected) => {
    const fixture = completedGapTurn()

    await expect(
      resolverFor(fixture, gatewayReturning(result)).resolve(targetFor(fixture)),
    ).resolves.toEqual(expected)
  })

  it('binds a rejected Gateway invocation to attestor failure', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayRejecting()

    const result = await resolverFor(fixture, gateway).resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(JSON.stringify(result)).not.toContain('gateway-secret')
  })

  it('removes the lifecycle deadline effect after normal Host source settlement', async () => {
    const fixture = completedGapTurn()
    const pendingGateway = deferred<unknown>()
    const gateway = {
      resolveIngressEvidence: vi.fn(() => pendingGateway.promise as never),
    }
    const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      gateway,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.waitFor(() => expect(gateway.resolveIngressEvidence).toHaveBeenCalledOnce())
    expect(deadlineEffectCount(lifecycle)).toBe(1)

    pendingGateway.resolve({ status: 'abstained', reason: 'evidence-unavailable' })
    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: ALL_MISSING_DIMENSIONS,
    })
    expect(deadlineEffectCount(lifecycle)).toBe(0)
  })

  it('bounds a Gateway evidence invocation that never settles', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const gateway = {
      resolveIngressEvidence: vi.fn(() => new Promise<never>(() => {})),
    }
    const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      gateway,
      hostEvidenceSourceTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(0)
    expect(deadlineEffectCount(lifecycle)).toBe(1)
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(gateway.resolveIngressEvidence).toHaveBeenCalledOnce()
    expect(deadlineEffectCount(lifecycle)).toBe(0)
  })

  it('fails closed when its lifecycle owner is disposed during a pending invocation', async () => {
    const owner = new Context()
    let ownerDisposed = false
    const fixture = completedGapTurn()
    const gateway = {
      resolveIngressEvidence: vi.fn(() => new Promise<never>(() => {})),
    }
    try {
      const resolver = createGatewayAwareResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        lifecycle: owner,
        gateway,
        hostEvidenceSourceTimeoutMs: 120_000,
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.waitFor(() => expect(gateway.resolveIngressEvidence).toHaveBeenCalledOnce())
      expect(deadlineEffectCount(owner)).toBe(1)

      await owner.fiber.dispose()
      ownerDisposed = true

      await expect(resolution).resolves.toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'attestor-invocation-failed',
        dimensions: ['binding'],
      })
      expect(deadlineEffectCount(owner)).toBe(0)
    } finally {
      if (!ownerDisposed) await owner.fiber.dispose()
    }
  })

  it('does not invoke persistence or a Host source through an inactive lifecycle owner', async () => {
    const root = new Context()
    const ownerFiber = await root.plugin(() => {})
    await ownerFiber.dispose()
    const fixture = completedGapTurn()
    const gateway = gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID))
    const readFrom = vi.fn(async () => structuredClone(fixture.stored))
    try {
      const resolver = createGatewayAwareResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom },
        lifecycle: ownerFiber.ctx,
        gateway,
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'session-durability',
        reason: 'stored-read-failed',
        dimensions: ['session-durability'],
      })
      expect(readFrom).not.toHaveBeenCalled()
      expect(gateway.resolveIngressEvidence).not.toHaveBeenCalled()
    } finally {
      await root.fiber.dispose()
    }
  })

  it('bounds a Generation evidence invocation that never settles', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(() => new Promise<never>(() => {})),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
      hostEvidenceSourceTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(generationEvidence.resolveGenerationEvidence).toHaveBeenCalledOnce()
  })

  it('bounds a Routing evidence invocation that never settles', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const routingEvidence = {
      resolveRoutingEvidence: vi.fn(() => new Promise<never>(() => {})),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
      hostEvidenceSourceTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(routingEvidence.resolveRoutingEvidence).toHaveBeenCalledOnce()
  })

  it('uses a bounded 30-second default for Host evidence sources', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      gateway: {
        resolveIngressEvidence: vi.fn(() => new Promise<never>(() => {})),
      },
    })
    let settled = false
    const resolution = resolver.resolve(targetFor(fixture)).finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(resolution).resolves.toMatchObject({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
    })
  })

  it('observes late source settlement without changing the timed-out result', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const lateGateway = deferred<unknown>()
    const lateGeneration = deferred<unknown>()
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)
    try {
      const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        gateway: {
          resolveIngressEvidence: vi.fn(() => lateGateway.promise as never),
        },
        generationEvidence: {
          resolveGenerationEvidence: vi.fn(() => lateGeneration.promise as never),
        },
        hostEvidenceSourceTimeoutMs: 10,
      })

      const resolution = resolver.resolve(targetFor(fixture))
      await vi.advanceTimersByTimeAsync(10)
      const timedOut = await resolution
      expect(timedOut).toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'attestor-invocation-failed',
        dimensions: ['binding'],
      })

      lateGateway.resolve(matchedGatewayWorkspace(WORKSPACE_ID))
      lateGeneration.reject(new Error('late-generation-secret'))
      await Promise.resolve()
      await Promise.resolve()
      expect(await resolution).toBe(timedOut)
      expect(vi.getTimerCount()).toBe(0)

      vi.useRealTimers()
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandledRejection)
    }
  })

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    120_001,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects an invalid Host evidence source timeout: %s', timeoutMs => {
    const fixture = completedGapTurn()

    expect(() => createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      hostEvidenceSourceTimeoutMs: timeoutMs,
    })).toThrow('Host evidence source timeout must be from 1 to 120000 milliseconds')
  })

  it('does not consult Gateway when persisted enqueue evidence differs from the live event', async () => {
    const fixture = completedGapTurn()
    const stored = structuredClone(fixture.stored) as Mutable<SessionEventSuffix>
    const enqueue = stored.events[0]
    if (enqueue?.type !== 'agent/inbox/spliced') {
      throw new Error('fixture enqueue event is missing')
    }
    enqueue.data.start = 1
    const gateway = gatewayReturning({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: WORKSPACE_ID,
      },
    })
    const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: {
        readFrom: async () => stored as unknown as SessionEventSuffix,
      },
      gateway,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'session-durability',
      reason: 'stored-cut-conflict',
      dimensions: ['subject', 'session-durability'],
    })
    expect(gateway.resolveIngressEvidence).not.toHaveBeenCalled()
  })

  it('never promotes Gateway-only evidence into an assembled Episode', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'gateway-ingress-workspace-fact-v1',
        workspaceId: WORKSPACE_ID,
      },
    })

    const result = await resolverFor(fixture, gateway).resolve(targetFor(fixture))

    expect(result.status).toBe('abstained')
    expect(result).not.toHaveProperty('input')
    if (result.status !== 'abstained') {
      throw new Error('Gateway-only evidence unexpectedly assembled an Episode')
    }
    expect(result.dimensions).toHaveLength(13)
  })
})

describe('DSH alpha.5 partial Host evidence composition', () => {
  it('subtracts only Routing for a valid owned gap Routing fact', async () => {
    const fixture = completedGapTurn()
    const routingEvidence = routingReturning()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_ROUTING,
    })
    expect(routingEvidence.resolveRoutingEvidence).toHaveBeenCalledOnce()
  })

  it('preserves Routing when Routing evidence is unavailable', async () => {
    const fixture = completedGapTurn()
    const routingEvidence = routingResult({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: ALL_MISSING_DIMENSIONS,
    })
  })

  it('narrows a malformed Routing result to Routing conflict', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence: routingResult({ status: 'matched', fact: {} }),
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('rejects a Routing fact bound to another Session lifecycle', async () => {
    const fixture = completedGapTurn()
    const valid = routingReturning()
    const routingEvidence = {
      resolveRoutingEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveRoutingEvidence(subject, derived)
        const currentDigest = result.fact.subject.sessionLifecycleDigest
        return {
          ...result,
          fact: {
            ...result.fact,
            subject: {
              ...result.fact.subject,
              sessionLifecycleDigest: `${currentDigest[0] === 'f' ? 'e' : 'f'}${currentDigest.slice(1)}`,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('rejects a Routing fact bound to another logged request control', async () => {
    const fixture = completedGapTurn()
    const valid = routingReturning()
    const routingEvidence = {
      resolveRoutingEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveRoutingEvidence(subject, derived)
        const digest = result.fact.subject.loggedControlDigest
        return {
          ...result,
          fact: {
            ...result.fact,
            subject: {
              ...result.fact.subject,
              loggedControlDigest: `${digest[0] === 'f' ? 'e' : 'f'}${digest.slice(1)}`,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('rejects a Routing fact whose coordinates do not match the durable subject', async () => {
    const fixture = completedGapTurn()
    const valid = routingReturning()
    const routingEvidence = {
      resolveRoutingEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveRoutingEvidence(subject, derived)
        return {
          ...result,
          fact: {
            ...result.fact,
            subject: {
              ...result.fact.subject,
              triggerResultSeq: result.fact.subject.triggerResultSeq + 1,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('rejects a Routing fact with a non-native Workspace UUID version', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence: routingReturning(NON_NATIVE_WORKSPACE_ID),
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it('requires the exact owned-gap Routing conclusion', async () => {
    const fixture = completedGapTurn()
    const valid = routingReturning()
    const routingEvidence = {
      resolveRoutingEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveRoutingEvidence(subject, derived)
        return {
          ...result,
          fact: {
            ...result.fact,
            routing: {
              ...result.fact.routing,
              unexpectedAuthorityExpansion: true,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
  })

  it.each(['native', 'evolved'] as const)(
    'subtracts only Generation for a valid %s Generation fact', async (generation) => {
      const fixture = completedGapTurn()
      const generationEvidence = generationReturning(generation)
      const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
        sessions: { get: () => fixture.session, flush: async () => true },
        sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
        generationEvidence,
      })

      await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-unavailable',
        dimensions: MISSING_EXCEPT_GENERATION,
      })
      expect(generationEvidence.resolveGenerationEvidence).toHaveBeenCalledOnce()
    },
  )

  it('preserves the exact stock missing list when Generation evidence is unavailable', async () => {
    const fixture = completedGapTurn()
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: ALL_MISSING_DIMENSIONS,
    })
  })

  it('combines matching Gateway Workspace and Generation facts', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID))
    const generationEvidence = generationReturning('evolved')

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_WORKSPACE_AND_GENERATION,
    })
  })

  it('combines matching Gateway, Generation, and Routing facts', async () => {
    const fixture = completedGapTurn()

    await expect(
      resolverFor(
        fixture,
        gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID)),
        generationReturning('evolved'),
        routingReturning(),
      ).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_WORKSPACE_GENERATION_AND_ROUTING,
    })
  })

  it('keeps only Gateway Workspace evidence when Generation is unavailable', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID))
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_WORKSPACE,
    })
  })

  it('keeps only Generation evidence when Gateway is unavailable', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await expect(
      resolverFor(fixture, gateway, generationReturning('native')).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_GENERATION,
    })
  })

  it('preserves all stock dimensions when both optional sources are unavailable', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-unavailable',
    })

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: ALL_MISSING_DIMENSIONS,
    })
  })

  it('reports only Generation when Gateway matches but Generation conflicts', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID))
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('reports only Workspace when Generation matches but Gateway conflicts', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await expect(
      resolverFor(fixture, gateway, generationReturning('evolved')).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('conflicts both dimensions when Gateway and Generation name different Workspaces', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID))
    const generationEvidence = generationReturning('native', OTHER_WORKSPACE_ID)

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace', 'generation'],
    })
  })

  it('conflicts Workspace and Routing when Gateway and Routing name different Workspaces', async () => {
    const fixture = completedGapTurn()

    await expect(
      resolverFor(
        fixture,
        gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID)),
        undefined,
        routingReturning(OTHER_WORKSPACE_ID),
      ).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace', 'routing'],
    })
  })

  it('conflicts Generation and Routing when their facts name different Workspaces', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence: generationReturning('native', WORKSPACE_ID),
      routingEvidence: routingReturning(OTHER_WORKSPACE_ID),
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation', 'routing'],
    })
  })

  it('unions every implicated dimension across three incompatible Workspaces', async () => {
    const fixture = completedGapTurn()

    await expect(
      resolverFor(
        fixture,
        gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID)),
        generationReturning('native', OTHER_WORKSPACE_ID),
        routingReturning('44444444-4444-4444-8444-444444444444'),
      ).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace', 'generation', 'routing'],
    })
  })

  it.each([
    [
      'an explicit conflict',
      { status: 'abstained', reason: 'evidence-conflict' },
    ],
    [
      'a malformed matched result',
      { status: 'matched', fact: {} },
    ],
  ])('narrows %s from the Generation source to Generation', async (_label, result) => {
    const fixture = completedGapTurn()
    const generationEvidence = generationResult(result)
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('rejects a Generation fact bound to another Session lifecycle', async () => {
    const fixture = completedGapTurn()
    const valid = generationReturning('native')
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveGenerationEvidence(subject, derived)
        const currentDigest = result.fact.subject.sessionLifecycleDigest
        return {
          ...result,
          fact: {
            ...result.fact,
            subject: {
              ...result.fact.subject,
              sessionLifecycleDigest: `${currentDigest[0] === 'f' ? 'e' : 'f'}${currentDigest.slice(1)}`,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('rejects a Generation fact bound to another logged request control', async () => {
    const fixture = completedGapTurn()
    const valid = generationReturning('native')
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const result = await valid.resolveGenerationEvidence(subject, derived)
        const digest = result.fact.subject.loggedControlDigest
        return {
          ...result,
          fact: {
            ...result.fact,
            subject: {
              ...result.fact.subject,
              loggedControlDigest: `${digest[0] === 'f' ? 'e' : 'f'}${digest.slice(1)}`,
            },
          },
        }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('rejects a Generation fact with a non-native Workspace UUID version', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence: generationReturning('native', NON_NATIVE_WORKSPACE_ID),
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('accepts an exact deeply frozen Generation fact', async () => {
    const fixture = completedGapTurn()
    const valid = generationReturning('evolved')
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => deepFreezeForTest(
        await valid.resolveGenerationEvidence(subject, derived),
      )),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-unavailable',
      dimensions: MISSING_EXCEPT_GENERATION,
    })
  })

  it('does not evaluate an accessor-backed Generation fact', async () => {
    const fixture = completedGapTurn()
    const valid = generationReturning('native')
    let reads = 0
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const resolution = await valid.resolveGenerationEvidence(subject, derived)
        const fact = { ...resolution.fact }
        Object.defineProperty(fact, 'generation', {
          enumerable: true,
          get() {
            reads += 1
            return resolution.fact.generation
          },
        })
        return { status: 'matched' as const, fact }
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
    expect(reads).toBe(0)
  })

  it('rejects a symbol-bearing Generation result', async () => {
    const fixture = completedGapTurn()
    const valid = generationReturning('native')
    const generationEvidence = {
      resolveGenerationEvidence: vi.fn(async (
        subject: DurableInteractionEpisodeSubjectV1,
        derived: InteractionEpisodeDerivedEvidenceV1,
      ) => {
        const resolution = await valid.resolveGenerationEvidence(subject, derived)
        Object.defineProperty(resolution, Symbol('privateState'), {
          enumerable: true,
          value: 'must-not-be-ignored',
        })
        return resolution
      }),
    }
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('contains a hostile Generation result Proxy as a Generation conflict', async () => {
    const fixture = completedGapTurn()
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('generation proxy trap')
      },
    })
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence: generationResult(hostile),
    })

    await expect(resolver.resolve(targetFor(fixture))).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
  })

  it('combines independent Gateway and Generation conflicts in canonical order', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-conflict',
    })
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    await expect(
      resolverFor(fixture, gateway, generationEvidence).resolve(targetFor(fixture)),
    ).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace', 'generation'],
    })
    expect(gateway.resolveIngressEvidence).toHaveBeenCalledOnce()
    expect(generationEvidence.resolveGenerationEvidence).toHaveBeenCalledOnce()
  })

  it('preserves a Generation conflict when the Gateway source rejects', async () => {
    const fixture = completedGapTurn()
    const generationEvidence = generationResult({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    const result = await resolverFor(
      fixture,
      gatewayRejecting(),
      generationEvidence,
    ).resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['generation'],
    })
    expect(JSON.stringify(result)).not.toContain('gateway-secret')
  })

  it('preserves a Workspace conflict when the Generation source rejects', async () => {
    const fixture = completedGapTurn()
    const gateway = gatewayReturning({
      status: 'abstained',
      reason: 'evidence-conflict',
    })

    const result = await resolverFor(
      fixture,
      gateway,
      generationRejecting(),
    ).resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
    expect(JSON.stringify(result)).not.toContain('generation-secret')
  })

  it('preserves a Routing conflict when both sibling sources reject', async () => {
    const fixture = completedGapTurn()
    const result = await resolverFor(
      fixture,
      gatewayRejecting(),
      generationRejecting(),
      routingResult({ status: 'abstained', reason: 'evidence-conflict' }),
    ).resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['routing'],
    })
    expect(JSON.stringify(result)).not.toMatch(/gateway-secret|generation-secret/u)
  })

  it('preserves a fulfilled conflict when one sibling times out', async () => {
    vi.useFakeTimers()
    const fixture = completedGapTurn()
    const resolver = createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      gateway: gatewayReturning({
        status: 'abstained',
        reason: 'evidence-conflict',
      }),
      generationEvidence: {
        resolveGenerationEvidence: vi.fn(() => new Promise<never>(() => {})),
      },
      routingEvidence: routingRejecting(),
      hostEvidenceSourceTimeoutMs: 10,
    })

    const resolution = resolver.resolve(targetFor(fixture))
    await vi.advanceTimersByTimeAsync(10)

    await expect(resolution).resolves.toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'evidence-conflict',
      dimensions: ['workspace'],
    })
  })

  it('binds a rejected Routing source invocation to attestor failure', async () => {
    const fixture = completedGapTurn()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      routingEvidence: routingRejecting(),
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(JSON.stringify(result)).not.toContain('routing-secret')
  })

  it.each([
    [
      'Gateway',
      () => gatewayRejecting(),
      () => generationReturning('native'),
    ],
    [
      'Generation',
      () => gatewayReturning(matchedGatewayWorkspace(WORKSPACE_ID)),
      () => generationRejecting(),
    ],
    [
      'both sources',
      () => gatewayRejecting(),
      () => generationRejecting(),
    ],
  ] as const)(
    'binds %s rejection when no fulfilled source proves a conflict',
    async (_label, createGateway, createGenerationEvidence) => {
      const fixture = completedGapTurn()
      const result = await resolverFor(
        fixture,
        createGateway(),
        createGenerationEvidence(),
      ).resolve(targetFor(fixture))

      expect(result).toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'attestor-invocation-failed',
        dimensions: ['binding'],
      })
      expect(JSON.stringify(result)).not.toMatch(/gateway-secret|generation-secret/u)
    },
  )

  it('binds a rejected Generation source invocation to attestor failure', async () => {
    const fixture = completedGapTurn()
    const generationEvidence = generationRejecting()
    const resolver = createStockDshAlpha5InteractionEpisodeEvidenceResolver({
      sessions: { get: () => fixture.session, flush: async () => true },
      sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
      generationEvidence,
    })

    const result = await resolver.resolve(targetFor(fixture))

    expect(result).toEqual({
      status: 'abstained',
      stage: 'host-evidence',
      reason: 'attestor-invocation-failed',
      dimensions: ['binding'],
    })
    expect(JSON.stringify(result)).not.toContain('generation-secret')
  })
})

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const NON_NATIVE_WORKSPACE_ID = '33333333-3333-6333-8333-333333333333'

const ALL_MISSING_DIMENSIONS = [
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
] as const

const MISSING_EXCEPT_WORKSPACE = ALL_MISSING_DIMENSIONS.slice(1)

const MISSING_EXCEPT_GENERATION = ALL_MISSING_DIMENSIONS.filter(
  dimension => dimension !== 'generation',
)

const MISSING_EXCEPT_ROUTING = ALL_MISSING_DIMENSIONS.filter(
  dimension => dimension !== 'routing',
)

const MISSING_EXCEPT_WORKSPACE_AND_GENERATION = ALL_MISSING_DIMENSIONS.filter(
  dimension => dimension !== 'workspace' && dimension !== 'generation',
)

const MISSING_EXCEPT_WORKSPACE_GENERATION_AND_ROUTING = ALL_MISSING_DIMENSIONS.filter(
  dimension => dimension !== 'workspace'
    && dimension !== 'generation'
    && dimension !== 'routing',
)

type Fixture = ReturnType<typeof completedGapTurn>
type Gateway = Parameters<
  typeof createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver
>[0]['gateway']
type GenerationEvidence = Parameters<
  typeof createStockDshAlpha5InteractionEpisodeEvidenceResolver
>[0]['generationEvidence']
type RoutingEvidence = Parameters<
  typeof createStockDshAlpha5InteractionEpisodeEvidenceResolver
>[0]['routingEvidence']

function targetFor(fixture: Fixture) {
  return {
    session: fixture.session,
    turnEndSeq: fixture.turnEndSeq,
    trigger: { callId: 'gap-call' },
  }
}

function gatewayReturning(result: unknown): Gateway & {
  readonly resolveIngressEvidence: ReturnType<typeof vi.fn>
} {
  return {
    resolveIngressEvidence: vi.fn(async () => result as never),
  }
}

function matchedGatewayWorkspace(workspaceId: string) {
  return {
    status: 'matched' as const,
    fact: {
      schemaVersion: 1 as const,
      kind: 'gateway-ingress-workspace-fact-v1' as const,
      workspaceId,
    },
  }
}

function gatewayRejecting(): Gateway & {
  readonly resolveIngressEvidence: ReturnType<typeof vi.fn>
} {
  return {
    resolveIngressEvidence: vi.fn(async () => {
      throw new Error('gateway-secret')
    }),
  }
}

function generationReturning(
  generation: 'native' | 'evolved',
  workspaceId = WORKSPACE_ID,
) {
  return {
    resolveGenerationEvidence: vi.fn(async (
      subject: DurableInteractionEpisodeSubjectV1,
      derived: InteractionEpisodeDerivedEvidenceV1,
    ) => ({
      status: 'matched' as const,
      fact: {
        schemaVersion: 1 as const,
        kind: 'interaction-generation-fact-v1' as const,
        workspaceId,
        subject: {
          sessionLifecycleDigest: interactionGenerationSessionLifecycleDigest(subject),
          prefixDigest: subject.transcript.replay.prefixDigest,
          turnDigest: subject.transcript.replay.turnDigest,
          loggedControlDigest: derived.triggerRequestControl.loggedControlDigest,
          turnEndSeq: subject.transcript.source.turnEndSeq,
          triggerRequestSeq: derived.triggerRequestControl.boundary.assistantMessageSeq,
          triggerCallSeq: subject.transcript.source.triggerCallSeq,
          triggerResultSeq: subject.transcript.source.triggerResultSeq,
        },
        generation: generation === 'native'
          ? {
              kind: 'native' as const,
              pin: 'settled' as const,
              effectiveMount: { kind: 'native' as const },
            }
          : {
              kind: 'evolved' as const,
              pin: 'settled' as const,
              generationId: 'b'.repeat(64),
              effectiveMount: {
                kind: 'evolved' as const,
                generationId: 'b'.repeat(64),
              },
            },
      },
    })),
  }
}

function generationResult(result: unknown) {
  return {
    resolveGenerationEvidence: vi.fn(async () => result as never),
  }
}

function generationRejecting() {
  return {
    resolveGenerationEvidence: vi.fn(async () => {
      throw new Error('generation-secret')
    }),
  }
}

function routingReturning(workspaceId = WORKSPACE_ID) {
  return {
    resolveRoutingEvidence: vi.fn(async (
      subject: DurableInteractionEpisodeSubjectV1,
      derived: InteractionEpisodeDerivedEvidenceV1,
    ) => ({
      status: 'matched' as const,
      fact: {
        schemaVersion: 1 as const,
        kind: 'interaction-routing-fact-v1' as const,
        workspaceId,
        subject: {
          sessionLifecycleDigest: interactionRoutingSessionLifecycleDigest(subject),
          prefixDigest: subject.transcript.replay.prefixDigest,
          turnDigest: subject.transcript.replay.turnDigest,
          loggedControlDigest: derived.triggerRequestControl.loggedControlDigest,
          turnEndSeq: subject.transcript.source.turnEndSeq,
          triggerRequestSeq: derived.triggerRequestControl.boundary.assistantMessageSeq,
          triggerCallSeq: subject.transcript.source.triggerCallSeq,
          triggerResultSeq: subject.transcript.source.triggerResultSeq,
        },
        routing: {
          rawTrigger: 'successful-gap-report' as const,
          conclusion: 'model-declared-no-applicable-skill' as const,
        },
      },
    })),
  }
}

function routingResult(result: unknown) {
  return {
    resolveRoutingEvidence: vi.fn(async () => result as never),
  }
}

function routingRejecting() {
  return {
    resolveRoutingEvidence: vi.fn(async () => {
      throw new Error('routing-secret')
    }),
  }
}

function deepFreezeForTest<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreezeForTest(child)
  }
  return value
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

function deadlineEffectCount(owner: Context): number {
  return owner.fiber.getEffects().filter(
    effect => effect.label === 'dsh-evolve.interactionEpisode.hostEvidenceSource',
  ).length
}

function resolverFor(
  fixture: Fixture,
  gateway: Gateway,
  generationEvidence?: GenerationEvidence,
  routingEvidence?: RoutingEvidence,
) {
  return createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
    sessions: { get: () => fixture.session, flush: async () => true },
    sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
    gateway,
    ...(generationEvidence === undefined ? {} : { generationEvidence }),
    ...(routingEvidence === undefined ? {} : { routingEvidence }),
  })
}

type Mutable<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends readonly (infer Item)[]
    ? Mutable<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T

function completedGapTurn(): {
  readonly session: Session
  readonly turnEndSeq: number
  readonly stored: SessionEventSuffix
} {
  vi.spyOn(Date, 'now').mockReturnValue(2_000)
  const sessionId = SessionId('gateway-aware-episode-session')
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 1_000,
    cwd: '/private/workspace',
    isSeeded: false,
    agentPreset: 'default',
  })
  const callId = ToolCallId('gap-call')
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
        name: 'report_capability_gap',
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
          name: 'report_capability_gap',
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
        name: 'report_capability_gap',
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
    name: 'report_capability_gap',
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
        isError: false,
        content: [{
          type: 'text' as const,
          text: 'Capability Gap ' + 'a'.repeat(64)
            + ' recorded for release-audit; discovery abstained because no native DSH Goal is active.',
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
