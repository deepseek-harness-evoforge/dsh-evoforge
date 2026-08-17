import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { openFeishuDeliveryStore } from '../src/delivery-store.js'

const destination = {
  routeId: 'feishu-main',
  sessionId: 'main',
  chatId: 'oc_main',
}

describe('Feishu durable delivery store', () => {
  it('persists intent and recovers a crashed in-flight send as uncertain', async () => {
    const facility = memoryFacility()
    const first = await openFeishuDeliveryStore(facility)
    const prepared = await first.prepareTurn({
      ...destination,
      turn: 3,
      text: 'final answer',
      replyToMessageId: 'om_inbound',
      now: 100,
    })
    expect(prepared.record).toMatchObject({ status: 'prepared', attempts: 0 })
    await first.markSending(prepared.record.id, 200)
    await first.close()

    const resumed = await openFeishuDeliveryStore(facility)
    await expect(resumed.recoverInflight(300)).resolves.toBe(1)
    expect(resumed.get(prepared.record.id)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      error: expect.stringContaining('automatic retry is disabled'),
    })
  })

  it('deduplicates exact command responses and host notices across restart', async () => {
    const facility = memoryFacility()
    const first = await openFeishuDeliveryStore(facility)
    const response = await first.prepareResponse({
      ...destination,
      eventId: 'message:om_command',
      text: 'Command completed.',
      now: 100,
    })
    await expect(first.prepareResponse({
      ...destination,
      eventId: 'message:om_command',
      text: 'Command completed.',
      now: 101,
    })).resolves.toEqual({ created: false, record: response.record })
    const noticeInput = {
      ...destination,
      noticeId: 'a'.repeat(64),
      text: 'EvoForge attention',
      now: 102,
    }
    const notice = await first.prepareNotice(noticeInput)
    await first.close()
    const resumed = await openFeishuDeliveryStore(facility)
    await expect(resumed.prepareNotice({ ...noticeInput, now: 103 }))
      .resolves.toEqual({ created: false, record: notice.record })
  })

  it('records delivered message ids and bounded rate-limit retry state', async () => {
    const store = await openFeishuDeliveryStore(memoryFacility())
    const delivered = await store.prepareResponse({
      ...destination, eventId: 'message:1', text: 'one', now: 1,
    })
    await store.markSending(delivered.record.id, 2)
    await expect(store.markDelivered(delivered.record.id, 'om_outbound', 3)).resolves.toMatchObject({
      status: 'delivered', feishuMessageId: 'om_outbound', attempts: 1,
    })

    const limited = await store.prepareResponse({
      ...destination, eventId: 'message:2', text: 'two', now: 4,
    })
    await store.markSending(limited.record.id, 5)
    await expect(store.markFailure(
      limited.record.id,
      { kind: 'rate-limited', retryAfterMs: 1_000 },
      6,
      3,
      300_000,
    )).resolves.toMatchObject({ status: 'retrying', nextAttemptAt: 1_006 })
  })

  it('never prunes active effects to satisfy the hard journal bound', async () => {
    const store = await openFeishuDeliveryStore(memoryFacility(), { maxRecords: 1 })
    await store.prepareResponse({ ...destination, eventId: 'message:1', text: 'one', now: 1 })
    await expect(store.prepareResponse({ ...destination, eventId: 'message:2', text: 'two', now: 2 }))
      .rejects.toThrow(/full of active records/u)
  })
})

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  const global = new MemoryGlobal()
  return {
    async open() {
      return {
        name: 'evoforge_feishu',
        global,
        table(name: string) {
          let table = tables.get(name)
          if (table === undefined) {
            table = new MemoryTable()
            tables.set(name, table)
          }
          return table
        },
        async close() {},
      }
    },
  } as unknown as DomainFacility
}

class MemoryGlobal {
  private value: Record<string, unknown> = {}
  get(): Record<string, unknown> { return structuredClone(this.value) }
  async set(value: Record<string, unknown>): Promise<void> { this.value = structuredClone(value) }
}

class MemoryTable<V> implements KvTable<string, V> {
  private readonly records = new Map<string, V>()
  get size(): number { return this.records.size }
  get(key: string): V | undefined { return this.records.get(key) }
  entries(): IterableIterator<[string, V]> { return new Map(this.records).entries() }
  keys(): IterableIterator<string> { return new Map(this.records).keys() }
  async put(key: string, value: V): Promise<void> { this.records.set(key, structuredClone(value)) }
  async delete(key: string): Promise<boolean> { return this.records.delete(key) }
  async update(key: string, fn: (current: V) => V): Promise<V> {
    const current = this.records.get(key)
    if (current === undefined) throw new Error(`missing key ${key}`)
    const next = structuredClone(fn(structuredClone(current)))
    this.records.set(key, next)
    return next
  }
}
