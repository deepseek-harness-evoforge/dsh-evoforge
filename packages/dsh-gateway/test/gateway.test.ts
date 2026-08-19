import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'
import { DshGateway } from '../src/gateway.js'
import { resolveGatewayRoutes, type GatewayEndpoint } from '../src/routing.js'

const endpointA: GatewayEndpoint = {
  adapter: 'telegram', accountId: 'bot-a', conversationId: 'chat-a', userId: 'user-a',
}
const endpointB: GatewayEndpoint = {
  adapter: 'feishu', accountId: 'app-b', conversationId: 'chat-b', threadId: 'root-b', userId: 'user-b',
}

const routes = resolveGatewayRoutes([
  { id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a', agentPreset: 'standard', provider: 'mock', model: 'mock-a' },
  { id: 'feishu-b', ...endpointB, workspaceId: 'workspace-b', sessionId: 'session-b', agentPreset: 'minimal', provider: 'mock', model: 'mock-b' },
])

describe('DshGateway', () => {
  it('projects redacted route, native Session, and ingress health from the Gateway authority', async () => {
    const host = fakeNativeHost()
    const journal = await openGatewayIngressJournal(memoryFacility())
    const gateway = new DshGateway(host.ctx, routes, journal)

    expect(gateway.healthSnapshot(90)).toEqual({
      schemaVersion: 1,
      observedAt: 90,
      lifecycle: 'starting',
      routes: {
        total: 2,
        liveSessions: 0,
        items: [
          {
            id: 'feishu-b', adapter: 'feishu', workspaceId: 'workspace-b',
            sessionId: 'session-b', threadScoped: true, live: false,
          },
          {
            id: 'telegram-a', adapter: 'telegram', workspaceId: 'workspace-a',
            sessionId: 'session-a', threadScoped: false, live: false,
          },
        ],
      },
      ingress: { total: 0, prepared: 0, executing: 0, settled: 0, uncertain: 0 },
    })

    await gateway.start()
    await gateway.dispatch({ endpoint: endpointA, eventId: 'update-health', text: 'health check' })
    const snapshot = gateway.healthSnapshot(120, ['telegram-a'])
    expect(snapshot).toMatchObject({
      lifecycle: 'ready',
      routes: {
        total: 1,
        liveSessions: 1,
        items: [{ id: 'telegram-a', adapter: 'telegram', live: true }],
      },
      ingress: { total: 1, prepared: 0, executing: 0, settled: 1, uncertain: 0 },
    })
    expect(JSON.stringify(snapshot)).not.toContain('chat-a')
    expect(JSON.stringify(snapshot)).not.toContain('user-a')
    expect(Object.isFrozen(snapshot.routes.items)).toBe(true)
    expect(() => gateway.healthSnapshot(121, ['missing'])).toThrow("unknown gateway route 'missing'")
    expect(() => gateway.healthSnapshot(121, ['telegram-a', 'telegram-a']))
      .toThrow("duplicate gateway route 'telegram-a'")
    expect(() => gateway.healthSnapshot(-1)).toThrow('observation time')

    const stopping = gateway.stop()
    expect(gateway.healthSnapshot(130).lifecycle).toBe('stopping')
    await stopping
  })

  it('surfaces recovered ingress uncertainty without replaying the effect', async () => {
    const host = fakeNativeHost()
    const journal = await openGatewayIngressJournal(memoryFacility())
    await journal.prepare({
      id: 'a'.repeat(64),
      routeId: 'telegram-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      eventHash: 'b'.repeat(64),
      contentHash: 'c'.repeat(64),
      kind: 'message',
      now: 100,
    })
    await journal.begin('a'.repeat(64), 110)
    const gateway = new DshGateway(host.ctx, routes, journal)

    await gateway.start()

    expect(gateway.healthSnapshot(120, ['telegram-a']).ingress).toEqual({
      total: 1, prepared: 0, executing: 0, settled: 0, uncertain: 1,
    })
    expect(host.messages.size).toBe(0)
  })

  it('routes exact endpoints into isolated native Workspace sessions and deduplicates ingress', async () => {
    const host = fakeNativeHost()
    const journal = await openGatewayIngressJournal(memoryFacility())
    const gateway = new DshGateway(host.ctx, routes, journal)
    await gateway.start()
    const messageId = gateway.messageIdFor(endpointA, 'update-7')

    const [resultA] = await Promise.all([
      gateway.dispatch({ endpoint: endpointA, eventId: 'update-7', text: 'message a' }),
      gateway.dispatch({ endpoint: endpointB, eventId: 'event-7', text: 'message b' }),
    ])
    await gateway.dispatch({ endpoint: endpointA, eventId: 'update-7', text: 'message a' })

    expect(host.messages.get('session-a')).toEqual(['message a'])
    expect(messageId).toBe(`channel:${resultA.ingressId}`)
    expect(host.messages.get('session-b')).toEqual(['message b'])
    expect(host.attached.get('workspace-a')).toEqual(['session-a'])
    expect(host.attached.get('workspace-b')).toEqual(['session-b'])
    expect(host.created).toEqual([
      { sessionId: 'session-a', cwd: '/work/a', preset: 'standard', provider: 'mock', model: 'mock-a' },
      { sessionId: 'session-b', cwd: '/work/b', preset: 'minimal', provider: 'mock', model: 'mock-b' },
    ])
    await expect(gateway.dispatch({ endpoint: endpointA, eventId: 'update-7', text: 'altered' }))
      .rejects.toThrow('content changed')
    await expect(gateway.dispatch({
      endpoint: { ...endpointA, userId: 'someone-else' }, eventId: 'update-8', text: 'denied',
    })).rejects.toThrow('no configured gateway route')
  })

  it('executes a native command once and replays only its retained result', async () => {
    const host = fakeNativeHost()
    host.commandLines.add('/goal status')
    const journal = await openGatewayIngressJournal(memoryFacility())
    const gateway = new DshGateway(host.ctx, routes, journal)
    await gateway.start()

    const first = await gateway.dispatch({ endpoint: endpointA, eventId: 'update-8', text: '/goal status' })
    const duplicate = await gateway.dispatch({ endpoint: endpointA, eventId: 'update-8', text: '/goal status' })

    expect(first).toMatchObject({ kind: 'command', duplicate: false, result: { kind: 'success', text: 'goal active' } })
    expect(duplicate).toMatchObject({ kind: 'command', duplicate: true, result: { kind: 'success', text: 'goal active' } })
    expect(host.executed).toEqual([{ sessionId: 'session-a', line: '/goal status' }])
    expect(host.messages.get('session-a')).toBeUndefined()
  })

  it('fails closed before binding a persisted Session owned by another Workspace', async () => {
    const host = fakeNativeHost()
    host.persisted.set('session-a', {
      meta: { id: 'session-a', cwd: '/work/b', agentPreset: 'standard', version: 0, createdAt: 1 },
      events: [],
    })
    const journal = await openGatewayIngressJournal(memoryFacility())
    const gateway = new DshGateway(host.ctx, routes, journal)

    await expect(gateway.start()).rejects.toThrow("session 'session-a' cwd")
    expect(host.created).toEqual([])
    expect(host.attached.size).toBe(0)
  })
})

function fakeNativeHost(): {
  ctx: Context
  attached: Map<string, string[]>
  messages: Map<string, string[]>
  created: Array<{ sessionId: string; cwd: string; preset: string; provider: string; model: string }>
  executed: Array<{ sessionId: string; line: string }>
  commandLines: Set<string>
  persisted: Map<string, { meta: Record<string, unknown>; events: unknown[] }>
} {
  const attached = new Map<string, string[]>()
  const messages = new Map<string, string[]>()
  const agents = new Map<string, Agent>()
  const created: Array<{ sessionId: string; cwd: string; preset: string; provider: string; model: string }> = []
  const executed: Array<{ sessionId: string; line: string }> = []
  const commandLines = new Set<string>()
  const persisted = new Map<string, { meta: Record<string, unknown>; events: unknown[] }>()
  const workspaces = new Map([
    ['workspace-a', workspace('workspace-a', '/work/a', attached)],
    ['workspace-b', workspace('workspace-b', '/work/b', attached)],
  ])

  const createAgent = (sessionId: string, cwd: string, preset: string, provider: string, model: string): AgentHandle => {
    const inbox: { nextTurn: unknown[]; nextStep: unknown[] } = { nextTurn: [], nextStep: [] }
    const agent = {
      id: sessionId,
      session: { id: sessionId, header: { id: sessionId, cwd, agentPreset: preset }, events: [] },
      inbox,
      ctx: { preset },
      options: { provider, model },
      status: 'idle',
      followup(message: { content: Array<{ text?: string }> }) {
        inbox.nextTurn.push(message)
        const list = messages.get(sessionId) ?? []
        list.push(message.content[0]?.text ?? '')
        messages.set(sessionId, list)
      },
      steer: vi.fn(), inject: vi.fn(), send: vi.fn(), cancel: vi.fn(), whenIdle: vi.fn(), runMaintenance: vi.fn(),
    } as unknown as Agent
    agents.set(sessionId, agent)
    return { agent, async dispose() { agents.delete(sessionId) } }
  }

  const ctx = {
    workspaceRegistry: { get: (id: string) => workspaces.get(id) },
    agentPresets: {
      async resolve(id: string) { return { id } },
      async mount(_ctx: Context, _id: string) {},
      composedPreset(agentCtx: { preset?: string }) { return agentCtx.preset },
    },
    sessionPersistence: {
      async list() { return [...persisted.values()].map(entry => entry.meta) },
      async inspect(id: string) {
        const entry = persisted.get(id)
        if (entry === undefined) throw new Error(`missing persisted session ${id}`)
        return entry
      },
    },
    agents: {
      get: (id: string) => agents.get(id),
      async create(options: { sessionId: string; meta: { cwd: string; agentPreset: string }; agentOptions: { provider: string; model: string }; setup: (ctx: Context) => Promise<void> }) {
        await options.setup({} as Context)
        created.push({ sessionId: options.sessionId, cwd: options.meta.cwd, preset: options.meta.agentPreset, ...options.agentOptions })
        return createAgent(options.sessionId, options.meta.cwd, options.meta.agentPreset, options.agentOptions.provider, options.agentOptions.model)
      },
      async resume(options: { resumeSessionId: string; agentOptions: { provider: string; model: string }; setup: (ctx: Context) => Promise<void> }) {
        const entry = persisted.get(options.resumeSessionId)!
        await options.setup({} as Context)
        return createAgent(options.resumeSessionId, String(entry.meta.cwd), String(entry.meta.agentPreset), options.agentOptions.provider, options.agentOptions.model)
      },
    },
    commands: {
      list: (_agent: Agent) => [...commandLines].map(line => ({ name: line.slice(1).split(' ')[0] })),
      async execute(agent: Agent, line: string) {
        executed.push({ sessionId: String(agent.id), line })
        return { commandId: 'command-1', result: { kind: 'success', text: 'goal active' } }
      },
    },
  } as unknown as Context
  return { ctx, attached, messages, created, executed, commandLines, persisted }
}

function workspace(id: string, path: string, attached: Map<string, string[]>): object {
  return {
    id, path,
    async status() { return 'ok' },
    async attachSession(sessionId: string) {
      const list = attached.get(id) ?? []
      if (!list.includes(sessionId)) list.push(sessionId)
      attached.set(id, list)
    },
  }
}

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  return {
    async open() {
      return {
        name: 'evoforge_gateway',
        global: { get: () => ({}), async set() {} },
        table(name: string) {
          let table = tables.get(name)
          if (table === undefined) { table = new MemoryTable(); tables.set(name, table) }
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
  async put(key: string, value: V): Promise<void> { this.records.set(key, structuredClone(value)) }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, fn: (current: V) => V): Promise<V> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    const next = structuredClone(fn(structuredClone(current)))
    this.records.set(key, next)
    return next
  }
}
