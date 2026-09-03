import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** Read the immutable log on both the latest DSH Session API and rc targets. */
export function sessionEvents(session: Session): readonly SessionEvent[] {
  const candidate = session as unknown as {
    readonly snapshotEvents?: () => readonly SessionEvent[]
    readonly events?: readonly SessionEvent[]
  }
  if (typeof candidate.snapshotEvents === 'function') return candidate.snapshotEvents()
  if (candidate.events !== undefined) return candidate.events
  throw new Error('DSH Session does not expose a readable event snapshot')
}
