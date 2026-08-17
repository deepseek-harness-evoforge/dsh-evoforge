import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { openGitHubReviewStore } from '../src/review-store.js'

describe('GitHub review durable store', () => {
  it('keeps one exact PR watch and clears its conditional-read cursor when delivery advances the head', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const records = new Map<string, unknown>()
    ctx.storage.backend.register('memory', {
      kv: {
        open: async () => ({
          loadAll: async () => ({ tables: { watches: Object.fromEntries(records) }, global: null }),
          putRecord: async (_table, key, value) => { records.set(key, value) },
          deleteRecord: async (_table, key) => { records.delete(key) },
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    const store = await openGitHubReviewStore(facility)
    try {
      const first = await store.upsertWatch({
        agentId: 'coder',
        sessionId: 'session-1',
        owner: 'org',
        repo: 'repo',
        pullNumber: 26,
        headCommit: 'a'.repeat(40),
      }, 100)
      await store.setEtag(first, '"reviews-v1"', 110)
      const repeated = await store.upsertWatch({
        agentId: 'coder',
        sessionId: 'session-1',
        owner: 'org',
        repo: 'repo',
        pullNumber: 26,
        headCommit: 'a'.repeat(40),
      }, 120)
      const retargeted = await store.upsertWatch({
        agentId: 'coder',
        sessionId: 'session-1',
        owner: 'org',
        repo: 'repo',
        pullNumber: 27,
        headCommit: 'a'.repeat(40),
      }, 125)
      await expect(store.setEtag(first, '"stale"', 126))
        .rejects.toThrow('watch changed')
      const advanced = await store.upsertWatch({
        agentId: 'coder',
        sessionId: 'session-1',
        owner: 'org',
        repo: 'repo',
        pullNumber: 27,
        headCommit: 'b'.repeat(40),
      }, 130)

      expect(repeated).toMatchObject({ id: first.id, etag: '"reviews-v1"', updatedAt: 110 })
      expect(retargeted).toMatchObject({
        id: first.id,
        pullNumber: 27,
        headCommit: 'a'.repeat(40),
        updatedAt: 125,
      })
      expect(retargeted.etag).toBeUndefined()
      expect(advanced).toMatchObject({
        id: first.id,
        headCommit: 'b'.repeat(40),
        sessionId: 'session-1',
        updatedAt: 130,
      })
      expect(advanced.etag).toBeUndefined()
      expect(store.listWatches()).toEqual([advanced])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('prepares a content-addressed follow-up once and settles it after native Agent acceptance', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', {
      kv: {
        open: async descriptor => ({
          loadAll: async () => ({
            tables: Object.fromEntries(descriptor.tables.map(table => [
              table,
              Object.fromEntries(recordsByTable.get(table) ?? []),
            ])),
            global: null,
          }),
          putRecord: async (table, key, value) => {
            let records = recordsByTable.get(table)
            if (records === undefined) {
              records = new Map()
              recordsByTable.set(table, records)
            }
            records.set(key, value)
          },
          deleteRecord: async (table, key) => { recordsByTable.get(table)?.delete(key) },
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    try {
      const watch = await store.upsertWatch({
        agentId: 'coder',
        sessionId: 'session-1',
        owner: 'org',
        repo: 'repo',
        pullNumber: 26,
        headCommit: 'a'.repeat(40),
      }, 100)
      const followup = {
        id: 'c'.repeat(64),
        messageId: `github-review:${'c'.repeat(64)}`,
        reviewId: 91,
        reviewer: 'alice',
        text: 'bounded untrusted review',
      }
      const first = await store.prepareFollowup(watch, followup, 200)
      const repeated = await store.prepareFollowup(watch, followup, 300)
      const delivered = await store.markDelivered(followup.id, 400)

      expect(first.created).toBe(true)
      expect(repeated).toEqual({ created: false, record: first.record })
      expect(delivered).toMatchObject({ status: 'delivered', updatedAt: 400 })
      expect(store.listFollowups(['prepared'])).toEqual([])
      expect(store.listFollowups(['delivered'])).toEqual([delivered])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('replaces the configured Agent current Draft PR instead of accumulating historical poll targets', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', {
      kv: {
        open: async descriptor => ({
          loadAll: async () => ({
            tables: Object.fromEntries(descriptor.tables.map(table => [
              table,
              Object.fromEntries(recordsByTable.get(table) ?? []),
            ])),
            global: null,
          }),
          putRecord: async (table, key, value) => {
            let records = recordsByTable.get(table)
            if (records === undefined) recordsByTable.set(table, records = new Map())
            records.set(key, value)
          },
          deleteRecord: async (table, key) => { recordsByTable.get(table)?.delete(key) },
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    try {
      const first = await store.upsertWatch({
        agentId: 'coder', sessionId: 'coder', owner: 'org', repo: 'repo',
        pullNumber: 26, headCommit: 'a'.repeat(40),
      }, 100)
      await store.prepareFollowup(first, {
        id: 'd'.repeat(64),
        messageId: `github-review:${'d'.repeat(64)}`,
        reviewId: 91,
        reviewer: 'alice',
        text: 'old review',
      }, 150)
      const second = await store.upsertWatch({
        agentId: 'coder', sessionId: 'coder', owner: 'org', repo: 'repo',
        pullNumber: 27, headCommit: 'a'.repeat(40),
      }, 200)
      await expect(store.prepareFollowup(first, {
        id: 'e'.repeat(64),
        messageId: `github-review:${'e'.repeat(64)}`,
        reviewId: 92,
        reviewer: 'alice',
        text: 'stale PR review',
      }, 210)).rejects.toThrow('watch changed')

      expect(second.id).toBe(first.id)
      expect(store.listWatches()).toEqual([expect.objectContaining({
        pullNumber: 27,
        headCommit: 'a'.repeat(40),
      })])
      expect(store.listFollowups()).toEqual([expect.objectContaining({ status: 'superseded' })])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('bounds terminal history without deleting recoverable prepared follow-ups', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', {
      kv: {
        open: async descriptor => ({
          loadAll: async () => ({
            tables: Object.fromEntries(descriptor.tables.map(table => [
              table,
              Object.fromEntries(recordsByTable.get(table) ?? []),
            ])),
            global: null,
          }),
          putRecord: async (table, key, value) => {
            let records = recordsByTable.get(table)
            if (records === undefined) recordsByTable.set(table, records = new Map())
            records.set(key, value)
          },
          deleteRecord: async (table, key) => { recordsByTable.get(table)?.delete(key) },
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
      { maxTerminalRecords: 2 },
    )
    try {
      const watch = await store.upsertWatch({
        agentId: 'coder', sessionId: 'coder', owner: 'org', repo: 'repo',
        pullNumber: 26, headCommit: 'a'.repeat(40),
      }, 100)
      for (let index = 0; index < 4; index += 1) {
        const id = String(index + 1).repeat(64)
        await store.prepareFollowup(watch, {
          id,
          messageId: `github-review:${id}`,
          reviewId: index + 1,
          reviewer: 'alice',
          text: `review ${index + 1}`,
        }, 200 + index)
        if (index < 3) await store.markDelivered(id, 300 + index)
      }

      expect(store.listFollowups(['prepared'])).toEqual([
        expect.objectContaining({ reviewId: 4, status: 'prepared' }),
      ])
      expect(store.listFollowups(['delivered']).map(record => record.reviewId)).toEqual([2, 3])
      expect(store.listFollowups()).toHaveLength(3)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('supersedes an older undelivered edit of the same review', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    const recordsByTable = new Map<string, Map<string, unknown>>()
    ctx.storage.backend.register('memory', {
      kv: {
        open: async descriptor => ({
          loadAll: async () => ({
            tables: Object.fromEntries(descriptor.tables.map(table => [
              table,
              Object.fromEntries(recordsByTable.get(table) ?? []),
            ])),
            global: null,
          }),
          putRecord: async (table, key, value) => {
            let records = recordsByTable.get(table)
            if (records === undefined) recordsByTable.set(table, records = new Map())
            records.set(key, value)
          },
          deleteRecord: async (table, key) => { recordsByTable.get(table)?.delete(key) },
          setGlobal: async () => {},
          close: async () => {},
        }),
      },
      close: async () => {},
    })
    const store = await openGitHubReviewStore(
      new DomainFacility(ctx, { backend: 'memory', routes: {} }),
    )
    try {
      const watch = await store.upsertWatch({
        agentId: 'coder', sessionId: 'coder', owner: 'org', repo: 'repo',
        pullNumber: 26, headCommit: 'a'.repeat(40),
      }, 100)
      await store.prepareFollowup(watch, {
        id: 'a'.repeat(64), messageId: `github-review:${'a'.repeat(64)}`,
        reviewId: 91, reviewer: 'alice', text: 'first review body',
      }, 200)
      await store.prepareFollowup(watch, {
        id: 'b'.repeat(64), messageId: `github-review:${'b'.repeat(64)}`,
        reviewId: 91, reviewer: 'alice', text: 'edited review body',
      }, 300)

      expect(store.listFollowups(['prepared'])).toEqual([
        expect.objectContaining({ id: 'b'.repeat(64), text: 'edited review body' }),
      ])
      expect(store.listFollowups(['superseded'])).toEqual([
        expect.objectContaining({ id: 'a'.repeat(64), text: 'first review body' }),
      ])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })
})
