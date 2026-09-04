import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'
import { openGatewayOutboundJournal } from '../src/outbound-journal.js'
import { openGatewayPairingAuthority } from '../src/pairing.js'
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
  it('shares one startup promise when resident Host boot races', async () => {
    const host = fakeNativeHost()
    const on = vi.spyOn(host.ctx, 'on')
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    const first = gateway.start()
    const second = gateway.start()
    expect(second).toBe(first)
    await Promise.all([first, second])
    expect(on).toHaveBeenCalledTimes(1)
    expect(gateway.healthSnapshot(Date.now()).lifecycle).toBe('ready')
    await gateway.stop()
  })

  it('removes its session-event listener exactly once when stopped', async () => {
    const host = fakeNativeHost()
    let removals = 0
    vi.spyOn(host.ctx, 'on').mockImplementation(() => () => { removals += 1; return true })
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await gateway.start()
    expect(removals).toBe(0)
    await gateway.stop()
    expect(removals).toBe(1)
    await gateway.stop()
    expect(removals).toBe(1)
  })

  it('cleans up startup resources when Session validation fails', async () => {
    const host = fakeNativeHost()
    host.persisted.set('session-a', {
      meta: { id: 'session-a', cwd: '/work/b', agentPreset: 'standard', version: 0, createdAt: 1 },
      events: [],
    })
    let removals = 0
    vi.spyOn(host.ctx, 'on').mockImplementation(() => () => { removals += 1; return true })
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await expect(gateway.start()).rejects.toThrow("session 'session-a' cwd")
    expect(removals).toBe(1)
    expect(gateway.healthSnapshot(100).lifecycle).toBe('stopping')
    await gateway.stop()
  })

  it('binds an unknown DM to the selected live native Session through the Host control surface', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const pairing = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
      pairing,
    )
    await gateway.start()
    await gateway.dispatch({ endpoint: endpointA, eventId: 'warm-native-session', text: 'local route' })
    const now = Date.now()

    const first = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'unknown-feishu-dm',
      text: 'pair me',
      now,
    })
    if (first.kind !== 'pairing' || first.offer.kind !== 'offered') {
      throw new Error('Gateway did not offer pairing')
    }
    expect(gateway.pendingPairings(now)).toHaveLength(1)

    const pending = gateway.pendingPairings(now)[0]
    if (pending === undefined) throw new Error('Gateway did not retain pending request')
    const receipt = await gateway.approvePairingRequestForSession({
      requestId: pending.requestId,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    })
    expect(receipt).toMatchObject({ workspaceId: 'workspace-a', sessionId: 'session-a' })
    expect(receipt.routeId).toMatch(/^paired-[a-f0-9]{24}$/u)
    expect(gateway.pendingPairings(now + 1)).toEqual([])

    const accepted = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'trusted-feishu-dm',
      text: 'now enter DSH',
      now: now + 1,
    })
    expect(accepted).toMatchObject({ kind: 'message', route: { id: receipt.routeId } })
    expect(host.messages.get('session-a')).toEqual(['local route', 'now enter DSH'])
    expect(gateway.healthSnapshot(now + 1, [receipt.routeId]).routes.items).toEqual([
      expect.objectContaining({ id: receipt.routeId, paired: true }),
    ])
    await expect(gateway.revokePairing('telegram-a')).rejects.toThrow(
      "gateway route 'telegram-a' is configured",
    )

    const revocation = await gateway.revokePairing(receipt.routeId)
    expect(revocation).toMatchObject({
      routeId: receipt.routeId,
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      alreadyRevoked: false,
    })
    await expect(gateway.revokePairing(receipt.routeId)).resolves.toMatchObject({
      routeId: receipt.routeId,
      revokedAt: revocation.revokedAt,
      alreadyRevoked: true,
    })
    const afterRevocation = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'revoked-feishu-dm',
      text: 'must pair again',
      now: now + 2,
    })
    expect(afterRevocation).toMatchObject({ kind: 'pairing', offer: { kind: 'offered' } })
    expect(host.messages.get('session-a')).toEqual(['local route', 'now enter DSH'])
    await gateway.stop()
  })

  it('keeps unknown DMs out of the Agent until a Host pairing approval creates an exact native route', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const pairing = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
      pairing,
    )
    await gateway.start()

    const first = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'first-unknown-dm',
      text: 'hello',
      now: 1_000,
    })
    expect(first).toMatchObject({ kind: 'pairing', offer: { kind: 'offered' } })
    if (first.kind !== 'pairing' || first.offer.kind !== 'offered') {
      throw new Error('Gateway did not offer pairing')
    }
    expect(host.created).toHaveLength(0)

    await gateway.approvePairing({
      adapter: 'feishu',
      accountId: 'app-b',
      code: first.offer.code,
      target: {
        id: 'feishu-b',
        workspaceId: 'workspace-b',
        sessionId: 'session-b',
        agentPreset: 'minimal',
        provider: 'mock',
        model: 'mock-b',
      },
      now: 2_000,
    })
    const accepted = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'second-trusted-dm',
      text: 'hello again',
      now: 2_001,
    })
    expect(accepted).toMatchObject({ kind: 'message', route: { id: 'feishu-b' } })
    expect(host.messages.get('session-b')).toEqual(['hello again'])

    await gateway.stop()
  })

  it('projects redacted route, native Session, and ingress health from the Gateway authority', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const gateway = new DshGateway(host.ctx, routes, journal, await openGatewayOutboundJournal(facility))

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
            sessionId: 'session-b', threadScoped: true, live: false, paired: false,
          },
          {
            id: 'telegram-a', adapter: 'telegram', workspaceId: 'workspace-a',
            sessionId: 'session-a', threadScoped: false, live: false, paired: false,
          },
        ],
      },
      ingress: { total: 0, prepared: 0, executing: 0, settled: 0, uncertain: 0 },
      transports: {
        registrations: 0, connecting: 0, ready: 0, degraded: 0, stopping: 0, items: [],
      },
      outbound: {
        registrations: 0, scheduled: 0, total: 0, prepared: 0, sending: 0, retrying: 0,
        delivered: 0, uncertain: 0, failed: 0,
      },
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

  it('aggregates redacted Adapter transport facts and filters them by exact routes', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    const telegram = gateway.registerTransport({
      adapter: 'telegram',
      accountId: 'bot-a',
      kind: 'telegram-long-poll',
      routeIds: ['telegram-a'],
      initial: { state: 'connecting', observedAt: 70 },
    })
    const feishu = gateway.registerTransport({
      adapter: 'feishu',
      accountId: 'app-b',
      kind: 'official-feishu-websocket',
      routeIds: ['feishu-b'],
      initial: { state: 'connecting', observedAt: 70 },
    })
    telegram.report({ state: 'ready', observedAt: 100, connectedAt: 90, lastInboundAt: 98, lastActivityAt: 99 })
    feishu.report({ state: 'degraded', observedAt: 110, connectedAt: 80, lastErrorAt: 109 })

    expect(gateway.healthSnapshot(120).transports).toEqual({
      registrations: 2,
      connecting: 0,
      ready: 1,
      degraded: 1,
      stopping: 0,
      items: [
        {
          adapter: 'feishu', kind: 'official-feishu-websocket', state: 'degraded',
          routeIds: ['feishu-b'], observedAt: 110, connectedAt: 80, lastErrorAt: 109,
        },
        {
          adapter: 'telegram', kind: 'telegram-long-poll', state: 'ready',
          routeIds: ['telegram-a'], observedAt: 100, connectedAt: 90, lastInboundAt: 98, lastActivityAt: 99,
        },
      ],
    })
    expect(gateway.healthSnapshot(121, ['telegram-a']).transports).toEqual({
      registrations: 1,
      connecting: 0,
      ready: 1,
      degraded: 0,
      stopping: 0,
      items: [{
        adapter: 'telegram', kind: 'telegram-long-poll', state: 'ready',
        routeIds: ['telegram-a'], observedAt: 100, connectedAt: 90, lastInboundAt: 98, lastActivityAt: 99,
      }],
    })
    expect(JSON.stringify(gateway.healthSnapshot(121))).not.toContain('bot-a')
    expect(JSON.stringify(gateway.healthSnapshot(121))).not.toContain('app-b')
    expect(() => gateway.registerTransport({
      adapter: 'telegram', accountId: 'bot-a', kind: 'telegram-long-poll', routeIds: ['telegram-a'],
      initial: { state: 'connecting', observedAt: 121 },
    })).toThrow(/already registered/u)
    expect(() => telegram.report({ state: 'ready', observedAt: 98, lastActivityAt: 99 }))
      .toThrow(/after observation time/u)
    expect(() => gateway.registerTransport({
      adapter: 'telegram', accountId: 'wrong', kind: 'telegram-long-poll', routeIds: ['telegram-a'],
      initial: { state: 'connecting', observedAt: 70 },
    })).toThrow(/does not own route/u)

    feishu.report({ state: 'stopping', observedAt: 130 })
    expect(gateway.healthSnapshot(131, ['feishu-b']).transports.stopping).toBe(1)
    feishu.dispose()
    expect(gateway.healthSnapshot(132, ['feishu-b']).transports.registrations).toBe(0)
    telegram.dispose()
    await gateway.stop()
  })

  it('surfaces recovered ingress uncertainty without replaying the effect', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
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
    const gateway = new DshGateway(host.ctx, routes, journal, await openGatewayOutboundJournal(facility))

    await gateway.start()

    expect(gateway.healthSnapshot(120, ['telegram-a']).ingress).toEqual({
      total: 1, prepared: 0, executing: 0, settled: 0, uncertain: 1,
    })
    expect(host.messages.size).toBe(0)
  })

  it('routes exact endpoints into isolated native Workspace sessions and deduplicates ingress', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const gateway = new DshGateway(host.ctx, routes, journal, await openGatewayOutboundJournal(facility))
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
    expect(journal.list().find(record => record.routeId === 'telegram-a')?.contentHash)
      .toBe(createHash('sha256').update('message a').digest('hex'))
    await expect(gateway.dispatch({ endpoint: endpointA, eventId: 'update-7', text: 'altered' }))
      .rejects.toThrow('content changed')
    await expect(gateway.dispatch({
      endpoint: { ...endpointA, userId: 'someone-else' }, eventId: 'update-8', text: 'denied',
    })).rejects.toThrow('no configured gateway route')
  })

  it('publishes exact native image references without exposing an Adapter resource key', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const image = Object.freeze({
      attachmentId: `sha256:${'a'.repeat(64)}` as never,
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1,
      name: 'diagram.png',
      originalDimensions: { width: 2, height: 2 },
    })

    await gateway.dispatch({
      endpoint: endpointB,
      eventId: 'image-1',
      text: 'Please inspect this image.',
      images: [image],
    })

    expect(host.contents.get('session-b')).toEqual([[
      { type: 'text', text: 'Please inspect this image.' },
      { type: 'image', attachment: image },
    ]])
    expect(JSON.stringify(host.contents)).not.toContain('feishu-image-key')
    await expect(gateway.dispatch({
      endpoint: endpointB,
      eventId: 'image-1',
      text: 'Please inspect this image.',
      images: [{ ...image, bytes: 69 }],
    })).rejects.toThrow('content changed')
    expect(() => gateway.dispatch({ endpoint: endpointB, eventId: 'empty', text: '', images: [] }))
      .toThrow(/content/u)
    await gateway.stop()
  })

  it('executes a native command once and replays only its retained result', async () => {
    const host = fakeNativeHost()
    host.commandLines.add('/goal status')
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const gateway = new DshGateway(host.ctx, routes, journal, await openGatewayOutboundJournal(facility))
    await gateway.start()

    const first = await gateway.dispatch({ endpoint: endpointA, eventId: 'update-8', text: '/goal status' })
    const duplicate = await gateway.dispatch({ endpoint: endpointA, eventId: 'update-8', text: '/goal status' })

    expect(first).toMatchObject({ kind: 'command', duplicate: false, result: { kind: 'success', text: 'goal active' } })
    expect(duplicate).toMatchObject({ kind: 'command', duplicate: true, result: { kind: 'success', text: 'goal active' } })
    expect(host.executed).toEqual([{ sessionId: 'session-a', line: '/goal status' }])
    expect(host.messages.get('session-a')).toBeUndefined()
  })

  it('invokes the rc.2 image-aware native Command signature with an empty image batch', async () => {
    const host = fakeNativeHost()
    host.commandLines.add('/goal status')
    const calls: Array<{ line: string; images: readonly unknown[]; signal: AbortSignal }> = []
    const commands = host.ctx.commands as unknown as {
      execute: (
        agent: Agent,
        line: string,
        images: readonly unknown[],
        signal: AbortSignal,
      ) => Promise<{ commandId: string; result: { kind: 'success'; text: string } }>
    }
    commands.execute = async function executeRc2(_agent, line, images, signal) {
      if (!Array.isArray(images)) throw new Error('rc.2 Command images must be an array')
      if (!(signal instanceof AbortSignal)) throw new Error('rc.2 Command signal is missing')
      calls.push({ line, images, signal })
      return { commandId: 'command-rc2', result: { kind: 'success', text: 'goal active' } }
    }
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    const result = await gateway.dispatch({
      endpoint: endpointA,
      eventId: 'command-rc2',
      text: '/goal status',
    })

    expect(result).toMatchObject({
      kind: 'command',
      duplicate: false,
      result: { kind: 'success', text: 'goal active' },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.line).toBe('/goal status')
    expect(calls[0]?.images).toEqual([])
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    await gateway.stop()
  })

  it('fails closed before binding a persisted Session owned by another Workspace', async () => {
    const host = fakeNativeHost()
    host.persisted.set('session-a', {
      meta: { id: 'session-a', cwd: '/work/b', agentPreset: 'standard', version: 0, createdAt: 1 },
      events: [],
    })
    const facility = memoryFacility()
    const journal = await openGatewayIngressJournal(facility)
    const gateway = new DshGateway(host.ctx, routes, journal, await openGatewayOutboundJournal(facility))

    await expect(gateway.start()).rejects.toThrow("session 'session-a' cwd")
    expect(host.created).toEqual([])
    expect(host.attached.size).toBe(0)
  })

  it('emits one workspace-scoped recovery observation for interrupted journals', async () => {
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    await ingress.prepare({
      id: 'a'.repeat(64),
      routeId: 'telegram-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      eventHash: 'b'.repeat(64),
      contentHash: 'c'.repeat(64),
      kind: 'message',
      now: 100,
    })
    await ingress.begin('a'.repeat(64), 101)
    const outbound = await openGatewayOutboundJournal(facility)
    const prepared = await outbound.prepare({
      routeId: 'telegram-a',
      kind: 'response',
      intentKey: 'response:recovery-observation',
      text: 'recovery evidence',
      now: 100,
    })
    await outbound.begin(prepared.record.id, 101)
    await Promise.all([ingress.close(), outbound.close()])

    const host = fakeNativeHost()
    const gateway = new DshGateway(
      host.ctx,
      routes,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    expect(host.emitted).toContainEqual({
      event: 'evoforge/gateway/recovery',
      value: {
        workspaceId: 'workspace-a',
        ingressRecovered: 1,
        outboundRecovered: 1,
        observedAt: expect.any(Number),
      },
    })
    expect(gateway.recoveryObservations()).toEqual([{
      workspaceId: 'workspace-a',
      ingressRecovered: 1,
      outboundRecovered: 1,
      observedAt: expect.any(Number),
    }])
    await gateway.stop()
  })
})

function fakeNativeHost(): {
  ctx: Context
  attached: Map<string, string[]>
  messages: Map<string, string[]>
  contents: Map<string, unknown[][]>
  created: Array<{ sessionId: string; cwd: string; preset: string; provider: string; model: string }>
  executed: Array<{ sessionId: string; line: string }>
  commandLines: Set<string>
  persisted: Map<string, { meta: Record<string, unknown>; events: unknown[] }>
  emitted: Array<{ event: string; value: Record<string, unknown> }>
} {
  const attached = new Map<string, string[]>()
  const messages = new Map<string, string[]>()
  const contents = new Map<string, unknown[][]>()
  const agents = new Map<string, Agent>()
  const created: Array<{ sessionId: string; cwd: string; preset: string; provider: string; model: string }> = []
  const executed: Array<{ sessionId: string; line: string }> = []
  const commandLines = new Set<string>()
  const persisted = new Map<string, { meta: Record<string, unknown>; events: unknown[] }>()
  const emitted: Array<{ event: string; value: Record<string, unknown> }> = []
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
        const exact = contents.get(sessionId) ?? []
        exact.push(structuredClone(message.content))
        contents.set(sessionId, exact)
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
    on() {},
    emit(event: string, value: Record<string, unknown>) {
      emitted.push({ event, value })
    },
  } as unknown as Context
  return { ctx, attached, messages, contents, created, executed, commandLines, persisted, emitted }
}

function workspace(id: string, path: string, attached: Map<string, string[]>): object {
  return {
    id, path,
    get sessionIds() { return attached.get(id) ?? [] },
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
