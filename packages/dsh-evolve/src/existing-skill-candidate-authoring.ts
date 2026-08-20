import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import type { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import type {
  ExistingSkillBaselineQualification,
  ExistingSkillBaselineQualificationResult,
} from './existing-skill-baseline-qualification.ts'
import type {
  ExistingSkillAuthoringEvidence,
  ExistingSkillEvaluationEvidenceVault,
} from './existing-skill-evaluation-evidence-vault.ts'
import type { ExistingSkillHoldoutGovernance } from './existing-skill-holdout-governance.ts'
import { boundedModelProviderIdentity } from './model-provider-identity.ts'
import type {
  ExistingSkillCandidate,
  ExistingSkillCandidateProposal,
  ExistingSkillInstructionChange,
  SkillCandidateRepository,
} from './skill-candidate-repository.ts'
import type {
  ExperienceDrivenSkillOpportunityDiscovery,
  SkillImprovementOpportunity,
} from './skill-opportunity-discovery.ts'
import type { SkillOpportunityAuthoringPolicyConfig } from './slow-loop-skill-authoring.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const CONTENT_ID = /^[a-f0-9]{64}$/u
const MAX_POLICIES = 20
const MAX_BASELINE_MODEL_BYTES = 512 * 1024
const MAX_AUTHOR_INPUT_BYTES = 768 * 1024
const MAX_AUTHOR_RESPONSE_BYTES = 256 * 1024
const MAX_STATE_BYTES = 64 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 8_000
const POLICY_VERSION = 'protected-existing-skill-author-v1'

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  phase: z.enum([
    'prepared',
    'holdout-deferred',
    'holdout-blocked',
    'budget-deferred',
    'cancelled',
    'authoring-pending',
    'uncertain',
    'incomplete',
    'candidate-ready',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  identity: z.strictObject({
    policyVersion: z.literal(POLICY_VERSION),
    targetId: z.string().regex(PUBLIC_ID),
    workspaceId: z.uuid(),
    skillName: z.string().regex(PUBLIC_ID),
    opportunityId: z.string().regex(/^[a-f0-9]{64}$/u),
    qualificationId: z.string().regex(/^[a-f0-9]{64}$/u),
    evaluationEvidenceId: z.string().regex(/^[a-f0-9]{64}$/u),
    baselineId: z.string().regex(/^[a-f0-9]{64}$/u),
    baselineTreeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    modelIdentity: z.string().min(1).max(2_048),
  }),
  cost: z.strictObject({
    modelCalls: z.union([z.literal(0), z.literal(1)]),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  candidateId: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  holdoutEnvelopeId: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  retryAt: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((state, context) => {
  if (['prepared', 'holdout-deferred', 'holdout-blocked', 'budget-deferred', 'cancelled'].includes(state.phase)
    && state.cost.modelCalls !== 0) {
    context.addIssue({ code: 'custom', message: 'pre-dispatch existing Skill state records a model call' })
  }
  if (['authoring-pending', 'uncertain', 'incomplete', 'candidate-ready'].includes(state.phase)
    && state.cost.modelCalls !== 1) {
    context.addIssue({ code: 'custom', message: 'post-dispatch existing Skill state omits its model call' })
  }
  if ((state.phase === 'holdout-deferred' || state.phase === 'budget-deferred')
    !== (state.retryAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'existing Skill deferred state is inconsistent' })
  }
})

type ExistingSkillAuthoringState = z.infer<typeof stateSchema>

export interface ExistingSkillAuthorInput {
  readonly idempotencyKey: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly evaluationEvidenceId: string
  readonly baseline: {
    readonly id: string
    readonly treeHash: string
    readonly files: readonly {
      readonly path: string
      readonly mode: '100644'
      readonly size: number
      readonly digest: string
      readonly representation: 'utf8' | 'binary'
      readonly content?: string
    }[]
  }
  readonly authoringCases: ExistingSkillAuthoringEvidence['authoringCases']
  readonly signal?: AbortSignal
}

export interface ExistingSkillAuthorResult {
  readonly claim: string
  readonly changes: readonly ExistingSkillInstructionChange[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type ExistingSkillCandidateAuthoringPhase = ExistingSkillAuthoringState['phase']

export interface ExistingSkillCandidateAuthoringRunView {
  readonly id: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly evaluationEvidenceId: string
  readonly baselineId: string
  readonly phase: ExistingSkillCandidateAuthoringPhase
  readonly createdAt: string
  readonly updatedAt: string
  readonly modelCalls: 0 | 1
  readonly inputTokens: number
  readonly outputTokens: number
  readonly candidateId?: string
  readonly holdoutEnvelopeId?: string
  readonly retryAt?: number
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillCandidateAuthoringScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly ExistingSkillCandidateAuthoringRunView[]
}

export interface ExistingSkillCandidateAuthoringOptions {
  readonly policies: readonly SkillOpportunityAuthoringPolicyConfig[]
  readonly opportunities: Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discoverImprovements'>
  readonly qualification: Pick<ExistingSkillBaselineQualification, 'qualify'>
  readonly evaluationEvidence: Pick<ExistingSkillEvaluationEvidenceVault, 'prepare'>
  readonly holdoutGovernance: Pick<ExistingSkillHoldoutGovernance, 'ensure'>
  readonly candidates: {
    listExistingCandidates(workspaceId?: string, opportunityId?: string): ExistingSkillCandidate[]
    quarantineExisting(input: ExistingSkillCandidateProposal): ReturnType<SkillCandidateRepository['quarantineExisting']>
  }
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly authorModel?: (input: ExistingSkillAuthorInput) => Promise<ExistingSkillAuthorResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

type AuthoringTarget = SkillOpportunityAuthoringPolicyConfig & { readonly skill: string; readonly runRoot: string }

/**
 * Turn exact cross-Goal corrections for an installed Skill into one bounded,
 * instruction-only whole-tree Candidate. This Module has no evaluation,
 * activation, installation, or release interface.
 */
export class ExistingSkillCandidateAuthoring {
  private readonly policies = new Map<string, SkillOpportunityAuthoringPolicyConfig>()
  private readonly opportunities: ExistingSkillCandidateAuthoringOptions['opportunities']
  private readonly qualification: ExistingSkillCandidateAuthoringOptions['qualification']
  private readonly evaluationEvidence: ExistingSkillCandidateAuthoringOptions['evaluationEvidence']
  private readonly holdoutGovernance: ExistingSkillCandidateAuthoringOptions['holdoutGovernance']
  private readonly candidates: ExistingSkillCandidateAuthoringOptions['candidates']
  private readonly budget: ExistingSkillCandidateAuthoringOptions['budget']
  private readonly authorModel: NonNullable<ExistingSkillCandidateAuthoringOptions['authorModel']>
  private readonly modelIdentity: NonNullable<ExistingSkillCandidateAuthoringOptions['modelIdentity']>
  private readonly now: NonNullable<ExistingSkillCandidateAuthoringOptions['now']>
  private readonly active = new Set<string>()
  private reconcileTail: Promise<void> = Promise.resolve()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: ExistingSkillCandidateAuthoringOptions) {
    assertPolicies(options.policies)
    for (const policy of options.policies) {
      this.policies.set(policy.workspaceId, Object.freeze({ ...policy, runRoot: resolve(policy.runRoot) }))
    }
    this.opportunities = options.opportunities
    this.qualification = options.qualification
    this.evaluationEvidence = options.evaluationEvidence
    this.holdoutGovernance = options.holdoutGovernance
    this.candidates = options.candidates
    this.budget = options.budget
    this.authorModel = options.authorModel ?? requestExistingSkillAuthor
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
    this.now = options.now ?? Date.now
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing Skill Candidate authoring Jobs seam is already attached')
    this.jobs = jobs
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  reconcile(workspaceId?: string): Promise<{ readonly scheduled: number; readonly warnings: string[] }> {
    let result: { readonly scheduled: number; readonly warnings: string[] } = { scheduled: 0, warnings: [] }
    const task = this.reconcileTail.then(async () => {
      result = await this.reconcileNow(workspaceId)
    })
    this.reconcileTail = task.then(() => {}, () => {})
    return task.then(() => result)
  }

  async scan(workspaceId?: string): Promise<ExistingSkillCandidateAuthoringScan> {
    const runs: ExistingSkillCandidateAuthoringRunView[] = []
    let warningCount = 0
    let configuredPolicyCount = 0
    for (const policy of this.policies.values()) {
      if (workspaceId !== undefined && policy.workspaceId !== workspaceId) continue
      configuredPolicyCount += 1
      let skillEntries
      try {
        skillEntries = await readdir(join(policy.runRoot, 'existing-skills'), { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        warningCount += 1
        continue
      }
      for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory() || !PUBLIC_ID.test(skillEntry.name)) continue
        const target = resolveTarget(policy, skillEntry.name)
        let runEntries
        try {
          runEntries = await readdir(join(target.runRoot, 'runs'), { withFileTypes: true })
        } catch {
          warningCount += 1
          continue
        }
        for (const runEntry of runEntries) {
          if (!runEntry.isDirectory() || !CONTENT_ID.test(runEntry.name)) continue
          try {
            const state = await loadState(join(target.runRoot, 'runs', runEntry.name))
            if (state.identity.targetId !== policy.id
              || state.identity.workspaceId !== policy.workspaceId
              || state.identity.skillName !== target.skill) {
              warningCount += 1
              continue
            }
            runs.push(projectAuthoringState(state))
          } catch {
            warningCount += 1
          }
        }
      }
    }
    return Object.freeze({
      configuredPolicyCount,
      warningCount,
      runs: Object.freeze(runs.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))),
    })
  }

  private async reconcileNow(
    workspaceId?: string,
  ): Promise<{ readonly scheduled: number; readonly warnings: string[] }> {
    const jobs = this.jobs
    if (jobs === undefined) return { scheduled: 0, warnings: ['native Jobs unavailable'] }
    const existing = this.candidates.listExistingCandidates(workspaceId)
    const opportunities = this.opportunities.discoverImprovements(workspaceId)
    const warnings: string[] = []
    let scheduled = 0
    for (const opportunity of opportunities) {
      if (scheduled >= 1 || existing.some(candidate => candidate.opportunity.id === opportunity.id)) continue
      const policy = this.policies.get(opportunity.workspaceId)
      if (policy === undefined || (workspaceId !== undefined && opportunity.workspaceId !== workspaceId)) continue
      try {
        const prepared = await this.evaluationEvidence.prepare(opportunity)
        if (prepared.status !== 'ready') continue
        const qualified = await this.qualification.qualify(opportunity)
        if (qualified.status !== 'qualified') continue
        assertAuthoringBinding(opportunity, prepared.evidence, qualified)
        const target = resolveTarget(policy, opportunity.skillName)
        const modelIdentity = this.modelIdentity()
        if (modelIdentity.trim() === '' || Buffer.byteLength(modelIdentity) > 2_048) {
          throw new Error('existing Skill Candidate authoring model identity is invalid')
        }
        const identity = authoringIdentity(target, opportunity, prepared.evidence, qualified, modelIdentity)
        const input = buildAuthorInput(target, opportunity, prepared.evidence, qualified, identity)
        const runDir = join(target.runRoot, 'runs', input.idempotencyKey)
        let state = await prepareState(runDir, input.idempotencyKey, identity, this.now())
        if (state.phase === 'authoring-pending') {
          state = await updateState(runDir, state, {
            phase: 'uncertain',
            reason: 'paid authoring outcome is uncertain after restart; refusing automatic retry',
          }, this.now())
        }
        if ((state.phase === 'holdout-deferred' || state.phase === 'budget-deferred')
          && state.retryAt !== undefined
          && state.retryAt <= this.now()) {
          state = await updateState(runDir, state, {
            phase: 'prepared',
            retryAt: undefined,
            reason: undefined,
          }, this.now())
        }
        if (state.phase !== 'prepared') continue
        if (this.active.has(input.idempotencyKey)) continue
        this.schedule(
          jobs,
          target,
          opportunity,
          prepared.evidence,
          qualified,
          input,
          modelIdentity,
          state,
          runDir,
        )
        scheduled += 1
      } catch (error) {
        warnings.push(`existing Skill Candidate authoring skipped ${opportunity.skillName}: ${errorDetail(error)}`)
      }
    }
    return { scheduled, warnings }
  }

  private schedule(
    jobs: Pick<JobRegistry, 'start'>,
    target: AuthoringTarget,
    opportunity: SkillImprovementOpportunity,
    evidence: ExistingSkillAuthoringEvidence,
    qualified: Extract<ExistingSkillBaselineQualificationResult, { status: 'qualified' }>,
    input: ExistingSkillAuthorInput,
    modelIdentity: string,
    state: ExistingSkillAuthoringState,
    runDir: string,
  ): void {
    this.active.add(input.idempotencyKey)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `existing Skill Candidate authoring: ${target.skill}`,
        outputLimitBytes: 2_048,
        run: () => {
          const done = this.runAuthoring(
            target,
            opportunity,
            evidence,
            qualified,
            { ...input, signal: controller.signal },
            modelIdentity,
            controller,
            state,
            runDir,
          )
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'existing Skill Candidate authoring cancelled'),
            ),
            done: done.then(result => ({
              status: controller.signal.aborted
                ? 'killed' as const
                : result.phase === 'candidate-ready'
                    || result.phase === 'budget-deferred'
                    || result.phase === 'holdout-deferred'
                  ? 'completed' as const
                  : 'failed' as const,
              detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : result.detail,
              ...(result.candidateId === undefined ? {} : { output: `quarantined: ${result.candidateId}` }),
            })).finally(() => this.active.delete(input.idempotencyKey)),
          }
        },
      })
    } catch (error) {
      this.active.delete(input.idempotencyKey)
      throw error
    }
  }

  private async runAuthoring(
    target: AuthoringTarget,
    opportunity: SkillImprovementOpportunity,
    evidence: ExistingSkillAuthoringEvidence,
    qualified: Extract<ExistingSkillBaselineQualificationResult, { status: 'qualified' }>,
    input: ExistingSkillAuthorInput,
    modelIdentity: string,
    controller: AbortController,
    initial: ExistingSkillAuthoringState,
    runDir: string,
  ): Promise<{ readonly phase: 'candidate-ready' | 'holdout-deferred' | 'holdout-blocked' | 'budget-deferred' | 'uncertain' | 'incomplete'; readonly detail: string; readonly candidateId?: string }> {
    if (controller.signal.aborted) {
      await updateState(runDir, initial, {
        phase: 'cancelled',
        reason: errorDetail(controller.signal.reason),
      }, this.now())
      return { phase: 'incomplete', detail: errorDetail(controller.signal.reason) }
    }
    let state = initial
    try {
      const governance = await this.holdoutGovernance.ensure({
        opportunity,
        qualification: qualified.qualification,
        baseline: qualified.baseline,
        evidence,
        proposerModelIdentityHash: sha256(Buffer.from(modelIdentity)),
      }, { signal: controller.signal })
      if (governance.status === 'budget-deferred') {
        await updateState(runDir, state, {
          phase: 'holdout-deferred',
          retryAt: governance.retryAt,
          reason: 'independent existing-Skill holdout governance budget exhausted',
        }, this.now())
        return { phase: 'holdout-deferred', detail: 'holdout-deferred' }
      }
      state = await updateState(runDir, state, {
        phase: 'prepared',
        holdoutEnvelopeId: governance.envelope.id,
        retryAt: undefined,
        reason: undefined,
      }, this.now())
    } catch (error) {
      const detail = errorDetail(error)
      await updateState(runDir, state, {
        phase: 'holdout-blocked',
        retryAt: undefined,
        reason: `independent existing-Skill holdout governance failed closed: ${detail}`,
      }, this.now())
      return { phase: 'holdout-blocked', detail: `holdout-blocked: ${detail}` }
    }
    if (controller.signal.aborted) {
      await updateState(runDir, state, {
        phase: 'cancelled',
        reason: errorDetail(controller.signal.reason),
      }, this.now())
      return { phase: 'incomplete', detail: errorDetail(controller.signal.reason) }
    }
    const reservation = await this.budget.reserve(target, input.idempotencyKey)
    if (!reservation.allowed) {
      await updateState(runDir, state, {
        phase: 'budget-deferred',
        retryAt: reservation.retryAt,
        reason: 'daily paid authoring budget exhausted',
      }, this.now())
      return { phase: 'budget-deferred', detail: 'budget-deferred' }
    }
    state = await updateState(runDir, state, {
      phase: 'authoring-pending',
      cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      retryAt: undefined,
      reason: undefined,
    }, this.now())
    let received = false
    try {
      const result = await this.authorModel(input)
      received = true
      if (controller.signal.aborted) {
        await updateState(runDir, state, {
          phase: 'uncertain',
          reason: 'paid authoring completed after cancellation; Candidate was not written',
        }, this.now())
        return { phase: 'uncertain', detail: 'paid authoring completed after cancellation; Candidate was not written' }
      }
      const authored = validateAuthorResult(result)
      const recorded = await this.candidates.quarantineExisting({
        createdAt: this.now(),
        policyId: target.id,
        modelIdentity,
        claim: authored.claim,
        opportunity,
        qualification: qualified.qualification,
        baseline: qualified.baseline,
        evidence,
        changes: authored.changes,
      })
      state = await updateState(runDir, state, {
        phase: 'candidate-ready',
        candidateId: recorded.candidate.id,
        cost: {
          modelCalls: 1,
          inputTokens: authored.usage.inputTokens,
          outputTokens: authored.usage.outputTokens,
        },
      }, this.now())
      return { phase: 'candidate-ready', detail: 'candidate-ready', candidateId: recorded.candidate.id }
    } catch (error) {
      const phase = received ? 'incomplete' as const : 'uncertain' as const
      await updateState(runDir, state, {
        phase,
        reason: `${phase === 'uncertain' ? 'paid authoring outcome is uncertain; refusing automatic retry: ' : ''}${errorDetail(error)}`,
      }, this.now())
      return {
        phase,
        detail: `${phase}: ${errorDetail(error)}`,
      }
    }
  }
}

function buildAuthorInput(
  target: AuthoringTarget,
  opportunity: SkillImprovementOpportunity,
  evidence: ExistingSkillAuthoringEvidence,
  qualified: Extract<ExistingSkillBaselineQualificationResult, { status: 'qualified' }>,
  identity: ExistingSkillAuthoringState['identity'],
): ExistingSkillAuthorInput {
  const files: ExistingSkillAuthorInput['baseline']['files'][number][] = []
  let modelBytes = 0
  for (const file of qualified.baseline.files) {
    const digest = sha256(file.content)
    let content: string | undefined
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.content)
      if (Buffer.from(decoded).equals(file.content)) content = decoded
    } catch {
      // Binary package resources are represented only by exact metadata.
    }
    if (content !== undefined) {
      modelBytes += Buffer.byteLength(content)
      if (modelBytes > MAX_BASELINE_MODEL_BYTES) {
        throw new Error('existing Skill editable baseline exceeds the proposer input budget')
      }
    }
    files.push(Object.freeze({
      path: file.path,
      mode: file.mode,
      size: file.content.byteLength,
      digest,
      representation: content === undefined ? 'binary' : 'utf8',
      ...(content === undefined ? {} : { content }),
    }))
  }
  const input: ExistingSkillAuthorInput = Object.freeze({
    idempotencyKey: sha256(Buffer.from(JSON.stringify(identity))),
    targetId: target.id,
    workspaceId: opportunity.workspaceId,
    skillName: opportunity.skillName,
    opportunityId: opportunity.id,
    qualificationId: qualified.qualification.id,
    evaluationEvidenceId: evidence.id,
    baseline: Object.freeze({
      id: qualified.baseline.manifest.id,
      treeHash: qualified.baseline.manifest.bundle.treeHash,
      files: Object.freeze(files),
    }),
    authoringCases: evidence.authoringCases,
  })
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_AUTHOR_INPUT_BYTES) {
    throw new Error('existing Skill Candidate author input exceeds its byte budget')
  }
  return input
}

function authoringIdentity(
  target: AuthoringTarget,
  opportunity: SkillImprovementOpportunity,
  evidence: ExistingSkillAuthoringEvidence,
  qualified: Extract<ExistingSkillBaselineQualificationResult, { status: 'qualified' }>,
  modelIdentity: string,
): ExistingSkillAuthoringState['identity'] {
  return Object.freeze({
    policyVersion: POLICY_VERSION,
    targetId: target.id,
    workspaceId: opportunity.workspaceId,
    skillName: opportunity.skillName,
    opportunityId: opportunity.id,
    qualificationId: qualified.qualification.id,
    evaluationEvidenceId: evidence.id,
    baselineId: qualified.baseline.manifest.id,
    baselineTreeHash: qualified.baseline.manifest.bundle.treeHash,
    inputDigest: evidence.authoringInputDigest,
    modelIdentity,
  })
}

function assertAuthoringBinding(
  opportunity: SkillImprovementOpportunity,
  evidence: ExistingSkillAuthoringEvidence,
  qualified: Extract<ExistingSkillBaselineQualificationResult, { status: 'qualified' }>,
): void {
  if (evidence.workspaceId !== opportunity.workspaceId
    || evidence.opportunityId !== opportunity.id
    || evidence.qualificationId !== qualified.qualification.id
    || evidence.baselineId !== qualified.baseline.manifest.id
    || evidence.skillName !== opportunity.skillName
    || qualified.qualification.opportunityId !== opportunity.id
    || qualified.qualification.baseline.id !== qualified.baseline.manifest.id
    || evidence.proposerCanReadProtectedSamples !== false
    || evidence.releaseAuthority !== 'none') {
    throw new Error('existing Skill Candidate authoring inputs do not bind one exact protected baseline')
  }
}

function validateAuthorResult(input: ExistingSkillAuthorResult): ExistingSkillAuthorResult {
  if (!isRecord(input)
    || Object.keys(input).sort().join(',') !== 'changes,claim,usage'
    || typeof input.claim !== 'string'
    || input.claim.trim() === ''
    || Buffer.byteLength(input.claim) > 2_048
    || !Array.isArray(input.changes)
    || input.changes.length < 1
    || input.changes.length > 32
    || !isUsage(input.usage)) {
    throw new Error('existing Skill Candidate author response has an invalid shape')
  }
  return Object.freeze({
    claim: input.claim.trim(),
    changes: Object.freeze(input.changes.map(change => Object.freeze({ ...change }))),
    usage: Object.freeze({ ...input.usage }),
  })
}

async function prepareState(
  runDir: string,
  id: string,
  identity: ExistingSkillAuthoringState['identity'],
  now: number,
): Promise<ExistingSkillAuthoringState> {
  await ensureRunRoot(dirname(dirname(runDir)))
  try {
    const existing = await loadState(runDir)
    if (existing.id !== id || JSON.stringify(existing.identity) !== JSON.stringify(identity)) {
      throw new Error('existing Skill Candidate authoring run identity changed')
    }
    return existing
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const instant = isoTime(now)
  const state = stateSchema.parse({
    schemaVersion: 1,
    id,
    phase: 'prepared',
    createdAt: instant,
    updatedAt: instant,
    identity,
    cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  })
  await writeDurableJson(join(runDir, 'state.json'), state)
  return state
}

async function loadState(runDir: string): Promise<ExistingSkillAuthoringState> {
  const info = await lstat(runDir)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runDir) !== runDir) {
    throw new Error('existing Skill Candidate authoring run must be an exact real directory')
  }
  const path = join(runDir, 'state.json')
  const stateInfo = await lstat(path)
  if (!stateInfo.isFile() || stateInfo.isSymbolicLink() || stateInfo.size > MAX_STATE_BYTES
    || await realpath(path) !== path) {
    throw new Error('existing Skill Candidate authoring state must be an exact bounded file')
  }
  return stateSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function updateState(
  runDir: string,
  state: ExistingSkillAuthoringState,
  patch: Partial<Pick<ExistingSkillAuthoringState,
    'phase' | 'cost' | 'candidateId' | 'holdoutEnvelopeId' | 'retryAt' | 'reason'>>,
  now: number,
): Promise<ExistingSkillAuthoringState> {
  const next = stateSchema.parse({ ...state, ...patch, updatedAt: isoTime(now) })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

async function ensureRunRoot(runRoot: string): Promise<void> {
  await mkdir(runRoot, { recursive: true, mode: 0o700 })
  const info = await lstat(runRoot)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runRoot) !== runRoot) {
    throw new Error('existing Skill Candidate authoring run root must be an exact real directory')
  }
  const runs = join(runRoot, 'runs')
  await mkdir(runs, { recursive: true, mode: 0o700 })
  if (await realpath(runs) !== runs) {
    throw new Error('existing Skill Candidate authoring runs path must be exact')
  }
}

function assertPolicies(policies: readonly SkillOpportunityAuthoringPolicyConfig[]): void {
  if (policies.length < 1 || policies.length > MAX_POLICIES) {
    throw new Error(`existing Skill Candidate authoring requires 1-${MAX_POLICIES} Workspace policies`)
  }
  if (policies.some(policy => !PUBLIC_ID.test(policy.id)
    || !isWorkspaceId(policy.workspaceId)
    || !isAbsolute(policy.runRoot)
    || dirname(resolve(policy.runRoot)) === resolve(policy.runRoot)
    || !Number.isInteger(policy.maxAttemptsPerUtcDay)
    || policy.maxAttemptsPerUtcDay < 1
    || policy.maxAttemptsPerUtcDay > 20)) {
    throw new Error('existing Skill Candidate authoring policy is invalid')
  }
  if (new Set(policies.map(policy => policy.id)).size !== policies.length
    || new Set(policies.map(policy => policy.workspaceId)).size !== policies.length
    || new Set(policies.map(policy => resolve(policy.runRoot))).size !== policies.length) {
    throw new Error('existing Skill Candidate authoring policies must be unique per Workspace')
  }
}

function resolveTarget(policy: SkillOpportunityAuthoringPolicyConfig, skill: string): AuthoringTarget {
  if (!PUBLIC_ID.test(skill)) throw new Error('existing Skill improvement name is invalid')
  return Object.freeze({ ...policy, skill, runRoot: join(policy.runRoot, 'existing-skills', skill) })
}

async function requestExistingSkillAuthor(input: ExistingSkillAuthorInput): Promise<ExistingSkillAuthorResult> {
  const baseUrl = requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL')
  const model = requireEnvironment('DSH_EVOLVE_MODEL_NAME')
  const apiKey = process.env.DSH_EVOLVE_MODEL_API_KEY
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey,
  }
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: AUTHOR_OUTPUT_TOKEN_LIMIT,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Improve one existing DSH Skill only from its exact sealed baseline and supplied internal correction cases.',
            'Return JSON only with exactly claim and changes.',
            'changes is 1-32 {path, content} replacements or additions.',
            'Only SKILL.md and one-level references/*.md may change; do not delete or rename files.',
            'Preserve the exact YAML Skill name and license; do not change scripts, binaries, credentials, permissions, or effects.',
            'Do not search, cite, or invent external sources, hidden tests, outcomes, or permissions.',
            'Binary entries are immutable metadata; the Host preserves every unmodified package file.',
            'The result is inactive, quarantined, unevaluated, never executed, and has no release authority.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
    signal: input.signal === undefined
      ? AbortSignal.timeout(60_000)
      : AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) throw new Error(`existing Skill Candidate author request failed with HTTP ${response.status}`)
  const payload = await readBoundedResponseJson(response)
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])
    || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== 'string') {
    throw new Error('existing Skill Candidate author response has no content')
  }
  const authored = JSON.parse(payload.choices[0].message.content) as unknown
  if (!isRecord(authored)) throw new Error('existing Skill Candidate author response content is invalid')
  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    ...authored,
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
  } as unknown as ExistingSkillAuthorResult
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_AUTHOR_RESPONSE_BYTES)) {
    throw new Error('existing Skill Candidate author response exceeds its byte limit')
  }
  if (response.body === null) throw new Error('existing Skill Candidate author response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > MAX_AUTHOR_RESPONSE_BYTES) {
        await reader.cancel('existing Skill Candidate author response exceeds its byte limit')
        throw new Error('existing Skill Candidate author response exceeds its byte limit')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    Buffer.concat(chunks.map(chunk => Buffer.from(chunk))),
  ))
}

function configuredModelIdentity(): string {
  return boundedModelProviderIdentity(
    requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL'),
    requireEnvironment('DSH_EVOLVE_MODEL_NAME'),
  )
}

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`existing Skill Candidate authoring requires ${name}`)
  }
  return value
}

function isUsage(value: unknown): value is ExistingSkillAuthorResult['usage'] {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === 'inputTokens,outputTokens'
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0
}

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isoTime(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('existing Skill Candidate authoring clock is invalid')
  }
  return new Date(value).toISOString()
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown error'
}

function projectAuthoringState(
  state: ExistingSkillAuthoringState,
): ExistingSkillCandidateAuthoringRunView {
  return Object.freeze({
    id: state.id,
    targetId: state.identity.targetId,
    workspaceId: state.identity.workspaceId,
    skillName: state.identity.skillName,
    opportunityId: state.identity.opportunityId,
    qualificationId: state.identity.qualificationId,
    evaluationEvidenceId: state.identity.evaluationEvidenceId,
    baselineId: state.identity.baselineId,
    phase: state.phase,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    modelCalls: state.cost.modelCalls,
    inputTokens: state.cost.inputTokens,
    outputTokens: state.cost.outputTokens,
    ...(state.candidateId === undefined ? {} : { candidateId: state.candidateId }),
    ...(state.holdoutEnvelopeId === undefined ? {} : { holdoutEnvelopeId: state.holdoutEnvelopeId }),
    ...(state.retryAt === undefined ? {} : { retryAt: state.retryAt }),
    releaseAuthority: 'none',
  })
}
