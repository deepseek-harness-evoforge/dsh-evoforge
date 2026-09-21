import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { CorrectionInput, CorrectionRecord } from '../src/conversation-correction-intake.ts'
import { digest } from '../src/conversation-correction-intake.ts'
import {
  authorConversationSkillDraft, openConversationDraftStore, nativeConversationDraftModel,
  validateConversationLearningPolicies, validateDraftGovernance,
} from '../src/conversation-skill-draft.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'
import { latestCorrectionChainEnds } from '../src/conversation-skill-draft-monitor.ts'

const input: CorrectionInput = {
  source: { workspaceId: WORKSPACE_ID, sessionId: 'session-example', turn: 3,
    previousUserSeq: 1, previousAssistantSeq: 2, userSeq: 5, assistantSeq: 6, turnEndSeq: 7,
    prefixDigest: '1'.repeat(64), inputDigest: '2'.repeat(64), modelIdentityDigest: '3'.repeat(64) },
  route: { provider: 'native', model: 'native' },
  messages: { request: '整理活动材料，供飞书预览。', answer: '已提供五列表格。',
    correction: '五列表格仍太宽，来源列还是要横向滚动，因此阅读问题没有解决。请按事项改成短段落。',
    response: '已改为每项一个小节，保留来源与未知状态。' },
}
const correction: CorrectionRecord = {
  schemaVersion: 1, id: '4'.repeat(64), source: input.source, reservedAt: 100,
  phase: 'classified', modelCalls: 1,
  interpretation: { kind: 'correction', dimension: 'presentation', quoteDigest: '5'.repeat(64), verification: 'unverified', releaseAuthority: 'none' },
}
const policy = { workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 2 }
const governance = {
  scope: '在窄屏上阅读带来源的多事项报告；保留用户明确要求的输出格式。',
  cases: [
    { id: 'h1', partition: 'holdout', input: '给手机读者整理甲事项，责任人周，状态待确认。',
      mustInclude: ['甲事项', '周', '待确认'], mustNotInclude: ['已完成'], layout: 'no-table',
      referenceAnswer: '甲事项\n负责人：周\n状态：待确认', alternateAnswer: '甲事项由周负责，目前待确认。', negativeAnswer: '已完成' },
    { id: 'h2', partition: 'holdout', input: '在聊天窄屏中列乙事项和来源记录C，截止有冲突周四/周六。',
      mustInclude: ['乙事项', '记录C', '周四', '周六'], mustNotInclude: [], layout: 'no-table',
      referenceAnswer: '乙事项\n来源：记录C\n截止冲突：周四/周六', alternateAnswer: '据记录C，乙事项截止存在周四与周六的冲突。', negativeAnswer: '乙事项周四' },
    { id: 'r1', partition: 'retention', input: '我明确要两列表格：事项丙，状态待处理。',
      mustInclude: ['丙', '待处理'], mustNotInclude: [], layout: 'table',
      referenceAnswer: '| 事项 | 状态 |\n| --- | --- |\n| 丙 | 待处理 |', alternateAnswer: '|事项|状态|\n|---|---|\n|丙|待处理|', negativeAnswer: '丙：待处理' },
    { id: 'r2', partition: 'retention', input: '只回答7减2的结果。',
      mustInclude: ['5'], mustNotInclude: ['报告'], layout: 'any',
      referenceAnswer: '5', alternateAnswer: '5', negativeAnswer: '报告：7' },
  ],
}
const proposal = { status: 'draft', name: 'readable-channel-report', description: '整理供聊天窄屏阅读的多事项报告。',
  body: '对窄屏上的多字段事项，用每项一个短小节。保留来源、冲突和未知状态；用户指定表格时遵从指定格式。对纯问答不增加报告结构。' }
const usage = { inputTokens: 100, outputTokens: 80 }
function facility() {
  const rows = new Map<string, unknown>()
  let fail = false
  const value = { async open() { return { close: async () => {}, table: () => ({
    get size() { return rows.size }, get: (key: string) => structuredClone(rows.get(key)),
    entries: () => [...rows].map(([key, value]) => [key, structuredClone(value)]),
    put: async (key: string, value: unknown) => { if (fail) throw new Error('write denied'); rows.set(key, structuredClone(value)) },
  }) } } } as unknown as DomainFacility
  return { value, rows, fail: () => { fail = true } }
}
const signal = () => new AbortController().signal

function fixtureWait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

describe('conversation-derived Skill draft', () => {
  it.each(['governance', 'author'] as const)('stops when the source changes during %s and retains usage without redrafting', async role => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    let current = true
    const model = vi.fn(async request => {
      if (request.role === role) current = false
      return { value: request.role === 'governance' ? governance : proposal, usage }
    })
    expect(await authorConversationSkillDraft(store, correction, input, model, signal(), async () => current)).toBe('uncertain')
    const record = store.records(WORKSPACE_ID)[0]!
    expect(record).toMatchObject({ phase: 'uncertain', reason: 'source-conflict', reservedModelCalls: 2,
      modelCalls: role === 'governance' ? 1 : 2 })
    expect(record.draft).toBeUndefined()
    expect(record.usages).toHaveLength(role === 'governance' ? 1 : 2)
    expect(model).toHaveBeenCalledTimes(role === 'governance' ? 1 : 2)
    await store.close()
    const cold = await openConversationDraftStore(f.value, [policy], () => 86_400_100)
    expect(cold.records(WORKSPACE_ID)).toEqual([record])
    expect(await authorConversationSkillDraft(cold, correction, input, model, signal(), async () => true)).toBe('skipped')
  })

  it.each(['false', 'reject'] as const)('does not reserve or call models when the initial source check is %s', async outcome => {
    const store = await openConversationDraftStore(facility().value, [policy], () => 100), model = vi.fn()
    const check = async () => { if (outcome === 'reject') throw new Error('source unavailable'); return false }
    expect(await authorConversationSkillDraft(store, correction, input, model, signal(), check)).toBe('skipped')
    expect(model).not.toHaveBeenCalled()
    expect(store.records(WORKSPACE_ID)).toEqual([])
  })
  it('uses the last correction in a connected chain without treating two retries as independent samples', () => {
    const earlier = { ...correction, id: '6'.repeat(64), source: { ...input.source, previousUserSeq: 0, userSeq: 1, turn: 2 } }
    const independent = { ...correction, id: '7'.repeat(64), source: { ...input.source, sessionId: 'another-session' } }
    expect(latestCorrectionChainEnds([earlier, correction, independent]).map(r => r.id).sort()).toEqual([correction.id, independent.id].sort())
  })
  it('seals hidden tests before authoring and never passes tests or expected answers to the proposer', async () => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    const requests: unknown[] = []
    const model = vi.fn(async (request) => {
      requests.push(request)
      if (request.role === 'governance') return { value: governance, usage }
      expect(store.records(WORKSPACE_ID)[0]?.governance).toEqual(governance)
      expect(JSON.stringify(request)).not.toContain('referenceAnswer')
      expect(JSON.stringify(request)).not.toContain('alternateAnswer')
      expect(JSON.stringify(request)).not.toContain('只回答7减2')
      return { value: proposal, usage }
    })
    expect(await authorConversationSkillDraft(store, correction, input, model, signal())).toBe('draft')
    const record = store.records(WORKSPACE_ID)[0]!
    expect(record).toMatchObject({ phase: 'draft', modelCalls: 2, governanceDigest: digest(governance),
      draft: { lifecycle: 'inactive', verification: 'unevaluated', releaseAuthority: 'none' } })
    expect(record.draft?.markdown).toContain('name: readable-channel-report')
    expect(record.draft?.contentHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(record)).not.toContain(input.messages.correction)
    expect(requests).toHaveLength(2)
    const view = store.summarize(WORKSPACE_ID)
    expect(view).toMatchObject({ draftCount: 1, reservedModelCallsToday: 2 })
    expect(JSON.stringify(view)).not.toContain('referenceAnswer')
    expect(JSON.stringify(view)).not.toContain('alternateAnswer')
    expect(JSON.stringify(view)).not.toContain('甲事项')
  })

  it('does not consume policy, unclear interpretation, or mismatched source as authoring permission', async () => {
    const model = vi.fn()
    const store = await openConversationDraftStore(facility().value, [], () => 100)
    expect(await authorConversationSkillDraft(store, correction, input, model, signal())).toBe('skipped')
    const enabled = await openConversationDraftStore(facility().value, [policy], () => 100)
    expect(await authorConversationSkillDraft(enabled, { ...correction, phase: 'uncertain', interpretation: undefined }, input, model, signal())).toBe('skipped')
    expect(await authorConversationSkillDraft(enabled, { ...correction, source: { ...input.source, inputDigest: '6'.repeat(64) } }, input, model, signal())).toBe('skipped')
    expect(model).not.toHaveBeenCalled()
  })

  it('reserves the whole bounded run before calls, deduplicates concurrency, and does not redraft on reopen', async () => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    const model = vi.fn(async request => ({ value: request.role === 'governance' ? governance : proposal, usage }))
    await Promise.all([1, 2].map(() => authorConversationSkillDraft(store, correction, input, model, signal())))
    expect(model).toHaveBeenCalledTimes(2)
    const other = { ...correction, id: '7'.repeat(64) }
    expect(await authorConversationSkillDraft(store, other, input, model, signal())).toBe('skipped')
    const reopened = await openConversationDraftStore(f.value, [policy], () => 86_400_100)
    expect(reopened.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(0)
    expect(await authorConversationSkillDraft(reopened, correction, input, model, signal())).toBe('skipped')
    expect(model).toHaveBeenCalledTimes(2)
  })

  it('allows one expiring explicitly authorized retry without overwriting the failed attempt or escaping the budget', async () => {
    const f = facility(), first = await openConversationDraftStore(f.value, [policy], () => 100)
    await authorConversationSkillDraft(first, correction, input, async () => { throw new Error('unknown result') }, signal())
    const original = first.records(WORKSPACE_ID)[0]!
    await first.close()
    const retryFailedDrafts = [{ draftId: original.id, expiresAt: 2000 }]
    const denied = await openConversationDraftStore(f.value, [{ ...policy, retryFailedDrafts }], () => 200)
    const model = vi.fn(async request => ({ value: request.role === 'governance' ? governance : proposal, usage }))
    expect(await authorConversationSkillDraft(denied, correction, input, model, signal())).toBe('skipped')
    expect(model).not.toHaveBeenCalled()
    await denied.close()
    const authorized = { ...policy, maxModelCallsPerUtcDay: 4, retryFailedDrafts }
    const store = await openConversationDraftStore(f.value, [authorized], () => 300)
    await Promise.all([1, 2].map(() => authorConversationSkillDraft(store, correction, input, model, signal())))
    expect(model).toHaveBeenCalledTimes(2)
    expect(store.records(WORKSPACE_ID)).toHaveLength(2)
    expect(store.records(WORKSPACE_ID).find(r => r.id === original.id)).toEqual(original)
    expect(store.records(WORKSPACE_ID).find(r => r.id !== original.id)).toMatchObject({ retryOf: original.id, phase: 'draft' })
    expect(store.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(4)
    await store.close()
    const reopened = await openConversationDraftStore(f.value, [authorized], () => 400)
    expect(await authorConversationSkillDraft(reopened, correction, input, model, signal())).toBe('skipped')
    expect(model).toHaveBeenCalledTimes(2)
  })

  it('does not turn expired retry permission or a changed source into another paid attempt', async () => {
    const f = facility(), first = await openConversationDraftStore(f.value, [policy], () => 100)
    await authorConversationSkillDraft(first, correction, input, async () => { throw new Error('unknown result') }, signal())
    const original = first.records(WORKSPACE_ID)[0]!
    await first.close()
    const retryPolicy = { ...policy, maxModelCallsPerUtcDay: 4, retryFailedDrafts: [{ draftId: original.id, expiresAt: 200 }] }
    const store = await openConversationDraftStore(f.value, [retryPolicy], () => 201)
    const model = vi.fn()
    expect(await authorConversationSkillDraft(store, correction, input, model, signal())).toBe('skipped')
    await store.close()
    const active = await openConversationDraftStore(f.value, [{ ...retryPolicy, retryFailedDrafts: [{ draftId: original.id, expiresAt: 2000 }] }], () => 300)
    expect(await authorConversationSkillDraft(active, correction, { ...input, messages: { ...input.messages, answer: 'changed' } }, model, signal())).toBe('skipped')
    expect(active.records(WORKSPACE_ID)).toEqual([original])
    expect(model).not.toHaveBeenCalled()
  })

  it('rejects retrying a sealed test set or successful draft and malformed retry grants', async () => {
    const f = facility(), first = await openConversationDraftStore(f.value, [policy], () => 100)
    await authorConversationSkillDraft(first, correction, input, async request => {
      if (request.role === 'author') throw new Error('author request failed')
      return { value: governance, usage }
    }, signal())
    const original = first.records(WORKSPACE_ID)[0]!
    await first.close()
    const grant = { draftId: original.id, expiresAt: 2000 }
    await expect(openConversationDraftStore(f.value, [{ ...policy, maxModelCallsPerUtcDay: 4, retryFailedDrafts: [grant] }], () => 200)).rejects.toThrow()
    expect(() => validateConversationLearningPolicies([{ ...policy, retryFailedDrafts: [grant, grant] }])).toThrow()
    expect(() => validateConversationLearningPolicies([{ ...policy, retryFailedDrafts: [{ ...grant, expiresAt: -1 }] }])).toThrow()
  })

  it('requires a fresh explicit grant for each pre-governance transport recovery and preserves the full chain', async () => {
    const f = facility(), first = await openConversationDraftStore(f.value, [policy], () => 100)
    const fail = vi.fn(async () => { throw new Error('request did not complete') })
    await authorConversationSkillDraft(first, correction, input, fail, signal())
    const original = first.records(WORKSPACE_ID)[0]!
    await first.close()
    const grant = { draftId: original.id, expiresAt: 2000 }
    await expect(openConversationDraftStore(f.value, [{ ...policy, retryFailedDrafts: [{ ...grant, draftId: 'f'.repeat(64) }] }], () => 200)).rejects.toThrow()
    await expect(openConversationDraftStore(f.value, [{ ...policy, retryFailedDrafts: [{ ...grant, expiresAt: 86_400_201 }] }], () => 200)).rejects.toThrow()
    const retryPolicy = { ...policy, maxModelCallsPerUtcDay: 4, retryFailedDrafts: [grant] }
    const second = await openConversationDraftStore(f.value, [retryPolicy], () => 200)
    expect(await authorConversationSkillDraft(second, correction, input, fail, signal())).toBe('uncertain')
    const retry = second.records(WORKSPACE_ID).find(r => r.retryOf !== undefined)!
    await second.close()
    const unchanged = await openConversationDraftStore(f.value, [{ ...retryPolicy, maxModelCallsPerUtcDay: 8 }], () => 250)
    expect(await authorConversationSkillDraft(unchanged, correction, input, fail, signal())).toBe('skipped')
    await unchanged.close()
    const nextPolicy = { ...retryPolicy, maxModelCallsPerUtcDay: 8, retryFailedDrafts: [{ ...grant, draftId: retry.id }] }
    const third = await openConversationDraftStore(f.value, [nextPolicy], () => 300)
    const model = vi.fn(async request => ({ value: request.role === 'governance' ? governance : proposal, usage }))
    await Promise.all([1, 2].map(() => authorConversationSkillDraft(third, correction, input, model, signal())))
    expect(model).toHaveBeenCalledTimes(2)
    expect(third.records(WORKSPACE_ID)).toHaveLength(3)
    expect(third.records(WORKSPACE_ID).find(r => r.id === original.id)).toEqual(original)
    expect(third.records(WORKSPACE_ID).find(r => r.id === retry.id)).toEqual(retry)
    expect(third.records(WORKSPACE_ID).find(r => r.retryOf === retry.id)).toMatchObject({ phase: 'draft' })
    expect(third.summarize(WORKSPACE_ID).reservedModelCallsToday).toBe(6)
    await third.close()
    const cold = await openConversationDraftStore(f.value, [nextPolicy], () => 400)
    expect(await authorConversationSkillDraft(cold, correction, input, model, signal())).toBe('skipped')
    expect(model).toHaveBeenCalledTimes(2)
    await cold.close()
    f.rows.set(retry.id, { ...retry, sourceDigest: 'e'.repeat(64) })
    await expect(openConversationDraftStore(f.value, [policy], () => 300)).rejects.toThrow('retry lineage')
    expect(fail).toHaveBeenCalledTimes(2)
  })

  it('does not resume a reserved retry after a crash or allow retrying a successful root', async () => {
    const f = facility(), first = await openConversationDraftStore(f.value, [policy], () => 100)
    await authorConversationSkillDraft(first, correction, input, async () => { throw new Error('unknown result') }, signal())
    const original = first.records(WORKSPACE_ID)[0]!
    await first.close()
    const retryPolicy = { ...policy, maxModelCallsPerUtcDay: 4, retryFailedDrafts: [{ draftId: original.id, expiresAt: 2000 }] }
    const second = await openConversationDraftStore(f.value, [retryPolicy], () => 200)
    expect(await second.reserve(correction, input, () => true)).toMatchObject({ retryOf: original.id, phase: 'reserved' })
    await second.close()
    const reopened = await openConversationDraftStore(f.value, [retryPolicy], () => 300)
    const model = vi.fn()
    expect(await authorConversationSkillDraft(reopened, correction, input, model, signal())).toBe('skipped')
    expect(reopened.records(WORKSPACE_ID).find(r => r.retryOf !== undefined)).toMatchObject({ phase: 'uncertain', reason: 'interrupted', modelCalls: 0 })
    expect(reopened.records(WORKSPACE_ID)[0]).toEqual(original)
    expect(model).not.toHaveBeenCalled()
    const successFacility = facility(), successful = await openConversationDraftStore(successFacility.value, [policy], () => 100)
    await authorConversationSkillDraft(successful, correction, input, async request => ({ value: request.role === 'governance' ? governance : proposal, usage }), signal())
    await successful.close()
    await expect(openConversationDraftStore(successFacility.value, [retryPolicy], () => 200)).rejects.toThrow('retry grant')
  })

  it.each(['reserved', 'governance-pending', 'governance-ready', 'authoring-pending'] as const)('does not resume paid work from a persisted %s crash point', async phase => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    let row = (await store.reserve(correction, input, () => true))!
    if (phase !== 'reserved') row = await store.update(row, { phase: 'governance-pending', modelCalls: 1 })
    if (phase === 'governance-ready' || phase === 'authoring-pending') row = await store.update(row, { phase: 'governance-ready', governance: validateDraftGovernance(governance, input), governanceDigest: digest(governance) })
    if (phase === 'authoring-pending') await store.update(row, { phase: 'authoring-pending', modelCalls: 2 })
    const reopened = await openConversationDraftStore(f.value, [policy], () => 86_400_100)
    const model = vi.fn()
    expect(await authorConversationSkillDraft(reopened, correction, input, model, signal())).toBe('skipped')
    expect(reopened.records(WORKSPACE_ID)[0]).toMatchObject({ phase: 'uncertain', reason: 'interrupted' })
    expect(model).not.toHaveBeenCalled()
  })

  it('does not author if governance fails calibration, duplicates a case or copies the correction', async () => {
    expect(() => validateDraftGovernance({ ...governance, cases: [...governance.cases.slice(0, 3), governance.cases[0]] }, input)).toThrow()
    expect(() => validateDraftGovernance({ ...governance, cases: governance.cases.map((c, i) => i ? c : { ...c, negativeAnswer: c.referenceAnswer }) }, input)).toThrow()
    expect(() => validateDraftGovernance({ ...governance, cases: governance.cases.map((c, i) => i ? c : { ...c, input: input.messages.correction }) }, input)).toThrow()
    const store = await openConversationDraftStore(facility().value, [policy], () => 100)
    const model = vi.fn(async () => ({ value: {}, usage }))
    expect(await authorConversationSkillDraft(store, correction, input, model, signal())).toBe('abstained')
    expect(model).toHaveBeenCalledTimes(1)
    expect(store.records(WORKSPACE_ID)[0]?.draft).toBeUndefined()
  })

  it('requires fresh checks to accept an alternate valid answer without rewriting their assertions', () => {
    const calibrated = { ...governance, cases: governance.cases.map((test, index) => ({ ...test,
      alternateAnswer: index === 0 ? '甲事项由周负责，目前待确认。' : `${test.referenceAnswer}\n`,
    })) }
    expect(validateDraftGovernance(calibrated, input)).toEqual(calibrated)
    const brittle = { ...calibrated, cases: calibrated.cases.map((test, index) => index === 0
      ? { ...test, mustInclude: [...test.mustInclude, '负责人：周'] } : test) }
    expect(() => validateDraftGovernance(brittle, input)).toThrow('calibration')
  })

  it('keeps legacy sealed material readable but does not admit it as newly calibrated material', () => {
    const legacy = { ...governance, cases: governance.cases.map(({ alternateAnswer: _, ...test }) => test) }
    expect(validateDraftGovernance(legacy)).toEqual(legacy)
    expect(() => validateDraftGovernance(legacy, input)).toThrow('calibration')
  })

  it('stops before the proposer when a proposed checker rejects its alternate correct answer', async () => {
    const store = await openConversationDraftStore(facility().value, [policy], () => 100)
    const brittle = { ...governance, cases: governance.cases.map((test, index) => index === 0
      ? { ...test, mustInclude: [...test.mustInclude, '负责人：周'] } : test) }
    const model = vi.fn(async () => ({ value: brittle, usage }))
    expect(await authorConversationSkillDraft(store, correction, input, model, signal())).toBe('abstained')
    expect(model).toHaveBeenCalledTimes(1)
    expect(store.records(WORKSPACE_ID)[0]).toMatchObject({ reason: 'invalid-governance', modelCalls: 1 })
    expect(store.records(WORKSPACE_ID)[0]?.draft).toBeUndefined()
  })

  it('keeps cancellation and crash uncertain, and never resumes a partially paid run automatically', async () => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    const controller = new AbortController()
    const model = vi.fn(async () => { controller.abort(); return { value: governance, usage } })
    expect(await authorConversationSkillDraft(store, correction, input, model, controller.signal)).toBe('uncertain')
    expect(model).toHaveBeenCalledTimes(1)
    const reopened = await openConversationDraftStore(f.value, [policy], () => 100)
    expect(await authorConversationSkillDraft(reopened, correction, input, model, signal())).toBe('skipped')
    expect(reopened.summarize(WORKSPACE_ID).uncertainCount).toBe(1)
  })

  it('fails closed on write failure and refuses malformed or executable draft output', async () => {
    const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
    f.fail()
    const model = vi.fn()
    await expect(authorConversationSkillDraft(store, correction, input, model, signal())).rejects.toThrow()
    expect(model).not.toHaveBeenCalled()
    const fresh = await openConversationDraftStore(facility().value, [policy], () => 100)
    const bad = vi.fn(async request => ({ value: request.role === 'governance' ? governance : { ...proposal, script: 'execute()' }, usage }))
    expect(await authorConversationSkillDraft(fresh, correction, input, bad, signal())).toBe('abstained')
    expect(fresh.summarize(WORKSPACE_ID).draftCount).toBe(0)
  })

  it('keeps policy bounded, default-deny and independent from inspection budget', () => {
    expect(() => validateConversationLearningPolicies([{ ...policy, maxModelCallsPerUtcDay: 1 }])).toThrow()
    expect(() => validateConversationLearningPolicies([policy, policy])).toThrow()
    expect(() => validateConversationLearningPolicies([{ ...policy, activate: true } as never])).toThrow()
    expect(() => validateConversationLearningPolicies([])).not.toThrow()
  })

  it('uses only a bounded native auxiliary request and requires an explicit successful finish', async () => {
    const options: unknown[] = []
    const ctx = { llm: { async *stream(option: unknown) {
      options.push(option)
      yield { type: 'text-delta', index: 0, text: JSON.stringify(proposal) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } } as unknown as Pick<Context, 'llm'>
    const model = nativeConversationDraftModel(ctx)
    const request = { role: 'author' as const, input }
    expect((await model(request, signal())).value).toEqual(proposal)
    expect(options[0]).toMatchObject({ provider: 'native', model: 'native', sessionId: 'session-example', maxTokens: 2000 })
    expect(options[0]).not.toHaveProperty('tools')
    const missingFinish = { llm: { async *stream() { yield { type: 'text-delta', index: 0, text: JSON.stringify(proposal) } } } } as unknown as Pick<Context, 'llm'>
    await expect(nativeConversationDraftModel(missingFinish)(request, signal())).rejects.toThrow()
  })

  it.each(['governance', 'author'] as const)('allows a continuously progressing %s response to finish after sixty seconds', async role => {
    vi.useFakeTimers()
    try {
      const value = role === 'governance' ? governance : proposal
      const text = JSON.stringify(value)
      let closed = false
      const ctx = { llm: { async *stream(options: { signal: AbortSignal }) {
        try {
          for (let part = 0; part < 5; part++) {
            await fixtureWait(15_000, options.signal)
            const width = Math.ceil(text.length / 5)
            yield { type: 'text-delta', index: 0, text: text.slice(part * width, (part + 1) * width) }
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } finally { closed = true }
      } } } as unknown as Pick<Context, 'llm'>
      const result = nativeConversationDraftModel(ctx)({ role, input }, signal())
        .then(response => ({ value: response.value }), error => ({ failure: error.message }))
      await vi.advanceTimersByTimeAsync(75_000)
      expect(await result).toEqual({ value })
      expect(closed).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each(['governance', 'author'] as const)('does not equate delayed %s content with a dead native transport', async role => {
    vi.useFakeTimers()
    try {
      const value = role === 'governance' ? governance : proposal
      let closed = false
      const ctx = { llm: { async *stream(options: { signal: AbortSignal }) {
        try {
          // DSH adapters can receive transport heartbeats without yielding a model chunk.
          await fixtureWait(120_000, options.signal)
          yield { type: 'text-delta', index: 0, text: JSON.stringify(value) }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } finally { closed = true }
      } } } as unknown as Pick<Context, 'llm'>
      const result = nativeConversationDraftModel(ctx)({ role, input }, signal())
        .then(response => ({ value: response.value }), error => ({ failure: error.message }))
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await result).toEqual({ value })
      expect(closed).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it.each([
    { mode: 'silent', reason: 'model-total-timeout', milliseconds: 600_000 },
    { mode: 'partial-stall', reason: 'model-total-timeout', milliseconds: 600_000 },
    { mode: 'after-finish', reason: 'model-total-timeout', milliseconds: 600_000 },
    { mode: 'continuous', reason: 'model-total-timeout', milliseconds: 600_000 },
    { mode: 'cancelled', reason: 'cancelled', milliseconds: 30_000 },
  ])('bounds $mode without dropping consumed budget or known usage', async ({ mode, reason, milliseconds }) => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      let closed = false, calls = 0
      const ctx = { llm: { async *stream(options: { signal: AbortSignal }) {
        calls++
        try {
          if (mode !== 'silent') yield { type: 'usage', usage: { inputTokens: 23, outputTokens: 4 } }
          if (mode === 'partial-stall') yield { type: 'text-delta', index: 0, text: '{"scope":' }
          if (mode === 'after-finish') {
            yield { type: 'text-delta', index: 0, text: JSON.stringify(governance) }
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
          while (true) {
            await fixtureWait(mode === 'continuous' ? 15_000 : 900_000, options.signal)
            yield { type: 'text-delta', index: 0, text: ' ' }
          }
        } finally { closed = true }
      } } } as unknown as Pick<Context, 'llm'>
      const f = facility(), store = await openConversationDraftStore(f.value, [policy], () => 100)
      const run = authorConversationSkillDraft(store, correction, input, nativeConversationDraftModel(ctx), controller.signal)
      if (mode === 'cancelled') setTimeout(() => controller.abort(new Error('private cancellation detail')), 30_000)
      await vi.advanceTimersByTimeAsync(milliseconds)
      expect(await run).toBe('uncertain')
      expect(store.records(WORKSPACE_ID)[0]).toMatchObject({ reason, reservedModelCalls: 2, modelCalls: 1,
        usages: mode === 'silent' ? [] : [{ inputTokens: 23, outputTokens: 4 }] })
      expect(store.records(WORKSPACE_ID)[0]?.requestTimings).toEqual([{ role: 'governance', timing: {
        elapsedMs: milliseconds, ...(mode === 'silent' ? {} : { firstChunkMs: 0 }),
        chunkCount: mode === 'silent' ? 0 : mode === 'partial-stall' ? 2 : mode === 'after-finish' ? 3 : mode === 'continuous' ? 40 : 1,
      } }])
      expect(closed).toBe(true)
      expect(calls).toBe(1)
      expect(vi.getTimerCount()).toBe(0)
      const reopened = await openConversationDraftStore(f.value, [policy], () => 86_400_100)
      expect(await authorConversationSkillDraft(reopened, correction, input, nativeConversationDraftModel(ctx), signal())).toBe('skipped')
      expect(calls).toBe(1)
      expect(JSON.stringify(reopened.records(WORKSPACE_ID))).not.toContain('private cancellation detail')
    } finally { vi.useRealTimers() }
  })

  it.each([
    { finish: { kind: 'max-tokens' }, text: '{', reason: 'output-limit', phase: 'abstained' },
    { finish: { kind: 'stop' }, text: 'not JSON', reason: 'invalid-json', phase: 'abstained' },
    { finish: { kind: 'error', failure: { message: 'private provider details should never persist', code: 'PROVIDER_ERROR' } }, text: '', reason: 'provider-error', phase: 'uncertain' },
  ])('retains the redacted $reason and known usage rather than losing both behind a generic failure', async ({ finish, text, reason, phase }) => {
    const ctx = { llm: { async *stream() {
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'usage', usage: { inputTokens: 234, outputTokens: 56 } }
      yield { type: 'finish', reason: finish }
    } } } as unknown as Pick<Context, 'llm'>
    const store = await openConversationDraftStore(facility().value, [policy], () => 100)
    await authorConversationSkillDraft(store, correction, input, nativeConversationDraftModel(ctx), signal())
    const row = store.records(WORKSPACE_ID)[0]!
    expect(row).toMatchObject({ phase, reason, usages: [{ inputTokens: 234, outputTokens: 56 }] })
    expect(JSON.stringify(row)).not.toContain('private provider details')
    expect(store.summarize(WORKSPACE_ID).failures).toEqual([{ reason, count: 1 }])
    expect(store.summarize(WORKSPACE_ID).usageMissingCount).toBe(0)
  })
})
