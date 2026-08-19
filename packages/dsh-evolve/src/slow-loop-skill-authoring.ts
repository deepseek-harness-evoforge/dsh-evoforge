import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import { assembleSkillBundleArchive, type SkillBundleTextFile } from './skill-bundle-archive.ts'
import type { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import type { ExperienceDrivenSkillOpportunityDiscovery, SkillOpportunity } from './skill-opportunity-discovery.ts'
import type {
  SkillAuthoringEvidence,
  SkillEvaluationEvidenceVault,
} from './skill-evaluation-evidence-vault.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import type {
  SkillCandidateProposal,
  ExperienceSkillCandidate,
} from './skill-candidate-repository.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 20
const MAX_AUTHOR_INPUT_BYTES = 48 * 1024
const MAX_AUTHOR_RESPONSE_BYTES = 128 * 1024
const MAX_STATE_BYTES = 64 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 6_000
const POLICY_VERSION = 'internal-experience-whole-skill-author-v2'

export interface SkillOpportunityAuthoringPolicyConfig {
  readonly id: string
  readonly workspaceId: string
  readonly runRoot: string
  readonly maxAttemptsPerUtcDay: number
}

type ResolvedAuthoringTarget = SkillOpportunityAuthoringPolicyConfig & {
  readonly skill: string
}

/** Refuse any authoring journal that could mutate discovery or governance inputs. */
export function assertSlowLoopSkillAuthoringRootSeparation(
  targets: readonly SkillOpportunityAuthoringPolicyConfig[],
  protectedRoots: readonly string[],
): void {
  for (const target of targets) {
    const authorRoot = resolve(target.runRoot)
    for (const input of protectedRoots) {
      if (!isAbsolute(input)) continue
      const protectedRoot = resolve(input)
      if (containsPath(authorRoot, protectedRoot) || containsPath(protectedRoot, authorRoot)) {
        throw new Error('slow-loop Skill authoring run roots must not overlap Candidate or governance roots')
      }
    }
  }
}

export interface SlowLoopSkillAuthorInput {
  readonly idempotencyKey: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly evaluationEvidenceId: string
  readonly gapIds: readonly string[]
  readonly goalEvidence: readonly {
    readonly id: string
    readonly revision: number
    readonly objective: string
  }[]
  readonly signal?: AbortSignal
}

export interface SlowLoopSkillAuthorResult {
  readonly files: readonly SkillBundleTextFile[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type SlowLoopSkillAuthoringPhase =
  | 'prepared'
  | 'budget-deferred'
  | 'cancelled'
  | 'authoring-pending'
  | 'uncertain'
  | 'incomplete'
  | 'candidate-ready'

export interface SlowLoopSkillAuthoringRunView {
  readonly id: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly gapCount: number
  readonly goalCount: number
  readonly phase: SlowLoopSkillAuthoringPhase
  readonly createdAt: string
  readonly updatedAt: string
  readonly modelCalls: 0 | 1
  readonly inputTokens: number
  readonly outputTokens: number
  readonly candidateId?: string
  readonly retryAt?: number
  readonly releaseAuthority: 'none'
}

export interface SlowLoopSkillAuthoringScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly SlowLoopSkillAuthoringRunView[]
}

interface SlowLoopSkillAuthoringOptions {
  readonly policies: readonly SkillOpportunityAuthoringPolicyConfig[]
  readonly opportunities: Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discover'>
  readonly evaluationEvidence: Pick<SkillEvaluationEvidenceVault, 'prepare'>
  readonly candidates: {
    listCandidates(workspaceId?: string, opportunityId?: string): ExperienceSkillCandidate[]
    quarantine(input: SkillCandidateProposal): Promise<{
      readonly created: boolean
      readonly candidate: ExperienceSkillCandidate
    }>
  }
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly authorModel?: (input: SlowLoopSkillAuthorInput) => Promise<SlowLoopSkillAuthorResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

const stateSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: z.string().regex(CONTENT_ID),
  phase: z.enum([
    'prepared',
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
    opportunityId: z.string().regex(CONTENT_ID),
    evaluationEvidenceId: z.string().regex(CONTENT_ID),
    gapIds: z.array(z.string().regex(CONTENT_ID)).min(2).max(1_000),
    goalCount: z.number().int().min(2).max(1_000),
    inputDigest: z.string().regex(CONTENT_ID),
    modelIdentity: z.string().min(1).max(2_048),
  }),
  cost: z.strictObject({
    modelCalls: z.union([z.literal(0), z.literal(1)]),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  candidateId: z.string().regex(CONTENT_ID).optional(),
  retryAt: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((state, context) => {
  if (['prepared', 'budget-deferred', 'cancelled'].includes(state.phase)
    && state.cost.modelCalls !== 0) {
    context.addIssue({ code: 'custom', message: 'pre-authoring slow-loop state records a model call' })
  }
  if (['authoring-pending', 'uncertain', 'candidate-ready'].includes(state.phase)
    && state.cost.modelCalls !== 1) {
      context.addIssue({ code: 'custom', message: 'post-dispatch slow-loop state omits its model call' })
  }
})

type SlowLoopRunState = z.infer<typeof stateSchema>

/**
 * Turn repeated cross-Goal demand into one bounded native Job. This module can
 * only write a quarantined Candidate; it has no install, activation, or release interface.
 */
export class SlowLoopSkillAuthoring {
  private readonly policies = new Map<string, SkillOpportunityAuthoringPolicyConfig>()
  private readonly opportunities: SlowLoopSkillAuthoringOptions['opportunities']
  private readonly evaluationEvidence: SlowLoopSkillAuthoringOptions['evaluationEvidence']
  private readonly candidates: SlowLoopSkillAuthoringOptions['candidates']
  private readonly budget: SlowLoopSkillAuthoringOptions['budget']
  private readonly authorModel: NonNullable<SlowLoopSkillAuthoringOptions['authorModel']>
  private readonly modelIdentity: NonNullable<SlowLoopSkillAuthoringOptions['modelIdentity']>
  private readonly now: NonNullable<SlowLoopSkillAuthoringOptions['now']>
  private readonly active = new Set<string>()
  private reconcileTail: Promise<void> = Promise.resolve()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: SlowLoopSkillAuthoringOptions) {
    assertPolicies(options.policies)
    for (const input of options.policies) {
      this.policies.set(input.workspaceId, Object.freeze({
        ...input,
        runRoot: resolve(input.runRoot),
      }))
    }
    this.opportunities = options.opportunities
    this.evaluationEvidence = options.evaluationEvidence
    this.candidates = options.candidates
    this.budget = options.budget
    this.authorModel = options.authorModel ?? requestSlowLoopSkillAuthor
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
    this.now = options.now ?? Date.now
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('slow-loop Skill authoring Jobs seam is already attached')
    this.jobs = jobs
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  reconcile(workspaceId?: string): Promise<{ readonly scheduled: number; readonly warnings: string[] }> {
    let result: { readonly scheduled: number; readonly warnings: string[] } = {
      scheduled: 0,
      warnings: [],
    }
    const task = this.reconcileTail.then(async () => {
      result = await this.reconcileNow(workspaceId)
    })
    this.reconcileTail = task.then(() => {}, () => {})
    return task.then(() => result)
  }

  async scan(workspaceId?: string): Promise<SlowLoopSkillAuthoringScan> {
    const runs: SlowLoopSkillAuthoringRunView[] = []
    let warningCount = 0
    let configuredPolicyCount = 0
    for (const policy of this.policies.values()) {
      if (workspaceId !== undefined && policy.workspaceId !== workspaceId) continue
      configuredPolicyCount += 1
      let skillEntries
      try {
        skillEntries = await readdir(join(policy.runRoot, 'skills'), { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        warningCount += 1
        continue
      }
      for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory() || !PUBLIC_ID.test(skillEntry.name)) continue
        const target = resolveTarget(policy, skillEntry.name)
        let entries
        try {
          entries = await readdir(join(target.runRoot, 'runs'), { withFileTypes: true })
        } catch {
          warningCount += 1
          continue
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
          try {
            const state = await loadState(join(target.runRoot, 'runs', entry.name))
            if (!samePolicy(state, policy) || state.identity.skillName !== target.skill) {
              warningCount += 1
              continue
            }
            runs.push(projectState(state))
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
    const candidates = this.candidates.listCandidates(workspaceId)
    const opportunities = this.opportunities.discover(workspaceId)
    const warnings: string[] = []
    let scheduled = 0

    for (const opportunity of opportunities) {
      if (scheduled >= 1
        || candidates.some(candidate => candidate.workspaceId === opportunity.workspaceId
          && candidate.skillName === opportunity.skillName)) continue
      const policy = this.policies.get(opportunity.workspaceId)
      if (policy === undefined || (workspaceId !== undefined && policy.workspaceId !== workspaceId)) continue
      const target = resolveTarget(policy, opportunity.skillName)
      try {
        const prepared = await this.evaluationEvidence.prepare(opportunity)
        if (prepared.status === 'abstained') continue
        const evidence = prepared.evidence
        assertAuthorInputBudget(target, opportunity, evidence)
        const identity = this.buildIdentity(target, opportunity, evidence)
        const runDir = join(target.runRoot, 'runs', identity.id)
        let state = await prepareState(runDir, identity, this.now())
        if (state.phase === 'authoring-pending') {
          state = await updateState(runDir, state, {
            phase: 'uncertain',
            reason: 'paid authoring outcome is uncertain after restart; refusing automatic retry',
          }, this.now())
        }
        if (state.phase === 'budget-deferred'
          && state.retryAt !== undefined
          && state.retryAt <= this.now()) {
          state = await updateState(runDir, state, {
            phase: 'prepared',
            retryAt: undefined,
            reason: undefined,
          }, this.now())
        }
        if (state.phase !== 'prepared' || this.active.has(state.id)) continue
        this.schedule(jobs, target, opportunity, evidence, state, runDir)
        scheduled += 1
      } catch (error) {
        warnings.push(`slow-loop Skill authoring skipped ${opportunity.skillName}: ${errorDetail(error)}`)
      }
    }
    return { scheduled, warnings }
  }

  private buildIdentity(
    target: ResolvedAuthoringTarget,
    opportunity: SkillOpportunity,
    evidence: SkillAuthoringEvidence,
  ): SlowLoopRunState['identity'] & { readonly id: string } {
    const modelIdentity = this.modelIdentity()
    if (modelIdentity.trim() === '' || Buffer.byteLength(modelIdentity) > 2_048) {
      throw new Error('slow-loop Skill authoring model identity is invalid')
    }
    const identity = {
      policyVersion: POLICY_VERSION,
      targetId: target.id,
      workspaceId: target.workspaceId,
      skillName: target.skill,
      opportunityId: opportunity.id,
      evaluationEvidenceId: evidence.id,
      gapIds: [...opportunity.gapIds].sort(),
      goalCount: opportunity.goalCount,
      inputDigest: evidence.authoringInputDigest,
      modelIdentity,
    } as const
    return Object.freeze({
      ...identity,
      id: sha256(JSON.stringify(identity)),
    })
  }

  private schedule(
    jobs: Pick<JobRegistry, 'start'>,
    target: ResolvedAuthoringTarget,
    opportunity: SkillOpportunity,
    evidence: SkillAuthoringEvidence,
    state: SlowLoopRunState,
    runDir: string,
  ): void {
    this.active.add(state.id)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `slow-loop Skill authoring: ${target.skill}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.runAuthoring(
            target,
            opportunity,
            evidence,
            state,
            runDir,
            controller,
          )
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'slow-loop Skill authoring cancelled'),
            ),
            done: task.then(value => ({
              status: controller.signal.aborted
                ? 'killed' as const
                : value.phase === 'candidate-ready' || value.phase === 'budget-deferred'
                  ? 'completed' as const
                  : 'failed' as const,
              detail: controller.signal.aborted
                ? errorDetail(controller.signal.reason)
                : value.phase === 'uncertain' || value.phase === 'incomplete'
                  ? `${value.phase}: ${value.reason ?? 'authoring failed'}`
                  : value.phase,
              ...(value.candidateId === undefined ? {} : { output: `quarantined: ${value.candidateId}` }),
            })).finally(() => {
              this.active.delete(state.id)
            }),
          }
        },
      })
    } catch (error) {
      this.active.delete(state.id)
      throw error
    }
  }

  private async runAuthoring(
    target: ResolvedAuthoringTarget,
    opportunity: SkillOpportunity,
    evidence: SkillAuthoringEvidence,
    initial: SlowLoopRunState,
    runDir: string,
    controller: AbortController,
  ): Promise<SlowLoopRunState> {
    if (controller.signal.aborted) {
      return persistCancellation(runDir, initial, controller.signal.reason, this.now())
    }
    const reservation = await this.budget.reserve(target, initial.id)
    if (controller.signal.aborted) {
      return persistCancellation(runDir, initial, controller.signal.reason, this.now())
    }
    if (!reservation.allowed) {
      return updateState(runDir, initial, {
        phase: 'budget-deferred',
        retryAt: reservation.retryAt,
        reason: 'daily paid authoring budget exhausted',
      }, this.now())
    }
    let state = await updateState(runDir, initial, {
      phase: 'authoring-pending',
      cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      retryAt: undefined,
      reason: undefined,
    }, this.now())
    if (controller.signal.aborted) {
      return persistCancellation(runDir, state, controller.signal.reason, this.now())
    }
    let received = false
    try {
      const result = await this.authorModel({
        idempotencyKey: state.id,
        targetId: target.id,
        workspaceId: target.workspaceId,
        skillName: target.skill,
        opportunityId: opportunity.id,
        evaluationEvidenceId: evidence.id,
        gapIds: evidence.authoringGapIds,
        goalEvidence: evidence.authoringGoalEvidence,
        signal: controller.signal,
      })
      received = true
      if (controller.signal.aborted) {
        return updateState(runDir, state, {
          phase: 'uncertain',
          reason: 'paid authoring was cancelled after request dispatch; refusing automatic retry',
        }, this.now())
      }
      const proposal = await validateAuthorResult(result, target.skill)
      const quarantined = await this.candidates.quarantine({
        createdAt: this.now(),
        workspaceId: target.workspaceId,
        skillName: target.skill,
        policyId: target.id,
        opportunityId: opportunity.id,
        gapIds: [...opportunity.gapIds].sort(),
        goalCount: opportunity.goalCount,
        modelIdentity: state.identity.modelIdentity,
        inputDigest: state.identity.inputDigest,
        files: proposal.files,
      })
      state = await updateState(runDir, state, {
        phase: 'candidate-ready',
        candidateId: quarantined.candidate.id,
        cost: {
          modelCalls: 1,
          inputTokens: proposal.usage.inputTokens,
          outputTokens: proposal.usage.outputTokens,
        },
      }, this.now())
      return state
    } catch (error) {
      const phase = received || error instanceof ObservedAuthoringResponseError
        ? 'incomplete' as const
        : 'uncertain' as const
      return updateState(runDir, state, {
        phase,
        reason: phase === 'uncertain'
          ? `paid authoring outcome is uncertain; refusing automatic retry: ${errorDetail(error)}`
          : errorDetail(error),
      }, this.now())
    }
  }
}

function persistCancellation(
  runDir: string,
  state: SlowLoopRunState,
  reason: unknown,
  now: number,
): Promise<SlowLoopRunState> {
  return updateState(runDir, state, {
    phase: 'cancelled',
    cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
    retryAt: undefined,
    reason: errorDetail(reason),
  }, now)
}

function assertPolicies(policies: readonly SkillOpportunityAuthoringPolicyConfig[]): void {
  if (policies.length === 0 || policies.length > MAX_TARGETS) {
    throw new Error(`slow-loop Skill authoring requires 1-${MAX_TARGETS} Workspace policies`)
  }
  if (policies.some(policy => !PUBLIC_ID.test(policy.id)
    || !isWorkspaceId(policy.workspaceId))) {
    throw new Error('slow-loop Skill authoring policy identities are invalid')
  }
  if (policies.some(policy => !isAbsolute(policy.runRoot))) {
    throw new Error('slow-loop Skill authoring run roots must be absolute')
  }
  if (policies.some(policy => dirname(resolve(policy.runRoot)) === resolve(policy.runRoot))) {
    throw new Error('slow-loop Skill authoring run roots must not be filesystem roots')
  }
  if (policies.some(policy => !Number.isInteger(policy.maxAttemptsPerUtcDay)
    || policy.maxAttemptsPerUtcDay < 1
    || policy.maxAttemptsPerUtcDay > 20)) {
    throw new Error('slow-loop Skill authoring daily attempt limits must be integers between 1 and 20')
  }
  if (new Set(policies.map(policy => policy.id)).size !== policies.length
    || new Set(policies.map(policy => policy.workspaceId)).size !== policies.length
    || new Set(policies.map(policy => resolve(policy.runRoot))).size !== policies.length) {
    throw new Error('slow-loop Skill authoring policy ids, Workspaces, and run roots must be unique')
  }
  if (policies.some((policy, index) => policies.some((other, otherIndex) => index !== otherIndex
    && containsPath(resolve(policy.runRoot), resolve(other.runRoot))))) {
    throw new Error('slow-loop Skill authoring policy run roots must not overlap')
  }
}

function assertAuthorInputBudget(
  target: ResolvedAuthoringTarget,
  opportunity: SkillOpportunity,
  evidence: SkillAuthoringEvidence,
): void {
  const modelInput = JSON.stringify({
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    opportunityId: opportunity.id,
    evaluationEvidenceId: evidence.id,
    gapIds: evidence.authoringGapIds,
    goals: evidence.authoringGoalEvidence,
  })
  if (Buffer.byteLength(modelInput) > MAX_AUTHOR_INPUT_BYTES) {
    throw new Error('slow-loop authoring evidence exceeds its input budget')
  }
}

async function validateAuthorResult(
  input: SlowLoopSkillAuthorResult,
  skillName: string,
): Promise<SlowLoopSkillAuthorResult> {
  if (typeof input !== 'object' || input === null
    || Object.keys(input).sort().join(',') !== 'files,usage'
    || !Array.isArray(input.files)
    || !isUsage(input.usage)) {
    throw new Error('slow-loop Skill author response has an invalid shape')
  }
  const assembled = await assembleSkillBundleArchive(input.files)
  const skillFile = assembled.files.find(file => file.path === 'SKILL.md')
  const skillMd = skillFile?.content.toString('utf8')
  if (skillMd === undefined
    || !skillMd.startsWith('---\n')
    || !new RegExp(`(?:^|\\n)name:[ \\t]*${escapeRegExp(skillName)}[ \\t]*(?:\\n|$)`, 'u').test(skillMd)) {
    throw new Error('slow-loop authored SKILL.md name does not match its exact target')
  }
  return Object.freeze({
    files: Object.freeze(assembled.files.map(file => Object.freeze({
      path: file.path,
      content: file.content.toString('utf8'),
    }))),
    usage: Object.freeze({ ...input.usage }),
  })
}

async function prepareState(
  runDir: string,
  identity: SlowLoopRunState['identity'] & { readonly id: string },
  now: number,
): Promise<SlowLoopRunState> {
  await ensureRunRoot(dirname(dirname(runDir)))
  try {
    const existing = await loadState(runDir)
    assertIdentity(existing, identity)
    return existing
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const instant = isoTime(now)
  const state = stateSchema.parse({
    schemaVersion: 2,
    id: identity.id,
    phase: 'prepared',
    createdAt: instant,
    updatedAt: instant,
    identity: {
      policyVersion: identity.policyVersion,
      targetId: identity.targetId,
      workspaceId: identity.workspaceId,
      skillName: identity.skillName,
      opportunityId: identity.opportunityId,
      evaluationEvidenceId: identity.evaluationEvidenceId,
      gapIds: identity.gapIds,
      goalCount: identity.goalCount,
      inputDigest: identity.inputDigest,
      modelIdentity: identity.modelIdentity,
    },
    cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  })
  await writeDurableJson(join(runDir, 'state.json'), state)
  return state
}

async function ensureRunRoot(runRoot: string): Promise<void> {
  await mkdir(runRoot, { recursive: true, mode: 0o700 })
  const info = await lstat(runRoot)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runRoot) !== runRoot) {
    throw new Error('slow-loop Skill authoring run root must be an exact real directory')
  }
  await mkdir(join(runRoot, 'runs'), { recursive: true, mode: 0o700 })
  if (await realpath(join(runRoot, 'runs')) !== join(runRoot, 'runs')) {
    throw new Error('slow-loop Skill authoring runs path must be exact')
  }
}

async function loadState(runDir: string): Promise<SlowLoopRunState> {
  const info = await lstat(runDir)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runDir) !== runDir) {
    throw new Error('slow-loop Skill authoring run is not an exact real directory')
  }
  const statePath = join(runDir, 'state.json')
  if ((await stat(statePath)).size > MAX_STATE_BYTES) {
    throw new Error('slow-loop Skill authoring state exceeds its byte limit')
  }
  return stateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
}

async function updateState(
  runDir: string,
  state: SlowLoopRunState,
  patch: Partial<Pick<
    SlowLoopRunState,
    'phase' | 'cost' | 'candidateId' | 'retryAt' | 'reason'
  >>,
  now: number,
): Promise<SlowLoopRunState> {
  const next = stateSchema.parse({
    ...state,
    ...patch,
    updatedAt: isoTime(now),
  })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

function assertIdentity(
  state: SlowLoopRunState,
  identity: SlowLoopRunState['identity'] & { readonly id: string },
): void {
  if (state.id !== identity.id || JSON.stringify(state.identity) !== JSON.stringify({
    policyVersion: identity.policyVersion,
    targetId: identity.targetId,
    workspaceId: identity.workspaceId,
    skillName: identity.skillName,
    opportunityId: identity.opportunityId,
    evaluationEvidenceId: identity.evaluationEvidenceId,
    gapIds: identity.gapIds,
    goalCount: identity.goalCount,
    inputDigest: identity.inputDigest,
    modelIdentity: identity.modelIdentity,
  })) throw new Error('slow-loop Skill authoring run identity changed')
}

function samePolicy(state: SlowLoopRunState, policy: SkillOpportunityAuthoringPolicyConfig): boolean {
  return state.identity.targetId === policy.id
    && state.identity.workspaceId === policy.workspaceId
}

function resolveTarget(
  policy: SkillOpportunityAuthoringPolicyConfig,
  skill: string,
): ResolvedAuthoringTarget {
  if (!PUBLIC_ID.test(skill)) throw new Error('Skill opportunity name is invalid')
  return Object.freeze({
    ...policy,
    skill,
    runRoot: join(policy.runRoot, 'skills', skill),
  })
}

function projectState(state: SlowLoopRunState): SlowLoopSkillAuthoringRunView {
  return Object.freeze({
    id: state.id,
    targetId: state.identity.targetId,
    workspaceId: state.identity.workspaceId,
    skillName: state.identity.skillName,
    opportunityId: state.identity.opportunityId,
    gapCount: state.identity.gapIds.length,
    goalCount: state.identity.goalCount,
    phase: state.phase,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    modelCalls: state.cost.modelCalls,
    inputTokens: state.cost.inputTokens,
    outputTokens: state.cost.outputTokens,
    ...(state.candidateId === undefined ? {} : { candidateId: state.candidateId }),
    ...(state.retryAt === undefined ? {} : { retryAt: state.retryAt }),
    releaseAuthority: 'none',
  })
}

async function requestSlowLoopSkillAuthor(
  input: SlowLoopSkillAuthorInput,
): Promise<SlowLoopSkillAuthorResult> {
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
            'Author one complete instruction-only Skill bundle.',
            'Return JSON only with exactly one field: files.',
            'files must contain root SKILL.md plus 1-31 one-level references/*.md entries as {path, content}.',
            'SKILL.md must link every supplied reference; references must not link other local files.',
            'The YAML frontmatter name must exactly match the requested Skill name.',
            'Do not include scripts, executable content, credentials, network calls, or release instructions.',
            'Use only the supplied internal DSH Goal and capability-gap evidence.',
            'Do not search for, cite, or invent external sources, tests, outcomes, or permissions.',
            'The result is an inactive quarantined proposal; it has no install, activation, or release authority.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            targetId: input.targetId,
            workspaceId: input.workspaceId,
            skillName: input.skillName,
            opportunityId: input.opportunityId,
            gapIds: input.gapIds,
            goals: input.goalEvidence,
          }),
        },
      ],
    }),
    signal: input.signal === undefined
      ? AbortSignal.timeout(60_000)
      : AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) {
    throw new ObservedAuthoringResponseError(`slow-loop Skill author request failed with HTTP ${response.status}`)
  }
  let payload: unknown
  try {
    payload = await readBoundedResponseJson(response)
  } catch {
    throw new ObservedAuthoringResponseError('slow-loop Skill author response is not valid JSON')
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])
    || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== 'string') {
    throw new ObservedAuthoringResponseError('slow-loop Skill author response has no content')
  }
  let authored: unknown
  try {
    authored = JSON.parse(payload.choices[0].message.content)
  } catch {
    throw new ObservedAuthoringResponseError('slow-loop Skill author response content is not valid JSON')
  }
  if (!isRecord(authored)) {
    throw new ObservedAuthoringResponseError('slow-loop Skill author response content has an invalid shape')
  }
  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    ...authored,
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
  } as SlowLoopSkillAuthorResult
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared)
    || Number(declared) > MAX_AUTHOR_RESPONSE_BYTES)) {
    throw new Error('slow-loop Skill author response exceeds its byte limit')
  }
  if (response.body === null) throw new Error('slow-loop Skill author response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > MAX_AUTHOR_RESPONSE_BYTES) {
        await reader.cancel('slow-loop Skill author response exceeds its byte limit')
        throw new Error('slow-loop Skill author response exceeds its byte limit')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.allocUnsafe(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

class ObservedAuthoringResponseError extends Error {}

function configuredModelIdentity(): string {
  return sha256(JSON.stringify({
    baseUrl: requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL'),
    model: requireEnvironment('DSH_EVOLVE_MODEL_NAME'),
    contract: POLICY_VERSION,
  }))
}

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`slow-loop Skill authoring requires ${name}`)
  }
  return value
}

function containsPath(root: string, input: string): boolean {
  const fromRoot = relative(root, input)
  return fromRoot === '' || (fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot))
}

function isoTime(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('slow-loop Skill authoring clock is invalid')
  return new Date(value).toISOString()
}

function isUsage(value: unknown): value is SlowLoopSkillAuthorResult['usage'] {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === 'inputTokens,outputTokens'
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0
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

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/g, ' ').slice(0, 512) || 'unknown error'
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
