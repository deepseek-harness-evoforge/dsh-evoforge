import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TranscriptEvent } from './interaction-transcript-types.ts'

/**
 * Native Goal's audited fold consumes only goal/change and User message source.
 * Project those facts in original order; do not feed it retired Assistant or
 * Tool vocabulary. Placement metadata is not a Goal input. This detached view
 * is never written back or used for transcript digests / model composition.
 */
export function foldTranscriptGoal(events: readonly TranscriptEvent[]): ReturnType<typeof foldGoal> {
  const inputs: SessionEvent[] = []
  for (const event of events) {
    if (event.type === 'goal/change') inputs.push({
      type: event.type, seq: event.seq, time: event.time, data: event.data,
    })
    if (event.type === 'user/message') inputs.push({
      type: event.type, seq: event.seq, time: event.time, data: event.data, surfaceOp: 'append',
    })
  }
  return foldGoal(inputs)
}
