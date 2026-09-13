import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { deepFreeze, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { TranscriptEvent, TranscriptHeader } from '../src/interaction-transcript-types.ts'

type EventType = TranscriptEvent['type']
type EventData<T extends EventType> = T extends 'request/header'
  ? Omit<TranscriptEvent<T>['data'], 'header'> & {
      header: TranscriptEvent<'request/header'>['data']['header'] & { system?: string }
    }
  : TranscriptEvent<T>['data']
type Surface = Pick<TranscriptEvent, 'surfaceOp' | 'sourceEventSeqs'>

/**
 * Test-data writer for archived v0 input, NOT a Session implementation.
 * No execution, projection, event feed, storage, or validation authority.
 * Negative reader cases deliberately construct invalid/mixed historical data.
 */
export class HistoricalV0TranscriptFixture {
  readonly inheritedEventCount = SessionLogOffset(0)
  private readonly events: TranscriptEvent[] = []

  constructor(readonly header: TranscriptHeader & { version: 0 }) {}

  get seq(): number { return this.events.length }

  append<T extends EventType>(type: T, data: EventData<T>, surface: Surface = {}): TranscriptEvent<T> {
    // Use the native stack-safe JSON snapshot utility, not a live Session.
    const snapshot = snapshotJsonValue({
      type,
      seq: SessionSeq(this.events.length),
      time: Date.now(),
      data,
      ...surface,
    })
    if (snapshot === undefined) throw new Error('historical fixture is not JSON')
    const event = deepFreeze(snapshot) as unknown as TranscriptEvent<T>
    this.events.push(event)
    return event
  }

  snapshotEvents(): readonly TranscriptEvent[] { return this.events.slice() }
}
