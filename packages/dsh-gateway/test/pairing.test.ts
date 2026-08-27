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
  it('exposes only redacted pending metadata and supports exact request-id approval', async () => {
    const facility = memoryFacility()
    const pairing = await openGatewayPairingAuthority(facility, {
      codeTtlMs: 15 * 60_000,
      maxPendingPerAccount: 3,
    })

    const offered = await pairing.offer(subject, 1_000)
    expect(offered.kind).toBe('offered')
    const pending = pairing.pending(2_000)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      adapter: 'feishu', createdAt: 1_000, expiresAt: 901_000,
      accountIdHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(pending[0]?.accountIdHash).not.toContain(subject.accountId)
    expect(JSON.stringify(pending[0])).not.toContain(subject.conversationId)
    expect(JSON.stringify(pending[0])).not.toContain(subject.userId)

    const approved = await pairing.approveRequest({
      requestId: pending[0]!.requestId,
      target,
      now: 2_000,
    })
    expect(approved.route).toMatchObject({
      id: target.id,
      adapter: subject.adapter,
      accountId: subject.accountId,
      conversationId: subject.conversationId,
      userId: subject.userId,
    })
    expect(pairing.pending(2_001)).toEqual([])
    await expect(pairing.approveRequest({ requestId: pending[0]!.requestId, target, now: 2_001 }))
      .rejects.toThrow(/invalid|expired|used/iu)
    await pairing.close()
  })

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
    await expect(resumed.revoke('feishu-first-contact', 3_000)).resolves.toEqual({
      routeId: 'feishu-first-contact',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      revokedAt: 3_000,
      alreadyRevoked: false,
    })
    expect(resumed.match(subject)).toBeUndefined()
    expect(resumed.routes()).toEqual([])
    await expect(resumed.revoke('feishu-first-contact', 3_001)).resolves.toMatchObject({
      routeId: 'feishu-first-contact', alreadyRevoked: true, revokedAt: 3_000,
    })
    await expect(resumed.offer(subject, 4_000)).resolves.toMatchObject({ kind: 'offered' })
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
