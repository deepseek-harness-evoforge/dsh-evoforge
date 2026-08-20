import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetReservation,
  AutomaticEvolutionBudgetTarget,
} from './automatic-evolution-budget.ts'
import type { DeliveryOutcome, DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import {
  parseExistingSkillCandidateLineage,
  type ExistingSkillCandidateLineage,
} from './existing-skill-candidate-lineage.ts'
import type {
  ExistingSkillRelease,
  ExistingSkillReleaseEligibility,
} from './existing-skill-release.ts'
import type {
  ExistingSkillCanaryReplay,
  ExistingSkillRetentionEvaluation,
  ExistingSkillRetentionEvaluationRunView,
} from './existing-skill-retention-evaluation.ts'
import type { CapabilityGeneration, EvolutionStore, SkillBundleGenerationArtifact } from './generation-store.ts'
import { hashTree } from './hash.ts'
import { acquireShadowRunLock, writeDurableJson } from './shadow-run-state.ts'
import type { ExistingSkillCandidate, SkillCandidateStore } from './skill-candidate-repository.ts'
import type { SkillCandidateEvaluationPolicyConfig } from './skill-evaluation-envelope.ts'
import { runPairedTrial, type PairedTrialResult } from './trial.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const MAX_RUNS_PER_POLICY = 1_000
const MAX_JSON_BYTES = 256 * 1024

export interface ExistingSkillCounterfactualCanaryPolicy {
  readonly id: string
  readonly workspaceId: string
  readonly governanceRoot: string
  readonly runRoot: string
  readonly dshRevision: string
  readonly maxAttemptsPerUtcDay: number
}

export type ExistingSkillCounterfactualCanaryReason =
  | 'candidate-still-passes-sealed-canary'
  | 'candidate-regressed-baseline-recovers'
  | 'failed-outcome-not-isolated'
  | 'active-generation-changed'
  | 'canary-input-mutated'
  | 'canary-not-assembled'
  | 'canary-calibration-failed'
  | 'canary-composition-changed'
  | 'canary-trial-failed'
  | 'canary-trial-outcome-uncertain'
  | 'canary-replay-evidence-invalid'

export interface ExistingSkillCounterfactualCanaryEvidence {
  readonly holdoutCasePackHash: string
  readonly retentionCasePackHash: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly baseline: 'pass' | 'fail'
  readonly candidate: 'pass' | 'fail'
  readonly calibrationPassed: boolean
  readonly assembled: boolean
  readonly compositionStable: boolean
  readonly inputIntegrityStable: boolean
  readonly activePointerStable: boolean
  readonly proposerCalls: 0
  readonly trialCount: 4
  readonly modelCalls?: { readonly baseline: number; readonly candidate: number }
  readonly usage?: {
    readonly baseline: Record<string, number | undefined>
    readonly candidate: Record<string, number | undefined>
  }
}

export interface ExistingSkillCounterfactualCanaryResult {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-counterfactual-canary-result-v1'
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly admissionId: string
  readonly holdoutEvaluationId: string
  readonly retentionEvaluationId: string
  readonly evaluationEnvelopeId: string
  readonly status: 'keep' | 'review' | 'rollback-eligible'
  readonly reason: ExistingSkillCounterfactualCanaryReason
  readonly startedAt: string
  readonly finishedAt: string
  readonly evidence?: ExistingSkillCounterfactualCanaryEvidence
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillCounterfactualCanaryPreparedView {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-counterfactual-canary-state-v1'
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly admissionId: string
  readonly holdoutEvaluationId: string
  readonly retentionEvaluationId: string
  readonly evaluationEnvelopeId: string
  readonly holdoutCasePackHash: string
  readonly retentionCasePackHash: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly dshRevision: string
  readonly status: 'prepared' | 'trial-pending'
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillCounterfactualCanaryScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly (
    ExistingSkillCounterfactualCanaryResult | ExistingSkillCounterfactualCanaryPreparedView
  )[]
}

export type ExistingSkillCounterfactualCanaryReconcile =
  | {
      readonly status: 'idle'
      readonly reason:
        | 'canary-not-configured'
        | 'no-active-generation'
        | 'no-active-existing-skill-release'
        | 'no-failed-active-outcome'
        | 'rollback-already-eligible'
        | 'canary-review-required'
    }
  | {
      readonly status: 'waiting'
      readonly reason: 'canary-budget-exhausted'
      readonly retryAt: number
      readonly generationId: string
      readonly outcomeId: string
    }
  | {
      readonly status: 'blocked'
      readonly reason: 'active-existing-skill-release-ambiguous' | 'canary-evidence-invalid'
      readonly generationId: string
      readonly outcomeId?: string
    }
  | { readonly status: 'completed'; readonly run: ExistingSkillCounterfactualCanaryResult }

export interface ExistingSkillCounterfactualCanaryModules {
  readonly store: Pick<EvolutionStore, 'getActiveGeneration' | 'getGeneration'>
  readonly outcomes: Pick<DeliveryOutcomeStore, 'list'>
  readonly releases: Pick<ExistingSkillRelease, 'scan' | 'eligibility'>
  readonly candidates: Pick<SkillCandidateStore, 'listExistingCandidates'>
  readonly retention: Pick<ExistingSkillRetentionEvaluation, 'scan' | 'prepareCanaryReplay'>
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
}

interface CanaryIdentity {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-counterfactual-canary-state-v1'
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly admissionId: string
  readonly holdoutEvaluationId: string
  readonly retentionEvaluationId: string
  readonly evaluationEnvelopeId: string
  readonly holdoutCasePackHash: string
  readonly retentionCasePackHash: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly dshRevision: string
}

interface CanaryState extends CanaryIdentity {
  readonly phase: 'prepared' | 'trial-pending' | 'terminal'
  readonly createdAt: string
  readonly updatedAt: string
}

interface ExactCanaryInput {
  readonly policy: ExistingSkillCounterfactualCanaryPolicy
  readonly generation: CapabilityGeneration
  readonly outcome: DeliveryOutcome
  readonly release: ExistingSkillReleaseEligibility & { readonly status: 'approved'; readonly generationId: string }
  readonly candidate: ExistingSkillCandidate
  readonly retention: ExistingSkillRetentionEvaluationRunView
  readonly artifact: SkillBundleGenerationArtifact
  readonly lineage: ExistingSkillCandidateLineage
  readonly identity: CanaryIdentity
  readonly runRoot: string
}

type TrialRunner = (input: ExistingSkillCanaryReplay['trial']) => Promise<PairedTrialResult>

/**
 * A failed real Outcome only triggers suspicion. This owner replays the exact
 * sealed retained pair and emits evidence; it owns no Generation mutation API.
 */
export class ExistingSkillCounterfactualCanary {
  private readonly modules: ExistingSkillCounterfactualCanaryModules
  private readonly policies = new Map<string, ExistingSkillCounterfactualCanaryPolicy>()
  private readonly runTrial: TrialRunner

  constructor(
    modules: ExistingSkillCounterfactualCanaryModules,
    options: {
      readonly policies: readonly (SkillCandidateEvaluationPolicyConfig & {
        readonly dshRevision: string
        readonly maxAttemptsPerUtcDay: number
      })[]
      readonly runTrial?: TrialRunner
    },
  ) {
    assertPolicies(options.policies)
    for (const policy of options.policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        id: policy.id,
        workspaceId: policy.workspaceId,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
        dshRevision: policy.dshRevision,
        maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay,
      }))
    }
    this.modules = modules
    this.runTrial = options.runTrial ?? runPairedTrial
  }

  async reconcile(
    workspaceId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExistingSkillCounterfactualCanaryReconcile> {
    options.signal?.throwIfAborted()
    const policy = this.policies.get(workspaceId)
    if (policy === undefined) return { status: 'idle', reason: 'canary-not-configured' }
    const active = this.modules.store.getActiveGeneration(workspaceId)
    if (active === undefined) return { status: 'idle', reason: 'no-active-generation' }

    const existing = await this.scan(workspaceId)
    const activeTerminal = existing.runs.filter(run => run.generationId === active.id
      && 'reason' in run)
    if (activeTerminal.some(run => 'status' in run && run.status === 'rollback-eligible')) {
      return { status: 'idle', reason: 'rollback-already-eligible' }
    }
    if (activeTerminal.some(run => 'status' in run && run.status === 'review')) {
      return { status: 'idle', reason: 'canary-review-required' }
    }

    const releases = (await this.modules.releases.scan(workspaceId)).filter((item): item is
      ExistingSkillReleaseEligibility & { status: 'approved'; generationId: string } =>
      item.status === 'approved' && item.generationId === active.id)
    if (releases.length === 0) return { status: 'idle', reason: 'no-active-existing-skill-release' }
    if (releases.length !== 1) {
      return {
        status: 'blocked',
        reason: 'active-existing-skill-release-ambiguous',
        generationId: active.id,
      }
    }

    const completedOutcomes = new Set(activeTerminal.map(run => run.outcomeId))
    const outcome = this.modules.outcomes.list(workspaceId)
      .filter(value => value.status === 'failed'
        && value.generationId === active.id
        && !completedOutcomes.has(value.id))
      .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))[0]
    if (outcome === undefined) return { status: 'idle', reason: 'no-failed-active-outcome' }
    if (existing.warningCount !== 0) {
      return { status: 'blocked', reason: 'canary-evidence-invalid', generationId: active.id, outcomeId: outcome.id }
    }

    let exact: ExactCanaryInput
    try {
      exact = await this.resolveExactInput(policy, active, outcome, releases[0]!)
    } catch {
      return { status: 'blocked', reason: 'canary-evidence-invalid', generationId: active.id, outcomeId: outcome.id }
    }
    const resultPath = join(exact.runRoot, exact.identity.id, 'result.json')
    const prior = await readResultIfPresent(resultPath, exact.identity)
    if (prior !== undefined) return { status: 'completed', run: prior }
    const reservation = await this.modules.budget.reserve(budgetTarget(policy, exact.candidate), outcome.id)
    if (!reservation.allowed) {
      return {
        status: 'waiting',
        reason: 'canary-budget-exhausted',
        retryAt: reservation.retryAt!,
        generationId: active.id,
        outcomeId: outcome.id,
      }
    }
    return { status: 'completed', run: await this.execute(exact, reservation, options) }
  }

  async scan(workspaceId?: string): Promise<ExistingSkillCounterfactualCanaryScan> {
    const policies = [...this.policies.values()]
      .filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
    const runs: Array<ExistingSkillCounterfactualCanaryResult | ExistingSkillCounterfactualCanaryPreparedView> = []
    let warningCount = 0
    for (const policy of policies) {
      const root = canaryRunRoot(policy)
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if (!isCode(error, 'ENOENT')) warningCount += 1
        continue
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      if (entries.length > MAX_RUNS_PER_POLICY) warningCount += 1
      for (const entry of entries.slice(0, MAX_RUNS_PER_POLICY)) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) {
          warningCount += 1
          continue
        }
        try {
          const runDir = join(root, entry.name)
          const state = await readState(runDir)
          if (state.id !== entry.name
            || state.policyId !== policy.id
            || state.workspaceId !== policy.workspaceId
            || state.dshRevision !== policy.dshRevision
            || state.id !== canaryId(state)) {
            throw new Error('existing-Skill Canary durable identity is inconsistent')
          }
          const result = await readResultIfPresent(join(runDir, 'result.json'), state)
          if (state.phase === 'terminal' && result === undefined) {
            throw new Error('existing-Skill Canary terminal state has no result')
          }
          runs.push(result ?? preparedView(state))
        } catch {
          warningCount += 1
        }
      }
    }
    return Object.freeze({
      configuredPolicyCount: policies.length,
      warningCount,
      runs: Object.freeze(runs.sort((left, right) => left.id.localeCompare(right.id))),
    })
  }

  private async resolveExactInput(
    policy: ExistingSkillCounterfactualCanaryPolicy,
    generation: CapabilityGeneration,
    outcome: DeliveryOutcome,
    release: ExistingSkillReleaseEligibility & { readonly status: 'approved'; readonly generationId: string },
  ): Promise<ExactCanaryInput> {
    const exactRelease = await this.modules.releases.eligibility(generation.workspaceId, release.candidateId)
    if (!sameApprovedRelease(exactRelease, release)) {
      throw new Error('existing-Skill Canary release evidence changed')
    }
    const candidates = this.modules.candidates.listExistingCandidates(generation.workspaceId)
      .filter(value => value.id === release.candidateId)
    if (candidates.length !== 1) throw new Error('existing-Skill Canary Candidate is missing or ambiguous')
    const candidate = candidates[0]!
    const artifacts = generation.artifacts.filter((value): value is SkillBundleGenerationArtifact =>
      value.kind === 'skill-bundle' && value.name === candidate.skillName)
    if (artifacts.length !== 1) throw new Error('active Generation has no exact existing-Skill artifact')
    const artifact = artifacts[0]!
    const lineage = parseExistingSkillCandidateLineage(artifact.lineage)
    const retentionScan = await this.modules.retention.scan(generation.workspaceId)
    const retentions = retentionScan.results.filter(value => value.id === release.retentionEvaluationId)
    if (retentionScan.configuredPolicyCount < 1 || retentionScan.warningCount !== 0 || retentions.length !== 1) {
      throw new Error('existing-Skill Canary Retention evidence is invalid')
    }
    const retention = retentions[0]!
    if (!exactLineage(candidate, lineage, release, retention, generation, outcome, artifact, policy)) {
      throw new Error('existing-Skill Canary exact lineage changed')
    }
    const body = {
      policyId: policy.id,
      workspaceId: generation.workspaceId,
      generationId: generation.id,
      outcomeId: outcome.id,
      candidateId: candidate.id,
      skillName: candidate.skillName,
      admissionId: release.admissionId,
      holdoutEvaluationId: release.holdoutEvaluationId,
      retentionEvaluationId: release.retentionEvaluationId,
      evaluationEnvelopeId: lineage.evaluationEnvelopeId,
      holdoutCasePackHash: lineage.holdoutCasePackHash,
      retentionCasePackHash: lineage.retentionCasePackHash,
      baselineTreeHash: lineage.baselineTreeHash,
      candidateTreeHash: lineage.candidateTreeHash,
      dshRevision: policy.dshRevision,
    }
    const identity = Object.freeze({
      schemaVersion: 1 as const,
      kind: 'existing-skill-counterfactual-canary-state-v1' as const,
      id: canaryId(body),
      ...body,
    })
    return Object.freeze({
      policy,
      generation,
      outcome,
      release,
      candidate,
      retention,
      artifact,
      lineage,
      identity,
      runRoot: await ensureExactDirectory(canaryRunRoot(policy)),
    })
  }

  private async execute(
    exact: ExactCanaryInput,
    _reservation: AutomaticEvolutionBudgetReservation,
    options: { signal?: AbortSignal },
  ): Promise<ExistingSkillCounterfactualCanaryResult> {
    const runDir = join(exact.runRoot, exact.identity.id)
    await ensureExactDirectory(runDir)
    const releaseLock = await acquireShadowRunLock(runDir)
    try {
      let state = await prepareState(runDir, exact.identity)
      const resultPath = join(runDir, 'result.json')
      const existing = await readResultIfPresent(resultPath, exact.identity)
      if (existing !== undefined) return existing
      if (state.phase === 'trial-pending') {
        const uncertain = terminalResult(exact, state.updatedAt, 'review', 'canary-trial-outcome-uncertain')
        await writeDurableJson(resultPath, uncertain)
        await writeState(runDir, state, 'terminal')
        return uncertain
      }
      if (state.phase !== 'prepared') {
        throw new Error('existing-Skill Canary terminal state has no durable result')
      }

      let replay: ExistingSkillCanaryReplay
      try {
        replay = await this.modules.retention.prepareCanaryReplay(
          exact.candidate,
          exact.release.retentionEvaluationId,
          runDir,
        )
        requireExactReplay(exact, replay, runDir)
      } catch {
        const invalid = terminalResult(exact, new Date().toISOString(), 'review', 'canary-replay-evidence-invalid')
        await writeDurableJson(resultPath, invalid)
        await writeState(runDir, state, 'terminal')
        return invalid
      }

      const startedAt = new Date().toISOString()
      state = await writeState(runDir, state, 'trial-pending')
      let trial: PairedTrialResult
      try {
        trial = await this.runTrial(Object.freeze({
          ...replay.trial,
          ...options.signal === undefined ? {} : { signal: options.signal },
        }))
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        const failed = terminalResult(exact, startedAt, 'review', 'canary-trial-failed')
        await writeDurableJson(resultPath, failed)
        await writeState(runDir, state, 'terminal')
        return failed
      }
      const evidence = await canaryEvidence(
        trial,
        replay,
        this.modules.store.getActiveGeneration(exact.identity.workspaceId)?.id,
        exact.identity.generationId,
      )
      const verdict = classifyEvidence(evidence)
      const result = terminalResult(exact, startedAt, verdict.status, verdict.reason, evidence)
      await writeDurableJson(resultPath, result)
      await writeState(runDir, state, 'terminal')
      return result
    } finally {
      await releaseLock()
    }
  }
}

/** Native DSH Jobs is the only process-local execution/cancellation seam. */
export class ExistingSkillCounterfactualCanaryScheduler {
  private readonly canary: Pick<ExistingSkillCounterfactualCanary, 'reconcile'>
  private readonly workspaces: ReadonlySet<string>
  private readonly pending = new Set<string>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    canary: Pick<ExistingSkillCounterfactualCanary, 'reconcile'>,
    workspaces: readonly string[],
  ) {
    this.canary = canary
    this.workspaces = new Set(workspaces)
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing-Skill Canary Jobs seam is already attached')
    this.jobs = jobs
    for (const workspaceId of this.workspaces) {
      if (!this.pending.has(workspaceId) && !this.active.has(workspaceId)) this.pending.add(workspaceId)
      this.schedule(workspaceId)
    }
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(workspaceId: string): void {
    if (!this.workspaces.has(workspaceId) || this.pending.has(workspaceId) || this.active.has(workspaceId)) return
    this.pending.add(workspaceId)
    this.schedule(workspaceId)
  }

  private schedule(workspaceId: string): void {
    const jobs = this.jobs
    if (jobs === undefined || !this.pending.has(workspaceId) || this.active.has(workspaceId)) return
    this.pending.delete(workspaceId)
    this.active.add(workspaceId)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: 'existing Skill failed-Outcome Canary',
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.canary.reconcile(workspaceId, { signal: controller.signal })
          return {
            cancel: (reason?: string) => controller.abort(new Error(reason ?? 'existing-Skill Canary cancelled')),
            done: task.then(value => ({
              status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
              detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : reconcileDetail(value),
              ...controller.signal.aborted ? {} : { output: JSON.stringify(value) },
            }), error => ({
              status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
            })).finally(() => {
              this.active.delete(workspaceId)
              this.schedule(workspaceId)
            }),
          }
        },
      })
    } catch {
      this.active.delete(workspaceId)
      this.pending.add(workspaceId)
    }
  }
}

function exactLineage(
  candidate: ExistingSkillCandidate,
  lineage: ExistingSkillCandidateLineage,
  release: ExistingSkillReleaseEligibility & { readonly status: 'approved'; readonly generationId: string },
  retention: ExistingSkillRetentionEvaluationRunView,
  generation: CapabilityGeneration,
  outcome: DeliveryOutcome,
  artifact: SkillBundleGenerationArtifact,
  policy: ExistingSkillCounterfactualCanaryPolicy,
): boolean {
  const evidence = retention.evidence
  return release.generationId === generation.id
    && outcome.generationId === generation.id
    && candidate.workspaceId === generation.workspaceId
    && lineage.candidateId === candidate.id
    && lineage.workspaceId === candidate.workspaceId
    && lineage.skillName === candidate.skillName
    && lineage.opportunityId === candidate.opportunity.id
    && lineage.qualificationId === candidate.baseline.qualificationId
    && lineage.baselineId === candidate.baseline.id
    && lineage.baselineArtifactDigest === candidate.baseline.artifactDigest
    && lineage.baselineTreeHash === candidate.baseline.treeHash
    && lineage.evaluationEvidenceId === candidate.authorship.evaluationEvidenceId
    && lineage.policyId === candidate.authorship.policyId
    && lineage.contentHash === candidate.contentHash
    && lineage.candidateTreeHash === candidate.version.treeHash
    && lineage.admissionId === release.admissionId
    && lineage.holdoutEvaluationId === release.holdoutEvaluationId
    && lineage.retentionEvaluationId === release.retentionEvaluationId
    && artifact.artifactDigest === candidate.version.artifactDigest
    && artifact.treeHash === candidate.version.treeHash
    && retention.candidateId === candidate.id
    && retention.admissionId === release.admissionId
    && retention.holdoutEvaluationId === release.holdoutEvaluationId
    && retention.id === release.retentionEvaluationId
    && retention.envelopeId === lineage.evaluationEnvelopeId
    && retention.holdoutCasePackHash === lineage.holdoutCasePackHash
    && retention.casePackHash === lineage.retentionCasePackHash
    && retention.status === 'complete'
    && retention.verdict === 'retained'
    && retention.reason === 'candidate-passed-protected-retention'
    && retention.releaseAuthority === 'none'
    && evidence !== undefined
    && evidence.baselineTreeHash === lineage.baselineTreeHash
    && evidence.candidateTreeHash === lineage.candidateTreeHash
    && evidence.holdoutCasePackHash === lineage.holdoutCasePackHash
    && evidence.casePackHash === lineage.retentionCasePackHash
    && evidence.baseline === 'fail'
    && evidence.candidate === 'pass'
    && evidence.calibrationPassed === true
    && evidence.assembled === true
    && evidence.compositionStable === true
    && evidence.inputIntegrityStable === true
    && evidence.proposerCalls === 0
    && evidence.trialCount === 4
    && policy.dshRevision.length >= 40
}

function requireExactReplay(exact: ExactCanaryInput, replay: ExistingSkillCanaryReplay, runDir: string): void {
  if (replay.candidateId !== exact.identity.candidateId
    || replay.retentionEvaluationId !== exact.identity.retentionEvaluationId
    || replay.holdoutEvaluationId !== exact.identity.holdoutEvaluationId
    || replay.admissionId !== exact.identity.admissionId
    || replay.envelopeId !== exact.identity.evaluationEnvelopeId
    || replay.workspaceId !== exact.identity.workspaceId
    || replay.skillName !== exact.identity.skillName
    || replay.baselineTreeHash !== exact.identity.baselineTreeHash
    || replay.candidateTreeHash !== exact.identity.candidateTreeHash
    || replay.holdoutCasePackHash !== exact.identity.holdoutCasePackHash
    || replay.retentionCasePackHash !== exact.identity.retentionCasePackHash
    || replay.dshRevision !== exact.identity.dshRevision
    || resolve(replay.trial.outputDir) !== resolve(runDir)
    || replay.trial.baselineKind !== 'skill-tree'
    || replay.trial.casePackDir !== replay.casePackDir
    || replay.trial.skillDir !== replay.baselineDir
    || replay.trial.candidateSkillDir !== replay.candidateDir
    || replay.trial.dshRevision !== replay.dshRevision
    || replay.trial.trial.dshAssembled !== true
    || replay.trial.trial.capabilityAbsentBaseline !== undefined
    || replay.trial.trialLimit !== 4
    || replay.releaseAuthority !== 'none') {
    throw new Error('existing-Skill Canary replay does not match the active release')
  }
}

async function canaryEvidence(
  trial: PairedTrialResult,
  replay: ExistingSkillCanaryReplay,
  activeGenerationId: string | undefined,
  expectedGenerationId: string,
): Promise<ExistingSkillCounterfactualCanaryEvidence> {
  const [baselineTreeHash, candidateTreeHash, holdoutCasePackHash, retentionCasePackHash] = await Promise.all([
    hashTree(replay.baselineDir),
    hashTree(replay.candidateDir),
    hashTree(replay.holdoutCasePackDir),
    hashTree(replay.casePackDir),
  ])
  const calibrationPassed = trial.calibration.length === 2
    && trial.calibration[0]?.id === 'known-bad'
    && trial.calibration[0].expected === 'fail'
    && trial.calibration[0].actual === 'fail'
    && trial.calibration[0].passed === true
    && trial.calibration[1]?.id === 'known-correction'
    && trial.calibration[1].expected === 'pass'
    && trial.calibration[1].actual === 'pass'
    && trial.calibration[1].passed === true
  const baselineComposition = trial.baseline.composition
  const candidateComposition = trial.candidate.composition
  return Object.freeze({
    holdoutCasePackHash,
    retentionCasePackHash,
    baselineTreeHash: trial.baseline.treeHash,
    candidateTreeHash: trial.candidate.treeHash,
    baseline: trial.baseline.passed ? 'pass' as const : 'fail' as const,
    candidate: trial.candidate.passed ? 'pass' as const : 'fail' as const,
    calibrationPassed,
    assembled: trial.assembled === true,
    compositionStable: baselineComposition !== undefined
      && candidateComposition !== undefined
      && baselineComposition.fingerprint === candidateComposition.fingerprint,
    inputIntegrityStable: baselineTreeHash === replay.baselineTreeHash
      && candidateTreeHash === replay.candidateTreeHash
      && holdoutCasePackHash === replay.holdoutCasePackHash
      && retentionCasePackHash === replay.retentionCasePackHash
      && trial.baseline.treeHash === replay.baselineTreeHash
      && trial.candidate.treeHash === replay.candidateTreeHash,
    activePointerStable: activeGenerationId === expectedGenerationId,
    proposerCalls: 0 as const,
    trialCount: trial.count,
    ...(baselineComposition === undefined || candidateComposition === undefined ? {} : {
      modelCalls: {
        baseline: baselineComposition.modelCalls,
        candidate: candidateComposition.modelCalls,
      },
      usage: {
        baseline: { ...baselineComposition.usage },
        candidate: { ...candidateComposition.usage },
      },
    }),
  })
}

function classifyEvidence(evidence: ExistingSkillCounterfactualCanaryEvidence): {
  readonly status: ExistingSkillCounterfactualCanaryResult['status']
  readonly reason: ExistingSkillCounterfactualCanaryReason
} {
  if (!evidence.activePointerStable) return { status: 'review', reason: 'active-generation-changed' }
  if (!evidence.inputIntegrityStable || evidence.trialCount !== 4) {
    return { status: 'review', reason: 'canary-input-mutated' }
  }
  if (!evidence.assembled) return { status: 'review', reason: 'canary-not-assembled' }
  if (!evidence.calibrationPassed) return { status: 'review', reason: 'canary-calibration-failed' }
  if (!evidence.compositionStable) return { status: 'review', reason: 'canary-composition-changed' }
  if (evidence.candidate === 'pass') {
    return { status: 'keep', reason: 'candidate-still-passes-sealed-canary' }
  }
  if (evidence.baseline === 'pass') {
    return { status: 'rollback-eligible', reason: 'candidate-regressed-baseline-recovers' }
  }
  return { status: 'review', reason: 'failed-outcome-not-isolated' }
}

function terminalResult(
  exact: ExactCanaryInput,
  startedAt: string,
  status: ExistingSkillCounterfactualCanaryResult['status'],
  reason: ExistingSkillCounterfactualCanaryReason,
  evidence?: ExistingSkillCounterfactualCanaryEvidence,
): ExistingSkillCounterfactualCanaryResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-counterfactual-canary-result-v1',
    id: exact.identity.id,
    policyId: exact.identity.policyId,
    workspaceId: exact.identity.workspaceId,
    generationId: exact.identity.generationId,
    outcomeId: exact.identity.outcomeId,
    candidateId: exact.identity.candidateId,
    skillName: exact.identity.skillName,
    admissionId: exact.identity.admissionId,
    holdoutEvaluationId: exact.identity.holdoutEvaluationId,
    retentionEvaluationId: exact.identity.retentionEvaluationId,
    evaluationEnvelopeId: exact.identity.evaluationEnvelopeId,
    status,
    reason,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(evidence === undefined ? {} : { evidence }),
    releaseAuthority: 'none',
  })
}

function preparedView(state: CanaryState): ExistingSkillCounterfactualCanaryPreparedView {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-counterfactual-canary-state-v1',
    id: state.id,
    policyId: state.policyId,
    workspaceId: state.workspaceId,
    generationId: state.generationId,
    outcomeId: state.outcomeId,
    candidateId: state.candidateId,
    skillName: state.skillName,
    admissionId: state.admissionId,
    holdoutEvaluationId: state.holdoutEvaluationId,
    retentionEvaluationId: state.retentionEvaluationId,
    evaluationEnvelopeId: state.evaluationEnvelopeId,
    holdoutCasePackHash: state.holdoutCasePackHash,
    retentionCasePackHash: state.retentionCasePackHash,
    baselineTreeHash: state.baselineTreeHash,
    candidateTreeHash: state.candidateTreeHash,
    dshRevision: state.dshRevision,
    status: state.phase === 'trial-pending' ? 'trial-pending' : 'prepared',
    releaseAuthority: 'none',
  })
}

async function prepareState(runDir: string, identity: CanaryIdentity): Promise<CanaryState> {
  try {
    const state = await readState(runDir)
    if (!sameIdentity(state, identity)) throw new Error('existing-Skill Canary durable inputs changed')
    return state
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error
  }
  const at = new Date().toISOString()
  const state = Object.freeze({ ...identity, phase: 'prepared' as const, createdAt: at, updatedAt: at })
  await writeDurableJson(join(runDir, 'state.json'), state)
  return state
}

async function writeState(
  runDir: string,
  state: CanaryState,
  phase: CanaryState['phase'],
): Promise<CanaryState> {
  const next = Object.freeze({ ...state, phase, updatedAt: new Date().toISOString() })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-counterfactual-canary-state-v1'),
  id: z.string().regex(CONTENT_ID),
  policyId: z.string().regex(PUBLIC_ID),
  workspaceId: z.uuid(),
  generationId: z.string().regex(CONTENT_ID),
  outcomeId: z.string().regex(CONTENT_ID),
  candidateId: z.string().regex(CONTENT_ID),
  skillName: z.string().regex(PUBLIC_ID),
  admissionId: z.string().regex(CONTENT_ID),
  holdoutEvaluationId: z.string().regex(CONTENT_ID),
  retentionEvaluationId: z.string().regex(CONTENT_ID),
  evaluationEnvelopeId: z.string().regex(CONTENT_ID),
  holdoutCasePackHash: z.string().regex(CONTENT_ID),
  retentionCasePackHash: z.string().regex(CONTENT_ID),
  baselineTreeHash: z.string().regex(CONTENT_ID),
  candidateTreeHash: z.string().regex(CONTENT_ID),
  dshRevision: z.string().regex(GIT_OBJECT),
  phase: z.enum(['prepared', 'trial-pending', 'terminal']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

const usageSchema = z.record(z.string(), z.number().nonnegative())
const evidenceSchema = z.strictObject({
  holdoutCasePackHash: z.string().regex(CONTENT_ID),
  retentionCasePackHash: z.string().regex(CONTENT_ID),
  baselineTreeHash: z.string().regex(CONTENT_ID),
  candidateTreeHash: z.string().regex(CONTENT_ID),
  baseline: z.enum(['pass', 'fail']),
  candidate: z.enum(['pass', 'fail']),
  calibrationPassed: z.boolean(),
  assembled: z.boolean(),
  compositionStable: z.boolean(),
  inputIntegrityStable: z.boolean(),
  activePointerStable: z.boolean(),
  proposerCalls: z.literal(0),
  trialCount: z.literal(4),
  modelCalls: z.strictObject({ baseline: z.number().int().nonnegative(), candidate: z.number().int().nonnegative() }).optional(),
  usage: z.strictObject({ baseline: usageSchema, candidate: usageSchema }).optional(),
})
const resultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-counterfactual-canary-result-v1'),
  id: z.string().regex(CONTENT_ID),
  policyId: z.string().regex(PUBLIC_ID),
  workspaceId: z.uuid(),
  generationId: z.string().regex(CONTENT_ID),
  outcomeId: z.string().regex(CONTENT_ID),
  candidateId: z.string().regex(CONTENT_ID),
  skillName: z.string().regex(PUBLIC_ID),
  admissionId: z.string().regex(CONTENT_ID),
  holdoutEvaluationId: z.string().regex(CONTENT_ID),
  retentionEvaluationId: z.string().regex(CONTENT_ID),
  evaluationEnvelopeId: z.string().regex(CONTENT_ID),
  status: z.enum(['keep', 'review', 'rollback-eligible']),
  reason: z.enum([
    'candidate-still-passes-sealed-canary',
    'candidate-regressed-baseline-recovers',
    'failed-outcome-not-isolated',
    'active-generation-changed',
    'canary-input-mutated',
    'canary-not-assembled',
    'canary-calibration-failed',
    'canary-composition-changed',
    'canary-trial-failed',
    'canary-trial-outcome-uncertain',
    'canary-replay-evidence-invalid',
  ]),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }),
  evidence: evidenceSchema.optional(),
  releaseAuthority: z.literal('none'),
})

async function readState(runDir: string): Promise<CanaryState> {
  return Object.freeze(stateSchema.parse(await readBoundedJson(join(runDir, 'state.json'))))
}

async function readResultIfPresent(
  path: string,
  identity: CanaryIdentity,
): Promise<ExistingSkillCounterfactualCanaryResult | undefined> {
  let value: unknown
  try {
    value = await readBoundedJson(path)
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined
    throw error
  }
  const result = resultSchema.parse(value)
  if (result.id !== identity.id
    || result.policyId !== identity.policyId
    || result.workspaceId !== identity.workspaceId
    || result.generationId !== identity.generationId
    || result.outcomeId !== identity.outcomeId
    || result.candidateId !== identity.candidateId
    || result.skillName !== identity.skillName
    || result.admissionId !== identity.admissionId
    || result.holdoutEvaluationId !== identity.holdoutEvaluationId
    || result.retentionEvaluationId !== identity.retentionEvaluationId
    || result.evaluationEnvelopeId !== identity.evaluationEnvelopeId) {
    throw new Error('existing-Skill Canary result does not match its exact prepared identity')
  }
  const { evidence, ...body } = result
  if (evidence === undefined) {
    if (result.status !== 'review'
      || !['canary-trial-failed', 'canary-trial-outcome-uncertain', 'canary-replay-evidence-invalid']
        .includes(result.reason)) {
      throw new Error('existing-Skill Canary terminal classification has no required evidence')
    }
    return Object.freeze(body)
  }
  const { modelCalls, usage, ...evidenceBody } = evidence
  const normalized = Object.freeze({
    ...body,
    evidence: Object.freeze({
      ...evidenceBody,
      ...(modelCalls === undefined ? {} : { modelCalls }),
      ...(usage === undefined ? {} : { usage }),
    }),
  })
  if (evidence.holdoutCasePackHash !== identity.holdoutCasePackHash
    || evidence.retentionCasePackHash !== identity.retentionCasePackHash
    || evidence.baselineTreeHash !== identity.baselineTreeHash
    || evidence.candidateTreeHash !== identity.candidateTreeHash) {
    throw new Error('existing-Skill Canary result evidence does not match its prepared inputs')
  }
  const classified = classifyEvidence(normalized.evidence)
  if (classified.status !== normalized.status || classified.reason !== normalized.reason) {
    throw new Error('existing-Skill Canary durable classification is invalid')
  }
  return normalized
}

async function readBoundedJson(path: string): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) {
    throw new Error('existing-Skill Canary JSON is not a bounded owned file')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function sameApprovedRelease(
  left: ExistingSkillReleaseEligibility,
  right: ExistingSkillReleaseEligibility & { readonly status: 'approved'; readonly generationId: string },
): left is ExistingSkillReleaseEligibility & { readonly status: 'approved'; readonly generationId: string } {
  return left.status === 'approved'
    && left.candidateId === right.candidateId
    && left.admissionId === right.admissionId
    && left.holdoutEvaluationId === right.holdoutEvaluationId
    && left.retentionEvaluationId === right.retentionEvaluationId
    && left.generationId === right.generationId
}

function sameIdentity(state: CanaryState, identity: CanaryIdentity): boolean {
  const { phase: _phase, createdAt: _createdAt, updatedAt: _updatedAt, ...actual } = state
  return JSON.stringify(actual) === JSON.stringify(identity)
}

function canaryId(value: Omit<CanaryIdentity, 'schemaVersion' | 'kind' | 'id'> | CanaryIdentity): string {
  return sha256Json([
    'existing-skill-counterfactual-canary-v1',
    value.policyId,
    value.workspaceId,
    value.generationId,
    value.outcomeId,
    value.candidateId,
    value.skillName,
    value.admissionId,
    value.holdoutEvaluationId,
    value.retentionEvaluationId,
    value.evaluationEnvelopeId,
    value.holdoutCasePackHash,
    value.retentionCasePackHash,
    value.baselineTreeHash,
    value.candidateTreeHash,
    value.dshRevision,
  ])
}

function canaryRunRoot(policy: ExistingSkillCounterfactualCanaryPolicy): string {
  return join(policy.runRoot, 'existing-skill-canary', 'runs')
}

function budgetTarget(
  policy: ExistingSkillCounterfactualCanaryPolicy,
  candidate: ExistingSkillCandidate,
): AutomaticEvolutionBudgetTarget {
  return Object.freeze({
    id: policy.id,
    workspaceId: policy.workspaceId,
    skill: candidate.skillName,
    runRoot: join(policy.runRoot, 'existing-skill-canary', '.budget', candidate.id),
    maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay,
  })
}

async function ensureExactDirectory(path: string): Promise<string> {
  const requested = resolve(path)
  await mkdir(requested, { recursive: true, mode: 0o700 })
  const info = await lstat(requested)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(requested) !== requested) {
    throw new Error('existing-Skill Canary path is not an exact owned directory')
  }
  return requested
}

function assertPolicies(
  policies: readonly (SkillCandidateEvaluationPolicyConfig & {
    readonly dshRevision: string
    readonly maxAttemptsPerUtcDay: number
  })[],
): void {
  if (policies.length > 100
    || new Set(policies.map(value => value.workspaceId)).size !== policies.length
    || policies.some(value => !PUBLIC_ID.test(value.id)
      || !isWorkspaceId(value.workspaceId)
      || !isAbsolute(value.governanceRoot)
      || !isAbsolute(value.runRoot)
      || !GIT_OBJECT.test(value.dshRevision)
      || !Number.isInteger(value.maxAttemptsPerUtcDay)
      || value.maxAttemptsPerUtcDay < 1
      || value.maxAttemptsPerUtcDay > 20
      || !separate(resolve(value.governanceRoot), resolve(value.runRoot)))) {
    throw new Error('existing-Skill Canary policies require unique exact separated governance and run roots')
  }
}

function separate(left: string, right: string): boolean {
  const contains = (root: string, path: string): boolean => {
    const value = relative(root, path)
    return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  }
  return !contains(left, right) && !contains(right, left)
}

function reconcileDetail(value: ExistingSkillCounterfactualCanaryReconcile): string {
  return value.status === 'completed'
    ? `${value.run.status}:${value.run.reason}`
    : `${value.status}:${value.reason}`
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown error'
}

export type { ExistingSkillCanaryReplay } from './existing-skill-retention-evaluation.ts'
