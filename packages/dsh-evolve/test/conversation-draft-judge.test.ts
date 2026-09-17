import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { expect, it, vi } from 'vitest'
import { nativeConversationDraftJudge, parseDraftJudgment } from '../src/conversation-draft-judge.ts'

const task = '试验用虚构事实：货架数量为8，负责人是林。请用一句话转述，不增加事实。'
const answer = '林负责的货架共有八个。'
const decision = { verdict: 'pass', explanation: '数量和负责人一致，没有增加事实。',
  citations: [{ source: 'task', quote: '数量为8' }, { source: 'answer', quote: '共有八个' }] }

it('accepts a quoted semantic decision without turning it into substring matching', () => {
  expect(parseDraftJudgment(decision, task, answer)).toEqual(decision)
  expect(() => parseDraftJudgment({ ...decision, citations: [{ source: 'answer', quote: 'invented quotation' }] }, task, answer)).toThrow()
  expect(() => parseDraftJudgment({ ...decision, citations: [] }, task, answer)).toThrow()
  expect(() => parseDraftJudgment({ ...decision, approved: true }, task, answer)).toThrow()
})

it('uses one blind native request with no draft, reference, variant, history or tools', async () => {
  const requests: GenerateOptions[] = []
  const ctx = { llm: { async *stream(options: GenerateOptions) {
    requests.push(options)
    yield { type: 'text-delta', index: 0, text: JSON.stringify(decision) }
    yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 20 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } } as unknown as Pick<Context, 'llm'>
  const result = await nativeConversationDraftJudge(ctx)({ task, answer, route: { provider: 'native', model: 'fixed' } }, new AbortController().signal)
  expect(result.decision).toEqual(decision)
  expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 20 })
  expect(requests).toHaveLength(1)
  expect(requests[0]?.maxTokens).toBe(1000)
  expect(requests[0]?.tools).toBeUndefined()
  expect(requests[0]?.messages).toHaveLength(1)
  const content = requests[0]!.messages[0]!.content[0]!
  expect(content.type).toBe('text')
  expect(JSON.parse(content.type === 'text' ? content.text : '')).toEqual({ task, answer })
})

it('retains uncertainty and does not retry malformed, interrupted or tool-producing judgments', async () => {
  for (const finish of ['max-tokens', 'aborted', 'tool-calls', 'stop'] as const) {
    const stream = vi.fn(async function* () {
      yield { type: 'text-delta', index: 0, text: finish === 'stop' ? 'not-json' : JSON.stringify(decision) }
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 20 } }
      yield { type: 'finish', reason: { kind: finish } }
    })
    const judge = nativeConversationDraftJudge({ llm: { stream } } as unknown as Pick<Context, 'llm'>)
    await expect(judge({ task, answer, route: { provider: 'native', model: 'fixed' } }, new AbortController().signal)).rejects.toMatchObject({
      usage: { inputTokens: 30, outputTokens: 20 },
    })
    expect(stream).toHaveBeenCalledTimes(1)
  }
})
