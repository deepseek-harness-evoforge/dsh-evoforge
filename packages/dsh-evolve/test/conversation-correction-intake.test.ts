import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { isAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { DurableFeedbackStoredSession } from '../src/durable-feedback-attribution.ts'
import { inspectConversationCorrection, nativeCorrectionClassifier, openCorrectionLedger, projectCorrectionInput, validateCorrectionInterpretation, validateCorrectionPolicies, type CorrectionRecord } from '../src/conversation-correction-intake.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const sessionId = 'session-11111111-1111-4111-8111-111111111111'

function stored(): DurableFeedbackStoredSession {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: '把材料整理成可在飞书预览的报告。' }] } },
    { type: 'request/header', data: { header: { config: { provider: 'native-provider', model: 'native-model' } } } },
    { type: 'assistant/message', data: { turn: 1, message: { id: 'assistant-1', content: [{ type: 'text', text: '已提供五列报告。' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: { id: 'user-2', source: { kind: 'user' }, content: [{ type: 'text', text: '上一版事实正确，但表格太宽，飞书预览看不到来源。请改成逐条段落，保留全部事实。' }] } },
    { type: 'assistant/message', data: { turn: 2, message: { id: 'assistant-2', content: [{ type: 'text', text: '已生成逐条阅读版，未声称验证预览。' }] } } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ].map((event, seq) => ({ ...event, seq: SessionSeq(seq), time: seq + 1 }))
  return { meta: { id: SessionId(sessionId), version: 3, createdAt: 0, isSeeded: false, cwd: '/private/workspace' },
    inheritedEventCount: SessionLogOffset(0), fromSeq: 0, events: events as never }
}

describe('ordinary conversation correction intake', () => {
  it('binds a completed no-Goal follow-up without requiring or inventing a Skill invocation', () => {
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)
    expect(input?.source).toMatchObject({ workspaceId: WORKSPACE_ID, sessionId, turn: 2,
      previousUserSeq: 1, previousAssistantSeq: 3, userSeq: 6, assistantSeq: 7, turnEndSeq: 8 })
    expect(input?.source).not.toHaveProperty('goal')
    expect(input?.source).not.toHaveProperty('skill')
    expect(JSON.stringify(input?.source)).not.toContain('表格太宽')
    expect(input?.route).toEqual({ provider: 'native-provider', model: 'native-model' })
    expect(input?.messages.correction).toContain('表格太宽')
  })

  it('does not mistake a first task or an incomplete/ambiguous turn for a correction source', () => {
    expect(projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 4)).toBeUndefined()
    const cancelled = stored()
    ;(cancelled.events[8]!.data as { reason: { kind: string } }).reason.kind = 'cancelled'
    expect(projectCorrectionInput(cancelled, WORKSPACE_ID, sessionId, 8)).toBeUndefined()
    const injected = stored()
    ;(injected.events[6]!.data as { source: { kind: string } }).source.kind = 'plugin'
    expect(projectCorrectionInput(injected, WORKSPACE_ID, sessionId, 8)).toBeUndefined()
  })

  it('refuses wrong sessions, incomplete prefixes, oversized text and unrecognized formats', () => {
    expect(projectCorrectionInput(stored(), WORKSPACE_ID, 'another-session', 8)).toBeUndefined()
    const prefix = stored()
    ;(prefix as { fromSeq: number }).fromSeq = 1
    expect(projectCorrectionInput(prefix, WORKSPACE_ID, sessionId, 8)).toBeUndefined()
    const tooBig = stored()
    ;(tooBig.events[6]!.data as { content: { text: string }[] }).content[0]!.text = 'x'.repeat(40_000)
    expect(projectCorrectionInput(tooBig, WORKSPACE_ID, sessionId, 8)).toBeUndefined()
    const unknown = stored()
    ;(unknown.meta as { version: number }).version = 99
    expect(projectCorrectionInput(unknown, WORKSPACE_ID, sessionId, 8)).toBeUndefined()
  })

  it('requires a verbatim user quote and keeps model interpretation explicitly unverified', () => {
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    const result = validateCorrectionInterpretation({ kind: 'correction', dimension: 'presentation',
      quote: '表格太宽，飞书预览看不到来源' }, input)
    expect(result).toMatchObject({ kind: 'correction', dimension: 'presentation', verification: 'unverified', releaseAuthority: 'none' })
    expect(result).not.toHaveProperty('quote')
    expect(() => validateCorrectionInterpretation({ kind: 'correction', dimension: 'presentation', quote: 'invented complaint' }, input)).toThrow()
    expect(() => validateCorrectionInterpretation({ kind: 'correction', dimension: 'presentation', quote: '表格太宽，飞书预览看不到来源', promote: true }, input)).toThrow()
    expect(validateCorrectionInterpretation({ kind: 'changed-requirement', dimension: 'other', quote: '' }, input).kind).toBe('changed-requirement')
  })
})

function memoryFacility() {
  const records = new Map<string, CorrectionRecord>()
  let puts = 0
  let failPut = 0
  const facility = { async open() {
    return { close: async () => {}, table: () => ({
      get size() { return records.size },
      get: (key: string) => records.has(key) ? structuredClone(records.get(key)) : undefined,
      entries: () => [...records.entries()].map(([key, value]) => [key, structuredClone(value)]),
      put: async (key: string, value: CorrectionRecord) => {
        puts += 1
        if (puts === failPut) throw new Error('injected persistence failure')
        records.set(key, structuredClone(value))
      },
    }) }
  } } as unknown as DomainFacility
  return { facility, records, failNextPut: () => { failPut = puts + 1 } }
}

const policies = [{ workspaceId: WORKSPACE_ID, maxAttemptsPerUtcDay: 2 }]
const modelValue = { kind: 'correction', dimension: 'presentation', quote: '表格太宽，飞书预览看不到来源' }
const modelUsage = { inputTokens: 100, outputTokens: 30, cacheReadTokens: 50 }
const noAbort = () => new AbortController().signal

describe('bounded correction inspection lifecycle', () => {
  it('records a hypothesis once across concurrent notifications and a cold reopen, without retaining raw text', async () => {
    const memory = memoryFacility()
    const ledger = await openCorrectionLedger(memory.facility, policies)
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    const classify = vi.fn(async () => ({ value: modelValue, usage: modelUsage }))
    await Promise.all([inspectConversationCorrection(ledger, input, classify, noAbort()), inspectConversationCorrection(ledger, input, classify, noAbort())])
    expect(classify).toHaveBeenCalledTimes(1)
    expect(ledger.summarize(WORKSPACE_ID)).toMatchObject({ correctionCount: 1, classifiedCount: 1,
      inputTokens: 100, outputTokens: 30, cacheReadTokens: 50, releaseAuthority: 'none' })
    expect(JSON.stringify([...memory.records.values()])).not.toContain('表格太宽')
    expect(JSON.stringify([...memory.records.values()])).not.toContain('/private/workspace')
    await ledger.close()
    const reopened = await openCorrectionLedger(memory.facility, policies)
    expect(await inspectConversationCorrection(reopened, input, classify, noAbort())).toBe('skipped')
    expect(classify).toHaveBeenCalledTimes(1)
    await reopened.close()
  })

  it('requires a Workspace policy and enforces a shared daily cap before additional model calls', async () => {
    const memory = memoryFacility()
    const ledger = await openCorrectionLedger(memory.facility, [{ workspaceId: WORKSPACE_ID, maxAttemptsPerUtcDay: 1 }])
    const classify = vi.fn(async () => ({ value: modelValue }))
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    await inspectConversationCorrection(ledger, input, classify, noAbort())
    const other = structuredClone(input)
    ;(other.source as { sessionId: string }).sessionId = 'independent-session'
    expect(await inspectConversationCorrection(ledger, other, classify, noAbort())).toBe('skipped')
    const foreign = structuredClone(input)
    ;(foreign.source as { workspaceId: string }).workspaceId = '22222222-2222-4222-8222-222222222222'
    expect(await inspectConversationCorrection(ledger, foreign, classify, noAbort())).toBe('skipped')
    expect(classify).toHaveBeenCalledTimes(1)
    expect(ledger.summarize(WORKSPACE_ID)).toMatchObject({ attemptsToday: 1, maxAttemptsPerUtcDay: 1, usageMissingCount: 1 })
    await ledger.close()
  })

  it('never calls the model after a failed reservation, and never retries an unknown external result', async () => {
    const memory = memoryFacility()
    const ledger = await openCorrectionLedger(memory.facility, policies)
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    const classify = vi.fn(async () => { throw new Error('unknown provider result') })
    memory.failNextPut()
    await expect(inspectConversationCorrection(ledger, input, classify, noAbort())).rejects.toThrow('persistence failure')
    expect(classify).not.toHaveBeenCalled()
    expect(ledger.summarize(WORKSPACE_ID).observerAvailable).toBe(false)
    await ledger.close()
    const reopened = await openCorrectionLedger(memory.facility, policies)
    expect(await inspectConversationCorrection(reopened, input, classify, noAbort())).toBe('uncertain')
    expect(await inspectConversationCorrection(reopened, input, classify, noAbort())).toBe('skipped')
    expect(classify).toHaveBeenCalledTimes(1)
    await reopened.close()
  })

  it('keeps crash-interrupted reservations and dispatches uncertain on recovery instead of spending again', async () => {
    for (const dispatch of [false, true]) {
      const memory = memoryFacility()
      const ledger = await openCorrectionLedger(memory.facility, policies)
      const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
      const record = (await ledger.reserve(input, () => true))!
      if (dispatch) await ledger.update(record, { phase: 'dispatching', modelCalls: 1 })
      await ledger.close()
      const reopened = await openCorrectionLedger(memory.facility, policies)
      const classify = vi.fn(async () => ({ value: modelValue }))
      expect(await inspectConversationCorrection(reopened, input, classify, noAbort())).toBe('skipped')
      expect(reopened.records(WORKSPACE_ID)[0]).toMatchObject({ phase: 'uncertain', reason: 'interrupted' })
      expect(classify).not.toHaveBeenCalled()
      await reopened.close()
    }
  })

  it('rejects fabricated model evidence and discards success arriving after cancellation', async () => {
    for (const cancel of [false, true]) {
      const memory = memoryFacility()
      const ledger = await openCorrectionLedger(memory.facility, policies)
      const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
      const controller = new AbortController()
      const classify = vi.fn(async () => {
        if (cancel) controller.abort()
        return { value: { ...modelValue, quote: cancel ? modelValue.quote : 'fabricated evidence' } }
      })
      expect(await inspectConversationCorrection(ledger, input, classify, controller.signal)).toBe(cancel ? 'uncertain' : 'abstained')
      expect(ledger.summarize(WORKSPACE_ID).correctionCount).toBe(0)
      expect(ledger.records(WORKSPACE_ID)[0]).not.toHaveProperty('interpretation')
      await ledger.close()
    }
  })

  it('rejects malformed/duplicate policies and a corrupted durable identity', async () => {
    expect(() => validateCorrectionPolicies([...policies, ...policies])).toThrow('duplicate')
    expect(() => validateCorrectionPolicies([{ ...policies[0]!, maxAttemptsPerUtcDay: 0 }])).toThrow()
    const memory = memoryFacility()
    const ledger = await openCorrectionLedger(memory.facility, policies)
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    await ledger.reserve(input, () => true)
    await ledger.close()
    const [id, record] = [...memory.records][0]!
    memory.records.set(id, { ...record, id: 'a'.repeat(64) })
    await expect(openCorrectionLedger(memory.facility, policies)).rejects.toThrow('identity mismatch')
  })
})

describe('native correction model seam', () => {
  it.each(['missing', 'duplicate', 'late-text', 'max-tokens'])('refuses a %s finish instead of treating a plausible JSON prefix as success', async variant => {
    const ctx = { llm: { async *stream() {
      yield { type: 'text-delta', index: 0, text: JSON.stringify(modelValue) }
      if (variant !== 'missing') yield { type: 'finish', reason: { kind: variant === 'max-tokens' ? 'max-tokens' : 'stop' } }
      if (variant === 'duplicate') yield { type: 'finish', reason: { kind: 'stop' } }
      if (variant === 'late-text') yield { type: 'text-delta', index: 0, text: ' ' }
    } } } as unknown as Context
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    await expect(nativeCorrectionClassifier(ctx)(input, noAbort())).rejects.toThrow()
  })

  it('uses the exact native route with no tools, Agent-loop marker, fabricated purpose, or prompt mutation', async () => {
    const options: GenerateOptions[] = []
    const ctx = { llm: { async *stream(input: GenerateOptions) {
      options.push(input)
      yield { type: 'text-delta', index: 0, text: JSON.stringify(modelValue) }
      yield { type: 'usage', usage: modelUsage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } } } as unknown as Context
    const input = projectCorrectionInput(stored(), WORKSPACE_ID, sessionId, 8)!
    const before = JSON.stringify(input)
    const output = await nativeCorrectionClassifier(ctx)(input, noAbort())
    expect(output).toEqual({ value: modelValue, usage: modelUsage })
    expect(options[0]).toMatchObject({ provider: 'native-provider', model: 'native-model', maxTokens: 800 })
    expect(options[0]).not.toHaveProperty('tools')
    expect(options[0]).not.toHaveProperty('purpose')
    expect(isAgentLoopRequest(options[0]!)).toBe(false)
    expect(JSON.stringify(input)).toBe(before)
  })
})
