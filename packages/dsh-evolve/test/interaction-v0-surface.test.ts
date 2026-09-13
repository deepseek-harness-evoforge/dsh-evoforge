import { describe, expect, it } from 'vitest'
import { foldHistoricalV0Surface } from '../src/interaction-v0-surface.ts'

const user = (seq: number, extra = {}) => ({ type: 'user/message', seq, data: {}, surfaceOp: 'append', ...extra })
const replace = (seq: number, start: number, end: number, sources: unknown) => user(seq, {
  surfaceOp: { op: 'replace', start, end }, sourceEventSeqs: sources,
})

describe('frozen v0 surface provenance projection', () => {
  it('retains legacy Assistant citations and positional replacement history without changing events', () => {
    const events = [user(0), { type: 'assistant/chunk', seq: 1 }, {
      type: 'assistant/message', seq: 2, surfaceOp: 'append', sourceEventSeqs: [1],
    }, replace(3, 0, 2, [0, 2])]
    const before = structuredClone(events)
    expect(foldHistoricalV0Surface(events)).toEqual({
      nodes: [3], replacements: [{ seq: 3, shadowedSeqs: [0, 2] }],
    })
    expect(events).toEqual(before)
  })

  it('allows empty citations only for an Assistant and preserves current positional order', () => {
    expect(foldHistoricalV0Surface([user(0), {
      type: 'assistant/message', seq: 1, surfaceOp: 'append', sourceEventSeqs: [],
    }, replace(2, 0, 0, [0]), replace(3, 2, 1, [2, 1])]).nodes).toEqual([3])
  })

  it.each([
    [user(1)],
    [user(0, { surfaceOp: undefined })],
    [user(0, { sourceEventSeqs: [] })],
    [user(0), replace(1, 0, 0, [])],
    [user(0), replace(1, 0, 0, [0, 0])],
    [user(0), replace(1, 0, 0, [1])],
    [user(0), replace(1, 0, 0, [-0])],
    [user(0), replace(1, 0, 0, [0.5])],
    [user(0), replace(1, 0, 0, new Array(1))],
    [user(0), replace(1, 0, 0, '0')],
    [user(0), replace(1, 0, 0, [0]), replace(2, 0, 0, [0])],
    [user(0), user(1), replace(2, 1, 0, [0, 1])],
    [user(0), user(1), replace(2, 0, 1, [0])],
    [user(0), user(1, { surfaceOp: { op: 'replace', start: 0, end: 0, extra: true }, sourceEventSeqs: [0] })],
    [{ type: 'assistant/chunk', seq: 0, surfaceOp: 'append' }],
    [{ type: 'assistant/chunk', seq: 0, sourceEventSeqs: [] }],
  ])('rejects malformed provenance %#', (...events) => {
    expect(() => foldHistoricalV0Surface(events)).toThrow()
  })

  it('allows Tool content-only replacement but rejects changing its identity or replacing a human', () => {
    const tool = (seq: number, content: string) => ({
      type: 'tool/result', seq, surfaceOp: 'append',
      data: { turn: 1, step: 1, message: { id: 'result', content: [{ type: 'tool-result', toolCallId: 'call', content }] } },
    })
    const replacement = { ...tool(1, 'shortened'), surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] }
    expect(foldHistoricalV0Surface([tool(0, 'long'), replacement]).nodes).toEqual([1])
    expect(() => foldHistoricalV0Surface([user(0), replacement])).toThrow()
    replacement.data.message.id = 'another'
    expect(() => foldHistoricalV0Surface([tool(0, 'long'), replacement])).toThrow()
  })
})
