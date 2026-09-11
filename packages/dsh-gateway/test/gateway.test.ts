import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  Session,
  SessionId,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'
import type { GatewayIngressEvidenceVaultV1 } from '../src/message-ingress-evidence.js'
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
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const sourceDshVersion = JSON.parse(readFileSync(
  join(dshSourceDir, 'packages', 'core', 'session', 'package.json'),
  'utf8',
)) as { readonly version?: unknown }
const isCurrentDsh = sourceDshVersion.version === '0.1.5-rc.2'

describe('DshGateway', () => {
  it.skipIf(!isCurrentDsh)('validates an event-selected preset through the real current JSONL read handle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-current-persistence-'))
    const entry = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [cordis, sessionPackage, jsonlPackage] = await Promise.all([
      import(pathToFileURL(join(dshSourceDir, 'vendor', 'cordis', 'lib', 'index.js')).href),
      import(entry('core/session')),
      import(entry('session/session-persistence-jsonl')),
    ])
    const ctx = new cordis.Context() as Context
    try {
      await ctx.plugin(sessionPackage.default)
      await ctx.plugin(jsonlPackage.default, { root: join(root, 'sessions'), compression: 'none' })
      const id = sessionPackage.SessionId('session-a')
      const header = {
        version: 3,
        id,
        createdAt: 1,
        cwd: '/work/a',
        isSeeded: false,
        delegationDepth: 0,
        agentPreset: 'minimal',
      }
      const session = sessionPackage.Session.create(id, [], header)
      session.append('agent-preset/selected', { agentPreset: 'standard' })
      const handle = await (ctx.sessionPersistence as unknown as {
        create(header: unknown): Promise<{
          append(events: readonly unknown[]): Promise<void>
          flush(): Promise<void>
          close(): Promise<void>
        }>
      }).create(header)
      await handle.append(session.snapshotEvents())
      await handle.flush()
      await handle.close()
      Object.defineProperties(ctx, {
        workspaceRegistry: { configurable: true, value: {
          get: (workspaceId: string) => workspaceId === 'workspace-a'
            ? { id: workspaceId, path: '/work/a', status: async () => 'ok' }
            : undefined,
        } },
        agents: { configurable: true, value: { get: () => undefined } },
        agentPresets: { configurable: true, value: {
          resolve: async (preset: string) => ({ id: preset }),
          composedPreset: () => undefined,
        } },
        commands: { configurable: true, value: { list: () => [] } },
      })
      const facility = memoryFacility()
      const gateway = new DshGateway(
        ctx,
        resolveGatewayRoutes([{
          id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
          agentPreset: 'standard', provider: 'mock', model: 'mock-a',
        }]),
        await openGatewayIngressJournal(facility),
        await openGatewayOutboundJournal(facility),
      )

      await expect(gateway.start()).resolves.toBeUndefined()
      await gateway.stop()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

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

  it('fails closed when a stopped resident Gateway is started again', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await gateway.start()
    await gateway.stop()
    await expect(gateway.start()).rejects.toThrow('DSH gateway is stopping')
    expect(gateway.healthSnapshot(Date.now()).lifecycle).toBe('stopping')
  })

  it('cancels an in-flight startup before closing resident resources', async () => {
    const host = fakeNativeHost()
    let releaseList!: () => void
    let reachedList!: () => void
    const listReached = new Promise<void>(resolve => { reachedList = resolve })
    const listReleased = new Promise<void>(resolve => { releaseList = resolve })
    vi.spyOn(host.ctx.sessionPersistence, 'list').mockImplementation(async () => {
      reachedList()
      await listReleased
      return []
    })
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    const closeIngress = vi.spyOn(ingress, 'close')
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([]),
      ingress,
      await openGatewayOutboundJournal(facility),
    )

    const starting = gateway.start()
    await listReached
    const stopping = gateway.stop()
    await Promise.resolve()
    expect(closeIngress).not.toHaveBeenCalled()

    releaseList()
    await expect(starting).rejects.toThrow('DSH gateway is stopping')
    await expect(stopping).resolves.toBeUndefined()
    expect(closeIngress).toHaveBeenCalledTimes(1)
  })

  it('coalesces cleanup when startup cancellation races a later validation failure', async () => {
    const host = fakeNativeHost()
    host.persisted.set('session-a', {
      meta: { id: 'session-a', cwd: '/work/b', agentPreset: 'standard', version: 0, createdAt: 1 },
      events: [],
    })
    let releaseList!: () => void
    let reachedList!: () => void
    const listReached = new Promise<void>(resolve => { reachedList = resolve })
    const listReleased = new Promise<void>(resolve => { releaseList = resolve })
    vi.spyOn(host.ctx.sessionPersistence, 'list').mockImplementation(async () => {
      reachedList()
      await listReleased
      return [...host.persisted.values()].map(entry => entry.meta) as unknown as SessionHeader[]
    })
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    const closeIngress = vi.spyOn(ingress, 'close')
    const gateway = new DshGateway(
      host.ctx,
      routes,
      ingress,
      await openGatewayOutboundJournal(facility),
    )

    const starting = gateway.start()
    await listReached
    const stopping = gateway.stop()
    releaseList()

    await expect(starting).rejects.toThrow('DSH gateway is stopping')
    await expect(stopping).resolves.toBeUndefined()
    expect(closeIngress).toHaveBeenCalledTimes(1)
  })

  it('waits for a direct Agent resolution before closing resident resources', async () => {
    const host = fakeNativeHost()
    let releaseCreate!: () => void
    let createEntered!: () => void
    const createReached = new Promise<void>(resolve => { createEntered = resolve })
    const createReleased = new Promise<void>(resolve => { releaseCreate = resolve })
    const originalCreate = host.ctx.agents.create.bind(host.ctx.agents)
    let createdHandle: AgentHandle | undefined
    vi.spyOn(host.ctx.agents, 'create').mockImplementation(async options => {
      createEntered()
      await createReleased
      const handle = await originalCreate(options)
      vi.spyOn(handle, 'dispose')
      createdHandle = handle
      return handle
    })
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    const closeIngress = vi.spyOn(ingress, 'close')
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      ingress,
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    const resolving = gateway.resolve('telegram-a')
    await createReached
    const stopping = gateway.stop()
    await Promise.resolve()
    expect(closeIngress).not.toHaveBeenCalled()

    releaseCreate()
    await resolving
    await stopping
    expect(createdHandle).toBeDefined()
    expect(vi.mocked(createdHandle!.dispose)).toHaveBeenCalledTimes(1)
  })

  it('preserves the startup validation error when cleanup itself fails', async () => {
    const host = fakeNativeHost()
    host.persisted.set('session-a', {
      meta: { id: 'session-a', cwd: '/work/b', agentPreset: 'standard', version: 0, createdAt: 1 },
      events: [],
    })
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    vi.spyOn(ingress, 'close').mockRejectedValue(new Error('ingress close failed'))
    const gateway = new DshGateway(
      host.ctx,
      routes,
      ingress,
      await openGatewayOutboundJournal(facility),
    )

    await expect(gateway.start()).rejects.toThrow("session 'session-a' cwd")
    await expect(gateway.stop()).rejects.toThrow('ingress close failed')
  })

  it('finishes every resident cleanup before reporting teardown failures', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    const outbound = await openGatewayOutboundJournal(facility)
    const pairing = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })
    const outboundFailure = new Error('outbound close failed')
    const evidenceFailure = new Error('evidence close failed')
    vi.spyOn(outbound, 'close').mockRejectedValue(outboundFailure)

    let releaseHandle!: () => void
    const handleReleased = new Promise<void>(resolve => { releaseHandle = resolve })
    let createdHandle: AgentHandle | undefined
    const createAgent = host.ctx.agents.create.bind(host.ctx.agents)
    vi.spyOn(host.ctx.agents, 'create').mockImplementation(async options => {
      const handle = await createAgent(options)
      const dispose = handle.dispose.bind(handle)
      vi.spyOn(handle, 'dispose').mockImplementation(async () => {
        await handleReleased
        await dispose()
      })
      createdHandle = handle
      return handle
    })

    let releaseIngress!: () => void
    const ingressReleased = new Promise<void>(resolve => { releaseIngress = resolve })
    const closeIngress = vi.spyOn(ingress, 'close').mockImplementation(async () => {
      await ingressReleased
    })
    let releaseEvidence!: () => void
    const evidenceReleased = new Promise<void>(resolve => { releaseEvidence = resolve })
    const closeEvidence = vi.fn(async () => {
      await evidenceReleased
      throw evidenceFailure
    })
    const evidence: GatewayIngressEvidenceVaultV1 = {
      async retain() {},
      async resolve() { return { status: 'abstained', reason: 'evidence-unavailable' } },
      close: closeEvidence,
    }
    let releasePairing!: () => void
    const pairingReleased = new Promise<void>(resolve => { releasePairing = resolve })
    const closePairing = vi.spyOn(pairing, 'close').mockImplementation(async () => {
      await pairingReleased
    })
    const gateway = new DshGateway(
      host.ctx,
      routes,
      ingress,
      outbound,
      pairing,
      evidence,
    )
    await gateway.start()
    await gateway.resolve('telegram-a')
    expect(createdHandle).toBeDefined()
    const transport = gateway.registerTransport({
      adapter: 'telegram',
      accountId: 'bot-a',
      kind: 'long-poll',
      routeIds: ['telegram-a'],
      initial: { state: 'ready', observedAt: 1, connectedAt: 1 },
    })

    let stopSettled = false
    const outcome = gateway.stop().then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    void outcome.then(() => { stopSettled = true })

    await vi.waitFor(() => {
      expect(outbound.close).toHaveBeenCalledOnce()
      expect(createdHandle!.dispose).toHaveBeenCalledOnce()
    })
    expect(() => transport.report({ state: 'stopping', observedAt: 2 }))
      .toThrow('Gateway transport registration is disposed')
    expect(closeIngress).not.toHaveBeenCalled()
    expect(stopSettled).toBe(false)

    releaseHandle()
    await vi.waitFor(() => {
      expect(closeIngress).toHaveBeenCalledOnce()
      expect(closeEvidence).toHaveBeenCalledOnce()
      expect(closePairing).toHaveBeenCalledOnce()
    })
    expect(stopSettled).toBe(false)

    releaseIngress()
    releaseEvidence()
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    releasePairing()
    const result = await outcome
    expect(stopSettled).toBe(true)
    expect(result.status).toBe('rejected')
    if (result.status !== 'rejected') throw new Error('Gateway teardown unexpectedly resolved')
    expect(result.error).toBeInstanceOf(AggregateError)
    expect((result.error as AggregateError).errors).toEqual([
      outboundFailure,
      evidenceFailure,
    ])
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

  it('does not invoke pairing authority after stop begins during target validation', async () => {
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
    const offer = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'late-pairing-offer',
      text: 'pair me',
      now: 1_000,
    })
    if (offer.kind !== 'pairing' || offer.offer.kind !== 'offered') {
      throw new Error('Gateway did not offer pairing')
    }
    const status = deferred<'ok'>()
    const workspaceB = host.ctx.workspaceRegistry.get('workspace-b' as never)
    if (workspaceB === undefined) throw new Error('missing fixture Workspace')
    const statusCall = vi.spyOn(workspaceB, 'status').mockImplementation(() => status.promise)
    const approve = vi.spyOn(pairing, 'approve')

    const approving = gateway.approvePairing({
      adapter: 'feishu',
      accountId: 'app-b',
      code: offer.offer.code,
      target: {
        id: 'late-feishu-route',
        workspaceId: 'workspace-b',
        sessionId: 'session-b',
        agentPreset: 'minimal',
        provider: 'mock',
        model: 'mock-b',
      },
      now: 2_000,
    })
    await vi.waitFor(() => expect(statusCall).toHaveBeenCalledOnce())

    const stopping = gateway.stop()
    status.resolve('ok')

    await expect(approving).rejects.toThrow('DSH gateway is stopping')
    expect(approve).not.toHaveBeenCalled()
    await expect(stopping).resolves.toBeUndefined()
  })

  it('rejects a pairing grant that would give one Session incompatible model ownership', async () => {
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
    const offer = await gateway.accept({
      endpoint: endpointB,
      chatKind: 'direct',
      eventId: 'conflicting-session-owner',
      text: 'pair me',
      now: 1_000,
    })
    if (offer.kind !== 'pairing' || offer.offer.kind !== 'offered') {
      throw new Error('Gateway did not offer pairing')
    }
    const approve = vi.spyOn(pairing, 'approve')

    await expect(gateway.approvePairing({
      adapter: 'feishu',
      accountId: 'app-b',
      code: offer.offer.code,
      target: {
        id: 'conflicting-owner',
        workspaceId: 'workspace-a',
        sessionId: 'session-a',
        agentPreset: 'standard',
        provider: 'mock',
        model: 'different-model',
      },
      now: 2_000,
    })).rejects.toThrow("Session 'session-a' cannot use incompatible")
    expect(approve).not.toHaveBeenCalled()
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

  it('rejects a structurally forged route before persistence or Agent creation', async () => {
    const host = fakeNativeHost()
    const facility = memoryFacility()
    const routeSet = resolveGatewayRoutes([{
      id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
      agentPreset: 'standard', provider: 'mock', model: 'mock-a',
    }])
    const gateway = new DshGateway(
      host.ctx,
      routeSet,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    const list = vi.spyOn(host.ctx.sessionPersistence, 'list')
    await gateway.start()
    list.mockClear()
    const canonical = routeSet.byId.get('telegram-a')
    if (canonical === undefined) throw new Error('missing canonical route fixture')

    await expect(gateway.resolve({ ...canonical, model: 'forged-model' }))
      .rejects.toThrow("route 'telegram-a' is stale or not authoritative")
    expect(list).not.toHaveBeenCalled()
    expect(host.created).toHaveLength(0)
    await gateway.stop()
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

  it('validates a persisted Session through the current read-result envelope', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'minimal', version: 0, createdAt: 1,
    }
    const events = [{
      type: 'agent-preset/selected',
      seq: 0,
      time: 1,
      data: { agentPreset: 'standard' },
    }]
    host.persisted.set('session-a', { meta, events })
    const read = vi.fn(async () => ({ eventState: 'detached', events }))
    const close = vi.fn(async () => {})
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    const list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    const open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read,
      close,
    }))
    persistence.list = list
    persistence.open = open
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await expect(gateway.start()).resolves.toBeUndefined()
    expect(list).toHaveBeenCalledOnce()
    const listCalls = list.mock.calls as unknown as unknown[][]
    const openCalls = open.mock.calls as unknown as unknown[][]
    const listSignal = (listCalls[0]?.[0] as { signal?: unknown } | undefined)?.signal
    const operationSignal = (openCalls[0]?.[2] as { signal?: unknown } | undefined)?.signal
    expect(listSignal).toBeInstanceOf(AbortSignal)
    expect(operationSignal).toBeInstanceOf(AbortSignal)
    expect(open).toHaveBeenCalledWith(
      SessionId('session-a'),
      'read',
      { signal: operationSignal },
    )
    expect(read).toHaveBeenCalledWith(
      0,
      Number.MAX_SAFE_INTEGER,
      { signal: operationSignal },
    )
    expect(read).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    await gateway.stop()
  })

  it('does not let a stale current Session header override the latest persisted preset event', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const events = [{
      type: 'agent-preset/selected',
      seq: 0,
      time: 1,
      data: { agentPreset: 'minimal' },
    }]
    const close = vi.fn(async () => {})
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => ({ eventState: 'detached', events }),
      close,
    }))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await expect(gateway.start()).rejects.toThrow("preset is 'minimal', expected 'standard'")
    expect(close).toHaveBeenCalledOnce()
  })

  it('preserves a current Session read failure when closing the handle also fails', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const readFailure = new Error('read failed first')
    const closeFailure = new Error('close failed second')
    const close = vi.fn(async () => { throw closeFailure })
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => { throw readFailure },
      close,
    }))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await expect(gateway.start()).rejects.toBe(readFailure)
    expect(close).toHaveBeenCalledOnce()
    await expect(gateway.stop()).rejects.toBe(closeFailure)
  })

  it('joins current handle close after a read failure before settling startup', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const readFailure = new Error('read failed before deferred close')
    const closing = deferred<void>()
    const close = vi.fn(() => closing.promise)
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => { throw readFailure },
      close,
    }))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    const starting = gateway.start()
    let settled = false
    void starting.then(
      () => { settled = true },
      () => { settled = true },
    )
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    closing.resolve(undefined)
    await expect(starting).rejects.toBe(readFailure)
    await expect(gateway.stop()).resolves.toBeUndefined()
  })

  it.each(['close', 'timeout'] as const)('preserves a current Session read failure through shutdown %s', async (outcome) => {
    vi.useFakeTimers()
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const readFailure = new Error('read failed before hung close')
    const closing = deferred<void>()
    const close = vi.fn(() => closing.promise)
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => { throw readFailure },
      close,
    }))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    try {
      const starting = gateway.start()
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())

      await vi.advanceTimersByTimeAsync(30_000)

      await expect(starting).rejects.toBe(readFailure)
      let stopped = false
      const stopping = gateway.stop().finally(() => { stopped = true })
      void stopping.catch(() => undefined)
      await Promise.resolve()
      expect(stopped).toBe(false)
      if (outcome === 'close') {
        closing.resolve(undefined)
        await expect(stopping).resolves.toBeUndefined()
      } else {
        await vi.advanceTimersByTimeAsync(30_000)
        await expect(stopping).rejects.toThrow('handle cleanup timed out')
        closing.resolve(undefined)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes current list and read cancellation in option envelopes during cold resolution', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const events: unknown[] = []
    host.persisted.set('session-a', { meta, events })
    const list = vi.fn(async (...args: unknown[]) => [{ header: meta, revision: 'fixture:1' }])
    const read = vi.fn(async () => ({ eventState: 'detached', events }))
    const close = vi.fn(async () => {})
    const open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read,
      close,
    }))
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = list
    persistence.open = open
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const controller = new AbortController()

    await gateway.resolve('telegram-a', controller.signal)

    const startupSignal = (list.mock.calls[0]?.[0] as { signal?: unknown } | undefined)?.signal
    const resolutionSignal = (list.mock.calls[1]?.[0] as { signal?: unknown } | undefined)?.signal
    const readSignal = ((open.mock.calls as unknown as unknown[][]).at(-1)?.[2] as {
      signal?: unknown
    } | undefined)?.signal
    expect(startupSignal).toBeInstanceOf(AbortSignal)
    expect(resolutionSignal).toBeInstanceOf(AbortSignal)
    expect(resolutionSignal).not.toBe(controller.signal)
    expect(readSignal).toBeInstanceOf(AbortSignal)
    expect(open).toHaveBeenLastCalledWith(SessionId('session-a'), 'read', { signal: readSignal })
    expect(read).toHaveBeenLastCalledWith(0, Number.MAX_SAFE_INTEGER, { signal: readSignal })
    expect(close).toHaveBeenCalledTimes(2)
    await gateway.stop()
  })

  it('bounds an ignored current open and closes its late handle exactly once', async () => {
    vi.useFakeTimers()
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const lateOpen = deferred<{
      id: string
      header: typeof meta
      inheritedEventCount: number
      access: string
      read: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }>()
    const read = vi.fn(async () => ({ eventState: 'detached', events: [] }))
    const close = vi.fn(async () => {})
    const open = vi.fn(() => lateOpen.promise)
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = open
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    try {
      const starting = gateway.start()
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())

      await vi.advanceTimersByTimeAsync(30_000)
      await expect(starting).rejects.toThrow("Gateway persisted Session 'session-a' read timed out")
      await expect(gateway.stop()).resolves.toBeUndefined()

      lateOpen.resolve({
        id: SessionId('session-a'),
        header: meta,
        inheritedEventCount: 0,
        access: 'read',
        read,
        close,
      })
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
      expect(read).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes a malformed current handle and rejects mixed persistence dialects', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const close = vi.fn(async () => {})
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => [{ header: meta, revision: 'fixture:1' }])
    persistence.open = vi.fn(async () => ({
      id: SessionId('some-other-session'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => ({ eventState: 'detached', events: [] }),
      close,
    }))
    const facility = memoryFacility()
    const routeSet = resolveGatewayRoutes([{
      id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
      agentPreset: 'standard', provider: 'mock', model: 'mock-a',
    }])
    const malformed = new DshGateway(
      host.ctx,
      routeSet,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )

    await expect(malformed.start()).rejects.toThrow('wrong handle')
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())

    persistence.inspect = vi.fn(async () => ({ meta, events: [] }))
    const mixed = new DshGateway(
      host.ctx,
      routeSet,
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await expect(mixed.start()).rejects.toThrow('exactly one inspect/open')
  })

  it('propagates caller cancellation into a pending current persistence list', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    host.persisted.set('session-a', { meta, events: [] })
    const pendingList = deferred<readonly unknown[]>()
    let operationSignal: AbortSignal | undefined
    let listCalls = 0
    const list = vi.fn((options: { signal?: AbortSignal }) => {
      listCalls += 1
      if (listCalls === 1) return Promise.resolve([{ header: meta, revision: 'fixture:1' }])
      operationSignal = options.signal
      return pendingList.promise
    })
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = list
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => ({ eventState: 'detached', events: [] }),
      close: async () => {},
    }))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const controller = new AbortController()
    const reason = new Error('caller stopped waiting')

    const resolution = gateway.resolve('telegram-a', controller.signal)
    await vi.waitFor(() => expect(operationSignal).toBeInstanceOf(AbortSignal))
    controller.abort(reason)

    await expect(resolution).rejects.toBe(reason)
    expect(operationSignal?.aborted).toBe(true)
    await expect(gateway.stop()).resolves.toBeUndefined()
    pendingList.resolve([])
  })

  it('does not let a cancelled zero-waiter resolution poison an immediate retry', async () => {
    const host = fakeNativeHost()
    const abandonedList = deferred<readonly unknown[]>()
    let listCalls = 0
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(() => {
      listCalls += 1
      if (listCalls === 2) return abandonedList.promise
      return Promise.resolve([])
    })
    persistence.open = vi.fn(() => Promise.reject(new Error('unexpected persistence open')))
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const controller = new AbortController()
    const reason = new Error('sole waiter abandoned resolution')
    const first = gateway.resolve('telegram-a', controller.signal)
    await vi.waitFor(() => expect(listCalls).toBe(2))
    let retry: Promise<Agent> | undefined
    controller.signal.addEventListener('abort', () => {
      retry = gateway.resolve('telegram-a')
    }, { once: true })

    controller.abort(reason)

    await expect(first).rejects.toBe(reason)
    expect(retry).toBeDefined()
    await expect(retry).resolves.toMatchObject({ id: 'session-a' })
    expect(listCalls).toBe(3)
    abandonedList.resolve([])
    await expect(gateway.stop()).resolves.toBeUndefined()
  })

  it('waits for an acquired current read handle to close while stopping', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const reading = deferred<{ eventState: 'detached'; events: readonly unknown[] }>()
    const closing = deferred<void>()
    const read = vi.fn(() => reading.promise)
    const close = vi.fn(() => closing.promise)
    let listCalls = 0
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => {
      listCalls += 1
      return listCalls === 1 ? [] : [{ header: meta, revision: 'fixture:1' }]
    })
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read,
      close,
    }))
    const facility = memoryFacility()
    const ingress = await openGatewayIngressJournal(facility)
    const closeIngress = vi.spyOn(ingress, 'close')
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      ingress,
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()
    const resolving = gateway.resolve('telegram-a')
    void resolving.catch(() => undefined)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())

    let stopped = false
    const stopping = gateway.stop().finally(() => { stopped = true })
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    await Promise.resolve()

    expect(stopped).toBe(false)
    expect(closeIngress).not.toHaveBeenCalled()
    closing.resolve(undefined)
    await expect(stopping).resolves.toBeUndefined()
    expect(closeIngress).toHaveBeenCalledOnce()
    reading.resolve({ eventState: 'detached', events: [] })
  })

  it('calls a current read handle close once when close synchronously stops the Gateway', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    let listCalls = 0
    let gateway!: DshGateway
    const close = vi.fn(() => {
      void gateway.stop()
    })
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => {
      listCalls += 1
      return listCalls === 1 ? [] : [{ header: meta, revision: 'fixture:1' }]
    })
    persistence.open = vi.fn(async () => ({
      id: SessionId('session-a'),
      header: meta,
      inheritedEventCount: 0,
      access: 'read',
      read: async () => ({ eventState: 'detached', events: [] }),
      close,
    }))
    const facility = memoryFacility()
    gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    await expect(gateway.resolve('telegram-a')).rejects.toThrow('DSH gateway is stopping')
    await expect(gateway.stop()).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })

  it.each(['first', 'second'] as const)(
    'isolates a %s caller cancellation while a coalesced resolution still has one waiter',
    async (cancelled) => {
      const host = fakeNativeHost()
      const pendingList = deferred<readonly unknown[]>()
      let operationSignal: AbortSignal | undefined
      let listCalls = 0
      const list = vi.fn((options: { signal?: AbortSignal }) => {
        listCalls += 1
        if (listCalls === 1) return Promise.resolve([])
        operationSignal = options.signal
        return pendingList.promise
      })
      const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
      delete persistence.inspect
      persistence.list = list
      persistence.open = vi.fn(() => Promise.reject(new Error('unexpected persistence open')))
      const facility = memoryFacility()
      const gateway = new DshGateway(
        host.ctx,
        resolveGatewayRoutes([{
          id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
          agentPreset: 'standard', provider: 'mock', model: 'mock-a',
        }]),
        await openGatewayIngressJournal(facility),
        await openGatewayOutboundJournal(facility),
      )
      await gateway.start()
      const firstController = new AbortController()
      const secondController = new AbortController()
      const first = gateway.resolve('telegram-a', firstController.signal)
      await vi.waitFor(() => expect(operationSignal).toBeInstanceOf(AbortSignal))
      const second = gateway.resolve('telegram-a', secondController.signal)
      void first.catch(() => undefined)
      void second.catch(() => undefined)
      const reason = new Error(`${cancelled} caller stopped waiting`)
      const cancelledController = cancelled === 'first' ? firstController : secondController
      const cancelledResolution = cancelled === 'first' ? first : second
      const remainingResolution = cancelled === 'first' ? second : first

      cancelledController.abort(reason)

      await expect(cancelledResolution).rejects.toBe(reason)
      expect(operationSignal?.aborted).toBe(false)
      pendingList.resolve([])
      await expect(remainingResolution).resolves.toMatchObject({ id: 'session-a' })
      expect(host.created).toHaveLength(1)
      await gateway.stop()
    },
  )

  it('does not invoke current read after a handle metadata getter cancels the sole resolver', async () => {
    const host = fakeNativeHost()
    const meta = {
      id: 'session-a', cwd: '/work/a', agentPreset: 'standard', version: 0, createdAt: 1,
    }
    const controller = new AbortController()
    const reason = new Error('metadata getter cancelled the caller')
    const read = vi.fn(async () => ({ eventState: 'detached', events: [] }))
    const close = vi.fn(async () => {})
    const handle = {
      id: SessionId('session-a'),
      header: meta,
      access: 'read',
      read,
      close,
    }
    Object.defineProperty(handle, 'inheritedEventCount', {
      configurable: true,
      get() {
        controller.abort(reason)
        return 0
      },
    })
    let listCalls = 0
    const persistence = host.ctx.sessionPersistence as unknown as Record<string, unknown>
    delete persistence.inspect
    persistence.list = vi.fn(async () => {
      listCalls += 1
      return listCalls === 1 ? [] : [{ header: meta, revision: 'fixture:1' }]
    })
    persistence.open = vi.fn(async () => handle)
    const facility = memoryFacility()
    const gateway = new DshGateway(
      host.ctx,
      resolveGatewayRoutes([{
        id: 'telegram-a', ...endpointA, workspaceId: 'workspace-a', sessionId: 'session-a',
        agentPreset: 'standard', provider: 'mock', model: 'mock-a',
      }]),
      await openGatewayIngressJournal(facility),
      await openGatewayOutboundJournal(facility),
    )
    await gateway.start()

    await expect(gateway.resolve('telegram-a', controller.signal)).rejects.toBe(reason)
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(read).not.toHaveBeenCalled()
    await expect(gateway.stop()).resolves.toBeUndefined()
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
    const id = SessionId(sessionId)
    const session = Session.create(id, undefined, {
      version: 0,
      id,
      createdAt: 1,
      cwd,
      isSeeded: false,
      agentPreset: preset,
    })
    const agent = {
      id: sessionId,
      session,
      inbox,
      ctx: { preset },
      options: { provider, model },
      status: 'idle',
      followup(message: { id: string; content: Array<{ text?: string }> }) {
        const event = session.append('agent/inbox/spliced', {
          target: 'next-turn',
          start: inbox.nextTurn.length,
          inserted: [message as never],
        })
        inbox.nextTurn.push(event.data.inserted[0]!)
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
    sessions: {
      get: (id: string) => agents.get(id)?.session,
    },
    commands: {
      list: (_agent: Agent) => [...commandLines].map(line => ({ name: line.slice(1).split(' ')[0] })),
      async execute(agent: Agent, line: string) {
        executed.push({ sessionId: String(agent.id), line })
        return { commandId: 'command-1', result: { kind: 'success', text: 'goal active' } }
      },
    },
    logger: { warn: vi.fn() },
    on() {},
    emit(event: string, value: Record<string, unknown>) {
      emitted.push({ event, value })
    },
  } as unknown as Context
  return { ctx, attached, messages, contents, created, executed, commandLines, persisted, emitted }
}

function workspace(id: string, path: string, attached: Map<string, string[]>): object {
  return {
    id, path, title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    get sessionIds() { return attached.get(id) ?? [] },
    async status() { return 'ok' },
    async attachSession(sessionId: string) {
      const list = attached.get(id) ?? []
      if (!list.includes(sessionId)) list.push(sessionId)
      attached.set(id, list)
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
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
