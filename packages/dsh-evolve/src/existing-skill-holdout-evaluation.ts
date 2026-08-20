import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { ExistingSkillCandidateAdmissionResult } from './existing-skill-candidate-admission.ts'
import type {
  ExistingSkillHoldoutCandidateBinding,
  ExistingSkillHoldoutEnvelope,
} from './existing-skill-holdout-governance.ts'
import { hashTree } from './hash.ts'
import type { InstalledSkillBaselineManifest } from './installed-skill-baseline.ts'
import { parseCasePackManifest, type CasePackManifest } from './shadow.ts'
import {
  acquireShadowRunLock,
  writeDurableJson,
} from './shadow-run-state.ts'
import {
  assembleSealedSkillBundleArchive,
  type SkillBundleArchiveFile,
} from './skill-bundle-archive.ts'
import type {
  ExistingSkillCandidate,
  MaterializedSkillCandidate,
} from './skill-candidate-repository.ts'
import {
  assertSkillCandidateEvaluationPolicies,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import {
  runPairedTrial,
  type CalibrationDefinition,
  type PairedTrialResult,
  type TrialDefinition,
} from './trial.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_RUNS_PER_POLICY = 1_000
const MAX_JSON_BYTES = 256 * 1024

export type ExistingSkillHoldoutVerdict =
  | 'improved'
  | 'ambiguous'
  | 'not-improved'
  | 'regressed'
  | 'none'

export type ExistingSkillHoldoutEvaluationReason =
  | 'candidate-passed-protected-holdout'
  | 'baseline-already-passed-protected-holdout'
  | 'candidate-did-not-fix-protected-holdout'
  | 'candidate-regressed-protected-holdout'
  | 'evaluation-input-protected'
  | 'paired-trial-outcome-uncertain'
  | 'paired-trial-failed'
  | 'paired-trial-integrity-failed'

export interface ExistingSkillHoldoutEvaluationEvidence {
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly casePackHash: string
  readonly baseline: 'pass' | 'fail'
  readonly candidate: 'pass' | 'fail'
  readonly calibrationPassed: boolean
  readonly assembled: boolean
  readonly compositionStable: boolean
  readonly inputIntegrityStable: boolean
  readonly proposerCalls: 0
  readonly trialCount: 4
  readonly modelCalls?: { readonly baseline: number; readonly candidate: number }
  readonly usage?: {
    readonly baseline: Record<string, number | undefined>
    readonly candidate: Record<string, number | undefined>
  }
}

export interface ExistingSkillHoldoutEvaluationResult {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-holdout-evaluation-result-v1'
  readonly id: string
  readonly candidateId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: 'complete' | 'protected' | 'incomplete'
  readonly verdict: ExistingSkillHoldoutVerdict
  readonly reason: ExistingSkillHoldoutEvaluationReason
  readonly evidence?: ExistingSkillHoldoutEvaluationEvidence
  readonly reportPath: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillHoldoutTrialInput {
  readonly baselineKind: 'skill-tree'
  readonly calibration: CalibrationDefinition
  readonly casePackDir: string
  readonly dshRevision: string
  readonly outputDir: string
  readonly candidateSkillDir: string
  readonly signal?: AbortSignal
  readonly skillDir: string
  readonly trial: TrialDefinition
  readonly trialLimit: number
}

export interface ExistingSkillHoldoutEvaluationRunView {
  readonly id: string
  readonly candidateId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly casePackHash: string
  readonly status: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete'
  readonly verdict?: ExistingSkillHoldoutVerdict
  readonly reason?: ExistingSkillHoldoutEvaluationReason
  readonly evidence?: ExistingSkillHoldoutEvaluationEvidence
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillHoldoutEvaluationScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly results: readonly ExistingSkillHoldoutEvaluationRunView[]
}

interface BaselineBundle {
  readonly manifest: InstalledSkillBaselineManifest
  readonly files: readonly SkillBundleArchiveFile[]
}

interface ExistingSkillHoldoutEvaluationOptions {
  readonly policies: readonly SkillCandidateEvaluationPolicyConfig[]
  readonly baselines: {
    resolveBaseline(workspaceId: string, baselineId: string): Promise<BaselineBundle | undefined>
  }
  readonly candidates: {
    materializeExisting(
      candidate: ExistingSkillCandidate,
      outputDir: string,
    ): Promise<MaterializedSkillCandidate>
  }
  readonly governance: {
    resolve(input: ExistingSkillHoldoutCandidateBinding): Promise<ExistingSkillHoldoutEnvelope | undefined>
  }
  readonly runTrial?: (input: ExistingSkillHoldoutTrialInput) => Promise<PairedTrialResult>
  readonly now?: () => number
}

interface EvaluationIdentity {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-holdout-evaluation-state-v1'
  readonly id: string
  readonly policyId: string
  readonly candidateId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly casePackHash: string
  readonly dshRevision: string
}

interface EvaluationState extends EvaluationIdentity {
  readonly phase: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete'
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Execute one Candidate-blind, exact existing-Skill paired holdout. This module
 * owns subject resolution through durable verdict and never owns release.
 */
export class ExistingSkillHoldoutEvaluation {
  private readonly policies = new Map<string, SkillCandidateEvaluationPolicyConfig>()
  private readonly baselines: ExistingSkillHoldoutEvaluationOptions['baselines']
  private readonly candidates: ExistingSkillHoldoutEvaluationOptions['candidates']
  private readonly governance: ExistingSkillHoldoutEvaluationOptions['governance']
  private readonly runTrial: NonNullable<ExistingSkillHoldoutEvaluationOptions['runTrial']>
  private readonly now: NonNullable<ExistingSkillHoldoutEvaluationOptions['now']>

  constructor(options: ExistingSkillHoldoutEvaluationOptions) {
    assertSkillCandidateEvaluationPolicies(options.policies)
    for (const policy of options.policies) {
      if (policy.dshRevision === undefined) {
        throw new Error(`existing-Skill holdout policy '${policy.id}' requires an exact DSH revision`)
      }
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.baselines = options.baselines
    this.candidates = options.candidates
    this.governance = options.governance
    this.runTrial = options.runTrial ?? runPairedTrial
    this.now = options.now ?? Date.now
  }

  matches(candidate: Pick<ExistingSkillCandidate, 'workspaceId'>): boolean {
    return this.policies.has(candidate.workspaceId)
  }

  async evaluate(
    candidate: ExistingSkillCandidate,
    admission: ExistingSkillCandidateAdmissionResult,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExistingSkillHoldoutEvaluationResult> {
    options.signal?.throwIfAborted()
    const policy = this.policies.get(candidate.workspaceId)
    if (policy === undefined) throw new Error('existing-Skill holdout evaluation policy is unavailable')
    const admitted = requireQualifiedAdmission(candidate, admission)
    const baseline = await this.baselines.resolveBaseline(candidate.workspaceId, candidate.baseline.id)
    options.signal?.throwIfAborted()
    if (baseline === undefined) throw new Error('existing-Skill holdout baseline is unavailable')
    const baselineArchive = await assembleSealedSkillBundleArchive(baseline.files)
    requireExactBaseline(candidate, admitted, baseline, baselineArchive)

    const envelope = await this.governance.resolve(candidateBinding(candidate))
    options.signal?.throwIfAborted()
    if (envelope === undefined) throw new Error('existing-Skill holdout Envelope is unavailable')
    requireExactEnvelope(candidate, baselineArchive.treeHash, envelope, policy)
    const casePack = await resolveCasePack(candidate, envelope, policy)
    const identity = evaluationIdentity(candidate, admission, envelope, policy)
    const runRoot = join(policy.runRoot, 'existing-skill-holdout', 'runs')
    const runDir = join(runRoot, identity.id)
    await ensureExactDirectory(runRoot)
    await ensureRunDirectory(runDir)
    const releaseLock = await acquireShadowRunLock(runDir)
    try {
      let state = await prepareState(runDir, identity, this.now())
      const existing = await readResult(runDir, identity)
      if (existing !== undefined) return existing
      if (state.phase === 'trial-pending') {
        const uncertain = terminalResult({
          identity,
          reportPath: join(runDir, 'result.json'),
          startedAt: state.updatedAt,
          now: this.now(),
          status: 'incomplete',
          verdict: 'none',
          reason: 'paired-trial-outcome-uncertain',
        })
        await writeDurableJson(join(runDir, 'result.json'), uncertain)
        await writeState(runDir, state, 'incomplete', this.now())
        return uncertain
      }
      if (state.phase !== 'prepared') {
        throw new Error('existing-Skill holdout terminal state has no durable result')
      }

      const baselineDir = join(runDir, 'baseline')
      const candidateDir = join(runDir, 'candidate')
      await rm(baselineDir, { recursive: true, force: true })
      await rm(candidateDir, { recursive: true, force: true })
      await materializeFiles(baselineDir, baselineArchive.files)
      const materialized = await this.candidates.materializeExisting(candidate, candidateDir)
      const preTrialIntegrity = await verifyMaterializedInputs({
        candidate,
        materialized,
        baselineDir,
        candidateDir,
        casePack,
        envelope,
      })
      if (!preTrialIntegrity) {
        const protectedResult = terminalResult({
          identity,
          reportPath: join(runDir, 'result.json'),
          startedAt: new Date(this.now()).toISOString(),
          now: this.now(),
          status: 'protected',
          verdict: 'none',
          reason: 'evaluation-input-protected',
        })
        await writeDurableJson(join(runDir, 'result.json'), protectedResult)
        await writeState(runDir, state, 'protected', this.now())
        return protectedResult
      }

      const startedAt = new Date(this.now()).toISOString()
      state = await writeState(runDir, state, 'trial-pending', this.now())
      let trial: PairedTrialResult
      try {
        trial = await this.runTrial({
          baselineKind: 'skill-tree',
          calibration: casePack.manifest.calibration!,
          casePackDir: casePack.dir,
          dshRevision: policy.dshRevision!,
          outputDir: runDir,
          candidateSkillDir: candidateDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir: baselineDir,
          trial: casePack.manifest.trial!,
          trialLimit: casePack.manifest.budget.trialLimit,
        })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        const failed = terminalResult({
          identity,
          reportPath: join(runDir, 'result.json'),
          startedAt,
          now: this.now(),
          status: 'incomplete',
          verdict: 'none',
          reason: 'paired-trial-failed',
        })
        await writeDurableJson(join(runDir, 'result.json'), failed)
        await writeState(runDir, state, 'incomplete', this.now())
        return failed
      }

      const evidence = await trialEvidence(trial, {
        baselineDir,
        baselineTreeHash: identity.baselineTreeHash,
        candidateDir,
        candidateTreeHash: identity.candidateTreeHash,
        casePackDir: casePack.dir,
        casePackHash: identity.casePackHash,
      })
      const verdict = classifyTrial(evidence)
      const result = terminalResult({
        identity,
        reportPath: join(runDir, 'result.json'),
        startedAt,
        now: this.now(),
        ...verdict,
        evidence,
      })
      await writeDurableJson(join(runDir, 'result.json'), result)
      await writeState(runDir, state, result.status, this.now())
      return result
    } finally {
      await releaseLock()
    }
  }

  /** Read bounded redacted evidence directly from the authoritative run roots. */
  async scan(workspaceId?: string): Promise<ExistingSkillHoldoutEvaluationScan> {
    const policies = [...this.policies.values()]
      .filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
    const results: ExistingSkillHoldoutEvaluationRunView[] = []
    let warningCount = 0
    for (const policy of policies) {
      const root = join(policy.runRoot, 'existing-skill-holdout', 'runs')
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
            || state.id !== evaluationId(state)) {
            throw new Error('existing-Skill holdout run identity is inconsistent')
          }
          const result = await readResult(runDir, state)
          if (result === undefined
            && ['complete', 'protected', 'incomplete'].includes(state.phase)) {
            throw new Error('existing-Skill holdout terminal state has no durable result')
          }
          if (result !== undefined
            && ['complete', 'protected', 'incomplete'].includes(state.phase)
            && result.status !== state.phase) {
            throw new Error('existing-Skill holdout state and result disagree')
          }
          results.push(projectRun(state, result))
        } catch {
          warningCount += 1
        }
      }
    }
    return Object.freeze({
      configuredPolicyCount: policies.length,
      warningCount,
      results: Object.freeze(results.sort((left, right) => left.id.localeCompare(right.id))),
    })
  }
}

/** Native Jobs bridge; durable qualified admissions are the restart queue. */
export class ExistingSkillHoldoutEvaluationScheduler {
  private readonly evaluation: Pick<ExistingSkillHoldoutEvaluation, 'evaluate' | 'matches'>
  private readonly candidates: {
    listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[]
  }
  private readonly admissions: {
    scan(workspaceId?: string): Promise<{
      readonly results: readonly ExistingSkillCandidateAdmissionResult[]
    }>
  }
  private readonly onResult: ((
    candidate: ExistingSkillCandidate,
    result: ExistingSkillHoldoutEvaluationResult,
  ) => void) | undefined
  private readonly pending = new Map<string, {
    candidate: ExistingSkillCandidate
    admission: ExistingSkillCandidateAdmissionResult
  }>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    evaluation: Pick<ExistingSkillHoldoutEvaluation, 'evaluate' | 'matches'>,
    candidates: { listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[] },
    admissions: {
      scan(workspaceId?: string): Promise<{
        readonly results: readonly ExistingSkillCandidateAdmissionResult[]
      }>
    },
    options: {
      onResult?: (
        candidate: ExistingSkillCandidate,
        result: ExistingSkillHoldoutEvaluationResult,
      ) => void
    } = {},
  ) {
    this.evaluation = evaluation
    this.candidates = candidates
    this.admissions = admissions
    this.onResult = options.onResult
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing Skill holdout Jobs seam is already attached')
    this.jobs = jobs
    void this.reconcile().catch(() => undefined)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  async reconcile(workspaceId?: string): Promise<void> {
    const candidates = new Map(this.candidates.listExistingCandidates(workspaceId)
      .map(candidate => [candidate.id, candidate]))
    const scan = await this.admissions.scan(workspaceId)
    for (const admission of scan.results) {
      const candidate = candidates.get(admission.candidateId)
      if (candidate !== undefined) this.observe(candidate, admission)
    }
  }

  observe(
    candidate: ExistingSkillCandidate,
    admission: ExistingSkillCandidateAdmissionResult,
  ): void {
    if (!this.evaluation.matches(candidate)
      || admission.status !== 'qualified-for-holdout'
      || admission.candidateId !== candidate.id
      || admission.workspaceId !== candidate.workspaceId
      || admission.skillName !== candidate.skillName
      || candidate.authorship.holdoutEnvelopeId === undefined) return
    const key = `${candidate.id}:${admission.id}`
    if (this.active.has(key)) return
    if (!this.pending.has(key)) this.pending.set(key, { candidate, admission })
    this.schedule(key)
  }

  private schedule(key: string): void {
    const jobs = this.jobs
    const pair = this.pending.get(key)
    if (jobs === undefined || pair === undefined || this.active.has(key)) return
    this.pending.delete(key)
    this.active.add(key)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `existing Skill protected holdout: ${pair.candidate.skillName}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.evaluation.evaluate(pair.candidate, pair.admission, {
            signal: controller.signal,
          })
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'existing Skill protected holdout cancelled'),
            ),
            done: task.then(value => {
              if (!controller.signal.aborted) {
                try {
                  this.onResult?.(pair.candidate, value)
                } catch {
                  // The exact Candidate, admission and result remain durable for restart.
                }
              }
              return {
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted
                  ? errorDetail(controller.signal.reason)
                  : `${value.status}:${value.verdict}`,
                ...controller.signal.aborted ? {} : { output: JSON.stringify({
                    candidateId: value.candidateId,
                    admissionId: value.admissionId,
                    evaluationId: value.id,
                    status: value.status,
                    verdict: value.verdict,
                  }) },
              }
            }, (error: unknown) => ({
              status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
            })).finally(() => {
              this.active.delete(key)
              this.schedule(key)
            }),
          }
        },
      })
    } catch {
      this.active.delete(key)
      this.pending.set(key, pair)
    }
  }
}

function requireQualifiedAdmission(
  candidate: ExistingSkillCandidate,
  admission: ExistingSkillCandidateAdmissionResult,
): NonNullable<ExistingSkillCandidateAdmissionResult['evidence']> {
  const evidence = admission.evidence
  if (admission.status !== 'qualified-for-holdout'
    || admission.reasons.length !== 1
    || admission.reasons[0] !== 'exact-paired-subjects-admitted'
    || admission.candidateId !== candidate.id
    || admission.workspaceId !== candidate.workspaceId
    || admission.skillName !== candidate.skillName
    || evidence === undefined
    || evidence.baselineId !== candidate.baseline.id
    || evidence.baselineArtifactDigest !== candidate.baseline.artifactDigest
    || evidence.baselineTreeHash !== candidate.baseline.treeHash
    || evidence.candidateArtifactDigest !== candidate.version.artifactDigest
    || evidence.candidateTreeHash !== candidate.version.treeHash
    || evidence.evaluationEvidenceId !== candidate.authorship.evaluationEvidenceId
    || evidence.candidateExecuted !== false
    || evidence.evaluatorClass !== 'host-structural'
    || admission.releaseAuthority !== 'none'
    || candidate.releaseAuthority !== 'none'
    || candidate.execution !== 'never') {
    throw new Error('existing-Skill holdout requires the exact qualified admission')
  }
  return evidence
}

function requireExactBaseline(
  candidate: ExistingSkillCandidate,
  admission: NonNullable<ExistingSkillCandidateAdmissionResult['evidence']>,
  baseline: BaselineBundle,
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): void {
  const manifest = baseline.manifest
  if (manifest.id !== candidate.baseline.id
    || manifest.workspaceId !== candidate.workspaceId
    || manifest.skillName !== candidate.skillName
    || manifest.bundle.artifactDigest !== candidate.baseline.artifactDigest
    || manifest.bundle.treeHash !== candidate.baseline.treeHash
    || manifest.bundle.artifactDigest !== archive.artifactDigest
    || manifest.bundle.treeHash !== archive.treeHash
    || manifest.bundle.fileCount !== archive.files.length
    || manifest.bundle.totalBytes !== archive.totalBytes
    || manifest.bundle.hasExecutableFiles !== false
    || admission.baselineArtifactDigest !== archive.artifactDigest
    || admission.baselineTreeHash !== archive.treeHash
    || manifest.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout baseline changed after structural admission')
  }
}

function candidateBinding(candidate: ExistingSkillCandidate): ExistingSkillHoldoutCandidateBinding {
  if (candidate.authorship.holdoutEnvelopeId === undefined) {
    throw new Error('existing-Skill Candidate has no pre-Candidate holdout Envelope binding')
  }
  return Object.freeze({
    envelopeId: candidate.authorship.holdoutEnvelopeId,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    baselineTreeHash: candidate.baseline.treeHash,
    evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
    proposerModelIdentityHash: candidate.authorship.modelIdentityHash,
  })
}

function requireExactEnvelope(
  candidate: ExistingSkillCandidate,
  baselineTreeHash: string,
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): void {
  if (!CONTENT_ID.test(envelope.id)
    || envelope.id !== candidate.authorship.holdoutEnvelopeId
    || envelope.workspaceId !== candidate.workspaceId
    || envelope.skillName !== candidate.skillName
    || envelope.opportunityId !== candidate.opportunity.id
    || envelope.qualificationId !== candidate.baseline.qualificationId
    || envelope.baselineId !== candidate.baseline.id
    || envelope.baselineTreeHash !== baselineTreeHash
    || envelope.evaluationEvidenceId !== candidate.authorship.evaluationEvidenceId
    || envelope.proposerModelIdentityHash !== candidate.authorship.modelIdentityHash
    || envelope.dshRevision !== policy.dshRevision
    || envelope.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout Envelope does not bind the exact Candidate')
  }
}

async function resolveCasePack(
  candidate: ExistingSkillCandidate,
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): Promise<{ dir: string; hash: string; manifest: CasePackManifest }> {
  const governanceRoot = await exactDirectory(policy.governanceRoot)
  const dir = await exactDirectory(envelope.casePackDir)
  assertInside(governanceRoot, dir)
  const hash = await hashTree(dir)
  if (hash !== envelope.casePackHash) throw new Error('existing-Skill holdout Case Pack changed')
  const manifest = parseCasePackManifest(await readFile(join(dir, 'manifest.json'), 'utf8'))
  if (manifest.workspaceId !== candidate.workspaceId
    || manifest.epoch.dshRevision !== policy.dshRevision
    || manifest.trial === undefined
    || manifest.trial.dshAssembled !== true
    || manifest.trial.capabilityAbsentBaseline !== undefined
    || manifest.calibration === undefined
    || manifest.budget.candidateLimit !== 1
    || manifest.budget.trialLimit !== 4) {
    throw new Error('existing-Skill holdout Case Pack is not an exact assembled skill-tree contract')
  }
  return Object.freeze({ dir, hash, manifest })
}

function evaluationIdentity(
  candidate: ExistingSkillCandidate,
  admission: ExistingSkillCandidateAdmissionResult,
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): EvaluationIdentity {
  const body = {
    policyId: policy.id,
    candidateId: candidate.id,
    admissionId: admission.id,
    envelopeId: envelope.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    baselineTreeHash: candidate.baseline.treeHash,
    candidateTreeHash: candidate.version.treeHash,
    casePackHash: envelope.casePackHash,
    dshRevision: policy.dshRevision!,
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-holdout-evaluation-state-v1',
    id: evaluationId(body),
    ...body,
  })
}

function evaluationId(value: Omit<EvaluationIdentity, 'schemaVersion' | 'kind' | 'id'> | EvaluationIdentity): string {
  return sha256Json([
    'existing-skill-holdout-evaluation-v1',
    value.policyId,
    value.candidateId,
    value.admissionId,
    value.envelopeId,
    value.workspaceId,
    value.skillName,
    value.opportunityId,
    value.qualificationId,
    value.baselineId,
    value.baselineTreeHash,
    value.candidateTreeHash,
    value.casePackHash,
    value.dshRevision,
  ])
}

async function verifyMaterializedInputs(input: {
  candidate: ExistingSkillCandidate
  materialized: MaterializedSkillCandidate
  baselineDir: string
  candidateDir: string
  casePack: { dir: string; hash: string }
  envelope: ExistingSkillHoldoutEnvelope
}): Promise<boolean> {
  const [baselineDir, candidateDir, baselineHash, candidateHash, casePackHash] = await Promise.all([
    exactDirectory(input.baselineDir),
    exactDirectory(input.candidateDir),
    hashTree(input.baselineDir),
    hashTree(input.candidateDir),
    hashTree(input.casePack.dir),
  ])
  return input.materialized.candidateId === input.candidate.id
    && resolve(input.materialized.path) === candidateDir
    && input.materialized.contentHash === input.candidate.version.artifactDigest
    && input.materialized.treeHash === input.candidate.version.treeHash
    && baselineHash === input.candidate.baseline.treeHash
    && candidateHash === input.candidate.version.treeHash
    && casePackHash === input.casePack.hash
    && casePackHash === input.envelope.casePackHash
    && baselineDir !== candidateDir
}

async function trialEvidence(
  trial: PairedTrialResult,
  input: {
    baselineDir: string
    baselineTreeHash: string
    candidateDir: string
    candidateTreeHash: string
    casePackDir: string
    casePackHash: string
  },
): Promise<ExistingSkillHoldoutEvaluationEvidence> {
  const [baselineHash, candidateHash, casePackHash] = await Promise.all([
    hashTree(input.baselineDir),
    hashTree(input.candidateDir),
    hashTree(input.casePackDir),
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
  const compositionStable = baselineComposition !== undefined
    && candidateComposition !== undefined
    && baselineComposition.fingerprint === candidateComposition.fingerprint
  const inputIntegrityStable = baselineHash === input.baselineTreeHash
    && candidateHash === input.candidateTreeHash
    && casePackHash === input.casePackHash
    && trial.baseline.treeHash === input.baselineTreeHash
    && trial.candidate.treeHash === input.candidateTreeHash
  return Object.freeze({
    baselineTreeHash: trial.baseline.treeHash,
    candidateTreeHash: trial.candidate.treeHash,
    casePackHash,
    baseline: trial.baseline.passed ? 'pass' : 'fail',
    candidate: trial.candidate.passed ? 'pass' : 'fail',
    calibrationPassed,
    assembled: trial.assembled === true,
    compositionStable,
    inputIntegrityStable,
    proposerCalls: 0,
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

function classifyTrial(evidence: ExistingSkillHoldoutEvaluationEvidence): Pick<
  ExistingSkillHoldoutEvaluationResult,
  'status' | 'verdict' | 'reason'
> {
  if (!evidence.inputIntegrityStable
    || !evidence.assembled
    || !evidence.calibrationPassed
    || !evidence.compositionStable
    || evidence.trialCount !== 4) {
    return { status: 'incomplete', verdict: 'none', reason: 'paired-trial-integrity-failed' }
  }
  if (evidence.baseline === 'fail' && evidence.candidate === 'pass') {
    return { status: 'complete', verdict: 'improved', reason: 'candidate-passed-protected-holdout' }
  }
  if (evidence.baseline === 'pass' && evidence.candidate === 'pass') {
    return { status: 'complete', verdict: 'ambiguous', reason: 'baseline-already-passed-protected-holdout' }
  }
  if (evidence.baseline === 'fail' && evidence.candidate === 'fail') {
    return { status: 'complete', verdict: 'not-improved', reason: 'candidate-did-not-fix-protected-holdout' }
  }
  return { status: 'complete', verdict: 'regressed', reason: 'candidate-regressed-protected-holdout' }
}

function terminalResult(input: {
  identity: EvaluationIdentity
  reportPath: string
  startedAt: string
  now: number
  status: ExistingSkillHoldoutEvaluationResult['status']
  verdict: ExistingSkillHoldoutVerdict
  reason: ExistingSkillHoldoutEvaluationReason
  evidence?: ExistingSkillHoldoutEvaluationEvidence
}): ExistingSkillHoldoutEvaluationResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-holdout-evaluation-result-v1',
    id: input.identity.id,
    candidateId: input.identity.candidateId,
    admissionId: input.identity.admissionId,
    envelopeId: input.identity.envelopeId,
    workspaceId: input.identity.workspaceId,
    skillName: input.identity.skillName,
    status: input.status,
    verdict: input.verdict,
    reason: input.reason,
    ...input.evidence === undefined ? {} : { evidence: input.evidence },
    reportPath: input.reportPath,
    startedAt: input.startedAt,
    finishedAt: new Date(input.now).toISOString(),
    releaseAuthority: 'none',
  })
}

async function prepareState(
  runDir: string,
  identity: EvaluationIdentity,
  now: number,
): Promise<EvaluationState> {
  try {
    const state = await readState(runDir)
    if (!sameIdentity(state, identity)) {
      throw new Error('existing-Skill holdout durable state has different exact inputs')
    }
    return state
  } catch (error) {
    if (!isCode(error, 'ENOENT')) throw error
  }
  const at = new Date(now).toISOString()
  const state = Object.freeze({ ...identity, phase: 'prepared' as const, createdAt: at, updatedAt: at })
  await writeDurableJson(join(runDir, 'state.json'), state)
  return state
}

async function writeState(
  runDir: string,
  state: EvaluationState,
  phase: EvaluationState['phase'],
  now: number,
): Promise<EvaluationState> {
  const next = Object.freeze({ ...state, phase, updatedAt: new Date(now).toISOString() })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

async function readState(runDir: string): Promise<EvaluationState> {
  const value = await readBoundedJson(join(runDir, 'state.json'))
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-holdout-evaluation-state-v1'
    || !CONTENT_ID.test(String(value.id))
    || !PUBLIC_ID.test(String(value.policyId))
    || !CONTENT_ID.test(String(value.candidateId))
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.envelopeId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !CONTENT_ID.test(String(value.opportunityId))
    || !CONTENT_ID.test(String(value.qualificationId))
    || !CONTENT_ID.test(String(value.baselineId))
    || !CONTENT_ID.test(String(value.baselineTreeHash))
    || !CONTENT_ID.test(String(value.candidateTreeHash))
    || !CONTENT_ID.test(String(value.casePackHash))
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(String(value.dshRevision))
    || !['prepared', 'trial-pending', 'complete', 'protected', 'incomplete'].includes(String(value.phase))
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new Error('existing-Skill holdout durable state has an invalid shape')
  }
  return Object.freeze(value as unknown as EvaluationState)
}

async function readResult(
  runDir: string,
  identity: EvaluationIdentity,
): Promise<ExistingSkillHoldoutEvaluationResult | undefined> {
  let value: unknown
  try {
    value = await readBoundedJson(join(runDir, 'result.json'))
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined
    throw error
  }
  const result = parseResult(value)
  if (result.id !== identity.id
    || result.candidateId !== identity.candidateId
    || result.admissionId !== identity.admissionId
    || result.envelopeId !== identity.envelopeId
    || result.workspaceId !== identity.workspaceId
    || result.skillName !== identity.skillName
    || result.reportPath !== join(runDir, 'result.json')
    || (result.evidence !== undefined
      && (result.evidence.baselineTreeHash !== identity.baselineTreeHash
        || result.evidence.candidateTreeHash !== identity.candidateTreeHash
        || result.evidence.casePackHash !== identity.casePackHash))) {
    throw new Error('existing-Skill holdout result does not match its exact run identity')
  }
  return result
}

function parseResult(value: unknown): ExistingSkillHoldoutEvaluationResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-holdout-evaluation-result-v1'
    || !CONTENT_ID.test(String(value.id))
    || !CONTENT_ID.test(String(value.candidateId))
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.envelopeId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !['complete', 'protected', 'incomplete'].includes(String(value.status))
    || !['improved', 'ambiguous', 'not-improved', 'regressed', 'none'].includes(String(value.verdict))
    || typeof value.reason !== 'string'
    || typeof value.reportPath !== 'string'
    || !isAbsolute(value.reportPath)
    || typeof value.startedAt !== 'string'
    || typeof value.finishedAt !== 'string'
    || value.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout result has an invalid shape')
  }
  if (value.evidence !== undefined && !isEvidence(value.evidence)) {
    throw new Error('existing-Skill holdout result has invalid evidence')
  }
  if (!isResultClassification(value)) {
    throw new Error('existing-Skill holdout result has an invalid classification')
  }
  return Object.freeze(value as unknown as ExistingSkillHoldoutEvaluationResult)
}

function isResultClassification(value: Record<string, unknown>): boolean {
  const evidence = value.evidence
  if (value.status === 'complete') {
    if (evidence === undefined || !isRecord(evidence)) return false
    const classification = `${evidence.baseline}/${evidence.candidate}`
    return (classification === 'fail/pass'
      && value.verdict === 'improved'
      && value.reason === 'candidate-passed-protected-holdout')
      || (classification === 'pass/pass'
        && value.verdict === 'ambiguous'
        && value.reason === 'baseline-already-passed-protected-holdout')
      || (classification === 'fail/fail'
        && value.verdict === 'not-improved'
        && value.reason === 'candidate-did-not-fix-protected-holdout')
      || (classification === 'pass/fail'
        && value.verdict === 'regressed'
        && value.reason === 'candidate-regressed-protected-holdout')
  }
  if (value.status === 'protected') {
    return evidence === undefined
      && value.verdict === 'none'
      && value.reason === 'evaluation-input-protected'
  }
  if (value.status !== 'incomplete' || value.verdict !== 'none') return false
  if (value.reason === 'paired-trial-integrity-failed') return evidence !== undefined
  return evidence === undefined
    && ['paired-trial-outcome-uncertain', 'paired-trial-failed'].includes(String(value.reason))
}

function isEvidence(value: unknown): value is ExistingSkillHoldoutEvaluationEvidence {
  return isRecord(value)
    && CONTENT_ID.test(String(value.baselineTreeHash))
    && CONTENT_ID.test(String(value.candidateTreeHash))
    && CONTENT_ID.test(String(value.casePackHash))
    && ['pass', 'fail'].includes(String(value.baseline))
    && ['pass', 'fail'].includes(String(value.candidate))
    && typeof value.calibrationPassed === 'boolean'
    && typeof value.assembled === 'boolean'
    && typeof value.compositionStable === 'boolean'
    && typeof value.inputIntegrityStable === 'boolean'
    && value.proposerCalls === 0
    && value.trialCount === 4
}

function projectRun(
  state: EvaluationState,
  result: ExistingSkillHoldoutEvaluationResult | undefined,
): ExistingSkillHoldoutEvaluationRunView {
  return Object.freeze({
    id: state.id,
    candidateId: state.candidateId,
    admissionId: state.admissionId,
    envelopeId: state.envelopeId,
    workspaceId: state.workspaceId,
    skillName: state.skillName,
    baselineTreeHash: state.baselineTreeHash,
    candidateTreeHash: state.candidateTreeHash,
    casePackHash: state.casePackHash,
    status: result?.status ?? state.phase,
    ...(result === undefined ? {} : {
      verdict: result.verdict,
      reason: result.reason,
      ...result.evidence === undefined ? {} : { evidence: structuredClone(result.evidence) },
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    }),
    releaseAuthority: 'none',
  })
}

async function materializeFiles(root: string, files: readonly SkillBundleArchiveFile[]): Promise<void> {
  await mkdir(root, { mode: 0o700 })
  for (const file of files) {
    const target = resolve(root, ...file.path.split('/'))
    assertInside(root, target)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
  }
}

async function ensureExactDirectory(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  return exactDirectory(path)
}

async function ensureRunDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error
  }
  await exactDirectory(path)
}

async function exactDirectory(path: string): Promise<string> {
  const resolved = resolve(path)
  const info = await lstat(resolved)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(resolved) !== resolved) {
    throw new Error(`path is not an exact owned directory: ${resolved}`)
  }
  return resolved
}

function assertInside(root: string, path: string): void {
  const fromRoot = relative(root, path)
  if (fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))) return
  throw new Error('existing-Skill holdout path escapes its owned root')
}

async function readBoundedJson(path: string): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) {
    throw new Error('existing-Skill holdout JSON is not a bounded owned file')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function sameIdentity(state: EvaluationState, identity: EvaluationIdentity): boolean {
  const { phase: _phase, createdAt: _createdAt, updatedAt: _updatedAt, ...actual } = state
  return JSON.stringify(actual) === JSON.stringify(identity)
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown error'
}
