import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { EvolutionRemoteService } from '../src/evolution-remote.ts'
import type { EvolutionControlPlane } from '../src/evolution-control-plane.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('EvolutionRemoteService', () => {
  it('is a thin generated-Remote adapter over the shared control plane', async () => {
    const overview = { schemaVersion: 1, reviews: { items: [] } }
    const receipt = { schemaVersion: 1, workspaceId: WORKSPACE_ID, action: 'pause' }
    const control = {
      overview: vi.fn(async () => overview),
      review: vi.fn(),
      pause: vi.fn(async () => receipt),
      resume: vi.fn(),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
      promote: vi.fn(),
      rollback: vi.fn(),
    } as unknown as EvolutionControlPlane
    const ctx = new Context()
    const remote = new EvolutionRemoteService(ctx, control)

    await expect(remote.overview(WORKSPACE_ID, 'session-1')).resolves.toBe(overview)
    expect(control.overview).toHaveBeenCalledWith(WORKSPACE_ID, 'session-1')
    await expect(remote.pause(WORKSPACE_ID)).resolves.toBe(receipt)
    expect(ctx.get('evoforge.evolutionControl')).toMatchObject({ name: 'evoforge.evolutionControl' })
    expect(remote.typertRemote).toMatchObject({
      serviceKey: 'evoforge.evolutionControl',
      namespace: 'evoforgeEvolution',
    })
    expect(remoteMethods(remote).map(marker => marker.method)).toEqual([
      'overview',
      'review',
      'pause',
      'resume',
      'approveReview',
      'rejectReview',
      'promote',
      'rollback',
    ])
  })
})
