import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { readCapabilityAbsentSubject } from './capability-absent-subject.ts'
import { hashTree } from './hash.ts'
import type {
  QualifiedSkillCandidateShadowInput,
  SkillCandidateAdmission,
  SkillCandidateAdmissionResult,
} from './skill-candidate-admission.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'
import { parseSkillCandidateLineage } from './skill-candidate-lineage.ts'
import { parseCasePackManifest } from './shadow.ts'
import {
  acquireShadowRunLock,
  loadShadowRunState,
  writeDurableJson,
} from './shadow-run-state.ts'
import { runPairedTrial, type PairedTrialResult } from './trial.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/

export type InternalSkillRetentionReason =
  | 'no-independent-retention-case'
  | 'shadow-not-complete'
  | 'shadow-not-promotable'
  | 'retention-trial-failed'
  | 'retention-input-mutated'
  | 'retention-not-assembled'
  | 'retention-calibration-failed'
  | 'prior-case-baseline-failed'
  | 'non-target-composition-changed'
  | 'candidate-regressed-prior-case'
  | 'candidate-retained-prior-case'

export interface InternalSkillRetentionResult {
  readonly schemaVersion: 1
  readonly kind: 'internal-skill-retention-result-v1'
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly shadowRunId?: string
  readonly status: 'abstained' | 'retained' | 'regressed' | 'incomplete'
  readonly reason: InternalSkillRetentionReason
  readonly releaseAuthority: 'none'
  readonly reportPath?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly evidence?: {
    readonly retentionCasePackHash: string
    readonly baselineTreeHash: string
    readonly candidateTreeHash: string
    readonly baseline: 'pass' | 'fail'
    readonly candidate: 'pass' | 'fail'
    readonly calibrationPassed: boolean
    readonly compositionStable: boolean
    readonly proposerCalls: 0
    readonly trialCount: 4
    readonly modelCalls?: { readonly baseline: number; readonly candidate: number }
    readonly usage?: {
      readonly baseline: Record<string, number | undefined>
      readonly candidate: Record<string, number | undefined>
    }
  }
}

export type InternalCandidateShadowResult =
  | { readonly status: 'complete'; readonly reportPath: string; readonly summary: string }
  | { readonly status: 'incomplete'; readonly reportPath: string; readonly reason: string }

interface QualifiedAdmissionReader {
  qualifiedShadowInput(
    candidate: ExperienceSkillCandidate,
    admission: SkillCandidateAdmissionResult,
  ): Promise<QualifiedSkillCandidateShadowInput>
}

interface ExactShadowSource {
  readonly runDir: string
  readonly runId: string
  readonly dshRevision: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly recommendation: 'promote' | 'review' | 'reject'
}

interface RetentionRunIdentity {
  readonly schemaVersion: 1
  readonly kind: 'internal-skill-retention-run-v1'
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly shadowRunId: string
  readonly baselineTreeHash: string
  readonly candidateTreeHash: string
  readonly retentionCasePackHash: string
}

type TrialRunner = typeof runPairedTrial

/**
 * Replay the exact Opportunity-bound internal Candidate against the independent
 * fifth-Goal Case Pack. This module can emit evidence but never publish a Skill.
 */
export class InternalSkillRetention {
  private readonly admission: QualifiedAdmissionReader
  private readonly runTrial: TrialRunner

  constructor(
    admission: Pick<SkillCandidateAdmission, 'qualifiedShadowInput'>,
    options: { runTrial?: TrialRunner } = {},
  ) {
    this.admission = admission
    this.runTrial = options.runTrial ?? runPairedTrial
  }

  async evaluate(
    candidate: ExperienceSkillCandidate,
    admission: SkillCandidateAdmissionResult,
    shadow: InternalCandidateShadowResult,
    options: { signal?: AbortSignal } = {},
  ): Promise<InternalSkillRetentionResult> {
    options.signal?.throwIfAborted()
    assertAdmission(candidate, admission)
    const source = await this.admission.qualifiedShadowInput(candidate, admission)
    if (source.retentionCasePackDir === undefined
      || source.retentionCasePackHash === undefined
      || source.retentionRunRoot === undefined) {
      return abstained(candidate, admission, 'no-independent-retention-case')
    }
    if (shadow.status !== 'complete') {
      return abstained(candidate, admission, 'shadow-not-complete')
    }

    const exact = await readExactShadowSource(candidate, admission, source, shadow)
    if (exact.recommendation !== 'promote') {
      return abstained(candidate, admission, 'shadow-not-promotable', exact.runId)
    }
    const retentionSource = {
      ...source,
      retentionCasePackDir: source.retentionCasePackDir,
      retentionCasePackHash: source.retentionCasePackHash,
      retentionRunRoot: source.retentionRunRoot,
    } as Required<Pick<QualifiedSkillCandidateShadowInput,
      'retentionCasePackDir' | 'retentionCasePackHash' | 'retentionRunRoot'>>
      & QualifiedSkillCandidateShadowInput
    const retention = await resolveRetentionInputs(candidate, retentionSource, exact)
    const id = retentionId(candidate.id, admission.id, source.evaluationEnvelopeId, exact.runId,
      retention.casePackHash)
    const outputDir = join(retention.runRoot, id)
    const reportPath = join(outputDir, 'result.json')
    const prepared: RetentionRunIdentity = {
      schemaVersion: 1,
      kind: 'internal-skill-retention-run-v1',
      id,
      candidateId: candidate.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.skillName,
      admissionId: admission.id,
      evaluationEnvelopeId: source.evaluationEnvelopeId,
      shadowRunId: exact.runId,
      baselineTreeHash: exact.baselineTreeHash,
      candidateTreeHash: exact.candidateTreeHash,
      retentionCasePackHash: retention.casePackHash,
    } as const

    await ensureRunDirectory(outputDir)
    const releaseLock = await acquireShadowRunLock(outputDir)
    try {
      await ensurePrepared(outputDir, prepared)
      const existing = await readExistingResult(reportPath, prepared)
      if (existing !== undefined) return existing
      const startedAt = new Date().toISOString()
      let trial: PairedTrialResult
      try {
        trial = await this.runTrial({
          baselineKind: 'capability-absent',
          baselineSkillName: candidate.skillName,
          calibration: retention.manifest.calibration!,
          casePackDir: retention.casePackDir,
          candidateSkillDir: source.candidateDir,
          dshRevision: retention.manifest.epoch.dshRevision,
          outputDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir: source.baselineDir,
          trial: retention.manifest.trial!,
          trialLimit: retention.manifest.budget.trialLimit,
        })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        const result = terminalResult({
          candidate,
          admission,
          source,
          exact,
          id,
          reportPath,
          startedAt,
          status: 'incomplete',
          reason: 'retention-trial-failed',
        })
        await writeDurableJson(reportPath, result)
        return result
      }

      const integrity = await verifyPostTrialIntegrity(source, exact, retention, trial)
      const calibrationPassed = trial.calibration.every(row => row.passed)
      const baselineComposition = trial.baseline.composition
      const candidateComposition = trial.candidate.composition
      const compositionStable = baselineComposition !== undefined
        && candidateComposition !== undefined
        && baselineComposition.fingerprint === candidateComposition.fingerprint
      const evidence: NonNullable<InternalSkillRetentionResult['evidence']> = {
        retentionCasePackHash: retention.casePackHash,
        baselineTreeHash: trial.baseline.treeHash,
        candidateTreeHash: trial.candidate.treeHash,
        baseline: trial.baseline.passed ? 'pass' : 'fail',
        candidate: trial.candidate.passed ? 'pass' : 'fail',
        calibrationPassed,
        compositionStable,
        proposerCalls: 0,
        trialCount: 4,
        ...(baselineComposition === undefined || candidateComposition === undefined ? {} : {
          modelCalls: {
            baseline: baselineComposition.modelCalls,
            candidate: candidateComposition.modelCalls,
          },
          usage: {
            baseline: baselineComposition.usage,
            candidate: candidateComposition.usage,
          },
        }),
      }
      const verdict = integrity === false
        ? { status: 'incomplete' as const, reason: 'retention-input-mutated' as const }
        : trial.assembled !== true
          ? { status: 'incomplete' as const, reason: 'retention-not-assembled' as const }
          : !calibrationPassed
            ? { status: 'incomplete' as const, reason: 'retention-calibration-failed' as const }
            : !trial.baseline.passed
              ? { status: 'incomplete' as const, reason: 'prior-case-baseline-failed' as const }
              : !compositionStable
                ? { status: 'incomplete' as const, reason: 'non-target-composition-changed' as const }
                : !trial.candidate.passed
                  ? { status: 'regressed' as const, reason: 'candidate-regressed-prior-case' as const }
                  : { status: 'retained' as const, reason: 'candidate-retained-prior-case' as const }
      const result = terminalResult({
        candidate,
        admission,
        source,
        exact,
        id,
        reportPath,
        startedAt,
        ...verdict,
        evidence,
      })
      await writeDurableJson(reportPath, result)
      return result
    } finally {
      await releaseLock()
    }
  }
}

function assertAdmission(
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
): void {
  if (admission.status !== 'qualified-for-shadow'
    || admission.candidateId !== candidate.id
    || admission.workspaceId !== candidate.workspaceId
    || admission.skillName !== candidate.skillName
    || admission.envelopeId === undefined
    || admission.evidence?.candidateTreeHash !== candidate.version.treeHash) {
    throw new Error('retention requires the exact qualified internal Candidate admission')
  }
}

async function readExactShadowSource(
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
  source: QualifiedSkillCandidateShadowInput,
  shadow: Extract<InternalCandidateShadowResult, { status: 'complete' }>,
): Promise<ExactShadowSource> {
  const [shadowRoot, reportPath] = await Promise.all([
    realpath(source.shadowRunRoot),
    realpath(shadow.reportPath),
  ])
  const runDir = dirname(reportPath)
  const fromRoot = relative(shadowRoot, reportPath).split(sep)
  if (basename(reportPath) !== 'report.json'
    || fromRoot.length !== 2
    || !CONTENT_ID.test(fromRoot[0]!)
    || fromRoot[1] !== 'report.json'
    || await realpath(runDir) !== runDir) {
    throw new Error('retention Shadow report is outside the exact Shadow run root')
  }
  const state = await loadShadowRunState(runDir)
  if (state.phase !== 'complete'
    || state.outcome?.kind !== 'complete'
    || state.outcome.reportPath !== reportPath
    || state.outcome.summary !== shadow.summary
    || state.resumeInputs === undefined
    || state.resumeInputs.skillDir !== source.baselineDir
    || state.resumeInputs.casePackDir !== source.holdoutCasePackDir
    || state.resumeInputs.baselineKind !== 'capability-absent'
    || state.resumeInputs.baselineSkillName !== candidate.skillName
    || state.resumeInputs.candidateSkillDir !== source.candidateDir
    || state.identity.workspaceId !== candidate.workspaceId
    || state.identity.skillName !== candidate.skillName
    || state.identity.baselineKind !== 'capability-absent'
    || state.identity.casePackHash !== source.holdoutCasePackHash
    || state.modelUsage?.inputTokens !== 0
    || state.modelUsage.outputTokens !== 0) {
    throw new Error('retention Shadow state does not match the exact qualified handoff')
  }
  const lineage = parseSkillCandidateLineage(source.lineage)
  if (JSON.stringify(state.identity.skillCandidateLineage) !== JSON.stringify(lineage)) {
    throw new Error('Shadow state does not match the exact internal Candidate lineage')
  }
  const report = parseShadowReport(JSON.parse(await readFile(reportPath, 'utf8')) as unknown)
  if (JSON.stringify(report.lineage) !== JSON.stringify(lineage)) {
    throw new Error('Shadow report does not match the exact internal Candidate lineage')
  }
  if (report.runId !== state.runId
    || report.skillName !== candidate.skillName
    || report.baselineTreeHash !== state.identity.baseTreeHash
    || report.finalTreeHash !== state.identity.baseTreeHash
    || report.candidateTreeHash !== lineage.candidateTreeHash
    || report.parentTreeHash !== state.identity.baseTreeHash
    || report.dshRevision !== state.identity.dshRevision
    || report.casePackHash !== source.holdoutCasePackHash
    || report.casePackFinalHash !== source.holdoutCasePackHash) {
    throw new Error('Shadow report does not match its durable exact inputs')
  }
  if (report.recommendation === 'promote'
    && (!shadow.summary.startsWith('promote:')
      || report.baseline !== 'fail'
      || report.candidate !== 'pass'
      || report.compositionStable !== true
      || report.trialCount !== 4)) {
    throw new Error('promotable Shadow report lacks its sealed paired evidence')
  }
  return {
    runDir,
    runId: state.runId,
    dshRevision: state.identity.dshRevision,
    baselineTreeHash: state.identity.baseTreeHash,
    candidateTreeHash: lineage.candidateTreeHash,
    recommendation: report.recommendation,
  }
}

async function resolveRetentionInputs(
  candidate: ExperienceSkillCandidate,
  source: Required<Pick<QualifiedSkillCandidateShadowInput,
    'retentionCasePackDir' | 'retentionCasePackHash' | 'retentionRunRoot'>>
    & QualifiedSkillCandidateShadowInput,
  exact: ExactShadowSource,
) {
  const [casePackDir, runRoot] = await Promise.all([
    realpath(source.retentionCasePackDir),
    realpath(source.retentionRunRoot),
  ])
  assertRetentionRoots(source, exact.runDir, casePackDir, runRoot)
  const casePackHash = await hashTree(casePackDir)
  if (casePackHash !== source.retentionCasePackHash
    || casePackHash === source.admissionCasePackHash
    || casePackHash === source.holdoutCasePackHash) {
    throw new Error('retention Case Pack is not the exact independent Envelope partition')
  }
  const manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
  const holdoutManifest = parseCasePackManifest(
    await readFile(join(source.holdoutCasePackDir, 'manifest.json'), 'utf8'),
  )
  if (manifest.workspaceId !== candidate.workspaceId
    || manifest.epoch.dshRevision !== exact.dshRevision
    || manifest.trial?.dshAssembled !== true
    || manifest.trial.capabilityAbsentBaseline !== true
    || manifest.calibration === undefined
    || manifest.budget.trialLimit < 4
    || JSON.stringify(manifest.budget) !== JSON.stringify(holdoutManifest.budget)) {
    throw new Error('retention Case Pack does not preserve the sealed Shadow evaluation contract')
  }
  const subject = await readCapabilityAbsentSubject(source.baselineDir)
  if (subject.workspaceId !== candidate.workspaceId
    || subject.opportunityId !== candidate.opportunity.id
    || subject.skillName !== candidate.skillName
    || await hashTree(source.baselineDir) !== exact.baselineTreeHash
    || await hashTree(source.candidateDir) !== exact.candidateTreeHash) {
    throw new Error('retention subject or exact Candidate changed after Shadow')
  }
  return { casePackDir, casePackHash, runRoot, manifest }
}

async function verifyPostTrialIntegrity(
  source: QualifiedSkillCandidateShadowInput,
  exact: ExactShadowSource,
  retention: Awaited<ReturnType<typeof resolveRetentionInputs>>,
  trial: PairedTrialResult,
): Promise<boolean> {
  const [baselineHash, candidateHash, admissionHash, holdoutHash, retentionHash] = await Promise.all([
    hashTree(source.baselineDir),
    hashTree(source.candidateDir),
    hashTree(source.admissionCasePackDir),
    hashTree(source.holdoutCasePackDir),
    hashTree(retention.casePackDir),
  ])
  return baselineHash === exact.baselineTreeHash
    && candidateHash === exact.candidateTreeHash
    && admissionHash === source.admissionCasePackHash
    && holdoutHash === source.holdoutCasePackHash
    && retentionHash === retention.casePackHash
    && trial.baseline.treeHash === exact.baselineTreeHash
    && trial.candidate.treeHash === exact.candidateTreeHash
}

function terminalResult(input: {
  candidate: ExperienceSkillCandidate
  admission: SkillCandidateAdmissionResult
  source: QualifiedSkillCandidateShadowInput
  exact: ExactShadowSource
  id: string
  reportPath: string
  startedAt: string
  status: 'retained' | 'regressed' | 'incomplete'
  reason: InternalSkillRetentionReason
  evidence?: InternalSkillRetentionResult['evidence']
}): InternalSkillRetentionResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'internal-skill-retention-result-v1',
    id: input.id,
    candidateId: input.candidate.id,
    workspaceId: input.candidate.workspaceId,
    skillName: input.candidate.skillName,
    admissionId: input.admission.id,
    evaluationEnvelopeId: input.source.evaluationEnvelopeId,
    shadowRunId: input.exact.runId,
    status: input.status,
    reason: input.reason,
    releaseAuthority: 'none',
    reportPath: input.reportPath,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    ...input.evidence === undefined ? {} : { evidence: input.evidence },
  })
}

function abstained(
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
  reason: Extract<InternalSkillRetentionReason,
    'no-independent-retention-case' | 'shadow-not-complete' | 'shadow-not-promotable'>,
  shadowRunId?: string,
): InternalSkillRetentionResult {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'internal-skill-retention-result-v1',
    id: retentionId(candidate.id, admission.id, admission.envelopeId!, shadowRunId ?? reason, reason),
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    admissionId: admission.id,
    evaluationEnvelopeId: admission.envelopeId!,
    ...shadowRunId === undefined ? {} : { shadowRunId },
    status: 'abstained',
    reason,
    releaseAuthority: 'none',
  })
}

async function ensureRunDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!isMissingOrExisting(error, 'EEXIST')) throw error
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
      throw new Error('retention output is not an exact owned directory')
    }
  }
}

async function ensurePrepared(path: string, expected: unknown): Promise<void> {
  const preparedPath = join(path, 'prepared.json')
  try {
    const actual = JSON.parse(await readFile(preparedPath, 'utf8')) as unknown
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('retention durable run identity does not match its exact inputs')
    }
  } catch (error) {
    if (!isMissingOrExisting(error, 'ENOENT')) throw error
    await writeDurableJson(preparedPath, expected)
  }
}

async function readExistingResult(
  reportPath: string,
  prepared: RetentionRunIdentity,
): Promise<InternalSkillRetentionResult | undefined> {
  try {
    const result = parseRetentionResult(JSON.parse(await readFile(reportPath, 'utf8')) as unknown)
    const evidenceMatches = result.evidence === undefined
      ? result.reason === 'retention-trial-failed'
      : result.evidence.retentionCasePackHash === prepared.retentionCasePackHash
        && result.evidence.baselineTreeHash === prepared.baselineTreeHash
        && result.evidence.candidateTreeHash === prepared.candidateTreeHash
    if (result.id !== prepared.id
      || result.candidateId !== prepared.candidateId
      || result.workspaceId !== prepared.workspaceId
      || result.skillName !== prepared.skillName
      || result.admissionId !== prepared.admissionId
      || result.evaluationEnvelopeId !== prepared.evaluationEnvelopeId
      || result.shadowRunId !== prepared.shadowRunId
      || result.reportPath !== reportPath
      || !evidenceMatches) {
      throw new Error('retention durable result does not match its exact run identity')
    }
    return result
  } catch (error) {
    if (isMissingOrExisting(error, 'ENOENT')) return undefined
    throw error
  }
}

function parseRetentionResult(value: unknown): InternalSkillRetentionResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'internal-skill-retention-result-v1'
    || !CONTENT_ID.test(String(value.id))
    || !CONTENT_ID.test(String(value.candidateId))
    || typeof value.workspaceId !== 'string'
    || typeof value.skillName !== 'string'
    || !CONTENT_ID.test(String(value.admissionId))
    || !CONTENT_ID.test(String(value.evaluationEnvelopeId))
    || !['retained', 'regressed', 'incomplete'].includes(String(value.status))
    || typeof value.reason !== 'string'
    || value.releaseAuthority !== 'none'
    || typeof value.reportPath !== 'string'
    || typeof value.startedAt !== 'string'
    || typeof value.finishedAt !== 'string') {
    throw new Error('retention durable result has an invalid shape')
  }
  const evidence = isRetentionEvidence(value.evidence) ? value.evidence : undefined
  const verdictBound = value.status === 'retained'
    ? value.reason === 'candidate-retained-prior-case'
      && evidence?.baseline === 'pass'
      && evidence.candidate === 'pass'
      && evidence.calibrationPassed === true
      && evidence.compositionStable === true
    : value.status === 'regressed'
      ? value.reason === 'candidate-regressed-prior-case'
        && evidence?.baseline === 'pass'
        && evidence.candidate === 'fail'
        && evidence.calibrationPassed === true
        && evidence.compositionStable === true
      : INCOMPLETE_REASONS.has(value.reason as InternalSkillRetentionReason)
        && (value.reason === 'retention-trial-failed' ? value.evidence === undefined : evidence !== undefined)
  if (!verdictBound) {
    throw new Error('retention durable result has an invalid verdict binding')
  }
  return Object.freeze(value as unknown as InternalSkillRetentionResult)
}

function isRetentionEvidence(value: unknown): value is NonNullable<InternalSkillRetentionResult['evidence']> {
  return isRecord(value)
    && CONTENT_ID.test(String(value.retentionCasePackHash))
    && CONTENT_ID.test(String(value.baselineTreeHash))
    && CONTENT_ID.test(String(value.candidateTreeHash))
    && ['pass', 'fail'].includes(String(value.baseline))
    && ['pass', 'fail'].includes(String(value.candidate))
    && typeof value.calibrationPassed === 'boolean'
    && typeof value.compositionStable === 'boolean'
    && value.proposerCalls === 0
    && value.trialCount === 4
}

function parseShadowReport(value: unknown): {
  runId: string
  skillName: string
  baselineTreeHash: string
  finalTreeHash: string
  candidateTreeHash: string
  parentTreeHash: string
  dshRevision: string
  casePackHash: string
  casePackFinalHash: string
  baseline: 'pass' | 'fail'
  candidate: 'pass' | 'fail'
  compositionStable: boolean
  trialCount: number
  recommendation: 'promote' | 'review' | 'reject'
  lineage: unknown
} {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isRecord(value.run) || !CONTENT_ID.test(String(value.run.id)) || value.run.status !== 'complete'
    || !isRecord(value.subject) || value.subject.baselineKind !== 'capability-absent'
    || typeof value.subject.skillName !== 'string'
    || !CONTENT_ID.test(String(value.subject.baseTreeHash))
    || !CONTENT_ID.test(String(value.subject.finalTreeHash))
    || value.subject.unchanged !== true
    || !isRecord(value.epoch) || typeof value.epoch.dshRevision !== 'string'
    || !CONTENT_ID.test(String(value.epoch.casePackHash))
    || !CONTENT_ID.test(String(value.epoch.casePackFinalHash))
    || value.epoch.casePackUnchanged !== true
    || !isRecord(value.candidate) || !CONTENT_ID.test(String(value.candidate.treeHash))
    || !CONTENT_ID.test(String(value.candidate.parentTreeHash))
    || value.candidate.parentKind !== 'capability-absent'
    || !Array.isArray(value.cases) || !isRecord(value.cases[0])
    || !['pass', 'fail'].includes(String(value.cases[0].baseline))
    || !['pass', 'fail'].includes(String(value.cases[0].candidate))
    || !isRecord(value.composition) || typeof value.composition.stable !== 'boolean'
    || !isRecord(value.trial) || value.trial.enforcement !== 'full' || value.trial.count !== 4
    || !isRecord(value.decision)
    || !['promote', 'review', 'reject'].includes(String(value.decision.recommendation))) {
    throw new Error('retention source Shadow report has an invalid sealed evidence shape')
  }
  return {
    runId: String(value.run.id),
    skillName: String(value.subject.skillName),
    baselineTreeHash: String(value.subject.baseTreeHash),
    finalTreeHash: String(value.subject.finalTreeHash),
    candidateTreeHash: String(value.candidate.treeHash),
    parentTreeHash: String(value.candidate.parentTreeHash),
    dshRevision: String(value.epoch.dshRevision),
    casePackHash: String(value.epoch.casePackHash),
    casePackFinalHash: String(value.epoch.casePackFinalHash),
    baseline: value.cases[0].baseline as 'pass' | 'fail',
    candidate: value.cases[0].candidate as 'pass' | 'fail',
    compositionStable: value.composition.stable as boolean,
    trialCount: value.trial.count as number,
    recommendation: value.decision.recommendation as 'promote' | 'review' | 'reject',
    lineage: value.lineage,
  }
}

function assertRetentionRoots(
  source: QualifiedSkillCandidateShadowInput,
  shadowRunDir: string,
  casePackDir: string,
  runRoot: string,
): void {
  if (!separate(casePackDir, runRoot)) {
    throw new Error('retention Case Pack and run root must be isolated')
  }
  for (const root of [
    source.baselineDir,
    source.candidateDir,
    source.admissionCasePackDir,
    source.admissionRunRoot,
    source.holdoutCasePackDir,
    source.shadowRunRoot,
    shadowRunDir,
  ]) {
    if (!separate(casePackDir, root) || !separate(runRoot, root)) {
      throw new Error('retention governance roots overlap prior evaluation inputs')
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

function retentionId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify([
    'opportunity-bound-internal-skill-retention-v1',
    ...parts,
  ])).digest('hex')
}

function isMissingOrExisting(error: unknown, code: 'ENOENT' | 'EEXIST'): boolean {
  return isRecord(error) && error.code === code
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const INCOMPLETE_REASONS = new Set<InternalSkillRetentionReason>([
  'retention-trial-failed',
  'retention-input-mutated',
  'retention-not-assembled',
  'retention-calibration-failed',
  'prior-case-baseline-failed',
  'non-target-composition-changed',
])
