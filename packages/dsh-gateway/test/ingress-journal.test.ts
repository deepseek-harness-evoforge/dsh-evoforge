import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { openGatewayIngressJournal } from '../src/ingress-journal.js'

const intent = {
  id: 'a'.repeat(64),
  routeId: 'telegram-a',
  workspaceId: 'workspace-a',
  sessionId: 'channel-session-a',
  eventHash: 'b'.repeat(64),
  contentHash: 'c'.repeat(64),
  kind: 'command' as const,
  now: 100,
}

describe('gateway ingress journal', () => {
  it('persists intent, exact duplicate outcome, and rejects identity drift', async () => {
    const journal = await openGatewayIngressJournal(memoryFacility())
    const prepared = await journal.prepare(intent)
    expect(prepared).toMatchObject({ created: true, record: { status: 'prepared' } })
    await expect(journal.begin(intent.id, 110)).resolves.toMatchObject({ status: 'executing' })
    await expect(journal.settleCommand(intent.id, {
      kind: 'success',
      text: 'Goal active.',
    }, 120)).resolves.toMatchObject({
      status: 'settled',
      commandResult: { kind: 'success', text: 'Goal active.' },
    })
    await expect(journal.prepare({ ...intent, now: 130 })).resolves.toMatchObject({
      created: false,
      record: { status: 'settled' },
    })
    await expect(journal.prepare({ ...intent, contentHash: 'd'.repeat(64), now: 140 }))
      .rejects.toThrow('content changed')
  })

  it('recovers a command interrupted at the effect boundary as uncertain', async () => {
    const facility = memoryFacility()
    const first = await openGatewayIngressJournal(facility)
    await first.prepare(intent)
    await first.begin(intent.id, 110)
    await first.close()

    const resumed = await openGatewayIngressJournal(facility)
    await expect(resumed.recoverInflight(200)).resolves.toBe(1)
    expect(resumed.get(intent.id)).toMatchObject({
      status: 'uncertain',
      error: expect.stringContaining('must not be retried'),
    })
  })

  it('fails closed instead of exceeding the journal bound with a live effect', async () => {
    const journal = await openGatewayIngressJournal(memoryFacility(), { maxRecords: 1 })
    await journal.prepare(intent)
    await expect(journal.prepare({ ...intent, id: 'd'.repeat(64), eventHash: 'e'.repeat(64) }))
      .rejects.toThrow('journal is full')
    await journal.begin(intent.id, 110)
    await journal.settleCommand(intent.id, { kind: 'success' }, 120)
    await expect(journal.prepare({
      ...intent, id: 'd'.repeat(64), eventHash: 'e'.repeat(64), now: 130,
    })).resolves.toMatchObject({ created: true })
    expect(journal.get(intent.id)).toBeUndefined()
  })
})

function memoryFacility(): DomainFacility {
  const tables = new Map<string, MemoryTable<unknown>>()
  const global = new MemoryGlobal()
  return {
    async open() {
      return {
        name: 'evoforge_gateway',
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
