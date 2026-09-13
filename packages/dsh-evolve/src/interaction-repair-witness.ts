/**
 * Read-only expected repair witness, never appended to a Session. Rules frozen
 * from DSH repair.ts (identical in audited db6bdc3 and c291e79). The live native
 * repair API is typed for the current writable event format, not historical
 * Assistant records. Do not cast a historical log into that writable format.
 *
 * Adapted from DeepSeek Harness, Copyright (c) 2026 DeepSeek, MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to
 * do so, subject to the following conditions: The above copyright notice and
 * this permission notice shall be included in all copies or substantial
 * portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY
 * OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
import { MessageId, type ToolCallId, type ToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { TranscriptEvent } from './interaction-transcript-types.ts'

export function expectedTranscriptRepairSuffix(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  let turn: number | undefined
  let step: number | undefined
  const pending = new Map<ToolCallId, { step: number; callSeq?: SessionSeq }>()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        turn = event.data.turn
        step = undefined
        pending.clear()
        break
      case 'turn/end':
        turn = undefined
        step = undefined
        pending.clear()
        break
      case 'step/start': step = event.data.step; break
      case 'step/end': step = undefined; pending.clear(); break
      case 'assistant/message':
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pending.set(block.id, { step: event.data.step })
        }
        break
      case 'tool/call': {
        const call = pending.get(event.data.callId)
        if (call !== undefined) call.callSeq = event.seq
        break
      }
      case 'tool/result': pending.delete(event.data.message.source.callId); break
    }
  }
  const last = events.at(-1)
  if (turn === undefined || last === undefined) return []
  let seq = Number(last.seq) + 1
  const time = last.time
  const suffix: TranscriptEvent[] = []
  for (const [callId, call] of pending) {
    const started = call.callSeq !== undefined
    const message: ToolResultMessage = {
      id: MessageId(`interrupted-tool-result-${callId}-${seq}`),
      role: 'user' as const,
      source: { kind: 'tool' as const, callId },
      content: [{
        type: 'tool-result' as const, toolCallId: callId, isError: true,
        content: [{ type: 'text' as const, text: started
          ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
          : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.' }],
      }],
    }
    suffix.push({
      type: 'tool/result', seq: SessionSeq(seq++), time,
      data: { turn, step: call.step, message, error: started
        ? { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' }
        : { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' } },
      surfaceOp: 'append', ...(call.callSeq === undefined ? {} : { sourceEventSeqs: [call.callSeq] }),
    })
  }
  if (step !== undefined) suffix.push({ type: 'step/end', seq: SessionSeq(seq++), time, data: { turn, step } })
  suffix.push({ type: 'turn/end', seq: SessionSeq(seq), time, data: { turn, reason: { kind: 'interrupted' } } })
  return suffix
}
