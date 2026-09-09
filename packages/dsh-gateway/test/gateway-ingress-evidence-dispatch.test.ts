import type { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  Session,
  SessionId,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import { DshGateway } from '../src/gateway.js'
import {
  createGatewayIngressEvidenceSource,
  openGatewayIngressEvidenceVault,
  type GatewayIngressEvidenceQueryV1,
  type GatewayIngressEvidenceVaultV1,
} from '../src/message-ingress-evidence.js'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'
import { openGatewayOutboundJournal } from '../src/outbound-journal.js'
import { resolveGatewayRoutes, type GatewayEndpoint } from '../src/routing.js'

const endpoint: GatewayEndpoint = {
  adapter: 'telegram',
  accountId: 'bot-a',
  conversationId: 'chat-a',
  userId: 'user-a',
}

const routes = resolveGatewayRoutes([{
  id: 'telegram-a',
  ...endpoint,
  workspaceId: 'workspace-a',
  sessionId: 'session-a',
  agentPreset: 'standard',
  provider: 'mock',
  model: 'mock-a',
}])

describe('Gateway ingress evidence dispatch boundary', () => {
  it('matches the physical enqueue committed by a real alpha.5 Session', async () => {
    const host = createNativeHost()
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const evidence = await openGatewayIngressEvidenceVault(facility)
    const retain = vi.spyOn(evidence, 'retain')
    const source = createGatewayIngressEvidenceSource(evidence, journal)
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      const result = await gateway.dispatch({
        endpoint,
        eventId: 'happy-enqueue',
        text: 'retain this ingress',
        images: [{
          attachmentId: `sha256:${'a'.repeat(64)}` as never,
          mediaType: 'image/png',
          bytes: 256,
          width: 32,
          height: 24,
          name: 'evidence.png',
          originalDimensions: { width: 64, height: 48 },
        }],
      })
      const session = result.agent.session
      const enqueue = messageEnqueues(session)[0]

      expect(session).toBeInstanceOf(Session)
      expect(enqueue).toMatchObject({
        type: 'agent/inbox/spliced',
        seq: 0,
        data: {
          target: 'next-turn',
          start: 0,
          inserted: [{ id: `channel:${result.ingressId}` }],
        },
      })
      expect(Object.isFrozen(enqueue)).toBe(true)
      expect(retain).toHaveBeenCalledOnce()
      await retain.mock.results[0]!.value

      await expect(source.resolveIngressEvidence(queryFor(session, enqueue!))).resolves.toEqual({
        status: 'matched',
        fact: {
          schemaVersion: 1,
          kind: 'gateway-ingress-workspace-fact-v1',
          workspaceId: 'workspace-a',
        },
      })
      expect(gateway.healthSnapshot().ingress).toMatchObject({ settled: 1, uncertain: 0 })
    } finally {
      await gateway.stop()
    }
  })

  it.each(['seq', 'inheritedEventCount'] as const)(
    'rejects a coercible non-number Session %s without coercing it',
    async field => {
      const host = createNativeHost()
      const facility = memoryFacility()
      const journal = await openGatewayIngressJournal(facility)
      const evidence = await openGatewayIngressEvidenceVault(facility)
      const retain = vi.spyOn(evidence, 'retain')
      const gateway = new DshGateway(
        host.ctx,
        routes,
        journal,
        await openGatewayOutboundJournal(facility),
        undefined,
        evidence,
      )
      const nativeBegin = journal.begin.bind(journal)
      const valueOf = vi.fn(() => 0)
      vi.spyOn(journal, 'begin').mockImplementation(async (id, now) => {
        const ingress = await nativeBegin(id, now)
        const session = host.agent('session-a')!.session
        const nativeSnapshot = session.snapshotEvents.bind(session)
        Object.defineProperty(session, 'snapshotEvents', {
          configurable: true,
          value: (...args: Parameters<Session['snapshotEvents']>) => {
            const events = nativeSnapshot(...args)
            Object.defineProperty(session, field, {
              configurable: true,
              value: { valueOf },
            })
            return events
          },
        })
        return ingress
      })
      await gateway.start()

      try {
        await expect(gateway.dispatch({
          endpoint,
          eventId: `coercible-session-${field}`,
          text: 'deliver without coercing an invalid evidence boundary',
        })).resolves.toMatchObject({ kind: 'message', duplicate: false })

        expect(host.agent('session-a')!.inbox.nextTurn).toHaveLength(1)
        expect(retain).not.toHaveBeenCalled()
        expect(valueOf).not.toHaveBeenCalled()
        expect(gateway.healthSnapshot().ingress).toMatchObject({
          settled: 1,
          uncertain: 0,
        })
      } finally {
        await gateway.stop()
      }
    },
  )

  it('selects the native Inbox insertion amid an idle Agent wake and immediate claim', async () => {
    const host = createNativeHost(appendWithNativeIdleWake)
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const evidence = await openGatewayIngressEvidenceVault(facility)
    const retain = vi.spyOn(evidence, 'retain')
    const source = createGatewayIngressEvidenceSource(evidence, journal)
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      const result = await gateway.dispatch({
        endpoint,
        eventId: 'native-inbox-idle-wake',
        text: 'claim me synchronously',
      })
      const session = result.agent.session
      const events = session.snapshotEvents()
      const enqueue = events[0]

      expect(events.map(event => event.type)).toEqual([
        'agent/inbox/spliced',
        'turn/start',
        'agent/inbox/spliced',
      ])
      expect(enqueue?.type).toBe('agent/inbox/spliced')
      expect(events[2]).toMatchObject({
        type: 'agent/inbox/spliced',
        data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] },
      })
      expect(retain).toHaveBeenCalledOnce()
      await retain.mock.results[0]!.value

      await expect(source.resolveIngressEvidence(queryFor(
        session,
        enqueue as SessionEvent<'agent/inbox/spliced'>,
      ))).resolves.toMatchObject({
        status: 'matched',
        fact: { workspaceId: 'workspace-a' },
      })
    } finally {
      await gateway.stop()
    }
  })

  it('keeps the main ingress uncertain and the evidence source unavailable after append-then-throw', async () => {
    const host = createNativeHost(appendThenThrow)
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const evidence = await openGatewayIngressEvidenceVault(facility)
    const retain = vi.spyOn(evidence, 'retain')
    const source = createGatewayIngressEvidenceSource(evidence, journal)
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      const dispatch = {
        endpoint,
        eventId: 'throw-after-enqueue',
        text: 'accepted before wake failure',
      } as const
      const messageId = gateway.messageIdFor(endpoint, dispatch.eventId)

      await expect(gateway.dispatch(dispatch)).rejects.toThrow('wake failed after enqueue')

      const session = host.agent('session-a')!.session
      const enqueue = messageEnqueues(session).find(event =>
        event.data.inserted.some(message => message.id === messageId))
      expect(enqueue).toBeDefined()
      expect(retain).not.toHaveBeenCalled()
      expect(gateway.healthSnapshot().ingress).toMatchObject({ settled: 0, uncertain: 1 })
      await expect(source.resolveIngressEvidence(queryFor(session, enqueue!))).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-unavailable',
      })

      await expect(gateway.dispatch(dispatch)).rejects.toThrow('is uncertain')
    } finally {
      await gateway.stop()
    }
  })

  it('settles delivered ingress but records conflicting evidence for an ambiguous enqueue suffix', async () => {
    const host = createNativeHost(appendAmbiguousSuffix)
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const evidence = await openGatewayIngressEvidenceVault(facility)
    const retain = vi.spyOn(evidence, 'retain')
    const source = createGatewayIngressEvidenceSource(evidence, journal)
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      const result = await gateway.dispatch({
        endpoint,
        eventId: 'ambiguous-enqueue',
        text: 'one delivery with two matching log candidates',
      })
      const session = result.agent.session
      const enqueues = messageEnqueues(session)

      expect(result.agent.inbox.nextTurn).toHaveLength(1)
      expect(enqueues).toHaveLength(2)
      expect(retain).toHaveBeenCalledOnce()
      await retain.mock.results[0]!.value
      expect(gateway.healthSnapshot().ingress).toMatchObject({ settled: 1, uncertain: 0 })
      await expect(source.resolveIngressEvidence(queryFor(session, enqueues[0]!))).resolves.toEqual({
        status: 'abstained',
        reason: 'evidence-conflict',
      })
    } finally {
      await gateway.stop()
    }
  })

  it('does not delay or fail dispatch when evidence retention later rejects', async () => {
    const host = createNativeHost()
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    let rejectRetention!: (reason?: unknown) => void
    const retention = new Promise<void>((_resolve, reject) => {
      rejectRetention = reject
    })
    let retentionSettled = false
    void retention.then(
      () => { retentionSettled = true },
      () => { retentionSettled = true },
    )
    const retain = vi.fn(() => retention)
    const evidence: GatewayIngressEvidenceVaultV1 = {
      retain,
      resolve: async () => Object.freeze({
        status: 'abstained',
        reason: 'evidence-unavailable',
      }),
      close: vi.fn(async () => {}),
    }
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      await expect(gateway.dispatch({
        endpoint,
        eventId: 'retention-failure',
        text: 'delivery is independent of auxiliary evidence',
      })).resolves.toMatchObject({ kind: 'message', duplicate: false })

      expect(retain).toHaveBeenCalledOnce()
      expect(retentionSettled).toBe(false)
      expect(gateway.healthSnapshot().ingress).toMatchObject({ settled: 1, uncertain: 0 })

      rejectRetention(new Error('evidence backend unavailable'))
      await vi.waitFor(() => {
        expect(host.warn).toHaveBeenCalledWith(expect.stringContaining(
          'could not retain ingress evidence: evidence backend unavailable',
        ))
      })
    } finally {
      await gateway.stop()
    }
  })

  it('delivers without evidence when the auxiliary Workspace witness disappears before enqueue', async () => {
    const host = createNativeHost(appendOneEnqueue, 2)
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const evidence = await openGatewayIngressEvidenceVault(facility)
    const retain = vi.spyOn(evidence, 'retain')
    const gateway = new DshGateway(
      host.ctx,
      routes,
      journal,
      await openGatewayOutboundJournal(facility),
      undefined,
      evidence,
    )
    await gateway.start()

    try {
      await expect(gateway.dispatch({
        endpoint,
        eventId: 'workspace-witness-disappeared',
        text: 'delivery must not depend on auxiliary evidence',
      })).resolves.toMatchObject({ kind: 'message', duplicate: false })

      expect(host.agent('session-a')?.inbox.nextTurn).toHaveLength(1)
      expect(retain).not.toHaveBeenCalled()
      expect(gateway.healthSnapshot().ingress).toMatchObject({ settled: 1, uncertain: 0 })
    } finally {
      await gateway.stop()
    }
  })
})

interface FollowupContext {
  readonly session: Session
  readonly inbox: { readonly nextTurn: UserMessage[]; readonly nextStep: UserMessage[] }
  readonly message: UserMessage
}

type FollowupBehavior = (context: FollowupContext) => void

interface CreateAgentOptions {
  readonly sessionId: string
  readonly meta: { readonly cwd: string; readonly agentPreset: string }
  readonly agentOptions: { readonly provider: string; readonly model: string; readonly maxTokens?: number }
  readonly setup: (ctx: Context) => Promise<void>
}

function createNativeHost(
  followup: FollowupBehavior = appendOneEnqueue,
  workspaceReadsBeforeMissing = Number.POSITIVE_INFINITY,
): {
  readonly ctx: Context
  readonly agent: (sessionId: string) => Agent | undefined
  readonly warn: ReturnType<typeof vi.fn>
} {
  const agents = new Map<string, Agent>()
  const attached = new Set<string>()
  let workspaceReads = 0
  const warn = vi.fn()
  const workspace = {
    id: 'workspace-a',
    path: '/work/a',
    title: 'workspace-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    get sessionIds() { return [...attached].map(SessionId) },
    async status() { return 'ok' as const },
    async attachSession(sessionId: string) { attached.add(String(sessionId)) },
  }

  const createAgent = (
    sessionId: string,
    cwd: string,
    preset: string,
    provider: string,
    model: string,
  ): AgentHandle => {
    const id = SessionId(sessionId)
    const session = Session.create(id, undefined, {
      version: 0,
      id,
      createdAt: 1,
      cwd,
      isSeeded: false,
      agentPreset: preset,
    })
    const inbox = { nextTurn: [] as UserMessage[], nextStep: [] as UserMessage[] }
    const agent = {
      id,
      session,
      inbox,
      ctx: { preset },
      options: { provider, model },
      status: 'idle',
      followup(message: UserMessage) { followup({ session, inbox, message }) },
      steer: vi.fn(),
      inject: vi.fn(),
      send: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(),
      runMaintenance: vi.fn(),
    } as unknown as Agent
    agents.set(sessionId, agent)
    return {
      agent,
      async dispose() { agents.delete(sessionId) },
    }
  }

  const ctx = {
    workspaceRegistry: {
      get: (id: string) => {
        workspaceReads += 1
        return id === 'workspace-a' && workspaceReads <= workspaceReadsBeforeMissing
          ? workspace
          : undefined
      },
    },
    agentPresets: {
      async resolve(id: string) { return { id } },
      async mount(_ctx: Context, _id: string) {},
      composedPreset(agentCtx: { preset?: string }) { return agentCtx.preset },
    },
    sessionPersistence: {
      async list() { return [] },
      async inspect() { throw new Error('unexpected persistence inspection') },
    },
    agents: {
      get: (id: string) => agents.get(String(id)),
      async create(options: CreateAgentOptions) {
        await options.setup({} as Context)
        return createAgent(
          String(options.sessionId),
          options.meta.cwd,
          options.meta.agentPreset,
          options.agentOptions.provider,
          options.agentOptions.model,
        )
      },
      async resume() { throw new Error('unexpected Agent resume') },
    },
    sessions: { get: (id: string) => agents.get(String(id))?.session },
    commands: {
      list() { return [] },
      async execute() { throw new Error('unexpected command execution') },
    },
    logger: { warn },
    on: vi.fn(() => () => {}),
    emit: vi.fn(),
  } as unknown as Context

  return { ctx, agent: sessionId => agents.get(sessionId), warn }
}

function appendOneEnqueue({ session, inbox, message }: FollowupContext): void {
  const event = session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: inbox.nextTurn.length,
    inserted: [message],
  })
  inbox.nextTurn.push(event.data.inserted[0]!)
}

function appendThenThrow(context: FollowupContext): void {
  appendOneEnqueue(context)
  throw new Error('wake failed after enqueue')
}

function appendWithNativeIdleWake({ session, message }: FollowupContext): void {
  const inbox = new Inbox(session, {
    inserted() {},
    discarded() {},
    claimed() {},
  })
  inbox.append('next-turn', message)
  session.append('turn/start', { turn: 1 })
  inbox.claim('next-turn', 1)
}

function appendAmbiguousSuffix({ session, inbox, message }: FollowupContext): void {
  appendOneEnqueue({ session, inbox, message })
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: inbox.nextTurn.length,
    inserted: [message],
  })
}

function messageEnqueues(session: Session): SessionEvent<'agent/inbox/spliced'>[] {
  return session.snapshotEvents().filter(
    (event): event is SessionEvent<'agent/inbox/spliced'> =>
      event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0,
  )
}

function queryFor(
  session: Session,
  enqueue: SessionEvent<'agent/inbox/spliced'>,
): GatewayIngressEvidenceQueryV1 {
  return {
    schemaVersion: 1,
    kind: 'gateway-ingress-evidence-query-v1',
    session: {
      header: structuredClone(session.header),
      inheritedEventCount: Number(session.inheritedEventCount),
    },
    enqueue,
  }
}

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  return {
    async open() {
      return {
        name: 'evoforge_gateway_dispatch_evidence_test',
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
