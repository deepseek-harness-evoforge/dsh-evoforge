import { describe, expect, it } from 'vitest'
import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { openTelegramDeliveryStore } from '../src/delivery-store.js'

describe('Telegram durable delivery store', () => {
  it('persists intent before send and converts an in-flight restart to uncertain', async () => {
    const facility = memoryFacility()
    const first = await openTelegramDeliveryStore(facility)
    const prepared = await first.prepareTurn({
      now: 100,
      replyToMessageId: 9,
      sessionId: 'main',
      turn: 3,
    })
    expect(prepared.created).toBe(true)
    expect(prepared.record).toMatchObject({ status: 'prepared', attempts: 0 })
    const sending = await first.markSending(prepared.record.id, 200)
    expect(sending).toMatchObject({ status: 'sending', attempts: 1 })
    await first.close()

    const resumed = await openTelegramDeliveryStore(facility)
    await expect(resumed.recoverInflight(300)).resolves.toBe(1)
    expect(resumed.get(prepared.record.id)).toMatchObject({
      status: 'uncertain',
      attempts: 1,
      error: expect.stringContaining('automatic retry is disabled'),
    })
  })

  it('durably admits a command at most once and stores its direct response', async () => {
    const store = await openTelegramDeliveryStore(memoryFacility())
    await expect(store.acceptCommand(77)).resolves.toBe(true)
    await expect(store.acceptCommand(77)).resolves.toBe(false)
    expect(store.hasAcceptedCommand(77)).toBe(true)
    await expect(store.acceptCommand(79)).resolves.toBe(true)
    await expect(store.acceptCommand(78)).resolves.toBe(false)
    expect(store.hasAcceptedCommand(78)).toBe(true)

    const first = await store.prepareCommand({
      now: 102,
      replyToMessageId: 10,
      sessionId: 'main',
      text: 'Goal is active.',
      updateId: 77,
    })
    const duplicate = await store.prepareCommand({
      now: 103,
      replyToMessageId: 10,
      sessionId: 'main',
      text: 'Goal is active.',
      updateId: 77,
    })
    expect(first.created).toBe(true)
    expect(first.record.source).toEqual({ kind: 'command', text: 'Goal is active.', updateId: 77 })
    expect(duplicate).toEqual({ created: false, record: first.record })
  })

  it('deduplicates an exact bounded host notice across reload and restart', async () => {
    const facility = memoryFacility()
    const first = await openTelegramDeliveryStore(facility)
    const notice = {
      id: 'a'.repeat(64),
      now: 104,
      sessionId: 'main',
      text: 'EvoForge attention\nInspect: /evolve review deadbeef',
    }
    const prepared = await first.prepareNotice(notice)
    const duplicate = await first.prepareNotice({ ...notice, now: 105 })
    expect(prepared.created).toBe(true)
    expect(prepared.record.source).toEqual({
      kind: 'notice',
      noticeId: notice.id,
      text: notice.text,
    })
    expect(duplicate).toEqual({ created: false, record: prepared.record })
    await first.close()

    const resumed = await openTelegramDeliveryStore(facility)
    await expect(resumed.prepareNotice({ ...notice, now: 106 }))
      .resolves.toEqual({ created: false, record: prepared.record })
  })

  it('recovers a notice interrupted during send as uncertain without making it retryable', async () => {
    const facility = memoryFacility()
    const first = await openTelegramDeliveryStore(facility)
    const prepared = await first.prepareNotice({
      id: 'b'.repeat(64),
      now: 110,
      sessionId: 'main',
      text: 'EvoForge attention\nInspect: /evolve evaluator deadbeef',
    })
    await first.markSending(prepared.record.id, 111)
    await first.close()

    const resumed = await openTelegramDeliveryStore(facility)
    await expect(resumed.recoverInflight(112)).resolves.toBe(1)
    expect(resumed.get(prepared.record.id)).toMatchObject({
      source: { kind: 'notice', noticeId: 'b'.repeat(64) },
      status: 'uncertain',
      attempts: 1,
      error: expect.stringContaining('automatic retry is disabled'),
    })
  })

  it('bounds terminal delivery history for long-running use', async () => {
    const store = await openTelegramDeliveryStore(memoryFacility(), { maxRecords: 2 })

    for (let updateId = 1; updateId <= 3; updateId += 1) {
      await store.acceptCommand(updateId)
      const prepared = await store.prepareCommand({
        now: updateId,
        sessionId: 'main',
        text: `reply-${updateId}`,
        updateId,
      })
      await store.markLocallyFailed(prepared.record.id, 'test terminal result', updateId + 10)
    }

    // A later prepare performs bounded compaction without touching live records.
    await store.prepareTurn({ now: 20, sessionId: 'main', turn: 1 })
    expect(store.list().filter(record => record.status !== 'prepared')).toHaveLength(1)

    const live = await openTelegramDeliveryStore(memoryFacility(), { maxRecords: 2 })
    const pending = []
    for (let turn = 1; turn <= 3; turn += 1) {
      pending.push((await live.prepareTurn({ now: turn, sessionId: 'main', turn })).record)
    }
    expect(live.list()).toHaveLength(3)
    for (const record of pending) {
      await live.markLocallyFailed(record.id, 'terminal', 30)
    }
    expect(live.list()).toHaveLength(2)
  })
})

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  const global = new MemoryGlobal()
  return {
    async open() {
      return {
        name: 'evoforge_telegram',
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
