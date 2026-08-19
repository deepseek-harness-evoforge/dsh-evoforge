/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PairingAction, type PairingCommandsClient } from '../src/client/PairingAction.tsx'
import { renderFeishuHealthCommand, summarizeFeishuHealth } from '../src/health.ts'
import { zh } from '../src/client/locales.ts'

const sessionId = 'feishu-setup-session'
const phrase = 'EVOFORGE PAIR ABCDEFGHJKLM2345'
const route = [
  '配对成功。下面只是待审查配置，不会自动生效：',
  '```yaml',
  '- id: evoforge-gateway',
  '  config:',
  '    routes: []',
  '```',
].join('\n')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function sessionHook(current: string | undefined = sessionId) {
  return <S,>(selector: (state: SessionListState) => S): S => selector({ current } as SessionListState)
}

function workspaceHook() {
  return <S,>(selector: (state: WorkspaceListState) => S): S => selector({ items: [] } as unknown as WorkspaceListState)
}

function t(key: string): string {
  return zh[key as keyof typeof zh] ?? key
}

function success<T>(value: T) {
  return Promise.resolve({ ok: true as const, value })
}

function execution(text: string) {
  return {
    commandId: 'command-test',
    result: { kind: 'success' as const, text },
  }
}

function renderPairing(commands: PairingCommandsClient) {
  return render(<PairingAction
    commands={commands}
    t={t}
    wide
    useSessions={sessionHook()}
    useWorkspaces={workspaceHook()}
  />)
}

describe('Feishu pairing action', () => {
  it('guides one native Session from one-time phrase to review-only route config', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu-pair', description: 'pair', input: { hint: 'start' } }])),
      execute: vi.fn((_session: unknown, line: string) => success(
        line.endsWith('start') ? execution(`飞书配对窗口已开启\n${phrase}`) : execution(route),
      )),
    } as unknown as PairingCommandsClient
    renderPairing(commands)

    fireEvent.click(await screen.findByRole('button', { name: '连接飞书' }))
    expect(screen.getByText('不需要查 chat_id 或 open_id。这里生成一次性短语，飞书确认后再给你一份可审查的静态配置。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成一次性短语' }))

    expect(await screen.findByText(phrase)).toBeTruthy()
    expect(commands.execute).toHaveBeenCalledWith(sessionId, '/feishu-pair start')
    fireEvent.click(screen.getByRole('button', { name: '复制短语' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(phrase))

    fireEvent.click(screen.getByRole('button', { name: '我已发送，检查连接' }))
    expect(await screen.findByText('连接信息已收到')).toBeTruthy()
    expect(screen.getByText(/evoforge-gateway/u)).toBeTruthy()
    expect(commands.execute).toHaveBeenCalledWith(sessionId, '/feishu-pair status')
    fireEvent.click(screen.getByRole('button', { name: '复制配置' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('evoforge-gateway')))
  })

  it('does not add a setup surface when this Session has no pairing command', async () => {
    const commands = {
      list: vi.fn(() => success([{ name: 'goal', description: 'goal' }])),
      execute: vi.fn(),
    } as unknown as PairingCommandsClient
    renderPairing(commands)

    await waitFor(() => expect(commands.list).toHaveBeenCalledWith(sessionId))
    expect(screen.queryByRole('button', { name: '连接飞书' })).toBeNull()
    expect(commands.execute).not.toHaveBeenCalled()
  })

  it('shows routes-mode health and recovers an initial Remote failure without a model call', async () => {
    const snapshot = summarizeFeishuHealth({
      now: 900,
      accountId: 'cli_test_app',
      transport: { state: 'ready', connectedAt: 100, lastActivityAt: 800 },
      routes: [{ id: 'feishu-main', workspaceId: 'workspace-a', sessionId, threadScoped: false }],
      outbound: {
        registrations: 1,
        scheduled: 0,
        total: 0,
        prepared: 0,
        sending: 0,
        retrying: 0,
        delivered: 0,
        uncertain: 0,
        failed: 0,
      },
      pendingApprovals: 0,
    })
    const commands = {
      list: vi.fn(() => success([
        { name: 'feishu-pair', description: 'global setup' },
        { name: 'feishu', description: 'bound route health' },
      ])),
      execute: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline' } })
        .mockResolvedValueOnce({ ok: true, value: execution(renderFeishuHealthCommand(snapshot)) })
        .mockResolvedValueOnce({ ok: false, error: { code: 'gateway_unavailable', message: 'offline again' } }),
    } as unknown as PairingCommandsClient
    renderPairing(commands)

    fireEvent.click(await screen.findByRole('button', { name: '飞书健康' }))
    expect((await screen.findByRole('alert')).textContent).toContain('gateway_unavailable: offline')
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))

    expect(await screen.findByText('就绪')).toBeTruthy()
    expect(screen.getByText('official-feishu-websocket')).toBeTruthy()
    expect(screen.getByText('feishu-main')).toBeTruthy()
    expect(screen.getAllByText('0')).toHaveLength(5)
    expect(screen.getByText(/不调用模型/u)).toBeTruthy()
    expect(commands.execute).toHaveBeenNthCalledWith(1, sessionId, '/feishu')
    expect(commands.execute).toHaveBeenNthCalledWith(2, sessionId, '/feishu')

    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline again')
    expect(screen.queryByText('就绪')).toBeNull()
  })

  it('falls back to a selected textarea when the Web clipboard is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu-pair', description: 'pair' }])),
      execute: vi.fn(() => success(execution(`飞书配对窗口已开启\n${phrase}`))),
    } as unknown as PairingCommandsClient
    renderPairing(commands)

    fireEvent.click(await screen.findByRole('button', { name: '连接飞书' }))
    fireEvent.click(screen.getByRole('button', { name: '生成一次性短语' }))
    fireEvent.click(await screen.findByRole('button', { name: '复制短语' }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'))
    expect(writeText).toHaveBeenCalledWith(phrase)
    expect(screen.getByRole('status').textContent).toBe('已复制')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('shows a contained host error and can cancel through the same native command', async () => {
    const commands = {
      list: vi.fn(() => success([{ name: 'feishu-pair', description: 'pair' }])),
      execute: vi.fn((_session: unknown, line: string) => line.endsWith('cancel')
        ? success(execution('飞书配对已取消；没有创建或修改任何 Gateway route。'))
        : success({ commandId: 'command-error', result: { kind: 'error' as const, text: '飞书连接失败。' } })),
    } as unknown as PairingCommandsClient
    renderPairing(commands)

    fireEvent.click(await screen.findByRole('button', { name: '连接飞书' }))
    fireEvent.click(screen.getByRole('button', { name: '生成一次性短语' }))
    expect((await screen.findByRole('alert')).textContent).toContain('飞书连接失败。')
    fireEvent.click(screen.getByRole('button', { name: '取消本次连接' }))
    expect(await screen.findByText(/没有创建或修改任何 Gateway route/u)).toBeTruthy()
  })
})
