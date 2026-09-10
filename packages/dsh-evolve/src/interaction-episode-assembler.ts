import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { InteractionEpisodeTranscriptProofV1 } from './interaction-episode-projector.ts'
import {
  normalizeInteractionEpisodeInputV1,
  type InteractionEpisodeInputV1,
} from './interaction-episode-store.ts'
import { isWorkspaceId } from './workspace-identity.ts'

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const gitRevisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
const skillNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(128)
const workspaceIdSchema = z.string().refine(isWorkspaceId, {
  message: 'expected a canonical native Workspace UUID v1-v5',
})

const hostBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-episode-host-binding-v1'),
  subject: z.strictObject({
    workspaceId: workspaceIdSchema,
    transcript: z.unknown(),
  }),
  durability: z.strictObject({
    session: z.literal('flushed-through-turn-end'),
    throughSeq: safeInteger,
  }),
  capability: z.strictObject({
    observation: z.strictObject({
      boundary: z.literal('trigger-assistant-and-tool-pair'),
      triggerRequestSeq: safeInteger,
      triggerCallSeq: safeInteger,
      triggerResultSeq: safeInteger,
      compositionDigest: hashSchema,
    }),
    catalog: z.strictObject({
      status: z.literal('complete'),
      providers: z.literal('settled'),
      hash: hashSchema,
      size: safeInteger,
      requestedSkill: z.strictObject({
        name: skillNameSchema,
        presence: z.literal('absent'),
      }),
    }),
    generation: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('native'),
        pin: z.literal('settled'),
        effectiveMount: z.strictObject({ kind: z.literal('native') }),
      }),
      z.strictObject({
        kind: z.literal('evolved'),
        pin: z.literal('settled'),
        generationId: hashSchema,
        effectiveMount: z.strictObject({
          kind: z.literal('evolved'),
          generationId: hashSchema,
        }),
      }),
    ]),
    routing: z.discriminatedUnion('rawTrigger', [
      z.strictObject({
        rawTrigger: z.literal('skill-tool-error'),
        conclusion: z.literal('requested-skill-absent'),
      }),
      z.strictObject({
        rawTrigger: z.literal('successful-gap-report'),
        conclusion: z.literal('model-declared-no-applicable-skill'),
      }),
    ]),
  }),
  environment: z.strictObject({
    coverage: z.literal('complete-replay-cut'),
    workspaceSnapshot: z.strictObject({
      at: z.literal('before-inbox-insertion'),
      digest: hashSchema,
    }),
    compositionDigest: hashSchema,
    modelDigest: hashSchema,
    permission: z.strictObject({
      evidenceRetention: z.literal('authorized'),
      digest: hashSchema,
    }),
    sandboxDigest: hashSchema,
    budgetDigest: hashSchema,
    dshRevision: gitRevisionSchema,
  }),
  externalEffects: z.strictObject({
    coverage: z.literal('all-effect-capable-tools-and-providers'),
    compositionDigest: hashSchema,
    fromSeq: safeInteger,
    throughSeq: safeInteger,
    pending: z.literal('none'),
    uncertain: z.literal('none'),
    result: z.literal('none'),
  }),
})

export type InteractionEpisodeEvidenceDimensionV1 =
  | 'binding'
  | 'subject'
  | 'session-durability'
  | 'workspace'
  | 'capability-boundary'
  | 'catalog'
  | 'generation'
  | 'routing'
  | 'replay-environment'
  | 'workspace-snapshot'
  | 'composition'
  | 'model'
  | 'permissions'
  | 'sandbox'
  | 'budget'
  | 'dsh-revision'
  | 'external-effects'

export interface InteractionEpisodeHostBindingV1 {
  readonly schemaVersion: 1
  readonly kind: 'interaction-episode-host-binding-v1'
  readonly subject: {
    readonly workspaceId: string
    readonly transcript: InteractionEpisodeTranscriptProofV1
  }
  readonly durability: {
    readonly session: 'flushed-through-turn-end'
    readonly throughSeq: number
  }
  readonly capability: {
    readonly observation: {
      readonly boundary: 'trigger-assistant-and-tool-pair'
      readonly triggerRequestSeq: number
      readonly triggerCallSeq: number
      readonly triggerResultSeq: number
      readonly compositionDigest: string
    }
    readonly catalog: {
      readonly status: 'complete'
      readonly providers: 'settled'
      readonly hash: string
      readonly size: number
      readonly requestedSkill: {
        readonly name: string
        readonly presence: 'absent'
      }
    }
    /**
     * Settled Session pin and the corresponding Host-owned Generation tree
     * mounted in the Agent scope for the trigger boundary. Provider precedence
     * and the complete model-visible winner set belong to `catalog`; this field
     * must not be used to infer either one.
     */
    readonly generation:
      | {
        readonly kind: 'native'
        readonly pin: 'settled'
        readonly effectiveMount: { readonly kind: 'native' }
      }
      | {
        readonly kind: 'evolved'
        readonly pin: 'settled'
        readonly generationId: string
        readonly effectiveMount: {
          readonly kind: 'evolved'
          readonly generationId: string
        }
      }
    readonly routing:
      | {
        readonly rawTrigger: 'skill-tool-error'
        readonly conclusion: 'requested-skill-absent'
      }
      | {
        readonly rawTrigger: 'successful-gap-report'
        readonly conclusion: 'model-declared-no-applicable-skill'
      }
  }
  readonly environment: {
    /** Every replay-relevant Host fact is bound to the exact subject transcript. */
    readonly coverage: 'complete-replay-cut'
    readonly workspaceSnapshot: {
      readonly at: 'before-inbox-insertion'
      readonly digest: string
    }
    readonly compositionDigest: string
    readonly modelDigest: string
    readonly permission: {
      readonly evidenceRetention: 'authorized'
      readonly digest: string
    }
    readonly sandboxDigest: string
    readonly budgetDigest: string
    readonly dshRevision: string
  }
  readonly externalEffects: {
    readonly coverage: 'all-effect-capable-tools-and-providers'
    readonly compositionDigest: string
    readonly fromSeq: number
    readonly throughSeq: number
    readonly pending: 'none'
    readonly uncertain: 'none'
    readonly result: 'none'
  }
}

export type InteractionEpisodeHostEvidenceResolutionV1 =
  | {
    readonly status: 'resolved'
    readonly binding: InteractionEpisodeHostBindingV1
  }
  | {
    readonly status: 'abstained'
    readonly reason: 'evidence-unavailable' | 'evidence-conflict'
    readonly dimensions: readonly InteractionEpisodeEvidenceDimensionV1[]
  }

export interface InteractionEpisodeAssemblyAttemptV1 {
  readonly proof: InteractionEpisodeTranscriptProofV1
  readonly host: InteractionEpisodeHostEvidenceResolutionV1
}

export type InteractionEpisodeAssemblyResultV1 =
  | { readonly status: 'assembled'; readonly input: InteractionEpisodeInputV1 }
  | {
    readonly status: 'abstained'
    readonly reason: 'evidence-unavailable' | 'evidence-conflict' | 'subject-mismatch'
    readonly dimensions: readonly InteractionEpisodeEvidenceDimensionV1[]
  }

/**
 * Consume a trusted internal Host-evidence resolver result.
 *
 * This function performs structural and cross-binding checks only; it does not
 * attest evidence or read DSH authority. Arbitrary caller-created objects are
 * not eligible for sealing.
 */
export function assembleInteractionEpisodeInputV1(
  attempt: InteractionEpisodeAssemblyAttemptV1,
): InteractionEpisodeAssemblyResultV1 {
  try {
    return assembleInteractionEpisodeInputUnchecked(attempt)
  } catch {
    return abstain('evidence-conflict', ['binding'])
  }
}

function assembleInteractionEpisodeInputUnchecked(
  attempt: InteractionEpisodeAssemblyAttemptV1,
): InteractionEpisodeAssemblyResultV1 {
  if (attempt.host.status === 'abstained') {
    const { dimensions, reason } = attempt.host
    const materializedDimensions = Array.isArray(dimensions) ? [...dimensions] : []
    if ((reason !== 'evidence-unavailable' && reason !== 'evidence-conflict')
      || !Array.isArray(dimensions)
      || materializedDimensions.length === 0
      || new Set(materializedDimensions).size !== materializedDimensions.length
      || materializedDimensions.some(dimension =>
        !evidenceDimensionOrder.includes(dimension))) {
      return abstain('evidence-conflict', ['binding'])
    }
    return abstain(
      reason,
      materializedDimensions.sort((left, right) =>
        evidenceDimensionOrder.indexOf(left) - evidenceDimensionOrder.indexOf(right)),
    )
  }
  if (attempt.host.status !== 'resolved') {
    return abstain('evidence-conflict', ['binding'])
  }

  let proof: InteractionEpisodeTranscriptProofV1
  try {
    if (!hasOnlyPlainEnumerableData(attempt.proof)) {
      return abstain('subject-mismatch', ['subject'])
    }
    proof = structuredClone(attempt.proof)
  } catch {
    return abstain('subject-mismatch', ['subject'])
  }

  let bindingCandidate: unknown
  try {
    if (!hasOnlyPlainEnumerableData(attempt.host.binding)) {
      return abstain('evidence-conflict', ['binding'])
    }
    bindingCandidate = structuredClone(attempt.host.binding)
  } catch {
    return abstain('evidence-conflict', ['binding'])
  }
  const parsedBinding = hostBindingSchema.safeParse(bindingCandidate)
  if (!parsedBinding.success) {
    return bindingValidationFailure(parsedBinding.error, bindingCandidate)
  }
  const binding = parsedBinding.data as InteractionEpisodeHostBindingV1
  if (!hasOnlyPlainEnumerableData(proof)
    || !hasOnlyPlainEnumerableData(binding.subject.transcript)
    || !isDeepStrictEqual(binding.subject.transcript, proof)) {
    return abstain('subject-mismatch', ['subject'])
  }
  if (binding.durability.throughSeq < proof.source.turnEndSeq) {
    return abstain('subject-mismatch', ['session-durability'])
  }
  if (binding.externalEffects.fromSeq > proof.source.enqueueSeq
    || binding.externalEffects.throughSeq < proof.source.turnEndSeq) {
    return abstain('subject-mismatch', ['external-effects'])
  }
  if (binding.externalEffects.compositionDigest !== binding.environment.compositionDigest) {
    return abstain('evidence-conflict', ['external-effects'])
  }
  if (binding.capability.catalog.requestedSkill.name !== proof.trigger.requestedSkill) {
    return abstain('subject-mismatch', ['catalog'])
  }
  const { observation } = binding.capability
  if (observation.triggerRequestSeq !== proof.witness.triggerRequestSeq
    || observation.triggerCallSeq !== proof.source.triggerCallSeq
    || observation.triggerResultSeq !== proof.source.triggerResultSeq) {
    return abstain('subject-mismatch', ['capability-boundary'])
  }
  if (observation.triggerRequestSeq <= proof.source.initiatingMessageSeq
    || observation.triggerRequestSeq >= proof.source.triggerCallSeq) {
    return abstain('evidence-conflict', ['capability-boundary'])
  }
  const requestRoutes = proof.witness.assistantRequestRoutes
  if (!Array.isArray(requestRoutes)
    || requestRoutes.filter(route =>
      route.assistantMessageSeq === observation.triggerRequestSeq).length !== 1) {
    return abstain('evidence-conflict', ['capability-boundary'])
  }
  if (observation.compositionDigest !== binding.environment.compositionDigest) {
    return abstain('evidence-conflict', ['capability-boundary', 'composition'])
  }
  if (binding.capability.routing.rawTrigger !== proof.trigger.kind) {
    return abstain('evidence-conflict', ['routing'])
  }
  if (binding.capability.generation.kind === 'evolved'
    && binding.capability.generation.effectiveMount.generationId
      !== binding.capability.generation.generationId) {
    return abstain('evidence-conflict', ['generation'])
  }
  const generationId = binding.capability.generation.kind === 'evolved'
    ? binding.capability.generation.generationId
    : undefined
  let input: InteractionEpisodeInputV1
  try {
    input = normalizeInteractionEpisodeInputV1({
      workspaceId: binding.subject.workspaceId,
      session: proof.session,
      source: proof.source,
      ingress: proof.ingress,
      trigger: {
        kind: proof.trigger.kind === 'successful-gap-report'
          ? 'model-declared-skill-gap'
          : 'native-skill-miss',
        callId: proof.trigger.callId,
        requestedSkill: proof.trigger.requestedSkill,
        catalogHash: binding.capability.catalog.hash,
        catalogSize: binding.capability.catalog.size,
        ...(generationId === undefined ? {} : { generationId }),
      },
      replay: {
        availability: proof.replay.availability,
        transcript: proof.replay.transcript,
        environment: 'sealed',
        prefixDigest: proof.replay.prefixDigest,
        turnDigest: proof.replay.turnDigest,
        workspaceSnapshotDigest: binding.environment.workspaceSnapshot.digest,
        compositionDigest: binding.environment.compositionDigest,
        modelDigest: binding.environment.modelDigest,
        permissionDigest: binding.environment.permission.digest,
        sandboxDigest: binding.environment.sandboxDigest,
        budgetDigest: binding.environment.budgetDigest,
        dshRevision: binding.environment.dshRevision,
        externalEffects: binding.externalEffects.result,
      },
      ...(proof.goal === undefined ? {} : { goal: proof.goal }),
    })
  } catch {
    return abstain('evidence-conflict', ['subject'])
  }
  return immutableCopy({ status: 'assembled', input })
}

function abstain(
  reason: Extract<InteractionEpisodeAssemblyResultV1, { status: 'abstained' }>['reason'],
  dimensions: readonly InteractionEpisodeEvidenceDimensionV1[],
): InteractionEpisodeAssemblyResultV1 {
  return immutableCopy({ status: 'abstained', reason, dimensions })
}

function bindingValidationFailure(
  error: z.ZodError,
  candidate: unknown,
): InteractionEpisodeAssemblyResultV1 {
  const dimensions = [...new Set(error.issues.map(issue => dimensionForPath(issue.path)))]
    .sort((left, right) => evidenceDimensionOrder.indexOf(left) - evidenceDimensionOrder.indexOf(right))
  const unavailable = error.issues.every(issue => valueAtPath(candidate, issue.path) === undefined)
  return abstain(unavailable ? 'evidence-unavailable' : 'evidence-conflict', dimensions)
}

const evidenceDimensionOrder: readonly InteractionEpisodeEvidenceDimensionV1[] = [
  'binding',
  'subject',
  'session-durability',
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
]

function dimensionForPath(path: readonly PropertyKey[]): InteractionEpisodeEvidenceDimensionV1 {
  const [section, field] = path
  if (section === 'subject') return field === 'workspaceId' ? 'workspace' : 'subject'
  if (section === 'durability') return 'session-durability'
  if (section === 'capability') {
    if (field === 'observation') return 'capability-boundary'
    if (field === 'catalog') return 'catalog'
    if (field === 'generation') return 'generation'
    if (field === 'routing') return 'routing'
  }
  if (section === 'environment') {
    if (field === 'coverage') return 'replay-environment'
    if (field === 'workspaceSnapshot') return 'workspace-snapshot'
    if (field === 'compositionDigest') return 'composition'
    if (field === 'modelDigest') return 'model'
    if (field === 'permission') return 'permissions'
    if (field === 'sandboxDigest') return 'sandbox'
    if (field === 'budgetDigest') return 'budget'
    if (field === 'dshRevision') return 'dsh-revision'
  }
  if (section === 'externalEffects') return 'external-effects'
  return 'binding'
}

function valueAtPath(root: unknown, path: readonly PropertyKey[]): unknown {
  let value = root
  for (const part of path) {
    if (value === null || typeof value !== 'object') return undefined
    value = Reflect.get(value, part)
  }
  return value
}

function hasOnlyPlainEnumerableData(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') {
    return value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || value === undefined
  }
  if (seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined
          || !descriptor.enumerable
          || !('value' in descriptor)
          || !hasOnlyPlainEnumerableData(descriptor.value, seen)) return false
      }
      return Reflect.ownKeys(value).every(key => key === 'length'
        || (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(key)))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor !== undefined
        && descriptor.enumerable
        && 'value' in descriptor
        && hasOnlyPlainEnumerableData(descriptor.value, seen)
    })
  } finally {
    seen.delete(value)
  }
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
