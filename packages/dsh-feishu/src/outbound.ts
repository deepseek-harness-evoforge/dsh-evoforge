import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Reconstruct one bounded final answer from native DSH Session events. */
export function outboundTextForTurn(
  events: readonly SessionEvent[],
  turn: number,
  maxChars: number,
): string | undefined {
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('turn must be a positive safe integer')
  if (!Number.isSafeInteger(maxChars) || maxChars < 2) throw new Error('maxChars must be at least 2')
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    if (text.length === 0) continue
    return boundText(text, maxChars)
  }
  return undefined
}

export function boundText(value: string, maxChars: number): string {
  const text = value.length === 0 ? '(no output)' : value
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`
}
