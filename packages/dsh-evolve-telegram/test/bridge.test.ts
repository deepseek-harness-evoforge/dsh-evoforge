import { describe, expect, it, vi } from 'vitest'
import type { TelegramHostRoute } from 'dsh-telegram'
import { EvolutionTelegramBridge } from '../src/bridge.js'
import type { EvolutionAttentionOverview } from '../src/attention.js'

const workspaceId = '11111111-1111-4111-8111-111111111111'

describe('Evolution Telegram bridge', () => {
  it('serializes catch-up and settled scans through the concrete Telegram route', async () => {
    const overview = pendingOverview()
    const source = { overview: vi.fn(async () => overview) }
    const notify = vi.fn<TelegramHostRoute['notify']>(async () => ({
      created: true,
      status: 'prepared',
    }))
    const bridge = new EvolutionTelegramBridge(source, { workspaceId, notify })

    const first = bridge.scan()
    const second = bridge.scan()
    await Promise.all([first, second])

    expect(source.overview).toHaveBeenCalledTimes(2)
    expect(source.overview).toHaveBeenNthCalledWith(1, workspaceId)
    expect(source.overview).toHaveBeenNthCalledWith(2, workspaceId)
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
    const bridge = new EvolutionTelegramBridge(source, { workspaceId, notify }, error => {
      errors.push(String(error))
    })

    await bridge.scan()
    await bridge.scan()

    expect(errors).toEqual(['Error: temporary scan failure'])
    expect(notify).toHaveBeenCalledOnce()
  })
})

function pendingOverview(): EvolutionAttentionOverview {
  return {
    reviews: {
      items: [{
        id: 'a'.repeat(64),
        status: 'pending',
        recommendation: 'review',
        skillName: 'delivery',
      }],
    },
  }
}
