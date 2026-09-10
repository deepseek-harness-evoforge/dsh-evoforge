import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
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
import type { GatewayIngressEvidenceSourceV1 } from 'dsh-evoforge-gateway'
import {
  interactionGenerationSessionLifecycleDigest,
  type InteractionEpisodeGenerationFactV1,
  type InteractionGenerationEvidenceSourceV1,
} from './interaction-generation-evidence.ts'
import {
  interactionRoutingSessionLifecycleDigest,
  type InteractionEpisodeRoutingFactV1,
  type InteractionRoutingEvidenceSourceV1,
} from './interaction-routing-evidence.ts'
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
import {
  projectInteractionEpisodeTriggerRequestControlV1,
  type InteractionEpisodeTriggerRequestControlFactV1,
  type InteractionEpisodeTriggerRequestControlSubjectV1,
} from './interaction-trigger-request-control.ts'
import type { InteractionEpisodeInputV1 } from './interaction-episode-store.ts'
import { runWithLifecycleDeadline } from './lifecycle-deadline.ts'
import { isWorkspaceId } from './workspace-identity.ts'

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

const DEFAULT_HOST_EVIDENCE_SOURCE_TIMEOUT_MS = 30_000
const MAX_HOST_EVIDENCE_SOURCE_TIMEOUT_MS = 120_000

export interface InteractionEpisodeResolutionTargetV1 {
  readonly session: Session
  readonly turnEndSeq: number
  readonly trigger: InteractionTranscriptDirectTriggerLocatorV1
}

/**
 * Physically read-back Session subject supplied only to a trusted Host attestor.
 * The event cut ends exactly at `turnEndSeq`; later persisted events are excluded.
 */
export interface DurableInteractionEpisodeSubjectV1
  extends InteractionEpisodeTriggerRequestControlSubjectV1 {}

/** @internal Authority-bearing trusted-composition port; not a public verifier. */
export interface InteractionEpisodeHostEvidenceAttestorV1 {
  resolve(
    subject: DurableInteractionEpisodeSubjectV1,
    derived: InteractionEpisodeDerivedEvidenceV1,
  ): Promise<InteractionEpisodeHostEvidenceResolutionV1>
}

/** Session-authoritative projections; neither Host evidence nor provider attestation. */
export interface InteractionEpisodeDerivedEvidenceV1 {
  readonly triggerRequestControl: InteractionEpisodeTriggerRequestControlFactV1
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
  /** Cordis fiber that owns every Host-source invocation deadline. */
  readonly lifecycle: Pick<Context, 'effect'>
  readonly generationEvidence?: InteractionGenerationEvidenceSourceV1
  readonly routingEvidence?: InteractionRoutingEvidenceSourceV1
  /** @internal Test seam; production composition uses the bounded default. */
  readonly hostEvidenceSourceTimeoutMs?: number
}

interface GatewayAwareDshAlpha5ResolverDependenciesV1
extends StockDshAlpha5ResolverDependenciesV1 {
  readonly gateway: GatewayIngressEvidenceSourceV1
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

      const requestControl = projectInteractionEpisodeTriggerRequestControlV1(subject)
      if (requestControl.status !== 'projected') {
        return hostEvidenceAbstention('evidence-conflict', ['subject'])
      }
      const derived = immutableCopy({
        triggerRequestControl: requestControl.fact,
      } as const satisfies InteractionEpisodeDerivedEvidenceV1)

      let rawHost: unknown
      try {
        rawHost = await attestor.resolve(subject, derived)
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
    attestor: createDshAlpha5HostEvidenceAttestor({
      ...(dependencies.generationEvidence === undefined
        ? {}
        : { generationEvidence: dependencies.generationEvidence }),
      ...(dependencies.routingEvidence === undefined
        ? {}
        : { routingEvidence: dependencies.routingEvidence }),
    }, dependencies.lifecycle, dependencies.hostEvidenceSourceTimeoutMs),
  })
}

/**
 * Add one historical fact authored by the cooperative Gateway ingress path.
 * The result still abstains until every other Host evidence dimension exists.
 *
 * @internal Trusted composition only. The Gateway source proves authorship;
 * this resolver separately proves that the queried event is physically stored.
 */
export function createGatewayAwareDshAlpha5InteractionEpisodeEvidenceResolver(
  dependencies: GatewayAwareDshAlpha5ResolverDependenciesV1,
): InteractionEpisodeEvidenceResolverV1 {
  return createInteractionEpisodeEvidenceResolver({
    sessions: dependencies.sessions,
    sessionPersistence: dependencies.sessionPersistence,
    attestor: createDshAlpha5HostEvidenceAttestor({
      gateway: dependencies.gateway,
      ...(dependencies.generationEvidence === undefined
        ? {}
        : { generationEvidence: dependencies.generationEvidence }),
      ...(dependencies.routingEvidence === undefined
        ? {}
        : { routingEvidence: dependencies.routingEvidence }),
    }, dependencies.lifecycle, dependencies.hostEvidenceSourceTimeoutMs),
  })
}

interface DshAlpha5HostEvidenceSourcesV1 {
  readonly gateway?: GatewayIngressEvidenceSourceV1
  readonly generationEvidence?: InteractionGenerationEvidenceSourceV1
  readonly routingEvidence?: InteractionRoutingEvidenceSourceV1
}

function createDshAlpha5HostEvidenceAttestor(
  sources: DshAlpha5HostEvidenceSourcesV1,
  lifecycle: Pick<Context, 'effect'>,
  configuredSourceTimeoutMs?: number,
): InteractionEpisodeHostEvidenceAttestorV1 {
  const sourceTimeoutMs = hostEvidenceSourceTimeoutMs(configuredSourceTimeoutMs)
  return Object.freeze({
    async resolve(
      subject: DurableInteractionEpisodeSubjectV1,
      derived: InteractionEpisodeDerivedEvidenceV1,
    ) {
      const [workspaceResult, generationResult, routingResult] = await Promise.allSettled([
        sources.gateway === undefined
          ? Promise.resolve({ status: 'unavailable' } as const)
          : raceHostEvidenceSourceInvocation(
              lifecycle,
              () => resolveGatewayWorkspaceEvidence(sources.gateway!, subject),
              sourceTimeoutMs,
            ),
        sources.generationEvidence === undefined
          ? Promise.resolve({ status: 'unavailable' } as const)
          : raceHostEvidenceSourceInvocation(
              lifecycle,
              () => resolveGenerationEvidence(sources.generationEvidence!, subject, derived),
              sourceTimeoutMs,
            ),
        sources.routingEvidence === undefined
          ? Promise.resolve({ status: 'unavailable' } as const)
          : raceHostEvidenceSourceInvocation(
              lifecycle,
              () => resolveRoutingEvidence(sources.routingEvidence!, subject, derived),
              sourceTimeoutMs,
            ),
      ])
      const conflicts = partialDshAlpha5ConflictDimensions(
        workspaceResult.status === 'fulfilled' ? workspaceResult.value : undefined,
        generationResult.status === 'fulfilled' ? generationResult.value : undefined,
        routingResult.status === 'fulfilled' ? routingResult.value : undefined,
      )
      if (conflicts.length > 0) {
        return hostEvidenceResolution('evidence-conflict', conflicts)
      }
      if (workspaceResult.status === 'rejected'
        || generationResult.status === 'rejected'
        || routingResult.status === 'rejected') {
        throw new Error('DSH alpha.5 Host evidence source invocation failed')
      }
      return composePartialDshAlpha5HostEvidence(
        workspaceResult.value,
        generationResult.value,
        routingResult.value,
      )
    },
  })
}

function hostEvidenceSourceTimeoutMs(configured: number | undefined): number {
  const timeoutMs = configured ?? DEFAULT_HOST_EVIDENCE_SOURCE_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_HOST_EVIDENCE_SOURCE_TIMEOUT_MS) {
    throw new Error('Host evidence source timeout must be from 1 to 120000 milliseconds')
  }
  return timeoutMs
}

function raceHostEvidenceSourceInvocation<T>(
  lifecycle: Pick<Context, 'effect'>,
  invocation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return runWithLifecycleDeadline(lifecycle, invocation, {
    timeoutMs,
    label: 'dsh-evolve.interactionEpisode.hostEvidenceSource',
    timeoutMessage: 'DSH alpha.5 Host evidence source invocation timed out',
  })
}

type GenerationEvidenceResolution =
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' }
  | { readonly status: 'matched'; readonly fact: InteractionEpisodeGenerationFactV1 }

async function resolveGenerationEvidence(
  source: InteractionGenerationEvidenceSourceV1,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): Promise<GenerationEvidenceResolution> {
  const resolution: unknown = await source.resolveGenerationEvidence(subject, derived)
  return generationEvidenceResolution(resolution, subject, derived)
}

function generationEvidenceResolution(
  resolution: unknown,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): GenerationEvidenceResolution {
  const result = ownEnumerableDataSnapshot(resolution)
  if (result === undefined) return { status: 'conflict' }
  if (hasExactDataKeys(result, ['status', 'reason'])
    && result.status === 'abstained') {
    if (result.reason === 'evidence-unavailable') return { status: 'unavailable' }
    return { status: 'conflict' }
  }
  if (!hasExactDataKeys(result, ['status', 'fact']) || result.status !== 'matched') {
    return { status: 'conflict' }
  }
  const fact = exactGenerationFact(result.fact, subject, derived)
  return fact === undefined
    ? { status: 'conflict' }
    : { status: 'matched', fact }
}

function exactGenerationFact(
  candidate: unknown,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): InteractionEpisodeGenerationFactV1 | undefined {
  const fact = ownEnumerableDataSnapshot(candidate)
  if (fact === undefined
    || !hasExactDataKeys(fact, ['schemaVersion', 'kind', 'workspaceId', 'subject', 'generation'])
    || fact.schemaVersion !== 1
    || fact.kind !== 'interaction-generation-fact-v1'
    || !isWorkspaceId(fact.workspaceId)) return undefined
  const factSubject = ownEnumerableDataSnapshot(fact.subject)
  let sessionLifecycleDigest: string
  try {
    sessionLifecycleDigest = interactionGenerationSessionLifecycleDigest(subject)
  } catch {
    return undefined
  }
  if (factSubject === undefined
    || !hasExactDataKeys(factSubject, [
      'sessionLifecycleDigest',
      'prefixDigest',
      'turnDigest',
      'turnEndSeq',
      'triggerRequestSeq',
      'triggerCallSeq',
      'triggerResultSeq',
    ])
    || factSubject.sessionLifecycleDigest !== sessionLifecycleDigest
    || factSubject.prefixDigest !== subject.transcript.replay.prefixDigest
    || factSubject.turnDigest !== subject.transcript.replay.turnDigest
    || factSubject.turnEndSeq !== subject.transcript.source.turnEndSeq
    || factSubject.triggerRequestSeq
      !== derived.triggerRequestControl.boundary.assistantMessageSeq
    || factSubject.triggerCallSeq !== subject.transcript.source.triggerCallSeq
    || factSubject.triggerResultSeq !== subject.transcript.source.triggerResultSeq) {
    return undefined
  }
  const generation = ownEnumerableDataSnapshot(fact.generation)
  if (generation === undefined || generation.pin !== 'settled') return undefined
  const effectiveMount = ownEnumerableDataSnapshot(generation.effectiveMount)
  if (generation.kind === 'native') {
    if (!hasExactDataKeys(generation, ['kind', 'pin', 'effectiveMount'])
      || effectiveMount === undefined
      || !hasExactDataKeys(effectiveMount, ['kind'])
      || effectiveMount.kind !== 'native') return undefined
  } else if (generation.kind === 'evolved') {
    if (!hasExactDataKeys(generation, ['kind', 'pin', 'generationId', 'effectiveMount'])
      || typeof generation.generationId !== 'string'
      || !HASH_PATTERN.test(generation.generationId)
      || effectiveMount === undefined
      || !hasExactDataKeys(effectiveMount, ['kind', 'generationId'])
      || effectiveMount.kind !== 'evolved'
      || effectiveMount.generationId !== generation.generationId) return undefined
  } else {
    return undefined
  }
  return immutableCopy({
    schemaVersion: 1,
    kind: 'interaction-generation-fact-v1',
    workspaceId: fact.workspaceId,
    subject: {
      sessionLifecycleDigest: factSubject.sessionLifecycleDigest,
      prefixDigest: factSubject.prefixDigest,
      turnDigest: factSubject.turnDigest,
      turnEndSeq: factSubject.turnEndSeq,
      triggerRequestSeq: factSubject.triggerRequestSeq,
      triggerCallSeq: factSubject.triggerCallSeq,
      triggerResultSeq: factSubject.triggerResultSeq,
    },
    generation: generation.kind === 'native'
      ? {
          kind: 'native',
          pin: 'settled',
          effectiveMount: { kind: 'native' },
        }
      : {
          kind: 'evolved',
          pin: 'settled',
          generationId: generation.generationId,
          effectiveMount: {
            kind: 'evolved',
            generationId: generation.generationId,
          },
        },
  } as InteractionEpisodeGenerationFactV1)
}

type RoutingEvidenceResolution =
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' }
  | { readonly status: 'matched'; readonly fact: InteractionEpisodeRoutingFactV1 }

async function resolveRoutingEvidence(
  source: InteractionRoutingEvidenceSourceV1,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): Promise<RoutingEvidenceResolution> {
  const resolution: unknown = await source.resolveRoutingEvidence(subject, derived)
  return routingEvidenceResolution(resolution, subject, derived)
}

function routingEvidenceResolution(
  resolution: unknown,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): RoutingEvidenceResolution {
  const result = ownEnumerableDataSnapshot(resolution)
  if (result === undefined) return { status: 'conflict' }
  if (hasExactDataKeys(result, ['status', 'reason'])
    && result.status === 'abstained') {
    if (result.reason === 'evidence-unavailable') return { status: 'unavailable' }
    return { status: 'conflict' }
  }
  if (!hasExactDataKeys(result, ['status', 'fact']) || result.status !== 'matched') {
    return { status: 'conflict' }
  }
  const fact = exactRoutingFact(result.fact, subject, derived)
  return fact === undefined
    ? { status: 'conflict' }
    : { status: 'matched', fact }
}

function exactRoutingFact(
  candidate: unknown,
  subject: DurableInteractionEpisodeSubjectV1,
  derived: InteractionEpisodeDerivedEvidenceV1,
): InteractionEpisodeRoutingFactV1 | undefined {
  const fact = ownEnumerableDataSnapshot(candidate)
  if (fact === undefined
    || !hasExactDataKeys(fact, ['schemaVersion', 'kind', 'workspaceId', 'subject', 'routing'])
    || fact.schemaVersion !== 1
    || fact.kind !== 'interaction-routing-fact-v1'
    || !isWorkspaceId(fact.workspaceId)
    || subject.transcript.trigger.kind !== 'successful-gap-report') return undefined
  const factSubject = ownEnumerableDataSnapshot(fact.subject)
  let sessionLifecycleDigest: string
  try {
    sessionLifecycleDigest = interactionRoutingSessionLifecycleDigest(subject)
  } catch {
    return undefined
  }
  if (factSubject === undefined
    || !hasExactDataKeys(factSubject, [
      'sessionLifecycleDigest',
      'prefixDigest',
      'turnDigest',
      'turnEndSeq',
      'triggerRequestSeq',
      'triggerCallSeq',
      'triggerResultSeq',
    ])
    || factSubject.sessionLifecycleDigest !== sessionLifecycleDigest
    || factSubject.prefixDigest !== subject.transcript.replay.prefixDigest
    || factSubject.turnDigest !== subject.transcript.replay.turnDigest
    || factSubject.turnEndSeq !== subject.transcript.source.turnEndSeq
    || factSubject.triggerRequestSeq
      !== derived.triggerRequestControl.boundary.assistantMessageSeq
    || factSubject.triggerCallSeq !== subject.transcript.source.triggerCallSeq
    || factSubject.triggerResultSeq !== subject.transcript.source.triggerResultSeq) {
    return undefined
  }
  const routing = ownEnumerableDataSnapshot(fact.routing)
  if (routing === undefined
    || !hasExactDataKeys(routing, ['rawTrigger', 'conclusion'])
    || routing.rawTrigger !== 'successful-gap-report'
    || routing.conclusion !== 'model-declared-no-applicable-skill') return undefined
  return immutableCopy({
    schemaVersion: 1,
    kind: 'interaction-routing-fact-v1',
    workspaceId: fact.workspaceId,
    subject: {
      sessionLifecycleDigest: factSubject.sessionLifecycleDigest,
      prefixDigest: factSubject.prefixDigest,
      turnDigest: factSubject.turnDigest,
      turnEndSeq: factSubject.turnEndSeq,
      triggerRequestSeq: factSubject.triggerRequestSeq,
      triggerCallSeq: factSubject.triggerCallSeq,
      triggerResultSeq: factSubject.triggerResultSeq,
    },
    routing: {
      rawTrigger: 'successful-gap-report',
      conclusion: 'model-declared-no-applicable-skill',
    },
  } as InteractionEpisodeRoutingFactV1)
}

function composePartialDshAlpha5HostEvidence(
  workspace: GatewayWorkspaceEvidenceResolution,
  generation: GenerationEvidenceResolution,
  routing: RoutingEvidenceResolution,
): InteractionEpisodeHostEvidenceResolutionV1 {
  const conflicts = partialDshAlpha5ConflictDimensions(workspace, generation, routing)
  if (conflicts.length > 0) {
    return hostEvidenceResolution('evidence-conflict', conflicts)
  }
  return hostEvidenceResolution('evidence-unavailable', stockMissingDimensions.filter(
    dimension => (dimension !== 'workspace' || workspace.status !== 'matched')
      && (dimension !== 'generation' || generation.status !== 'matched')
      && (dimension !== 'routing' || routing.status !== 'matched'),
  ))
}

function partialDshAlpha5ConflictDimensions(
  workspace: GatewayWorkspaceEvidenceResolution | undefined,
  generation: GenerationEvidenceResolution | undefined,
  routing: RoutingEvidenceResolution | undefined,
): readonly InteractionEpisodeEvidenceDimensionV1[] {
  const conflicts = new Set<InteractionEpisodeEvidenceDimensionV1>()
  if (workspace?.status === 'conflict') conflicts.add('workspace')
  if (generation?.status === 'conflict') conflicts.add('generation')
  if (routing?.status === 'conflict') conflicts.add('routing')
  if (workspace?.status === 'matched'
    && generation?.status === 'matched'
    && workspace.workspaceId !== generation.fact.workspaceId) {
    conflicts.add('workspace')
    conflicts.add('generation')
  }
  if (workspace?.status === 'matched'
    && routing?.status === 'matched'
    && workspace.workspaceId !== routing.fact.workspaceId) {
    conflicts.add('workspace')
    conflicts.add('routing')
  }
  if (generation?.status === 'matched'
    && routing?.status === 'matched'
    && generation.fact.workspaceId !== routing.fact.workspaceId) {
    conflicts.add('generation')
    conflicts.add('routing')
  }
  return (['workspace', 'generation', 'routing'] as const)
    .filter(dimension => conflicts.has(dimension))
}

type GatewayWorkspaceEvidenceResolution =
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' }
  | { readonly status: 'matched'; readonly workspaceId: string }

async function resolveGatewayWorkspaceEvidence(
  gateway: GatewayIngressEvidenceSourceV1,
  subject: DurableInteractionEpisodeSubjectV1,
): Promise<GatewayWorkspaceEvidenceResolution> {
  const enqueue = exactSubjectEnqueue(subject)
  if (enqueue === undefined) return { status: 'conflict' }

  // Do not catch a source rejection. The outer resolver classifies an
  // authority invocation failure separately from an evidence conclusion.
  const resolution: unknown = await gateway.resolveIngressEvidence({
    schemaVersion: 1,
    kind: 'gateway-ingress-evidence-query-v1',
    session: {
      header: subject.session.header,
      inheritedEventCount: subject.session.inheritedEventCount,
    },
    enqueue,
  })
  return gatewayWorkspaceEvidenceResolution(resolution)
}

function exactSubjectEnqueue(
  subject: DurableInteractionEpisodeSubjectV1,
): SessionEvent<'agent/inbox/spliced'> | undefined {
  try {
    const enqueueSeq = subject.transcript.source.enqueueSeq
    const candidates = subject.session.events.filter(
      (event): event is SessionEvent<'agent/inbox/spliced'> =>
        Number(event.seq) === enqueueSeq
        && event.type === 'agent/inbox/spliced',
    )
    if (candidates.length !== 1) return undefined
    const enqueue = candidates[0]!
    if (enqueue.data.target !== 'next-turn'
      || enqueue.data.removedCount !== undefined
      || enqueue.data.outcome !== undefined
      || enqueue.data.inserted.length !== 1
      || String(enqueue.data.inserted[0]?.id) !== subject.transcript.ingress.messageId) {
      return undefined
    }
    return enqueue
  } catch {
    return undefined
  }
}

function gatewayWorkspaceEvidenceResolution(
  resolution: unknown,
): GatewayWorkspaceEvidenceResolution {
  const result = ownEnumerableDataSnapshot(resolution)
  if (result === undefined) return { status: 'conflict' }
  if (hasExactDataKeys(result, ['status', 'reason'])
    && result.status === 'abstained') {
    if (result.reason === 'evidence-unavailable') return { status: 'unavailable' }
    return { status: 'conflict' }
  }
  if (!hasExactDataKeys(result, ['status', 'fact'])
    || result.status !== 'matched') {
    return { status: 'conflict' }
  }
  const fact = ownEnumerableDataSnapshot(result.fact)
  if (fact === undefined
    || !hasExactDataKeys(fact, ['schemaVersion', 'kind', 'workspaceId'])
    || fact.schemaVersion !== 1
    || fact.kind !== 'gateway-ingress-workspace-fact-v1'
    || !isWorkspaceId(fact.workspaceId)) {
    return { status: 'conflict' }
  }
  return { status: 'matched', workspaceId: fact.workspaceId }
}

function hostEvidenceResolution(
  reason: 'evidence-unavailable' | 'evidence-conflict',
  dimensions: readonly InteractionEpisodeEvidenceDimensionV1[],
): InteractionEpisodeHostEvidenceResolutionV1 {
  return immutableCopy({ status: 'abstained', reason, dimensions } as const)
}

const HASH_PATTERN = /^[0-9a-f]{64}$/u

function ownEnumerableDataSnapshot(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return undefined
  }
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') return undefined
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return undefined
    }
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function hasExactDataKeys(
  snapshot: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  return Reflect.ownKeys(snapshot).length === keys.length
    && keys.every(key => Object.hasOwn(snapshot, key))
}

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
