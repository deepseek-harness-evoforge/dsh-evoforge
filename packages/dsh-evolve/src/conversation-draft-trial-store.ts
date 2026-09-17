import { createHash } from 'node:crypto'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { digest } from './conversation-correction-intake.ts'
import { validateDraftGovernance, type ConversationDraftRecord } from './conversation-skill-draft.ts'
import { NATIVE_WORKSPACE_ID_PATTERN } from './workspace-identity.ts'
import type { ConversationDraftTrialSummary } from './control-types.ts'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const MAX_PLANS = 20
const policySchema = z.strictObject({
  workspaceId: z.string().regex(NATIVE_WORKSPACE_ID_PATTERN), maxModelCallsPerUtcDay: z.number().int().min(24).max(72),
})
export type ConversationDraftTrialPolicy = z.infer<typeof policySchema>
export function validateConversationDraftTrialPolicies(policies: readonly ConversationDraftTrialPolicy[]): void {
  z.array(policySchema).max(20).parse(policies)
  if (new Set(policies.map(policy => policy.workspaceId)).size !== policies.length) throw new Error('duplicate trial Workspace')
}

const resultSchema = z.strictObject({
  status: z.enum(['completed', 'incomplete']), answer: z.string().max(32_000), passed: z.boolean(), skillLoaded: z.boolean(),
  elapsedMs: integer, requestCount: z.number().int().min(0).max(3), eventDigest: hash,
  requestDigests: z.array(hash).max(3), firstRequest: z.string().max(128_000).optional(),
  inputTokens: integer, outputTokens: integer, usageMissingCount: z.number().int().min(0).max(3),
  cacheReadTokens: integer.optional(), cacheWriteTokens: integer.optional(),
}).superRefine((result, ctx) => {
  let firstRequestValid = result.requestCount === 0 && result.firstRequest === undefined
  if (result.firstRequest !== undefined) {
    try { firstRequestValid = digest(JSON.parse(result.firstRequest)) === result.requestDigests[0] } catch { firstRequestValid = false }
  }
  if (!firstRequestValid || result.requestCount !== result.requestDigests.length || result.status === 'incomplete' && result.passed
    || result.firstRequest !== undefined && Buffer.byteLength(result.firstRequest) > 128_000) {
    ctx.addIssue({ code: 'custom', message: 'inconsistent native trial result' })
  }
})
export type ConversationDraftTrialResult = z.infer<typeof resultSchema>
const comparisonSchema = z.strictObject({
  baselinePassed: z.number().int().min(0).max(4), draftPassed: z.number().int().min(0).max(4),
  improved: z.number().int().min(0).max(4), regressed: z.number().int().min(0).max(4),
  comparablePairs: z.number().int().min(0).max(4), loadedDraftLegs: z.number().int().min(0).max(4),
  outcome: z.enum(['improvement-observed', 'no-improvement', 'regression', 'inconclusive']),
})
export type ConversationDraftTrialComparison = z.infer<typeof comparisonSchema>
const legSchema = z.strictObject({
  index: z.number().int().min(0).max(7), caseId: z.string().regex(/^[a-z0-9-]{1,64}$/u),
  partition: z.enum(['holdout', 'retention']), inputDigest: hash, variant: z.enum(['baseline', 'draft']),
  sessionId: z.string().min(1).max(128), phase: z.enum(['pending', 'running', 'settled']),
  dispatchMarkers: z.number().int().min(0).max(3), result: resultSchema.optional(),
})
const recordSchema = z.strictObject({
  schemaVersion: z.literal(1), id: hash, draftId: hash, workspaceId: z.string().regex(NATIVE_WORKSPACE_ID_PATTERN),
  draftSnapshotDigest: hash, contentHash: hash, governanceDigest: hash,
  provider: z.string().min(1).max(256), model: z.string().min(1).max(256),
  reservedAt: integer.max(8_640_000_000_000_000), reservedModelCalls: z.literal(24),
  phase: z.enum(['reserved', 'running', 'completed', 'uncertain']), legs: z.array(legSchema).length(8),
  comparison: comparisonSchema.optional(), reason: z.enum(['interrupted', 'cancelled', 'source-conflict', 'execution-failed']).optional(),
}).superRefine((record, ctx) => {
  const pairs = [0, 2, 4, 6].map(index => record.legs.slice(index, index + 2))
  const invalid = record.id !== trialId(record.draftId)
    || record.legs.some((leg, i) => leg.index !== i || leg.sessionId !== legSessionId(record.id, i)
      || (leg.phase === 'settled') !== (leg.result !== undefined)
      || leg.phase === 'pending' && leg.dispatchMarkers !== 0
      || (leg.result?.requestCount ?? 0) > leg.dispatchMarkers)
    || record.legs.filter(leg => leg.phase === 'running').length > 1
    || new Set(pairs.map(pair => pair[0]?.caseId)).size !== 4
    || record.legs.filter(leg => leg.partition === 'holdout').length !== 4
    || pairs.some(pair => pair[0]?.caseId !== pair[1]?.caseId || pair[0]?.inputDigest !== pair[1]?.inputDigest
      || pair[0]?.partition !== pair[1]?.partition || pair[0]?.variant === pair[1]?.variant)
    || record.comparison !== undefined && (
      record.comparison.baselinePassed !== record.legs.filter(leg => leg.variant === 'baseline' && leg.result?.passed).length
      || record.comparison.draftPassed !== record.legs.filter(leg => leg.variant === 'draft' && leg.result?.passed).length
      || record.comparison.loadedDraftLegs !== record.legs.filter(leg => leg.variant === 'draft' && leg.result?.skillLoaded).length)
    || (record.phase === 'completed') !== (record.comparison !== undefined)
    || record.phase === 'completed' && record.legs.some(leg => leg.phase !== 'settled')
    || record.phase === 'reserved' && record.legs.some(leg => leg.phase !== 'pending')
    || (record.phase === 'uncertain') !== (record.reason !== undefined)
  if (invalid) ctx.addIssue({ code: 'custom', message: 'inconsistent conversation trial identity or lifecycle' })
})
export type ConversationDraftTrialRecord = z.infer<typeof recordSchema>
const spec = defineDomain({ name: 'evoforge_conversation_draft_trials', version: 1, layout: 'single',
  tables: { records: domainTable<string, ConversationDraftTrialRecord>(recordSchema) } })
function trialId(draftId: string): string { return digest({ kind: 'conversation-draft-paired-v1', draftId }) }
function legSessionId(id: string, index: number): string { return `evoforge-trial-${id}-${index}` }
function day(time: number): string { return new Date(time).toISOString().slice(0, 10) }

/** Private one-shot plan and results. Native Sessions remain the execution log authority. */
export class ConversationDraftTrialStore {
  private tail: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | undefined
  private failed = false
  private available = false
  private readonly warnings = new Map<string, number>()
  constructor(private readonly domain: Domain<typeof spec>, private readonly policies: readonly ConversationDraftTrialPolicy[],
    private readonly now: () => number) {}
  setAvailable(value: boolean): void { this.available = value }
  warn(workspaceId: string): void { this.warnings.set(workspaceId, (this.warnings.get(workspaceId) ?? 0) + 1) }
  policy(workspaceId: string): ConversationDraftTrialPolicy | undefined { return this.policies.find(policy => policy.workspaceId === workspaceId) }
  records(workspaceId: string): ConversationDraftTrialRecord[] {
    if (this.failed) return []
    return [...this.domain.table('records').entries()].map(([, record]) => record)
      .filter(record => record.workspaceId === workspaceId).map(record => structuredClone(record))
  }
  reserve(source: ConversationDraftRecord, route: { provider: string; model: string }): Promise<ConversationDraftTrialRecord | undefined> {
    return this.enqueue(async () => {
      const policy = this.policy(source.workspaceId)
      if (policy === undefined) return undefined
      if (source.phase !== 'draft' || source.draft === undefined || source.governance === undefined
        || digest(source.governance) !== source.governanceDigest
        || createHash('sha256').update(source.draft.markdown).digest('hex') !== source.draft.contentHash) {
        throw new Error('conversation trial requires an intact sealed draft')
      }
      validateDraftGovernance(source.governance)
      const table = this.domain.table('records'), id = trialId(source.id), reservedAt = this.now()
      if (table.get(id) !== undefined || table.size >= MAX_PLANS) return undefined
      const used = this.records(source.workspaceId).filter(record => day(record.reservedAt) === day(reservedAt))
        .reduce((sum, record) => sum + record.reservedModelCalls, 0)
      if (used + 24 > policy.maxModelCallsPerUtcDay) return undefined
      const legs = source.governance.cases.flatMap((test, caseIndex) => {
        const variants = caseIndex % 2 === 0 ? ['baseline', 'draft'] as const : ['draft', 'baseline'] as const
        return variants.map((variant, offset) => ({ index: caseIndex * 2 + offset, caseId: test.id,
          partition: test.partition, inputDigest: digest(test.input), variant,
          sessionId: legSessionId(id, caseIndex * 2 + offset), phase: 'pending' as const, dispatchMarkers: 0 }))
      })
      const record = recordSchema.parse({ schemaVersion: 1, id, draftId: source.id, workspaceId: source.workspaceId,
        draftSnapshotDigest: digest(source), contentHash: source.draft.contentHash, governanceDigest: source.governanceDigest,
        provider: route.provider, model: route.model, reservedAt, reservedModelCalls: 24, phase: 'reserved', legs })
      await this.put(record)
      return structuredClone(record)
    })
  }
  startLeg(record: ConversationDraftTrialRecord, index: number): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const leg = current.legs[index]
      if (!leg || !['reserved', 'running'].includes(current.phase) || leg.phase !== 'pending'
        || current.legs.slice(0, index).some(previous => previous.phase !== 'settled')) throw new Error('trial leg cannot start')
      leg.phase = 'running'
      current.phase = 'running'
    })
  }
  markDispatch(record: ConversationDraftTrialRecord, index: number, call: number): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const leg = current.legs[index]
      if (current.phase !== 'running' || leg?.phase !== 'running' || call !== leg.dispatchMarkers + 1 || call > 3) {
        throw new Error('trial dispatch marker is not contiguous')
      }
      leg.dispatchMarkers = call
    })
  }
  finishLeg(record: ConversationDraftTrialRecord, index: number, result: ConversationDraftTrialResult): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const leg = current.legs[index]
      if (current.phase !== 'running' || leg?.phase !== 'running') throw new Error('trial leg is not running')
      leg.result = resultSchema.parse(result)
      leg.phase = 'settled'
    })
  }
  finish(record: ConversationDraftTrialRecord, comparison: ConversationDraftTrialComparison): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      if (current.phase !== 'running' || current.legs.some(leg => leg.phase !== 'settled')) throw new Error('trial legs are incomplete')
      current.comparison = comparisonSchema.parse(comparison)
      current.phase = 'completed'
    })
  }
  interrupt(record: ConversationDraftTrialRecord, reason: NonNullable<ConversationDraftTrialRecord['reason']>): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      if (!['reserved', 'running'].includes(current.phase)) throw new Error('trial already terminal')
      current.phase = 'uncertain'
      current.reason = reason
    })
  }
  summarize(workspaceId: string): ConversationDraftTrialSummary {
    const records = this.records(workspaceId), policy = this.policy(workspaceId)
    return { enabled: policy !== undefined, observerAvailable: this.available && !this.failed,
      warningCount: (this.warnings.get(workspaceId) ?? 0) + (this.failed ? 1 : 0),
      pendingCount: records.filter(record => ['reserved', 'running'].includes(record.phase)).length,
      uncertainCount: records.filter(record => record.phase === 'uncertain').length,
      reservedModelCallsToday: records.filter(record => day(record.reservedAt) === day(this.now())).reduce((n, record) => n + record.reservedModelCalls, 0),
      maxModelCallsPerUtcDay: policy?.maxModelCallsPerUtcDay ?? 0,
      items: records.slice(-5).reverse().map(record => ({ id: record.id, draftId: record.draftId, phase: record.phase,
        settledLegs: record.legs.filter(leg => leg.phase === 'settled').length,
        dispatchMarkers: record.legs.reduce((n, leg) => n + leg.dispatchMarkers, 0),
        requestCount: record.legs.reduce((n, leg) => n + (leg.result?.requestCount ?? 0), 0),
        inputTokens: record.legs.reduce((n, leg) => n + (leg.result?.inputTokens ?? 0), 0),
        outputTokens: record.legs.reduce((n, leg) => n + (leg.result?.outputTokens ?? 0), 0),
        usageMissingCount: record.legs.reduce((n, leg) => n + (leg.result?.usageMissingCount ?? leg.dispatchMarkers), 0),
        elapsedMs: record.legs.reduce((n, leg) => n + (leg.result?.elapsedMs ?? 0), 0),
        ...(record.comparison === undefined ? {} : { comparison: structuredClone(record.comparison) }),
        ...(record.reason === undefined ? {} : { reason: record.reason }) })), releaseAuthority: 'none' as const }
  }
  close(): Promise<void> { this.closing ??= this.tail.then(() => this.domain.close()); return this.closing }
  private change(record: ConversationDraftTrialRecord, mutate: (value: ConversationDraftTrialRecord) => void): Promise<ConversationDraftTrialRecord> {
    return this.enqueue(async () => {
      if (digest(this.domain.table('records').get(record.id)) !== digest(record)) throw new Error('trial changed during work')
      const next = structuredClone(record)
      mutate(next)
      await this.put(next)
      return structuredClone(next)
    })
  }
  private async put(record: ConversationDraftTrialRecord): Promise<void> {
    const parsed = recordSchema.parse(record)
    try { await this.domain.table('records').put(parsed.id, parsed) }
    catch (error) { this.failed = true; throw error }
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined || this.failed) return Promise.reject(new Error('conversation trial store unavailable'))
    const result = this.tail.then(() => { if (this.failed) throw new Error('conversation trial store unavailable'); return action() })
    this.tail = result.then(() => {}, () => {})
    return result
  }
}

export async function openConversationDraftTrialStore(facility: DomainFacility, policies: readonly ConversationDraftTrialPolicy[],
  now: () => number = Date.now): Promise<ConversationDraftTrialStore> {
  validateConversationDraftTrialPolicies(policies)
  const domain = await facility.open(spec)
  try {
    const table = domain.table('records')
    if (table.size > MAX_PLANS) throw new Error('conversation trial capacity exceeded')
    for (const [key, value] of table.entries()) {
      const record = recordSchema.parse(value)
      if (key !== record.id) throw new Error('conversation trial key mismatch')
      if (['reserved', 'running'].includes(record.phase)) await table.put(key, { ...record, phase: 'uncertain', reason: 'interrupted' })
    }
    return new ConversationDraftTrialStore(domain, structuredClone(policies), now)
  } catch (error) { await domain.close(); throw error }
}
