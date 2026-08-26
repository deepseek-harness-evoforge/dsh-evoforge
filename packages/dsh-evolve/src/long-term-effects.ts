import { createHash } from 'node:crypto'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { EvolutionStore } from './generation-store.ts'

/**
 * Long-term facts are deliberately explicit.  Temporal proximity to a
 * promotion is not enough to label a regression, a duplicate side effect, or
 * a recovery.  Adapters and evaluators must record the fact they actually
 * observed and the evidence that supports it.
 */
export type LongTermFactInput =
  | {
      readonly kind: 'promotion-review'
      readonly workspaceId: string
      readonly observedAt: number
      readonly promotionEventId: string
      readonly generationId: string
      readonly verdict: 'false-promotion' | 'retained' | 'unknown'
      readonly evidenceId: string
    }
  | {
      readonly kind: 'paired-comparison'
      readonly workspaceId: string
      readonly observedAt: number
      readonly caseId: string
      readonly generationId: string
      readonly baselineGenerationId: string
      readonly comparisonKind: 'forgetting' | 'negative-transfer'
      readonly priorCandidateStatus: 'passed' | 'failed' | 'unknown'
      readonly baselineStatus: 'passed' | 'failed' | 'unknown'
      readonly candidateStatus: 'passed' | 'failed' | 'unknown'
      readonly exactPair: boolean
      readonly evidenceId: string
    }
  | {
      readonly kind: 'external-effect'
      readonly workspaceId: string
      readonly observedAt: number
      readonly adapter: 'dsh-gateway' | 'dsh-feishu' | 'other'
      readonly operationKeyHash: string
      readonly idempotencyKeyHash: string
      readonly result: 'applied' | 'duplicate' | 'unknown'
      readonly duplicateOfFactId?: string | undefined
      readonly evidenceId: string
    }
  | {
      readonly kind: 'recovery'
      readonly workspaceId: string
      readonly observedAt: number
      readonly trigger: 'crash' | 'restart'
      readonly result: 'recovered' | 'failed' | 'unknown'
      readonly generationId?: string | undefined
      readonly evidenceId: string
    }

export type LongTermFact = LongTermFactInput & {
  readonly schemaVersion: 1
  readonly id: string
}

export interface LongTermEffectsStore {
  record(input: LongTermFactInput): Promise<{ readonly created: boolean; readonly fact: LongTermFact }>
  list(workspaceId?: string): LongTermFact[]
  close(): Promise<void>
}

const nonNegativeInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const idSchema = z.string().min(1).max(512)
const factContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('promotion-review'),
    workspaceId: z.uuid(),
    observedAt: nonNegativeInt,
    promotionEventId: idSchema,
    generationId: idSchema,
    verdict: z.enum(['false-promotion', 'retained', 'unknown']),
    evidenceId: idSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('paired-comparison'),
    workspaceId: z.uuid(),
    observedAt: nonNegativeInt,
    caseId: idSchema,
    generationId: idSchema,
    baselineGenerationId: idSchema,
    comparisonKind: z.enum(['forgetting', 'negative-transfer']),
    priorCandidateStatus: z.enum(['passed', 'failed', 'unknown']),
    baselineStatus: z.enum(['passed', 'failed', 'unknown']),
    candidateStatus: z.enum(['passed', 'failed', 'unknown']),
    exactPair: z.boolean(),
    evidenceId: idSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('external-effect'),
    workspaceId: z.uuid(),
    observedAt: nonNegativeInt,
    adapter: z.enum(['dsh-gateway', 'dsh-feishu', 'other']),
    operationKeyHash: idSchema,
    idempotencyKeyHash: idSchema,
    result: z.enum(['applied', 'duplicate', 'unknown']),
    duplicateOfFactId: idSchema.optional(),
    evidenceId: idSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal('recovery'),
    workspaceId: z.uuid(),
    observedAt: nonNegativeInt,
    trigger: z.enum(['crash', 'restart']),
    result: z.enum(['recovered', 'failed', 'unknown']),
    generationId: idSchema.optional(),
    evidenceId: idSchema,
  }),
])
const factSchema = factContentSchema.and(z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/) }))

const longTermEffectsDomainSpec = defineDomain({
  name: 'evoforge_long_term_effects',
  version: 1,
  tables: {
    facts: domainTable<string, LongTermFact>(factSchema),
  },
})

type LongTermEffectsDomain = Domain<typeof longTermEffectsDomainSpec>

export async function openLongTermEffectsStore(
  facility: DomainFacility,
  options: { readonly maxRecords?: number } = {},
): Promise<LongTermEffectsStore> {
  const domain = await facility.open(longTermEffectsDomainSpec)
  return new DomainLongTermEffectsStore(domain, options.maxRecords ?? 5_000)
}

class DomainLongTermEffectsStore implements LongTermEffectsStore {
  private readonly domain: LongTermEffectsDomain
  private readonly maxRecords: number
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>

  constructor(domain: LongTermEffectsDomain, maxRecords: number) {
    this.domain = domain
    this.maxRecords = maxRecords
  }

  record(input: LongTermFactInput): Promise<{ readonly created: boolean; readonly fact: LongTermFact }> {
    if (this.closing !== undefined) return Promise.reject(new Error('Long-term effects store is closing'))
    const result = this.writeTail.then(async () => {
      const content = factContentSchema.parse({ schemaVersion: 1, ...input })
      const id = sha256(canonicalJson(content))
      const table = this.domain.table('facts')
      const existing = table.get(id)
      if (existing !== undefined) {
        if (canonicalJson(existing) !== canonicalJson({ ...content, id })) {
          throw new Error('long-term fact identity changed')
        }
        return { created: false, fact: immutableCopy(existing) }
      }
      const fact = immutableCopy(factSchema.parse({ ...content, id }))
      await table.put(id, fact)
      if (table.size > this.maxRecords) {
        const oldest = [...table.entries()]
          .sort((left, right) => left[1].observedAt - right[1].observedAt || left[0].localeCompare(right[0]))[0]
        if (oldest !== undefined) await table.delete(oldest[0])
      }
      return { created: true, fact }
    })
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  list(workspaceId?: string): LongTermFact[] {
    return [...this.domain.table('facts').entries()]
      .map(([, fact]) => fact)
      .filter(fact => workspaceId === undefined || fact.workspaceId === workspaceId)
      .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }
}

export type LongTermMetricStatus = 'measured' | 'insufficient-sample' | 'not-measured' | 'unknown'

export interface LongTermMetricView {
  readonly status: LongTermMetricStatus
  readonly observed: number
  readonly denominator: number
  readonly count: number
  readonly rate?: number
  readonly reason:
    | 'explicit-facts'
    | 'below-minimum-sample'
    | 'no-authoritative-facts'
    | 'only-unknown-facts'
}

export interface LongTermEffectsSummary {
  readonly schemaVersion: 1
  readonly workspaceId: string
  readonly metrics: {
    readonly falsePromotion: LongTermMetricView
    readonly forgetting: LongTermMetricView
    readonly negativeTransfer: LongTermMetricView
    readonly duplicateExternalEffect: LongTermMetricView
    readonly recovery: LongTermMetricView
    readonly rollback: LongTermMetricView
  }
  readonly sourceFacts: {
    readonly total: number
    readonly promotionReviews: number
    readonly pairedComparisons: number
    readonly externalEffects: number
    readonly recoveryEvents: number
    readonly unknownFacts: number
    readonly deliveryOutcomes: number
  }
  readonly evidence: {
    readonly source: 'explicit-long-term-facts-v1'
    readonly causalClaim: 'none'
    readonly releaseAuthority: 'none'
  }
}

export interface LongTermEffectsReader {
  summarize(workspaceId: string): LongTermEffectsSummary
}

/**
 * Projects the durable ledger into the Web/control-plane DTO.  The projector
 * is intentionally read-only; it cannot promote, rollback, or decide release.
 */
export class LongTermEffectsProjection implements LongTermEffectsReader {
  private readonly facts: Pick<LongTermEffectsStore, 'list'>
  private readonly selections: Pick<EvolutionStore, 'listGenerationSelectionEvents'>
  private readonly outcomes: { list(workspaceId?: string): readonly unknown[] } | undefined
  private readonly minSamples: number

  constructor(
    facts: Pick<LongTermEffectsStore, 'list'>,
    selections: Pick<EvolutionStore, 'listGenerationSelectionEvents'>,
    options: { readonly minSamples?: number; readonly outcomes?: { list(workspaceId?: string): readonly unknown[] } } = {},
  ) {
    this.facts = facts
    this.selections = selections
    this.outcomes = options.outcomes
    this.minSamples = Math.max(1, Math.floor(options.minSamples ?? 2))
  }

  summarize(workspaceId: string): LongTermEffectsSummary {
    const facts = this.facts.list(workspaceId)
    const promotionReviews = facts.filter(fact => fact.kind === 'promotion-review')
    const paired = facts.filter(fact => fact.kind === 'paired-comparison')
    const effects = facts.filter(fact => fact.kind === 'external-effect')
    const recovery = facts.filter(fact => fact.kind === 'recovery')
    const selections = this.selections.listGenerationSelectionEvents(workspaceId)
    const rollbacks = selections.filter(event => event.kind === 'rollback')
    const promotions = selections.filter(event => event.kind === 'promotion')
    const promotionIds = new Map(promotions.map(event => [event.id, event]))
    const validPromotionReviews = promotionReviews.filter(fact => {
      const promotion = promotionIds.get(fact.promotionEventId)
      return promotion !== undefined && promotion.activeGenerationId === fact.generationId
    })
    const factsById = new Map(facts.map(fact => [fact.id, fact]))
    const validDuplicateEffects = effects.filter(fact => {
      if (fact.result !== 'duplicate' || fact.duplicateOfFactId === undefined) return false
      const original = factsById.get(fact.duplicateOfFactId)
      return original?.kind === 'external-effect'
        && original.result !== 'unknown'
        && original.operationKeyHash === fact.operationKeyHash
        && original.idempotencyKeyHash === fact.idempotencyKeyHash
    })
    return {
      schemaVersion: 1,
      workspaceId,
      metrics: {
        falsePromotion: metric(
          validPromotionReviews.filter(fact => fact.verdict !== 'unknown').length,
          validPromotionReviews.filter(fact => fact.verdict === 'false-promotion').length,
          validPromotionReviews.length,
          this.minSamples,
        ),
        forgetting: metric(
          paired.filter(fact => fact.comparisonKind === 'forgetting' && fact.exactPair
            && fact.priorCandidateStatus === 'passed' && fact.candidateStatus !== 'unknown').length,
          paired.filter(fact => fact.comparisonKind === 'forgetting' && fact.exactPair
            && fact.priorCandidateStatus === 'passed' && fact.candidateStatus === 'failed').length,
          paired.filter(fact => fact.comparisonKind === 'forgetting').length,
          this.minSamples,
        ),
        negativeTransfer: metric(
          paired.filter(fact => fact.comparisonKind === 'negative-transfer' && fact.exactPair
            && fact.baselineStatus !== 'unknown' && fact.candidateStatus !== 'unknown').length,
          paired.filter(fact => fact.comparisonKind === 'negative-transfer' && fact.exactPair
            && fact.baselineStatus === 'passed' && fact.candidateStatus === 'failed').length,
          paired.filter(fact => fact.comparisonKind === 'negative-transfer').length,
          this.minSamples,
        ),
        duplicateExternalEffect: metric(
          effects.filter(fact => fact.result !== 'unknown').length,
          validDuplicateEffects.length,
          effects.length,
          this.minSamples,
        ),
        recovery: metric(
          recovery.filter(fact => fact.result !== 'unknown').length,
          recovery.filter(fact => fact.result === 'recovered').length,
          recovery.length,
          this.minSamples,
        ),
        rollback: metric(
          promotions.length + rollbacks.length,
          rollbacks.length,
          promotions.length + rollbacks.length,
          this.minSamples,
        ),
      },
      sourceFacts: {
        total: facts.length,
        promotionReviews: promotionReviews.length,
        pairedComparisons: paired.length,
        externalEffects: effects.length,
        recoveryEvents: recovery.length,
        unknownFacts: facts.filter(fact =>
          (fact.kind === 'promotion-review' && fact.verdict === 'unknown')
          || (fact.kind === 'paired-comparison' && (fact.candidateStatus === 'unknown'
            || fact.baselineStatus === 'unknown' || fact.priorCandidateStatus === 'unknown'))
          || (fact.kind === 'external-effect' && fact.result === 'unknown')
          || (fact.kind === 'recovery' && fact.result === 'unknown')).length,
        deliveryOutcomes: this.outcomes?.list(workspaceId).length ?? 0,
      },
      evidence: {
        source: 'explicit-long-term-facts-v1',
        causalClaim: 'none',
        releaseAuthority: 'none',
      },
    }
  }
}

function metric(observed: number, count: number, denominator: number, minSamples: number): LongTermMetricView {
  if (observed === 0 && denominator === 0) {
    return { status: 'not-measured', observed: 0, denominator: 0, count: 0, reason: 'no-authoritative-facts' }
  }
  if (observed === 0) {
    return { status: 'unknown', observed: 0, denominator, count: 0, reason: 'only-unknown-facts' }
  }
  const status = observed < minSamples ? 'insufficient-sample' : 'measured'
  return {
    status,
    observed,
    denominator,
    count,
    rate: count / observed,
    reason: status === 'measured' ? 'explicit-facts' : 'below-minimum-sample',
  }
}

function immutableCopy<T>(value: T): T {
  return structuredClone(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}
