/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ControlSurfaceUI } from 'dsh-control-center/client'
import { FeishuSurface, type FeishuCommandsClient, type FeishuSurfaceProps } from '../src/client/FeishuAction.tsx'
import { renderFeishuHealthCommand, summarizeFeishuHealth } from '../src/health.ts'
import { zh } from '../src/client/locales.ts'

const sessionId = 'feishu-session'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const controlSurfaceUI: ControlSurfaceUI = {
  Surface: ({ children, ariaLabel }) => <main aria-label={ariaLabel}>{children}</main>,
  Header: ({ title, description, status, actions }) => <header><h2>{title}</h2><p>{description}</p>{status}{actions}</header>,
  Status: ({ children }) => <span>{children}</span>,
  Metrics: ({ items }) => <dl>{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd><small>{item.hint}</small></div>)}</dl>,
  Section: ({ title, description, actions, children }) => <section><h3>{title}</h3><p>{description}</p>{actions}{children}</section>,
  Entity: ({ title, description, status, details }) => <article><strong>{title}</strong><span>{description}</span>{status}{details}</article>,
  Notice: ({ title, children, role }) => <div role={role}>{title}{children}</div>,
  Button: ({ tone: _tone, ...props }) => <button {...props} />,
  Empty: ({ title, description }) => <div><h2>{title}</h2><p>{description}</p></div>,
  Loading: () => <div role="status">Loading</div>,
}

describe('Feishu Control Surface', () => {
  it('explains unavailable Session state without restoring the deleted pairing flow', async () => {
    const commands = {
      list: vi.fn(() => success([{ name: 'goal', description: 'goal' }])),
      execute: vi.fn(),
    } as unknown as FeishuCommandsClient
    renderSurface(commands)

    await waitFor(() => expect(commands.list).toHaveBeenCalledWith(sessionId))
    expect(await screen.findByText(/当前对话未启用飞书内容读取/u)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '连接飞书' })).toBeNull()
    expect(commands.execute).not.toHaveBeenCalled()
  })

  it('shows bound-route health and retains the last-good view after a Host failure', async () => {
    const health = snapshot()
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu', description: 'bound route health' }])),
      execute: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, value: execution(renderFeishuHealthCommand(health)) })
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline again' } }),
    } as unknown as FeishuCommandsClient
    renderSurface(commands)

    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法读取当前 Session')
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(screen.getByText('official-feishu-websocket')).toBeTruthy()
    expect(screen.getByText('feishu-main')).toBeTruthy()
    expect(screen.getByText('DSH 就绪')).toBeTruthy()
    expect(screen.getByText(/不调用模型/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法读取当前 Session')
    expect(screen.getByText('就绪')).toBeTruthy()
    expect(commands.execute).toHaveBeenCalledTimes(3)
  })

  it('adapts the rc.2 Command Remote image envelope without restoring pairing commands', async () => {
    const execute = vi.fn((...args: readonly unknown[]) => {
      if (args.length === 2) {
        throw new Error('client api: commands/execute expected 3 business argument(s) plus an optional AbortSignal, got 2')
      }
      return success(execution(renderFeishuHealthCommand(snapshot())))
    })
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu', description: 'health' }])),
      execute,
    } as unknown as FeishuCommandsClient
    renderSurface(commands)

    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(execute).toHaveBeenNthCalledWith(1, sessionId, '/feishu')
    expect(execute).toHaveBeenNthCalledWith(2, sessionId, '/feishu', [])
  })
})

function renderSurface(commands: FeishuCommandsClient) {
  const props = {
    commands,
    t: (key: string) => zh[key as keyof typeof zh] ?? key,
    sessionId,
    ui: controlSurfaceUI,
  } as unknown as FeishuSurfaceProps
  return render(<FeishuSurface {...props} />)
}

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function execution(text: string) {
  return { commandId: 'command-test', result: { kind: 'success' as const, text } }
}

function snapshot() {
  return summarizeFeishuHealth({
    now: 900,
    accountId: 'cli_test_app',
    transport: {
      adapter: 'feishu', kind: 'official-feishu-websocket', routeIds: ['feishu-main'],
      state: 'ready', observedAt: 850, connectedAt: 100, lastActivityAt: 800,
    },
    routes: [{ id: 'feishu-main', workspaceId: 'workspace-a', sessionId, threadScoped: false }],
    outbound: {
      registrations: 1, scheduled: 0, total: 0, prepared: 0, sending: 0,
      retrying: 0, delivered: 0, uncertain: 0, failed: 0,
    },
    pendingApprovals: 0,
    content: {
      permissions: new Set(['document-read', 'bitable-records-read']),
      toolAvailable: true,
      approvalAvailable: true,
      futureSessionOnly: false,
      maxContentChars: 20_000,
      maxBitableRecords: 20,
    },
  })
}
