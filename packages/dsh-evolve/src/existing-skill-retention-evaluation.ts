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
import type {
  ExistingSkillHoldoutCandidateBinding,
  ExistingSkillHoldoutEnvelope,
} from './existing-skill-holdout-governance.ts'
import type {
  ExistingSkillHoldoutEvaluation,
  ExistingSkillHoldoutEvaluationEvidence,
  ExistingSkillHoldoutEvaluationResult,
  ExistingSkillHoldoutEvaluationRunView,
} from './existing-skill-holdout-evaluation.ts'
import { hashTree } from './hash.ts'
import type { InstalledSkillBaselineManifest } from './installed-skill-baseline.ts'
import { parseCasePackManifest, type CasePackManifest } from './shadow.ts'
import { acquireShadowRunLock, writeDurableJson } from './shadow-run-state.ts'
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
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const MAX_RUNS_PER_POLICY = 1_000
const MAX_JSON_BYTES = 256 * 1024

export type ExistingSkillRetentionVerdict =
  | 'retained'
  | 'ambiguous'
  | 'not-retained'
  | 'regressed'
  | 'none'

export type ExistingSkillRetentionEvaluationReason =
  | 'no-independent-retention-case'
  | 'candidate-passed-protected-retention'
  | 'baseline-already-passed-protected-retention'
  | 'candidate-did-not-retain-protected-case'
  | 'candidate-regressed-protected-retention'
  | 'evaluation-input-protected'
  | 'paired-trial-outcome-uncertain'
  | 'paired-trial-failed'
  | 'paired-trial-integrity-failed'

type ExistingSkillRetentionTerminalReason = Exclude<
  ExistingSkillRetentionEvaluationReason,
  'no-independent-retention-case'
>

export interface ExistingSkillRetentionEvaluationEvidence {
  readonly holdoutCasePackHash: string
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

export interface ExistingSkillRetentionEvaluationResult {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-retention-evaluation-result-v1'
  readonly id: string
  readonly candidateId: string
  readonly holdoutEvaluationId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: 'abstained' | 'complete' | 'protected' | 'incomplete'
  readonly verdict: ExistingSkillRetentionVerdict
  readonly reason: ExistingSkillRetentionEvaluationReason
  readonly evidence?: ExistingSkillRetentionEvaluationEvidence
  readonly reportPath?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly releaseAuthority: 'none'
}

type ExistingSkillRetentionTerminalStatus = Exclude<
  ExistingSkillRetentionEvaluationResult['status'],
  'abstained'
>

export interface ExistingSkillRetentionTrialInput {
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

/** Exact retained replay material prepared for a separate no-authority Canary owner. */
export interface ExistingSkillCanaryReplay {
  readonly candidateId: string
  readonly retentionEvaluationId: string
  readonly holdoutEvaluationId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly holdoutCasePackHash: string
  readonly retentionCasePackHash: string
  readonly dshRevision: string
  readonly baselineDir: string
  readonly candidateDir: string
  readonly holdoutCasePackDir: string
  readonly casePackDir: string
  readonly trial: ExistingSkillRetentionTrialInput
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillRetentionEvaluationRunView {
  readonly id: string
  readonly candidateId: string
  readonly holdoutEvaluationId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly holdoutCasePackHash: string
  readonly casePackHash: string
  readonly status: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete'
  readonly verdict?: ExistingSkillRetentionVerdict
  readonly reason?: ExistingSkillRetentionTerminalReason
  readonly evidence?: ExistingSkillRetentionEvaluationEvidence
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillRetentionEvaluationScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly results: readonly ExistingSkillRetentionEvaluationRunView[]
}

export interface ExistingSkillRetentionHoldoutSource {
  readonly id: string
  readonly candidateId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: ExistingSkillHoldoutEvaluationResult['status']
    | ExistingSkillHoldoutEvaluationRunView['status']
  readonly verdict?: ExistingSkillHoldoutEvaluationResult['verdict']
  readonly reason?: ExistingSkillHoldoutEvaluationResult['reason']
  readonly releaseAuthority: 'none'
}

interface BaselineBundle {
  readonly manifest: InstalledSkillBaselineManifest
  readonly files: readonly SkillBundleArchiveFile[]
}

interface ExistingSkillRetentionEvaluationOptions {
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
  readonly holdouts: Pick<ExistingSkillHoldoutEvaluation, 'scan'>
  readonly runTrial?: (input: ExistingSkillRetentionTrialInput) => Promise<PairedTrialResult>
  readonly now?: () => number
}

interface RetentionIdentity {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-retention-evaluation-state-v1'
  readonly id: string
  readonly policyId: string
  readonly candidateId: string
  readonly holdoutEvaluationId: string
  readonly admissionId: string
  readonly envelopeId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly holdoutCasePackHash: string
  readonly casePackHash: string
  readonly dshRevision: string
}

interface RetentionState extends RetentionIdentity {
  readonly phase: 'prepared' | 'trial-pending' | 'complete' | 'protected' | 'incomplete'
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Execute the Candidate-invisible existing-Skill Retention partition only after
 * the exact Candidate has an authoritative improved Holdout. This module owns
 * durable Retention evidence and never owns release.
 */
export class ExistingSkillRetentionEvaluation {
  private readonly policies = new Map<string, SkillCandidateEvaluationPolicyConfig>()
  private readonly baselines: ExistingSkillRetentionEvaluationOptions['baselines']
  private readonly candidates: ExistingSkillRetentionEvaluationOptions['candidates']
  private readonly governance: ExistingSkillRetentionEvaluationOptions['governance']
  private readonly holdouts: ExistingSkillRetentionEvaluationOptions['holdouts']
  private readonly runTrial: NonNullable<ExistingSkillRetentionEvaluationOptions['runTrial']>
  private readonly now: NonNullable<ExistingSkillRetentionEvaluationOptions['now']>

  constructor(options: ExistingSkillRetentionEvaluationOptions) {
    assertSkillCandidateEvaluationPolicies(options.policies)
    for (const policy of options.policies) {
      if (policy.dshRevision === undefined) {
        throw new Error(`existing-Skill Retention policy '${policy.id}' requires an exact DSH revision`)
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
    this.holdouts = options.holdouts
    this.runTrial = options.runTrial ?? runPairedTrial
    this.now = options.now ?? Date.now
  }

  matches(candidate: Pick<ExistingSkillCandidate, 'workspaceId'>): boolean {
    return this.policies.has(candidate.workspaceId)
  }

  async evaluate(
    candidate: ExistingSkillCandidate,
    holdout: ExistingSkillRetentionHoldoutSource,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExistingSkillRetentionEvaluationResult> {
    options.signal?.throwIfAborted()
    const policy = this.policies.get(candidate.workspaceId)
    if (policy === undefined) throw new Error('existing-Skill Retention evaluation policy is unavailable')
    const exactHoldout = await this.requireImprovedHoldout(candidate, holdout)
    const baseline = await this.baselines.resolveBaseline(candidate.workspaceId, candidate.baseline.id)
    options.signal?.throwIfAborted()
    if (baseline === undefined) throw new Error('existing-Skill Retention baseline is unavailable')
    const baselineArchive = await assembleSealedSkillBundleArchive(baseline.files)
    requireExactBaseline(candidate, exactHoldout, baseline, baselineArchive)

    const envelope = await this.governance.resolve(candidateBinding(candidate))
    options.signal?.throwIfAborted()
    if (envelope === undefined) throw new Error('existing-Skill Retention Envelope is unavailable')
    requireExactEnvelope(candidate, exactHoldout, baselineArchive.treeHash, envelope, policy)
    if (envelope.retentionCasePackDir === undefined
      && envelope.retentionCasePackHash === undefined) {
      return abstained(candidate, exactHoldout, envelope, 'no-independent-retention-case')
    }
    const casePack = await resolveRetentionCasePack(candidate, envelope, policy)
    const identity = retentionIdentity(candidate, exactHoldout, envelope, policy)
    const runRoot = join(policy.runRoot, 'existing-skill-retention', 'runs')
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
        throw new Error('existing-Skill Retention terminal state has no durable result')
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
        holdoutCasePackDir: envelope.casePackDir,
        holdoutCasePackHash: identity.holdoutCasePackHash,
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

  /** Read bounded redacted Retention evidence directly from authoritative run roots. */
  async scan(workspaceId?: string): Promise<ExistingSkillRetentionEvaluationScan> {
    const policies = [...this.policies.values()]
      .filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
    const results: ExistingSkillRetentionEvaluationRunView[] = []
    let warningCount = 0
    for (const policy of policies) {
      const root = join(policy.runRoot, 'existing-skill-retention', 'runs')
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
            || state.id !== retentionId(state)) {
            throw new Error('existing-Skill Retention run identity is inconsistent')
          }
          const result = await readResult(runDir, state)
          if (result === undefined
            && ['complete', 'protected', 'incomplete'].includes(state.phase)) {
            throw new Error('existing-Skill Retention terminal state has no durable result')
          }
          if (result !== undefined
            && ['complete', 'protected', 'incomplete'].includes(state.phase)
            && result.status !== state.phase) {
            throw new Error('existing-Skill Retention state and result disagree')
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

  /**
   * Re-resolve and materialize the exact retained pair without running it.
   * This seam deliberately returns no release writer; a failed-Outcome Canary
   * can replay the protected contract but cannot activate or roll back anything.
   */
  async prepareCanaryReplay(
    candidate: ExistingSkillCandidate,
    retentionEvaluationId: string,
    outputDir: string,
  ): Promise<ExistingSkillCanaryReplay> {
    const policy = this.policies.get(candidate.workspaceId)
    if (policy === undefined || policy.dshRevision === undefined) {
      throw new Error('existing-Skill Canary replay policy is unavailable')
    }
    const [retentionScan, holdoutScan] = await Promise.all([
      this.scan(candidate.workspaceId),
      this.holdouts.scan(candidate.workspaceId),
    ])
    if (retentionScan.warningCount !== 0 || retentionScan.configuredPolicyCount < 1
      || holdoutScan.warningCount !== 0 || holdoutScan.configuredPolicyCount < 1) {
      throw new Error('existing-Skill Canary replay cannot trust warning-bearing evidence')
    }
    const retainedMatches = retentionScan.results.filter(value => value.id === retentionEvaluationId)
    if (retainedMatches.length !== 1) {
      throw new Error('existing-Skill Canary replay requires one exact Retention result')
    }
    const retained = retainedMatches[0]!
    const holdoutMatches = holdoutScan.results.filter(value => value.id === retained.holdoutEvaluationId)
    if (holdoutMatches.length !== 1) {
      throw new Error('existing-Skill Canary replay requires one exact Holdout result')
    }
    const holdout = await this.requireImprovedHoldout(candidate, holdoutMatches[0]!)
    const baseline = await this.baselines.resolveBaseline(candidate.workspaceId, candidate.baseline.id)
    if (baseline === undefined) throw new Error('existing-Skill Canary replay baseline is unavailable')
    const baselineArchive = await assembleSealedSkillBundleArchive(baseline.files)
    requireExactBaseline(candidate, holdout, baseline, baselineArchive)
    const envelope = await this.governance.resolve(candidateBinding(candidate))
    if (envelope === undefined) throw new Error('existing-Skill Canary replay Envelope is unavailable')
    requireExactEnvelope(candidate, holdout, baselineArchive.treeHash, envelope, policy)
    const casePack = await resolveRetentionCasePack(candidate, envelope, policy)
    requireExactRetainedReplay(candidate, retained, holdout, envelope, casePack)

    const exactOutputDir = await ensureExactDirectory(outputDir)
    const baselineDir = join(exactOutputDir, 'baseline')
    const candidateDir = join(exactOutputDir, 'candidate')
    await rm(baselineDir, { recursive: true, force: true })
    await rm(candidateDir, { recursive: true, force: true })
    await materializeFiles(baselineDir, baselineArchive.files)
    const materialized = await this.candidates.materializeExisting(candidate, candidateDir)
    if (!(await verifyMaterializedInputs({
      candidate,
      materialized,
      baselineDir,
      candidateDir,
      casePack,
      envelope,
    }))) {
      throw new Error('existing-Skill Canary replay inputs changed after Retention')
    }
    return Object.freeze({
      candidateId: candidate.id,
      retentionEvaluationId: retained.id,
      holdoutEvaluationId: holdout.id,
      admissionId: holdout.admissionId,
      envelopeId: envelope.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.skillName,
      baselineTreeHash: candidate.baseline.treeHash,
      candidateTreeHash: candidate.version.treeHash,
      holdoutCasePackHash: envelope.casePackHash,
      retentionCasePackHash: casePack.hash,
      dshRevision: policy.dshRevision,
      baselineDir,
      candidateDir,
      holdoutCasePackDir: await exactDirectory(envelope.casePackDir),
      casePackDir: casePack.dir,
      trial: Object.freeze({
        baselineKind: 'skill-tree' as const,
        calibration: casePack.manifest.calibration!,
        casePackDir: casePack.dir,
        dshRevision: policy.dshRevision,
        outputDir: exactOutputDir,
        candidateSkillDir: candidateDir,
        skillDir: baselineDir,
        trial: casePack.manifest.trial!,
        trialLimit: casePack.manifest.budget.trialLimit,
      }),
      releaseAuthority: 'none' as const,
    })
  }

  private async requireImprovedHoldout(
    candidate: ExistingSkillCandidate,
    supplied: ExistingSkillRetentionHoldoutSource,
  ): Promise<ExistingSkillHoldoutEvaluationRunView & {
    readonly evidence: ExistingSkillHoldoutEvaluationEvidence
  }> {
    const scan = await this.holdouts.scan(candidate.workspaceId)
    if (scan.warningCount !== 0) {
      throw new Error('existing-Skill Retention cannot trust a Holdout scan with warnings')
    }
    const matches = scan.results.filter(value => value.id === supplied.id)
    if (matches.length !== 1) {
      throw new Error('existing-Skill Retention requires one authoritative Holdout result')
    }
    const exact = matches[0]!
    const evidence = exact.evidence
    if (exact.candidateId !== candidate.id
      || exact.admissionId !== supplied.admissionId
      || exact.envelopeId !== supplied.envelopeId
      || exact.envelopeId !== candidate.authorship.holdoutEnvelopeId
      || exact.workspaceId !== candidate.workspaceId
      || exact.skillName !== candidate.skillName
      || exact.status !== 'complete'
      || exact.verdict !== 'improved'
      || exact.reason !== 'candidate-passed-protected-holdout'
      || evidence === undefined
      || evidence.baselineTreeHash !== candidate.baseline.treeHash
      || evidence.candidateTreeHash !== candidate.version.treeHash
      || evidence.baseline !== 'fail'
      || evidence.candidate !== 'pass'
      || evidence.calibrationPassed !== true
      || evidence.assembled !== true
      || evidence.compositionStable !== true
      || evidence.inputIntegrityStable !== true
      || evidence.proposerCalls !== 0
      || evidence.trialCount !== 4
      || supplied.candidateId !== exact.candidateId
      || supplied.workspaceId !== exact.workspaceId
      || supplied.skillName !== exact.skillName
      || supplied.status !== exact.status
      || supplied.verdict !== exact.verdict
      || supplied.reason !== exact.reason
      || supplied.releaseAuthority !== 'none') {
      throw new Error('existing-Skill Retention requires the exact improved Holdout')
    }
    return Object.freeze({ ...exact, evidence })
  }
}

function requireExactRetainedReplay(
  candidate: ExistingSkillCandidate,
  retained: ExistingSkillRetentionEvaluationRunView,
  holdout: ExistingSkillHoldoutEvaluationRunView & {
    readonly evidence: ExistingSkillHoldoutEvaluationEvidence
  },
  envelope: ExistingSkillHoldoutEnvelope,
  casePack: { readonly hash: string },
): void {
  const evidence = retained.evidence
  if (retained.candidateId !== candidate.id
    || retained.holdoutEvaluationId !== holdout.id
    || retained.admissionId !== holdout.admissionId
    || retained.envelopeId !== envelope.id
    || retained.workspaceId !== candidate.workspaceId
    || retained.skillName !== candidate.skillName
    || retained.baselineTreeHash !== candidate.baseline.treeHash
    || retained.candidateTreeHash !== candidate.version.treeHash
    || retained.holdoutCasePackHash !== envelope.casePackHash
    || retained.casePackHash !== casePack.hash
    || retained.status !== 'complete'
    || retained.verdict !== 'retained'
    || retained.reason !== 'candidate-passed-protected-retention'
    || retained.releaseAuthority !== 'none'
    || evidence === undefined
    || evidence.holdoutCasePackHash !== envelope.casePackHash
    || evidence.casePackHash !== casePack.hash
    || evidence.baselineTreeHash !== candidate.baseline.treeHash
    || evidence.candidateTreeHash !== candidate.version.treeHash
    || evidence.baseline !== 'fail'
    || evidence.candidate !== 'pass'
    || evidence.calibrationPassed !== true
    || evidence.assembled !== true
    || evidence.compositionStable !== true
    || evidence.inputIntegrityStable !== true
    || evidence.proposerCalls !== 0
    || evidence.trialCount !== 4) {
    throw new Error('existing-Skill Canary replay requires the exact retained evidence')
  }
}

/** Native Jobs bridge; authoritative improved Holdouts are the restart queue. */
export class ExistingSkillRetentionEvaluationScheduler {
  private readonly evaluation: Pick<ExistingSkillRetentionEvaluation, 'evaluate' | 'matches'>
  private readonly candidates: {
    listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[]
  }
  private readonly holdouts: Pick<ExistingSkillHoldoutEvaluation, 'scan'>
  private readonly onResult: ((
    candidate: ExistingSkillCandidate,
    result: ExistingSkillRetentionEvaluationResult,
  ) => void) | undefined
  private readonly pending = new Map<string, {
    candidate: ExistingSkillCandidate
    holdout: ExistingSkillRetentionHoldoutSource
  }>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    evaluation: Pick<ExistingSkillRetentionEvaluation, 'evaluate' | 'matches'>,
    candidates: { listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[] },
    holdouts: Pick<ExistingSkillHoldoutEvaluation, 'scan'>,
    options: {
      onResult?: (
        candidate: ExistingSkillCandidate,
        result: ExistingSkillRetentionEvaluationResult,
      ) => void
    } = {},
  ) {
    this.evaluation = evaluation
    this.candidates = candidates
    this.holdouts = holdouts
    this.onResult = options.onResult
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing Skill Retention Jobs seam is already attached')
    this.jobs = jobs
    void this.reconcile().catch(() => undefined)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  async reconcile(workspaceId?: string): Promise<void> {
    const candidates = new Map(this.candidates.listExistingCandidates(workspaceId)
      .map(candidate => [candidate.id, candidate]))
    const scan = await this.holdouts.scan(workspaceId)
    if (scan.warningCount !== 0) return
    for (const holdout of scan.results) {
      const candidate = candidates.get(holdout.candidateId)
      if (candidate !== undefined) this.observe(candidate, holdout)
    }
  }

  observe(candidate: ExistingSkillCandidate, holdout: ExistingSkillRetentionHoldoutSource): void {
    if (!this.evaluation.matches(candidate)
      || holdout.status !== 'complete'
      || holdout.verdict !== 'improved'
      || holdout.reason !== 'candidate-passed-protected-holdout'
      || holdout.candidateId !== candidate.id
      || holdout.workspaceId !== candidate.workspaceId
      || holdout.skillName !== candidate.skillName
      || holdout.envelopeId !== candidate.authorship.holdoutEnvelopeId
      || holdout.releaseAuthority !== 'none') return
    const key = `${candidate.id}:${holdout.id}`
    if (this.active.has(key)) return
    if (!this.pending.has(key)) this.pending.set(key, { candidate, holdout })
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
        label: `existing Skill protected Retention: ${pair.candidate.skillName}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.evaluation.evaluate(pair.candidate, pair.holdout, {
            signal: controller.signal,
          })
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'existing Skill protected Retention cancelled'),
            ),
            done: task.then(value => {
              if (!controller.signal.aborted) {
                try {
                  this.onResult?.(pair.candidate, value)
                } catch {
                  // The exact Candidate, Holdout and Retention result remain durable for restart.
                }
              }
              return {
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted
                  ? errorDetail(controller.signal.reason)
                  : `${value.status}:${value.verdict}`,
                ...controller.signal.aborted ? {} : { output: JSON.stringify({
                    candidateId: value.candidateId,
                    holdoutEvaluationId: value.holdoutEvaluationId,
                    retentionEvaluationId: value.id,
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

function abstained(
  candidate: ExistingSkillCandidate,
  holdout: ExistingSkillHoldoutEvaluationRunView,
  envelope: ExistingSkillHoldoutEnvelope,
  reason: Extract<ExistingSkillRetentionEvaluationReason, 'no-independent-retention-case'>,
): ExistingSkillRetentionEvaluationResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-retention-evaluation-result-v1',
    id: sha256Json([
      'existing-skill-retention-abstention-v1',
      candidate.id,
      holdout.id,
      envelope.id,
      reason,
    ]),
    candidateId: candidate.id,
    holdoutEvaluationId: holdout.id,
    admissionId: holdout.admissionId,
    envelopeId: envelope.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    status: 'abstained',
    verdict: 'none',
    reason,
    releaseAuthority: 'none',
  })
}

function requireExactBaseline(
  candidate: ExistingSkillCandidate,
  holdout: ExistingSkillHoldoutEvaluationRunView,
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
    || holdout.baselineTreeHash !== archive.treeHash
    || holdout.candidateTreeHash !== candidate.version.treeHash
    || manifest.releaseAuthority !== 'none'
    || candidate.releaseAuthority !== 'none'
    || candidate.execution !== 'never') {
    throw new Error('existing-Skill Retention baseline changed after Holdout')
  }
}

function candidateBinding(candidate: ExistingSkillCandidate): ExistingSkillHoldoutCandidateBinding {
  if (candidate.authorship.holdoutEnvelopeId === undefined) {
    throw new Error('existing-Skill Candidate has no pre-Candidate evaluation Envelope binding')
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
  holdout: ExistingSkillHoldoutEvaluationRunView & {
    readonly evidence: ExistingSkillHoldoutEvaluationEvidence
  },
  baselineTreeHash: string,
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): void {
  if (!CONTENT_ID.test(envelope.id)
    || envelope.id !== candidate.authorship.holdoutEnvelopeId
    || envelope.id !== holdout.envelopeId
    || envelope.workspaceId !== candidate.workspaceId
    || envelope.skillName !== candidate.skillName
    || envelope.opportunityId !== candidate.opportunity.id
    || envelope.qualificationId !== candidate.baseline.qualificationId
    || envelope.baselineId !== candidate.baseline.id
    || envelope.baselineTreeHash !== baselineTreeHash
    || envelope.evaluationEvidenceId !== candidate.authorship.evaluationEvidenceId
    || envelope.proposerModelIdentityHash !== candidate.authorship.modelIdentityHash
    || envelope.casePackHash !== holdout.casePackHash
    || envelope.casePackHash !== holdout.evidence.casePackHash
    || envelope.dshRevision !== policy.dshRevision
    || envelope.releaseAuthority !== 'none') {
    throw new Error('existing-Skill Retention Envelope does not bind the exact Holdout Candidate')
  }
}

async function resolveRetentionCasePack(
  candidate: ExistingSkillCandidate,
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): Promise<{ dir: string; hash: string; manifest: CasePackManifest }> {
  if (envelope.retentionCasePackDir === undefined || envelope.retentionCasePackHash === undefined) {
    throw new Error('existing-Skill Envelope has no independent Retention Case Pack')
  }
  const governanceRoot = await exactDirectory(policy.governanceRoot)
  const [holdoutDir, dir] = await Promise.all([
    exactDirectory(envelope.casePackDir),
    exactDirectory(envelope.retentionCasePackDir),
  ])
  assertInside(governanceRoot, holdoutDir)
  assertInside(governanceRoot, dir)
  if (!separate(holdoutDir, dir)) {
    throw new Error('existing-Skill Retention and Holdout Case Pack roots overlap')
  }
  const [holdoutHash, hash] = await Promise.all([hashTree(holdoutDir), hashTree(dir)])
  if (holdoutHash !== envelope.casePackHash
    || hash !== envelope.retentionCasePackHash
    || hash === holdoutHash) {
    throw new Error('existing-Skill Retention Case Pack changed or is not independent')
  }
  const manifest = parseCasePackManifest(await readFile(join(dir, 'manifest.json'), 'utf8'))
  if (manifest.workspaceId !== candidate.workspaceId
    || manifest.epoch.dshRevision !== policy.dshRevision
    || manifest.trial === undefined
    || manifest.trial.dshAssembled !== true
    || manifest.trial.capabilityAbsentBaseline !== undefined
    || manifest.calibration === undefined
    || manifest.budget.candidateLimit !== 1
    || manifest.budget.trialLimit !== 4) {
    throw new Error('existing-Skill Retention Case Pack is not an exact assembled skill-tree contract')
  }
  return Object.freeze({ dir, hash, manifest })
}

function retentionIdentity(
  candidate: ExistingSkillCandidate,
  holdout: ExistingSkillHoldoutEvaluationRunView & {
    readonly evidence: ExistingSkillHoldoutEvaluationEvidence
  },
  envelope: ExistingSkillHoldoutEnvelope,
  policy: SkillCandidateEvaluationPolicyConfig,
): RetentionIdentity {
  if (envelope.retentionCasePackHash === undefined) {
    throw new Error('existing-Skill Retention identity has no protected Case Pack')
  }
  const body = {
    policyId: policy.id,
    candidateId: candidate.id,
    holdoutEvaluationId: holdout.id,
    admissionId: holdout.admissionId,
    envelopeId: envelope.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    baselineTreeHash: candidate.baseline.treeHash,
    candidateTreeHash: candidate.version.treeHash,
    holdoutCasePackHash: envelope.casePackHash,
    casePackHash: envelope.retentionCasePackHash,
    dshRevision: policy.dshRevision!,
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-retention-evaluation-state-v1',
    id: retentionId(body),
    ...body,
  })
}

function retentionId(value: Omit<RetentionIdentity, 'schemaVersion' | 'kind' | 'id'> | RetentionIdentity): string {
  return sha256Json([
    'existing-skill-retention-evaluation-v1',
    value.policyId,
    value.candidateId,
    value.holdoutEvaluationId,
    value.admissionId,
    value.envelopeId,
    value.workspaceId,
    value.skillName,
    value.opportunityId,
    value.qualificationId,
    value.baselineId,
    value.baselineTreeHash,
    value.candidateTreeHash,
    value.holdoutCasePackHash,
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
  const [baselineDir, candidateDir, baselineHash, candidateHash, casePackHash, holdoutCasePackHash] =
    await Promise.all([
      exactDirectory(input.baselineDir),
      exactDirectory(input.candidateDir),
      hashTree(input.baselineDir),
      hashTree(input.candidateDir),
      hashTree(input.casePack.dir),
      hashTree(input.envelope.casePackDir),
    ])
  return input.materialized.candidateId === input.candidate.id
    && resolve(input.materialized.path) === candidateDir
    && input.materialized.contentHash === input.candidate.version.artifactDigest
    && input.materialized.treeHash === input.candidate.version.treeHash
    && baselineHash === input.candidate.baseline.treeHash
    && candidateHash === input.candidate.version.treeHash
    && casePackHash === input.casePack.hash
    && casePackHash === input.envelope.retentionCasePackHash
    && holdoutCasePackHash === input.envelope.casePackHash
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
    holdoutCasePackDir: string
    holdoutCasePackHash: string
  },
): Promise<ExistingSkillRetentionEvaluationEvidence> {
  const [baselineHash, candidateHash, casePackHash, holdoutCasePackHash] = await Promise.all([
    hashTree(input.baselineDir),
    hashTree(input.candidateDir),
    hashTree(input.casePackDir),
    hashTree(input.holdoutCasePackDir),
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
    && holdoutCasePackHash === input.holdoutCasePackHash
    && trial.baseline.treeHash === input.baselineTreeHash
    && trial.candidate.treeHash === input.candidateTreeHash
  return Object.freeze({
    holdoutCasePackHash: input.holdoutCasePackHash,
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

function classifyTrial(evidence: ExistingSkillRetentionEvaluationEvidence): {
  readonly status: ExistingSkillRetentionTerminalStatus
  readonly verdict: ExistingSkillRetentionVerdict
  readonly reason: ExistingSkillRetentionTerminalReason
} {
  if (!evidence.inputIntegrityStable
    || !evidence.assembled
    || !evidence.calibrationPassed
    || !evidence.compositionStable
    || evidence.trialCount !== 4) {
    return { status: 'incomplete', verdict: 'none', reason: 'paired-trial-integrity-failed' }
  }
  if (evidence.baseline === 'fail' && evidence.candidate === 'pass') {
    return { status: 'complete', verdict: 'retained', reason: 'candidate-passed-protected-retention' }
  }
  if (evidence.baseline === 'pass' && evidence.candidate === 'pass') {
    return {
      status: 'complete',
      verdict: 'ambiguous',
      reason: 'baseline-already-passed-protected-retention',
    }
  }
  if (evidence.baseline === 'fail' && evidence.candidate === 'fail') {
    return {
      status: 'complete',
      verdict: 'not-retained',
      reason: 'candidate-did-not-retain-protected-case',
    }
  }
  return {
    status: 'complete',
    verdict: 'regressed',
    reason: 'candidate-regressed-protected-retention',
  }
}

function terminalResult(input: {
  identity: RetentionIdentity
  reportPath: string
  startedAt: string
  now: number
  status: ExistingSkillRetentionTerminalStatus
  verdict: ExistingSkillRetentionVerdict
  reason: ExistingSkillRetentionTerminalReason
  evidence?: ExistingSkillRetentionEvaluationEvidence
}): ExistingSkillRetentionEvaluationResult & { readonly status: ExistingSkillRetentionTerminalStatus } {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-retention-evaluation-result-v1',
    id: input.identity.id,
    candidateId: input.identity.candidateId,
    holdoutEvaluationId: input.identity.holdoutEvaluationId,
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
  identity: RetentionIdentity,
  now: number,
): Promise<RetentionState> {
  try {
    const state = await readState(runDir)
    if (!sameIdentity(state, identity)) {
      throw new Error('existing-Skill Retention durable state has different exact inputs')
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
  state: RetentionState,
  phase: RetentionState['phase'],
  now: number,
): Promise<RetentionState> {
  const next = Object.freeze({ ...state, phase, updatedAt: new Date(now).toISOString() })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

async function readState(runDir: string): Promise<RetentionState> {
  const value = await readBoundedJson(join(runDir, 'state.json'))
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-retention-evaluation-state-v1'
    || !CONTENT_ID.test(String(value.id))
    || !PUBLIC_ID.test(String(value.policyId))
    || !CONTENT_ID.test(String(value.candidateId))
    || !CONTENT_ID.test(String(value.holdoutEvaluationId))
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.envelopeId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !CONTENT_ID.test(String(value.opportunityId))
    || !CONTENT_ID.test(String(value.qualificationId))
    || !CONTENT_ID.test(String(value.baselineId))
    || !CONTENT_ID.test(String(value.baselineTreeHash))
    || !CONTENT_ID.test(String(value.candidateTreeHash))
    || !CONTENT_ID.test(String(value.holdoutCasePackHash))
    || !CONTENT_ID.test(String(value.casePackHash))
    || !GIT_OBJECT.test(String(value.dshRevision))
    || !['prepared', 'trial-pending', 'complete', 'protected', 'incomplete'].includes(String(value.phase))
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new Error('existing-Skill Retention durable state has an invalid shape')
  }
  return Object.freeze(value as unknown as RetentionState)
}

async function readResult(
  runDir: string,
  identity: RetentionIdentity,
): Promise<ExistingSkillRetentionEvaluationResult | undefined> {
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
    || result.holdoutEvaluationId !== identity.holdoutEvaluationId
    || result.admissionId !== identity.admissionId
    || result.envelopeId !== identity.envelopeId
    || result.workspaceId !== identity.workspaceId
    || result.skillName !== identity.skillName
    || result.reportPath !== join(runDir, 'result.json')
    || (result.evidence !== undefined
      && (result.evidence.baselineTreeHash !== identity.baselineTreeHash
        || result.evidence.candidateTreeHash !== identity.candidateTreeHash
        || result.evidence.holdoutCasePackHash !== identity.holdoutCasePackHash
        || result.evidence.casePackHash !== identity.casePackHash))) {
    throw new Error('existing-Skill Retention result does not match its exact run identity')
  }
  return result
}

function parseResult(value: unknown): ExistingSkillRetentionEvaluationResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-retention-evaluation-result-v1'
    || !CONTENT_ID.test(String(value.id))
    || !CONTENT_ID.test(String(value.candidateId))
    || !CONTENT_ID.test(String(value.holdoutEvaluationId))
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.envelopeId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !['complete', 'protected', 'incomplete'].includes(String(value.status))
    || !['retained', 'ambiguous', 'not-retained', 'regressed', 'none'].includes(String(value.verdict))
    || typeof value.reason !== 'string'
    || typeof value.reportPath !== 'string'
    || !isAbsolute(value.reportPath)
    || typeof value.startedAt !== 'string'
    || typeof value.finishedAt !== 'string'
    || value.releaseAuthority !== 'none') {
    throw new Error('existing-Skill Retention result has an invalid shape')
  }
  if (value.evidence !== undefined && !isEvidence(value.evidence)) {
    throw new Error('existing-Skill Retention result has invalid evidence')
  }
  if (!isResultClassification(value)) {
    throw new Error('existing-Skill Retention result has an invalid classification')
  }
  return Object.freeze(value as unknown as ExistingSkillRetentionEvaluationResult)
}

function isResultClassification(value: Record<string, unknown>): boolean {
  const evidence = value.evidence
  if (value.status === 'complete') {
    if (!isRecord(evidence)) return false
    if (evidence.calibrationPassed !== true
      || evidence.assembled !== true
      || evidence.compositionStable !== true
      || evidence.inputIntegrityStable !== true
      || evidence.proposerCalls !== 0
      || evidence.trialCount !== 4) return false
    const classification = `${evidence.baseline}/${evidence.candidate}`
    return (classification === 'fail/pass'
      && value.verdict === 'retained'
      && value.reason === 'candidate-passed-protected-retention')
      || (classification === 'pass/pass'
        && value.verdict === 'ambiguous'
        && value.reason === 'baseline-already-passed-protected-retention')
      || (classification === 'fail/fail'
        && value.verdict === 'not-retained'
        && value.reason === 'candidate-did-not-retain-protected-case')
      || (classification === 'pass/fail'
        && value.verdict === 'regressed'
        && value.reason === 'candidate-regressed-protected-retention')
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

function isEvidence(value: unknown): value is ExistingSkillRetentionEvaluationEvidence {
  return isRecord(value)
    && CONTENT_ID.test(String(value.holdoutCasePackHash))
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
    && ((value.modelCalls === undefined && value.usage === undefined)
      || (isModelCallPair(value.modelCalls) && isUsagePair(value.usage)))
}

function isModelCallPair(value: unknown): boolean {
  return isRecord(value)
    && nonNegativeInteger(value.baseline)
    && nonNegativeInteger(value.candidate)
}

function isUsagePair(value: unknown): boolean {
  return isRecord(value)
    && isTrialUsage(value.baseline)
    && isTrialUsage(value.candidate)
}

function isTrialUsage(value: unknown): boolean {
  if (!isRecord(value)) return false
  return ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
    .every(key => value[key] === undefined || nonNegativeInteger(value[key]))
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function projectRun(
  state: RetentionState,
  result: ExistingSkillRetentionEvaluationResult | undefined,
): ExistingSkillRetentionEvaluationRunView {
  if (result?.status === 'abstained') {
    throw new Error('abstained existing-Skill Retention is not a durable run result')
  }
  if (result?.reason === 'no-independent-retention-case') {
    throw new Error('abstention reason cannot appear in a durable Retention result')
  }
  return Object.freeze({
    id: state.id,
    candidateId: state.candidateId,
    holdoutEvaluationId: state.holdoutEvaluationId,
    admissionId: state.admissionId,
    envelopeId: state.envelopeId,
    workspaceId: state.workspaceId,
    skillName: state.skillName,
    baselineTreeHash: state.baselineTreeHash,
    candidateTreeHash: state.candidateTreeHash,
    holdoutCasePackHash: state.holdoutCasePackHash,
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
  throw new Error('existing-Skill Retention path escapes its owned root')
}

function separate(left: string, right: string): boolean {
  const contains = (root: string, path: string): boolean => {
    const value = relative(root, path)
    return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  }
  return !contains(left, right) && !contains(right, left)
}

async function readBoundedJson(path: string): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_JSON_BYTES) {
    throw new Error('existing-Skill Retention JSON is not a bounded owned file')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function sameIdentity(state: RetentionState, identity: RetentionIdentity): boolean {
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
