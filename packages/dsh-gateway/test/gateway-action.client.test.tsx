/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlSurfaceUI } from 'dsh-control-center/client'
import { GatewaySurface, type GatewayRemoteClient, type GatewaySurfaceProps } from '../src/client/GatewayAction.tsx'
import { zh } from '../src/client/locales.ts'
import type { GatewayHealthSnapshot } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const controlSurfaceUI: ControlSurfaceUI = {
  Surface: ({ children, ariaLabel }) => <main aria-label={ariaLabel}>{children}</main>,
  Header: ({ title, description, status, actions }) => <header><h2>{title}</h2><p>{description}</p>{status}{actions}</header>,
  Status: ({ children }) => <span>{children}</span>,
  Metrics: ({ items }) => <dl>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.hint}</small></div>)}</dl>,
  Section: ({ title, description, children }) => <section><h3>{title}</h3><p>{description}</p>{children}</section>,
  Entity: ({ title, description, status, actions, details }) => <article><strong>{title}</strong><span>{description}</span>{status}{actions}{details}</article>,
  Notice: ({ title, children, role }) => <div role={role}>{title}{children}</div>,
  Button: ({ tone: _tone, ...props }) => <button {...props} />,
  Empty: ({ title, description }) => <div><h2>{title}</h2><p>{description}</p></div>,
  Loading: () => <div role="status">Loading</div>,
}

describe('Gateway Control Surface', () => {
  it('approves and revokes Feishu grants without exposing internal ids in the primary view', async () => {
    const remote = {
      overview: vi.fn(async () => ({ ok: true, value: snapshot() })),
      pendingPairings: vi.fn(async () => ({ ok: true, value: [] })),
      approvePairing: vi.fn(async () => ({
        ok: true,
        value: { routeId: 'paired-feishu', workspaceId: 'workspace-a', sessionId: 'session-a' },
      })),
      approvePairingRequest: vi.fn(),
      revokePairing: vi.fn(async () => ({
        ok: true,
        value: {
          routeId: 'feishu-main', workspaceId: 'workspace-a', sessionId: 'session-a',
          revokedAt: 2_000, alreadyRevoked: false,
        },
      })),
    } as GatewayRemoteClient
    render(<GatewaySurface {...surfaceProps(remote)} />)

    fireEvent.change(await screen.findByLabelText('配对码'), { target: { value: 'ABCDEFGH23' } })
    fireEvent.click(screen.getByRole('button', { name: '批准飞书配对' }))

    expect(await screen.findByText('配对已批准。让用户直接发送下一条消息即可。')).toBeTruthy()
    expect(remote.approvePairing).toHaveBeenCalledWith('ABCDEFGH23', 'feishu', 'workspace-a', 'session-a')
    expect(screen.getAllByText('最近活动: 尚无记录').length).toBeGreaterThan(0)
    expect(screen.getAllByText('最近错误: 尚无记录').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '撤销 feishu-main' }))
    fireEvent.click(screen.getByRole('button', { name: '确认撤销 feishu-main' }))
    expect(remote.revokePairing).toHaveBeenCalledWith('feishu-main')
    expect(await screen.findByText(/授权已撤销/u)).toBeTruthy()
  })

  it('keeps the last-good authoritative snapshot visible when a refresh fails', async () => {
    const remote = {
      overview: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'host-unavailable', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, value: snapshot() })
        .mockResolvedValueOnce({ ok: false, error: { code: 'host-unavailable', message: 'offline again' } }),
      pendingPairings: vi.fn(async () => ({ ok: true, value: [] })),
      approvePairing: vi.fn(),
      approvePairingRequest: vi.fn(),
      revokePairing: vi.fn(),
    } as GatewayRemoteClient
    render(<GatewaySurface {...surfaceProps(remote)} />)

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法连接 DSH Host')
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))

    expect(await screen.findByText('official-feishu-websocket')).toBeTruthy()
    expect(screen.getByText('telegram-long-poll')).toBeTruthy()
    expect(screen.getAllByText('feishu-main').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('1 个实时 Session')).toBeTruthy()
    expect(screen.getByText(/不调用模型/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法连接 DSH Host')
    expect(screen.getByText('official-feishu-websocket')).toBeTruthy()
    expect(remote.overview).toHaveBeenCalledTimes(3)
  })

  it('renders redacted pending requests and approves one by request id', async () => {
    const requestId = 'a'.repeat(32)
    const remote = {
      overview: vi.fn(async () => ({ ok: true, value: snapshot() })),
      pendingPairings: vi.fn(async () => ({ ok: true, value: [{
        requestId,
        adapter: 'feishu',
        accountIdHash: 'b'.repeat(64),
        createdAt: 1_000,
        expiresAt: Date.now() + 600_000,
      }] })),
      approvePairing: vi.fn(),
      approvePairingRequest: vi.fn(async () => ({ ok: true, value: {
        routeId: 'paired-request', workspaceId: 'workspace-a', sessionId: 'session-a',
      } })),
      revokePairing: vi.fn(),
    } as GatewayRemoteClient
    render(<GatewaySurface {...surfaceProps(remote)} />)

    expect(await screen.findByText('待批准请求')).toBeTruthy()
    expect(screen.getAllByText('飞书').length).toBeGreaterThan(0)
    expect(screen.queryByText('oc_first_contact')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '直接批准' }))
    expect(remote.approvePairingRequest).toHaveBeenCalledWith(requestId, 'workspace-a', 'session-a')
  })

  it('refreshes pending requests on the same page without erasing the last snapshot on a poll error', async () => {
    let poll: (() => void) | undefined
    const realSetInterval = globalThis.setInterval
    vi.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout) => {
      if (timeout === 5_000) poll = handler
      if (timeout === 5_000) return 1 as unknown as ReturnType<typeof setInterval>
      return realSetInterval(handler, timeout)
    })
    const requestId = 'c'.repeat(32)
    const remote = {
      overview: vi.fn(async () => ({ ok: true, value: snapshot() })),
      pendingPairings: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: [] })
        .mockResolvedValueOnce({ ok: true, value: [{
          requestId,
          adapter: 'feishu',
          accountIdHash: 'd'.repeat(64),
          createdAt: 1_000,
          expiresAt: Date.now() + 600_000,
        }] })
        .mockResolvedValueOnce({ ok: false, error: { code: 'host-unavailable', message: 'offline' } }),
      approvePairing: vi.fn(),
      approvePairingRequest: vi.fn(),
      revokePairing: vi.fn(),
    } as GatewayRemoteClient
    render(<GatewaySurface {...surfaceProps(remote)} />)
    expect(await screen.findByText('没有待批准请求')).toBeTruthy()

    expect(poll).toBeDefined()
    poll!()
    await waitFor(() => expect(remote.pendingPairings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('直接批准')).toBeTruthy())
    poll!()
    await waitFor(() => expect(screen.getByText('直接批准')).toBeTruthy())
    expect(screen.getByText('直接批准')).toBeTruthy()
    expect(remote.pendingPairings).toHaveBeenCalledTimes(3)
  })
})

function surfaceProps(remote: GatewayRemoteClient): GatewaySurfaceProps {
  return {
    remote,
    t: (key: string) => zh[key as keyof typeof zh] ?? key,
    sessionId: 'session-a',
    ui: controlSurfaceUI,
    useWorkspaces: ((selector: (state: { items: Array<{ workspaceId: string; sessionIds: string[] }> }) => unknown) =>
      selector({ items: [{ workspaceId: 'workspace-a', sessionIds: ['session-a'] }] })) as never,
  } as unknown as GatewaySurfaceProps
}

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
