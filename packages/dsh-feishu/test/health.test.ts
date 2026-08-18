import { describe, expect, it } from 'vitest'
import {
  parseFeishuHealthCommand,
  renderFeishuHealthCommand,
  summarizeFeishuHealth,
} from '../src/health.js'

describe('Feishu authoritative health snapshot', () => {
  it('filters the durable journal to one native Session and exposes no endpoint or content', () => {
    const snapshot = summarizeFeishuHealth({
      now: 900,
      accountId: 'cli_test_app',
      transport: {
        state: 'ready',
        connectedAt: 100,
        lastActivityAt: 800,
        lastErrorAt: 700,
      },
      routes: [{ id: 'feishu-main', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: false }],
      records: [
        delivery('a', 'feishu-main', 'session-a', 'delivered', 2, 500),
        delivery('b', 'feishu-main', 'session-a', 'retrying', 1, 600),
        delivery('c', 'another-route', 'session-b', 'failed', 3, 700),
      ],
      scheduled: 1,
      pendingApprovals: 2,
    })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      observedAt: 900,
      accountId: 'cli_test_app',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      status: 'busy',
      transport: {
        kind: 'official-feishu-websocket',
        state: 'ready',
        connectedAt: 100,
        lastActivityAt: 800,
        lastErrorAt: 700,
      },
      routeCount: 1,
      routesTruncated: false,
      routes: [{ id: 'feishu-main', threadScoped: false }],
      deliveries: {
        total: 2,
        prepared: 0,
        sending: 0,
        retrying: 1,
        delivered: 1,
        uncertain: 0,
        failed: 0,
        scheduled: 1,
        last: { id: 'b', routeId: 'feishu-main', source: 'response', status: 'retrying', attempts: 1, updatedAt: 600 },
      },
      pendingApprovals: 2,
      modelCalls: 0,
      authority: 'native-dsh-command',
    })
    const rendered = renderFeishuHealthCommand(snapshot)
    expect(rendered).toContain('Feishu: BUSY')
    expect(parseFeishuHealthCommand(rendered)).toEqual(snapshot)
    expect(rendered).not.toContain('oc_secret_chat')
    expect(rendered).not.toContain('ou_secret_user')
    expect(rendered).not.toContain('private answer')
  })

  it('makes ambiguous or terminal effects visible and rejects malformed browser payloads', () => {
    const connecting = summarizeFeishuHealth({
      now: 99,
      accountId: 'cli_test_app',
      transport: { state: 'connecting' },
      routes: [{ id: 'main', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: true }],
      records: [],
      scheduled: 0,
      pendingApprovals: 0,
    })
    expect(connecting.status).toBe('busy')

    const attention = summarizeFeishuHealth({
      now: 1_000,
      accountId: 'cli_test_app',
      transport: { state: 'ready', connectedAt: 100 },
      routes: [{ id: 'main', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: true }],
      records: [delivery('x', 'main', 'session-a', 'uncertain', 1, 999)],
      scheduled: 0,
      pendingApprovals: 0,
    })
    expect(attention.status).toBe('attention')

    const degraded = summarizeFeishuHealth({
      now: 1_001,
      accountId: 'cli_test_app',
      transport: { state: 'degraded', connectedAt: 100, lastErrorAt: 1_000 },
      routes: [{ id: 'main', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: true }],
      records: [],
      scheduled: 0,
      pendingApprovals: 0,
    })
    expect(degraded.status).toBe('degraded')
    expect(() => parseFeishuHealthCommand('EVOFORGE_FEISHU_HEALTH_V1 {"schemaVersion":2}'))
      .toThrow(/invalid health payload/u)
    expect(() => summarizeFeishuHealth({
      now: 1_002,
      accountId: 'cli_test_app',
      transport: { state: 'ready' },
      routes: [
        { id: 'one', workspaceId: 'workspace-a', sessionId: 'session-a', threadScoped: false },
        { id: 'two', workspaceId: 'workspace-b', sessionId: 'session-a', threadScoped: false },
      ],
      records: [],
      scheduled: 0,
      pendingApprovals: 0,
    })).toThrow(/one native Workspace and Session/u)
  })
})

function delivery(
  id: string,
  routeId: string,
  sessionId: string,
  status: 'prepared' | 'sending' | 'retrying' | 'delivered' | 'uncertain' | 'failed',
  attempts: number,
  updatedAt: number,
) {
  return {
    id,
    schemaVersion: 1 as const,
    routeId,
    sessionId,
    chatId: 'oc_secret_chat',
    source: { kind: 'response' as const, eventId: `event-${id}`, text: 'private answer' },
    status,
    attempts,
    createdAt: updatedAt - 1,
    updatedAt,
  }
}
