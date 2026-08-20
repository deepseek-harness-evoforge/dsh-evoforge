import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { MessageFeedbackService } from '@deepseek-ai/dsh-message-feedback'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { z } from 'zod'
import type {
  ExistingSkillBaselineQualification,
  ExistingSkillBaselineQualificationManifest,
} from './existing-skill-baseline-qualification.ts'
import { durableSkillInvocations } from './durable-skill-invocation.ts'
import type { FeedbackSignal, FeedbackSignalStore } from './feedback-signal-monitor.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import {
  assertSkillCandidateEvaluationPolicies,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import type { SkillImprovementOpportunity } from './skill-opportunity-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_SELECTED_GOALS = 12
const MAX_GOAL_OBJECTIVE_BYTES = 4 * 1024
const MAX_REQUEST_BYTES = 16 * 1024
const MAX_CORRECTION_BYTES = 8 * 1024
const MAX_MANIFEST_BYTES = 512 * 1024

const sampleSchema = z.strictObject({
  role: z.enum(['authoring', 'admission', 'holdout', 'retention']),
  goal: z.strictObject({
    id: z.string().min(1).max(512),
    revision: z.number().int().positive(),
    objective: z.string().min(1).max(8_192),
  }),
  request: z.strictObject({
    text: z.string().min(1).max(32_768),
    representation: z.literal('durable-user-text-v1'),
    omittedNonText: z.boolean(),
  }),
  correction: z.strictObject({
    note: z.string().min(1).max(16_384),
    sourceUpdatedAt: z.number().int().nonnegative(),
  }),
  source: z.strictObject({
    feedbackSignalId: z.string().regex(CONTENT_ID),
    sessionId: z.string().min(1).max(256),
    messageId: z.string().min(1).max(512),
    feedbackVersion: z.uuid(),
    assistantSeq: z.number().int().nonnegative(),
    invocationSeq: z.number().int().nonnegative(),
    route: z.enum(['user-explicit', 'model-tool']),
  }),
})

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-evaluation-evidence-v1'),
  id: z.string().regex(CONTENT_ID),
  workspaceId: z.uuid(),
  opportunity: z.strictObject({
    id: z.string().regex(CONTENT_ID),
    skillName: z.string().regex(PUBLIC_ID),
    invocationContentHash: z.string().regex(CONTENT_ID),
    signalCount: z.number().int().min(4).max(100),
    goalCount: z.number().int().min(4).max(100),
    firstObservedAt: z.number().int().nonnegative(),
    lastObservedAt: z.number().int().nonnegative(),
  }),
  qualification: z.strictObject({
    id: z.string().regex(CONTENT_ID),
    baselineId: z.string().regex(CONTENT_ID),
  }),
  selection: z.strictObject({
    selectedGoalCount: z.number().int().min(4).max(MAX_SELECTED_GOALS),
    omittedGoalCount: z.number().int().nonnegative().max(100),
  }),
  samples: z.array(sampleSchema).min(4).max(MAX_SELECTED_GOALS),
  authoringInputDigest: z.string().regex(CONTENT_ID),
  releaseAuthority: z.literal('none'),
}).superRefine((manifest, context) => {
  const goals = manifest.samples.map(sample => sample.goal.id)
  if (goals.length !== new Set(goals).size) {
    context.addIssue({ code: 'custom', message: 'existing-Skill evidence samples must use distinct Goals' })
  }
  for (const role of ['authoring', 'admission', 'holdout'] as const) {
    if (!manifest.samples.some(sample => sample.role === role)) {
      context.addIssue({ code: 'custom', message: `existing-Skill evidence requires a ${role} sample` })
    }
  }
  if (manifest.samples.length >= 5
    && !manifest.samples.some(sample => sample.role === 'retention')) {
    context.addIssue({ code: 'custom', message: 'five-goal existing-Skill evidence requires retention' })
  }
})

export type ExistingSkillEvaluationEvidenceManifest = z.infer<typeof manifestSchema>

export interface ExistingSkillAuthoringEvidence {
  readonly id: string
  readonly workspaceId: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly skillName: string
  readonly authoringCases: readonly {
    readonly goal: {
      readonly id: string
      readonly revision: number
      readonly objective: string
    }
    readonly request: string
    readonly requestHasOmittedContent: boolean
    readonly correction: string
  }[]
  readonly authoringGoalCount: number
  readonly admissionGoalCount: number
  readonly holdoutGoalCount: number
  readonly retentionGoalCount: number
  readonly authoringInputDigest: string
  readonly proposerCanReadProtectedSamples: false
  readonly releaseAuthority: 'none'
}

export type ExistingSkillEvaluationEvidencePreparation =
  | { readonly status: 'ready'; readonly evidence: ExistingSkillAuthoringEvidence }
  | {
      readonly status: 'abstained'
      readonly reason:
        | 'governance-policy-unavailable'
        | 'baseline-qualification-waiting'
        | 'baseline-qualification-invalid'
        | 'fewer-than-four-independent-goals'
        | 'correction-evidence-unavailable'
        | 'correction-evidence-drift'
        | 'correction-evidence-invalid'
      readonly observedGoalCount: number
      readonly requiredGoalCount: 4
      readonly releaseAuthority: 'none'
    }

export type ExistingSkillEvaluationEvidenceReadiness =
  | {
      readonly status: 'ready-to-seal' | 'sealed'
      readonly evidenceId: string
      readonly qualificationId: string
      readonly baselineId: string
      readonly observedGoalCount: number
      readonly authoringGoalCount: number
      readonly admissionGoalCount: number
      readonly holdoutGoalCount: number
      readonly retentionGoalCount: number
      readonly proposerCanReadProtectedSamples: false
      readonly releaseAuthority: 'none'
    }
  | {
      readonly status: 'waiting' | 'unavailable' | 'invalid'
      readonly reason: Extract<ExistingSkillEvaluationEvidencePreparation, { status: 'abstained' }>['reason']
        | 'sealed-evidence-invalid'
      readonly observedGoalCount: number
      readonly requiredGoalCount: 4
      readonly releaseAuthority: 'none'
    }

interface MessageFeedbackReader {
  list: MessageFeedbackService['list']
}

/**
 * Seal current correction text and its exact durable Goal/request context
 * before an existing Skill can be authored. The proposer receives only the
 * authoring partition; admission, holdout, and retention remain governance-only.
 */
export class ExistingSkillEvaluationEvidenceVault {
  private readonly policies = new Map<string, SkillCandidateEvaluationPolicyConfig>()
  private readonly qualification: Pick<ExistingSkillBaselineQualification, 'qualify'>
  private readonly feedback: Pick<FeedbackSignalStore, 'list'>
  private readonly messageFeedback: MessageFeedbackReader
  private readonly persistence: Pick<SessionPersistence, 'inspect'>

  constructor(
    policies: readonly SkillCandidateEvaluationPolicyConfig[],
    qualification: Pick<ExistingSkillBaselineQualification, 'qualify'>,
    feedback: Pick<FeedbackSignalStore, 'list'>,
    messageFeedback: MessageFeedbackReader,
    persistence: Pick<SessionPersistence, 'inspect'>,
  ) {
    assertSkillCandidateEvaluationPolicies(policies)
    for (const policy of policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.qualification = qualification
    this.feedback = feedback
    this.messageFeedback = messageFeedback
    this.persistence = persistence
  }

  async prepare(
    opportunity: SkillImprovementOpportunity,
  ): Promise<ExistingSkillEvaluationEvidencePreparation> {
    const resolved = await this.resolveEvidence(opportunity)
    if (resolved.status === 'abstained') return resolved
    await installManifest(resolved.governanceRoot, resolved.manifest)
    return Object.freeze({ status: 'ready' as const, evidence: authoringView(resolved.manifest) })
  }

  async readiness(
    opportunity: SkillImprovementOpportunity,
  ): Promise<ExistingSkillEvaluationEvidenceReadiness> {
    const resolved = await this.resolveEvidence(opportunity)
    if (resolved.status === 'abstained') {
      return Object.freeze({
        status: readinessStatus(resolved.reason),
        reason: resolved.reason,
        observedGoalCount: resolved.observedGoalCount,
        requiredGoalCount: 4,
        releaseAuthority: 'none',
      })
    }
    let status: 'ready-to-seal' | 'sealed' = 'ready-to-seal'
    const target = evidenceRoot(
      resolved.governanceRoot,
      opportunity.id,
      resolved.manifest.qualification.id,
      resolved.manifest.id,
    )
    if (await pathExists(target)) {
      try {
        const installed = await this.readForGovernance(
          opportunity.workspaceId,
          opportunity.id,
          resolved.manifest.qualification.id,
          resolved.manifest.id,
        )
        if (JSON.stringify(installed) !== JSON.stringify(resolved.manifest)) {
          throw new Error('content-addressed existing-Skill evidence collision')
        }
        status = 'sealed'
      } catch {
        return Object.freeze({
          status: 'invalid',
          reason: 'sealed-evidence-invalid',
          observedGoalCount: opportunity.goalCount,
          requiredGoalCount: 4,
          releaseAuthority: 'none',
        })
      }
    }
    const view = authoringView(resolved.manifest)
    return Object.freeze({
      status,
      evidenceId: view.id,
      qualificationId: view.qualificationId,
      baselineId: view.baselineId,
      observedGoalCount: opportunity.goalCount,
      authoringGoalCount: view.authoringGoalCount,
      admissionGoalCount: view.admissionGoalCount,
      holdoutGoalCount: view.holdoutGoalCount,
      retentionGoalCount: view.retentionGoalCount,
      proposerCanReadProtectedSamples: false,
      releaseAuthority: 'none',
    })
  }

  private async resolveEvidence(
    opportunity: SkillImprovementOpportunity,
  ): Promise<
      | {
          readonly status: 'ready'
          readonly governanceRoot: string
          readonly manifest: ExistingSkillEvaluationEvidenceManifest
        }
      | Extract<ExistingSkillEvaluationEvidencePreparation, { status: 'abstained' }>
    > {
    const policy = this.policies.get(opportunity.workspaceId)
    if (policy === undefined) return abstained('governance-policy-unavailable', opportunity.goalCount)

    const qualification = await this.qualification.qualify(opportunity)
    if (qualification.status === 'waiting') {
      return abstained('baseline-qualification-waiting', opportunity.goalCount)
    }
    if (qualification.status === 'invalid') {
      return abstained('baseline-qualification-invalid', opportunity.goalCount)
    }
    if (opportunity.goalCount < 4) {
      return abstained('fewer-than-four-independent-goals', opportunity.goalCount)
    }

    const signals = exactQualifiedSignals(
      this.feedback.list(opportunity.workspaceId),
      opportunity,
      qualification.qualification,
    )
    if (signals === undefined) return abstained('correction-evidence-drift', opportunity.goalCount)

    const selectedSignals = selectOnePerGoal(signals, opportunity.id)
    if (selectedSignals.length < 4) {
      return abstained('fewer-than-four-independent-goals', selectedSignals.length)
    }

    const samples: UnroledSample[] = []
    for (const signal of selectedSignals) {
      const resolved = await this.resolveSample(signal, opportunity)
      if (resolved.status !== 'ready') {
        return abstained(resolved.reason, opportunity.goalCount)
      }
      samples.push(resolved.sample)
    }
    const manifest = buildManifest(opportunity, qualification.qualification, samples)
    return { status: 'ready', governanceRoot: policy.governanceRoot, manifest }
  }

  async readForGovernance(
    workspaceId: string,
    opportunityId: string,
    qualificationId: string,
    evidenceId: string,
  ): Promise<ExistingSkillEvaluationEvidenceManifest> {
    const policy = this.policies.get(workspaceId)
    if (policy === undefined) throw new Error('existing-Skill evidence governance policy is unavailable')
    if (![opportunityId, qualificationId, evidenceId].every(value => CONTENT_ID.test(value))) {
      throw new Error('existing-Skill evidence identity is invalid')
    }
    const root = evidenceRoot(policy.governanceRoot, opportunityId, qualificationId, evidenceId)
    if (await exactDirectory(root, 'existing-Skill evidence root') !== root) {
      throw new Error('existing-Skill evidence path is not exact')
    }
    const manifest = await readManifest(root)
    if (manifest.workspaceId !== workspaceId
      || manifest.opportunity.id !== opportunityId
      || manifest.qualification.id !== qualificationId
      || manifest.id !== evidenceId) {
      throw new Error('existing-Skill evidence path does not match its manifest')
    }
    return immutableCopy(manifest)
  }

  private async resolveSample(
    signal: ExactCorrectionSignal,
    opportunity: SkillImprovementOpportunity,
  ): Promise<
      | { readonly status: 'ready'; readonly sample: UnroledSample }
      | { readonly status: 'abstained'; readonly reason: 'correction-evidence-unavailable' | 'correction-evidence-drift' | 'correction-evidence-invalid' }
    > {
    let listed
    try {
      listed = await this.messageFeedback.list({ sessionId: signal.sessionId as SessionId })
    } catch {
      return { status: 'abstained', reason: 'correction-evidence-unavailable' }
    }
    if (!listed.ok) return { status: 'abstained', reason: 'correction-evidence-drift' }
    const exact = listed.value.items.filter(item => String(item.messageId) === signal.messageId)
    if (exact.length !== 1) return { status: 'abstained', reason: 'correction-evidence-drift' }
    const item = exact[0]!
    if (item.rating !== 'negative'
      || String(item.version) !== signal.feedbackVersion
      || item.updatedAt !== signal.sourceUpdatedAt
      || item.note === undefined
      || item.note.trim() === '') {
      return { status: 'abstained', reason: 'correction-evidence-drift' }
    }
    if (Buffer.byteLength(item.note) > MAX_CORRECTION_BYTES) {
      return { status: 'abstained', reason: 'correction-evidence-invalid' }
    }

    let durable: DurableCorrectionContext | undefined
    try {
      durable = await resolveDurableCorrection(this.persistence, signal)
    } catch {
      return { status: 'abstained', reason: 'correction-evidence-unavailable' }
    }
    if (durable === undefined
      || durable.goal.id !== signal.attribution.goal.id
      || durable.goal.revision !== signal.attribution.goal.revision
      || durable.skillName !== opportunity.skillName
      || durable.invocationContentHash !== opportunity.invocationContentHash) {
      return { status: 'abstained', reason: 'correction-evidence-drift' }
    }
    if (Buffer.byteLength(durable.goal.objective) > MAX_GOAL_OBJECTIVE_BYTES
      || Buffer.byteLength(durable.request.text) > MAX_REQUEST_BYTES) {
      return { status: 'abstained', reason: 'correction-evidence-invalid' }
    }
    return {
      status: 'ready',
      sample: {
        goal: durable.goal,
        request: {
          text: durable.request.text,
          representation: 'durable-user-text-v1',
          omittedNonText: durable.request.omittedNonText,
        },
        correction: { note: item.note, sourceUpdatedAt: item.updatedAt },
        source: {
          feedbackSignalId: signal.id,
          sessionId: signal.sessionId,
          messageId: signal.messageId,
          feedbackVersion: signal.feedbackVersion,
          assistantSeq: signal.attribution.assistantSeq,
          invocationSeq: signal.attribution.invocationSeq,
          route: signal.attribution.route,
        },
      },
    }
  }
}

type ExactCorrectionSignal = FeedbackSignal & {
  readonly attribution: NonNullable<FeedbackSignal['attribution']> & {
    readonly invocationContentHash: string
  }
}

type UnroledSample = Omit<ExistingSkillEvaluationEvidenceManifest['samples'][number], 'role'>

interface DurableCorrectionContext {
  readonly skillName: string
  readonly invocationContentHash: string
  readonly goal: { readonly id: string; readonly revision: number; readonly objective: string }
  readonly request: { readonly text: string; readonly omittedNonText: boolean }
}

function exactQualifiedSignals(
  values: readonly FeedbackSignal[],
  opportunity: SkillImprovementOpportunity,
  qualification: ExistingSkillBaselineQualificationManifest,
): ExactCorrectionSignal[] | undefined {
  const expected = new Set(qualification.evidence.feedbackSignalIds)
  const signals = [...new Map(values.map(value => [value.id, value])).values()]
    .filter((signal): signal is ExactCorrectionSignal =>
      expected.has(signal.id)
      && signal.workspaceId === opportunity.workspaceId
      && signal.attribution?.kind === 'exact-skill-invocation-v1'
      && signal.attribution.skillName === opportunity.skillName
      && signal.attribution.invocationContentHash === opportunity.invocationContentHash)
    .sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt || left.id.localeCompare(right.id))
  if (signals.length !== expected.size
    || signals.length !== opportunity.signalCount
    || qualification.opportunityId !== opportunity.id
    || qualification.workspaceId !== opportunity.workspaceId
    || qualification.skillName !== opportunity.skillName
    || qualification.invocationContentHash !== opportunity.invocationContentHash) return undefined
  return signals
}

function selectOnePerGoal(
  signals: readonly ExactCorrectionSignal[],
  opportunityId: string,
): ExactCorrectionSignal[] {
  const grouped = new Map<string, ExactCorrectionSignal[]>()
  for (const signal of signals) {
    const values = grouped.get(signal.attribution.goal.id) ?? []
    values.push(signal)
    grouped.set(signal.attribution.goal.id, values)
  }
  return [...grouped.entries()].map(([goalId, values]) => ({
    rank: sha256(JSON.stringify(['existing-skill-evaluation-split-v1', opportunityId, goalId])),
    signal: [...values].sort((left, right) => right.sourceUpdatedAt - left.sourceUpdatedAt
      || left.id.localeCompare(right.id))[0]!,
  })).sort((left, right) => left.rank.localeCompare(right.rank)
    || left.signal.attribution.goal.id.localeCompare(right.signal.attribution.goal.id))
    .slice(0, MAX_SELECTED_GOALS)
    .map(value => value.signal)
}

async function resolveDurableCorrection(
  persistence: Pick<SessionPersistence, 'inspect'>,
  signal: ExactCorrectionSignal,
): Promise<DurableCorrectionContext | undefined> {
  const stored = await persistence.inspect(signal.sessionId as SessionId)
  if (String(stored.meta.id) !== signal.sessionId) return undefined
  const assistants = stored.events.filter((event): event is SessionEvent<'assistant/message'> =>
    event.type === 'assistant/message'
    && String(event.data.message.id) === signal.messageId)
  if (assistants.length !== 1) return undefined
  const assistant = assistants[0]!
  if (assistant.seq !== signal.attribution.assistantSeq
    || assistant.data.turn !== signal.attribution.turn) return undefined
  const turnStart = [...stored.events].reverse().find(event =>
    event.seq < assistant.seq
    && event.type === 'turn/start'
    && event.data.turn === assistant.data.turn)
  if (turnStart === undefined) return undefined
  const turnEvents = stored.events.filter(event => event.seq > turnStart.seq && event.seq <= assistant.seq)
  const direct = turnEvents.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && sourceKind(event.data.source) === 'user')
  if (direct.length !== 1) return undefined
  const invocations = durableSkillInvocations(turnEvents)
  if (invocations.length !== 1) return undefined
  const invocation = invocations[0]!
  if (invocation.skillName !== signal.attribution.skillName
    || invocation.route !== signal.attribution.route
    || invocation.seq !== signal.attribution.invocationSeq) return undefined
  let goal
  try {
    goal = foldGoal(stored.events.filter(event => event.seq <= assistant.seq)).goal
  } catch {
    return undefined
  }
  if (goal === undefined) return undefined
  const request = textContent(direct[0]!.data.content)
  if (request === undefined) return undefined
  return {
    skillName: invocation.skillName,
    invocationContentHash: sha256(JSON.stringify(invocation.content)),
    goal: { id: String(goal.id), revision: goal.revision, objective: goal.objective },
    request,
  }
}

function textContent(
  content: unknown,
): { readonly text: string; readonly omittedNonText: boolean } | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block) => {
    if (block === null || typeof block !== 'object') return []
    const value = block as { type?: unknown; text?: unknown }
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n').trim()
  return text === '' ? undefined : {
    text,
    omittedNonText: content.some(block => block === null
      || typeof block !== 'object'
      || (block as { type?: unknown }).type !== 'text'),
  }
}

function buildManifest(
  opportunity: SkillImprovementOpportunity,
  qualification: ExistingSkillBaselineQualificationManifest,
  selected: readonly UnroledSample[],
): ExistingSkillEvaluationEvidenceManifest {
  if (selected.length < 4) throw new Error('existing-Skill evidence requires four independent Goals')
  const authoringCount = Math.max(2, Math.floor(selected.length / 2))
  const remaining = selected.length - authoringCount
  const retentionCount = selected.length >= 5 ? 1 : 0
  const admissionCount = Math.max(1, Math.floor((remaining - retentionCount) / 2))
  const retentionStart = selected.length - retentionCount
  const samples = selected.map((sample, index) => ({
    role: index < authoringCount
      ? 'authoring' as const
      : index < authoringCount + admissionCount
        ? 'admission' as const
        : index < retentionStart
          ? 'holdout' as const
          : 'retention' as const,
    ...sample,
  }))
  const payload = {
    schemaVersion: 1 as const,
    kind: 'existing-skill-evaluation-evidence-v1' as const,
    workspaceId: opportunity.workspaceId,
    opportunity: {
      id: opportunity.id,
      skillName: opportunity.skillName,
      invocationContentHash: opportunity.invocationContentHash,
      signalCount: opportunity.signalCount,
      goalCount: opportunity.goalCount,
      firstObservedAt: opportunity.firstObservedAt,
      lastObservedAt: opportunity.lastObservedAt,
    },
    qualification: { id: qualification.id, baselineId: qualification.baseline.id },
    selection: {
      selectedGoalCount: samples.length,
      omittedGoalCount: opportunity.goalCount - samples.length,
    },
    samples,
    releaseAuthority: 'none' as const,
  }
  const id = sha256(JSON.stringify(payload))
  const authoringInputDigest = sha256(JSON.stringify({
    kind: 'existing-skill-author-input-v1',
    evidenceId: id,
    opportunityId: opportunity.id,
    qualificationId: qualification.id,
    baselineId: qualification.baseline.id,
    skillName: opportunity.skillName,
    cases: authoringCases(samples),
  }))
  const manifest = manifestSchema.parse({ ...payload, id, authoringInputDigest })
  assertByteLimits(manifest)
  if (Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`) > MAX_MANIFEST_BYTES) {
    throw new Error('existing-Skill evidence manifest exceeds its byte limit')
  }
  return manifest
}

function authoringView(
  manifest: ExistingSkillEvaluationEvidenceManifest,
): ExistingSkillAuthoringEvidence {
  return immutableCopy({
    id: manifest.id,
    workspaceId: manifest.workspaceId,
    opportunityId: manifest.opportunity.id,
    qualificationId: manifest.qualification.id,
    baselineId: manifest.qualification.baselineId,
    skillName: manifest.opportunity.skillName,
    authoringCases: authoringCases(manifest.samples),
    authoringGoalCount: manifest.samples.filter(sample => sample.role === 'authoring').length,
    admissionGoalCount: manifest.samples.filter(sample => sample.role === 'admission').length,
    holdoutGoalCount: manifest.samples.filter(sample => sample.role === 'holdout').length,
    retentionGoalCount: manifest.samples.filter(sample => sample.role === 'retention').length,
    authoringInputDigest: manifest.authoringInputDigest,
    proposerCanReadProtectedSamples: false as const,
    releaseAuthority: 'none' as const,
  })
}

function authoringCases(
  samples: readonly ExistingSkillEvaluationEvidenceManifest['samples'][number][],
): ExistingSkillAuthoringEvidence['authoringCases'] {
  return samples.filter(sample => sample.role === 'authoring').map(sample => ({
    goal: sample.goal,
    request: sample.request.text,
    requestHasOmittedContent: sample.request.omittedNonText,
    correction: sample.correction.note,
  }))
}

async function installManifest(
  governanceRoot: string,
  manifest: ExistingSkillEvaluationEvidenceManifest,
): Promise<void> {
  await ensureExactDirectory(governanceRoot)
  const parent = join(
    governanceRoot,
    'existing-skill-evidence',
    manifest.opportunity.id,
    manifest.qualification.id,
  )
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await exactDirectory(parent, 'existing-Skill evidence parent')
  const target = join(parent, manifest.id)
  if (await pathExists(target)) {
    const existing = await readManifest(target)
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error('content-addressed existing-Skill evidence collision')
    }
    return
  }

  const stage = join(parent, `.evidence-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    await writeDurableJson(join(stage, 'manifest.json'), manifest)
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = await readManifest(target)
      if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
        throw new Error('content-addressed existing-Skill evidence collision')
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function readManifest(root: string): Promise<ExistingSkillEvaluationEvidenceManifest> {
  await exactDirectory(root, 'existing-Skill evidence root')
  const path = join(root, 'manifest.json')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('existing-Skill evidence manifest must be an exact real file')
  }
  if (info.size > MAX_MANIFEST_BYTES) {
    throw new Error('existing-Skill evidence manifest exceeds its byte limit')
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  assertIdentity(manifest)
  assertByteLimits(manifest)
  return manifest
}

function assertIdentity(manifest: ExistingSkillEvaluationEvidenceManifest): void {
  const { id, authoringInputDigest, ...payload } = manifest
  if (sha256(JSON.stringify(payload)) !== id) {
    throw new Error('existing-Skill evidence content identity mismatch')
  }
  const expected = sha256(JSON.stringify({
    kind: 'existing-skill-author-input-v1',
    evidenceId: id,
    opportunityId: manifest.opportunity.id,
    qualificationId: manifest.qualification.id,
    baselineId: manifest.qualification.baselineId,
    skillName: manifest.opportunity.skillName,
    cases: authoringCases(manifest.samples),
  }))
  if (expected !== authoringInputDigest) {
    throw new Error('existing-Skill evidence authoring identity mismatch')
  }
}

function assertByteLimits(manifest: ExistingSkillEvaluationEvidenceManifest): void {
  for (const sample of manifest.samples) {
    if (Buffer.byteLength(sample.goal.objective) > MAX_GOAL_OBJECTIVE_BYTES
      || Buffer.byteLength(sample.request.text) > MAX_REQUEST_BYTES
      || Buffer.byteLength(sample.correction.note) > MAX_CORRECTION_BYTES) {
      throw new Error('existing-Skill evidence content exceeds its byte limit')
    }
  }
}

function evidenceRoot(
  governanceRoot: string,
  opportunityId: string,
  qualificationId: string,
  evidenceId: string,
): string {
  return join(governanceRoot, 'existing-skill-evidence', opportunityId, qualificationId, evidenceId)
}

function abstained(
  reason: Extract<ExistingSkillEvaluationEvidencePreparation, { status: 'abstained' }>['reason'],
  observedGoalCount: number,
): Extract<ExistingSkillEvaluationEvidencePreparation, { status: 'abstained' }> {
  return Object.freeze({
    status: 'abstained',
    reason,
    observedGoalCount,
    requiredGoalCount: 4,
    releaseAuthority: 'none',
  })
}

function readinessStatus(
  reason: Extract<ExistingSkillEvaluationEvidencePreparation, { status: 'abstained' }>['reason'],
): 'waiting' | 'unavailable' | 'invalid' {
  if (reason === 'fewer-than-four-independent-goals'
    || reason === 'baseline-qualification-waiting') return 'waiting'
  if (reason === 'governance-policy-unavailable'
    || reason === 'correction-evidence-unavailable') return 'unavailable'
  return 'invalid'
}

async function ensureExactDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await exactDirectory(path, 'existing-Skill governance root')
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

function sourceKind(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
}
