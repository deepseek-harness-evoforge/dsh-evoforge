import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Local/foreign input vetoes automatic channel mirroring, including after reload. */
export function hasNonChannelTurnInput(
  events: readonly SessionEvent[],
  turn: number,
  channelMessageId?: string,
): boolean {
  let start = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'turn/start' && event.data.turn === turn) { start = index; break }
  }
  if (start < 0) return true
  // Native context contributions are also logged as user/message. Only inbox
  // input (plus any direct human message) is an origin, not injected policy,
  // AGENTS instructions, or other model-context decoration.
  const queuedIds = new Set<string>()
  for (const event of events) {
    if (event.type === 'agent/inbox/spliced') {
      for (const message of event.data.inserted) queuedIds.add(String(message.id))
    }
  }
  for (const event of events.slice(start + 1)) {
    if (event.type === 'turn/start' || event.type === 'turn/end') break
    if (event.type !== 'user/message') continue
    if (channelMessageId !== undefined && String(event.data.id) === channelMessageId) continue
    if (event.data.source.kind === 'plugin' && event.data.source.plugin === 'schedule') continue
    if (event.data.source.kind === 'user' || queuedIds.has(String(event.data.id))) return true
  }
  return false
}

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
