import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import { GitHubReviewClient } from '../src/github-client.js'
import { GitHubReviewRuntime } from '../src/runtime.js'
import { openGitHubReviewStore } from '../src/review-store.js'

describe('GitHub review follow-up runtime', () => {
  it('appends one durable follow-up to the exact originating Session and deduplicates rescans', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', memoryBackend(recordsByTable))
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    const agent = stubAgent('coder', 'coder')
    const unregister = ctx.agents.register(agent)
    await store.upsertWatch({
      agentId: 'coder',
      sessionId: 'coder',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    }, 100)
    const reviewResponse = [{
        id: 91,
        state: 'CHANGES_REQUESTED',
        body: 'Please keep the cache prefix stable.',
        commit_id: 'b'.repeat(40),
        submitted_at: '2026-08-17T04:00:00Z',
        html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
        user: { login: 'alice', type: 'User' },
      }]
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes('/comments')
      ? jsonResponse([])
      : jsonResponse(reviewResponse, { etag: '"reviews-v1"' }))
    const runtime = new GitHubReviewRuntime(
      ctx,
      store,
      new GitHubReviewClient({ fetcher }),
      { trustedReviewers: ['alice'], maxTextChars: 6_000, maxComments: 20 },
      { now: () => 200 },
    )

    try {
      await runtime.scanOnce()
      await runtime.scanOnce()

      expect(agent.inbox.nextTurn).toHaveLength(1)
      expect(agent.inbox.nextTurn[0]).toMatchObject({
        id: expect.stringMatching(/^github-review:[a-f0-9]{64}$/u),
        role: 'user',
        source: { kind: 'user' },
      })
      expect(agent.inbox.nextTurn[0]?.content).toEqual([{
        type: 'text',
        text: expect.stringContaining('untrusted external data'),
      }])
      expect(store.listFollowups()).toEqual([
        expect.objectContaining({ status: 'delivered', sessionId: 'coder', reviewId: 91 }),
      ])
    } finally {
      await runtime.dispose()
      unregister()
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('keeps a prepared follow-up recoverable when native Agent acceptance fails transiently', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', memoryBackend(recordsByTable))
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    const agent = stubAgent('coder', 'coder')
    const accept = agent.followup.bind(agent)
    let unavailable = true
    agent.followup = message => {
      if (unavailable) throw new Error('agent loop is restarting')
      accept(message)
    }
    const unregister = ctx.agents.register(agent)
    await store.upsertWatch({
      agentId: 'coder',
      sessionId: 'coder',
      owner: 'org',
      repo: 'repo',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    }, 100)
    const reviews = [{
      id: 91,
      state: 'CHANGES_REQUESTED',
      body: 'Please revise this.',
      commit_id: 'b'.repeat(40),
      submitted_at: '2026-08-17T04:00:00Z',
      html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
      user: { login: 'alice', type: 'User' },
    }]
    const client = new GitHubReviewClient({
      fetcher: vi.fn<typeof fetch>(async url => String(url).includes('/comments')
        ? jsonResponse([])
        : jsonResponse(reviews)),
    })
    const runtime = new GitHubReviewRuntime(
      ctx,
      store,
      client,
      { trustedReviewers: ['alice'], maxTextChars: 6_000, maxComments: 20 },
      { now: () => 200 },
    )

    try {
      const interrupted = await runtime.scanOnce()
      expect(interrupted.unknown).toEqual([
        'org/repo#26: native Agent follow-up failed: agent loop is restarting',
      ])
      expect(store.listFollowups()).toEqual([expect.objectContaining({ status: 'prepared' })])

      unavailable = false
      const recovered = await runtime.scanOnce()
      expect(recovered.delivered).toBe(1)
      expect(agent.inbox.nextTurn).toHaveLength(1)
      expect(store.listFollowups()).toEqual([expect.objectContaining({ status: 'delivered' })])
    } finally {
      await runtime.dispose()
      unregister()
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('settles without redelivery after a crash between Agent acceptance and durable settlement', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', memoryBackend(recordsByTable))
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    const agent = stubAgent('coder', 'coder')
    const followup = vi.spyOn(agent, 'followup')
    const unregister = ctx.agents.register(agent)
    const watch = await store.upsertWatch({
      agentId: 'coder', sessionId: 'coder', owner: 'org', repo: 'repo',
      pullNumber: 26, headCommit: 'b'.repeat(40),
    }, 100)
    const id = 'e'.repeat(64)
    await store.prepareFollowup(watch, {
      id,
      messageId: `github-review:${id}`,
      reviewId: 91,
      reviewer: 'alice',
      text: 'already accepted before process crash',
    }, 150)
    agent.inbox.append('next-turn', {
      id: `github-review:${id}` as never,
      role: 'user',
      content: [{ type: 'text', text: 'already accepted before process crash' }],
      source: { kind: 'user' },
    })
    const runtime = new GitHubReviewRuntime(
      ctx,
      store,
      { read: vi.fn(async () => ({ kind: 'not-modified' as const })) } as never,
      { trustedReviewers: ['alice'], maxTextChars: 6_000, maxComments: 20 },
      { now: () => 200 },
    )

    try {
      const recovered = await runtime.scanOnce()

      expect(recovered.delivered).toBe(1)
      expect(followup).not.toHaveBeenCalled()
      expect(agent.inbox.nextTurn).toHaveLength(1)
      expect(store.listFollowups()).toEqual([expect.objectContaining({ status: 'delivered' })])
    } finally {
      await runtime.dispose()
      unregister()
      await store.close()
      await ctx.fiber.dispose()
    }
  })
})

function stubAgent(rawId: string, rawSessionId: string): Agent {
  const session = Session.create(SessionId(rawSessionId))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: SessionId(rawId),
    options: {},
    session,
    inbox,
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: message => { inbox.append('next-turn', message) },
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function memoryBackend(recordsByTable: Map<string, Map<string, unknown>>) {
  return {
    kv: {
      open: async (descriptor: { tables: readonly string[] }) => ({
        loadAll: async () => ({
          tables: Object.fromEntries(descriptor.tables.map(table => [
            table,
            Object.fromEntries(recordsByTable.get(table) ?? []),
          ])),
          global: null,
        }),
        putRecord: async (table: string, key: string, value: unknown) => {
          let records = recordsByTable.get(table)
          if (records === undefined) {
            records = new Map()
            recordsByTable.set(table, records)
          }
          records.set(key, value)
        },
        deleteRecord: async (table: string, key: string) => { recordsByTable.get(table)?.delete(key) },
        setGlobal: async () => {},
        close: async () => {},
      }),
    },
    close: async () => {},
  }
}

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}
