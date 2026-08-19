import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { sha256 } from './hash.ts'
import type { ReviewCandidate } from './review-inbox.ts'

const HASH = /^[a-f0-9]{64}$/
const MAX_ROOTS = 20
const MAX_TOTAL_ENTRIES = 200
const MAX_REPORT_BYTES = 256 * 1024
const MAX_WARNINGS = 20

export type RetentionEvidenceStatus = 'retained' | 'regressed' | 'incomplete' | 'missing'

export interface RetentionEvidenceResult {
  readonly status: RetentionEvidenceStatus
  readonly matchedReports: number
  readonly reasons: string[]
  readonly warnings: string[]
}

export interface RetentionEvidenceGate {
  evaluate(candidate: ReviewCandidate): Promise<RetentionEvidenceResult>
}

interface ParsedRetentionEvidence {
  runId: string
  semanticHash: string
  sourceRunId: string
  recommendation: 'promote' | 'review'
  skillName: string
  baselineKind: 'skill-tree' | 'capability-absent'
  baseTreeHash: string
  candidateTreeHash: string
  outcome: Exclude<RetentionEvidenceStatus, 'missing'>
}

/** Read exact P1.11 reports from static host roots without creating another evidence database. */
export class RetentionEvidenceIndex implements RetentionEvidenceGate {
  private readonly roots: string[]

  constructor(roots: string[]) {
    if (roots.length === 0 || roots.length > MAX_ROOTS) {
      throw new Error(`retention evidence requires 1-${MAX_ROOTS} roots (at most ${MAX_ROOTS})`)
    }
    if (roots.some(root => !isAbsolute(root))) {
      throw new Error('retention evidence roots must be absolute')
    }
    if (new Set(roots).size !== roots.length) {
      throw new Error('retention evidence roots must be unique')
    }
    this.roots = [...roots]
  }

  async evaluate(candidate: ReviewCandidate): Promise<RetentionEvidenceResult> {
    const warnings: string[] = []
    const matched = new Map<string, ParsedRetentionEvidence>()
    let conflict = false
    let scannedEntries = 0
    for (const requestedRoot of this.roots) {
      let root: string
      let entries
      try {
        root = await realpath(requestedRoot)
        entries = await readdir(root, { withFileTypes: true })
        entries.sort((left, right) => left.name.localeCompare(right.name))
        const remaining = Math.max(0, MAX_TOTAL_ENTRIES - scannedEntries)
        if (entries.length > remaining) {
          addWarning(warnings, 'retention evidence roots exceed their bounded total entry limit')
          entries = entries.slice(0, remaining)
        }
        scannedEntries += entries.length
      } catch {
        addWarning(warnings, 'retention evidence root is unreadable')
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const evidence = await readEvidence(join(root, entry.name))
          if (!matches(evidence, candidate)) continue
          const existing = matched.get(evidence.runId)
          if (existing !== undefined && existing.semanticHash !== evidence.semanticHash) {
            conflict = true
            addWarning(warnings, 'duplicate Retention run id has conflicting exact evidence')
          } else {
            matched.set(evidence.runId, existing ?? evidence)
          }
        } catch (error) {
          if (isMissing(error)) continue
          addWarning(warnings, 'retention evidence item is malformed, tampered, or not an owned regular file')
        }
      }
    }

    const outcomes = [...matched.values()].map(evidence => evidence.outcome)
    if (conflict) {
      return result(
        'incomplete',
        matched.size,
        'conflicting exact Retention evidence is available',
        warnings,
      )
    }

    if (outcomes.includes('regressed')) {
      return result(
        'regressed',
        matched.size,
        'an exact prior Case Pack proves baseline pass / Candidate fail',
        warnings,
      )
    }
    if (outcomes.includes('retained')) {
      return result(
        'retained',
        matched.size,
        'one exact prior Case Pack retained the Candidate capability',
        warnings,
      )
    }
    if (outcomes.includes('incomplete')) {
      return result(
        'incomplete',
        matched.size,
        'only incomplete exact Retention evidence is available',
        warnings,
      )
    }
    return result('missing', 0, 'no exact Retention evidence is available', warnings)
  }
}

async function readEvidence(outputDir: string): Promise<ParsedRetentionEvidence> {
  const reportPath = join(outputDir, 'retention-report.json')
  const info = await lstat(reportPath)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('retention report must be a regular owned file')
  }
  if (info.size > MAX_REPORT_BYTES) throw new Error('retention report exceeds its bounded size')
  const value = JSON.parse(await readFile(reportPath, 'utf8')) as unknown
  if (!isRecord(value) || value.schemaVersion !== 1
    || !isRecord(value.run) || !HASH.test(String(value.run.id))
    || !['complete', 'incomplete'].includes(String(value.run.status))
    || !isRecord(value.source) || !HASH.test(String(value.source.shadowRunId))
    || !HASH.test(String(value.source.primaryCasePackHash))
    || !HASH.test(String(value.source.primaryCasePackFinalHash))
    || value.source.primaryCasePackUnchanged !== true
    || !['promote', 'review'].includes(String(value.source.recommendation))
    || !isRecord(value.subject) || typeof value.subject.skillName !== 'string'
    || (value.subject.baselineKind !== undefined
      && !['skill-tree', 'capability-absent'].includes(String(value.subject.baselineKind)))
    || !HASH.test(String(value.subject.baseTreeHash))
    || !HASH.test(String(value.subject.candidateTreeHash))
    || !HASH.test(String(value.subject.finalTreeHash)) || value.subject.unchanged !== true
    || !isRecord(value.casePack) || typeof value.casePack.id !== 'string'
    || !HASH.test(String(value.casePack.hash)) || !HASH.test(String(value.casePack.finalHash))
    || value.casePack.unchanged !== true
    || !isRecord(value.epoch) || typeof value.epoch.dshRevision !== 'string'
    || typeof value.epoch.evaluatorVersion !== 'string'
    || !isRecord(value.model) || value.model.proposerCalls !== 0
    || !isRecord(value.decision)
    || !['retained', 'regressed', 'incomplete'].includes(String(value.decision.outcome))) {
    throw new Error('retention report has an invalid exact-evidence shape')
  }
  const outcome = value.decision.outcome as ParsedRetentionEvidence['outcome']
  if ((outcome === 'incomplete') !== (value.run.status === 'incomplete')) {
    throw new Error('retention report run status contradicts its outcome')
  }
  if (value.source.primaryCasePackFinalHash !== value.source.primaryCasePackHash
    || value.subject.finalTreeHash !== value.subject.baseTreeHash
    || value.casePack.finalHash !== value.casePack.hash
    || value.casePack.hash === value.source.primaryCasePackHash) {
    throw new Error('retention report exact input identity changed')
  }
  const baselineKind = value.subject.baselineKind === 'capability-absent'
    ? 'capability-absent'
    : 'skill-tree'
  if (baselineKind === 'capability-absent'
    && (!HASH.test(String(value.subject.finalCandidateTreeHash))
      || value.subject.finalCandidateTreeHash !== value.subject.candidateTreeHash
      || value.subject.candidateUnchanged !== true)) {
    throw new Error('capability-absent Retention Candidate identity changed')
  }
  const expectedRunId = sha256(JSON.stringify({
    sourceRunId: value.source.shadowRunId,
    ...baselineKind === 'skill-tree' ? {} : { baselineKind },
    candidateTreeHash: value.subject.candidateTreeHash,
    casePackHash: value.casePack.hash,
    dshRevision: value.epoch.dshRevision,
    evaluatorVersion: value.epoch.evaluatorVersion,
  }))
  if (value.run.id !== expectedRunId) throw new Error('retention report run id is not content-derived')
  if (outcome !== 'incomplete') assertCompleteDecision(value, outcome)
  return {
    runId: String(value.run.id),
    semanticHash: semanticHash(value, outcome),
    sourceRunId: String(value.source.shadowRunId),
    recommendation: value.source.recommendation as 'promote' | 'review',
    skillName: value.subject.skillName,
    baselineKind,
    baseTreeHash: String(value.subject.baseTreeHash),
    candidateTreeHash: String(value.subject.candidateTreeHash),
    outcome,
  }
}

function semanticHash(
  value: Record<string, unknown>,
  outcome: ParsedRetentionEvidence['outcome'],
): string {
  const comparison = isRecord(value.comparison) ? value.comparison : {}
  const baseline = isRecord(comparison.baseline) ? comparison.baseline : {}
  const candidate = isRecord(comparison.candidate) ? comparison.candidate : {}
  return sha256(JSON.stringify({
    outcome,
    calibration: value.calibration,
    baseline: { passed: baseline.passed, treeHash: baseline.treeHash, checks: baseline.checks },
    candidate: { passed: candidate.passed, treeHash: candidate.treeHash, checks: candidate.checks },
    compositionStable: comparison.compositionStable,
    trial: value.trial,
  }))
}

function assertCompleteDecision(
  value: Record<string, unknown>,
  outcome: 'retained' | 'regressed',
): void {
  if (!hasExactCalibration(value.calibration)
    || !isRecord(value.comparison) || value.comparison.compositionStable !== true
    || !isRecord(value.comparison.baseline)
    || !isRecord(value.comparison.candidate)
    || value.comparison.baseline.treeHash !== (value.subject as Record<string, unknown>).baseTreeHash
    || value.comparison.candidate.treeHash !== (value.subject as Record<string, unknown>).candidateTreeHash
    || !isRecord(value.trial) || value.trial.backend !== 'darwin-seatbelt'
    || !Number.isSafeInteger(value.trial.count)
    || (value.trial.count as number) < 4) {
    throw new Error('retention report has incomplete terminal Trial evidence')
  }
  assertEvaluatorOutcome(value.comparison.baseline)
  assertEvaluatorOutcome(value.comparison.candidate)
  if (value.comparison.baseline.passed !== true) {
    throw new Error('retention report prior baseline did not pass')
  }
  const candidatePassed = value.comparison.candidate.passed
  if ((outcome === 'retained' && candidatePassed !== true)
    || (outcome === 'regressed' && candidatePassed !== false)) {
    throw new Error('retention report decision contradicts Candidate evidence')
  }
}

function hasExactCalibration(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false
  const rows = new Map(value.filter(isRecord).map(item => [item.id, item]))
  const knownBad = rows.get('known-bad')
  const knownCorrection = rows.get('known-correction')
  return rows.size === 2
    && knownBad?.expected === 'fail' && knownBad.actual === 'fail' && knownBad.passed === true
    && knownCorrection?.expected === 'pass'
    && knownCorrection.actual === 'pass'
    && knownCorrection.passed === true
}

function assertEvaluatorOutcome(value: Record<string, unknown>): void {
  if (typeof value.passed !== 'boolean' || !Array.isArray(value.checks) || value.checks.length === 0
    || !value.checks.every(check => isRecord(check)
      && typeof check.name === 'string'
      && typeof check.passed === 'boolean')) {
    throw new Error('retention report evaluator outcome has an invalid shape')
  }
  if (value.passed !== value.checks.every(check => (check as Record<string, unknown>).passed === true)) {
    throw new Error('retention report evaluator outcome contradicts its checks')
  }
}

function matches(evidence: ParsedRetentionEvidence, candidate: ReviewCandidate): boolean {
  return evidence.sourceRunId === candidate.runId
    && evidence.recommendation === candidate.recommendation
    && evidence.skillName === candidate.skillName
    && evidence.baselineKind === (candidate.baselineKind ?? 'skill-tree')
    && evidence.baseTreeHash === candidate.baseTreeHash
    && evidence.candidateTreeHash === candidate.candidateTreeHash
}

function result(
  status: RetentionEvidenceStatus,
  matchedReports: number,
  reason: string,
  warnings: string[],
): RetentionEvidenceResult {
  return { status, matchedReports, reasons: [reason], warnings }
}

function addWarning(warnings: string[], warning: string): void {
  if (warnings.length < MAX_WARNINGS) warnings.push(warning)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}
