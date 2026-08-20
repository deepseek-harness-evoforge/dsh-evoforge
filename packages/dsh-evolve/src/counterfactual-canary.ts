import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetReservation,
  AutomaticEvolutionBudgetTarget,
} from './automatic-evolution-budget.ts'
import { readCapabilityAbsentSubject } from './capability-absent-subject.ts'
import type { DeliveryOutcome, DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { FutureSessionPromotion } from './future-session-promotion.ts'
import type {
  CapabilityGeneration,
  EvolutionStore,
  SkillBundleGenerationArtifact,
  SkillGenerationArtifact,
} from './generation-store.ts'
import { hashTree } from './hash.ts'
import type {
  InternalSkillRetention,
  InternalSkillRetentionRunView,
} from './internal-skill-retention.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import { parseCasePackManifest } from './shadow.ts'
import { acquireShadowRunLock, writeDurableJson } from './shadow-run-state.ts'
import type {
  QualifiedSkillCandidateShadowInput,
  SkillCandidateAdmission,
  SkillCandidateAdmissionResult,
} from './skill-candidate-admission.ts'
import { parseSkillCandidateLineage, type SkillCandidateLineage } from './skill-candidate-lineage.ts'
import type {
  ExperienceSkillCandidate,
  SkillCandidateStore,
} from './skill-candidate-repository.ts'
import { runPairedTrial, type PairedTrialResult } from './trial.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface CounterfactualCanaryPolicy {
  readonly id: string
  readonly workspaceId: string
  readonly runRoot: string
  readonly maxAttemptsPerUtcDay: number
}

export type CounterfactualCanaryReason =
  | 'candidate-retained-sealed-canary'
  | 'candidate-regressed-sealed-canary'
  | 'canary-input-mutated'
  | 'canary-not-assembled'
  | 'canary-calibration-failed'
  | 'canary-baseline-failed'
  | 'canary-composition-changed'
  | 'active-generation-changed'
  | 'canary-trial-outcome-uncertain'

export interface CounterfactualCanaryEvidence {
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

export interface CounterfactualCanaryResult {
  readonly schemaVersion: 1
  readonly kind: 'internal-counterfactual-canary-result-v1'
  readonly id: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly reviewId: string
  readonly retentionId: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly status: 'keep' | 'review' | 'rollback-eligible'
  readonly reason: CounterfactualCanaryReason
  readonly startedAt: string
  readonly finishedAt: string
  readonly evidence?: CounterfactualCanaryEvidence
  readonly releaseAuthority: 'none'
}

export interface CounterfactualCanaryRunView extends CounterfactualCanaryResult {}

export interface CounterfactualCanaryPreparedView {
  readonly schemaVersion: 1
  readonly kind: 'internal-counterfactual-canary-run-v1'
  readonly id: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly reviewId: string
  readonly retentionId: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly retentionCasePackHash: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly status: 'prepared'
  readonly releaseAuthority: 'none'
}

export interface CounterfactualCanaryScan {
  readonly configuredRootCount: number
  readonly warningCount: number
  readonly runs: readonly (CounterfactualCanaryRunView | CounterfactualCanaryPreparedView)[]
}

export type CounterfactualCanaryReconcile =
  | {
      readonly status: 'idle'
      readonly reason:
        | 'canary-not-configured'
        | 'no-active-generation'
        | 'no-failed-active-outcome'
        | 'rollback-already-eligible'
        | 'canary-review-required'
    }
  | {
      readonly status: 'waiting'
      readonly reason: 'canary-budget-exhausted'
      readonly retryAt: number
      readonly outcomeId: string
      readonly generationId: string
    }
  | {
      readonly status: 'blocked'
      readonly reason: 'active-generation-not-exactly-retained' | 'canary-evidence-invalid'
      readonly generationId: string
      readonly outcomeId: string
    }
  | { readonly status: 'completed'; readonly run: CounterfactualCanaryResult }

export interface CounterfactualCanaryModules {
  readonly store: Pick<EvolutionStore, 'getActiveGeneration' | 'getGeneration'>
  readonly outcomes: Pick<DeliveryOutcomeStore, 'list'>
  readonly promotion: Pick<FutureSessionPromotion, 'eligibility'>
  readonly review: Pick<ReviewInbox, 'get'>
  readonly retention: Pick<InternalSkillRetention, 'scan'>
  readonly candidates: Pick<SkillCandidateStore, 'listCandidates'>
  readonly admissions: Pick<SkillCandidateAdmission, 'scan' | 'qualifiedShadowInput'>
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
}

interface CanaryRunIdentity {
  readonly schemaVersion: 1
  readonly kind: 'internal-counterfactual-canary-run-v1'
  readonly id: string
  readonly workspaceId: string
  readonly generationId: string
  readonly outcomeId: string
  readonly candidateId: string
  readonly skillName: string
  readonly reviewId: string
  readonly retentionId: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly retentionCasePackHash: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
}

interface ExactCanaryInput {
  readonly policy: CounterfactualCanaryPolicy
  readonly generation: CapabilityGeneration
  readonly outcome: DeliveryOutcome
  readonly artifact: SkillBundleGenerationArtifact
  readonly candidate: ExperienceSkillCandidate
  readonly admission: SkillCandidateAdmissionResult
  readonly review: ReviewCandidate
  readonly retention: InternalSkillRetentionRunView
  readonly source: QualifiedSkillCandidateShadowInput
  readonly baselineDir: string
  readonly candidateDir: string
  readonly casePackDir: string
  readonly runRoot: string
  readonly manifest: ReturnType<typeof parseCasePackManifest>
  readonly identity: CanaryRunIdentity
}

type TrialRunner = typeof runPairedTrial

/**
 * Revalidate one failed Outcome against the exact active internal Candidate.
 * The module owns no Generation mutation interface and therefore can only emit
 * future-Session rollback eligibility for a separate Host release authority.
 */
export class CounterfactualCanary {
  private readonly modules: CounterfactualCanaryModules
  private readonly policies: readonly CounterfactualCanaryPolicy[]
  private readonly runTrial: TrialRunner

  constructor(
    modules: CounterfactualCanaryModules,
    options: {
      readonly policies: readonly CounterfactualCanaryPolicy[]
      readonly runTrial?: TrialRunner
    },
  ) {
    assertPolicies(options.policies)
    this.modules = modules
    this.policies = options.policies.map(policy => Object.freeze({ ...policy }))
    this.runTrial = options.runTrial ?? runPairedTrial
  }

  async reconcile(
    workspaceId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<CounterfactualCanaryReconcile> {
    options.signal?.throwIfAborted()
    const policy = this.policies.find(value => value.workspaceId === workspaceId)
    if (policy === undefined) return { status: 'idle', reason: 'canary-not-configured' }
    const active = this.modules.store.getActiveGeneration(workspaceId)
    if (active === undefined) return { status: 'idle', reason: 'no-active-generation' }

    const existing = await this.scan(workspaceId)
    const activeTerminal = existing.runs.filter(run => run.generationId === active.id && run.status !== 'prepared')
    if (activeTerminal.some(run => run.status === 'rollback-eligible')) {
      return { status: 'idle', reason: 'rollback-already-eligible' }
    }
    if (activeTerminal.some(run => run.status === 'review')) {
      return { status: 'idle', reason: 'canary-review-required' }
    }
    const completedOutcomes = new Set(existing.runs
      .filter(run => run.generationId === active.id && run.status !== 'prepared')
      .map(run => run.outcomeId))
    const outcome = this.modules.outcomes.list(workspaceId)
      .filter(value => value.status === 'failed'
        && value.generationId === active.id
        && !completedOutcomes.has(value.id))
      .sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))[0]
    if (outcome === undefined) return { status: 'idle', reason: 'no-failed-active-outcome' }
    if (existing.warningCount !== 0) {
      return {
        status: 'blocked',
        reason: 'canary-evidence-invalid',
        generationId: active.id,
        outcomeId: outcome.id,
      }
    }

    const eligibility = await this.modules.promotion.eligibility(workspaceId, active.id)
    if (eligibility.status !== 'eligible') {
      return {
        status: 'blocked',
        reason: 'active-generation-not-exactly-retained',
        generationId: active.id,
        outcomeId: outcome.id,
      }
    }

    let exact: ExactCanaryInput
    try {
      exact = await this.resolveExactInput(policy, active, outcome, eligibility.reviewId, eligibility.retentionId)
    } catch {
      return {
        status: 'blocked',
        reason: 'canary-evidence-invalid',
        generationId: active.id,
        outcomeId: outcome.id,
      }
    }

    const prior = await readExistingResult(join(exact.runRoot, exact.identity.id, 'result.json'), exact.identity)
    if (prior !== undefined) return { status: 'completed', run: prior }

    const reservation = await this.modules.budget.reserve(
      budgetTarget(exact.policy, exact.candidate),
      exact.outcome.id,
    )
    if (!reservation.allowed) {
      return {
        status: 'waiting',
        reason: 'canary-budget-exhausted',
        retryAt: reservation.retryAt!,
        outcomeId: outcome.id,
        generationId: active.id,
      }
    }
    return {
      status: 'completed',
      run: await this.execute(exact, reservation, options),
    }
  }

  /** Read only bounded, content-addressed canary state for Host/Web projection. */
  async scan(workspaceId?: string): Promise<CounterfactualCanaryScan> {
    const policies = this.policies.filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
    const runs = new Map<string, CounterfactualCanaryRunView | CounterfactualCanaryPreparedView>()
    let warningCount = 0
    for (const policy of policies) {
      let root: string
      let entries
      try {
        root = await realpath(policy.runRoot)
        entries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) warningCount += 1
        continue
      }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      if (entries.length > 1_000) warningCount += 1
      for (const entry of entries.slice(0, 1_000)) {
        if (!CONTENT_ID.test(entry.name)) continue
        if (!entry.isDirectory()) {
          warningCount += 1
          continue
        }
        try {
          const outputDir = join(root, entry.name)
          const info = await lstat(outputDir)
          if (!info.isDirectory() || info.isSymbolicLink() || await realpath(outputDir) !== outputDir) {
            throw new Error('canary run is not an exact owned directory')
          }
          const prepared = await readPrepared(outputDir)
          if (prepared.id !== entry.name || prepared.workspaceId !== policy.workspaceId
            || prepared.id !== canaryId(prepared)) {
            throw new Error('canary prepared identity is not content-addressed')
          }
          const result = await readExistingResult(join(outputDir, 'result.json'), prepared)
          const view = result ?? Object.freeze({
            ...prepared,
            status: 'prepared' as const,
            releaseAuthority: 'none' as const,
          })
          const duplicate = runs.get(view.id)
          if (duplicate !== undefined && JSON.stringify(duplicate) !== JSON.stringify(view)) {
            throw new Error('duplicate canary id has different evidence')
          }
          runs.set(view.id, duplicate ?? view)
        } catch {
          warningCount += 1
        }
      }
    }
    return Object.freeze({
      configuredRootCount: policies.length,
      warningCount,
      runs: [...runs.values()].sort((left, right) => left.id.localeCompare(right.id)),
    })
  }

  private async resolveExactInput(
    policy: CounterfactualCanaryPolicy,
    generation: CapabilityGeneration,
    outcome: DeliveryOutcome,
    reviewId: string,
    retentionId: string,
  ): Promise<ExactCanaryInput> {
    const artifact = exactGenerationDelta(generation, this.modules.store.getGeneration(generation.parentId ?? ''))
    const lineage = parseSkillCandidateLineage(artifact.lineage)
    const [review, retentionScan, admissionScan] = await Promise.all([
      this.modules.review.get(reviewId),
      this.modules.retention.scan(generation.workspaceId),
      this.modules.admissions.scan(generation.workspaceId),
    ])
    if (retentionScan.warningCount !== 0 || retentionScan.configuredRootCount < 1
      || admissionScan.warningCount !== 0 || admissionScan.configuredPolicyCount < 1) {
      throw new Error('canary owner projection contains invalid evidence')
    }
    const retentions = retentionScan.runs.filter(value => value.id === retentionId)
    const candidates = this.modules.candidates.listCandidates(generation.workspaceId)
      .filter(value => value.id === lineage.candidateId)
    const admissions = admissionScan.results.filter(value => value.id === lineage.admissionId)
    if (retentions.length !== 1 || candidates.length !== 1 || admissions.length !== 1) {
      throw new Error('canary exact Candidate evidence is missing or ambiguous')
    }
    const retention = retentions[0]!
    const candidate = candidates[0]!
    const admission = admissions[0]!
    assertExactOwners(generation, outcome, artifact, lineage, review, retention, candidate, admission)
    const source = await this.modules.admissions.qualifiedShadowInput(candidate, admission)
    if (source.retentionCasePackDir === undefined
      || source.retentionCasePackHash === undefined
      || !exactLineage(source.lineage, lineage)) {
      throw new Error('canary has no exact independent Retention handoff')
    }
    const [baselineDir, candidateDir, casePackDir, runRoot] = await Promise.all([
      realpath(source.baselineDir),
      realpath(source.candidateDir),
      realpath(source.retentionCasePackDir),
      resolveOwnedRunRoot(policy.runRoot),
    ])
    assertSeparateCanaryRoot(runRoot, [
      baselineDir,
      candidateDir,
      casePackDir,
      source.admissionCasePackDir,
      source.admissionRunRoot,
      source.holdoutCasePackDir,
      source.shadowRunRoot,
      ...(source.retentionRunRoot === undefined ? [] : [source.retentionRunRoot]),
    ])
    const [baselineTreeHash, candidateTreeHash, retentionCasePackHash] = await Promise.all([
      hashTree(baselineDir),
      hashTree(candidateDir),
      hashTree(casePackDir),
    ])
    const subject = await readCapabilityAbsentSubject(baselineDir)
    const evidence = retention.evidence
    if (subject.workspaceId !== generation.workspaceId
      || subject.opportunityId !== lineage.opportunityId
      || subject.skillName !== lineage.skillName
      || baselineTreeHash !== review.baseTreeHash
      || candidateTreeHash !== lineage.candidateTreeHash
      || candidateTreeHash !== artifact.treeHash
      || retentionCasePackHash !== source.retentionCasePackHash
      || evidence?.retentionCasePackHash !== retentionCasePackHash
      || evidence.baselineTreeHash !== baselineTreeHash
      || evidence.candidateTreeHash !== candidateTreeHash) {
      throw new Error('canary exact replay inputs changed after retained promotion evidence')
    }
    const manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
    if (manifest.workspaceId !== generation.workspaceId
      || manifest.trial?.dshAssembled !== true
      || manifest.trial.capabilityAbsentBaseline !== true
      || manifest.calibration === undefined
      || manifest.budget.trialLimit < 4) {
      throw new Error('canary requires an exact assembled Retention Case Pack')
    }
    const identityWithoutId = {
      schemaVersion: 1 as const,
      kind: 'internal-counterfactual-canary-run-v1' as const,
      workspaceId: generation.workspaceId,
      generationId: generation.id,
      outcomeId: outcome.id,
      candidateId: candidate.id,
      skillName: candidate.skillName,
      reviewId,
      retentionId,
      admissionId: admission.id,
      evaluationEnvelopeId: source.evaluationEnvelopeId,
      retentionCasePackHash,
      baselineTreeHash,
      candidateTreeHash,
    }
    const identity = Object.freeze({
      ...identityWithoutId,
      id: canaryId(identityWithoutId),
    })
    return Object.freeze({
      policy,
      generation,
      outcome,
      artifact,
      candidate,
      admission,
      review,
      retention,
      source,
      baselineDir,
      candidateDir,
      casePackDir,
      runRoot,
      manifest,
      identity,
    })
  }

  private async execute(
    exact: ExactCanaryInput,
    _reservation: AutomaticEvolutionBudgetReservation,
    options: { signal?: AbortSignal },
  ): Promise<CounterfactualCanaryResult> {
    const outputDir = join(exact.runRoot, exact.identity.id)
    const resultPath = join(outputDir, 'result.json')
    await ensureRunDirectory(outputDir)
    const releaseLock = await acquireShadowRunLock(outputDir)
    try {
      await ensurePrepared(outputDir, exact.identity)
      const existing = await readExistingResult(resultPath, exact.identity)
      if (existing !== undefined) return existing
      const dispatchPath = join(outputDir, 'trial-dispatch.json')
      const startedAt = new Date().toISOString()
      if (await exists(dispatchPath)) {
        const uncertain = terminalResult(exact, startedAt, 'review', 'canary-trial-outcome-uncertain')
        await writeDurableJson(resultPath, uncertain)
        return uncertain
      }
      await writeDurableJson(dispatchPath, {
        schemaVersion: 1,
        kind: 'internal-counterfactual-canary-trial-dispatch-v1',
        id: exact.identity.id,
        startedAt,
      })
      let trial: PairedTrialResult
      try {
        trial = await this.runTrial({
          baselineKind: 'capability-absent',
          baselineSkillName: exact.candidate.skillName,
          calibration: exact.manifest.calibration!,
          casePackDir: exact.casePackDir,
          candidateSkillDir: exact.candidateDir,
          dshRevision: exact.manifest.epoch.dshRevision,
          outputDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir: exact.baselineDir,
          trial: exact.manifest.trial!,
          trialLimit: exact.manifest.budget.trialLimit,
        })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        const uncertain = terminalResult(exact, startedAt, 'review', 'canary-trial-outcome-uncertain')
        await writeDurableJson(resultPath, uncertain)
        return uncertain
      }
      const [baselineTreeHash, candidateTreeHash, retentionCasePackHash] = await Promise.all([
        hashTree(exact.baselineDir),
        hashTree(exact.candidateDir),
        hashTree(exact.casePackDir),
      ])
      const current = this.modules.store.getActiveGeneration(exact.generation.workspaceId)
      const activePointerStable = current?.id === exact.generation.id
      const calibrationPassed = trial.calibration.every(value => value.passed)
      const baselineComposition = trial.baseline.composition
      const candidateComposition = trial.candidate.composition
      const compositionStable = baselineComposition !== undefined
        && candidateComposition !== undefined
        && baselineComposition.fingerprint === candidateComposition.fingerprint
      const integrityStable = baselineTreeHash === exact.identity.baselineTreeHash
        && candidateTreeHash === exact.identity.candidateTreeHash
        && retentionCasePackHash === exact.identity.retentionCasePackHash
        && trial.baseline.treeHash === exact.identity.baselineTreeHash
        && trial.candidate.treeHash === exact.identity.candidateTreeHash
      const evidence: CounterfactualCanaryEvidence = Object.freeze({
        // These hashes bind the verdict to the immutable prepared identity.
        // Observed drift is represented by inputIntegrityStable=false; storing
        // the drifted hash here would make the safety verdict unreadable.
        retentionCasePackHash: exact.identity.retentionCasePackHash,
        baselineTreeHash: exact.identity.baselineTreeHash,
        candidateTreeHash: exact.identity.candidateTreeHash,
        baseline: trial.baseline.passed ? 'pass' : 'fail',
        candidate: trial.candidate.passed ? 'pass' : 'fail',
        calibrationPassed,
        assembled: trial.assembled,
        compositionStable,
        inputIntegrityStable: integrityStable,
        activePointerStable,
        proposerCalls: 0,
        trialCount: 4,
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
      const verdict = !activePointerStable
        ? { status: 'review' as const, reason: 'active-generation-changed' as const }
        : !integrityStable
          ? { status: 'review' as const, reason: 'canary-input-mutated' as const }
          : trial.assembled !== true
            ? { status: 'review' as const, reason: 'canary-not-assembled' as const }
            : !calibrationPassed
              ? { status: 'review' as const, reason: 'canary-calibration-failed' as const }
              : !trial.baseline.passed
                ? { status: 'review' as const, reason: 'canary-baseline-failed' as const }
                : !compositionStable
                  ? { status: 'review' as const, reason: 'canary-composition-changed' as const }
                  : !trial.candidate.passed
                    ? {
                        status: 'rollback-eligible' as const,
                        reason: 'candidate-regressed-sealed-canary' as const,
                      }
                    : {
                        status: 'keep' as const,
                        reason: 'candidate-retained-sealed-canary' as const,
                      }
      const result = terminalResult(exact, startedAt, verdict.status, verdict.reason, evidence)
      await writeDurableJson(resultPath, result)
      return result
    } finally {
      await releaseLock()
    }
  }
}

/** Native DSH Jobs is the only process-local execution and cancellation seam. */
export class CounterfactualCanaryScheduler {
  private readonly canary: Pick<CounterfactualCanary, 'reconcile'>
  private readonly workspaces: ReadonlySet<string>
  private readonly pending = new Set<string>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start' | 'onJobDone'> | undefined

  constructor(
    canary: Pick<CounterfactualCanary, 'reconcile'>,
    workspaces: readonly string[],
  ) {
    if (workspaces.some(workspaceId => !isWorkspaceId(workspaceId))) {
      throw new Error('counterfactual canary scheduler requires native Workspace ids')
    }
    this.canary = canary
    this.workspaces = new Set(workspaces)
  }

  attachJobs(jobs: Pick<JobRegistry, 'start' | 'onJobDone'>): () => void {
    if (this.jobs !== undefined) throw new Error('counterfactual canary Jobs seam is already attached')
    this.jobs = jobs
    const detachDone = jobs.onJobDone(() => this.drain())
    for (const workspaceId of this.workspaces) this.pending.add(workspaceId)
    this.drain()
    return () => {
      detachDone()
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  /** Wake one configured Workspace after a durable Outcome or continuity scan. */
  observe(workspaceId: string): void {
    if (!this.workspaces.has(workspaceId) || this.active.has(workspaceId)) return
    this.pending.add(workspaceId)
    this.drain()
  }

  private drain(): void {
    const jobs = this.jobs
    if (jobs === undefined) return
    for (const workspaceId of this.pending) {
      if (this.active.has(workspaceId)) continue
      this.pending.delete(workspaceId)
      this.active.add(workspaceId)
      const controller = new AbortController()
      try {
        jobs.start({
          kind: 'evolution',
          label: 'counterfactual active-Candidate canary',
          outputLimitBytes: 2_048,
          run: () => {
            const task = this.canary.reconcile(workspaceId, { signal: controller.signal })
            return {
              cancel: (reason?: string) => controller.abort(new Error(reason ?? 'counterfactual canary cancelled')),
              done: task.then(value => ({
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted
                  ? errorDetail(controller.signal.reason)
                  : reconcileDetail(value),
                ...controller.signal.aborted ? {} : { output: boundedOutput(reconcileDetail(value)) },
              }), (error: unknown) => ({
                status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
                detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
              })).finally(() => {
                this.active.delete(workspaceId)
                this.drain()
              }),
            }
          },
        })
      } catch {
        this.active.delete(workspaceId)
        this.pending.add(workspaceId)
        break
      }
    }
  }
}

function assertExactOwners(
  generation: CapabilityGeneration,
  outcome: DeliveryOutcome,
  artifact: SkillBundleGenerationArtifact,
  lineage: SkillCandidateLineage,
  review: ReviewCandidate,
  retention: InternalSkillRetentionRunView,
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
): void {
  const evidence = retention.evidence
  if (outcome.status !== 'failed'
    || outcome.workspaceId !== generation.workspaceId
    || outcome.generationId !== generation.id
    || artifact.name !== lineage.skillName
    || artifact.artifactDigest !== lineage.contentHash
    || artifact.treeHash !== lineage.candidateTreeHash
    || review.workspaceId !== generation.workspaceId
    || review.generationId !== generation.id
    || review.id.length !== 64
    || review.status !== 'approved'
    || review.recommendation !== 'promote'
    || review.lineage === undefined
    || !exactLineage(review.lineage, lineage)
    || retention.status !== 'retained'
    || retention.reason !== 'candidate-retained-prior-case'
    || retention.workspaceId !== generation.workspaceId
    || retention.candidateId !== lineage.candidateId
    || retention.skillName !== lineage.skillName
    || retention.admissionId !== lineage.admissionId
    || retention.evaluationEnvelopeId !== lineage.evaluationEnvelopeId
    || retention.shadowRunId !== review.runId
    || retention.baselineTreeHash !== review.baseTreeHash
    || retention.candidateTreeHash !== review.candidateTreeHash
    || evidence === undefined
    || evidence.baseline !== 'pass'
    || evidence.candidate !== 'pass'
    || !evidence.calibrationPassed
    || !evidence.compositionStable
    || evidence.proposerCalls !== 0
    || evidence.trialCount !== 4
    || candidate.id !== lineage.candidateId
    || candidate.workspaceId !== generation.workspaceId
    || candidate.skillName !== lineage.skillName
    || candidate.opportunity.id !== lineage.opportunityId
    || candidate.authorship.evaluationEvidenceId !== lineage.evaluationEvidenceId
    || candidate.authorship.policyId !== lineage.policyId
    || candidate.version.kind !== lineage.versionKind
    || candidate.contentHash !== lineage.contentHash
    || candidate.version.treeHash !== lineage.candidateTreeHash
    || admission.status !== 'qualified-for-shadow'
    || admission.id !== lineage.admissionId
    || admission.candidateId !== lineage.candidateId
    || admission.envelopeId !== lineage.evaluationEnvelopeId
    || admission.evidence?.candidateTreeHash !== lineage.candidateTreeHash) {
    throw new Error('canary evidence does not bind one exact retained active Candidate')
  }
}

function exactGenerationDelta(
  generation: CapabilityGeneration,
  parent: CapabilityGeneration | undefined,
): SkillBundleGenerationArtifact {
  if (generation.parentId !== undefined && parent?.id !== generation.parentId) {
    throw new Error('active internal Generation has no exact parent')
  }
  if (parent !== undefined && parent.workspaceId !== generation.workspaceId) {
    throw new Error('active internal Generation parent belongs to another Workspace')
  }
  const parentArtifacts = parent?.artifacts ?? []
  const added = generation.artifacts.filter(artifact => !parentArtifacts.some(value => sameArtifact(value, artifact)))
  if (added.length !== 1 || added[0]?.kind !== 'skill-bundle') {
    throw new Error('active Generation does not add exactly one internal Skill Candidate')
  }
  return added[0]
}

function sameArtifact(left: SkillGenerationArtifact, right: SkillGenerationArtifact): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function exactLineage(left: SkillCandidateLineage, right: SkillCandidateLineage): boolean {
  const parsedLeft = parseSkillCandidateLineage(left)
  const parsedRight = parseSkillCandidateLineage(right)
  return parsedLeft.kind === parsedRight.kind
    && parsedLeft.candidateId === parsedRight.candidateId
    && parsedLeft.workspaceId === parsedRight.workspaceId
    && parsedLeft.skillName === parsedRight.skillName
    && parsedLeft.opportunityId === parsedRight.opportunityId
    && parsedLeft.evaluationEvidenceId === parsedRight.evaluationEvidenceId
    && parsedLeft.policyId === parsedRight.policyId
    && parsedLeft.versionKind === parsedRight.versionKind
    && parsedLeft.contentHash === parsedRight.contentHash
    && parsedLeft.candidateTreeHash === parsedRight.candidateTreeHash
    && parsedLeft.admissionId === parsedRight.admissionId
    && parsedLeft.evaluationEnvelopeId === parsedRight.evaluationEnvelopeId
    && parsedLeft.releaseAuthority === parsedRight.releaseAuthority
}

function budgetTarget(
  policy: CounterfactualCanaryPolicy,
  candidate: ExperienceSkillCandidate,
): AutomaticEvolutionBudgetTarget {
  return Object.freeze({
    id: policy.id,
    workspaceId: policy.workspaceId,
    skill: candidate.skillName,
    runRoot: join(policy.runRoot, '.budget', candidate.id),
    maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay,
  })
}

function terminalResult(
  exact: ExactCanaryInput,
  startedAt: string,
  status: CounterfactualCanaryResult['status'],
  reason: CounterfactualCanaryReason,
  evidence?: CounterfactualCanaryEvidence,
): CounterfactualCanaryResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'internal-counterfactual-canary-result-v1',
    id: exact.identity.id,
    workspaceId: exact.identity.workspaceId,
    generationId: exact.identity.generationId,
    outcomeId: exact.identity.outcomeId,
    candidateId: exact.identity.candidateId,
    skillName: exact.identity.skillName,
    reviewId: exact.identity.reviewId,
    retentionId: exact.identity.retentionId,
    admissionId: exact.identity.admissionId,
    evaluationEnvelopeId: exact.identity.evaluationEnvelopeId,
    status,
    reason,
    startedAt,
    finishedAt: new Date().toISOString(),
    ...(evidence === undefined ? {} : { evidence }),
    releaseAuthority: 'none',
  })
}

async function ensureRunDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!isExisting(error)) throw error
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
      throw new Error('canary output is not an exact owned directory')
    }
  }
}

async function resolveOwnedRunRoot(requested: string): Promise<string> {
  const path = resolve(requested)
  if (relative(path, resolve(path, '..')) === '') {
    throw new Error('counterfactual canary run root must not be a filesystem root')
  }
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('counterfactual canary run root must be an exact owned directory')
  }
  return path
}

async function ensurePrepared(outputDir: string, expected: CanaryRunIdentity): Promise<void> {
  const path = join(outputDir, 'prepared.json')
  try {
    const value = await readPrepared(outputDir)
    if (JSON.stringify(value) !== JSON.stringify(expected)) {
      throw new Error('canary prepared identity does not match exact inputs')
    }
  } catch (error) {
    if (!isMissing(error)) throw error
    await writeDurableJson(path, expected)
  }
}

async function readPrepared(outputDir: string): Promise<CanaryRunIdentity> {
  const path = join(outputDir, 'prepared.json')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('canary prepared identity must be an owned regular file')
  }
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isRunIdentity(value)) throw new Error('canary prepared identity has an invalid shape')
  return Object.freeze(value)
}

async function readExistingResult(
  path: string,
  prepared: CanaryRunIdentity,
): Promise<CounterfactualCanaryResult | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('canary result must be an owned regular file')
    }
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isResult(value) || !resultMatchesPrepared(value, prepared)) {
      throw new Error('canary result does not match its exact run identity')
    }
    return Object.freeze(value)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function isRunIdentity(value: unknown): value is CanaryRunIdentity {
  return isRecord(value)
    && value.schemaVersion === 1
    && value.kind === 'internal-counterfactual-canary-run-v1'
    && CONTENT_ID.test(String(value.id))
    && isWorkspaceId(String(value.workspaceId))
    && CONTENT_ID.test(String(value.generationId))
    && CONTENT_ID.test(String(value.outcomeId))
    && CONTENT_ID.test(String(value.candidateId))
    && PUBLIC_ID.test(String(value.skillName))
    && CONTENT_ID.test(String(value.reviewId))
    && CONTENT_ID.test(String(value.retentionId))
    && CONTENT_ID.test(String(value.admissionId))
    && CONTENT_ID.test(String(value.evaluationEnvelopeId))
    && CONTENT_ID.test(String(value.retentionCasePackHash))
    && CONTENT_ID.test(String(value.baselineTreeHash))
    && CONTENT_ID.test(String(value.candidateTreeHash))
}

function isResult(value: unknown): value is CounterfactualCanaryResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'internal-counterfactual-canary-result-v1'
    || !CONTENT_ID.test(String(value.id))
    || !isWorkspaceId(String(value.workspaceId))
    || !CONTENT_ID.test(String(value.generationId))
    || !CONTENT_ID.test(String(value.outcomeId))
    || !CONTENT_ID.test(String(value.candidateId))
    || !PUBLIC_ID.test(String(value.skillName))
    || !CONTENT_ID.test(String(value.reviewId))
    || !CONTENT_ID.test(String(value.retentionId))
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.evaluationEnvelopeId))
    || !['keep', 'review', 'rollback-eligible'].includes(String(value.status))
    || !CANARY_REASONS.has(value.reason as CounterfactualCanaryReason)
    || typeof value.startedAt !== 'string'
    || typeof value.finishedAt !== 'string'
    || value.releaseAuthority !== 'none') return false
  const evidence = value.evidence === undefined ? undefined : parseEvidence(value.evidence)
  if (value.evidence !== undefined && evidence === undefined) return false
  return validVerdictBinding(
    value.status as CounterfactualCanaryResult['status'],
    value.reason as CounterfactualCanaryReason,
    evidence,
    value.evidence === undefined,
  )
}

function parseEvidence(value: unknown): CounterfactualCanaryEvidence | undefined {
  if (!isRecord(value)
    || !CONTENT_ID.test(String(value.retentionCasePackHash))
    || !CONTENT_ID.test(String(value.baselineTreeHash))
    || !CONTENT_ID.test(String(value.candidateTreeHash))
    || !['pass', 'fail'].includes(String(value.baseline))
    || !['pass', 'fail'].includes(String(value.candidate))
    || typeof value.calibrationPassed !== 'boolean'
    || typeof value.assembled !== 'boolean'
    || typeof value.compositionStable !== 'boolean'
    || typeof value.inputIntegrityStable !== 'boolean'
    || typeof value.activePointerStable !== 'boolean'
    || value.proposerCalls !== 0
    || value.trialCount !== 4) return undefined
  if ((value.modelCalls === undefined) !== (value.usage === undefined)) return undefined
  if (value.modelCalls !== undefined && (!isNonNegativePair(value.modelCalls)
    || !isUsagePair(value.usage))) return undefined
  return value as unknown as CounterfactualCanaryEvidence
}

function validVerdictBinding(
  status: CounterfactualCanaryResult['status'],
  reason: CounterfactualCanaryReason,
  evidence: CounterfactualCanaryEvidence | undefined,
  evidenceAbsent: boolean,
): boolean {
  if (reason === 'canary-trial-outcome-uncertain') {
    return status === 'review' && evidenceAbsent
  }
  if (evidence === undefined) return false
  if (reason === 'active-generation-changed') {
    return status === 'review' && evidence.activePointerStable === false
  }
  if (reason === 'canary-input-mutated') {
    return status === 'review' && evidence.activePointerStable && evidence.inputIntegrityStable === false
  }
  if (!evidence.activePointerStable || !evidence.inputIntegrityStable) return false
  if (reason === 'canary-not-assembled') {
    return status === 'review' && evidence.assembled === false
  }
  if (!evidence.assembled) return false
  if (reason === 'canary-calibration-failed') {
    return status === 'review' && evidence.calibrationPassed === false
  }
  if (!evidence.calibrationPassed) return false
  if (reason === 'canary-baseline-failed') {
    return status === 'review' && evidence.baseline === 'fail'
  }
  if (evidence.baseline !== 'pass') return false
  if (reason === 'canary-composition-changed') {
    return status === 'review' && evidence.compositionStable === false
  }
  if (!evidence.compositionStable) return false
  if (reason === 'candidate-regressed-sealed-canary') {
    return status === 'rollback-eligible' && evidence.candidate === 'fail'
  }
  return reason === 'candidate-retained-sealed-canary'
    && status === 'keep'
    && evidence.candidate === 'pass'
}

function resultMatchesPrepared(
  result: CounterfactualCanaryResult,
  prepared: CanaryRunIdentity,
): boolean {
  return result.id === prepared.id
    && result.workspaceId === prepared.workspaceId
    && result.generationId === prepared.generationId
    && result.outcomeId === prepared.outcomeId
    && result.candidateId === prepared.candidateId
    && result.skillName === prepared.skillName
    && result.reviewId === prepared.reviewId
    && result.retentionId === prepared.retentionId
    && result.admissionId === prepared.admissionId
    && result.evaluationEnvelopeId === prepared.evaluationEnvelopeId
    && (result.evidence === undefined
      || (result.evidence.retentionCasePackHash === prepared.retentionCasePackHash
        && result.evidence.baselineTreeHash === prepared.baselineTreeHash
        && result.evidence.candidateTreeHash === prepared.candidateTreeHash))
}

function canaryId(input: Omit<CanaryRunIdentity, 'id'> | CanaryRunIdentity): string {
  return createHash('sha256').update(JSON.stringify([
    'internal-counterfactual-canary-v1',
    input.workspaceId,
    input.generationId,
    input.outcomeId,
    input.candidateId,
    input.skillName,
    input.reviewId,
    input.retentionId,
    input.admissionId,
    input.evaluationEnvelopeId,
    input.retentionCasePackHash,
    input.baselineTreeHash,
    input.candidateTreeHash,
  ])).digest('hex')
}

function assertPolicies(policies: readonly CounterfactualCanaryPolicy[]): void {
  if (policies.some(policy => !PUBLIC_ID.test(policy.id)
    || !isWorkspaceId(policy.workspaceId)
    || !isAbsolute(policy.runRoot)
    || resolve(policy.runRoot) === resolve(policy.runRoot, '..')
    || !Number.isSafeInteger(policy.maxAttemptsPerUtcDay)
    || policy.maxAttemptsPerUtcDay < 1
    || policy.maxAttemptsPerUtcDay > 20)) {
    throw new Error('counterfactual canary policies require exact Workspace, root, id, and daily budget')
  }
  if (new Set(policies.map(policy => policy.workspaceId)).size !== policies.length
    || new Set(policies.map(policy => resolve(policy.runRoot))).size !== policies.length) {
    throw new Error('counterfactual canary policies require one uniquely owned root per Workspace')
  }
}

function assertSeparateCanaryRoot(runRoot: string, inputs: readonly string[]): void {
  for (const input of inputs) {
    if (!separate(runRoot, resolve(input))) {
      throw new Error('counterfactual canary run root overlaps sealed evaluation inputs')
    }
  }
}

function separate(left: string, right: string): boolean {
  const contains = (root: string, path: string): boolean => {
    const value = relative(root, path)
    return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  }
  return !contains(left, right) && !contains(right, left)
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('canary dispatch marker must be an owned regular file')
    }
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function isNonNegativePair(value: unknown): boolean {
  return isRecord(value)
    && nonNegativeInteger(value.baseline)
    && nonNegativeInteger(value.candidate)
}

function isUsagePair(value: unknown): boolean {
  return isRecord(value) && isUsage(value.baseline) && isUsage(value.candidate)
}

function isUsage(value: unknown): boolean {
  return isRecord(value)
    && ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
      .every(key => value[key] === undefined || nonNegativeInteger(value[key]))
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isExisting(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function reconcileDetail(value: CounterfactualCanaryReconcile): string {
  return value.status === 'completed'
    ? `${value.run.status}: ${value.run.reason}`
    : `${value.status}: ${value.reason}`
}

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}

function boundedOutput(value: string): string {
  return Buffer.from(value).subarray(0, 2_048).toString('utf8')
}

const CANARY_REASONS = new Set<CounterfactualCanaryReason>([
  'candidate-retained-sealed-canary',
  'candidate-regressed-sealed-canary',
  'canary-input-mutated',
  'canary-not-assembled',
  'canary-calibration-failed',
  'canary-baseline-failed',
  'canary-composition-changed',
  'active-generation-changed',
  'canary-trial-outcome-uncertain',
])
