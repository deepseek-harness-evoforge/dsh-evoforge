import { isDeepStrictEqual } from 'node:util'
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionHeader,
  type SessionStore,
} from '@deepseek-ai/dsh-session'
import {
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  type SessionPersistence,
} from '@deepseek-ai/dsh-session-persistence'
import {
  assembleInteractionEpisodeInputV1,
  type InteractionEpisodeAssemblyResultV1,
  type InteractionEpisodeEvidenceDimensionV1,
  type InteractionEpisodeHostEvidenceResolutionV1,
} from './interaction-episode-assembler.ts'
import {
  proveInteractionEpisodeTranscript,
  type InteractionEpisodeTranscriptProofResult,
  type InteractionEpisodeTranscriptProofV1,
  type InteractionEpisodeTranscriptSourceV1,
  type InteractionTranscriptDirectTriggerLocatorV1,
} from './interaction-episode-projector.ts'
import type { InteractionEpisodeInputV1 } from './interaction-episode-store.ts'

const stockMissingDimensions = [
  'workspace',
  'capability-boundary',
  'catalog',
  'generation',
  'routing',
  'replay-environment',
  'workspace-snapshot',
  'composition',
  'model',
  'permissions',
  'sandbox',
  'budget',
  'dsh-revision',
  'external-effects',
] as const satisfies readonly InteractionEpisodeEvidenceDimensionV1[]

export interface InteractionEpisodeResolutionTargetV1 {
  readonly session: Session
  readonly turnEndSeq: number
  readonly trigger: InteractionTranscriptDirectTriggerLocatorV1
}

/**
 * Physically read-back Session subject supplied only to a trusted Host attestor.
 * The event cut ends exactly at `turnEndSeq`; later persisted events are excluded.
 */
export interface DurableInteractionEpisodeSubjectV1 {
  readonly schemaVersion: 1
  readonly kind: 'durable-interaction-episode-subject-v1'
  readonly session: {
    readonly header: SessionHeader
    readonly inheritedEventCount: number
    readonly throughSeq: number
    readonly events: readonly SessionEvent[]
  }
  readonly transcript: InteractionEpisodeTranscriptProofV1
}

/** @internal Authority-bearing trusted-composition port; not a public verifier. */
export interface InteractionEpisodeHostEvidenceAttestorV1 {
  resolve(
    subject: DurableInteractionEpisodeSubjectV1,
  ): Promise<InteractionEpisodeHostEvidenceResolutionV1>
}

type SessionDurabilityReason =
  | 'session-not-live'
  | 'liveness-check-failed'
  | 'flush-unobserved'
  | 'flush-failed'
  | 'stored-read-failed'
  | 'stored-cut-unavailable'
  | 'stored-cut-conflict'

type TranscriptAbstentionReason = Extract<
  InteractionEpisodeTranscriptProofResult,
  { readonly status: 'abstained' }
>['reason']

export type InteractionEpisodeResolutionResultV1 =
  | { readonly status: 'assembled'; readonly input: InteractionEpisodeInputV1 }
  | {
    readonly status: 'abstained'
    readonly stage: 'session-durability'
    readonly reason: SessionDurabilityReason
    readonly dimensions: readonly ('subject' | 'session-durability')[]
  }
  | {
    readonly status: 'abstained'
    readonly stage: 'transcript'
    readonly reason: TranscriptAbstentionReason
    readonly dimensions: readonly ['subject']
  }
  | {
    readonly status: 'abstained'
    readonly stage: 'host-evidence'
    readonly reason:
      | 'attestor-invocation-failed'
      | 'evidence-unavailable'
      | 'evidence-conflict'
    readonly dimensions: readonly InteractionEpisodeEvidenceDimensionV1[]
  }
  | {
    readonly status: 'abstained'
    readonly stage: 'assembly'
    readonly reason: Extract<InteractionEpisodeAssemblyResultV1, {
      readonly status: 'abstained'
    }>['reason']
    readonly dimensions: readonly InteractionEpisodeEvidenceDimensionV1[]
  }

export interface InteractionEpisodeEvidenceResolverV1 {
  resolve(target: InteractionEpisodeResolutionTargetV1): Promise<InteractionEpisodeResolutionResultV1>
}

interface InteractionEpisodeEvidenceResolverDependenciesV1 {
  readonly sessions: Pick<SessionStore, 'get' | 'flush'>
  readonly sessionPersistence: Pick<SessionPersistence, 'readFrom'>
  readonly attestor: InteractionEpisodeHostEvidenceAttestorV1
}

interface StockDshAlpha5ResolverDependenciesV1 {
  readonly sessions: Pick<SessionStore, 'get' | 'flush'>
  readonly sessionPersistence: Pick<SessionPersistence, 'readFrom'>
}

/**
 * Resolve one exact completed turn without writing an Episode or Gap.
 *
 * The resolver treats alpha.5 `flush() === true` as necessary but not
 * sufficient. It physically reads and compares the complete prefix before it
 * asks a trusted Host attestor for the remaining evidence.
 *
 * @internal Trusted composition only. Do not expose this injectable factory as
 * a package-root authority boundary.
 */
export function createInteractionEpisodeEvidenceResolver(
  dependencies: InteractionEpisodeEvidenceResolverDependenciesV1,
): InteractionEpisodeEvidenceResolverV1 {
  const { attestor, sessionPersistence, sessions } = dependencies
  return Object.freeze({
    async resolve(
      target: InteractionEpisodeResolutionTargetV1,
    ): Promise<InteractionEpisodeResolutionResultV1> {
      let captured: CapturedTarget
      try {
        captured = captureTarget(target)
      } catch (error) {
        return transcriptAbstention(error instanceof TargetCaptureError
          ? error.reason
          : 'transcript-not-proven')
      }

      // `session/event` observers are fire-and-forget. Yield so persistence
      // callbacks later in the current synchronous observer snapshot can
      // enqueue turn/end before this resolver asks them to flush.
      await Promise.resolve()

      const beforeFlush = livenessFailure(sessions, captured)
      if (beforeFlush !== undefined) return durabilityAbstention(beforeFlush)
      let observed: boolean
      try {
        observed = await sessions.flush(captured.session)
      } catch {
        return durabilityAbstention('flush-failed')
      }
      if (observed !== true) return durabilityAbstention('flush-unobserved')
      const afterFlush = livenessFailure(sessions, captured)
      if (afterFlush !== undefined) return durabilityAbstention(afterFlush)

      let stored: unknown
      try {
        stored = await sessionPersistence.readFrom(
          captured.sessionId,
          SessionLogOffset(0),
        )
      } catch (error) {
        const reason = classifyStoredReadFailure(error, captured.sessionId)
        return durabilityAbstention(reason, reason === 'stored-cut-conflict'
          ? ['subject', 'session-durability']
          : ['session-durability'])
      }
      const afterRead = livenessFailure(sessions, captured)
      if (afterRead !== undefined) return durabilityAbstention(afterRead)
      const readback = verifyStoredCut(captured, stored)
      if (readback.status === 'abstained') return readback.result

      const transcript = proveInteractionEpisodeTranscript(
        readback.source,
        captured.turnEndSeq,
        captured.trigger,
      )
      if (transcript.status === 'abstained') {
        return immutableCopy({
          status: 'abstained',
          stage: 'transcript',
          reason: transcript.reason,
          dimensions: ['subject'],
        } as const)
      }

      const subject = immutableCopy({
        schemaVersion: 1,
        kind: 'durable-interaction-episode-subject-v1',
        session: {
          header: readback.header,
          inheritedEventCount: readback.inheritedEventCount,
          throughSeq: captured.turnEndSeq,
          events: readback.events,
        },
        transcript: transcript.proof,
      } as const satisfies DurableInteractionEpisodeSubjectV1)

      let rawHost: unknown
      try {
        rawHost = await attestor.resolve(subject)
      } catch {
        return hostEvidenceAbstention('attestor-invocation-failed', ['binding'])
      }
      let host: InteractionEpisodeHostEvidenceResolutionV1
      try {
        host = immutableCopy(rawHost) as InteractionEpisodeHostEvidenceResolutionV1
      } catch {
        return hostEvidenceAbstention('evidence-conflict', ['binding'])
      }
      const assembled = assembleInteractionEpisodeInputV1({
        proof: transcript.proof,
        host,
      })
      if (assembled.status === 'assembled') return assembled
      if (host?.status !== 'resolved') {
        return hostEvidenceAbstention(
          assembled.reason === 'subject-mismatch'
            ? 'evidence-conflict'
            : assembled.reason,
          assembled.dimensions,
        )
      }
      return immutableCopy({
        status: 'abstained',
        stage: 'assembly',
        reason: assembled.reason,
        dimensions: assembled.dimensions,
      } as const)
    },
  })
}

/**
 * Stock DSH alpha.5 can prove the Session cut, but it does not retain enough
 * historical Host evidence to seal an Interaction Episode honestly.
 */
export function createStockDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: StockDshAlpha5ResolverDependenciesV1,
): InteractionEpisodeEvidenceResolverV1 {
  return createInteractionEpisodeEvidenceResolver({
    ...dependencies,
    attestor: stockDshAlpha5Attestor,
  })
}

const stockDshAlpha5Attestor: InteractionEpisodeHostEvidenceAttestorV1 = Object.freeze({
  async resolve() {
    return immutableCopy({
      status: 'abstained',
      reason: 'evidence-unavailable',
      dimensions: stockMissingDimensions,
    } as const)
  },
})

interface CapturedTarget {
  readonly session: Session
  readonly sessionId: Session['id']
  readonly turnEndSeq: number
  readonly trigger: InteractionTranscriptDirectTriggerLocatorV1
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly events: readonly SessionEvent[]
}

class TargetCaptureError extends Error {
  constructor(readonly reason: TranscriptAbstentionReason) {
    super(reason)
  }
}

function captureTarget(target: InteractionEpisodeResolutionTargetV1): CapturedTarget {
  const session = target.session
  const turnEndSeq = target.turnEndSeq
  const callId = target.trigger.callId
  if (!Number.isSafeInteger(turnEndSeq) || turnEndSeq < 0) {
    throw new TargetCaptureError('turn-not-found')
  }
  if (typeof callId !== 'string' || callId.length === 0) {
    throw new TargetCaptureError('trigger-not-proven')
  }
  const header = structuredClone(session.header)
  const inheritedEventCount = Number(session.inheritedEventCount)
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) {
    throw new TypeError('Invalid inherited Session cut')
  }
  const events = structuredClone(session.snapshotEvents(
    SessionLogOffset(0),
    SessionLogOffset(turnEndSeq + 1),
  ))
  if (events.length !== turnEndSeq + 1) {
    throw new TargetCaptureError('turn-not-found')
  }
  return Object.freeze({
    session,
    sessionId: session.id,
    turnEndSeq,
    trigger: Object.freeze({ callId }),
    header: deepFreeze(header),
    inheritedEventCount,
    events: deepFreeze(events),
  })
}

function livenessFailure(
  sessions: Pick<SessionStore, 'get'>,
  captured: CapturedTarget,
): 'session-not-live' | 'liveness-check-failed' | undefined {
  try {
    return sessions.get(captured.sessionId) === captured.session
      ? undefined
      : 'session-not-live'
  } catch {
    return 'liveness-check-failed'
  }
}

function classifyStoredReadFailure(
  error: unknown,
  expectedSessionId: Session['id'],
): Extract<SessionDurabilityReason,
  'stored-read-failed' | 'stored-cut-unavailable' | 'stored-cut-conflict'> {
  try {
    if (error instanceof SessionPersistenceNotFoundError) {
      return error.sessionId === expectedSessionId
        ? 'stored-cut-unavailable'
        : 'stored-read-failed'
    }
    if (error instanceof SessionFormatUnsupportedError) return 'stored-cut-unavailable'
    if (error instanceof SessionPersistenceCorruptionError) return 'stored-cut-conflict'
  } catch {
    // Hostile thrown values are invocation failures, never evidence conclusions.
  }
  return 'stored-read-failed'
}

type StoredCutVerification =
  | {
    readonly status: 'verified'
    readonly header: SessionHeader
    readonly inheritedEventCount: number
    readonly events: readonly SessionEvent[]
    readonly source: InteractionEpisodeTranscriptSourceV1
  }
  | {
    readonly status: 'abstained'
    readonly result: InteractionEpisodeResolutionResultV1
  }

function verifyStoredCut(captured: CapturedTarget, candidate: unknown): StoredCutVerification {
  let header: SessionHeader
  let inheritedEventCount: number
  let fromSeq: number
  let persistedEvents: readonly SessionEvent[]
  try {
    if (candidate === null || typeof candidate !== 'object') {
      return unavailableStoredCut()
    }
    const stored = candidate as {
      readonly meta?: unknown
      readonly inheritedEventCount?: unknown
      readonly fromSeq?: unknown
      readonly events?: unknown
    }
    if (stored.meta === undefined || !Array.isArray(stored.events)) {
      return unavailableStoredCut()
    }
    header = structuredClone(stored.meta) as SessionHeader
    if (typeof stored.inheritedEventCount !== 'number'
      || typeof stored.fromSeq !== 'number') return conflictingStoredCut()
    inheritedEventCount = stored.inheritedEventCount
    fromSeq = stored.fromSeq
    persistedEvents = structuredClone(stored.events) as readonly SessionEvent[]
  } catch {
    return conflictingStoredCut()
  }
  if (fromSeq !== 0
    || !Number.isSafeInteger(inheritedEventCount)
    || inheritedEventCount < 0
    || Object.is(fromSeq, -0)
    || Object.is(inheritedEventCount, -0)
    || !isDeepStrictEqual(header, captured.header)
    || inheritedEventCount !== captured.inheritedEventCount) {
    return conflictingStoredCut()
  }
  if (persistedEvents.length < captured.events.length) return unavailableStoredCut()
  const exactEvents = persistedEvents.slice(0, captured.events.length)
  if (!isDeepStrictEqual(exactEvents, captured.events)) return conflictingStoredCut()

  const events = immutableCopy(exactEvents)
  const durableHeader = immutableCopy(header)
  const source: InteractionEpisodeTranscriptSourceV1 = Object.freeze({
    header: durableHeader,
    inheritedEventCount: SessionLogOffset(inheritedEventCount),
    snapshotEvents: () => events,
  })
  return {
    status: 'verified',
    header: durableHeader,
    inheritedEventCount,
    events,
    source,
  }
}

function unavailableStoredCut(): StoredCutVerification {
  return {
    status: 'abstained',
    result: durabilityAbstention('stored-cut-unavailable'),
  }
}

function conflictingStoredCut(): StoredCutVerification {
  return {
    status: 'abstained',
    result: durabilityAbstention('stored-cut-conflict', ['subject', 'session-durability']),
  }
}

function durabilityAbstention(
  reason: SessionDurabilityReason,
  dimensions: readonly ('subject' | 'session-durability')[] = ['session-durability'],
): InteractionEpisodeResolutionResultV1 {
  return immutableCopy({
    status: 'abstained',
    stage: 'session-durability',
    reason,
    dimensions,
  } as const)
}

function transcriptAbstention(
  reason: TranscriptAbstentionReason,
): InteractionEpisodeResolutionResultV1 {
  return immutableCopy({
    status: 'abstained',
    stage: 'transcript',
    reason,
    dimensions: ['subject'],
  } as const)
}

function hostEvidenceAbstention(
  reason:
    | 'attestor-invocation-failed'
    | 'evidence-unavailable'
    | 'evidence-conflict',
  dimensions: readonly InteractionEpisodeEvidenceDimensionV1[],
): InteractionEpisodeResolutionResultV1 {
  return immutableCopy({
    status: 'abstained',
    stage: 'host-evidence',
    reason,
    dimensions,
  } as const)
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
