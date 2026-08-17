import { describe, expect, it, vi } from 'vitest'
import {
  automaticEvolutionInflightStatus,
  type AutomaticEvolutionInflightSource,
} from '../src/automatic-evolution-inflight.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('automatic evolution inflight gate', () => {
  it('is clear only when every durable authority is clear', async () => {
    await expect(automaticEvolutionInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64), [source('clear'), source('clear')]))
      .resolves.toBe('clear')
    await expect(automaticEvolutionInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64), [source('clear'), source('busy')]))
      .resolves.toBe('busy')
  })

  it('fails closed when any durable authority is unknown or unreadable', async () => {
    await expect(automaticEvolutionInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64), [source('busy'), source('unknown')]))
      .resolves.toBe('unknown')
    await expect(automaticEvolutionInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64), [{
      automaticInflightStatus: vi.fn(async () => { throw new Error('corrupt') }),
    }])).resolves.toBe('unknown')
    await expect(automaticEvolutionInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64), []))
      .resolves.toBe('unknown')
  })
})

function source(
  status: 'clear' | 'busy' | 'unknown',
): AutomaticEvolutionInflightSource {
  return { automaticInflightStatus: vi.fn(async () => status) }
}
