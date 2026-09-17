import { createHash } from 'node:crypto'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { digest } from '../src/conversation-correction-intake.ts'
import type { ConversationDraftRecord } from '../src/conversation-skill-draft.ts'
import { openConversationDraftTrialStore } from '../src/conversation-draft-trial-store.ts'
import { executeConversationDraftTrial } from '../src/conversation-draft-trial-monitor.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

function fixture() {
  const rows = new Map<string, unknown>()
  let writesFail = false
  const facility = { async open() { return { close: async () => {}, table: () => ({
    get size() { return rows.size }, get: (key: string) => structuredClone(rows.get(key)),
    entries: () => [...rows].map(([key, value]) => [key, structuredClone(value)]),
    put: async (key: string, value: unknown) => { if (writesFail) throw new Error('write failed'); rows.set(key, structuredClone(value)) },
  }) } } } as unknown as DomainFacility
  return { rows, facility, fail: () => { writesFail = true } }
}

const markdown = '---\nname: item-sections\ndescription: "Use short report sections"\n---\n\nPreserve every fact, unknown state and explicit user choice.\n'
const governance = { scope: 'Improve narrow report reading without changing unrelated responses.',
  cases: ['h1', 'h2', 'r1', 'r2'].map((id, i) => ({
    id, partition: i < 2 ? 'holdout' as const : 'retention' as const,
    input: `Self-contained private task ${id}: keep fact ${id}.`, mustInclude: [id], mustNotInclude: ['fabricated'],
    layout: 'any' as const, referenceAnswer: id, alternateAnswer: `Fact: ${id}`, negativeAnswer: 'fabricated',
  })) }
const source: ConversationDraftRecord = {
  schemaVersion: 1, id: 'a'.repeat(64), workspaceId: WORKSPACE_ID, correctionId: 'b'.repeat(64),
  sourceDigest: 'c'.repeat(64), sourceSessionId: 'source', sourceTurn: 3, inputDigest: 'd'.repeat(64),
  reservedAt: 100, reservedModelCalls: 2, phase: 'draft', modelCalls: 2, usages: [],
  governance, governanceDigest: digest(governance),
  draft: { name: 'item-sections', description: 'Use short report sections', markdown,
    contentHash: createHash('sha256').update(markdown).digest('hex'), lifecycle: 'inactive', verification: 'unevaluated', releaseAuthority: 'none' },
}
const route = { provider: 'fixed', model: 'fixed' }
const policy = { workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 24 }

it('persists an unqualified evaluator without spending budget or permitting execution, retry or cold resume', async () => {
  for (const alternateAnswer of [undefined, 'wrong']) {
    const f = fixture(), store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
    const unqualified = { ...governance, cases: governance.cases.map(test => {
      const { alternateAnswer: _, ...rest } = test
      return { ...rest, ...(alternateAnswer === undefined ? {} : { alternateAnswer }) }
    }) }
    const legacy = { ...source, governance: unqualified, governanceDigest: digest(unqualified) }
    const record = (await store.reserve(legacy, route))!
    expect(record).toMatchObject({ phase: 'blocked', reason: 'evaluator-unqualified', reservedModelCalls: 0 })
    expect(record.legs.every(leg => leg.phase === 'pending' && leg.dispatchMarkers === 0 && leg.result === undefined)).toBe(true)
    expect(await executeConversationDraftTrial({} as Context, store, record, legacy, '/unused', new AbortController().signal,
      () => { throw new Error('blocked plan must not reach execution') })).toEqual(record)
    await expect(store.startLeg(record, 0)).rejects.toThrow()
    expect(store.canReserve(legacy)).toBe(false)
    expect(store.summarize(WORKSPACE_ID)).toMatchObject({ reservedModelCallsToday: 0, pendingCount: 0, uncertainCount: 0 })
    await store.close()
    const reopened = await openConversationDraftTrialStore(f.facility, [policy], () => 86_401_000)
    expect(reopened.records(WORKSPACE_ID)).toEqual([record])
    expect(await reopened.reserve(legacy, route)).toBeUndefined()
    await expect(openConversationDraftTrialStore(f.facility, [{ ...policy,
      retryFailedTrials: [{ trialId: record.id, expiresAt: 86_402_000 }] }], () => 86_401_000)).rejects.toThrow('grant')
  }
})

it('records evaluator rejection even when another trial exhausted the daily budget', async () => {
  const f = fixture(), store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  await store.reserve(source, route)
  const legacy = { ...governance, cases: governance.cases.map(({ alternateAnswer: _, ...test }) => test) }
  const rejected = await store.reserve({ ...source, id: 'e'.repeat(64), governance: legacy, governanceDigest: digest(legacy) }, route)
  expect(rejected?.phase).toBe('blocked')
  expect(store.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(24)
})

it('reserves every leg before dispatch and prevents concurrent or next-day re-evaluation', async () => {
  const f = fixture(), store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  const attempts = await Promise.all([1, 2].map(() => store.reserve(source, route)))
  const plan = attempts.find(value => value !== undefined)!
  expect(attempts.filter(Boolean)).toHaveLength(1)
  expect(plan.legs).toHaveLength(8)
  expect(plan.reservedModelCalls).toBe(24)
  expect(new Set(plan.legs.map(leg => leg.sessionId)).size).toBe(8)
  expect(plan.legs.map(leg => leg.variant)).toEqual(['baseline', 'draft', 'draft', 'baseline', 'baseline', 'draft', 'draft', 'baseline'])
  expect(store.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(24)
  expect(await store.reserve({ ...source, id: 'e'.repeat(64) }, route)).toBeUndefined()
  await store.close()
  const reopened = await openConversationDraftTrialStore(f.facility, [policy], () => 86_401_000)
  expect(reopened.records(WORKSPACE_ID)[0]?.phase).toBe('uncertain')
  expect(await reopened.reserve(source, route)).toBeUndefined()
  expect(reopened.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(0)
})

it('requires persisted contiguous dispatch markers and closes on failed writes', async () => {
  const f = fixture(), store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  let plan = (await store.reserve(source, route))!
  await expect(store.markDispatch(plan, 0, 2)).rejects.toThrow()
  plan = await store.startLeg(plan, 0)
  plan = await store.markDispatch(plan, 0, 1)
  expect(plan.legs[0]?.dispatchMarkers).toBe(1)
  f.fail()
  await expect(store.markDispatch(plan, 0, 2)).rejects.toThrow('write failed')
  expect(store.summarize(WORKSPACE_ID).observerAvailable).toBe(false)
  await expect(store.markDispatch(plan, 0, 2)).rejects.toThrow()
})

it('keeps private inputs and answers outside the public view, with no release authority', async () => {
  const f = fixture(), store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  await store.reserve(source, route)
  const view = store.summarize(WORKSPACE_ID)
  expect(JSON.stringify(view)).not.toContain('private task')
  expect(JSON.stringify(view)).not.toContain('referenceAnswer')
  expect(view.releaseAuthority).toBe('none')
})

it('requires a configured budget and rejects invalid sealed draft content', async () => {
  const f = fixture(), disabled = await openConversationDraftTrialStore(f.facility, [], () => 1000)
  expect(await disabled.reserve(source, route)).toBeUndefined()
  const store = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  await expect(store.reserve({ ...source, governanceDigest: 'f'.repeat(64) }, route)).rejects.toThrow()
  await expect(openConversationDraftTrialStore(f.facility, [{ ...policy, maxModelCallsPerUtcDay: 23 }])).rejects.toThrow()
})

it('allows exactly one explicit zero-dispatch recovery with frozen cases and both reservations retained', async () => {
  const f = fixture(), first = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  let root = (await first.reserve(source, route))!
  root = await first.startLeg(root, 0)
  root = await first.interrupt(root, 'execution-failed')
  await first.close()
  const grant = { trialId: root.id, expiresAt: 10_000 }
  const recoveryPolicy = { ...policy, maxModelCallsPerUtcDay: 48, retryFailedTrials: [grant] }
  const recovered = await openConversationDraftTrialStore(f.facility, [recoveryPolicy], () => 2000)
  const attempts = await Promise.all([1, 2].map(() => recovered.reserve(source, route)))
  const child = attempts.find(value => value !== undefined)!
  expect(attempts.filter(Boolean)).toHaveLength(1)
  expect(child.retryOf).toBe(root.id)
  expect(child.draftSnapshotDigest).toBe(root.draftSnapshotDigest)
  expect(child.governanceDigest).toBe(root.governanceDigest)
  expect(child.legs.map(({ sessionId, ...leg }) => leg)).toEqual(root.legs.map(({ sessionId, ...leg }) => ({ ...leg, phase: 'pending' })))
  expect(new Set([...root.legs, ...child.legs].map(leg => leg.sessionId)).size).toBe(16)
  expect(recovered.records(WORKSPACE_ID).find(record => record.id === root.id)).toEqual(root)
  expect(recovered.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(48)
  expect(recovered.summarize(WORKSPACE_ID).items[0]?.retryOf).toBe(root.id)
  await recovered.close()
  const cold = await openConversationDraftTrialStore(f.facility, [recoveryPolicy], () => 3000)
  expect(await cold.reserve(source, route)).toBeUndefined()
  expect(cold.records(WORKSPACE_ID)).toHaveLength(2)
  await cold.close()
  const nextDay = await openConversationDraftTrialStore(f.facility, [{ ...recoveryPolicy,
    retryFailedTrials: [{ ...grant, expiresAt: 86_410_000 }] }], () => 86_401_000)
  expect(await nextDay.reserve(source, route)).toBeUndefined()
  await nextDay.close()
  f.rows.set(child.id, { ...child, provider: 'forged-route' })
  await expect(openConversationDraftTrialStore(f.facility, [], () => 86_401_000)).rejects.toThrow('ancestry')
})

it('rejects recovery after any dispatch marker and rejects forged recovery ancestry on readback', async () => {
  const f = fixture(), first = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  let root = (await first.reserve(source, route))!
  root = await first.startLeg(root, 0)
  root = await first.markDispatch(root, 0, 1)
  root = await first.interrupt(root, 'execution-failed')
  await first.close()
  await expect(openConversationDraftTrialStore(f.facility, [{ ...policy, maxModelCallsPerUtcDay: 48,
    retryFailedTrials: [{ trialId: root.id, expiresAt: 10_000 }] }], () => 2000)).rejects.toThrow('retry')
  f.rows.set(root.id, { ...root, retryOf: 'e'.repeat(64) })
  await expect(openConversationDraftTrialStore(f.facility, [], () => 2000)).rejects.toThrow()
})

it('does not recover with an expired grant, insufficient budget, changed source, or changed model route', async () => {
  const f = fixture(), first = await openConversationDraftTrialStore(f.facility, [policy], () => 1000)
  const root = await first.interrupt((await first.reserve(source, route))!, 'execution-failed')
  await first.close()
  let now = 2000
  const grant = { trialId: root.id, expiresAt: 3000 }
  const limited = await openConversationDraftTrialStore(f.facility, [{ ...policy, retryFailedTrials: [grant] }], () => now)
  expect(await limited.reserve(source, route)).toBeUndefined()
  await limited.close()
  const allowed = await openConversationDraftTrialStore(f.facility, [{ ...policy, maxModelCallsPerUtcDay: 48,
    retryFailedTrials: [grant] }], () => now)
  expect(await allowed.reserve({ ...source, reservedAt: source.reservedAt + 1 }, route)).toBeUndefined()
  expect(await allowed.reserve(source, { ...route, model: 'different' })).toBeUndefined()
  now = 3000
  expect(await allowed.reserve(source, route)).toBeUndefined()
  expect(allowed.records(WORKSPACE_ID)).toEqual([root])
  await allowed.close()
  await expect(openConversationDraftTrialStore(f.facility, [{ ...policy,
    retryFailedTrials: [{ ...grant, expiresAt: now + 86_400_001 }] }], () => now)).rejects.toThrow('retry grant')
  const revoked = await openConversationDraftTrialStore(f.facility, [policy], () => 2000)
  expect(await revoked.reserve(source, route)).toBeUndefined()
})
