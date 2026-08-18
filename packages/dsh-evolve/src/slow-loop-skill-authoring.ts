import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import { assembleAgentSkillTextArchive, type AgentSkillTextManifestFile } from './agent-skill-archive.ts'
import type { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import { clusterCapabilityGaps, type CapabilityGapCluster } from './capability-gap-cluster.ts'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import type { SkillResearchCorpus, SkillResearchEvidence } from './skill-research.ts'
import type {
  AuthoredSkillBundleCandidateInput,
  DiscoveredSkillCandidate,
} from './trusted-skill-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 20
const MAX_GOALS = 8
const MAX_GOAL_OBJECTIVE_BYTES = 4 * 1024
const MAX_AUTHOR_INPUT_BYTES = 48 * 1024
const MAX_AUTHOR_CONTEXT_BYTES = 96 * 1024
const MAX_RESEARCH_CORPUS_BYTES = 48 * 1024
const MAX_AUTHOR_RESPONSE_BYTES = 128 * 1024
const MAX_STATE_BYTES = 64 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 6_000
const POLICY_VERSION = 'research-grounded-whole-skill-author-v2'
const LEGACY_POLICY_VERSION = 'cross-goal-skill-author-v1'

export interface SlowLoopSkillAuthoringTargetConfig {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly runRoot: string
  readonly maxAttemptsPerUtcDay: number
}

/** Refuse any authoring journal that could mutate discovery or governance inputs. */
export function assertSlowLoopSkillAuthoringRootSeparation(
  targets: readonly SlowLoopSkillAuthoringTargetConfig[],
  protectedRoots: readonly string[],
): void {
  for (const target of targets) {
    const authorRoot = resolve(target.runRoot)
    for (const input of protectedRoots) {
      if (!isAbsolute(input)) continue
      const protectedRoot = resolve(input)
      if (containsPath(authorRoot, protectedRoot) || containsPath(protectedRoot, authorRoot)) {
        throw new Error('slow-loop Skill authoring run roots must not overlap discovery or governance roots')
      }
    }
  }
}

export interface SlowLoopSkillAuthorInput {
  readonly idempotencyKey: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly clusterId: string
  readonly gapIds: readonly string[]
  readonly goalEvidence: readonly {
    readonly id: string
    readonly revision: number
    readonly objective: string
  }[]
  readonly research: {
    readonly digest: string
    readonly knowledge: readonly SkillResearchEvidence[]
  }
  readonly signal?: AbortSignal
}

export interface SlowLoopSkillAuthorResult {
  readonly files: readonly AgentSkillTextManifestFile[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type SlowLoopSkillAuthoringPhase =
  | 'prepared'
  | 'budget-deferred'
  | 'cancelled'
  | 'research-pending'
  | 'authoring-pending'
  | 'uncertain'
  | 'incomplete'
  | 'candidate-ready'

export interface SlowLoopSkillAuthoringRunView {
  readonly id: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly clusterId: string
  readonly gapCount: number
  readonly goalCount: number
  readonly phase: SlowLoopSkillAuthoringPhase
  readonly createdAt: string
  readonly updatedAt: string
  readonly modelCalls: 0 | 1
  readonly inputTokens: number
  readonly outputTokens: number
  readonly researchDigest?: string
  readonly candidateId?: string
  readonly retryAt?: number
  readonly releaseAuthority: 'none'
}

export interface SlowLoopSkillAuthoringScan {
  readonly configuredTargetCount: number
  readonly warningCount: number
  readonly runs: readonly SlowLoopSkillAuthoringRunView[]
}

/** Verification-only view; author knowledge and private journal paths never cross this seam. */
export interface SlowLoopSkillVerificationHandoff {
  readonly researchDigest: string
  readonly verification: readonly SkillResearchEvidence[]
}

interface SlowLoopSkillAuthoringOptions {
  readonly targets: readonly SlowLoopSkillAuthoringTargetConfig[]
  readonly gaps: Pick<CapabilityGapStore, 'list'>
  readonly candidates: {
    listCandidates(workspaceId?: string, gapId?: string): DiscoveredSkillCandidate[]
    isDiscoverySettled(gapId: string): boolean
    quarantineAuthoredBundle(input: AuthoredSkillBundleCandidateInput): Promise<{
      readonly created: boolean
      readonly candidate: DiscoveredSkillCandidate
    }>
  }
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly research?: (input: {
    readonly skillName: string
    readonly signal?: AbortSignal
  }) => Promise<SkillResearchCorpus>
  readonly authorModel?: (input: SlowLoopSkillAuthorInput) => Promise<SlowLoopSkillAuthorResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(CONTENT_ID),
  phase: z.enum([
    'prepared',
    'budget-deferred',
    'cancelled',
    'research-pending',
    'authoring-pending',
    'uncertain',
    'incomplete',
    'candidate-ready',
  ]),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  identity: z.strictObject({
    policyVersion: z.enum([LEGACY_POLICY_VERSION, POLICY_VERSION]),
    targetId: z.string().regex(PUBLIC_ID),
    workspaceId: z.uuid(),
    skillName: z.string().regex(PUBLIC_ID),
    clusterId: z.string().regex(CONTENT_ID),
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
  researchDigest: z.string().regex(CONTENT_ID).optional(),
  retryAt: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((state, context) => {
  if (state.identity.policyVersion === LEGACY_POLICY_VERSION
    && (state.phase === 'research-pending' || state.researchDigest !== undefined)) {
    context.addIssue({ code: 'custom', message: 'legacy slow-loop state has research-only fields' })
  }
  if (state.identity.policyVersion === POLICY_VERSION
    && ['authoring-pending', 'uncertain', 'candidate-ready'].includes(state.phase)
    && state.researchDigest === undefined) {
    context.addIssue({ code: 'custom', message: 'post-research slow-loop state has no research digest' })
  }
  if (['prepared', 'budget-deferred', 'cancelled', 'research-pending'].includes(state.phase)
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
  private readonly targets = new Map<string, SlowLoopSkillAuthoringTargetConfig>()
  private readonly gaps: SlowLoopSkillAuthoringOptions['gaps']
  private readonly candidates: SlowLoopSkillAuthoringOptions['candidates']
  private readonly budget: SlowLoopSkillAuthoringOptions['budget']
  private readonly authorModel: NonNullable<SlowLoopSkillAuthoringOptions['authorModel']>
  private readonly modelIdentity: NonNullable<SlowLoopSkillAuthoringOptions['modelIdentity']>
  private readonly now: NonNullable<SlowLoopSkillAuthoringOptions['now']>
  private research: SlowLoopSkillAuthoringOptions['research']
  private readonly active = new Set<string>()
  private reconcileTail: Promise<void> = Promise.resolve()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: SlowLoopSkillAuthoringOptions) {
    assertTargets(options.targets)
    for (const input of options.targets) {
      this.targets.set(targetKey(input.workspaceId, input.skill), Object.freeze({
        ...input,
        runRoot: resolve(input.runRoot),
      }))
    }
    this.gaps = options.gaps
    this.candidates = options.candidates
    this.budget = options.budget
    this.research = options.research
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

  attachResearch(research: NonNullable<SlowLoopSkillAuthoringOptions['research']>): () => void {
    if (this.research !== undefined) throw new Error('slow-loop Skill research seam is already attached')
    this.research = research
    return () => {
      if (this.research === research) this.research = undefined
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
    let configuredTargetCount = 0
    for (const target of this.targets.values()) {
      if (workspaceId !== undefined && target.workspaceId !== workspaceId) continue
      configuredTargetCount += 1
      let entries
      try {
        entries = await readdir(join(target.runRoot, 'runs'), { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        warningCount += 1
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const state = await loadState(join(target.runRoot, 'runs', entry.name))
          if (!sameTarget(state, target)) {
            warningCount += 1
            continue
          }
          runs.push(projectState(state))
        } catch {
          warningCount += 1
        }
      }
    }
    return Object.freeze({
      configuredTargetCount,
      warningCount,
      runs: Object.freeze(runs.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))),
    })
  }

  /**
   * Recover the independently withheld evidence for one exact durable Candidate.
   * The Candidate id, author identity, research digest, and cross-Goal demand must
   * all match the authoring journal before any holdout evidence leaves this module.
   */
  async verificationFor(
    candidate: DiscoveredSkillCandidate,
  ): Promise<SlowLoopSkillVerificationHandoff> {
    if (candidate.source.kind !== 'slow-loop-author'
      || (candidate.version.kind !== 'slow-loop-research-bundle-v2'
        && candidate.version.kind !== 'slow-loop-research-revision-v3')
      || candidate.demand === undefined) {
      throw new Error('exact research-grounded Candidate is required for verification')
    }
    const version = candidate.version
    const parentCandidateId = version.kind === 'slow-loop-research-bundle-v2'
      ? candidate.id
      : version.parentCandidateId
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined || candidate.source.id !== target.id) {
      throw new Error('exact research-grounded Candidate has no configured authoring target')
    }

    let entries
    try {
      entries = await readdir(join(target.runRoot, 'runs'), { withFileTypes: true })
    } catch {
      throw new Error('exact research-grounded Candidate has no durable authoring journal')
    }
    const matches: Array<{ readonly state: SlowLoopRunState; readonly runDir: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
      const runDir = join(target.runRoot, 'runs', entry.name)
      let state: SlowLoopRunState
      try {
        state = await loadState(runDir)
      } catch {
        continue
      }
      if (state.phase === 'candidate-ready'
        && state.candidateId === parentCandidateId
        && state.researchDigest === version.researchDigest
        && state.identity.targetId === candidate.source.id
        && state.identity.workspaceId === candidate.workspaceId
        && state.identity.skillName === candidate.requestedSkill
        && state.identity.clusterId === candidate.demand.clusterId
        && JSON.stringify(state.identity.gapIds) === JSON.stringify(candidate.demand.gapIds)
        && state.identity.goalCount === candidate.demand.goalCount
        && (version.kind === 'slow-loop-research-revision-v3'
          || (state.identity.inputDigest === version.inputDigest
            && sha256(state.identity.modelIdentity) === version.modelIdentityHash))) {
        matches.push({ state, runDir })
      }
    }
    if (matches.length !== 1) {
      throw new Error('exact research-grounded Candidate has no unique durable authoring journal')
    }
    const match = matches[0]!
    const researchPath = join(match.runDir, 'research.json')
    let corpus: SkillResearchCorpus
    try {
      if ((await stat(researchPath)).size > MAX_RESEARCH_CORPUS_BYTES) throw new Error('oversized')
      corpus = assertResearchHandoff(
        JSON.parse(await readFile(researchPath, 'utf8')) as SkillResearchCorpus,
        candidate.requestedSkill,
      )
    } catch {
      throw new Error('exact research-grounded Candidate research evidence is invalid')
    }
    if (corpus.digest !== version.researchDigest) {
      throw new Error('exact research-grounded Candidate research digest changed')
    }
    return deepFreeze({
      researchDigest: corpus.digest,
      verification: corpus.verification,
    })
  }

  private async reconcileNow(
    workspaceId?: string,
  ): Promise<{ readonly scheduled: number; readonly warnings: string[] }> {
    const jobs = this.jobs
    if (jobs === undefined) return { scheduled: 0, warnings: ['native Jobs unavailable'] }
    const research = this.research
    if (research === undefined) return { scheduled: 0, warnings: ['native Web research unavailable'] }
    const gaps = this.gaps.list(workspaceId)
    const candidates = this.candidates.listCandidates(workspaceId)
    const clusters = clusterCapabilityGaps(gaps, candidates)
    const gapsById = new Map(gaps.map(gap => [gap.id, gap]))
    const candidateGapIds = new Set(candidates.map(candidate => candidate.gapId))
    const warnings: string[] = []
    let scheduled = 0

    for (const cluster of clusters) {
      if (scheduled >= 1
        || cluster.evidence !== 'repeated-skill-demand'
        || cluster.resolvedSkill !== undefined
        || cluster.gapIds.some(id => !this.candidates.isDiscoverySettled(id))
        || cluster.gapIds.some(id => candidateGapIds.has(id))) continue
      const target = this.targets.get(targetKey(cluster.workspaceId, cluster.canonicalSkill))
      if (target === undefined || (workspaceId !== undefined && target.workspaceId !== workspaceId)) continue
      try {
        const goalEvidence = buildGoalEvidence(cluster, gapsById)
        assertAuthorInputBudget(target, cluster, goalEvidence)
        const identity = this.buildIdentity(target, cluster, goalEvidence)
        const runDir = join(target.runRoot, 'runs', identity.id)
        let state = await prepareState(runDir, identity, this.now())
        if (state.phase === 'authoring-pending') {
          state = await updateState(runDir, state, {
            phase: 'uncertain',
            reason: 'paid authoring outcome is uncertain after restart; refusing automatic retry',
          }, this.now())
        }
        if (state.phase === 'research-pending') {
          state = await updateState(runDir, state, {
            phase: 'incomplete',
            reason: 'research was interrupted before durable completion; refusing automatic retry',
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
        this.schedule(jobs, research, target, cluster, goalEvidence, state, runDir)
        scheduled += 1
      } catch (error) {
        warnings.push(`slow-loop Skill authoring skipped ${cluster.canonicalSkill}: ${errorDetail(error)}`)
      }
    }
    return { scheduled, warnings }
  }

  private buildIdentity(
    target: SlowLoopSkillAuthoringTargetConfig,
    cluster: CapabilityGapCluster,
    goalEvidence: SlowLoopSkillAuthorInput['goalEvidence'],
  ): SlowLoopRunState['identity'] & { readonly id: string } {
    const modelIdentity = this.modelIdentity()
    if (modelIdentity.trim() === '' || Buffer.byteLength(modelIdentity) > 2_048) {
      throw new Error('slow-loop Skill authoring model identity is invalid')
    }
    const inputDigest = sha256(JSON.stringify({
      clusterId: cluster.id,
      gapIds: cluster.gapIds,
      goalEvidence,
    }))
    const identity = {
      policyVersion: POLICY_VERSION,
      targetId: target.id,
      workspaceId: target.workspaceId,
      skillName: target.skill,
      clusterId: cluster.id,
      gapIds: [...cluster.gapIds].sort(),
      goalCount: cluster.goalCount,
      inputDigest,
      modelIdentity,
    } as const
    return Object.freeze({
      ...identity,
      id: sha256(JSON.stringify(identity)),
    })
  }

  private schedule(
    jobs: Pick<JobRegistry, 'start'>,
    research: NonNullable<SlowLoopSkillAuthoringOptions['research']>,
    target: SlowLoopSkillAuthoringTargetConfig,
    cluster: CapabilityGapCluster,
    goalEvidence: SlowLoopSkillAuthorInput['goalEvidence'],
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
            research,
            target,
            cluster,
            goalEvidence,
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
    research: NonNullable<SlowLoopSkillAuthoringOptions['research']>,
    target: SlowLoopSkillAuthoringTargetConfig,
    cluster: CapabilityGapCluster,
    goalEvidence: SlowLoopSkillAuthorInput['goalEvidence'],
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
      phase: 'research-pending',
      cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
      retryAt: undefined,
      reason: undefined,
    }, this.now())
    if (controller.signal.aborted) {
      return persistCancellation(runDir, state, controller.signal.reason, this.now())
    }
    let corpus: SkillResearchCorpus
    try {
      corpus = assertResearchHandoff(
        await research({ skillName: target.skill, signal: controller.signal }),
        target.skill,
      )
      if (controller.signal.aborted) {
        return persistCancellation(runDir, state, controller.signal.reason, this.now())
      }
      await writeDurableJson(join(runDir, 'research.json'), corpus)
      assertAuthorContextBudget(target, cluster, goalEvidence, corpus)
    } catch (error) {
      if (controller.signal.aborted) {
        return persistCancellation(runDir, state, controller.signal.reason, this.now())
      }
      return updateState(runDir, state, {
        phase: 'incomplete',
        reason: `research incomplete: ${errorDetail(error)}`,
      }, this.now())
    }
    state = await updateState(runDir, state, {
      phase: 'authoring-pending',
      cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      researchDigest: corpus.digest,
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
        clusterId: cluster.id,
        gapIds: cluster.gapIds,
        goalEvidence,
        research: {
          digest: corpus.digest,
          knowledge: corpus.knowledge,
        },
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
      const quarantined = await this.candidates.quarantineAuthoredBundle({
        discoveredAt: this.now(),
        workspaceId: target.workspaceId,
        requestedSkill: target.skill,
        sourceId: target.id,
        clusterId: cluster.id,
        gapIds: [...cluster.gapIds].sort(),
        goalCount: cluster.goalCount,
        modelIdentity: state.identity.modelIdentity,
        inputDigest: state.identity.inputDigest,
        researchDigest: corpus.digest,
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

function assertTargets(targets: readonly SlowLoopSkillAuthoringTargetConfig[]): void {
  if (targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`slow-loop Skill authoring requires 1-${MAX_TARGETS} exact targets`)
  }
  if (targets.some(target => !PUBLIC_ID.test(target.id)
    || !PUBLIC_ID.test(target.skill)
    || !isWorkspaceId(target.workspaceId))) {
    throw new Error('slow-loop Skill authoring target identities are invalid')
  }
  if (targets.some(target => !isAbsolute(target.runRoot))) {
    throw new Error('slow-loop Skill authoring run roots must be absolute')
  }
  if (targets.some(target => dirname(resolve(target.runRoot)) === resolve(target.runRoot))) {
    throw new Error('slow-loop Skill authoring run roots must not be filesystem roots')
  }
  if (targets.some(target => !Number.isInteger(target.maxAttemptsPerUtcDay)
    || target.maxAttemptsPerUtcDay < 1
    || target.maxAttemptsPerUtcDay > 20)) {
    throw new Error('slow-loop Skill authoring daily attempt limits must be integers between 1 and 20')
  }
  if (new Set(targets.map(target => target.id)).size !== targets.length
    || new Set(targets.map(target => resolve(target.runRoot))).size !== targets.length) {
    throw new Error('slow-loop Skill authoring target ids and run roots must be unique')
  }
  if (targets.some((target, index) => targets.some((other, otherIndex) => index !== otherIndex
    && containsPath(resolve(target.runRoot), resolve(other.runRoot))))) {
    throw new Error('slow-loop Skill authoring target run roots must not overlap')
  }
  if (new Set(targets.map(target => targetKey(target.workspaceId, target.skill))).size !== targets.length) {
    throw new Error('slow-loop Skill authoring permits exactly one target per Workspace and Skill')
  }
}

function buildGoalEvidence(
  cluster: CapabilityGapCluster,
  gapsById: ReadonlyMap<string, CapabilityGap>,
): SlowLoopSkillAuthorInput['goalEvidence'] {
  const goals = new Map<string, NonNullable<CapabilityGap['goal']> & { observedAt: number }>()
  for (const gapId of cluster.gapIds) {
    const gap = gapsById.get(gapId)
    if (gap?.goal === undefined) throw new Error('cluster Gap evidence changed before authoring')
    const current = goals.get(gap.goal.id)
    if (current === undefined || gap.goal.revision > current.revision) {
      goals.set(gap.goal.id, { ...gap.goal, observedAt: gap.observedAt })
    }
  }
  const evidence = [...goals.values()]
    .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))
    .slice(0, MAX_GOALS)
    .map(goal => Object.freeze({
      id: goal.id,
      revision: goal.revision,
      objective: truncateUtf8(goal.objective, MAX_GOAL_OBJECTIVE_BYTES),
    }))
  if (evidence.length < 2) throw new Error('slow-loop authoring requires at least two distinct Goals')
  if (Buffer.byteLength(JSON.stringify(evidence)) > MAX_AUTHOR_INPUT_BYTES) {
    throw new Error('slow-loop authoring evidence exceeds its input budget')
  }
  return Object.freeze(evidence)
}

function assertAuthorInputBudget(
  target: SlowLoopSkillAuthoringTargetConfig,
  cluster: CapabilityGapCluster,
  goalEvidence: SlowLoopSkillAuthorInput['goalEvidence'],
): void {
  const modelInput = JSON.stringify({
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    clusterId: cluster.id,
    gapIds: cluster.gapIds,
    goals: goalEvidence,
  })
  if (Buffer.byteLength(modelInput) > MAX_AUTHOR_INPUT_BYTES) {
    throw new Error('slow-loop authoring evidence exceeds its input budget')
  }
}

function assertAuthorContextBudget(
  target: SlowLoopSkillAuthoringTargetConfig,
  cluster: CapabilityGapCluster,
  goalEvidence: SlowLoopSkillAuthorInput['goalEvidence'],
  research: SkillResearchCorpus,
): void {
  const modelInput = JSON.stringify({
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    clusterId: cluster.id,
    gapIds: cluster.gapIds,
    goals: goalEvidence,
    research: {
      digest: research.digest,
      knowledge: research.knowledge,
    },
  })
  if (Buffer.byteLength(modelInput) > MAX_AUTHOR_CONTEXT_BYTES) {
    throw new Error('slow-loop research-grounded author context exceeds its input budget')
  }
}

function assertResearchHandoff(input: SkillResearchCorpus, skillName: string): SkillResearchCorpus {
  if (!isRecord(input)
    || input.schemaVersion !== 1
    || input.skillName !== skillName
    || typeof input.queryDigest !== 'string'
    || !CONTENT_ID.test(input.queryDigest)
    || !Array.isArray(input.knowledge)
    || input.knowledge.length < 2
    || input.knowledge.length > 3
    || !Array.isArray(input.verification)
    || input.verification.length !== 1
    || typeof input.truncated !== 'boolean'
    || typeof input.digest !== 'string'
    || !CONTENT_ID.test(input.digest)
    || !input.knowledge.every(value => isResearchEvidence(value, 'knowledge'))
    || !input.verification.every(value => isResearchEvidence(value, 'verification'))
    || new Set(input.knowledge.map(value => value.track)).size < 2
    || input.verification.some(value => input.knowledge.some(item => item.finalUrl === value.finalUrl))
    || Buffer.byteLength(JSON.stringify(input)) > MAX_RESEARCH_CORPUS_BYTES) {
    throw new Error('slow-loop Skill research handoff is invalid')
  }
  const unsigned = {
    schemaVersion: input.schemaVersion,
    skillName: input.skillName,
    queryDigest: input.queryDigest,
    knowledge: input.knowledge,
    verification: input.verification,
    truncated: input.truncated,
  }
  if (sha256(JSON.stringify(unsigned)) !== input.digest) {
    throw new Error('slow-loop Skill research digest does not match its evidence')
  }
  return deepFreeze(structuredClone(input))
}

function isResearchEvidence(input: unknown, role: 'knowledge' | 'verification'): input is SkillResearchEvidence {
  if (!isRecord(input)
    || input.role !== role
    || typeof input.track !== 'string'
    || (role === 'knowledge'
      ? !['official', 'open-source', 'frontier'].includes(input.track)
      : input.track !== 'holdout')
    || typeof input.queryHash !== 'string'
    || !CONTENT_ID.test(input.queryHash)
    || typeof input.requestedUrl !== 'string'
    || !isSafeResearchUrl(input.requestedUrl)
    || typeof input.finalUrl !== 'string'
    || !isSafeResearchUrl(input.finalUrl)
    || !Number.isSafeInteger(input.statusCode)
    || (input.statusCode as number) < 200
    || (input.statusCode as number) >= 300
    || (input.title !== undefined && typeof input.title !== 'string')
    || typeof input.excerpt !== 'string'
    || typeof input.contentDigest !== 'string'
    || !CONTENT_ID.test(input.contentDigest)
    || typeof input.truncated !== 'boolean') return false
  const expectedKeys = [
    'contentDigest',
    'excerpt',
    'finalUrl',
    'queryHash',
    'requestedUrl',
    'role',
    'statusCode',
    'track',
    'truncated',
    ...(input.title === undefined ? [] : ['title']),
  ].sort()
  return Object.keys(input).sort().join(',') === expectedKeys.join(',')
}

function isSafeResearchUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.hash === ''
  } catch {
    return false
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
  const assembled = await assembleAgentSkillTextArchive(input.files)
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
    schemaVersion: 1,
    id: identity.id,
    phase: 'prepared',
    createdAt: instant,
    updatedAt: instant,
    identity: {
      policyVersion: identity.policyVersion,
      targetId: identity.targetId,
      workspaceId: identity.workspaceId,
      skillName: identity.skillName,
      clusterId: identity.clusterId,
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
    | 'researchDigest'
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
    clusterId: identity.clusterId,
    gapIds: identity.gapIds,
    goalCount: identity.goalCount,
    inputDigest: identity.inputDigest,
    modelIdentity: identity.modelIdentity,
  })) throw new Error('slow-loop Skill authoring run identity changed')
}

function sameTarget(state: SlowLoopRunState, target: SlowLoopSkillAuthoringTargetConfig): boolean {
  return state.identity.targetId === target.id
    && state.identity.workspaceId === target.workspaceId
    && state.identity.skillName === target.skill
}

function projectState(state: SlowLoopRunState): SlowLoopSkillAuthoringRunView {
  return Object.freeze({
    id: state.id,
    targetId: state.identity.targetId,
    workspaceId: state.identity.workspaceId,
    skillName: state.identity.skillName,
    clusterId: state.identity.clusterId,
    gapCount: state.identity.gapIds.length,
    goalCount: state.identity.goalCount,
    phase: state.phase,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    modelCalls: state.cost.modelCalls,
    inputTokens: state.cost.inputTokens,
    outputTokens: state.cost.outputTokens,
    ...(state.researchDigest === undefined ? {} : { researchDigest: state.researchDigest }),
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
            'Author one complete instruction-only Agent Skill bundle.',
            'Return JSON only with exactly one field: files.',
            'files must contain root SKILL.md plus 1-31 one-level references/*.md entries as {path, content}.',
            'SKILL.md must link every supplied reference; references must not link other local files.',
            'The YAML frontmatter name must exactly match the requested Skill name.',
            'Do not include scripts, executable content, credentials, network calls, or release instructions.',
            'Use only the supplied cross-Goal evidence and knowledge research.',
            'Independent verification anchors are intentionally withheld; do not invent tests, sources, outcomes, or permissions.',
            'The result is an inactive quarantined proposal; it has no install, activation, or release authority.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            targetId: input.targetId,
            workspaceId: input.workspaceId,
            skillName: input.skillName,
            clusterId: input.clusterId,
            gapIds: input.gapIds,
            goals: input.goalEvidence,
            research: input.research,
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

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
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

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let end = value.length
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > maxBytes) end -= 1
  return value.slice(0, end)
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
