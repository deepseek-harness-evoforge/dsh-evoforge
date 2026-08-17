import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

describe('dsh-github-review plugin lifecycle', () => {
  it('turns a newly completed Draft PR watch into an immediate follow-up and disposes cleanly', async () => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url?.includes('/reviews?')) {
        response.setHeader('etag', '"reviews-v1"')
        response.end(JSON.stringify([{
          id: 91,
          state: 'CHANGES_REQUESTED',
          body: 'Please keep the cache prefix stable.',
          commit_id: 'b'.repeat(40),
          submitted_at: '2026-08-17T04:00:00Z',
          html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
          user: { login: 'alice', type: 'User' },
        }]))
        return
      }
      if (request.url?.includes('/comments?')) {
        response.end('[]')
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')

    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', memoryBackend(recordsByTable))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('tools', {} as never)
    const agent = stubAgent('coder')
    ctx.agents.register(agent)

    try {
      await apply(ctx, {
        agentId: 'coder',
        owner: 'org',
        repo: 'repo',
        trustedReviewers: ['alice'],
        apiBase: `http://127.0.0.1:${address.port}`,
        pollIntervalSeconds: 60,
      })
      emitToolResult(ctx, execution(agent), successfulDelivery())

      await vi.waitFor(() => {
        expect(agent.inbox.nextTurn).toHaveLength(1)
      }, { timeout: 2_000, interval: 10 })
      expect(requests).toEqual([
        '/repos/org/repo/pulls/26/reviews?per_page=100&page=1',
        '/repos/org/repo/pulls/26/reviews/91/comments?per_page=100&page=1',
      ])
    } finally {
      await ctx.fiber.dispose()
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })
})

function stubAgent(rawId: string): Agent {
  const id = SessionId(rawId)
  const session = Session.create(id)
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id,
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

function execution(agent: Agent) {
  return {
    callId: 'delivery-1',
    rootCallId: 'delivery-1',
    name: 'complete_delivery',
    arguments: {},
    agent,
    signal: new AbortController().signal,
    token: Symbol('delivery-1'),
  }
}

function successfulDelivery() {
  return {
    isError: false,
    value: {
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      goal: { id: 'goal-1', revision: 4, phase: 'complete' },
      artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature' },
      repository: {},
      checks: [],
      draftPr: {
        status: 'passed',
        artifact: { number: 26, commit: 'b'.repeat(40) },
      },
    },
    content: [],
  }
}

function emitToolResult(ctx: Context, executionValue: object, result: object): void {
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', executionValue, result)
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
