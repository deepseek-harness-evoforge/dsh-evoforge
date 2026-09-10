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

const EVIDENCE_DOMAIN = 'evoforge_interaction_routing_evidence'
const EVIDENCE_DOMAIN_VERSION = 1
const MAX_EPOCH_BYTES = 512

export const INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES = 100
export const INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE = 10_000
export const INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS = 100_000

const workspaceIdSchema = z.string().refine(isWorkspaceId, {
  message: 'expected a canonical native Workspace UUID v1-v5',
})
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const triggerKindSchema = z.enum(['successful-gap-report', 'skill-tool-error'])

const interactionRoutingEvidencePolicySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  retention: z.strictObject({
    routingMaxRecords: z.number().int().min(1)
      .max(INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE),
  }),
})

const interactionRoutingEvidencePoliciesSchema = z.array(interactionRoutingEvidencePolicySchema)
  .max(INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES)
  .superRefine((policies, context) => {
    const seen = new Set<string>()
    let aggregate = 0
    for (let index = 0; index < policies.length; index += 1) {
      const policy = policies[index]!
      if (seen.has(policy.workspaceId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'workspaceId'],
          message: `duplicate Interaction Routing evidence policy for Workspace '${policy.workspaceId}'`,
        })
      }
      seen.add(policy.workspaceId)
      aggregate += policy.retention.routingMaxRecords
    }
    if (aggregate > INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      context.addIssue({
        code: 'custom',
        message: 'Interaction Routing evidence policy aggregate exceeds the 100000-record safety cap',
      })
    }
  })

export type InteractionRoutingEvidencePolicyConfig =
  z.infer<typeof interactionRoutingEvidencePolicySchema>

/** Host-admin retention authority; it grants neither user consent nor Episode access. */
export interface InteractionRoutingEvidencePolicyAuthorityV1 {
  allows(workspaceId: string): boolean
  routingMaxRecords(workspaceId: string): number | undefined
}

const compiledPolicyAuthorities = new WeakSet<object>()

/** @internal Compile raw plugin config into the only policy authority accepted by the vault. */
export function compileInteractionRoutingEvidencePolicies(
  rawPolicies: readonly InteractionRoutingEvidencePolicyConfig[] = [],
): InteractionRoutingEvidencePolicyAuthorityV1 {
  const policies = interactionRoutingEvidencePoliciesSchema.parse(snapshotJsonValue(rawPolicies))
  const byWorkspace = new Map(policies.map(policy => [
    policy.workspaceId,
    policy.retention.routingMaxRecords,
  ] as const))
  const authority: InteractionRoutingEvidencePolicyAuthorityV1 = Object.freeze({
    allows: (workspaceId: string) => isWorkspaceId(workspaceId) && byWorkspace.has(workspaceId),
    routingMaxRecords: (workspaceId: string) => isWorkspaceId(workspaceId)
      ? byWorkspace.get(workspaceId)
      : undefined,
  })
  compiledPolicyAuthorities.add(authority)
  return authority
}

const routingSchema = z.strictObject({
  rawTrigger: z.literal('successful-gap-report'),
  conclusion: z.literal('model-declared-no-applicable-skill'),
})

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
      message: 'Routing evidence coordinates are not in strict causal order',
    })
  }
})

const provenanceSchema = z.strictObject({
  authorityEpochDigest: hashSchema,
  registrationEpochDigest: hashSchema,
  executionEpochDigest: hashSchema,
  lifecycleCutoffDigest: hashSchema,
  bodyValueDigest: hashSchema,
  finalResultDigest: hashSchema,
  toolContractDigest: hashSchema,
})

const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-routing-evidence-receipt-v1'),
  observedAt: safeInteger,
  sourceDialect: interactionSessionDialectSchema,
  workspaceId: workspaceIdSchema,
  subject: receiptSubjectSchema,
  routing: routingSchema,
  provenance: provenanceSchema,
}).superRefine((receipt, context) => {
  if (receipt.subject.triggerKind !== 'successful-gap-report') {
    context.addIssue({
      code: 'custom',
      path: ['subject', 'triggerKind'],
      message: 'Routing evidence receipt is eligible only for a successful gap report',
    })
  }
  if (receipt.provenance.toolContractDigest !== routingToolContractDigest()) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'toolContractDigest'],
      message: 'Routing evidence receipt does not match the fixed Tool contract',
    })
  }
})

const receiptIdentitySchema = z.strictObject({
  sourceDialect: interactionSessionDialectSchema,
  subject: receiptSubjectSchema,
})

const workspaceIdsSchema = z.array(workspaceIdSchema).min(1)
  .max(INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES)
  .superRefine((workspaceIds, context) => {
    const canonical = [...new Set(workspaceIds)].sort()
    if (!isDeepStrictEqual(workspaceIds, canonical)) {
      context.addIssue({ code: 'custom', message: 'evidence owners must be unique and sorted' })
    }
  })

const resolvedRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('interaction-routing-evidence-record-v1'),
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
      message: 'record envelope does not match its Routing receipt',
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
  kind: z.literal('interaction-routing-evidence-record-v1'),
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

type InteractionRoutingEvidenceRecordV1 = z.infer<typeof evidenceRecordSchema>

const evidenceDomainSpec = defineDomain({
  name: EVIDENCE_DOMAIN,
  version: EVIDENCE_DOMAIN_VERSION,
  // A malformed row invalidates the whole authority. Treating corruption as
  // absence could otherwise manufacture an apparently clean routing answer.
  layout: 'single',
  tables: {
    receipts: domainTable<string, InteractionRoutingEvidenceRecordV1>(evidenceRecordSchema),
  },
})

type InteractionRoutingEvidenceDomain = Domain<typeof evidenceDomainSpec>

export type InteractionRoutingBindingV1 = Extract<
  InteractionEpisodeHostBindingV1['capability']['routing'],
  { readonly rawTrigger: 'successful-gap-report' }
>

/** Raw-free completed-turn receipt authored by the owned Routing witness. */
export type InteractionRoutingEvidenceReceiptV1 = z.infer<typeof receiptSchema>

export interface InteractionRoutingEvidenceDerivedV1 {
  readonly triggerRequestControl: InteractionEpisodeTriggerRequestControlFactV1
}

export type InteractionRoutingEvidenceSubjectV1 =
  InteractionEpisodeTriggerRequestControlSubjectV1

/**
 * Getter-free canonical query identity used by the owned producer to
 * linearize completion-time checks with reads of that exact subject.
 * @internal This module-only seam is not exported from the package root.
 */
export function interactionRoutingEvidenceQueryIdentityIdV1(
  subject: InteractionRoutingEvidenceSubjectV1,
  derived: InteractionRoutingEvidenceDerivedV1,
): string | undefined {
  try {
    const query = normalizeEvidenceQuery(subject, derived)
    requireEligibleRouting(query)
    return receiptIdentityId(receiptIdentitySchema.parse({
      sourceDialect: query.sourceDialect,
      subject: query.subject,
    }))
  } catch {
    return undefined
  }
}

export interface InteractionEpisodeRoutingFactV1 {
  readonly schemaVersion: 1
  readonly kind: 'interaction-routing-fact-v1'
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
  /** This fact closes only the Routing dimension. */
  readonly routing: InteractionRoutingBindingV1
}

export type InteractionRoutingEvidenceResolutionV1 =
  | { readonly status: 'matched'; readonly fact: InteractionEpisodeRoutingFactV1 }
  | {
      readonly status: 'abstained'
      readonly reason: 'evidence-unavailable' | 'evidence-conflict'
    }

export interface InteractionRoutingEvidenceConflictInputV1 {
  readonly workspaceId: string
  readonly subject: InteractionRoutingEvidenceSubjectV1
  readonly derived: InteractionRoutingEvidenceDerivedV1
}

export interface InteractionRoutingEvidenceSinkV1 {
  /** Synchronous least-authority gate used before constructing a raw-free receipt. */
  allows(workspaceId: string): boolean
  retain(receipt: InteractionRoutingEvidenceReceiptV1): Promise<void>
  /** Irreversibly poison one eligible subject when the owned witness is ambiguous. */
  recordConflict(input: InteractionRoutingEvidenceConflictInputV1): Promise<void>
  /** Wait for writes accepted before this call; it does not close the sink. */
  drain(): Promise<void>
}

/** Least-authority historical reader; it cannot execute or register a Tool. */
export interface InteractionRoutingEvidenceSourceV1 {
  resolveRoutingEvidence(
    subject: InteractionRoutingEvidenceSubjectV1,
    derived: InteractionRoutingEvidenceDerivedV1,
  ): Promise<InteractionRoutingEvidenceResolutionV1>
}

export interface InteractionRoutingEvidenceVaultV1
  extends InteractionRoutingEvidenceSinkV1, InteractionRoutingEvidenceSourceV1 {
  close(): Promise<void>
}

export interface InteractionRoutingEvidenceVaultOptions {
  readonly authority?: InteractionRoutingEvidencePolicyAuthorityV1
}

export interface CreateInteractionRoutingEvidenceReceiptInputV1 {
  readonly workspaceId: string
  readonly subject: InteractionRoutingEvidenceSubjectV1
  readonly derived: InteractionRoutingEvidenceDerivedV1
  /** Opaque Host authority token. Only its domain-separated digest persists. */
  readonly authorityEpoch: string
  /** Opaque exact Tool-registration token. Only its digest persists. */
  readonly registrationEpoch: string
  /** Opaque exact Tool-execution token. Only its digest persists. */
  readonly executionEpoch: string
  /** Exact Session seq observed at the authenticated session-start boundary. */
  readonly lifecycleCutoff: number
  /** Exact canonical value returned by the owned Tool body; never persisted raw. */
  readonly bodyValue: unknown
  /** Exact canonical successful result observed at tools/result; never persisted raw. */
  readonly finalResult: unknown
}

interface NormalizedEvidenceQuery {
  readonly sourceDialect: InteractionSessionDialect
  readonly subject: z.infer<typeof receiptSubjectSchema>
  readonly observedAt: number
}

class DomainInteractionRoutingEvidenceVault implements InteractionRoutingEvidenceVaultV1 {
  private readonly domain: InteractionRoutingEvidenceDomain
  private readonly authority: InteractionRoutingEvidencePolicyAuthorityV1
  private readonly projectedRecords: Map<string, InteractionRoutingEvidenceRecordV1>
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
    domain: InteractionRoutingEvidenceDomain,
    authority: InteractionRoutingEvidencePolicyAuthorityV1,
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

  retain(rawReceipt: InteractionRoutingEvidenceReceiptV1): Promise<void> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('Interaction Routing evidence vault is closing'))
    }
    if (this.unavailableError !== undefined) {
      return Promise.reject(new Error('Interaction Routing evidence authority is unavailable', {
        cause: this.unavailableError,
      }))
    }
    let receipt: InteractionRoutingEvidenceReceiptV1
    try {
      receipt = normalizeReceipt(rawReceipt)
    } catch (error) {
      return Promise.reject(error)
    }
    const maxRecords = this.authorizedMaxRecords(receipt.workspaceId)
    if (maxRecords === undefined) return this.unauthorized(receipt.workspaceId)
    const identity = receiptIdentity(receipt)
    const id = receiptIdentityId(identity)
    return this.startAcceptedWrite(
      id,
      () => this.stageReceipt(id, identity, receipt, maxRecords),
    )
  }

  recordConflict(rawInput: InteractionRoutingEvidenceConflictInputV1): Promise<void> {
    if (this.closing !== undefined) {
      return Promise.reject(new Error('Interaction Routing evidence vault is closing'))
    }
    if (this.unavailableError !== undefined) {
      return Promise.reject(new Error('Interaction Routing evidence authority is unavailable', {
        cause: this.unavailableError,
      }))
    }
    let normalized: {
      readonly workspaceId: string
      readonly query: NormalizedEvidenceQuery
    }
    try {
      normalized = normalizeConflictInput(rawInput)
      requireEligibleRouting(normalized.query)
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.authorizedMaxRecords(normalized.workspaceId) === undefined) {
      return this.unauthorized(normalized.workspaceId)
    }
    const identity = receiptIdentitySchema.parse({
      sourceDialect: normalized.query.sourceDialect,
      subject: normalized.query.subject,
    })
    const id = receiptIdentityId(identity)
    return this.startAcceptedWrite(id, () => this.stageConflict(
      id,
      identity,
      normalized.query.observedAt,
      normalized.workspaceId,
    ))
  }

  private authorizedMaxRecords(workspaceId: string): number | undefined {
    if (!this.allows(workspaceId)) return undefined
    return this.authority.routingMaxRecords(workspaceId)
  }

  private unauthorized(workspaceId: string): Promise<never> {
    return Promise.reject(new Error(
      `Interaction Routing evidence retention is not authorized for Workspace '${workspaceId}'`,
    ))
  }

  /**
   * Project first, then synchronously enroll the authoritative row mutation in
   * the Domain chain. A sibling provider may begin teardown on the next
   * microtask, so an accepted observation cannot wait behind a private tail
   * before its first put is enrolled.
   */
  private stageReceipt(
    id: string,
    identity: z.infer<typeof receiptIdentitySchema>,
    receipt: InteractionRoutingEvidenceReceiptV1,
    maxRecords: number,
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
          maxRecords,
          confirmed,
        )
        return confirmed.then(() => pruned)
      }
      return this.projectAndPersistConflict(
        table,
        id,
        existing?.identity ?? identity,
        existing?.observedAt ?? receipt.observedAt,
        existing?.recordedSeq,
        mergeWorkspaceIds(existing?.workspaceIds ?? [], receipt.workspaceId),
      )
    }

    if (Math.max(this.projectedRecords.size, table.size)
      >= INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      throw new Error('Interaction Routing evidence aggregate safety cap is full')
    }
    const record = resolvedRecord(
      id,
      identity,
      receipt,
      this.allocateRecordedSequence(),
    )
    const projectionToken = this.projectRecord(id, record)
    const operationSeq = ++this.acceptedOperationSeq
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
      maxRecords,
      confirmed,
    )
    return confirmed.then(() => pruned)
  }

  private stageConflict(
    id: string,
    identity: z.infer<typeof receiptIdentitySchema>,
    observedAt: number,
    workspaceId: string,
  ): Promise<void> {
    const table = this.domain.table('receipts')
    const existing = this.projectedRecords.get(id)
    return this.projectAndPersistConflict(
      table,
      id,
      existing?.identity ?? identity,
      existing?.observedAt ?? observedAt,
      existing?.recordedSeq,
      mergeWorkspaceIds(existing?.workspaceIds ?? [], workspaceId),
    )
  }

  private projectAndPersistConflict(
    table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
    id: string,
    identity: z.infer<typeof receiptIdentitySchema>,
    observedAt: number,
    recordedSeq: number | undefined,
    workspaceIds: readonly string[],
  ): Promise<void> {
    if (recordedSeq === undefined
      && Math.max(this.projectedRecords.size, table.size)
        >= INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      throw new Error('Interaction Routing evidence aggregate safety cap is full')
    }
    const conflict = this.makeConflictRecord(
      id,
      identity,
      observedAt,
      recordedSeq ?? this.allocateRecordedSequence(),
      workspaceIds,
    )
    // Once projected, a conflict is irreversible even while its put is in flight.
    this.projectRecord(id, conflict)
    this.volatileConflicts.add(id)
    this.acceptedOperationSeq += 1
    return this.persistConflict(table, conflict)
  }

  private projectRecord(id: string, record: InteractionRoutingEvidenceRecordV1): object {
    const token = {}
    this.projectedRecords.set(id, record)
    this.projectedTokens.set(id, token)
    return token
  }

  private confirmResolvedProjection(
    id: string,
    record: Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'resolved' }>,
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
            `Interaction Routing evidence '${id}' failed after later observations were projected`,
            error,
          )
        }
      }
      throw error
    })
  }

  private allocateRecordedSequence(): number {
    if (this.nextRecordedSeq >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Interaction Routing evidence insertion sequence is exhausted')
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
  ): Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'conflict' }> {
    try {
      return conflictRecord(id, identity, observedAt, recordedSeq, workspaceIds)
    } catch (error) {
      throw this.makeUnavailable(
        `Interaction Routing evidence '${id}' conflict owner metadata is unavailable`,
        error,
      )
    }
  }

  private enqueueWorkspacePrune(
    table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
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
    table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
    workspaceId: string,
    maxSize: number,
  ): Promise<void> {
    let durableEntries: Array<[string, InteractionRoutingEvidenceRecordV1]>
    try {
      durableEntries = [...table.entries()]
    } catch (error) {
      throw this.makeUnavailable(
        `Interaction Routing evidence Workspace '${workspaceId}' quota pruning read failed`,
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
      let currentDurable: InteractionRoutingEvidenceRecordV1 | undefined
      try {
        currentDurable = table.get(pruneId)
      } catch (error) {
        throw this.makeUnavailable(
          `Interaction Routing evidence Workspace '${workspaceId}' quota pruning read failed`,
          error,
        )
      }
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
        deleted = await table.delete(pruneId)
      } catch (error) {
        throw this.makeUnavailable(
          `Interaction Routing evidence Workspace '${workspaceId}' quota pruning failed`,
          error,
        )
      }
      if (!deleted) {
        throw this.makeUnavailable(
          `Interaction Routing evidence Workspace '${workspaceId}' quota pruning failed`,
          new Error(`Interaction Routing evidence '${pruneId}' vanished during pruning`),
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

  async resolveRoutingEvidence(
    subject: InteractionRoutingEvidenceSubjectV1,
    derived: InteractionRoutingEvidenceDerivedV1,
  ): Promise<InteractionRoutingEvidenceResolutionV1> {
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
    // A native Skill miss is a real transcript trigger, but this authority has
    // no owned witness capable of proving its routing conclusion.
    if (query.subject.triggerKind === 'skill-tool-error') {
      return abstained('evidence-unavailable')
    }

    const identity = receiptIdentitySchema.parse({
      sourceDialect: query.sourceDialect,
      subject: query.subject,
    })
    const id = receiptIdentityId(identity)
    const acceptedWrites = this.acceptedWritesById.get(id)
    if (acceptedWrites !== undefined) await acceptedWrites
    if (this.closing !== undefined || this.unavailableError !== undefined) {
      return abstained('evidence-unavailable')
    }
    if (this.volatileConflicts.has(id)) return abstained('evidence-conflict')

    let record: InteractionRoutingEvidenceRecordV1 | undefined
    try {
      record = this.domain.table('receipts').get(id)
    } catch (error) {
      throw this.makeUnavailable('Interaction Routing evidence read failed', error)
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
          'Interaction Routing evidence read failed after quota pruning',
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
        kind: 'interaction-routing-fact-v1',
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
        routing: record.receipt.routing,
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
          'Interaction Routing evidence authority failure and domain close both failed',
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
      return new Error('Interaction Routing evidence authority is unavailable', {
        cause: this.unavailableError,
      })
    }
    const unavailable = new Error(message, { cause })
    this.unavailableError = unavailable
    return unavailable
  }

  private async persistConflict(
    table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
    record: Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'conflict' }>,
  ): Promise<void> {
    try {
      await table.put(record.id, record)
    } catch (error) {
      let durable: InteractionRoutingEvidenceRecordV1 | undefined
      try {
        durable = table.get(record.id)
      } catch (readbackError) {
        const unavailable = new AggregateError(
          [error, readbackError],
          `Interaction Routing evidence '${record.id}' conflict tombstone put and readback failed`,
        )
        this.unavailableError = unavailable
        throw unavailable
      }
      if (isDeepStrictEqual(durable, record)) return
      const message = `Interaction Routing evidence '${record.id}' conflict tombstone was not committed`
      // Install the fail-closed state before inspecting a hostile rejection.
      // Diagnostics are secondary and must never reopen this authority.
      const unavailable = new Error(message, { cause: error })
      this.unavailableError = unavailable
      unavailable.message = `${message}: ${errorMessage(error)}`
      throw unavailable
    }
  }

  private async persistResolved(
    table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
    record: Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'resolved' }>,
  ): Promise<void> {
    try {
      await table.put(record.id, record)
    } catch (error) {
      let durable: InteractionRoutingEvidenceRecordV1 | undefined
      try {
        durable = table.get(record.id)
      } catch (readbackError) {
        const unavailable = new AggregateError(
          [error, readbackError],
          `Interaction Routing evidence '${record.id}' resolved put and readback failed`,
        )
        this.unavailableError = unavailable
        throw unavailable
      }
      if (durable === undefined) throw error
      if (isDeepStrictEqual(durable, record)) return
      const unavailable = new Error(
        `Interaction Routing evidence '${record.id}' resolved row has an uncertain durable state`,
        { cause: error },
      )
      this.unavailableError = unavailable
      throw unavailable
    }
  }
}

/**
 * Validate one owned Tool observation against the exact trigger-control
 * projection and reduce it to a frozen, raw-free receipt before any async write.
 */
export function createInteractionRoutingEvidenceReceiptV1(
  input: CreateInteractionRoutingEvidenceReceiptInputV1,
): InteractionRoutingEvidenceReceiptV1 {
  const snapshot = snapshotJsonValue(input)
  const values = exactOwnData(snapshot, [
    'workspaceId',
    'subject',
    'derived',
    'authorityEpoch',
    'registrationEpoch',
    'executionEpoch',
    'lifecycleCutoff',
    'bodyValue',
    'finalResult',
  ])
  if (values === undefined
    || !hasExactKeys(values, [
      'workspaceId',
      'subject',
      'derived',
      'authorityEpoch',
      'registrationEpoch',
      'executionEpoch',
      'lifecycleCutoff',
      'bodyValue',
      'finalResult',
    ])) {
    throw new Error('invalid Interaction Routing receipt input')
  }
  const normalized = normalizeEvidenceQuery(
    values.subject as unknown as InteractionRoutingEvidenceSubjectV1,
    values.derived as unknown as InteractionRoutingEvidenceDerivedV1,
  )
  requireEligibleRouting(normalized)
  const lifecycleCutoff = safeNonNegativeInteger(values.lifecycleCutoff)
  if (lifecycleCutoff === undefined || lifecycleCutoff > normalized.subject.turnStartSeq) {
    throw new Error('invalid Interaction Routing lifecycle cutoff')
  }
  const authorityEpoch = boundedEpoch(values.authorityEpoch, 'authority')
  const registrationEpoch = boundedEpoch(values.registrationEpoch, 'registration')
  const executionEpoch = boundedEpoch(values.executionEpoch, 'execution')
  const outcome = normalizeSuccessfulOutcome(values.bodyValue, values.finalResult)

  return immutableCopy(receiptSchema.parse({
    schemaVersion: 1,
    kind: 'interaction-routing-evidence-receipt-v1',
    observedAt: normalized.observedAt,
    sourceDialect: normalized.sourceDialect,
    workspaceId: values.workspaceId,
    subject: normalized.subject,
    routing: {
      rawTrigger: 'successful-gap-report',
      conclusion: 'model-declared-no-applicable-skill',
    },
    provenance: {
      authorityEpochDigest: epochDigest('authority', authorityEpoch),
      registrationEpochDigest: epochDigest('registration', registrationEpoch),
      executionEpochDigest: epochDigest('execution', executionEpoch),
      lifecycleCutoffDigest: hashLifecycleCutoff(lifecycleCutoff),
      bodyValueDigest: hashCanonical({
        domain: 'evoforge_interaction_routing_body_value',
        version: 1,
        value: outcome.bodyValue,
      }),
      finalResultDigest: hashCanonical({
        domain: 'evoforge_interaction_routing_final_result',
        version: 1,
        result: outcome.finalResult,
      }),
      toolContractDigest: routingToolContractDigest(),
    },
  }))
}

/** @internal Opened and closed by the dsh-evolve plugin lifecycle. */
export async function openInteractionRoutingEvidenceVault(
  facility: DomainFacility,
  options: InteractionRoutingEvidenceVaultOptions = {},
): Promise<InteractionRoutingEvidenceVaultV1> {
  const authority = options.authority ?? compileInteractionRoutingEvidencePolicies()
  if (!compiledPolicyAuthorities.has(authority)) {
    throw new Error('Interaction Routing evidence policy authority was not compiled from Host config')
  }
  const domain = await facility.open(evidenceDomainSpec)
  try {
    const audit = auditEvidence(domain)
    if (domain.table('receipts').size > INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS) {
      throw new Error('Interaction Routing evidence exceeds the 100000-record aggregate safety cap')
    }
    await pruneAuthorizedResolved(domain.table('receipts'), authority)
    return new DomainInteractionRoutingEvidenceVault(
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
        'Interaction Routing evidence audit and domain cleanup both failed',
      )
    }
    throw auditError
  }
}

/** @internal Narrow mutable facade passed only to the owned Routing witness. */
export function createInteractionRoutingEvidenceSink(
  vault: Pick<InteractionRoutingEvidenceVaultV1, 'allows' | 'retain' | 'recordConflict' | 'drain'>,
): InteractionRoutingEvidenceSinkV1 {
  return Object.freeze({
    allows: (workspaceId: string) => vault.allows(workspaceId),
    retain: (receipt: InteractionRoutingEvidenceReceiptV1) => vault.retain(receipt),
    recordConflict: (input: InteractionRoutingEvidenceConflictInputV1) =>
      vault.recordConflict(input),
    drain: () => vault.drain(),
  })
}

/** @internal Narrow read facade passed only to trusted Host evidence composition. */
export function createInteractionRoutingEvidenceSource(
  vault: Pick<InteractionRoutingEvidenceVaultV1, 'resolveRoutingEvidence'>,
): InteractionRoutingEvidenceSourceV1 {
  return Object.freeze({
    resolveRoutingEvidence: (
      subject: InteractionRoutingEvidenceSubjectV1,
      derived: InteractionRoutingEvidenceDerivedV1,
    ) => vault.resolveRoutingEvidence(subject, derived),
  })
}

/**
 * Canonical lifecycle binding shared by the vault and its trusted consumer.
 * The full Session header is snapshotted without invoking accessors; no raw
 * header value is returned or persisted by this helper.
 */
export function interactionRoutingSessionLifecycleDigest(
  rawSubject: InteractionRoutingEvidenceSubjectV1,
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
    throw new Error('invalid Interaction Routing Session lifecycle subject')
  }
  return hashCanonical({
    domain: 'evoforge_interaction_routing_session_lifecycle',
    version: 1,
    header,
    inheritedEventCount,
  })
}

function normalizeReceipt(
  receipt: InteractionRoutingEvidenceReceiptV1,
): InteractionRoutingEvidenceReceiptV1 {
  return immutableCopy(receiptSchema.parse(snapshotJsonValue(receipt)))
}

function normalizeConflictInput(
  input: InteractionRoutingEvidenceConflictInputV1,
): { readonly workspaceId: string; readonly query: NormalizedEvidenceQuery } {
  const snapshot = snapshotJsonValue(input)
  const values = exactOwnData(snapshot, ['workspaceId', 'subject', 'derived'])
  if (values === undefined
    || !hasExactKeys(values, ['workspaceId', 'subject', 'derived'])) {
    throw new Error('invalid Interaction Routing conflict input')
  }
  return {
    workspaceId: workspaceIdSchema.parse(values.workspaceId),
    query: normalizeEvidenceQuery(
      values.subject as unknown as InteractionRoutingEvidenceSubjectV1,
      values.derived as unknown as InteractionRoutingEvidenceDerivedV1,
    ),
  }
}

function normalizeEvidenceQuery(
  rawSubject: InteractionRoutingEvidenceSubjectV1,
  rawDerived: InteractionRoutingEvidenceDerivedV1,
): NormalizedEvidenceQuery {
  const subject = snapshotJsonValue(rawSubject)
  const derived = snapshotJsonValue(rawDerived)
  const projection = projectInteractionEpisodeTriggerRequestControlV1(
    subject as unknown as InteractionRoutingEvidenceSubjectV1,
  )
  if (projection.status !== 'projected') {
    throw new Error('Interaction Routing evidence subject does not project')
  }
  const derivedValues = exactOwnData(derived, ['triggerRequestControl'])
  if (derivedValues === undefined
    || !hasExactKeys(derivedValues, ['triggerRequestControl'])
    || canonicalJson(derivedValues.triggerRequestControl)
      !== canonicalJson(projection.fact)) {
    throw new Error('Interaction Routing evidence derived control does not match its subject')
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
    throw new Error('invalid Interaction Routing evidence subject coordinates')
  }

  return immutableCopy({
    sourceDialect: projection.fact.sourceDialect,
    observedAt,
    subject: receiptSubjectSchema.parse({
      sessionLifecycleDigest: interactionRoutingSessionLifecycleDigest(
        subject as unknown as InteractionRoutingEvidenceSubjectV1,
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

function requireEligibleRouting(query: NormalizedEvidenceQuery): void {
  if (query.subject.triggerKind !== 'successful-gap-report') {
    throw new Error('Interaction Routing evidence is eligible only for a successful gap report')
  }
}

function transcriptReplayDigest(
  transcript: JsonRecord,
  name: 'prefixDigest' | 'turnDigest',
): string | undefined {
  return exactHash(jsonRecord(transcript.replay)?.[name])
}

function receiptIdentity(
  receipt: InteractionRoutingEvidenceReceiptV1,
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
  receipt: InteractionRoutingEvidenceReceiptV1,
  recordedSeq: number,
): Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'resolved' }> {
  return stampRecord({
    schemaVersion: 1 as const,
    kind: 'interaction-routing-evidence-record-v1' as const,
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
): Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'conflict' }> {
  return stampRecord({
    schemaVersion: 1 as const,
    kind: 'interaction-routing-evidence-record-v1' as const,
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

function auditEvidence(domain: InteractionRoutingEvidenceDomain): {
  readonly conflicts: Set<string>
  readonly highestRecordedSeq: number
} {
  const conflicts = new Set<string>()
  const recordedSequences = new Set<number>()
  let highestRecordedSeq = 0
  for (const [key, raw] of domain.table('receipts').entries()) {
    const record = evidenceRecordSchema.parse(raw)
    if (key !== record.id) {
      throw new Error(`Interaction Routing evidence key '${key}' does not match row id`)
    }
    const { recordDigest: actual, ...content } = record
    const expected = hashCanonical({
      domain: EVIDENCE_DOMAIN,
      version: EVIDENCE_DOMAIN_VERSION,
      record: content,
    })
    if (actual !== expected) {
      throw new Error(`Interaction Routing evidence '${record.id}' failed integrity audit`)
    }
    if (recordedSequences.has(record.recordedSeq)) {
      throw new Error('Interaction Routing evidence insertion sequence is duplicated')
    }
    recordedSequences.add(record.recordedSeq)
    highestRecordedSeq = Math.max(highestRecordedSeq, record.recordedSeq)
    if (record.state === 'conflict') conflicts.add(record.id)
  }
  return { conflicts, highestRecordedSeq }
}

async function pruneWorkspaceResolved(
  table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
  workspaceId: string,
  maxSize: number,
): Promise<void> {
  const resolved = [...table.entries()].filter((entry): entry is [
    string,
    Extract<InteractionRoutingEvidenceRecordV1, { readonly state: 'resolved' }>,
  ] => entry[1].state === 'resolved' && entry[1].workspaceIds[0] === workspaceId)
  const overflow = resolved.length - maxSize
  if (overflow <= 0) return
  const oldest = resolved
    .sort((left, right) =>
      left[1].recordedSeq - right[1].recordedSeq || left[0].localeCompare(right[0]))
    .slice(0, overflow)
  if (oldest.length !== overflow) {
    throw new Error('Interaction Routing evidence retention index is inconsistent')
  }
  for (const [id] of oldest) {
    if (!(await table.delete(id))) {
      throw new Error(`Interaction Routing evidence '${id}' vanished during pruning`)
    }
  }
}

async function pruneAuthorizedResolved(
  table: KvTable<string, InteractionRoutingEvidenceRecordV1>,
  authority: InteractionRoutingEvidencePolicyAuthorityV1,
): Promise<void> {
  const workspaces = new Set<string>()
  for (const [, record] of table.entries()) {
    if (record.state === 'resolved'
      && authority.routingMaxRecords(record.workspaceIds[0]!) !== undefined) {
      workspaces.add(record.workspaceIds[0]!)
    }
  }
  for (const workspaceId of [...workspaces].sort()) {
    await pruneWorkspaceResolved(
      table,
      workspaceId,
      authority.routingMaxRecords(workspaceId)!,
    )
  }
}

function mergeWorkspaceIds(existing: readonly string[], workspaceId: string): string[] {
  return [...new Set([...existing, workspaceId])].sort()
}

type RoutingEpochKind = 'authority' | 'registration' | 'execution'

function epochDigest(kind: RoutingEpochKind, epoch: string): string {
  return hashCanonical({
    domain: `evoforge_interaction_routing_${kind}_epoch`,
    version: 1,
    epoch,
  })
}

function hashLifecycleCutoff(cutoff: number): string {
  return hashCanonical({
    domain: 'evoforge_interaction_routing_lifecycle_cutoff',
    version: 1,
    cutoff,
  })
}

function boundedEpoch(value: unknown, name: RoutingEpochKind): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value) > MAX_EPOCH_BYTES) {
    throw new Error(`invalid Interaction Routing ${name} epoch`)
  }
  return value
}

/**
 * This projection is the v1 evidence contract of the owned Tool declaration.
 * Any semantic change to that declaration must introduce a new evidence
 * contract version rather than silently changing this digest.
 */
/**
 * @internal Single v1 declaration projection shared with the owned producer.
 * It is exported from this module only; the package root must not expose it.
 */
export const INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1 = deepFreeze({
  name: 'report_capability_gap',
  description: 'Report a missing reusable capability after reviewing the complete native Session Skill catalog and confirming no available Skill applies. Propose one kebab-case name. EvoForge records a durable Interaction signal; a native Goal is optional. Goal-linked signals may enter the legacy evidence loop, while a no-Goal signal is recorded and explicitly abstained until independent Interaction evidence exists. It never searches, downloads, or installs external Skills, and never changes the current Session.',
  parameters: {
    name: {
      type: 'string',
      required: true,
      description: 'Proposed kebab-case name for the missing reusable Skill capability.',
    },
  },
  output: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        required: true,
        enum: ['queued', 'already-recorded', 'abstained'],
      },
      gapId: { type: 'string', required: true },
      requestedSkill: { type: 'string', required: true },
      reason: { type: 'string', enum: ['missing-native-goal'] },
    },
  },
  routing: {
    rawTrigger: 'successful-gap-report',
    conclusion: 'model-declared-no-applicable-skill',
  },
} as const)

let fixedRoutingToolContractDigest: string | undefined

function routingToolContractDigest(): string {
  fixedRoutingToolContractDigest ??= hashCanonical({
    domain: 'evoforge_interaction_routing_tool_contract',
    version: 1,
    contract: INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1,
  })
  return fixedRoutingToolContractDigest
}

function normalizeSuccessfulOutcome(
  rawBodyValue: unknown,
  rawFinalResult: unknown,
): { readonly bodyValue: JsonValue; readonly finalResult: JsonRecord } {
  const bodyValue = snapshotJsonValue(rawBodyValue)
  validateCapabilityGapBody(bodyValue)
  const finalSnapshot = snapshotJsonValue(rawFinalResult)
  const finalResult = exactOwnData(finalSnapshot, [
    'isError',
    'value',
    'content',
    'meta',
    'additionalContexts',
    'concludesTurn',
  ])
  if (finalResult === undefined
    || !Object.hasOwn(finalResult, 'isError')
    || !Object.hasOwn(finalResult, 'value')
    || !Object.hasOwn(finalResult, 'content')
    || finalResult.isError !== false
    || !Array.isArray(finalResult.content)
    || (Object.hasOwn(finalResult, 'additionalContexts')
      && !Array.isArray(finalResult.additionalContexts))
    || (Object.hasOwn(finalResult, 'concludesTurn')
      && finalResult.concludesTurn !== true)
    || !isDeepStrictEqual(bodyValue, finalResult.value)) {
    throw new Error('invalid Interaction Routing successful final result')
  }
  return {
    bodyValue,
    finalResult: finalResult as JsonRecord,
  }
}

function validateCapabilityGapBody(value: JsonValue): void {
  const body = jsonRecord(value)
  const status = body?.status
  const required = status === 'abstained'
    ? ['status', 'gapId', 'requestedSkill', 'reason']
    : ['status', 'gapId', 'requestedSkill']
  if (body === undefined
    || (status !== 'queued' && status !== 'already-recorded' && status !== 'abstained')
    || !hasExactKeys(body, required)
    || exactHash(body.gapId) === undefined
    || typeof body.requestedSkill !== 'string'
    || body.requestedSkill.length > 128
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(body.requestedSkill)
    || (status === 'abstained' && body.reason !== 'missing-native-goal')) {
    throw new Error('invalid Interaction Routing Tool body value')
  }
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
): InteractionRoutingEvidenceResolutionV1 {
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

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index])
}

function exactOwnData(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, JsonValue>> | undefined {
  if (!isPlainObject(value)) return undefined
  const allowed = new Set(allowedKeys)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const snapshot: Record<string, JsonValue> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) return undefined
    const descriptor = descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return undefined
    }
    snapshot[key] = descriptor.value as JsonValue
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
