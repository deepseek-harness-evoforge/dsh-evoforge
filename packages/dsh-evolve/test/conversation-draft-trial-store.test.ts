import { createHash } from 'node:crypto'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, it } from 'vitest'
import { digest } from '../src/conversation-correction-intake.ts'
import type { ConversationDraftRecord } from '../src/conversation-skill-draft.ts'
import { openConversationDraftTrialStore } from '../src/conversation-draft-trial-store.ts'
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
    layout: 'any' as const, referenceAnswer: id, negativeAnswer: 'fabricated',
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
