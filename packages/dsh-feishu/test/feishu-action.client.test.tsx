/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuAction, type FeishuCommandsClient } from '../src/client/FeishuAction.tsx'
import { renderFeishuHealthCommand, summarizeFeishuHealth } from '../src/health.ts'
import { zh } from '../src/client/locales.ts'

const sessionId = 'feishu-session'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Feishu health action', () => {
  it('does not expose the deleted Session pairing flow', async () => {
    const commands = {
      list: vi.fn(() => success([{ name: 'goal', description: 'goal' }])),
      execute: vi.fn(),
    } as unknown as FeishuCommandsClient
    renderAction(commands)

    await waitFor(() => expect(commands.list).toHaveBeenCalledWith(sessionId))
    expect(screen.queryByRole('button', { name: '连接飞书' })).toBeNull()
    expect(screen.queryByRole('button', { name: '飞书健康' })).toBeNull()
    expect(commands.execute).not.toHaveBeenCalled()
  })

  it('shows bound-route health and clears stale data after a Host failure', async () => {
    const health = snapshot()
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu', description: 'bound route health' }])),
      execute: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, value: execution(renderFeishuHealthCommand(health)) })
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline again' } }),
    } as unknown as FeishuCommandsClient
    renderAction(commands)

    fireEvent.click(await screen.findByRole('button', { name: '飞书健康' }))
    expect((await screen.findByRole('alert')).textContent).toContain('gateway_unavailable: offline')
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(screen.getByText('official-feishu-websocket')).toBeTruthy()
    expect(screen.getByText('feishu-main')).toBeTruthy()
    expect(screen.getByText('DSH 就绪')).toBeTruthy()
    expect(screen.getByText(/不调用模型/u)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline again')
    expect(screen.queryByText('就绪')).toBeNull()
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
    renderAction(commands)

    fireEvent.click(await screen.findByRole('button', { name: '飞书健康' }))
    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(execute).toHaveBeenNthCalledWith(1, sessionId, '/feishu')
    expect(execute).toHaveBeenNthCalledWith(2, sessionId, '/feishu', [])
  })
})

function renderAction(commands: FeishuCommandsClient) {
  return render(<FeishuAction
    commands={commands}
    t={key => zh[key as keyof typeof zh] ?? key}
    wide
    useSessions={sessionHook()}
    useWorkspaces={workspaceHook()}
  />)
}

function sessionHook(current: string | undefined = sessionId) {
  return <S,>(selector: (state: SessionListState) => S): S => selector({ current } as SessionListState)
}

function workspaceHook() {
  return <S,>(selector: (state: WorkspaceListState) => S): S =>
    selector({ items: [] } as unknown as WorkspaceListState)
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
