import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { DshGateway } from '../src/gateway.js'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'
import { openGatewayOutboundJournal } from '../src/outbound-journal.js'
import { resolveGatewayRoutes } from '../src/routing.js'

const routes = resolveGatewayRoutes([{
  id: 'telegram-a',
  adapter: 'telegram',
  accountId: 'bot-a',
  conversationId: 'chat-secret',
  userId: 'user-secret',
  workspaceId: 'workspace-a',
  sessionId: 'session-a',
  agentPreset: 'standard',
  provider: 'mock',
  model: 'mock-a',
}])

describe('Gateway outbound text delivery', () => {
  it('persists one intent, honors a proven rate limit, and never resends a settled duplicate', async () => {
    const facility = memoryFacility()
    const host = fakeNativeHost()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const sends: Array<{ routeId: string; text: string; replyToExternalId?: string }> = []
    const outcomes = [
      { kind: 'rate-limited' as const, retryAfterMs: 1 },
      { kind: 'delivered' as const, externalMessageId: 'message-42' },
    ]
    const registration = gateway.registerTextAdapter({
      adapter: 'telegram',
      accountId: 'bot-a',
      routeIds: ['telegram-a'],
      maxAttempts: 3,
      maxRetryAfterMs: 300_000,
      async send(input) {
        sends.push(input)
        return outcomes.shift() ?? { kind: 'uncertain' as const }
      },
    })
    const intent = {
      routeId: 'telegram-a',
      kind: 'notice' as const,
      intentKey: `notice:${'a'.repeat(64)}`,
      text: 'One durable answer.',
      replyToExternalId: '7',
    }

    await expect(registration.submit(intent)).resolves.toMatchObject({
      created: true,
      status: 'prepared',
    })
    await eventually(() => gateway.healthSnapshot().outbound.delivered === 1)
    expect(sends).toEqual([
      { routeId: 'telegram-a', text: 'One durable answer.', replyToExternalId: '7' },
      { routeId: 'telegram-a', text: 'One durable answer.', replyToExternalId: '7' },
    ])
    expect(gateway.healthSnapshot().outbound).toMatchObject({
      registrations: 1,
      scheduled: 0,
      total: 1,
      prepared: 0,
      sending: 0,
      retrying: 0,
      delivered: 1,
      uncertain: 0,
      failed: 0,
      last: {
        routeId: 'telegram-a',
        kind: 'notice',
        status: 'delivered',
        attempts: 2,
      },
    })
    expect(JSON.stringify(gateway.healthSnapshot())).not.toContain('One durable answer.')
    expect(JSON.stringify(gateway.healthSnapshot())).not.toContain('chat-secret')

    await expect(registration.submit(intent)).resolves.toMatchObject({
      created: false,
      status: 'delivered',
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sends).toHaveLength(2)

    await registration.dispose()
    await gateway.stop()
  })

  it('persists a turn intent before completion but sends only after native DSH turn/end', async () => {
    const facility = memoryFacility()
    const host = fakeNativeHost()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const sends: string[] = []
    const registration = gateway.registerTextAdapter({
      adapter: 'telegram',
      accountId: 'bot-a',
      routeIds: ['telegram-a'],
      maxAttempts: 3,
      maxRetryAfterMs: 300_000,
      async send(input) {
        sends.push(input.text)
        return { kind: 'delivered', externalMessageId: 'message-turn-3' }
      },
    })
    const intent = {
      routeId: 'telegram-a',
      kind: 'turn' as const,
      intentKey: 'turn:3',
      text: 'Final native DSH answer.',
      waitForTurnEnd: 3,
    }

    await registration.submit(intent)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sends).toEqual([])
    expect(gateway.healthSnapshot().outbound).toMatchObject({ prepared: 1, delivered: 0 })

    host.events.push({ type: 'turn/end', data: { turn: 3 } })
    await registration.submit(intent)
    await eventually(() => gateway.healthSnapshot().outbound.delivered === 1)
    expect(sends).toEqual(['Final native DSH answer.'])

    await registration.dispose()
    await gateway.stop()
  })

  it('wakes a persisted prepared turn when native turn/end arrives after Gateway restart', async () => {
    const facility = memoryFacility()
    const host = fakeNativeHost()
    const first = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await first.start()
    const firstRegistration = first.registerTextAdapter({
      adapter: 'telegram',
      accountId: 'bot-a',
      routeIds: ['telegram-a'],
      maxAttempts: 1,
      maxRetryAfterMs: 1_000,
      async send() { return { kind: 'uncertain' as const } },
    })
    await firstRegistration.submit({
      routeId: 'telegram-a',
      kind: 'turn',
      intentKey: 'turn:restart:4',
      text: 'Durable answer crossing restart.',
      waitForTurnEnd: 4,
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(first.healthSnapshot().outbound).toMatchObject({ prepared: 1, delivered: 0 })
    await firstRegistration.dispose()
    await first.stop()

    const resumed = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await resumed.start()
    const sends: string[] = []
    const resumedRegistration = resumed.registerTextAdapter({
      adapter: 'telegram',
      accountId: 'bot-a',
      routeIds: ['telegram-a'],
      maxAttempts: 1,
      maxRetryAfterMs: 1_000,
      async send(input) {
        sends.push(input.text)
        return { kind: 'delivered', externalMessageId: 'message-after-restart' }
      },
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(sends).toEqual([])

    host.endTurn(4)
    await eventually(() => resumed.healthSnapshot().outbound.delivered === 1)
    expect(sends).toEqual(['Durable answer crossing restart.'])

    await resumedRegistration.dispose()
    await resumed.stop()
  })

  it('recovers an interrupted send as uncertain and never guesses that replay is safe', async () => {
    const facility = memoryFacility()
    const first = await openGatewayOutboundJournal(facility)
    const prepared = await first.prepare({
      routeId: 'telegram-a',
      kind: 'response',
      intentKey: 'response:update:77',
      text: 'The remote acceptance boundary is unknown.',
      now: 100,
    })
    await first.begin(prepared.record.id, 101)
    await first.close()

    const resumed = await openGatewayOutboundJournal(facility)
    await expect(resumed.recoverInflight(200)).resolves.toBe(1)
    expect(resumed.get(prepared.record.id)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      updatedAt: 200,
      error: expect.stringContaining('automatic retry is disabled'),
    })
    await expect(resumed.prepare({
      routeId: 'telegram-a',
      kind: 'response',
      intentKey: 'response:update:77',
      text: 'The remote acceptance boundary is unknown.',
      now: 201,
    })).resolves.toMatchObject({ created: false, record: { status: 'uncertain' } })
    await resumed.close()
  })

  it('fails closed on intent drift, unsafe identities, and an active-only capacity overflow', async () => {
    const facility = memoryFacility()
    const journal = await openGatewayOutboundJournal(facility, { maxRecords: 1 })
    const input = {
      routeId: 'telegram-a',
      kind: 'notice' as const,
      intentKey: 'notice:stable',
      text: 'Stable content.',
      now: 100,
    }
    await journal.prepare(input)
    await expect(journal.prepare({ ...input, text: 'Drifted content.', now: 101 }))
      .rejects.toThrow(/content or destination changed/u)
    await expect(journal.prepare({ ...input, intentKey: 'notice:unsafe\n', now: 101 }))
      .rejects.toThrow(/intent key/u)
    await expect(journal.prepare({ ...input, intentKey: 'notice:second', now: 101 }))
      .rejects.toThrow(/full of active records/u)
    await journal.close()
  })

  it('registers only an explicit exact route set owned by the Adapter account', async () => {
    const facility = memoryFacility()
    const gateway = new DshGateway(
      fakeNativeHost().ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const base = {
      adapter: 'telegram',
      accountId: 'bot-a',
      maxAttempts: 1,
      maxRetryAfterMs: 1_000,
      async send() { return { kind: 'uncertain' as const } },
    }
    expect(() => gateway.registerTextAdapter({ ...base, routeIds: [] }))
      .toThrow(/1 to 100 exact route ids/u)
    expect(() => gateway.registerTextAdapter({ ...base, routeIds: ['missing'] }))
      .toThrow(/is unknown/u)
    expect(() => gateway.registerTextAdapter({ ...base, accountId: 'other', routeIds: ['telegram-a'] }))
      .toThrow(/does not belong/u)
    const registration = gateway.registerTextAdapter({ ...base, routeIds: ['telegram-a'] })
    await registration.dispose()
    await gateway.stop()
  })

  it('turns a malformed Adapter success into uncertain instead of leaving sending stuck', async () => {
    const facility = memoryFacility()
    const gateway = new DshGateway(
      fakeNativeHost().ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const registration = gateway.registerTextAdapter({
      adapter: 'telegram',
      accountId: 'bot-a',
      routeIds: ['telegram-a'],
      maxAttempts: 1,
      maxRetryAfterMs: 1_000,
      async send() { return { kind: 'delivered', externalMessageId: 'bad\nidentity' } },
    })
    await registration.submit({
      routeId: 'telegram-a',
      kind: 'notice',
      intentKey: 'notice:malformed-success',
      text: 'Do not get stuck.',
    })
    await eventually(() => gateway.healthSnapshot().outbound.uncertain === 1)
    expect(gateway.healthSnapshot().outbound).toMatchObject({ sending: 0, uncertain: 1 })
    await registration.dispose()
    await gateway.stop()
  })
})

async function eventually(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (assertion()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('Gateway outbound delivery did not settle before the test deadline')
}

function fakeNativeHost(): {
  ctx: Context
  events: Array<Record<string, unknown>>
  endTurn(turn: number): void
} {
  const events: Array<Record<string, unknown>> = []
  const sessionEventListeners: Array<(session: Agent['session'], event: Record<string, unknown>) => void> = []
  const agent = {
    id: 'session-a',
    session: {
      id: 'session-a',
      header: { id: 'session-a', cwd: '/work/a', agentPreset: 'standard' },
      events,
    },
    ctx: { preset: 'standard' },
    options: { provider: 'mock', model: 'mock-a' },
  } as unknown as Agent
  const ctx = {
    agents: { get: (id: string) => id === 'session-a' ? agent : undefined },
    agentPresets: {
      async resolve(id: string) { return { id } },
      composedPreset(agentCtx: { preset?: string }) { return agentCtx.preset },
    },
    sessionPersistence: { async list() { return [] } },
    workspaceRegistry: {
      get(id: string) {
        return id === 'workspace-a'
          ? { id, path: '/work/a', async status() { return 'ok' }, async attachSession() {} }
          : undefined
      },
    },
    on(event: string, listener: (session: Agent['session'], value: Record<string, unknown>) => void) {
      if (event === 'session/event') sessionEventListeners.push(listener)
    },
  } as unknown as Context
  return {
    ctx,
    events,
    endTurn(turn: number) {
      const event = { type: 'turn/end', data: { turn } }
      events.push(event)
      for (const listener of sessionEventListeners) listener(agent.session, event)
    },
  }
}

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  return {
    async open() {
      return {
        name: 'evoforge_gateway_test',
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
