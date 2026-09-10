import { createHash } from 'node:crypto'
import { isDeepStrictEqual, types as utilTypes } from 'node:util'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { InteractionEpisodeHostBindingV1 } from './interaction-episode-assembler.ts'
import {
  projectInteractionEpisodeTriggerRequestControlV1,
  type InteractionEpisodeTriggerRequestControlFactV1,
  type InteractionEpisodeTriggerRequestControlSubjectV1,
} from './interaction-trigger-request-control.ts'
import {
  interactionSessionDialectSchema,
  type InteractionSessionDialect,
} from './interaction-session-dialect.ts'
import { isWorkspaceId } from './workspace-identity.ts'

const EVIDENCE_DOMAIN = 'evoforge_interaction_generation_evidence'
const EVIDENCE_DOMAIN_VERSION = 1
const MAX_EPOCH_BYTES = 512

export const INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES = 100
export const INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE = 10_000
export const INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS = 100_000

const compiledPolicyAuthorities = new WeakSet<object>()

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const workspaceIdSchema = z.string().refine(isWorkspaceId, {
  message: 'expected a canonical native Workspace UUID v1-v5',
})
const triggerKindSchema = z.enum(['successful-gap-report', 'skill-tool-error'])

const interactionEvidencePolicySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  retention: z.strictObject({
    generationMaxRecords: z.number().int().min(1)
      .max(INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE),
  }),
})

const interactionEvidencePoliciesSchema = z.array(interactionEvidencePolicySchema)
  .max(INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES)
  .superRefine((policies, context) => {
    const seen = new Set<string>()
    let aggregate = 0
    for (let index = 0; index < policies.length; index += 1) {
      const policy = policies[index]!
      if (seen.has(policy.workspaceId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'workspaceId'],
          message: `duplicate Interaction Generation evidence policy for Workspace '${policy.workspaceId}'`,
        })
      }
      seen.add(policy.workspaceId)
      aggregate += policy.retention.generationMaxRecords
    }
    if (aggregate > INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      context.addIssue({
        code: 'custom',
        message: 'Interaction Generation evidence policy aggregate exceeds the 100000-record safety cap',
      })
    }
  })

const generationSchema = z.discriminatedUnion('kind', [
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
  }).superRefine((generation, context) => {
    if (generation.effectiveMount.generationId !== generation.generationId) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveMount', 'generationId'],
        message: 'effective Generation mount does not match the settled pin',
      })
    }
  }),
])

const receiptSubjectSchema = z.strictObject({
  sessionLifecycleDigest: hashSchema,
  prefixDigest: hashSchema,
  turnDigest: hashSchema,
  // Optional only so durable v1 rows written before this identity field remain readable.
  loggedControlDigest: hashSchema.optional(),
  turn: safeInteger,
  turnStartSeq: safeInteger,
  turnEndSeq: safeInteger,
  triggerKind: triggerKindSchema,
  triggerRequestSeq: safeInteger,
  triggerCallSeq: safeInteger,
  triggerResultSeq: safeInteger,
}).superRefine((subject, context) => {
  if (!(subject.turnStartSeq < subject.triggerRequestSeq
    && subject.triggerRequestSeq < subject.triggerCallSeq
    && subject.triggerCallSeq < subject.triggerResultSeq
    && subject.triggerResultSeq < subject.turnEndSeq)) {
    context.addIssue({
      code: 'custom',
      message: 'Generation evidence coordinates are not in strict causal order',
    })
  }
})

const provenanceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('native'),
    binderEpochDigest: hashSchema,
    lifecycleCutoffDigest: hashSchema,
  }),
  z.strictObject({
    kind: z.literal('evolved'),
    binderEpochDigest: hashSchema,
    lifecycleCutoffDigest: hashSchema,
    mountEpochDigest: hashSchema,
    generationDigest: hashSchema,
  }),
])

const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-generation-evidence-receipt-v1'),
  observedAt: safeInteger,
  sourceDialect: interactionSessionDialectSchema,
  workspaceId: workspaceIdSchema,
  subject: receiptSubjectSchema,
  generation: generationSchema,
  provenance: provenanceSchema,
}).superRefine((receipt, context) => {
  if (receipt.generation.kind !== receipt.provenance.kind) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'kind'],
      message: 'Generation evidence provenance does not match its pin kind',
    })
    return
  }
  if (receipt.generation.kind === 'evolved'
    && receipt.provenance.kind === 'evolved'
    && receipt.generation.generationId !== receipt.provenance.generationDigest) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'generationDigest'],
      message: 'Generation evidence digest does not match its content-addressed Generation',
    })
  }
})

const receiptIdentitySchema = z.strictObject({
  sourceDialect: interactionSessionDialectSchema,
  subject: receiptSubjectSchema,
})

const workspaceIdsSchema = z.array(workspaceIdSchema).min(1)
  .max(INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES)
  .superRefine((workspaceIds, context) => {
    const canonical = [...new Set(workspaceIds)].sort()
    if (!isDeepStrictEqual(workspaceIds, canonical)) {
      context.addIssue({ code: 'custom', message: 'evidence owners must be unique and sorted' })
    }
  })

const resolvedRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-generation-evidence-record-v1'),
  state: z.literal('resolved'),
  id: hashSchema,
  observedAt: safeInteger,
  recordedSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  workspaceIds: workspaceIdsSchema,
  identity: receiptIdentitySchema,
  receipt: receiptSchema,
  recordDigest: hashSchema,
}).superRefine((record, context) => {
  if (record.id !== receiptIdentityId(record.identity)) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'record id does not match its subject identity' })
  }
  if (record.observedAt !== record.receipt.observedAt
    || !isDeepStrictEqual(record.identity, receiptIdentity(record.receipt))) {
    context.addIssue({
      code: 'custom',
      path: ['receipt'],
      message: 'record envelope does not match its Generation receipt',
    })
  }
  if (record.workspaceIds.length !== 1 || record.workspaceIds[0] !== record.receipt.workspaceId) {
    context.addIssue({
      code: 'custom',
      path: ['workspaceIds'],
      message: 'resolved evidence owner does not match its receipt Workspace',
    })
  }
})

const conflictRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-generation-evidence-record-v1'),
  state: z.literal('conflict'),
  id: hashSchema,
  observedAt: safeInteger,
  recordedSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  workspaceIds: workspaceIdsSchema,
  identity: receiptIdentitySchema,
  recordDigest: hashSchema,
}).superRefine((record, context) => {
  if (record.id !== receiptIdentityId(record.identity)) {
    context.addIssue({ code: 'custom', path: ['id'], message: 'conflict id does not match its subject identity' })
  }
})

const evidenceRecordSchema = z.discriminatedUnion('state', [
  resolvedRecordSchema,
  conflictRecordSchema,
])

type InteractionGenerationEvidenceRecordV1 = z.infer<typeof evidenceRecordSchema>

const evidenceDomainSpec = defineDomain({
  name: EVIDENCE_DOMAIN,
  version: EVIDENCE_DOMAIN_VERSION,
  // One malformed receipt invalidates this evidence authority as a whole.
  // Per-record recovery could otherwise turn corruption into false absence.
  layout: 'single',
  tables: {
    receipts: domainTable<string, InteractionGenerationEvidenceRecordV1>(evidenceRecordSchema),
  },
})

type InteractionGenerationEvidenceDomain = Domain<typeof evidenceDomainSpec>

export type InteractionGenerationBindingV1 =
  InteractionEpisodeHostBindingV1['capability']['generation']

/** Raw-free completed-turn receipt authored by the Generation binder. */
export type InteractionGenerationEvidenceReceiptV1 = z.infer<typeof receiptSchema>

export type InteractionGenerationEvidencePolicyConfig =
  z.infer<typeof interactionEvidencePolicySchema>

/** Host-admin retention authority; it grants neither user consent nor Episode access. */
export interface InteractionGenerationEvidencePolicyAuthorityV1 {
  allows(workspaceId: string): boolean
  generationMaxRecords(workspaceId: string): number | undefined
}

/** @internal Compile raw plugin config into the only policy authority accepted by the vault. */
export function compileInteractionGenerationEvidencePolicies(
  rawPolicies: readonly InteractionGenerationEvidencePolicyConfig[] = [],
): InteractionGenerationEvidencePolicyAuthorityV1 {
  const policies = interactionEvidencePoliciesSchema.parse(snapshotJsonValue(rawPolicies))
  const byWorkspace = new Map(policies.map(policy => [
    policy.workspaceId,
    policy.retention.generationMaxRecords,
  ] as const))
  const authority: InteractionGenerationEvidencePolicyAuthorityV1 = Object.freeze({
    allows: (workspaceId: string) => isWorkspaceId(workspaceId) && byWorkspace.has(workspaceId),
    generationMaxRecords: (workspaceId: string) => isWorkspaceId(workspaceId)
      ? byWorkspace.get(workspaceId)
      : undefined,
  })
  compiledPolicyAuthorities.add(authority)
  return authority
}

export interface InteractionGenerationEvidenceDerivedV1 {
  readonly triggerRequestControl: InteractionEpisodeTriggerRequestControlFactV1
}

export type InteractionGenerationEvidenceSubjectV1 =
  InteractionEpisodeTriggerRequestControlSubjectV1

export interface InteractionEpisodeGenerationFactV1 {
  readonly schemaVersion: 1
  readonly kind: 'interaction-generation-fact-v1'
  /** Corroboration only; this fact closes no Workspace evidence dimension. */
  readonly workspaceId: string
  readonly subject: {
    readonly sessionLifecycleDigest: string
    readonly prefixDigest: string
    readonly turnDigest: string
    readonly loggedControlDigest: string
    readonly turnEndSeq: number
    readonly triggerRequestSeq: number
    readonly triggerCallSeq: number
    readonly triggerResultSeq: number
  }
  readonly generation: InteractionGenerationBindingV1
}

export type InteractionGenerationEvidenceResolutionV1 =
  | { readonly status: 'matched'; readonly fact: InteractionEpisodeGenerationFactV1 }
  | {
      readonly status: 'abstained'
      readonly reason: 'evidence-unavailable' | 'evidence-conflict'
    }

export interface InteractionGenerationEvidenceSinkV1 {
  /** Synchronous least-authority gate used before constructing a raw-free receipt. */
  allows(workspaceId: string): boolean
  retain(receipt: InteractionGenerationEvidenceReceiptV1): Promise<void>
  /** Wait for writes accepted before this call; it does not close the sink. */
  drain(): Promise<void>
}

/** Least-authority historical reader. It can neither pin nor mount a Generation. */
export interface InteractionGenerationEvidenceSourceV1 {
  resolveGenerationEvidence(
    subject: InteractionGenerationEvidenceSubjectV1,
    derived: InteractionGenerationEvidenceDerivedV1,
  ): Promise<InteractionGenerationEvidenceResolutionV1>
}

export interface InteractionGenerationEvidenceVaultV1
  extends InteractionGenerationEvidenceSinkV1, InteractionGenerationEvidenceSourceV1 {
  close(): Promise<void>
}

export interface InteractionGenerationEvidenceVaultOptions {
  readonly authority?: InteractionGenerationEvidencePolicyAuthorityV1
}

export type CreateInteractionGenerationEvidenceReceiptInputV1 = {
  readonly workspaceId: string
  readonly subject: InteractionGenerationEvidenceSubjectV1
  readonly derived: InteractionGenerationEvidenceDerivedV1
  readonly generation: InteractionGenerationBindingV1
  /** Opaque binder-lifecycle token. Only its domain-separated digest persists. */
  readonly binderEpoch: string
  /** Exact Session seq observed at the authenticated session-start boundary. */
  readonly lifecycleCutoff: number
} & (
  | {
      readonly generation: Extract<InteractionGenerationBindingV1, { readonly kind: 'native' }>
      readonly generationDigest?: never
      readonly mountEpoch?: never
    }
  | {
      readonly generation: Extract<InteractionGenerationBindingV1, { readonly kind: 'evolved' }>
      readonly generationDigest: string
      /** Opaque exact provider-registration token. Only its digest persists. */
      readonly mountEpoch: string
    }
)

interface NormalizedEvidenceQuery {
  readonly sourceDialect: InteractionSessionDialect
  readonly subject: z.infer<typeof receiptSubjectSchema>
  readonly observedAt: number
}

class DomainInteractionGenerationEvidenceVault implements InteractionGenerationEvidenceVaultV1 {
  private readonly domain: InteractionGenerationEvidenceDomain
  private readonly authority: InteractionGenerationEvidencePolicyAuthorityV1
  private readonly projectedRecords: Map<string, InteractionGenerationEvidenceRecordV1>
  private readonly projectedTokens = new Map<string, object>()
  private readonly pendingWrites = new Set<Promise<void>>()
  private readonly acceptedWritesById = new Map<string, Promise<void>>()
  private readonly workspacePruneTails = new Map<string, Promise<void>>()
  private nextRecordedSeq: number
  private acceptedOperationSeq = 0
  private closing: Promise<void> | undefined
  private unavailableError: Error | undefined
  // Backstop for a divergent duplicate whose durable conflict transition fails.
  private readonly volatileConflicts: Set<string>

  constructor(
    domain: InteractionGenerationEvidenceDomain,
    authority: InteractionGenerationEvidencePolicyAuthorityV1,
    volatileConflicts: Set<string>,
    highestRecordedSeq: number,
  ) {
    this.domain = domain
    this.authority = authority
    this.volatileConflicts = volatileConflicts
    this.projectedRecords = new Map(domain.table('receipts').entries())
    for (const id of this.projectedRecords.keys()) this.projectedTokens.set(id, {})
    this.nextRecordedSeq = highestRecordedSeq
  }

  allows(workspaceId: string): boolean {
    return this.closing === undefined
      && this.unavailableError === undefined
      && this.authority.allows(workspaceId)
  }

  retain(rawReceipt: InteractionGenerationEvidenceReceiptV1): Promise<void> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('Interaction Generation evidence vault is closing'))
    }
    if (this.unavailableError !== undefined) {
      return Promise.reject(new Error('Interaction Generation evidence authority is unavailable', {
        cause: this.unavailableError,
      }))
    }
    let receipt: InteractionGenerationEvidenceReceiptV1
    try {
      receipt = normalizeReceipt(rawReceipt)
    } catch (error) {
      return Promise.reject(error)
    }
    if (!this.allows(receipt.workspaceId)) {
      return Promise.reject(new Error(
        `Interaction Generation evidence retention is not authorized for Workspace '${receipt.workspaceId}'`,
      ))
    }
    const identity = receiptIdentity(receipt)
    const id = receiptIdentityId(identity)
    const generationMaxRecords = this.authority.generationMaxRecords(receipt.workspaceId)
    if (generationMaxRecords === undefined) {
      return Promise.reject(new Error(
        `Interaction Generation evidence retention is not authorized for Workspace '${receipt.workspaceId}'`,
      ))
    }
    return this.startAcceptedWrite(
      id,
      () => this.stageReceipt(id, identity, receipt, generationMaxRecords),
    )
  }

  /**
   * Project first, then synchronously enroll the authoritative row mutation
   * in the Domain chain. Cordis may start sibling-provider teardown on the
   * next microtask, so deferring the initial put behind a private Promise tail
   * can lose an already accepted receipt at clean shutdown.
   */
  private stageReceipt(
    id: string,
    identity: z.infer<typeof receiptIdentitySchema>,
    receipt: InteractionGenerationEvidenceReceiptV1,
    generationMaxRecords: number,
  ): Promise<void> {
    const table = this.domain.table('receipts')
    const existing = this.projectedRecords.get(id)
    if (existing !== undefined || this.volatileConflicts.has(id)) {
      if (existing?.state === 'resolved'
        && !this.volatileConflicts.has(id)
        && isDeepStrictEqual(existing.receipt, receipt)) {
        const projectionToken = this.projectRecord(id, existing)
        const operationSeq = ++this.acceptedOperationSeq
        const confirmed = this.confirmResolvedProjection(
          id,
          existing,
          projectionToken,
          operationSeq,
          this.persistResolved(table, existing),
        )
        const pruned = this.enqueueWorkspacePrune(
          table,
          receipt.workspaceId,
          generationMaxRecords,
          confirmed,
        )
        return confirmed.then(() => pruned)
      }
      if (existing === undefined
        && Math.max(this.projectedRecords.size, table.size)
          >= INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS) {
        throw new Error('Interaction Generation evidence aggregate safety cap is full')
      }
      const conflict = this.makeConflictRecord(
        id,
        existing?.identity ?? identity,
        existing?.observedAt ?? receipt.observedAt,
        existing?.recordedSeq ?? this.allocateRecordedSequence(),
        mergeWorkspaceIds(existing?.workspaceIds ?? [], receipt.workspaceId),
      )
      // A projected conflict is irreversible even while its put is in flight.
      // A later same-id retain can therefore enqueue only another tombstone.
      this.projectRecord(id, conflict)
      this.volatileConflicts.add(id)
      this.acceptedOperationSeq += 1
      return this.persistConflict(table, conflict)
    }

    if (Math.max(this.projectedRecords.size, table.size)
      >= INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      throw new Error('Interaction Generation evidence aggregate safety cap is full')
    }
    const record = resolvedRecord(
      id,
      identity,
      receipt,
      this.allocateRecordedSequence(),
    )
    const projectionToken = this.projectRecord(id, record)
    const operationSeq = ++this.acceptedOperationSeq
    // persistResolved invokes table.put before returning this Promise.
    const confirmed = this.confirmResolvedProjection(
      id,
      record,
      projectionToken,
      operationSeq,
      this.persistResolved(table, record),
    )
    const pruned = this.enqueueWorkspacePrune(
      table,
      receipt.workspaceId,
      generationMaxRecords,
      confirmed,
    )
    return confirmed.then(() => pruned)
  }

  private projectRecord(
    id: string,
    record: InteractionGenerationEvidenceRecordV1,
  ): object {
    const token = {}
    this.projectedRecords.set(id, record)
    this.projectedTokens.set(id, token)
    return token
  }

  private confirmResolvedProjection(
    id: string,
    record: Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'resolved' }>,
    projectionToken: object,
    operationSeq: number,
    persisted: Promise<void>,
  ): Promise<void> {
    return persisted.catch((error: unknown) => {
      if (this.unavailableError === undefined) {
        if (this.projectedTokens.get(id) === projectionToken
          && this.projectedRecords.get(id) === record) {
          this.projectedRecords.delete(id)
          this.projectedTokens.delete(id)
        }
        if (this.acceptedOperationSeq !== operationSeq) {
          throw this.makeUnavailable(
            `Interaction Generation evidence '${id}' failed after later receipts were projected`,
            error,
          )
        }
      }
      throw error
    })
  }

  private allocateRecordedSequence(): number {
    if (this.nextRecordedSeq >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Interaction Generation evidence insertion sequence is exhausted')
    }
    this.nextRecordedSeq += 1
    return this.nextRecordedSeq
  }

  private makeConflictRecord(
    id: string,
    identity: z.infer<typeof receiptIdentitySchema>,
    observedAt: number,
    recordedSeq: number,
    workspaceIds: readonly string[],
  ): Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'conflict' }> {
    try {
      return conflictRecord(id, identity, observedAt, recordedSeq, workspaceIds)
    } catch (error) {
      throw this.makeUnavailable(
        `Interaction Generation evidence '${id}' conflict owner metadata is unavailable`,
        error,
      )
    }
  }

  private enqueueWorkspacePrune(
    table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
    workspaceId: string,
    maxSize: number,
    confirmed: Promise<void>,
  ): Promise<void> {
    const prior = this.workspacePruneTails.get(workspaceId) ?? Promise.resolve()
    const task = prior.then(async () => {
      try {
        await confirmed
      } catch {
        return
      }
      if (this.unavailableError !== undefined) return
      await this.pruneConfirmedWorkspace(table, workspaceId, maxSize)
    })
    const barrier = task.then(() => {}, () => {})
    this.workspacePruneTails.set(workspaceId, barrier)
    void barrier.then(() => {
      if (this.workspacePruneTails.get(workspaceId) === barrier) {
        this.workspacePruneTails.delete(workspaceId)
      }
    })
    return task
  }

  private async pruneConfirmedWorkspace(
    table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
    workspaceId: string,
    maxSize: number,
  ): Promise<void> {
    let durableEntries: Array<[string, InteractionGenerationEvidenceRecordV1]>
    try {
      durableEntries = [...table.entries()]
    } catch (error) {
      throw this.makeUnavailable(
        `Interaction Generation evidence Workspace '${workspaceId}' quota pruning read failed`,
        error,
      )
    }
    const resolved = durableEntries.flatMap(([id, durable]) => {
      const projected = this.projectedRecords.get(id)
      const projectionToken = this.projectedTokens.get(id)
      return durable.state === 'resolved'
        && durable.workspaceIds[0] === workspaceId
        && projected?.state === 'resolved'
        && projected.recordDigest === durable.recordDigest
        && projectionToken !== undefined
        ? [{ id, durable, projectionToken }]
        : []
    })
    const overflow = resolved.length - maxSize
    if (overflow <= 0) return
    const oldest = resolved
      .sort((left, right) =>
        left.durable.recordedSeq - right.durable.recordedSeq || left.id.localeCompare(right.id))
      .slice(0, overflow)
    for (const { id: pruneId, durable: pruneRecord, projectionToken } of oldest) {
      const projected = this.projectedRecords.get(pruneId)
      let currentDurable: InteractionGenerationEvidenceRecordV1 | undefined
      try {
        currentDurable = table.get(pruneId)
      } catch (error) {
        throw this.makeUnavailable(
          `Interaction Generation evidence Workspace '${workspaceId}' quota pruning read failed`,
          error,
        )
      }
      // A same-id retain can project a conflict or a newer exact rewrite while
      // an earlier victim deletion is in flight. Recheck both views at the
      // exact queue boundary so this deletion cannot erase that later intent.
      if (this.projectedTokens.get(pruneId) !== projectionToken
        || projected?.state !== 'resolved'
        || projected.recordDigest !== pruneRecord.recordDigest
        || currentDurable?.state !== 'resolved'
        || currentDurable.workspaceIds[0] !== workspaceId
        || currentDurable.recordDigest !== pruneRecord.recordDigest) {
        continue
      }
      let deleted: boolean
      try {
        // Deliberately enqueue only after the new put is confirmed. If that
        // put fails, deleting an older positive would destroy safer evidence.
        deleted = await table.delete(pruneId)
      } catch (error) {
        throw this.makeUnavailable(
          `Interaction Generation evidence Workspace '${workspaceId}' quota pruning failed`,
          error,
        )
      }
      if (!deleted) {
        throw this.makeUnavailable(
          `Interaction Generation evidence Workspace '${workspaceId}' quota pruning failed`,
          new Error(`Interaction Generation evidence '${pruneId}' vanished during pruning`),
        )
      }
      const latestProjected = this.projectedRecords.get(pruneId)
      if (this.projectedTokens.get(pruneId) === projectionToken
        && latestProjected?.state === 'resolved'
        && latestProjected.recordDigest === pruneRecord.recordDigest) {
        this.projectedRecords.delete(pruneId)
        this.projectedTokens.delete(pruneId)
      }
    }
  }

  async resolveGenerationEvidence(
    subject: InteractionGenerationEvidenceSubjectV1,
    derived: InteractionGenerationEvidenceDerivedV1,
  ): Promise<InteractionGenerationEvidenceResolutionV1> {
    if (this.closing !== undefined || this.unavailableError !== undefined) {
      return abstained('evidence-unavailable')
    }
    let query: NormalizedEvidenceQuery
    try {
      query = normalizeEvidenceQuery(subject, derived)
    } catch {
      return abstained(this.closing === undefined
        ? 'evidence-conflict'
        : 'evidence-unavailable')
    }
    if (this.closing !== undefined) return abstained('evidence-unavailable')

    const identity = receiptIdentitySchema.parse({
      sourceDialect: query.sourceDialect,
      subject: query.subject,
    })
    const id = receiptIdentityId(identity)
    // Wait only for writes to this exact subject accepted before this query.
    // Global mutation ordering remains serialized, but an unrelated slow
    // Workspace cannot stall this identity's already-authoritative read.
    const acceptedWrites = this.acceptedWritesById.get(id)
    if (acceptedWrites !== undefined) await acceptedWrites
    if (this.closing !== undefined || this.unavailableError !== undefined) {
      return abstained('evidence-unavailable')
    }
    if (this.volatileConflicts.has(id)) return abstained('evidence-conflict')

    let record: InteractionGenerationEvidenceRecordV1 | undefined
    try {
      record = this.domain.table('receipts').get(id)
    } catch (error) {
      throw this.makeUnavailable('Interaction Generation evidence read failed', error)
    }
    if (record === undefined) return abstained('evidence-unavailable')
    if (record.state === 'conflict') return abstained('evidence-conflict')
    const workspacePrunes = this.workspacePruneTails.get(record.receipt.workspaceId)
    if (workspacePrunes !== undefined) {
      await workspacePrunes
      if (this.closing !== undefined || this.unavailableError !== undefined) {
        return abstained('evidence-unavailable')
      }
      try {
        record = this.domain.table('receipts').get(id)
      } catch (error) {
        throw this.makeUnavailable(
          'Interaction Generation evidence read failed after quota pruning',
          error,
        )
      }
      if (record === undefined) return abstained('evidence-unavailable')
      if (record.state === 'conflict') return abstained('evidence-conflict')
    }
    if (!this.authority.allows(record.receipt.workspaceId)) {
      return abstained('evidence-unavailable')
    }
    if (record.receipt.observedAt !== query.observedAt
      || !isDeepStrictEqual(record.receipt.subject, query.subject)) {
      return abstained('evidence-conflict')
    }

    return immutableCopy({
      status: 'matched',
      fact: {
        schemaVersion: 1,
        kind: 'interaction-generation-fact-v1',
        workspaceId: record.receipt.workspaceId,
        subject: {
          sessionLifecycleDigest: query.subject.sessionLifecycleDigest,
          prefixDigest: query.subject.prefixDigest,
          turnDigest: query.subject.turnDigest,
          loggedControlDigest: query.subject.loggedControlDigest!,
          turnEndSeq: query.subject.turnEndSeq,
          triggerRequestSeq: query.subject.triggerRequestSeq,
          triggerCallSeq: query.subject.triggerCallSeq,
          triggerResultSeq: query.subject.triggerResultSeq,
        },
        generation: record.receipt.generation,
      },
    } as const)
  }

  async drain(): Promise<void> {
    await (this.closing ?? Promise.all([...this.pendingWrites]))
    if (this.unavailableError !== undefined) throw this.unavailableError
  }

  close(): Promise<void> {
    this.closing ??= Promise.all([...this.pendingWrites]).then(async () => {
      let closeError: unknown
      try {
        await this.domain.close()
      } catch (error) {
        closeError = error
      }
      if (this.unavailableError !== undefined && closeError !== undefined) {
        throw new AggregateError(
          [this.unavailableError, closeError],
          'Interaction Generation evidence authority failure and domain close both failed',
        )
      }
      if (closeError !== undefined) throw closeError
      if (this.unavailableError !== undefined) throw this.unavailableError
    })
    return this.closing
  }

  private trackAcceptedWrite(id: string, result: Promise<void>): void {
    const writeBarrier = result.then(() => {}, () => {})
    const prior = this.acceptedWritesById.get(id)
    const identityBarrier = prior === undefined
      ? writeBarrier
      : Promise.all([prior, writeBarrier]).then(() => {})
    this.pendingWrites.add(writeBarrier)
    this.acceptedWritesById.set(id, identityBarrier)
    void writeBarrier.then(() => {
      this.pendingWrites.delete(writeBarrier)
    })
    void identityBarrier.then(() => {
      if (this.acceptedWritesById.get(id) === identityBarrier) {
        this.acceptedWritesById.delete(id)
      }
    })
  }

  private startAcceptedWrite(id: string, operation: () => Promise<void>): Promise<void> {
    let resolveAccepted!: () => void
    let rejectAccepted!: (error: unknown) => void
    const accepted = new Promise<void>((resolve, reject) => {
      resolveAccepted = resolve
      rejectAccepted = reject
    })
    // Close/drain and exact-identity reads must see the operation before any
    // storage method can synchronously re-enter this vault.
    this.trackAcceptedWrite(id, accepted)
    try {
      void Promise.resolve(operation()).then(resolveAccepted, rejectAccepted)
    } catch (error) {
      rejectAccepted(error)
    }
    return accepted
  }

  private makeUnavailable(message: string, cause: unknown): Error {
    if (this.unavailableError !== undefined) {
      return new Error('Interaction Generation evidence authority is unavailable', {
        cause: this.unavailableError,
      })
    }
    const unavailable = new Error(message, { cause })
    this.unavailableError = unavailable
    return unavailable
  }

  private async persistConflict(
    table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
    record: Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'conflict' }>,
  ): Promise<void> {
    try {
      await table.put(record.id, record)
    } catch (error) {
      let durable: InteractionGenerationEvidenceRecordV1 | undefined
      try {
        durable = table.get(record.id)
      } catch (readbackError) {
        const unavailable = new AggregateError(
          [error, readbackError],
          `Interaction Generation evidence '${record.id}' conflict tombstone put and readback failed`,
        )
        this.unavailableError = unavailable
        throw unavailable
      }
      if (isDeepStrictEqual(durable, record)) return
      const message = `Interaction Generation evidence '${record.id}' conflict tombstone was not committed`
      // Install the fail-closed state before inspecting a hostile rejection.
      // Diagnostics are secondary and must never reopen this authority.
      const unavailable = new Error(message, { cause: error })
      this.unavailableError = unavailable
      unavailable.message = `${message}: ${errorMessage(error)}`
      throw unavailable
    }
  }

  private async persistResolved(
    table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
    record: Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'resolved' }>,
  ): Promise<void> {
    try {
      await table.put(record.id, record)
    } catch (error) {
      let durable: InteractionGenerationEvidenceRecordV1 | undefined
      try {
        durable = table.get(record.id)
      } catch (readbackError) {
        const unavailable = new AggregateError(
          [error, readbackError],
          `Interaction Generation evidence '${record.id}' resolved put and readback failed`,
        )
        this.unavailableError = unavailable
        throw unavailable
      }
      if (durable === undefined) throw error
      if (isDeepStrictEqual(durable, record)) return
      const unavailable = new Error(
        `Interaction Generation evidence '${record.id}' resolved row has an uncertain durable state`,
        { cause: error },
      )
      this.unavailableError = unavailable
      throw unavailable
    }
  }
}

/**
 * Validate a binder observation against the exact trigger-control projection
 * and reduce it to a frozen, raw-free receipt before any asynchronous write.
 */
export function createInteractionGenerationEvidenceReceiptV1(
  input: CreateInteractionGenerationEvidenceReceiptInputV1,
): InteractionGenerationEvidenceReceiptV1 {
  const snapshot = snapshotJsonValue(input)
  const values = exactOwnData(snapshot, [
    'workspaceId',
    'subject',
    'derived',
    'generation',
    'binderEpoch',
    'lifecycleCutoff',
    'generationDigest',
    'mountEpoch',
  ])
  if (values === undefined) throw new Error('invalid Interaction Generation receipt input')
  const generation = generationSchema.parse(values.generation)
  const binderEpoch = boundedEpoch(values.binderEpoch, 'binder')
  const normalized = normalizeEvidenceQuery(
    values.subject as InteractionGenerationEvidenceSubjectV1,
    values.derived as InteractionGenerationEvidenceDerivedV1,
  )
  const lifecycleCutoff = safeNonNegativeInteger(values.lifecycleCutoff)
  if (lifecycleCutoff === undefined || lifecycleCutoff > normalized.subject.turnStartSeq) {
    throw new Error('invalid Interaction Generation lifecycle cutoff')
  }
  const cutoffDigest = hashLifecycleCutoff(lifecycleCutoff)

  let provenance: z.infer<typeof provenanceSchema>
  if (generation.kind === 'native') {
    if (Object.hasOwn(values, 'generationDigest') || Object.hasOwn(values, 'mountEpoch')) {
      throw new Error('native Interaction Generation evidence cannot carry an evolved mount')
    }
    provenance = {
      kind: 'native',
      binderEpochDigest: epochDigest('binder', binderEpoch),
      lifecycleCutoffDigest: cutoffDigest,
    }
  } else {
    const generationDigest = exactHash(values.generationDigest)
    const mountEpoch = boundedEpoch(values.mountEpoch, 'mount')
    if (generationDigest === undefined || generationDigest !== generation.generationId) {
      throw new Error('evolved Interaction Generation evidence has an invalid Generation digest')
    }
    provenance = {
      kind: 'evolved',
      binderEpochDigest: epochDigest('binder', binderEpoch),
      lifecycleCutoffDigest: cutoffDigest,
      mountEpochDigest: epochDigest('mount', mountEpoch),
      generationDigest,
    }
  }

  return immutableCopy(receiptSchema.parse({
    schemaVersion: 1,
    kind: 'interaction-generation-evidence-receipt-v1',
    observedAt: normalized.observedAt,
    sourceDialect: normalized.sourceDialect,
    workspaceId: values.workspaceId,
    subject: normalized.subject,
    generation,
    provenance,
  }))
}

/** @internal Opened and closed by the dsh-evolve plugin lifecycle. */
export async function openInteractionGenerationEvidenceVault(
  facility: DomainFacility,
  options: InteractionGenerationEvidenceVaultOptions = {},
): Promise<InteractionGenerationEvidenceVaultV1> {
  const authority = options.authority ?? compileInteractionGenerationEvidencePolicies()
  if (!compiledPolicyAuthorities.has(authority)) {
    throw new Error('Interaction Generation evidence policy authority was not compiled from Host config')
  }
  const domain = await facility.open(evidenceDomainSpec)
  try {
    const audit = auditEvidence(domain)
    if (domain.table('receipts').size > INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      throw new Error('Interaction Generation evidence exceeds the 100000-record aggregate safety cap')
    }
    await pruneAuthorizedResolved(domain.table('receipts'), authority)
    return new DomainInteractionGenerationEvidenceVault(
      domain,
      authority,
      audit.conflicts,
      audit.highestRecordedSeq,
    )
  } catch (auditError) {
    try {
      await domain.close()
    } catch (closeError) {
      throw new AggregateError(
        [auditError, closeError],
        'Interaction Generation evidence audit and domain cleanup both failed',
      )
    }
    throw auditError
  }
}

/** @internal Narrow mutable facade passed only to the Generation binder. */
export function createInteractionGenerationEvidenceSink(
  vault: Pick<InteractionGenerationEvidenceVaultV1, 'allows' | 'retain' | 'drain'>,
): InteractionGenerationEvidenceSinkV1 {
  return Object.freeze({
    allows: (workspaceId: string) => vault.allows(workspaceId),
    retain: (receipt: InteractionGenerationEvidenceReceiptV1) => vault.retain(receipt),
    drain: () => vault.drain(),
  })
}

/** @internal Narrow read facade passed only to trusted Host evidence composition. */
export function createInteractionGenerationEvidenceSource(
  vault: Pick<InteractionGenerationEvidenceVaultV1, 'resolveGenerationEvidence'>,
): InteractionGenerationEvidenceSourceV1 {
  return Object.freeze({
    resolveGenerationEvidence: (
      subject: InteractionGenerationEvidenceSubjectV1,
      derived: InteractionGenerationEvidenceDerivedV1,
    ) => vault.resolveGenerationEvidence(subject, derived),
  })
}

/**
 * Canonical lifecycle binding shared by the vault and its trusted consumer.
 * The full Session header is snapshotted without invoking accessors; no raw
 * header value is returned or persisted by this helper.
 */
export function interactionGenerationSessionLifecycleDigest(
  rawSubject: InteractionGenerationEvidenceSubjectV1,
): string {
  const subject = snapshotJsonValue(rawSubject)
  const root = jsonRecord(subject)
  const session = jsonRecord(root?.session)
  const header = session?.header
  const inheritedEventCount = safeNonNegativeInteger(session?.inheritedEventCount)
  if (root === undefined
    || session === undefined
    || header === undefined
    || inheritedEventCount === undefined) {
    throw new Error('invalid Interaction Generation Session lifecycle subject')
  }
  return hashCanonical({
    domain: 'evoforge_interaction_generation_session_lifecycle',
    version: 1,
    header,
    inheritedEventCount,
  })
}

function normalizeReceipt(receipt: InteractionGenerationEvidenceReceiptV1): InteractionGenerationEvidenceReceiptV1 {
  return immutableCopy(receiptSchema.parse(snapshotJsonValue(receipt)))
}

function normalizeEvidenceQuery(
  rawSubject: InteractionGenerationEvidenceSubjectV1,
  rawDerived: InteractionGenerationEvidenceDerivedV1,
): NormalizedEvidenceQuery {
  const subject = snapshotJsonValue(rawSubject)
  const derived = snapshotJsonValue(rawDerived)
  const projection = projectInteractionEpisodeTriggerRequestControlV1(
    subject as unknown as InteractionGenerationEvidenceSubjectV1,
  )
  if (projection.status !== 'projected') {
    throw new Error('Interaction Generation evidence subject does not project')
  }
  const derivedValues = exactOwnData(derived, ['triggerRequestControl'])
  if (derivedValues === undefined
    || canonicalJson(derivedValues.triggerRequestControl)
      !== canonicalJson(projection.fact)) {
    throw new Error('Interaction Generation evidence derived control does not match its subject')
  }

  const root = jsonRecord(subject)
  const session = jsonRecord(root?.session)
  const header = session?.header
  const events = jsonArray(session?.events)
  const transcript = jsonRecord(root?.transcript)
  const source = jsonRecord(transcript?.source)
  const witness = jsonRecord(transcript?.witness)
  const trigger = jsonRecord(transcript?.trigger)
  const inheritedEventCount = safeNonNegativeInteger(session?.inheritedEventCount)
  const turn = safeNonNegativeInteger(source?.turn)
  const turnStartSeq = safeNonNegativeInteger(source?.turnStartSeq)
  const turnEndSeq = safeNonNegativeInteger(source?.turnEndSeq)
  const triggerRequestSeq = safeNonNegativeInteger(witness?.triggerRequestSeq)
  const triggerCallSeq = safeNonNegativeInteger(source?.triggerCallSeq)
  const triggerResultSeq = safeNonNegativeInteger(source?.triggerResultSeq)
  const triggerKind = trigger?.kind
  const turnStart = turnStartSeq === undefined
    ? undefined
    : sessionEventAt(events, turnStartSeq, 'turn/start')
  const turnEnd = turnEndSeq === undefined
    ? undefined
    : sessionEventAt(events, turnEndSeq, 'turn/end')
  const triggerRequest = triggerRequestSeq === undefined
    ? undefined
    : sessionEventAt(events, triggerRequestSeq, 'assistant/message')
  const turnStartData = jsonRecord(turnStart?.data)
  const turnEndData = jsonRecord(turnEnd?.data)
  const triggerRequestData = jsonRecord(triggerRequest?.data)
  const turnEndReason = jsonRecord(turnEndData?.reason)
  const observedAt = safeNonNegativeInteger(turnEnd?.time)
  if (root === undefined
    || session === undefined
    || header === undefined
    || events === undefined
    || transcript === undefined
    || source === undefined
    || witness === undefined
    || trigger === undefined
    || inheritedEventCount === undefined
    || turn === undefined
    || turn === 0
    || turnStartSeq === undefined
    || turnEndSeq === undefined
    || triggerRequestSeq === undefined
    || triggerCallSeq === undefined
    || triggerResultSeq === undefined
    || turnStart === undefined
    || turnEnd === undefined
    || triggerRequest === undefined
    || turnStartData?.turn !== turn
    || turnEndData?.turn !== turn
    || triggerRequestData?.turn !== turn
    || turnEndReason?.kind !== 'completed'
    || observedAt === undefined
    || source.completedAt !== observedAt
    || (triggerKind !== 'successful-gap-report' && triggerKind !== 'skill-tool-error')
    || !interactionSessionDialectSchema.safeParse(projection.fact.sourceDialect).success
    || projection.fact.subject.prefixDigest !== transcriptReplayDigest(transcript, 'prefixDigest')
    || projection.fact.subject.turnDigest !== transcriptReplayDigest(transcript, 'turnDigest')
    || projection.fact.subject.throughSeq !== turnEndSeq
    || projection.fact.boundary.assistantMessageSeq !== triggerRequestSeq
    || projection.fact.boundary.triggerCallSeq !== triggerCallSeq
    || projection.fact.boundary.triggerResultSeq !== triggerResultSeq) {
    throw new Error('invalid Interaction Generation evidence subject coordinates')
  }

  return immutableCopy({
    sourceDialect: projection.fact.sourceDialect,
    observedAt,
    subject: receiptSubjectSchema.parse({
      sessionLifecycleDigest: interactionGenerationSessionLifecycleDigest(
        subject as unknown as InteractionGenerationEvidenceSubjectV1,
      ),
      prefixDigest: projection.fact.subject.prefixDigest,
      turnDigest: projection.fact.subject.turnDigest,
      loggedControlDigest: projection.fact.loggedControlDigest,
      turn,
      turnStartSeq,
      turnEndSeq,
      triggerKind,
      triggerRequestSeq,
      triggerCallSeq,
      triggerResultSeq,
    }),
  })
}

function transcriptReplayDigest(
  transcript: JsonRecord,
  name: 'prefixDigest' | 'turnDigest',
): string | undefined {
  return exactHash(jsonRecord(transcript.replay)?.[name])
}

function receiptIdentity(
  receipt: InteractionGenerationEvidenceReceiptV1,
): z.infer<typeof receiptIdentitySchema> {
  return receiptIdentitySchema.parse({
    sourceDialect: receipt.sourceDialect,
    subject: receipt.subject,
  })
}

function receiptIdentityId(identity: z.infer<typeof receiptIdentitySchema>): string {
  return hashCanonical({
    domain: EVIDENCE_DOMAIN,
    version: EVIDENCE_DOMAIN_VERSION,
    identity,
  })
}

function resolvedRecord(
  id: string,
  identity: z.infer<typeof receiptIdentitySchema>,
  receipt: InteractionGenerationEvidenceReceiptV1,
  recordedSeq: number,
): Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'resolved' }> {
  return stampRecord({
    schemaVersion: 1 as const,
    kind: 'interaction-generation-evidence-record-v1' as const,
    state: 'resolved' as const,
    id,
    observedAt: receipt.observedAt,
    recordedSeq,
    workspaceIds: [receipt.workspaceId],
    identity,
    receipt,
  }, resolvedRecordSchema)
}

function conflictRecord(
  id: string,
  identity: z.infer<typeof receiptIdentitySchema>,
  observedAt: number,
  recordedSeq: number,
  workspaceIds: readonly string[],
): Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'conflict' }> {
  return stampRecord({
    schemaVersion: 1 as const,
    kind: 'interaction-generation-evidence-record-v1' as const,
    state: 'conflict' as const,
    id,
    observedAt,
    recordedSeq,
    workspaceIds,
    identity,
  }, conflictRecordSchema)
}

function stampRecord<T extends z.ZodType>(
  content: Record<string, unknown>,
  schema: T,
): z.infer<T> {
  return schema.parse({
    ...content,
    recordDigest: hashCanonical({
      domain: EVIDENCE_DOMAIN,
      version: EVIDENCE_DOMAIN_VERSION,
      record: content,
    }),
  })
}

function auditEvidence(domain: InteractionGenerationEvidenceDomain): {
  readonly conflicts: Set<string>
  readonly highestRecordedSeq: number
} {
  const conflicts = new Set<string>()
  const recordedSequences = new Set<number>()
  let highestRecordedSeq = 0
  for (const [key, raw] of domain.table('receipts').entries()) {
    const record = evidenceRecordSchema.parse(raw)
    if (key !== record.id) {
      throw new Error(`Interaction Generation evidence key '${key}' does not match row id`)
    }
    const { recordDigest: actual, ...content } = record
    const expected = hashCanonical({
      domain: EVIDENCE_DOMAIN,
      version: EVIDENCE_DOMAIN_VERSION,
      record: content,
    })
    if (actual !== expected) {
      throw new Error(`Interaction Generation evidence '${record.id}' failed integrity audit`)
    }
    if (recordedSequences.has(record.recordedSeq)) {
      throw new Error('Interaction Generation evidence insertion sequence is duplicated')
    }
    recordedSequences.add(record.recordedSeq)
    highestRecordedSeq = Math.max(highestRecordedSeq, record.recordedSeq)
    if (record.state === 'conflict') conflicts.add(record.id)
  }
  return { conflicts, highestRecordedSeq }
}

async function pruneWorkspaceResolved(
  table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
  workspaceId: string,
  maxSize: number,
): Promise<void> {
  const resolved = [...table.entries()].filter((entry): entry is [
    string,
    Extract<InteractionGenerationEvidenceRecordV1, { readonly state: 'resolved' }>,
  ] => entry[1].state === 'resolved' && entry[1].workspaceIds[0] === workspaceId)
  const overflow = resolved.length - maxSize
  if (overflow <= 0) return
  const oldest = resolved
    .sort((left, right) =>
      left[1].recordedSeq - right[1].recordedSeq || left[0].localeCompare(right[0]))
    .slice(0, overflow)
  if (oldest.length !== overflow) {
    throw new Error('Interaction Generation evidence retention index is inconsistent')
  }
  for (const [id] of oldest) {
    if (!(await table.delete(id))) {
      throw new Error(`Interaction Generation evidence '${id}' vanished during pruning`)
    }
  }
}

async function pruneAuthorizedResolved(
  table: KvTable<string, InteractionGenerationEvidenceRecordV1>,
  authority: InteractionGenerationEvidencePolicyAuthorityV1,
): Promise<void> {
  const workspaces = new Set<string>()
  for (const [, record] of table.entries()) {
    if (record.state === 'resolved'
      && authority.generationMaxRecords(record.workspaceIds[0]!) !== undefined) {
      workspaces.add(record.workspaceIds[0]!)
    }
  }
  for (const workspaceId of [...workspaces].sort()) {
    await pruneWorkspaceResolved(
      table,
      workspaceId,
      authority.generationMaxRecords(workspaceId)!,
    )
  }
}

function mergeWorkspaceIds(existing: readonly string[], workspaceId: string): string[] {
  return [...new Set([...existing, workspaceId])].sort()
}

function epochDigest(kind: 'binder' | 'mount', epoch: string): string {
  return hashCanonical({
    domain: `evoforge_interaction_generation_${kind}_epoch`,
    version: 1,
    epoch,
  })
}

function hashLifecycleCutoff(cutoff: number): string {
  return hashCanonical({
    domain: 'evoforge_interaction_generation_lifecycle_cutoff',
    version: 1,
    cutoff,
  })
}

function boundedEpoch(value: unknown, name: 'binder' | 'mount'): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value) > MAX_EPOCH_BYTES) {
    throw new Error(`invalid Interaction Generation ${name} epoch`)
  }
  return value
}

function exactHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : undefined
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
    ? value
    : undefined
}

function errorMessage(error: unknown): string {
  try {
    if (utilTypes.isNativeError(error)) {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
      return descriptor !== undefined
        && 'value' in descriptor
        && typeof descriptor.value === 'string'
        ? descriptor.value
        : 'uninspectable Error rejection'
    }
    if (error === null) return 'null'
    if (typeof error !== 'object' && typeof error !== 'function') return String(error)
    return 'uninspectable rejection'
  } catch {
    return 'uninspectable rejection'
  }
}

function abstained(
  reason: 'evidence-unavailable' | 'evidence-conflict',
): InteractionGenerationEvidenceResolutionV1 {
  return immutableCopy({ status: 'abstained', reason } as const)
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('non-canonical number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}

type JsonScalar = null | boolean | number | string
type JsonValue = JsonScalar | JsonValue[] | JsonRecord
interface JsonRecord { readonly [key: string]: JsonValue }

function jsonRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function jsonArray(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function sessionEventAt(
  events: readonly JsonValue[] | undefined,
  seq: number,
  type: string,
): JsonRecord | undefined {
  const event = events === undefined ? undefined : jsonRecord(events[seq])
  return event?.seq === seq && event.type === type ? event : undefined
}

function exactOwnData(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainObject(value)) return undefined
  const allowed = new Set(allowedKeys)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const snapshot: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) return undefined
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return undefined
    }
    snapshot[key] = descriptor.value
  }
  return snapshot
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

type SnapshotFrame =
  | { readonly kind: 'leave'; readonly source: object }
  | {
      readonly kind: 'value'
      readonly source: unknown
      readonly assign: (snapshot: JsonValue) => void
    }

/** Lossless JSON copy through own data descriptors without invoking getters. */
function snapshotJsonValue(value: unknown): JsonValue {
  const root: { value?: JsonValue } = {}
  const active = new Set<object>()
  const stack: SnapshotFrame[] = [{
    kind: 'value',
    source: value,
    assign: snapshot => { root.value = snapshot },
  }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.kind === 'leave') {
      active.delete(frame.source)
      continue
    }
    const current = frame.source
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      frame.assign(current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) {
        throw new TypeError('invalid JSON number')
      }
      frame.assign(current)
      continue
    }
    if (typeof current !== 'object') throw new TypeError('not lossless JSON')
    if (active.has(current)) throw new TypeError('cyclic JSON')

    const prototype = Object.getPrototypeOf(current)
    const descriptors = Object.getOwnPropertyDescriptors(current) as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) throw new TypeError('exotic array')
      const lengthDescriptor = descriptors.length
      const length = lengthDescriptor?.value
      if (lengthDescriptor === undefined
        || !('value' in lengthDescriptor)
        || lengthDescriptor.enumerable
        || typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || Reflect.ownKeys(descriptors).length !== length + 1) {
        throw new TypeError('decorated or sparse array')
      }
      const result = new Array<JsonValue>(length)
      frame.assign(result)
      active.add(current)
      stack.push({ kind: 'leave', source: current })
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined
          || !descriptor.enumerable
          || !('value' in descriptor)) throw new TypeError('invalid array element')
        stack.push({
          kind: 'value',
          source: descriptor.value,
          assign: snapshot => { result[index] = snapshot },
        })
      }
      continue
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('exotic object')
    const entries: Array<readonly [string, unknown]> = []
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key]
      if (typeof key !== 'string'
        || descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)) throw new TypeError('decorated object')
      entries.push([key, descriptor.value])
    }
    const result: Record<string, JsonValue> = Object.create(null)
    frame.assign(result)
    active.add(current)
    stack.push({ kind: 'leave', source: current })
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!
      stack.push({
        kind: 'value',
        source: child,
        assign: snapshot => { result[key] = snapshot },
      })
    }
  }
  if (root.value === undefined) throw new TypeError('missing JSON snapshot')
  return root.value
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
