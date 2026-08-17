import { describe, expect, it, vi } from 'vitest'
import type { EvolutionStore } from '../src/generation-store.js'
import { ResidentEvolutionControl } from '../src/resident-evolution-control.js'
import type { ShadowSupervisor } from '../src/shadow-supervisor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('resident evolution control', () => {
  it('persists pause before stopping work and persists resume before waking discovery', async () => {
    const events: string[] = []
    let paused = false
    const store = {
      isRecoveryPaused: vi.fn(() => paused),
      setRecoveryPaused: vi.fn(async (_workspaceId: string, value: boolean) => {
        paused = value
        events.push(`store:${value}`)
        return { changed: true, paused: value }
      }),
    } as unknown as EvolutionStore
    const supervisor = {
      pause: vi.fn(async () => { events.push('supervisor:pause') }),
      resume: vi.fn(() => { events.push('supervisor:resume') }),
    } as unknown as ShadowSupervisor
    const control = new ResidentEvolutionControl(store)
    control.attach(supervisor)

    await control.pause(WORKSPACE_ID)
    expect(control.isPaused(WORKSPACE_ID)).toBe(true)
    await control.resume(WORKSPACE_ID)

    expect(events).toEqual([
      'store:true',
      'supervisor:pause',
      'store:false',
      'supervisor:resume',
    ])
  })
})
