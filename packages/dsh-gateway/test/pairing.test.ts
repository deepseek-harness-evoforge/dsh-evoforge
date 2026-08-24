import type { DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { openGatewayPairingAuthority } from '../src/pairing.js'

const subject = Object.freeze({
  adapter: 'feishu',
  accountId: 'cli_test_app',
  conversationId: 'oc_first_contact',
  userId: 'ou_first_contact',
})

const target = Object.freeze({
  id: 'feishu-first-contact',
  workspaceId: 'workspace-a',
  sessionId: 'session-a',
  agentPreset: 'standard',
  provider: 'deepseek',
  model: 'deepseek-chat',
})

describe('Gateway pairing authority', () => {
  it('persists an unknown DM request and turns one Host approval into a recoverable exact route', async () => {
    const facility = memoryFacility()
    const first = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })

    const offered = await first.offer(subject, 1_000)
    expect(offered).toMatchObject({ kind: 'offered', expiresAt: 901_000 })
    if (offered.kind !== 'offered') throw new Error('pairing code was not offered')
    expect(offered.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/u)
    expect(JSON.stringify(facility.snapshot())).not.toContain(offered.code)

    const approved = await first.approve({
      adapter: 'feishu',
      accountId: 'cli_test_app',
      code: offered.code,
      target,
      now: 2_000,
    })
    expect(approved.route).toMatchObject({
      ...target,
      adapter: 'feishu',
      accountId: 'cli_test_app',
      conversationId: 'oc_first_contact',
      userId: 'ou_first_contact',
    })
    await expect(first.approve({
      adapter: 'feishu',
      accountId: 'cli_test_app',
      code: offered.code,
      target,
      now: 2_001,
    })).rejects.toThrow(/invalid|expired|used/iu)
    await first.close()

    const resumed = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })
    expect(resumed.match(subject)).toMatchObject({
      id: 'feishu-first-contact',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    })
    await resumed.close()
  })
})

function memoryFacility(): DomainFacility & { snapshot(): unknown } {
  const domains = new Map<string, Map<string, Map<unknown, unknown>>>()
  return {
    async open(spec: { name: string }) {
      const tables = domains.get(spec.name) ?? new Map<string, Map<unknown, unknown>>()
      domains.set(spec.name, tables)
      return {
        table(name: string) {
          const values = tables.get(name) ?? new Map<unknown, unknown>()
          tables.set(name, values)
          return {
            get: (key: unknown) => structuredClone(values.get(key)),
            entries: () => [...values.entries()].map(([key, value]) => [key, structuredClone(value)]),
            get size() { return values.size },
            put: async (key: unknown, value: unknown) => { values.set(key, structuredClone(value)) },
            delete: async (key: unknown) => values.delete(key),
            update: async (key: unknown, update: (value: never) => unknown) => {
              if (!values.has(key)) throw new Error(`missing key '${String(key)}'`)
              const next = update(structuredClone(values.get(key)) as never)
              values.set(key, structuredClone(next))
              return structuredClone(next)
            },
          } as unknown as KvTable<string, unknown>
        },
        close: async () => {},
      }
    },
    snapshot: () => [...domains.entries()],
  } as unknown as DomainFacility & { snapshot(): unknown }
}
