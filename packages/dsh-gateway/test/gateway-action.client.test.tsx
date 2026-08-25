/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayAction, type GatewayRemoteClient } from '../src/client/GatewayAction.tsx'
import type { GatewayHealthSnapshot } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GatewayAction', () => {
  it('lets the operator approve a relayed Feishu code into the selected native Session', async () => {
    const remote = {
      overview: vi.fn(async () => ({ ok: true, value: snapshot() })),
      approvePairing: vi.fn(async () => ({
        ok: true,
        value: { routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a' },
      })),
      revokePairing: vi.fn(async () => ({
        ok: true,
        value: {
          routeId: 'feishu-main', workspaceId: 'workspace-a', sessionId: 'session-a',
          revokedAt: 2_000, alreadyRevoked: false,
        },
      })),
    } as GatewayRemoteClient
    render(<GatewayAction
      remote={remote}
      t={translate}
      wide
      useSessions={((selector: (state: { current: string }) => unknown) =>
        selector({ current: 'session-a' })) as never}
      useWorkspaces={((selector: (state: { items: Array<{ workspaceId: string; sessionIds: string[] }> }) => unknown) =>
        selector({ items: [{ workspaceId: 'workspace-a', sessionIds: ['session-a'] }] })) as never}
    />)

    fireEvent.click(screen.getByRole('button', { name: '渠道健康' }))
    fireEvent.change(await screen.findByLabelText('配对码'), { target: { value: 'ABCDEFGH23' } })
    fireEvent.click(screen.getByRole('button', { name: '批准飞书配对' }))

    expect(await screen.findByText(/paired-feishu/u)).toBeTruthy()
    expect(remote.approvePairing).toHaveBeenCalledWith(
      'ABCDEFGH23', 'feishu', 'workspace-a', 'session-a',
    )

    fireEvent.click(screen.getByRole('button', { name: '撤销 feishu-main' }))
    fireEvent.click(screen.getByRole('button', { name: '确认撤销 feishu-main' }))
    expect(remote.revokePairing).toHaveBeenCalledWith('feishu-main')
    expect(await screen.findByText(/feishu-main 已撤销/u)).toBeTruthy()
  })

  it('shows unified channel health and fails visibly without retaining a stale ready view', async () => {
    const remote = {
      overview: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'host-unavailable', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, value: snapshot() })
        .mockResolvedValueOnce({ ok: false, error: { code: 'host-unavailable', message: 'offline again' } }),
      approvePairing: vi.fn(),
      revokePairing: vi.fn(),
    } as GatewayRemoteClient
    render(<GatewayAction
      remote={remote}
      t={translate}
      wide
      useSessions={vi.fn() as never}
      useWorkspaces={vi.fn() as never}
    />)

    fireEvent.click(screen.getByRole('button', { name: '渠道健康' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))

    expect(await screen.findByText('2 条路由')).toBeTruthy()
    expect(screen.getByText('telegram-long-poll')).toBeTruthy()
    expect(screen.getByText('official-feishu-websocket')).toBeTruthy()
    expect(screen.getAllByText('telegram-main')).toHaveLength(2)
    expect(screen.getAllByText('feishu-main').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('1 个实时 Session')).toBeTruthy()
    expect(screen.getByText(/不调用模型/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline again')
    expect(screen.queryByText('2 条路由')).toBeNull()
    expect(remote.overview).toHaveBeenCalledTimes(3)
  })
})

function snapshot(): GatewayHealthSnapshot {
  return {
    schemaVersion: 1,
    observedAt: 1_000,
    lifecycle: 'ready',
    routes: {
      total: 2,
      liveSessions: 1,
      items: [
        { id: 'feishu-main', adapter: 'feishu', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: false, live: true, paired: true },
        { id: 'telegram-main', adapter: 'telegram', workspaceId: 'workspace-b', sessionId: 'session-b', threadScoped: false, live: false, paired: false },
      ],
    },
    ingress: { total: 3, prepared: 0, executing: 0, settled: 3, uncertain: 0 },
    transports: {
      registrations: 2,
      connecting: 0,
      ready: 1,
      degraded: 1,
      stopping: 0,
      items: [
        {
          adapter: 'feishu', kind: 'official-feishu-websocket', routeIds: ['feishu-main'],
          state: 'degraded', observedAt: 999, connectedAt: 100, lastErrorAt: 998,
        },
        {
          adapter: 'telegram', kind: 'telegram-long-poll', routeIds: ['telegram-main'],
          state: 'ready', observedAt: 999, connectedAt: 100, lastActivityAt: 997,
        },
      ],
    },
    outbound: {
      registrations: 2, scheduled: 0, total: 4, prepared: 0, sending: 0, retrying: 0,
      delivered: 3, uncertain: 1, failed: 0,
    },
  }
}

function translate(key: string, values?: Record<string, string | number>): string {
  const dictionary: Record<string, string> = {
    'trigger.label': '渠道健康',
    'panel.title': '渠道健康',
    'panel.close': '关闭',
    'status.loading': '正在读取',
    'status.refresh': '刷新状态',
    'status.refreshing': '正在刷新',
    'summary.routes': '{count} 条路由',
    'summary.sessions': '{count} 个实时 Session',
    'pairing.code': '配对码',
    'pairing.approve': '批准飞书配对',
    'pairing.approved': '配对已批准，路由：',
    'routes.title': '授权路由',
    'routes.help': '动态授权可撤销',
    'routes.empty': '没有路由',
    'routes.paired': '动态配对',
    'routes.configured': '静态配置',
    'routes.revoke': '撤销 {routeId}',
    'routes.confirmRevoke': '确认撤销 {routeId}',
    'routes.revoking': '正在撤销…',
    'routes.revoked': '{routeId} 已撤销',
    'foot.noModel': '权威 Host 快照，不调用模型',
    'error.prefix': '读取失败：',
  }
  let result = dictionary[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) result = result.replace(`{${name}}`, String(value))
  return result
}
