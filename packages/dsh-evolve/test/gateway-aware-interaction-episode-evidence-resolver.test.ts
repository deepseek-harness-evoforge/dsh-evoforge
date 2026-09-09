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
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver,
} from '../src/interaction-episode-evidence-resolver.ts'

afterEach(() => {
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

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

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

type Fixture = ReturnType<typeof completedGapTurn>
type Gateway = Parameters<
  typeof createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver
>[0]['gateway']

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

function gatewayRejecting(): Gateway & {
  readonly resolveIngressEvidence: ReturnType<typeof vi.fn>
} {
  return {
    resolveIngressEvidence: vi.fn(async () => {
      throw new Error('gateway-secret')
    }),
  }
}

function resolverFor(fixture: Fixture, gateway: Gateway) {
  return createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
    sessions: { get: () => fixture.session, flush: async () => true },
    sessionPersistence: { readFrom: async () => structuredClone(fixture.stored) },
    gateway,
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
