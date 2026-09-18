import { describe, expect, it, vi } from 'vitest'
import { SessionId, SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { MessageFeedbackItem } from '@deepseek-ai/dsh-message-feedback'
import type { DurableFeedbackStoredSession } from '../src/durable-feedback-attribution.ts'
import { explicitFeedbackOrigin, projectMessageFeedbackInputs } from '../src/conversation-message-feedback.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { authorConversationSkillDraft, openConversationDraftStore, validateConversationLearningPolicies } from '../src/conversation-skill-draft.ts'

export const feedbackSessionId = 'session-11111111-1111-4111-8111-111111111111'
export const feedbackItem = {
  messageId: 'assistant-1', rating: 'negative', note: '这里把未确认数字当作事实了。请保留冲突，不要自行选择一个数。',
  version: '11111111-1111-4111-8111-111111111111', createdAt: 100, updatedAt: 100,
} as MessageFeedbackItem

export function feedbackStored(): DurableFeedbackStoredSession {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '同一订单数量有6和7两个未确认版本，请整理结果。' }] } },
    { type: 'request/header', data: { header: { config: { provider: 'native-provider', model: 'native-model' } } } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { id: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: '订单数量是7，已经确认。' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'feedback/message-put', data: { sessionId: feedbackSessionId, item: feedbackItem } },
  ].map((event, seq) => ({ ...event, seq: SessionSeq(seq), time: seq + 1 }))
  return { meta: { id: SessionId(feedbackSessionId), version: 3, createdAt: 0, isSeeded: false, cwd: '/private/workspace' },
    inheritedEventCount: SessionLogOffset(0), fromSeq: 0, events: structuredClone(events) as never }
}

describe('native message feedback as a draft source', () => {
  it('uses one completed native answer and a durable negative note without inventing a second turn or classification', () => {
    const [input] = projectMessageFeedbackInputs(feedbackStored(), WORKSPACE_ID, feedbackSessionId, [feedbackItem])
    expect(input?.source).toMatchObject({ kind: 'message-feedback-v1', workspaceId: WORKSPACE_ID, sessionId: feedbackSessionId,
      turn: 1, userSeq: 1, assistantSeq: 3, turnEndSeq: 4, feedbackSeq: 5, messageId: 'assistant-1', feedbackVersion: feedbackItem.version })
    expect(input?.messages).toEqual({ request: '同一订单数量有6和7两个未确认版本，请整理结果。', answer: '订单数量是7，已经确认。', correction: feedbackItem.note })
    const origin = explicitFeedbackOrigin(input!)
    expect(origin).not.toHaveProperty('modelCalls')
    expect(origin).not.toHaveProperty('interpretation')
    expect(JSON.stringify(origin)).not.toContain(feedbackItem.note)
  })

  it('binds edits to new evidence but to the same one-attempt subject', () => {
    const first = projectMessageFeedbackInputs(feedbackStored(), WORKSPACE_ID, feedbackSessionId, [feedbackItem])[0]!
    const changed = feedbackStored(), item = { ...feedbackItem, note: '两个数均未确认，保留冲突状态和来源。',
      version: '22222222-2222-4222-8222-222222222222', updatedAt: 200 } as MessageFeedbackItem
    ;(changed.events as SessionEvent[]).push({ type: 'feedback/message-put', data: { sessionId: SessionId(feedbackSessionId), item }, seq: SessionSeq(6), time: 200 })
    const second = projectMessageFeedbackInputs(changed, WORKSPACE_ID, feedbackSessionId, [item])[0]!
    expect(second.source).not.toEqual(first.source)
    expect(explicitFeedbackOrigin(second).id).toBe(explicitFeedbackOrigin(first).id)
    expect(projectMessageFeedbackInputs(changed, WORKSPACE_ID, feedbackSessionId, [feedbackItem])).toEqual([])
    expect(projectMessageFeedbackInputs(feedbackStored(), WORKSPACE_ID, feedbackSessionId, [item])).toEqual([])
  })

  it.each(['deleted', 'positive', 'blank', 'inherited', 'foreign', 'incomplete', 'injected', 'replacement', 'oversized'])('does not admit %s feedback', scenario => {
    const stored = feedbackStored()
    let listed: MessageFeedbackItem[] = [feedbackItem]
    if (scenario === 'deleted') {
      ;(stored.events as SessionEvent[]).push({ type: 'feedback/message-delete', data: { sessionId: SessionId(feedbackSessionId), messageId: feedbackItem.messageId }, seq: SessionSeq(6), time: 200 })
      listed = []
    }
    if (scenario === 'positive' || scenario === 'blank' || scenario === 'oversized') {
      const item = { ...feedbackItem, ...(scenario === 'positive' ? { rating: 'positive' as const }
        : { note: scenario === 'blank' ? '   ' : 'x'.repeat(30_000) }) }
      ;(stored.events[5]!.data as { item: unknown }).item = item
      listed = [item]
    }
    if (scenario === 'inherited') (stored as { inheritedEventCount: number }).inheritedEventCount = 5
    if (scenario === 'foreign') (stored.events[5]!.data as { sessionId: string }).sessionId = 'foreign-session'
    if (scenario === 'incomplete') (stored.events[4]!.data as { reason: { kind: string } }).reason.kind = 'cancelled'
    if (scenario === 'injected') (stored.events[1]!.data as { source: { kind: string } }).source.kind = 'plugin'
    if (scenario === 'replacement') (stored.events[3] as unknown as { surfaceOp: unknown }).surfaceOp = { op: 'replace', start: 1, end: 2 }
    expect(projectMessageFeedbackInputs(stored, WORKSPACE_ID, feedbackSessionId, listed)).toEqual([])
  })
})

function facility() {
  const rows = new Map<string, unknown>()
  return { rows, value: { async open() { return { close: async () => {}, table: () => ({
    get size() { return rows.size }, get: (key: string) => structuredClone(rows.get(key)),
    entries: () => [...rows].map(([key, value]) => [key, structuredClone(value)]),
    put: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)) },
  }) } } } as unknown as DomainFacility }
}
const feedbackPolicy = { workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 2, explicitFeedbackSessionIds: [feedbackSessionId] }
const governance = { scope: 'Fixture scope: preserve explicit unresolved alternatives.',
  cases: ['h1', 'h2', 'r1', 'r2'].map((id, i) => ({ id, partition: i < 2 ? 'holdout' : 'retention',
    input: `Fixture ${id}: answer yes.`, mustInclude: ['yes'], mustNotInclude: [], layout: 'any',
    referenceAnswer: 'yes', alternateAnswer: 'yes', negativeAnswer: 'no' })) }
const proposal = { status: 'draft', name: 'preserve-conflicts', description: 'Preserve unresolved source conflicts in summaries.',
  body: 'When sources disagree, preserve each unresolved alternative and its status. Do not silently choose a value. Follow explicit user resolutions and keep unrelated responses unchanged.' }

describe('direct feedback uses the existing draft budget and store', () => {
  it('authors without a classifier and persists the real feedback binding, not a fabricated correction', async () => {
    const f = facility(), store = await openConversationDraftStore(f.value, [feedbackPolicy], () => 100)
    const input = projectMessageFeedbackInputs(feedbackStored(), WORKSPACE_ID, feedbackSessionId, [feedbackItem])[0]!
    const model = vi.fn(async request => {
      expect(request.input.messages).not.toHaveProperty('response')
      if (request.role === 'author') expect(JSON.stringify(request)).not.toContain('referenceAnswer')
      return { value: request.role === 'governance' ? governance : proposal }
    })
    expect(await authorConversationSkillDraft(store, explicitFeedbackOrigin(input), input, model, new AbortController().signal)).toBe('draft')
    expect(model).toHaveBeenCalledTimes(2)
    const record = store.records(WORKSPACE_ID)[0]!
    expect(record).toMatchObject({ messageFeedbackSource: input.source, sourceAnswerSeq: 3, modelCalls: 2, reservedModelCalls: 2 })
    expect(record).not.toHaveProperty('interpretation')
    expect(JSON.stringify(record)).not.toContain(feedbackItem.note)
    await store.close()
    const cold = await openConversationDraftStore(f.value, [feedbackPolicy], () => 86_400_100)
    expect(cold.records(WORKSPACE_ID)).toEqual([record])
    const edited = { ...input, messages: { ...input.messages, correction: 'A changed correction' },
      source: { ...input.source, feedbackVersion: '22222222-2222-4222-8222-222222222222' } }
    expect(await authorConversationSkillDraft(cold, explicitFeedbackOrigin(edited), edited, model, new AbortController().signal)).toBe('skipped')
    expect(model).toHaveBeenCalledTimes(2)
  })

  it('requires an exact Session opt-in and rejects duplicate configured Session ids', async () => {
    const input = projectMessageFeedbackInputs(feedbackStored(), WORKSPACE_ID, feedbackSessionId, [feedbackItem])[0]!, model = vi.fn()
    for (const explicitFeedbackSessionIds of [undefined, ['another-session']]) {
      const store = await openConversationDraftStore(facility().value, [{ workspaceId: WORKSPACE_ID, maxModelCallsPerUtcDay: 2,
        ...(explicitFeedbackSessionIds === undefined ? {} : { explicitFeedbackSessionIds }) }])
      expect(await authorConversationSkillDraft(store, explicitFeedbackOrigin(input), input, model, new AbortController().signal)).toBe('skipped')
      expect(store.records(WORKSPACE_ID)).toEqual([])
    }
    expect(model).not.toHaveBeenCalled()
    expect(() => validateConversationLearningPolicies([{ ...feedbackPolicy, explicitFeedbackSessionIds: [feedbackSessionId, feedbackSessionId] }])).toThrow()
  })
})
