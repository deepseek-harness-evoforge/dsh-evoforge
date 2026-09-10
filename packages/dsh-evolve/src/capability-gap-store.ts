import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { interactionSessionDialectSchema } from './interaction-session-dialect.ts'

const DEFAULT_MAX_RECORDS = 1_000
const CAPABILITY_GAP_DOMAIN = 'evoforge_capability_gaps'
const CAPABILITY_GAP_DOMAIN_VERSION = 1
const CAPABILITY_GAP_QUALIFICATION_DOMAIN =
  'evoforge_capability_gap_authoring_qualifications'
const CAPABILITY_GAP_QUALIFICATION_DOMAIN_VERSION = 1
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
// Frozen digest of INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1. A Tool
// contract change requires a new qualification kind instead of rewriting v1.
export const CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1 =
  'eab73d098b4fc84aeaee5043f851b862f5621b0b58234a6dcb503f2dea46af1d' as const
const completedOwnedGapTurnSubjectSchema = z.strictObject({
  sessionLifecycleDigest: hashSchema,
  prefixDigest: hashSchema,
  turnDigest: hashSchema,
  // Optional only for completed-owned-gap-turn-v2 rows written before the
  // request-control digest became part of the Routing receipt identity.
  loggedControlDigest: hashSchema.optional(),
  turn: safeInteger,
  turnStartSeq: safeInteger,
  turnEndSeq: safeInteger,
  triggerKind: z.literal('successful-gap-report'),
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
      message: 'Capability Gap authoring qualification coordinates are not in strict causal order',
    })
  }
})
const capabilityGapQualificationBindingSchema = z.strictObject({
  gapId: hashSchema,
  gapContentDigest: hashSchema,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  requestedSkill: z.string().min(1).max(128),
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: safeInteger,
  }),
})
const capabilityGapAuthoringQualificationProofSchema = z.strictObject({
  sourceDialect: interactionSessionDialectSchema,
  subject: completedOwnedGapTurnSubjectSchema,
  provenance: z.strictObject({
    authorityEpochDigest: hashSchema,
    registrationEpochDigest: hashSchema,
    executionEpochDigest: hashSchema,
    lifecycleCutoffDigest: hashSchema,
    bodyValueDigest: hashSchema,
    finalResultDigest: hashSchema,
    toolContractDigest: hashSchema,
  }).superRefine((provenance, context) => {
    if (provenance.toolContractDigest !== CAPABILITY_GAP_AUTHORING_TOOL_CONTRACT_DIGEST_V1) {
      context.addIssue({
        code: 'custom',
        path: ['toolContractDigest'],
        message: 'Capability Gap authoring qualification does not match the fixed Tool contract',
      })
    }
  }),
})
const capabilityGapAuthoringQualificationContentSchema =
  capabilityGapAuthoringQualificationProofSchema.safeExtend({
    schemaVersion: z.literal(2),
    kind: z.literal('completed-owned-gap-turn-v2'),
    binding: capabilityGapQualificationBindingSchema,
  })
const capabilityGapAuthoringQualificationSchema =
  capabilityGapAuthoringQualificationContentSchema.safeExtend({
    id: hashSchema,
  }).superRefine((qualification, context) => {
    const { id: _id, ...content } = qualification
    if (qualification.id !== capabilityGapQualificationId(content)) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Capability Gap authoring qualification id is not content-addressed',
      })
    }
  })
const evidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('native-skill-miss'),
    catalog: z.literal('complete'),
    routing: z.literal('requested-skill-absent'),
    providers: z.literal('settled'),
  }),
  z.strictObject({
    kind: z.literal('model-declared-skill-gap'),
    catalog: z.literal('complete'),
    routing: z.literal('model-declared-no-applicable-skill'),
    providers: z.literal('settled'),
  }),
])
const goalSchema = z.strictObject({
  id: z.string().min(1).max(512),
  revision: safeInteger,
  objective: z.string().min(1).max(8_192),
})
const abstentionSchema = z.strictObject({
  reason: z.literal('missing-native-goal'),
})
const capabilityGapInputSchema = z.strictObject({
  observedAt: safeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  requestedSkill: z.string().min(1).max(128),
  catalogHash: hashSchema,
  catalogSize: safeInteger,
  generationId: hashSchema.optional(),
  goal: goalSchema.optional(),
  abstention: abstentionSchema.optional(),
  evidence: evidenceSchema,
})

const gapSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: hashSchema,
  observedAt: safeInteger,
  workspaceId: z.uuid(),
  sessionId: z.string().min(1).max(256),
  requestedSkill: z.string().min(1).max(128),
  catalogHash: hashSchema,
  catalogSize: safeInteger,
  generationId: hashSchema.optional(),
  goal: goalSchema.optional(),
  /**
   * A durable decision that this observation is not eligible for the legacy
   * Goal-qualified authoring loop.  It is optional so schema-version 1 rows
   * written before the conversation-first transition remain readable.
   */
  abstention: abstentionSchema.optional(),
  status: z.literal('confirmed'),
  evidence: evidenceSchema,
})

/** The exact legacy on-disk row. Its strict v1 shape must remain downgrade-readable. */
export type CapabilityGapV1 = z.infer<typeof gapSchema>
/**
 * A caller view joins the legacy row with independently versioned authority.
 * The qualification is never written into the v1 Gap domain.
 */
export type CapabilityGap = CapabilityGapV1 & {
  readonly authoringQualification?: CapabilityGapAuthoringQualification | undefined
}
export type CapabilityGapAuthoringQualification =
  z.infer<typeof capabilityGapAuthoringQualificationSchema>
type StoredCapabilityGapAuthoringQualificationProofV2 =
  z.infer<typeof capabilityGapAuthoringQualificationProofSchema>
export type CapabilityGapAuthoringQualificationProofV2 =
  Omit<StoredCapabilityGapAuthoringQualificationProofV2, 'subject'> & {
    readonly subject:
      & Omit<StoredCapabilityGapAuthoringQualificationProofV2['subject'], 'loggedControlDigest'>
      & { readonly loggedControlDigest: string }
  }
export type CapabilityGapAbstentionReason = 'missing-native-goal'

export interface CapabilityGapInput {
  readonly observedAt: number
  readonly workspaceId: string
  readonly sessionId: string
  readonly requestedSkill: string
  readonly catalogHash: string
  readonly catalogSize: number
  readonly generationId?: string | undefined
  readonly goal?: {
    readonly id: string
    readonly revision: number
    readonly objective: string
  } | undefined
  readonly abstention?: {
    readonly reason: CapabilityGapAbstentionReason
  } | undefined
  readonly evidence: CapabilityGapV1['evidence']
}

export interface CapabilityGapStore {
  record(input: CapabilityGapInput): Promise<{ created: boolean; gap: CapabilityGap }>
  qualifyForAuthoring(
    gapId: string,
    qualification: CapabilityGapAuthoringQualification,
  ): Promise<{ qualified: boolean; gap: CapabilityGap }>
  list(workspaceId?: string): CapabilityGap[]
  close(): Promise<void>
}

const gapDomainSpec = defineDomain({
  name: CAPABILITY_GAP_DOMAIN,
  version: CAPABILITY_GAP_DOMAIN_VERSION,
  tables: {
    gaps: domainTable<string, CapabilityGapV1>(gapSchema),
  },
})

type CapabilityGapDomain = Domain<typeof gapDomainSpec>

const qualificationDomainSpec = defineDomain({
  name: CAPABILITY_GAP_QUALIFICATION_DOMAIN,
  version: CAPABILITY_GAP_QUALIFICATION_DOMAIN_VERSION,
  // This is authoritative eligibility state. A malformed record must make
  // the whole authority unavailable instead of disappearing as absent.
  layout: 'single',
  tables: {
    qualifications: domainTable<string, CapabilityGapAuthoringQualification>(
      capabilityGapAuthoringQualificationSchema,
    ),
  },
})

type CapabilityGapQualificationDomain = Domain<typeof qualificationDomainSpec>

class DomainCapabilityGapStore implements CapabilityGapStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: CapabilityGapDomain
  private readonly qualifications: CapabilityGapQualificationDomain
  private readonly maxRecords: number

  constructor(
    domain: CapabilityGapDomain,
    qualifications: CapabilityGapQualificationDomain,
    maxRecords: number,
  ) {
    this.domain = domain
    this.qualifications = qualifications
    this.maxRecords = maxRecords
  }

  record(input: CapabilityGapInput): Promise<{ created: boolean; gap: CapabilityGap }> {
    let captured: CapabilityGapInput
    try {
      captured = normalizeCapabilityGapInput(
        capabilityGapInputSchema.parse(structuredClone(input)),
      )
    } catch (error) {
      return Promise.reject(error)
    }
    return this.enqueue(async () => {
      const id = gapId(captured)
      const table = this.domain.table('gaps')
      const existing = table.get(id)
      if (existing !== undefined) {
        await pruneCapabilityGapRecords(this.domain, this.qualifications, this.maxRecords)
        const retained = table.get(id)
        if (retained === undefined) {
          throw new Error(`Capability Gap '${id}' expired during retention reconciliation`)
        }
        return { created: false, gap: capabilityGapView(retained, this.qualifications) }
      }
      const gap = immutableCopy(gapSchema.parse({
        schemaVersion: 1,
        id,
        ...captured,
        status: 'confirmed',
      }))
      await table.put(id, gap)
      await pruneCapabilityGapRecords(this.domain, this.qualifications, this.maxRecords)
      const retained = table.get(id)
      if (retained === undefined) {
        throw new Error(`Capability Gap '${id}' expired during retention reconciliation`)
      }
      return { created: true, gap: capabilityGapView(retained, this.qualifications) }
    })
  }

  qualifyForAuthoring(
    gapId: string,
    qualification: CapabilityGapAuthoringQualification,
  ): Promise<{ qualified: boolean; gap: CapabilityGap }> {
    let captured: CapabilityGapAuthoringQualification
    try {
      captured = capabilityGapAuthoringQualificationSchema.parse(structuredClone(qualification))
    } catch (error) {
      return Promise.reject(error)
    }
    if (captured.subject.loggedControlDigest === undefined) {
      return Promise.reject(new Error(
        'Capability Gap authoring qualification requires a logged control digest',
      ))
    }
    return this.enqueue(async () => {
      if (!hashSchema.safeParse(gapId).success) {
        throw new Error('Capability Gap authoring qualification requires an exact Gap id')
      }
      await pruneCapabilityGapRecords(this.domain, this.qualifications, this.maxRecords)
      const table = this.domain.table('gaps')
      const existing = table.get(gapId)
      if (existing === undefined) {
        throw new Error(`Capability Gap '${gapId}' is unavailable for authoring qualification`)
      }
      assertGapIdentity(existing, gapId)
      if (existing.evidence.kind !== 'model-declared-skill-gap'
        || existing.goal === undefined
        || existing.abstention !== undefined) {
        throw new Error('Capability Gap is not eligible for authoring qualification')
      }
      if (!qualificationExactlyBindsGap(captured, existing)) {
        throw new Error('Capability Gap authoring qualification does not exactly bind its Gap row')
      }
      const qualifications = this.qualifications.table('qualifications')
      const durable = qualifications.get(gapId)
      if (durable !== undefined) {
        if (canonicalJson(durable) !== canonicalJson(captured)) {
          throw new Error(`Capability Gap '${gapId}' conflicts with its durable authoring qualification`)
        }
        return { qualified: false, gap: qualifiedCapabilityGapView(existing, durable) }
      }
      await qualifications.put(gapId, captured)
      return { qualified: true, gap: qualifiedCapabilityGapView(existing, captured) }
    })
  }

  list(workspaceId?: string): CapabilityGap[] {
    const gaps = this.domain.table('gaps')
    if (gaps.size > this.maxRecords) {
      throw new Error('Capability Gap retention reconciliation is incomplete')
    }
    return [...gaps.entries()]
      .map(([key, gap]) => {
        assertGapIdentity(gap, key)
        return gap
      })
      .filter(gap => workspaceId === undefined || gap.workspaceId === workspaceId)
      .sort((left, right) => right.observedAt - left.observedAt || left.id.localeCompare(right.id))
      .map(gap => capabilityGapView(gap, this.qualifications))
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => closeCapabilityGapDomains(
      [this.qualifications, this.domain],
      'Capability Gap store close failed',
    ))
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('capability gap store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

export async function openCapabilityGapStore(
  facility: DomainFacility,
  options: { maxRecords?: number } = {},
): Promise<CapabilityGapStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('capability gap maxRecords must be a positive integer')
  }
  const domain = await facility.open(gapDomainSpec)
  let qualifications: CapabilityGapQualificationDomain | undefined
  try {
    qualifications = await facility.open(qualificationDomainSpec)
    auditCapabilityGapAuthority(domain, qualifications)
    await pruneCapabilityGapRecords(domain, qualifications, maxRecords)
    return new DomainCapabilityGapStore(domain, qualifications, maxRecords)
  } catch (openError) {
    const opened = qualifications === undefined ? [domain] : [qualifications, domain]
    try {
      await closeCapabilityGapDomains(opened, 'Capability Gap failed-open cleanup failed')
    } catch (closeError) {
      throw new AggregateError(
        [openError, closeError],
        'Capability Gap open audit and domain cleanup both failed',
      )
    }
    throw openError
  }
}

/** Bind one completed-turn proof to the exact immutable Gap row it qualifies. */
export function createCapabilityGapAuthoringQualificationV2(
  gap: CapabilityGap,
  proof: CapabilityGapAuthoringQualificationProofV2,
): CapabilityGapAuthoringQualification {
  const base = baseGapOf(gap)
  assertGapIdentity(base, base.id)
  if (base.evidence.kind !== 'model-declared-skill-gap'
    || base.goal === undefined
    || base.abstention !== undefined) {
    throw new Error('Capability Gap is not eligible for authoring qualification')
  }
  const capturedProof = capabilityGapAuthoringQualificationProofSchema.parse(
    structuredClone(proof),
  )
  if (capturedProof.subject.loggedControlDigest === undefined) {
    throw new Error('Capability Gap authoring qualification requires a logged control digest')
  }
  const content = capabilityGapAuthoringQualificationContentSchema.parse({
    schemaVersion: 2,
    kind: 'completed-owned-gap-turn-v2',
    binding: capabilityGapBinding(base),
    ...capturedProof,
  })
  return immutableCopy(capabilityGapAuthoringQualificationSchema.parse({
    ...content,
    id: capabilityGapQualificationId(content),
  }))
}

/** Compute the immutable legacy Gap identity without changing its v1 row shape. */
export function capabilityGapIdV1(input: CapabilityGapInput): string {
  return gapId(normalizeCapabilityGapInput(
    capabilityGapInputSchema.parse(structuredClone(input)),
  ))
}

export function isCapabilityGapQualifiedForAuthoring(
  gap: CapabilityGap,
): gap is CapabilityGap & {
  readonly goal: NonNullable<CapabilityGap['goal']>
  readonly authoringQualification: CapabilityGapAuthoringQualification
} {
  try {
    const base = baseGapOf(gap)
    assertGapIdentity(base, base.id)
    if (base.evidence.kind !== 'model-declared-skill-gap'
      || base.goal === undefined
      || base.abstention !== undefined
      || gap.authoringQualification === undefined) return false
    const qualification = capabilityGapAuthoringQualificationSchema.parse(
      gap.authoringQualification,
    )
    return qualification.subject.loggedControlDigest !== undefined
      && qualificationExactlyBindsGap(qualification, base)
  } catch {
    return false
  }
}

function gapId(input: Pick<
  CapabilityGapInput,
  'workspaceId' | 'sessionId' | 'requestedSkill' | 'catalogHash' | 'generationId' | 'goal'
>): string {
  return createHash('sha256').update(JSON.stringify([
    input.workspaceId,
    input.sessionId,
    input.requestedSkill,
    input.catalogHash,
    input.generationId ?? null,
    input.goal?.id ?? null,
    input.goal?.revision ?? null,
  ])).digest('hex')
}

function normalizeCapabilityGapInput(input: CapabilityGapInput): CapabilityGapInput {
  return {
    observedAt: input.observedAt,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    requestedSkill: input.requestedSkill,
    catalogHash: input.catalogHash,
    catalogSize: input.catalogSize,
    ...(input.generationId === undefined ? {} : { generationId: input.generationId }),
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    ...(input.abstention === undefined ? {} : { abstention: input.abstention }),
    evidence: input.evidence,
  }
}

function capabilityGapBinding(gap: CapabilityGapV1) {
  if (gap.goal === undefined) {
    throw new Error('Capability Gap authoring qualification requires an exact Goal')
  }
  return capabilityGapQualificationBindingSchema.parse({
    gapId: gap.id,
    gapContentDigest: capabilityGapContentDigest(gap),
    workspaceId: gap.workspaceId,
    sessionId: gap.sessionId,
    requestedSkill: gap.requestedSkill,
    goal: { id: gap.goal.id, revision: gap.goal.revision },
  })
}

function capabilityGapContentDigest(gap: CapabilityGapV1): string {
  return createHash('sha256').update(canonicalJson({
    domain: CAPABILITY_GAP_DOMAIN,
    version: CAPABILITY_GAP_DOMAIN_VERSION,
    row: gap,
  })).digest('hex')
}

function capabilityGapQualificationId(
  content: z.infer<typeof capabilityGapAuthoringQualificationContentSchema>,
): string {
  return createHash('sha256').update(canonicalJson({
    domain: CAPABILITY_GAP_QUALIFICATION_DOMAIN,
    version: CAPABILITY_GAP_QUALIFICATION_DOMAIN_VERSION,
    content,
  })).digest('hex')
}

function qualificationExactlyBindsGap(
  qualification: CapabilityGapAuthoringQualification,
  gap: CapabilityGapV1,
): boolean {
  if (gap.evidence.kind !== 'model-declared-skill-gap'
    || gap.goal === undefined
    || gap.abstention !== undefined) return false
  const binding = qualification.binding
  return binding.gapId === gap.id
    && binding.gapContentDigest === capabilityGapContentDigest(gap)
    && binding.workspaceId === gap.workspaceId
    && binding.sessionId === gap.sessionId
    && binding.requestedSkill === gap.requestedSkill
    && binding.goal.id === gap.goal.id
    && binding.goal.revision === gap.goal.revision
}

function capabilityGapView(
  gap: CapabilityGapV1,
  qualifications: CapabilityGapQualificationDomain,
): CapabilityGap {
  assertGapIdentity(gap, gap.id)
  const qualification = qualifications.table('qualifications').get(gap.id)
  if (qualification === undefined) return immutableCopy(gap)
  return qualifiedCapabilityGapView(gap, qualification)
}

function qualifiedCapabilityGapView(
  gap: CapabilityGapV1,
  qualification: CapabilityGapAuthoringQualification,
): CapabilityGap {
  const parsed = capabilityGapAuthoringQualificationSchema.parse(qualification)
  if (!qualificationExactlyBindsGap(parsed, gap)) {
    throw new Error(`Capability Gap qualification '${parsed.id}' does not exactly bind Gap '${gap.id}'`)
  }
  return immutableCopy({ ...gap, authoringQualification: parsed })
}

function baseGapOf(gap: CapabilityGap): CapabilityGapV1 {
  const { authoringQualification: _qualification, ...base } = gap
  return gapSchema.parse(base)
}

function auditCapabilityGapAuthority(
  domain: CapabilityGapDomain,
  qualifications: CapabilityGapQualificationDomain,
): void {
  const gaps = domain.table('gaps')
  for (const [key, gap] of gaps.entries()) assertGapIdentity(gap, key)

  for (const [key, qualification] of qualifications.table('qualifications').entries()) {
    if (key !== qualification.binding.gapId) {
      throw new Error(
        `Capability Gap qualification table key '${key}' does not match binding Gap id '${qualification.binding.gapId}'`,
      )
    }
    const { id: _id, ...content } = qualification
    if (qualification.id !== capabilityGapQualificationId(content)) {
      throw new Error(`Capability Gap qualification '${qualification.id}' failed content-address audit`)
    }
    const gap = gaps.get(key)
    if (gap === undefined) {
      throw new Error(`Capability Gap qualification '${qualification.id}' references missing Gap '${key}'`)
    }
    if (!qualificationExactlyBindsGap(qualification, gap)) {
      throw new Error(`Capability Gap qualification '${qualification.id}' does not exactly bind Gap '${key}'`)
    }
  }
}

async function pruneCapabilityGapRecords(
  domain: CapabilityGapDomain,
  qualifications: CapabilityGapQualificationDomain,
  maxRecords: number,
): Promise<void> {
  const gaps = domain.table('gaps')
  if (gaps.size <= maxRecords) return
  const expired = [...gaps.entries()]
    .sort((left, right) => left[1].observedAt - right[1].observedAt
      || left[0].localeCompare(right[0]))
    .slice(0, gaps.size - maxRecords)
  for (const [expiredId] of expired) {
    // Authority must disappear first. If the following Gap delete fails, the
    // safe crash state is an unqualified retained Gap. Duplicate record and
    // reopen both retry this reconciliation so that state cannot strand.
    await qualifications.table('qualifications').delete(expiredId)
    await gaps.delete(expiredId)
  }
}

function assertGapIdentity(gap: CapabilityGapV1, key: string): void {
  if (key !== gap.id) {
    throw new Error(`Capability Gap table key '${key}' does not match row id '${gap.id}'`)
  }
  if (gap.id !== gapId(gap)) {
    throw new Error(`Capability Gap '${gap.id}' failed content-address audit`)
  }
}

async function closeCapabilityGapDomains(
  domains: readonly { close(): Promise<void> }[],
  message: string,
): Promise<void> {
  const settled = await Promise.allSettled(domains.map(domain => domain.close()))
  const errors = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length > 0) throw new AggregateError(errors, message)
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

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number is not canonical JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
}
