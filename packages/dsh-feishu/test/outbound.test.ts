import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { boundText, outboundTextForTurn } from '../src/outbound.js'

describe('Feishu final-answer projection', () => {
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
