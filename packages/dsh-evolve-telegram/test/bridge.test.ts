import { describe, expect, it, vi } from 'vitest'
import type { EvolutionOverview } from 'dsh-evolve'
import { EvolutionTelegramBridge, type TelegramHostRoute } from '../src/bridge.js'

describe('Evolution Telegram bridge', () => {
  it('serializes catch-up and settled scans through the concrete Telegram route', async () => {
    const overview = pendingOverview()
    const source = { overview: vi.fn(async () => overview) }
    const notify = vi.fn<TelegramHostRoute['notify']>(async () => ({
      created: true,
      status: 'prepared',
    }))
    const bridge = new EvolutionTelegramBridge(source, { notify })

    const first = bridge.scan()
    const second = bridge.scan()
    await Promise.all([first, second])

    expect(source.overview).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[0]?.[0].id).toBe(notify.mock.calls[1]?.[0].id)
  })

  it('contains one failed scan and permits the next settled scan', async () => {
    const source = {
      overview: vi.fn()
        .mockRejectedValueOnce(new Error('temporary scan failure'))
        .mockResolvedValueOnce(pendingOverview()),
    }
    const notify = vi.fn<TelegramHostRoute['notify']>(async () => ({
      created: true,
      status: 'prepared',
    }))
    const errors: string[] = []
    const bridge = new EvolutionTelegramBridge(source, { notify }, error => {
      errors.push(String(error))
    })

    await bridge.scan()
    await bridge.scan()

    expect(errors).toEqual(['Error: temporary scan failure'])
    expect(notify).toHaveBeenCalledOnce()
  })
})

function pendingOverview(): EvolutionOverview {
  return {
    schemaVersion: 1,
    recovery: { available: true, paused: false },
    automaticPromotion: { enabled: false, skills: [] },
    reviews: {
      available: true,
      pendingCount: 1,
      actionableCount: 1,
      warningCount: 0,
      inactiveGenerations: [],
      items: [{
        id: 'a'.repeat(64),
        status: 'pending',
        recommendation: 'review',
        skillName: 'delivery',
        claim: 'Bounded improvement.',
        changedFiles: ['SKILL.md'],
        candidateTreeHash: 'b'.repeat(64),
        cases: [],
        cost: { inputTokens: 1, outputTokens: 1, trialCount: 1 },
        reasons: [],
        limitations: [],
        evaluatorVersion: 'v1',
        compositionFingerprint: 'c'.repeat(64),
        compositionStable: true,
        startedAt: '2026-08-17T00:00:00.000Z',
      }],
    },
  }
}
