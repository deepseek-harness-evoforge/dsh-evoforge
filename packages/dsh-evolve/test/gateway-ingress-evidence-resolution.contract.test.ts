import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import {
  freezeMessage,
  MessageId,
  ToolCallId,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  SessionLogOffset,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SessionEventSuffix } from '@deepseek-ai/dsh-session-persistence'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver as createGatewayAwareResolver,
} from '../src/interaction-episode-evidence-resolver.ts'
import type {
  GatewayIngressEvidenceQueryV1,
  GatewayIngressEvidenceResolutionV1,
  GatewayIngressEvidenceSourceV1,
  GatewayIngressJournal,
  GatewayIngressRecord,
} from 'dsh-evoforge-gateway'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_PATH = '/private/gateway-contract-workspace'
const SESSION_ID = SessionId('gateway-evolve-contract-session')
const INGRESS_ID = sha256('telegram:contract-account:contract-chat:contract-event')
const MESSAGE_ID = MessageId(`channel:${INGRESS_ID}`)
const ORIGINAL_TEXT = 'Find a reusable release audit method.'
const lifecycle = new Context()

type GatewayAwareResolverDependencies = Parameters<typeof createGatewayAwareResolver>[0]

function createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: Omit<GatewayAwareResolverDependencies, 'lifecycle'>,
) {
  return createGatewayAwareResolver({ ...dependencies, lifecycle })
}

afterAll(async () => {
  await lifecycle.fiber.dispose()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Gateway to Evolve ingress evidence contract', () => {
  it('accepts only the exact completed alpha.5 gap turn for a stored Gateway ticket', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const fixture = completedGapTurn(ORIGINAL_TEXT)
    const boundary = await storedGatewayBoundary(fixture)

    try {
      await expect(resolve(fixture, boundary.source)).resolves.toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-unavailable',
        dimensions: [
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

      const changedMessage = completedGapTurn(`${ORIGINAL_TEXT} changed`)
      await expect(resolve(changedMessage, boundary.source)).resolves.toEqual({
        status: 'abstained',
        stage: 'host-evidence',
        reason: 'evidence-conflict',
        dimensions: ['workspace'],
      })
    } finally {
      await boundary.close()
    }
  })
})

function resolve(
  fixture: CompletedGapTurn,
  gateway: GatewayIngressEvidenceSourceV1,
) {
  return createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver({
    sessions: {
      get: id => id === fixture.session.id ? fixture.session : undefined,
      flush: async () => true,
    },
    sessionPersistence: {
      readFrom: async () => structuredClone(fixture.stored),
    },
    gateway,
  }).resolve({
    session: fixture.session,
    turnEndSeq: fixture.turnEndSeq,
    trigger: { callId: 'gap-call' },
  })
}

interface CompletedGapTurn {
  readonly session: Session
  readonly message: UserMessage
  readonly enqueue: SessionEvent<'agent/inbox/spliced'>
  readonly turnEndSeq: number
  readonly stored: SessionEventSuffix
}

function completedGapTurn(text: string): CompletedGapTurn {
  const session = Session.create(SESSION_ID, undefined, {
    version: 0,
    id: SESSION_ID,
    createdAt: 1_000,
    cwd: WORKSPACE_PATH,
    isSeeded: false,
    agentPreset: 'default',
  })
  const callId = ToolCallId('gap-call')
  const message = freezeMessage({
    id: MESSAGE_ID,
    role: 'user' as const,
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text }],
  })
  const enqueue = session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [message],
  })
  session.append('turn/start', { turn: 1 })
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    removedCount: 1,
    inserted: [],
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
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
      id: MessageId('contract-trigger-assistant'),
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
      id: MessageId('contract-gap-result'),
      role: 'user' as const,
      source: { kind: 'tool' as const, callId },
      content: [{
        type: 'tool-result' as const,
        toolCallId: callId,
        isError: false,
        content: [{
          type: 'text' as const,
          text: `Capability Gap ${sha256('release-audit-gap')} recorded for release-audit; discovery abstained because no native DSH Goal is active.`,
        }],
      }],
    }),
  }, {
    sourceEventSeqs: [call.seq],
    surfaceOp: 'append',
  })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  const terminalText = 'The missing capability was recorded.'
  const terminalChunks = [
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'text-delta', index: 0, text: terminalText },
    }),
    session.append('assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: terminalText },
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
      id: MessageId('contract-terminal-assistant'),
      role: 'assistant' as const,
      source: { kind: 'model' as const, provider: 'fixture', model: 'fixture-model' },
      content: [{ type: 'text' as const, text: terminalText }],
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
    message,
    enqueue,
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

async function storedGatewayBoundary(fixture: CompletedGapTurn) {
  const {
    createGatewayIngressEvidenceSource,
    openGatewayIngressJournal,
    openGatewayIngressEvidenceVault,
  } = await gatewayEvidenceInternals()
  const facility = memoryFacility()
  const journal = await openGatewayIngressJournal(facility)
  const vault = await openGatewayIngressEvidenceVault(facility)
  await journal.prepare({
    id: INGRESS_ID,
    routeId: 'telegram-contract',
    workspaceId: WORKSPACE_ID,
    sessionId: String(fixture.session.id),
    eventHash: sha256('telegram-contract-event'),
    contentHash: sha256(ORIGINAL_TEXT),
    kind: 'message',
    now: 1_100,
  })
  const executing = await journal.begin(INGRESS_ID, 1_200)
  await vault.retain({
    status: 'resolved',
    ingress: executing,
    workspace: {
      id: WORKSPACE_ID,
      path: WORKSPACE_PATH,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    session: {
      header: structuredClone(fixture.session.header),
      inheritedEventCount: Number(fixture.session.inheritedEventCount),
    },
    message: fixture.message,
    enqueue: fixture.enqueue,
  })
  await journal.settleMessage(INGRESS_ID, 1_300)

  return {
    source: createGatewayIngressEvidenceSource(vault, journal),
    async close() {
      await vault.close()
      await journal.close()
    },
  }
}

interface TestGatewayIngressEvidenceVault {
  retain(observation: unknown): Promise<void>
  resolve(
    query: GatewayIngressEvidenceQueryV1,
    intentFor: (id: string) => GatewayIngressRecord | undefined,
  ): Promise<GatewayIngressEvidenceResolutionV1>
  close(): Promise<void>
}

interface GatewayEvidenceInternals {
  openGatewayIngressJournal(
    facility: DomainFacility,
  ): Promise<GatewayIngressJournal>
  openGatewayIngressEvidenceVault(
    facility: DomainFacility,
  ): Promise<TestGatewayIngressEvidenceVault>
  createGatewayIngressEvidenceSource(
    vault: TestGatewayIngressEvidenceVault,
    journal: GatewayIngressJournal,
  ): GatewayIngressEvidenceSourceV1
}

async function gatewayEvidenceInternals(): Promise<GatewayEvidenceInternals> {
  const evidenceUrl = new URL(
    '../../dsh-gateway/src/message-ingress-evidence.ts',
    import.meta.url,
  )
  const journalUrl = new URL(
    '../../dsh-gateway/src/ingress-journal.ts',
    import.meta.url,
  )
  const [evidence, journal] = await Promise.all([
    import(evidenceUrl.href),
    import(journalUrl.href),
  ])
  return {
    openGatewayIngressJournal: journal.openGatewayIngressJournal,
    openGatewayIngressEvidenceVault: evidence.openGatewayIngressEvidenceVault,
    createGatewayIngressEvidenceSource: evidence.createGatewayIngressEvidenceSource,
  } as GatewayEvidenceInternals
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  return {
    async open() {
      return {
        name: 'gateway-evolve-contract',
        global: { get: () => ({}), async set() {} },
        table(name: string) {
          let table = tables.get(name)
          if (table === undefined) {
            table = new MemoryTable()
            tables.set(name, table)
          }
          return table
        },
        async close() {},
      }
    },
  } as unknown as DomainFacility
}

class MemoryTable<V> implements KvTable<string, V> {
  private readonly records = new Map<string, V>()

  get size(): number { return this.records.size }
  get(key: string): V | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, V]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  async put(key: string, value: V): Promise<void> {
    this.records.set(key, structuredClone(value))
  }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, transform: (current: V) => V): Promise<V> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    const next = structuredClone(transform(structuredClone(current)))
    this.records.set(key, next)
    return next
  }
}
