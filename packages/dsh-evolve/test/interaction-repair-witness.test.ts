import { interruptedTurnClosers, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { expectedTranscriptRepairSuffix } from '../src/interaction-repair-witness.ts'
import type { TranscriptEvent } from '../src/interaction-transcript-types.ts'

// Plain recorded fixtures, not live Sessions. Intentionally include historical
// chunk records when comparing the two audited native pure repair functions.
const event = (type: string, data: unknown = {}) => ({ type, data })
const start = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 })]
const assistant = event('assistant/message', {
  turn: 1, step: 1, stream: [],
  message: { id: 'assistant', role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    content: ['a', 'b'].map(id => ({ type: 'tool-call', id, name: 'fixture', arguments: '{}' })) },
})
const call = event('tool/call', { turn: 1, step: 1, callId: 'a', name: 'fixture', arguments: '{}' })
const result = event('tool/result', {
  turn: 1, step: 1,
  message: { id: 'result', role: 'user', source: { kind: 'tool', callId: 'a' },
    content: [{ type: 'tool-result', toolCallId: 'a', isError: false, content: [] }] },
})

describe('read-only interrupted-turn witness matches audited native repair', () => {
  it.each([
    [],
    start.slice(0, 1),
    start,
    [...start, assistant],
    [...start, assistant, call],
    [...start, assistant, call, result],
    [...start, assistant, event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'tail' } })],
    [...start, assistant, event('step/end', { turn: 1, step: 1 })],
    [...start, assistant, event('turn/end', { turn: 1, reason: { kind: 'interrupted' } })],
    [...start, assistant, event('turn/end', { turn: 1, reason: { kind: 'interrupted' } }), event('turn/start', { turn: 2 })],
  ])('preserves exact suffix, ordering, timestamp and uncertain outcome %#', (...input) => {
    const events = input.map((row, seq) => ({ ...row, seq, time: 1_000 + seq * 10 }))
    const before = structuredClone(events)
    // Runtime shape compatibility is the subject of this differential test;
    // neither cast exists on the production historical-reader boundary.
    const expected = interruptedTurnClosers(events as unknown as SessionEvent[])
    const actual = expectedTranscriptRepairSuffix(events as unknown as TranscriptEvent[])
    expect(actual).toEqual(expected)
    expect(events).toEqual(before)
  })
})
