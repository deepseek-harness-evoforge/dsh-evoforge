import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Read one immutable Session log across the DSH 0.1.x API split.
 *
 * DSH 0.1.2-alpha.5 intentionally removed the public mutable `events` field
 * in favour of `snapshotEvents()`. The rc.5/rc.2 compatibility targets still
 * expose `events`, so this narrow adapter keeps EvoForge's projections on one
 * explicit, read-only seam instead of scattering version casts through the
 * evolution and gateway code.
 */
export function sessionEvents(session: Session): readonly SessionEvent[] {
  const candidate = session as unknown as {
    readonly snapshotEvents?: () => readonly SessionEvent[]
    readonly events?: readonly SessionEvent[]
  }
  if (typeof candidate.snapshotEvents === 'function') return candidate.snapshotEvents()
  if (candidate.events !== undefined) return candidate.events
  throw new Error('DSH Session does not expose a readable event snapshot')
}
