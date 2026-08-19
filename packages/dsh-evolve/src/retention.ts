import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { readCapabilityAbsentSubject } from './capability-absent-subject.ts'
import { hashTree, sha256 } from './hash.ts'
import {
  parseSkillCandidateLineage,
  type SkillCandidateLineage,
} from './skill-candidate-lineage.ts'
import {
  loadShadowRunState,
  writeDurableJson,
  type PersistedProposal,
  type ShadowRunState,
} from './shadow-run-state.ts'
import { parseCasePackManifest } from './shadow.ts'
import { runPairedTrial, type PairedTrialResult } from './trial.ts'

const HASH = /^[a-f0-9]{64}$/

export interface RetentionOptions {
  readonly sourceRunDir: string
  readonly casePackDir: string
  readonly expectedCasePackHash?: string
  readonly outputDir: string
  readonly signal?: AbortSignal
}

export type RetentionResult =
  | { status: 'retained'; reportPath: string; summary: string }
  | { status: 'regressed'; reportPath: string; reason: string }
  | { status: 'incomplete'; reportPath: string; reason: string }

interface SourceReport {
  runId: string
  skillName: string
  baselineKind: 'skill-tree' | 'capability-absent'
  baseTreeHash: string
  candidateTreeHash: string
  recommendation: 'promote' | 'review'
  lineage?: SkillCandidateLineage
}

/** Replay one exact completed Shadow Candidate against one trusted prior Case Pack. */
export async function evaluateRetention(options: RetentionOptions): Promise<RetentionResult> {
  options.signal?.throwIfAborted()
  const sourceRunDir = await realpath(options.sourceRunDir)
  const casePackDir = await realpath(options.casePackDir)
  const requestedOutputDir = resolve(options.outputDir)
  const outputDir = resolve(await realpath(dirname(requestedOutputDir)), basename(requestedOutputDir))
  const state = await loadShadowRunState(sourceRunDir)
  if (state.phase !== 'complete' || state.outcome?.kind !== 'complete') {
    throw new Error('retention requires one terminal complete Shadow run')
  }
  if (!HASH.test(state.runId)
    || !HASH.test(state.identity.baseTreeHash)
    || !HASH.test(state.identity.casePackHash)
    || !HASH.test(state.proposalHash ?? '')) {
    throw new Error('retention source state has an invalid content identity')
  }
  if (state.outcome.reportPath !== resolve(sourceRunDir, 'report.json')) {
    throw new Error('retention source state references a report outside its run')
  }
  if (state.resumeInputs === undefined || state.proposal === undefined || state.proposalHash === undefined) {
    throw new Error('retention source has no durable baseline and Candidate inputs')
  }
  const proposal = parseProposal(state.proposal)
  if (sha256(JSON.stringify(proposal)) !== state.proposalHash) {
    throw new Error('retention source proposal does not match its durable hash')
  }
  const sourceReport = parseSourceReport(
    JSON.parse(await readFile(state.outcome.reportPath, 'utf8')) as unknown,
  )
  if (sourceReport.runId !== state.runId
    || sourceReport.skillName !== state.identity.skillName
    || sourceReport.baselineKind !== (state.identity.baselineKind ?? 'skill-tree')
    || sourceReport.baseTreeHash !== state.identity.baseTreeHash
    || JSON.stringify(sourceReport.lineage) !== JSON.stringify(state.identity.skillCandidateLineage)) {
    throw new Error('retention source report does not match its durable identity')
  }
  if (!state.outcome.summary.startsWith(`${sourceReport.recommendation}:`)) {
    throw new Error('retention source recommendation does not match its durable outcome')
  }

  const skillDir = await realpath(state.resumeInputs.skillDir)
  const primaryCasePackDir = await realpath(state.resumeInputs.casePackDir)
  const baselineKind = state.identity.baselineKind ?? 'skill-tree'
  if ((state.resumeInputs.baselineKind ?? 'skill-tree') !== baselineKind
    || (baselineKind === 'skill-tree'
      && (state.resumeInputs.baselineSkillName !== undefined
        || state.resumeInputs.candidateSkillDir !== undefined))) {
    throw new Error('retention baseline kind does not match its exact resume inputs')
  }
  const candidateSkillDir = baselineKind === 'capability-absent'
    ? await resolveAbsentCandidate(state.resumeInputs, state.identity.skillName)
    : undefined
  if (primaryCasePackDir === casePackDir) {
    throw new Error('retention Case Pack must be independent from the source Case Pack')
  }
  assertSeparateOutput(outputDir, [
    sourceRunDir,
    skillDir,
    ...candidateSkillDir === undefined ? [] : [candidateSkillDir],
    primaryCasePackDir,
    casePackDir,
  ])
  if (await hashTree(skillDir) !== state.identity.baseTreeHash) {
    throw new Error('retention baseline subject changed after the source Shadow')
  }
  if (await hashTree(primaryCasePackDir) !== state.identity.casePackHash) {
    throw new Error('retention source Case Pack changed after the source Shadow')
  }
  if (baselineKind === 'capability-absent') {
    const subject = await readCapabilityAbsentSubject(skillDir)
    if (subject.workspaceId !== state.identity.workspaceId
      || subject.opportunityId !== state.identity.skillCandidateLineage!.opportunityId
      || subject.skillName !== state.identity.skillName) {
      throw new Error('retention capability-absent subject does not match the source Shadow')
    }
    if (await hashTree(candidateSkillDir!) !== sourceReport.candidateTreeHash) {
      throw new Error('retention exact Candidate changed after the source Shadow')
    }
    if (parseSkillName(await readFile(resolve(candidateSkillDir!, 'SKILL.md'), 'utf8'))
      !== state.identity.skillName) {
      throw new Error('retention exact Candidate names a different Skill')
    }
  } else if (parseSkillName(await readFile(resolve(skillDir, 'SKILL.md'), 'utf8')) !== state.identity.skillName) {
    throw new Error('retention baseline Skill identity changed after the source Shadow')
  }

  const manifest = parseCasePackManifest(
    await readFile(resolve(casePackDir, 'manifest.json'), 'utf8'),
  )
  if (manifest.trial === undefined || manifest.calibration === undefined) {
    throw new Error('retention Case Pack requires trial and calibration definitions')
  }
  if (manifest.budget.trialLimit < 4) {
    throw new Error(
      `retention Case Pack trial budget is ${manifest.budget.trialLimit}; paired retention requires 4`,
    )
  }
  const casePackHash = await hashTree(casePackDir)
  if (options.expectedCasePackHash !== undefined && casePackHash !== options.expectedCasePackHash) {
    throw new Error('retention Case Pack does not match its configured exact hash')
  }
  if (casePackHash === state.identity.casePackHash) {
    throw new Error('retention Case Pack must not duplicate the source Case Pack')
  }
  const runId = sha256(JSON.stringify({
    sourceRunId: state.runId,
    ...baselineKind === 'skill-tree' ? {} : { baselineKind },
    candidateTreeHash: sourceReport.candidateTreeHash,
    casePackHash,
    dshRevision: manifest.epoch.dshRevision,
    evaluatorVersion: manifest.epoch.evaluatorVersion,
  }))
  const startedAt = new Date().toISOString()
  await mkdir(outputDir)
  const reportPath = resolve(outputDir, 'retention-report.json')
  const reportBase = {
    schemaVersion: 1,
    run: { id: runId, startedAt },
    source: {
      shadowRunId: state.runId,
      primaryCasePackHash: state.identity.casePackHash,
      recommendation: sourceReport.recommendation,
    },
    subject: {
      skillName: state.identity.skillName,
      ...baselineKind === 'skill-tree' ? {} : { baselineKind },
      baseTreeHash: state.identity.baseTreeHash,
      candidateTreeHash: sourceReport.candidateTreeHash,
    },
    casePack: { id: manifest.id, hash: casePackHash },
    epoch: manifest.epoch,
    model: { proposerCalls: 0 as const },
  }

  let trial: PairedTrialResult
  try {
    trial = await runPairedTrial({
      baselineKind,
      ...baselineKind === 'capability-absent'
        ? {
            baselineSkillName: state.identity.skillName,
            candidateSkillDir: candidateSkillDir!,
          }
        : { proposal },
      calibration: manifest.calibration,
      casePackDir,
      dshRevision: manifest.epoch.dshRevision,
      outputDir,
      ...options.signal === undefined ? {} : { signal: options.signal },
      skillDir,
      trial: manifest.trial,
      trialLimit: manifest.budget.trialLimit,
    })
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    const reason = error instanceof Error ? error.message : String(error)
    const finalTreeHash = await hashTree(skillDir)
    const finalCandidateTreeHash = candidateSkillDir === undefined
      ? undefined
      : await hashTree(candidateSkillDir)
    const finalPrimaryCasePackHash = await hashTree(primaryCasePackDir)
    const finalCasePackHash = await hashTree(casePackDir)
    await writeDurableJson(reportPath, {
      ...reportBase,
      run: { ...reportBase.run, status: 'incomplete', finishedAt: new Date().toISOString() },
      source: {
        ...reportBase.source,
        primaryCasePackFinalHash: finalPrimaryCasePackHash,
        primaryCasePackUnchanged: finalPrimaryCasePackHash === state.identity.casePackHash,
      },
      subject: {
        ...reportBase.subject,
        finalTreeHash,
        unchanged: finalTreeHash === state.identity.baseTreeHash,
        ...finalCandidateTreeHash === undefined ? {} : {
          finalCandidateTreeHash,
          candidateUnchanged: finalCandidateTreeHash === sourceReport.candidateTreeHash,
        },
      },
      casePack: {
        ...reportBase.casePack,
        finalHash: finalCasePackHash,
        unchanged: finalCasePackHash === casePackHash,
      },
      calibration: [],
      decision: { outcome: 'incomplete', reason },
    })
    return { status: 'incomplete', reportPath, reason }
  }

  const finalTreeHash = await hashTree(skillDir)
  const finalCandidateTreeHash = candidateSkillDir === undefined
    ? undefined
    : await hashTree(candidateSkillDir)
  const finalPrimaryCasePackHash = await hashTree(primaryCasePackDir)
  const finalCasePackHash = await hashTree(casePackDir)
  const calibrationPassed = trial.calibration.every(item => item.passed)
  const compositionStable = baselineKind === 'capability-absent'
    ? trial.baseline.composition !== undefined
      && trial.candidate.composition !== undefined
      && trial.baseline.composition.fingerprint === trial.candidate.composition.fingerprint
    : trial.baseline.composition === undefined
      && trial.candidate.composition === undefined
      || trial.baseline.composition !== undefined
        && trial.candidate.composition !== undefined
        && trial.baseline.composition.fingerprint === trial.candidate.composition.fingerprint
  const integrityReason = finalTreeHash !== state.identity.baseTreeHash
    ? 'baseline subject changed during retention Trial'
    : finalPrimaryCasePackHash !== state.identity.casePackHash
      ? 'source Case Pack changed during retention Trial'
      : finalCasePackHash !== casePackHash
        ? 'retention Case Pack changed during retention Trial'
        : finalCandidateTreeHash !== undefined
            && finalCandidateTreeHash !== sourceReport.candidateTreeHash
          ? 'exact Candidate changed during retention Trial'
          : trial.baseline.treeHash !== state.identity.baseTreeHash
            ? 'retention Trial baseline does not match the source Shadow baseline'
            : trial.candidate.treeHash !== sourceReport.candidateTreeHash
              ? 'retention Trial Candidate does not match the source Shadow Candidate'
              : !calibrationPassed
                ? 'retention Case Pack calibration failed'
                : !trial.baseline.passed
                  ? 'prior Case Pack does not pass on the source baseline'
                  : !compositionStable
                    ? 'retention Candidate changed non-target DSH composition'
                    : undefined
  const modelEvidence = trial.baseline.composition === undefined
    || trial.candidate.composition === undefined
    ? {}
    : {
        trialCalls: trial.baseline.composition.modelCalls + trial.candidate.composition.modelCalls,
        usage: {
          baseline: trial.baseline.composition.usage,
          candidate: trial.candidate.composition.usage,
        },
      }
  const completeBase = {
    ...reportBase,
    run: { ...reportBase.run, status: 'complete', finishedAt: new Date().toISOString() },
    source: {
      ...reportBase.source,
      primaryCasePackFinalHash: finalPrimaryCasePackHash,
      primaryCasePackUnchanged: finalPrimaryCasePackHash === state.identity.casePackHash,
    },
    subject: {
      ...reportBase.subject,
      finalTreeHash,
      unchanged: finalTreeHash === state.identity.baseTreeHash,
      ...finalCandidateTreeHash === undefined ? {} : {
        finalCandidateTreeHash,
        candidateUnchanged: finalCandidateTreeHash === sourceReport.candidateTreeHash,
      },
    },
    casePack: { ...reportBase.casePack, finalHash: finalCasePackHash, unchanged: finalCasePackHash === casePackHash },
    calibration: trial.calibration,
    comparison: {
      baseline: trial.baseline,
      candidate: trial.candidate,
      compositionStable,
    },
    trial: { backend: trial.backend, count: trial.count, assembled: trial.assembled },
    model: { ...reportBase.model, ...modelEvidence },
  }
  if (integrityReason !== undefined) {
    await writeDurableJson(reportPath, {
      ...completeBase,
      run: { ...completeBase.run, status: 'incomplete' },
      decision: { outcome: 'incomplete', reason: integrityReason },
    })
    return { status: 'incomplete', reportPath, reason: integrityReason }
  }
  if (!trial.candidate.passed) {
    const reason = 'Candidate failed a prior Case Pack that the baseline passed'
    await writeDurableJson(reportPath, {
      ...completeBase,
      decision: { outcome: 'regressed', reason },
    })
    return { status: 'regressed', reportPath, reason }
  }
  const summary = `retained: baseline and exact Candidate passed ${manifest.id}; report: ${reportPath}`
  await writeDurableJson(reportPath, {
    ...completeBase,
    decision: {
      outcome: 'retained',
      reason: 'baseline and exact Candidate passed the prior Case Pack',
    },
  })
  return { status: 'retained', reportPath, summary }
}

function parseProposal(value: unknown): PersistedProposal {
  if (!isRecord(value) || typeof value.claim !== 'string' || !Array.isArray(value.files)
    || !value.files.every(file => isRecord(file)
      && typeof file.path === 'string'
      && isOwnedRelativePath(file.path)
      && typeof file.content === 'string')) {
    throw new Error('retention source proposal has an invalid shape')
  }
  const proposal = structuredClone(value) as unknown as PersistedProposal
  if (new Set(proposal.files.map(file => file.path)).size !== proposal.files.length) {
    throw new Error('retention source proposal repeats an owned path')
  }
  return proposal
}

function parseSourceReport(value: unknown): SourceReport {
  const baselineKind = isRecord(value) && isRecord(value.subject)
    && value.subject.baselineKind === 'capability-absent'
    ? 'capability-absent'
    : 'skill-tree'
  if (!isRecord(value) || value.schemaVersion !== 1
    || !isRecord(value.run) || !HASH.test(String(value.run.id)) || value.run.status !== 'complete'
    || !isRecord(value.subject) || typeof value.subject.skillName !== 'string'
    || (value.subject.baselineKind !== undefined
      && !['skill-tree', 'capability-absent'].includes(String(value.subject.baselineKind)))
    || !HASH.test(String(value.subject.baseTreeHash)) || value.subject.unchanged !== true
    || !isRecord(value.candidate) || !HASH.test(String(value.candidate.treeHash))
    || value.candidate.parentTreeHash !== value.subject.baseTreeHash
    || value.candidate.parentKind !== baselineKind
    || !isRecord(value.decision) || !['promote', 'review'].includes(String(value.decision.recommendation))) {
    throw new Error('retention source report has no complete reviewable Candidate evidence')
  }
  const lineage = value.lineage === undefined
    ? undefined
    : parseSkillCandidateLineage(value.lineage)
  if (baselineKind === 'capability-absent'
    && (lineage === undefined
      || lineage.skillName !== value.subject.skillName
      || lineage.candidateTreeHash !== value.candidate.treeHash)) {
    throw new Error('retention capability-absent source has no exact internal Candidate lineage')
  }
  return {
    runId: String(value.run.id),
    skillName: value.subject.skillName,
    baselineKind,
    baseTreeHash: String(value.subject.baseTreeHash),
    candidateTreeHash: String(value.candidate.treeHash),
    recommendation: value.decision.recommendation as 'promote' | 'review',
    ...(lineage === undefined ? {} : { lineage }),
  }
}

async function resolveAbsentCandidate(
  resumeInputs: NonNullable<ShadowRunState['resumeInputs']>,
  skillName: string,
): Promise<string> {
  if (resumeInputs.baselineKind !== 'capability-absent'
    || resumeInputs.baselineSkillName !== skillName
    || resumeInputs.candidateSkillDir === undefined) {
    throw new Error('retention capability-absent source has incomplete exact inputs')
  }
  const path = await realpath(resumeInputs.candidateSkillDir)
  if (path !== resolve(resumeInputs.candidateSkillDir)) {
    throw new Error('retention exact Candidate path is not exact')
  }
  return path
}

function parseSkillName(source: string): string {
  const match = /^---\n[\s\S]*?^name:\s*([^\n]+)$/m.exec(source)
  if (!match?.[1]) throw new Error('SKILL.md frontmatter must declare name')
  return match[1].trim()
}

function assertSeparateOutput(outputDir: string, protectedDirs: readonly string[]): void {
  for (const protectedDir of protectedDirs) {
    const fromProtected = relative(protectedDir, outputDir)
    const fromOutput = relative(outputDir, protectedDir)
    if (fromProtected === '' || (!fromProtected.startsWith('..') && !isAbsolute(fromProtected))) {
      throw new Error('retention output directory must be outside every input')
    }
    if (fromOutput === '' || (!fromOutput.startsWith('..') && !isAbsolute(fromOutput))) {
      throw new Error('retention output directory must not contain an input')
    }
  }
}

function isOwnedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || isAbsolute(path)) return false
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
