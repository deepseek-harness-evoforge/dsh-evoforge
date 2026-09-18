import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { boundText, hasNonChannelTurnInput, outboundTextForTurn } from '../src/outbound.js'

describe('Feishu final-answer projection', () => {
  it('vetoes local/foreign or mixed input and fails closed without a turn boundary', () => {
    const start = { type: 'turn/start', data: { turn: 2 } }
    const local = { type: 'user/message', data: { id: 'web', source: { kind: 'user' } } }
    const channel = { type: 'user/message', data: { id: 'channel:owned', source: { kind: 'user' } } }
    const schedule = { type: 'user/message', data: { id: 'reminder', source: { kind: 'plugin', plugin: 'schedule' } } }
    const check = (events: unknown[], id?: string) => hasNonChannelTurnInput(events as SessionEvent[], 2, id)
    expect(check([])).toBe(true)
    expect(check([start, local])).toBe(true)
    expect(check([start, channel])).toBe(true) // reload without exact ingress correlation
    expect(check([start, channel], 'channel:owned')).toBe(false)
    expect(check([start, channel, local], 'channel:owned')).toBe(true)
    expect(check([start, local, channel], 'channel:owned')).toBe(true)
    expect(check([start, schedule])).toBe(false)
    expect(check([start, channel, { type: 'user/message', data: { id: 'context', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } } }], 'channel:owned')).toBe(false)
    expect(check([start, schedule, local])).toBe(true)
    const foreign = { id: 'unknown', source: { kind: 'plugin', plugin: 'other' } }
    expect(check([{ type: 'agent/inbox/spliced', data: { inserted: [foreign] } }, start,
      { type: 'user/message', data: foreign }])).toBe(true)
    expect(check([start, channel, { type: 'user/message', data: { id: 'instructions', source: { kind: 'agent-instructions' } } }], 'channel:owned')).toBe(false)
    expect(check([local, start, schedule])).toBe(false)
    expect(check([start, schedule, { type: 'turn/end', data: { turn: 2 } }, local])).toBe(false)
  })
  it('selects only the final native assistant text for the requested turn', () => {
    const events = [{
      type: 'assistant/message',
      data: { turn: 2, message: { content: [{ type: 'text', text: 'final answer' }] } },
    }] as unknown as SessionEvent[]
    expect(outboundTextForTurn(events, 2, 100)).toBe('final answer')
    expect(outboundTextForTurn(events, 1, 100)).toBeUndefined()
  })

  it('bounds platform text deterministically', () => {
    expect(boundText('', 20)).toBe('(no output)')
    expect(boundText('1234567890', 5)).toBe('1234…')
  })
})
