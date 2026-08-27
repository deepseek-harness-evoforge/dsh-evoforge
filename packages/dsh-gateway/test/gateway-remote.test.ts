import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { DshGateway, GatewayHealthSnapshot } from '../src/index.ts'
import { GatewayRemoteService } from '../src/gateway-remote.ts'

describe('GatewayRemoteService', () => {
  it('projects health and approves a relayed code through the Gateway Host management Remote', async () => {
    const snapshot = { schemaVersion: 1, observedAt: 10 } as GatewayHealthSnapshot
    const pending = [{ requestId: 'a'.repeat(32), adapter: 'feishu', accountIdHash: 'b'.repeat(64), createdAt: 1, expiresAt: 2 }]
    const gateway = {
      healthSnapshot: vi.fn(() => snapshot),
      pendingPairings: vi.fn(() => pending),
      approvePairingForSession: vi.fn(async () => ({
        routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a',
      })),
      approvePairingRequestForSession: vi.fn(async () => ({
        routeId: 'paired-request', workspaceId: 'workspace-a', sessionId: 'session-a',
      })),
      revokePairing: vi.fn(async () => ({
        routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a',
        revokedAt: 20, alreadyRevoked: false,
      })),
    } as unknown as DshGateway
    const ctx = new Context()
    const remote = new GatewayRemoteService(ctx, gateway)

    await expect(remote.overview()).resolves.toBe(snapshot)
    await expect(remote.pendingPairings()).resolves.toBe(pending)
    await expect(remote.approvePairing('ABCDEFGH23', 'feishu', 'workspace-a', 'session-a'))
      .resolves.toEqual({ routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a' })
    expect(gateway.approvePairingForSession).toHaveBeenCalledWith({
      code: 'ABCDEFGH23', adapter: 'feishu', workspaceId: 'workspace-a', sessionId: 'session-a',
    })
    await expect(remote.approvePairingRequest('a'.repeat(32), 'workspace-a', 'session-a'))
      .resolves.toEqual({ routeId: 'paired-request', workspaceId: 'workspace-a', sessionId: 'session-a' })
    expect(gateway.approvePairingRequestForSession).toHaveBeenCalledWith({
      requestId: 'a'.repeat(32), workspaceId: 'workspace-a', sessionId: 'session-a',
    })
    await expect(remote.revokePairing('paired-feishu')).resolves.toMatchObject({
      routeId: 'paired-feishu', alreadyRevoked: false,
    })
    expect(gateway.revokePairing).toHaveBeenCalledWith('paired-feishu')
    expect(gateway.healthSnapshot).toHaveBeenCalledOnce()
    expect(ctx.get('evoforge.gatewayHealth')).toMatchObject({ name: 'evoforge.gatewayHealth' })
    expect(remote.typertRemote).toMatchObject({
      serviceKey: 'evoforge.gatewayHealth',
      namespace: 'evoforgeGateway',
    })
    expect(remoteMethods(remote).map(marker => marker.method).sort())
      .toEqual(['approvePairing', 'approvePairingRequest', 'overview', 'pendingPairings', 'revokePairing'])
  })
})
