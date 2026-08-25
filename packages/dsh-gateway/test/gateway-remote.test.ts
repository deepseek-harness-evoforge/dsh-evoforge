import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { DshGateway, GatewayHealthSnapshot } from '../src/index.ts'
import { GatewayRemoteService } from '../src/gateway-remote.ts'

describe('GatewayRemoteService', () => {
  it('projects health and approves a relayed code through the Gateway Host management Remote', async () => {
    const snapshot = { schemaVersion: 1, observedAt: 10 } as GatewayHealthSnapshot
    const gateway = {
      healthSnapshot: vi.fn(() => snapshot),
      approvePairingForSession: vi.fn(async () => ({
        routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a',
      })),
    } as unknown as DshGateway
    const ctx = new Context()
    const remote = new GatewayRemoteService(ctx, gateway)

    await expect(remote.overview()).resolves.toBe(snapshot)
    await expect(remote.approvePairing('ABCDEFGH23', 'feishu', 'workspace-a', 'session-a'))
      .resolves.toEqual({ routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a' })
    expect(gateway.approvePairingForSession).toHaveBeenCalledWith({
      code: 'ABCDEFGH23', adapter: 'feishu', workspaceId: 'workspace-a', sessionId: 'session-a',
    })
    expect(gateway.healthSnapshot).toHaveBeenCalledOnce()
    expect(ctx.get('evoforge.gatewayHealth')).toMatchObject({ name: 'evoforge.gatewayHealth' })
    expect(remote.typertRemote).toMatchObject({
      serviceKey: 'evoforge.gatewayHealth',
      namespace: 'evoforgeGateway',
    })
    expect(remoteMethods(remote).map(marker => marker.method).sort()).toEqual(['approvePairing', 'overview'])
  })
})
