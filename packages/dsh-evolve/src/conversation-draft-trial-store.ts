import { createHash } from 'node:crypto'
import { defineDomain, domainTable, type Domain, type DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { digest } from './conversation-correction-intake.ts'
import { requireDraftCaseCalibration, validateDraftGovernance, type ConversationDraftRecord } from './conversation-skill-draft.ts'
import { NATIVE_WORKSPACE_ID_PATTERN } from './workspace-identity.ts'
import type { ConversationDraftTrialSummary } from './control-types.ts'
import { DRAFT_JUDGE_PROMPT_HASH, DRAFT_JUDGE_VERSION, draftJudgmentSchema, type DraftJudgment } from './conversation-draft-judge.ts'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const MAX_PLANS = 20
const policySchema = z.strictObject({
  workspaceId: z.string().regex(NATIVE_WORKSPACE_ID_PATTERN), maxModelCallsPerUtcDay: z.number().int().min(24).max(72),
  semanticEvaluation: z.boolean().optional(),
  retryFailedTrials: z.array(z.strictObject({ trialId: hash, expiresAt: integer.positive().max(8_640_000_000_000_000) })).max(10).optional(),
})
export interface ConversationDraftTrialPolicy {
  readonly workspaceId: string
  readonly maxModelCallsPerUtcDay: number
  readonly semanticEvaluation?: boolean
  readonly retryFailedTrials?: { readonly trialId: string; readonly expiresAt: number }[]
}
export function validateConversationDraftTrialPolicies(policies: readonly ConversationDraftTrialPolicy[]): void {
  z.array(policySchema).max(20).parse(policies)
  if (new Set(policies.map(policy => policy.workspaceId)).size !== policies.length) throw new Error('duplicate trial Workspace')
  for (const policy of policies) {
    if (policy.semanticEvaluation && policy.maxModelCallsPerUtcDay < 44) throw new Error('semantic trial requires at least 44 reserved calls')
    const grants = policy.retryFailedTrials ?? []
    if (new Set(grants.map(grant => grant.trialId)).size !== grants.length) throw new Error('duplicate trial retry grant')
  }
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
const judgeUsageSchema = z.strictObject({ inputTokens: integer, outputTokens: integer,
  cacheReadTokens: integer.optional(), cacheWriteTokens: integer.optional() })
const judgeSchema = z.strictObject({
  version: z.literal(DRAFT_JUDGE_VERSION), promptHash: z.literal(DRAFT_JUDGE_PROMPT_HASH),
  requests: z.array(z.strictObject({ inputDigest: hash, startedAt: integer, elapsedMs: integer.optional(),
    decision: draftJudgmentSchema.optional(), usage: judgeUsageSchema.optional() })).max(20),
}).superRefine((judge, ctx) => {
  if (judge.requests.slice(0, -1).some(request => request.decision === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'judge requests must settle in order' })
  }
})
function calibrated(judge: z.infer<typeof judgeSchema>): boolean {
  return judge.requests.length >= 12 && judge.requests.slice(0, 12)
    .every((request, index) => request.decision?.verdict === (index % 3 === 2 ? 'fail' : 'pass'))
}
function legPassed(leg: z.infer<typeof legSchema>, judge?: z.infer<typeof judgeSchema>): boolean {
  return leg.result?.status === 'completed' && (judge === undefined ? leg.result.passed : judge.requests[12 + leg.index]?.decision?.verdict === 'pass')
}
function knownJudgeUsage(usage: TokenUsage): z.infer<typeof judgeUsageSchema> {
  return judgeUsageSchema.parse({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }) })
}
const legSchema = z.strictObject({
  index: z.number().int().min(0).max(7), caseId: z.string().regex(/^[a-z0-9-]{1,64}$/u),
  partition: z.enum(['holdout', 'retention']), inputDigest: hash, variant: z.enum(['baseline', 'draft']),
  sessionId: z.string().min(1).max(128), phase: z.enum(['pending', 'running', 'settled']),
  dispatchMarkers: z.number().int().min(0).max(3), result: resultSchema.optional(),
})
const recordSchema = z.strictObject({
  schemaVersion: z.literal(1), id: hash, draftId: hash, workspaceId: z.string().regex(NATIVE_WORKSPACE_ID_PATTERN),
  retryOf: hash.optional(),
  draftSnapshotDigest: hash, contentHash: hash, governanceDigest: hash,
  provider: z.string().min(1).max(256), model: z.string().min(1).max(256),
  reservedAt: integer.max(8_640_000_000_000_000), reservedModelCalls: z.union([z.literal(0), z.literal(24), z.literal(44)]),
  phase: z.enum(['reserved', 'running', 'completed', 'uncertain', 'blocked', 'rejected']), legs: z.array(legSchema).length(8),
  judge: judgeSchema.optional(),
  comparison: comparisonSchema.optional(), reason: z.enum(['interrupted', 'cancelled', 'source-conflict', 'execution-failed', 'evaluator-unqualified', 'judge-calibration-failed', 'judge-unavailable']).optional(),
}).superRefine((record, ctx) => {
  const pairs = [0, 2, 4, 6].map(index => record.legs.slice(index, index + 2))
  const invalid = record.id !== trialId(record.draftId, record.retryOf)
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
      record.comparison.baselinePassed !== record.legs.filter(leg => leg.variant === 'baseline' && legPassed(leg, record.judge)).length
      || record.comparison.draftPassed !== record.legs.filter(leg => leg.variant === 'draft' && legPassed(leg, record.judge)).length
      || record.comparison.loadedDraftLegs !== record.legs.filter(leg => leg.variant === 'draft' && leg.result?.skillLoaded).length)
    || (record.phase === 'completed') !== (record.comparison !== undefined)
    || record.phase === 'completed' && record.legs.some(leg => leg.phase !== 'settled')
    || record.phase === 'reserved' && record.legs.some(leg => leg.phase !== 'pending')
    || (record.phase === 'blocked') !== (record.reservedModelCalls === 0)
    || (record.phase === 'blocked') !== (record.reason === 'evaluator-unqualified')
    || record.phase === 'blocked' && record.legs.some(leg => leg.phase !== 'pending')
    || record.phase !== 'blocked' && record.reservedModelCalls !== (record.judge === undefined ? 24 : 44)
    || record.judge !== undefined && (
      record.legs.some(leg => leg.phase !== 'pending') && !calibrated(record.judge)
      || record.judge.requests.length > 12 && record.judge.requests.slice(12).some((_, index) => record.legs[index]?.phase !== 'settled')
      || record.phase === 'completed' && (record.judge.requests.length !== 20 || record.judge.requests.some(request => request.decision === undefined))
      || ['reserved', 'blocked'].includes(record.phase) && record.judge.requests.length !== 0)
    || (record.phase === 'rejected') !== (record.reason === 'judge-calibration-failed')
    || record.phase === 'rejected' && (record.judge === undefined || record.judge.requests.length > 12
      || !record.judge.requests.some((request, index) => request.decision !== undefined && request.decision.verdict !== (index % 3 === 2 ? 'fail' : 'pass'))
      || record.legs.some(leg => leg.phase !== 'pending'))
    || (['uncertain', 'blocked', 'rejected'].includes(record.phase)) !== (record.reason !== undefined)
  if (invalid) ctx.addIssue({ code: 'custom', message: 'inconsistent conversation trial identity or lifecycle' })
})
export type ConversationDraftTrialRecord = z.infer<typeof recordSchema>
export function trialLegPassed(record: ConversationDraftTrialRecord, index: number): boolean {
  return legPassed(record.legs[index]!, record.judge)
}
export function trialJudgeCalibrated(record: ConversationDraftTrialRecord): boolean { return record.judge !== undefined && calibrated(record.judge) }
const spec = defineDomain({ name: 'evoforge_conversation_draft_trials', version: 1, layout: 'single',
  tables: { records: domainTable<string, ConversationDraftTrialRecord>(recordSchema) } })
function trialId(draftId: string, retryOf?: string): string {
  return digest({ kind: 'conversation-draft-paired-v1', draftId, ...(retryOf === undefined ? {} : { retryOf }) })
}
function legSessionId(id: string, index: number): string { return `evoforge-trial-${id}-${index}` }
function day(time: number): string { return new Date(time).toISOString().slice(0, 10) }
function zeroDispatchRoot(record: ConversationDraftTrialRecord): boolean {
  return record.retryOf === undefined && record.phase === 'uncertain'
    && (record.judge?.requests.length ?? 0) === 0
    && record.legs.every(leg => leg.dispatchMarkers === 0 && leg.result === undefined)
}
function frozenPlan(record: ConversationDraftTrialRecord): unknown {
  return { draftId: record.draftId, workspaceId: record.workspaceId, draftSnapshotDigest: record.draftSnapshotDigest,
    contentHash: record.contentHash, governanceDigest: record.governanceDigest, provider: record.provider, model: record.model,
    legs: record.legs.map(({ index, caseId, partition, inputDigest, variant }) => ({ index, caseId, partition, inputDigest, variant })),
    ...(record.judge === undefined ? {} : { judge: { version: record.judge.version, promptHash: record.judge.promptHash } }) }
}

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
  ownsSession(sessionId: string): boolean {
    if (this.failed) throw new Error('conversation trial ownership unavailable')
    return [...this.domain.table('records').entries()]
      .some(([, record]) => record.legs.some(leg => leg.sessionId === sessionId))
  }
  records(workspaceId: string): ConversationDraftTrialRecord[] {
    if (this.failed) return []
    return [...this.domain.table('records').entries()].map(([, record]) => record)
      .filter(record => record.workspaceId === workspaceId).map(record => structuredClone(record))
  }
  canReserve(source: ConversationDraftRecord): boolean {
    if (this.failed || this.closing !== undefined || this.nextIdentity(source) === undefined) return false
    if (source.governance !== undefined) {
      try { requireDraftCaseCalibration(source.governance) } catch { return true }
    }
    const used = this.records(source.workspaceId).filter(record => day(record.reservedAt) === day(this.now()))
      .reduce((sum, record) => sum + record.reservedModelCalls, 0)
    const policy = this.policy(source.workspaceId)
    return used + (policy?.semanticEvaluation ? 44 : 24) <= (policy?.maxModelCallsPerUtcDay ?? 0)
  }
  private nextIdentity(source: ConversationDraftRecord): { id: string; retryOf?: string } | undefined {
    const policy = this.policy(source.workspaceId)
    if (policy === undefined) return undefined
    const table = this.domain.table('records'), rootId = trialId(source.id), root = table.get(rootId)
    if (root === undefined) return { id: rootId }
    const grant = policy.retryFailedTrials?.find(grant => grant.trialId === rootId)
    if (grant === undefined || grant.expiresAt <= this.now() || !zeroDispatchRoot(root)
      || (root.judge !== undefined) !== (policy.semanticEvaluation === true)
      || root.workspaceId !== source.workspaceId || root.draftSnapshotDigest !== digest(source)) return undefined
    const id = trialId(source.id, rootId)
    return table.get(id) === undefined ? { id, retryOf: rootId } : undefined
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
      const table = this.domain.table('records'), identity = this.nextIdentity(source), reservedAt = this.now()
      if (identity === undefined || table.size >= MAX_PLANS) return undefined
      const { id, retryOf } = identity
      const parent = retryOf === undefined ? undefined : table.get(retryOf)
      if (parent !== undefined && (parent.provider !== route.provider || parent.model !== route.model)) return undefined
      let qualified = true
      try { requireDraftCaseCalibration(source.governance) } catch { qualified = false }
      const reservedModelCalls = qualified ? policy.semanticEvaluation ? 44 : 24 : 0
      const used = this.records(source.workspaceId).filter(record => day(record.reservedAt) === day(reservedAt))
        .reduce((sum, record) => sum + record.reservedModelCalls, 0)
      if (qualified && used + reservedModelCalls > policy.maxModelCallsPerUtcDay) return undefined
      const legs = source.governance.cases.flatMap((test, caseIndex) => {
        const variants = caseIndex % 2 === 0 ? ['baseline', 'draft'] as const : ['draft', 'baseline'] as const
        return variants.map((variant, offset) => ({ index: caseIndex * 2 + offset, caseId: test.id,
          partition: test.partition, inputDigest: digest(test.input), variant,
          sessionId: legSessionId(id, caseIndex * 2 + offset), phase: 'pending' as const, dispatchMarkers: 0 }))
      })
      const record = recordSchema.parse({ schemaVersion: 1, id, draftId: source.id, workspaceId: source.workspaceId,
        ...(retryOf === undefined ? {} : { retryOf }),
        draftSnapshotDigest: digest(source), contentHash: source.draft.contentHash, governanceDigest: source.governanceDigest,
        provider: route.provider, model: route.model, reservedAt, reservedModelCalls,
        ...(policy.semanticEvaluation ? { judge: { version: DRAFT_JUDGE_VERSION, promptHash: DRAFT_JUDGE_PROMPT_HASH, requests: [] } } : {}),
        ...(qualified ? { phase: 'reserved' } : { phase: 'blocked', reason: 'evaluator-unqualified' }), legs })
      if (parent !== undefined && (reservedAt < parent.reservedAt || digest(frozenPlan(record)) !== digest(frozenPlan(parent)))) {
        throw new Error('trial retry changed its frozen plan')
      }
      await this.put(record)
      return structuredClone(record)
    })
  }
  startLeg(record: ConversationDraftTrialRecord, index: number): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      if (current.judge !== undefined && (!calibrated(current.judge) || current.judge.requests.length !== 12 + index
        || current.judge.requests.some(request => request.decision === undefined))) throw new Error('trial judge calibration or previous judgment incomplete')
      const leg = current.legs[index]
      if (!leg || !['reserved', 'running'].includes(current.phase) || leg.phase !== 'pending'
        || current.legs.slice(0, index).some(previous => previous.phase !== 'settled')) throw new Error('trial leg cannot start')
      leg.phase = 'running'
      current.phase = 'running'
    })
  }
  startJudge(record: ConversationDraftTrialRecord, inputDigest: string): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const judge = current.judge
      if (!['reserved', 'running'].includes(current.phase) || judge === undefined || judge.requests.length >= 20
        || judge.requests.some(request => request.decision === undefined)
        || judge.requests.slice(0, 12).some((request, index) => request.decision?.verdict !== (index % 3 === 2 ? 'fail' : 'pass'))
        || current.legs.some(leg => leg.phase === 'running')
        || judge.requests.length >= 12 && (!calibrated(judge) || current.legs[judge.requests.length - 12]?.phase !== 'settled')) {
        throw new Error('judge request cannot start')
      }
      judge.requests.push({ inputDigest, startedAt: this.now() })
      current.phase = 'running'
    })
  }
  finishJudge(record: ConversationDraftTrialRecord, decision: DraftJudgment, usage?: TokenUsage): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const request = current.judge?.requests.at(-1)
      if (current.phase !== 'running' || request === undefined || request.decision !== undefined) throw new Error('judge request is not pending')
      request.decision = draftJudgmentSchema.parse(decision)
      request.elapsedMs = Math.max(0, this.now() - request.startedAt)
      if (usage !== undefined) request.usage = knownJudgeUsage(usage)
    })
  }
  rejectJudgeCalibration(record: ConversationDraftTrialRecord): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => { current.phase = 'rejected'; current.reason = 'judge-calibration-failed' })
  }
  failJudge(record: ConversationDraftTrialRecord, usage?: TokenUsage,
    reason: 'judge-unavailable' | 'cancelled' | 'source-conflict' = 'judge-unavailable'): Promise<ConversationDraftTrialRecord> {
    return this.change(record, current => {
      const request = current.judge?.requests.at(-1)
      if (current.phase !== 'running' || request === undefined || request.decision !== undefined) throw new Error('judge request is not pending')
      if (usage !== undefined) {
        try { request.usage = knownJudgeUsage(usage) } catch { /* Invalid usage remains unknown. */ }
      }
      request.elapsedMs = Math.max(0, this.now() - request.startedAt)
      current.phase = 'uncertain'
      current.reason = reason
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
      semanticEvaluationEnabled: policy?.semanticEvaluation === true,
      warningCount: (this.warnings.get(workspaceId) ?? 0) + (this.failed ? 1 : 0),
      pendingCount: records.filter(record => ['reserved', 'running'].includes(record.phase)).length,
      uncertainCount: records.filter(record => record.phase === 'uncertain').length,
      reservedModelCallsToday: records.filter(record => day(record.reservedAt) === day(this.now())).reduce((n, record) => n + record.reservedModelCalls, 0),
      maxModelCallsPerUtcDay: policy?.maxModelCallsPerUtcDay ?? 0,
      items: records.slice(-5).reverse().map(record => ({ id: record.id, draftId: record.draftId, phase: record.phase,
        ...(record.retryOf === undefined ? {} : { retryOf: record.retryOf }),
        settledLegs: record.legs.filter(leg => leg.phase === 'settled').length,
        dispatchMarkers: record.legs.reduce((n, leg) => n + leg.dispatchMarkers, 0),
        requestCount: record.legs.reduce((n, leg) => n + (leg.result?.requestCount ?? 0), 0),
        inputTokens: record.legs.reduce((n, leg) => n + (leg.result?.inputTokens ?? 0), 0)
          + (record.judge?.requests.reduce((n, request) => n + (request.usage?.inputTokens ?? 0), 0) ?? 0),
        outputTokens: record.legs.reduce((n, leg) => n + (leg.result?.outputTokens ?? 0), 0)
          + (record.judge?.requests.reduce((n, request) => n + (request.usage?.outputTokens ?? 0), 0) ?? 0),
        usageMissingCount: record.legs.reduce((n, leg) => n + (leg.result?.usageMissingCount ?? leg.dispatchMarkers), 0)
          + (record.judge?.requests.filter(request => request.usage === undefined).length ?? 0),
        elapsedMs: record.legs.reduce((n, leg) => n + (leg.result?.elapsedMs ?? 0), 0)
          + (record.judge?.requests.reduce((n, request) => n + (request.elapsedMs ?? 0), 0) ?? 0),
        ...(record.judge === undefined ? {} : { judge: { version: record.judge.version,
          dispatchMarkers: record.judge.requests.length, completedJudgments: record.judge.requests.filter(request => request.decision !== undefined).length,
          calibrationCompleted: record.judge.requests.slice(0, 12).filter(request => request.decision !== undefined).length,
          calibrated: calibrated(record.judge) } }),
        ...(record.comparison === undefined ? {} : { comparison: structuredClone(record.comparison) }),
        ...(record.reason === undefined ? {} : { reason: record.reason }) })), releaseAuthority: 'none' as const }
  }
  close(): Promise<void> { this.closing ??= this.tail.then(() => this.domain.close()); return this.closing }
  private change(record: ConversationDraftTrialRecord, mutate: (value: ConversationDraftTrialRecord) => void): Promise<ConversationDraftTrialRecord> {
    return this.enqueue(async () => {
      if (digest(this.domain.table('records').get(record.id)) !== digest(record)) throw new Error('trial changed during work')
      const next = structuredClone(record)
      mutate(next)
      const parsed = recordSchema.parse(next)
      await this.put(parsed)
      return structuredClone(parsed)
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
      if (record.retryOf !== undefined) {
        const parent = table.get(record.retryOf)
        if (parent === undefined || !zeroDispatchRoot(recordSchema.parse(parent)) || record.reservedAt < parent.reservedAt
          || digest(frozenPlan(parent)) !== digest(frozenPlan(record))) throw new Error('conversation trial retry ancestry mismatch')
      }
    }
    for (const policy of policies) for (const grant of policy.retryFailedTrials ?? []) {
      const parent = table.get(grant.trialId)
      if (parent === undefined || parent.workspaceId !== policy.workspaceId || !zeroDispatchRoot(parent)
        || grant.expiresAt > now() + 86_400_000) throw new Error('conversation trial retry grant is invalid')
    }
    for (const [key, record] of table.entries()) {
      if (['reserved', 'running'].includes(record.phase)) await table.put(key, { ...record, phase: 'uncertain', reason: 'interrupted' })
    }
    return new ConversationDraftTrialStore(domain, structuredClone(policies), now)
  } catch (error) { await domain.close(); throw error }
}
