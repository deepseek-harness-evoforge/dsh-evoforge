import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { outboundTextForTurn } from '../src/outbound.js'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data, ignorable: true } as unknown as SessionEvent
}

describe('Telegram outbound text', () => {
  it('reconstructs only the final non-empty assistant text in the exact turn and bounds it', () => {
    const events = [
      event(0, 'assistant/message', {
        turn: 3,
        step: 1,
        message: { content: [{ type: 'text', text: 'intermediate' }] },
      }),
      event(1, 'assistant/message', {
        turn: 3,
        step: 2,
        message: { content: [{ type: 'text', text: 'final answer that is longer' }] },
      }),
      event(2, 'assistant/message', {
        turn: 4,
        step: 1,
        message: { content: [{ type: 'text', text: 'other turn' }] },
      }),
    ]

    expect(outboundTextForTurn(events, 3, 18)).toBe('final answer that…')
    expect(outboundTextForTurn(events, 9, 100)).toBeUndefined()
  })
})
