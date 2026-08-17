import { describe, expect, it, vi } from 'vitest'
import type { FeishuHostRoute } from 'dsh-feishu'
import type { TelegramHostRoute } from 'dsh-telegram'
import { EvolutionFeishuBridge, EvolutionTelegramBridge } from '../src/bridge.js'
import type { EvolutionAttentionOverview } from '../src/attention.js'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222'

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

  it('rejects a Telegram overview returned for another Workspace', async () => {
    const source = { overview: vi.fn(async () => pendingOverview(otherWorkspaceId)) }
    const notify = vi.fn<TelegramHostRoute['notify']>()
    const errors: string[] = []
    const bridge = new EvolutionTelegramBridge(source, { workspaceId, notify }, error => {
      errors.push(String(error))
    })

    await bridge.scan()

    expect(errors[0]).toContain('Workspace authority mismatch')
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('Evolution Feishu bridge', () => {
  it('scans each exact Workspace once and delivers only to its static routes', async () => {
    const source = { overview: vi.fn(async (id: string) => pendingOverview(id)) }
    const notify = vi.fn<FeishuHostRoute['notify']>(async () => ({
      created: true,
      status: 'prepared',
    }))
    const routes = [
      { routeId: 'feishu-a', workspaceId },
      { routeId: 'feishu-a-secondary', workspaceId },
      { routeId: 'feishu-b', workspaceId: otherWorkspaceId },
    ]
    const bridge = new EvolutionFeishuBridge(source, { routes, notify })

    await bridge.scan()

    expect(source.overview.mock.calls).toEqual([[workspaceId], [otherWorkspaceId]])
    expect(notify).toHaveBeenCalledTimes(3)
    expect(notify.mock.calls.map(call => call[0].routeId)).toEqual([
      'feishu-a',
      'feishu-a-secondary',
      'feishu-b',
    ])
    expect(new Set(notify.mock.calls.map(call => call[0].id)).size).toBe(1)
  })
})

function pendingOverview(id = workspaceId): EvolutionAttentionOverview {
  return {
    workspaceId: id,
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
