import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative } from 'node:path'
import { loadShadowRunState, writeDurableJson } from './shadow-run-state.ts'
import type { AutomaticEvolutionInflightStatus } from './automatic-evolution-inflight.ts'

export interface ReviewCaseSummary {
  id: string
  baseline: 'pass' | 'fail' | 'incomplete'
  candidate: 'pass' | 'fail' | 'incomplete'
  passedChecks: number
  totalChecks: number
}

export interface AutomaticReviewExpiryProjection {
  readonly eligibleAt: string
  readonly eligible: boolean
  readonly trigger: 'next-same-skill-automatic-signal'
}

export interface ReviewCandidate {
  id: string
  runId: string
  status: 'pending' | 'approved' | 'rejected'
  outputDir: string
  skillName: string
  recommendation: 'promote' | 'review'
  claim: string
  changedFiles: string[]
  candidateTreeHash: string
  baseTreeHash: string
  proposalHash: string
  proposal: { claim: string; files: Array<{ path: string; content: string }> }
  cases: ReviewCaseSummary[]
  cost: { inputTokens: number; outputTokens: number; trialCount: number }
  reasons: string[]
  limitations: string[]
  evaluatorVersion: string
  compositionFingerprint: string
  compositionStable: boolean
  startedAt: string
  completedAt?: string
  feedbackSignalId?: string
  feedbackLaunchMode?: 'human' | 'automatic'
  automaticReviewExpiry?: AutomaticReviewExpiryProjection
  evidenceHash: string
  decisionActor?: ReviewDecisionActor
  decisionNote?: string
  generationId?: string
  activatedAt?: string
}

export interface ReviewScan {
  candidates: ReviewCandidate[]
  warnings: string[]
}

interface ReviewDisposition {
  schemaVersion: 1
  reviewId: string
  evidenceHash: string
  status: 'approved' | 'rejected'
  actor?: ReviewDecisionActor
  decidedAt: string
  decisionNote?: string
  generationId?: string
  activatedAt?: string
}

const hashPattern = /^[a-f0-9]{64}$/
const MAX_PENDING_REVIEW_MS = 2_160 * 60 * 60 * 1_000

type ReviewDecisionActor = 'human' | 'auto-clear-instruction-v1' | 'auto-review-expiry-v1'

export interface AutomaticReviewExpiryPolicy {
  readonly skillName: string
  readonly maxPendingReviewMs: number
}

export interface ReviewInboxOptions {
  readonly automaticReviewExpiry?: readonly AutomaticReviewExpiryPolicy[]
  readonly now?: () => number
}

/** Read and durably disposition completed Shadow evidence without copying it into a second database. */
export class ReviewInbox {
  private readonly runRoots: string[]
  private readonly actionTails = new Map<string, Promise<void>>()
  private readonly automaticReviewExpiry = new Map<string, number>()
  private readonly now: () => number

  constructor(runRoots: string[], options: ReviewInboxOptions = {}) {
    this.runRoots = [...runRoots]
    this.now = options.now ?? Date.now
    for (const policy of options.automaticReviewExpiry ?? []) {
      if (policy.skillName.trim() === ''
        || !Number.isSafeInteger(policy.maxPendingReviewMs)
        || policy.maxPendingReviewMs < 1
        || policy.maxPendingReviewMs > MAX_PENDING_REVIEW_MS
        || this.automaticReviewExpiry.has(policy.skillName)) {
        throw new Error('automatic review expiry policies must have unique Skills and positive bounded ages')
      }
      this.automaticReviewExpiry.set(policy.skillName, policy.maxPendingReviewMs)
    }
  }

  async scan(): Promise<ReviewScan> {
    return this.scanCandidates(true)
  }

  async automaticInflightStatus(
    skillName: string,
    _signalId: string,
  ): Promise<AutomaticEvolutionInflightStatus> {
    let scan = await this.scan()
    if (scan.warnings.length > 0) return 'unknown'
    const maxPendingReviewMs = this.automaticReviewExpiry.get(skillName)
    if (maxPendingReviewMs !== undefined) {
      for (const candidate of scan.candidates) {
        if (!this.isExpiredAutomaticReview(candidate, skillName)) continue
        const hours = Math.floor(maxPendingReviewMs / (60 * 60 * 1_000))
        await this.enqueue(candidate.id, () => this.rejectNow(
          candidate.id,
          `automatic ambiguous review expired after ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
          'auto-review-expiry-v1',
        ))
      }
      scan = await this.scan()
      if (scan.warnings.length > 0) return 'unknown'
    }
    return scan.candidates.some(candidate => candidate.skillName === skillName) ? 'busy' : 'clear'
  }

  private isExpiredAutomaticReview(
    candidate: ReviewCandidate,
    skillName: string,
  ): boolean {
    return candidate.skillName === skillName
      && candidate.automaticReviewExpiry?.eligible === true
  }

  private projectAutomaticReviewExpiry(
    candidate: ReviewCandidate,
  ): AutomaticReviewExpiryProjection | undefined {
    const maxPendingReviewMs = this.automaticReviewExpiry.get(candidate.skillName)
    if (maxPendingReviewMs === undefined
      || candidate.status !== 'pending'
      || candidate.recommendation !== 'review'
      || candidate.feedbackSignalId === undefined
      || candidate.feedbackLaunchMode !== 'automatic'
      || candidate.completedAt === undefined) return undefined
    const completedAt = Date.parse(candidate.completedAt)
    if (!Number.isFinite(completedAt)) return undefined
    const eligibleAtMs = completedAt + maxPendingReviewMs
    const eligibleAt = new Date(eligibleAtMs)
    if (Number.isNaN(eligibleAt.getTime())) return undefined
    const observedAt = this.now()
    return {
      eligibleAt: eligibleAt.toISOString(),
      eligible: Number.isFinite(observedAt) && observedAt >= eligibleAtMs,
      trigger: 'next-same-skill-automatic-signal',
    }
  }

  /** Include terminal dispositions for crash recovery by trusted host policies. */
  async scanAll(): Promise<ReviewScan> {
    return this.scanCandidates(false)
  }

  private async scanCandidates(pendingOnly: boolean): Promise<ReviewScan> {
    const candidates = new Map<string, ReviewCandidate>()
    const warnings: string[] = []
    for (const requestedRoot of this.runRoots) {
      let root: string
      let entries
      try {
        root = await realpath(requestedRoot)
        entries = await readdir(root, { withFileTypes: true })
        entries.sort((left, right) => left.name.localeCompare(right.name))
      } catch (error) {
        warnings.push(warning(requestedRoot, error))
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const outputDir = join(root, entry.name)
        try {
          const candidate = await this.readCandidate(outputDir)
          const actionable = candidate?.status === 'pending'
            || (candidate?.status === 'approved'
              && candidate.decisionActor === 'auto-clear-instruction-v1'
              && candidate.activatedAt === undefined)
          if (candidate === undefined || (pendingOnly && !actionable)) continue
          const existing = candidates.get(candidate.id)
          if (existing !== undefined && existing.evidenceHash !== candidate.evidenceHash) {
            throw new Error(`duplicate review id '${candidate.id}' has different evidence`)
          }
          candidates.set(candidate.id, existing ?? candidate)
        } catch (error) {
          if (!isMissingRunState(error)) warnings.push(warning(entry.name, error))
        }
      }
    }
    return {
      candidates: [...candidates.values()].sort((left, right) =>
        left.startedAt === right.startedAt
          ? left.id.localeCompare(right.id)
          : left.startedAt.localeCompare(right.startedAt)),
      warnings,
    }
  }

  async get(id: string): Promise<ReviewCandidate> {
    assertReviewId(id)
    return this.findCandidate(id)
  }

  async reject(id: string, note: string): Promise<ReviewCandidate> {
    return this.enqueue(id, () => this.rejectNow(id, note, 'human'))
  }

  private async rejectNow(
    id: string,
    note: string,
    actor: Extract<ReviewDecisionActor, 'human' | 'auto-review-expiry-v1'>,
  ): Promise<ReviewCandidate> {
    assertReviewId(id)
    const normalizedNote = note.trim()
    if (normalizedNote.length === 0 || normalizedNote.length > 500) {
      throw new Error('review decision note must be 1-500 characters')
    }
    const candidate = await this.findCandidate(id)
    if (candidate.status === 'approved') throw new Error('approved Candidate cannot be rejected')
    if (candidate.status === 'rejected') return candidate
    const disposition: ReviewDisposition = {
      schemaVersion: 1,
      reviewId: candidate.id,
      evidenceHash: candidate.evidenceHash,
      status: 'rejected',
      actor,
      decidedAt: new Date(this.now()).toISOString(),
      decisionNote: normalizedNote,
    }
    await writeDurableJson(join(candidate.outputDir, 'review-state.json'), disposition)
    return {
      ...candidate,
      status: 'rejected',
      decisionActor: actor,
      decisionNote: normalizedNote,
    }
  }

  approve(
    id: string,
    note: string,
    publish: (candidate: ReviewCandidate) => Promise<{ id: string }>,
    options: { actor?: 'human' | 'auto-clear-instruction-v1' } = {},
  ): Promise<ReviewCandidate> {
    return this.enqueue(id, () => this.approveNow(id, note, publish, options))
  }

  private async approveNow(
    id: string,
    note: string,
    publish: (candidate: ReviewCandidate) => Promise<{ id: string }>,
    options: { actor?: 'human' | 'auto-clear-instruction-v1' },
  ): Promise<ReviewCandidate> {
    assertReviewId(id)
    const normalizedNote = note.trim()
    if (normalizedNote.length === 0 || normalizedNote.length > 500) {
      throw new Error('review decision note must be 1-500 characters')
    }
    const candidate = await this.findCandidate(id)
    if (candidate.status === 'rejected') throw new Error('rejected Candidate cannot be approved')
    if (candidate.status === 'approved') return candidate
    const generation = await publish(candidate)
    if (!hashPattern.test(generation.id)) throw new Error('publisher returned an invalid Generation id')
    const disposition: ReviewDisposition = {
      schemaVersion: 1,
      reviewId: candidate.id,
      evidenceHash: candidate.evidenceHash,
      status: 'approved',
      actor: options.actor ?? 'human',
      decidedAt: new Date().toISOString(),
      decisionNote: normalizedNote,
      generationId: generation.id,
    }
    await writeDurableJson(join(candidate.outputDir, 'review-state.json'), disposition)
    return {
      ...candidate,
      status: 'approved',
      decisionActor: options.actor ?? 'human',
      decisionNote: normalizedNote,
      generationId: generation.id,
    }
  }

  markAutomaticActivated(id: string, generationId: string): Promise<ReviewCandidate> {
    return this.enqueue(id, () => this.markAutomaticActivatedNow(id, generationId))
  }

  private async markAutomaticActivatedNow(
    id: string,
    generationId: string,
  ): Promise<ReviewCandidate> {
    assertReviewId(id)
    if (!hashPattern.test(generationId)) throw new Error('activation requires a full Generation id')
    const candidate = await this.findCandidate(id)
    if (candidate.status !== 'approved'
      || candidate.decisionActor !== 'auto-clear-instruction-v1'
      || candidate.generationId !== generationId) {
      throw new Error('only the exact automatic approval can be marked activated')
    }
    if (candidate.activatedAt !== undefined) return candidate
    const disposition = await readDisposition(candidate.outputDir)
    if (disposition === undefined) throw new Error('automatic approval disposition is missing')
    const activatedAt = new Date().toISOString()
    await writeDurableJson(join(candidate.outputDir, 'review-state.json'), {
      ...disposition,
      activatedAt,
    })
    return { ...candidate, activatedAt }
  }

  private async findCandidate(id: string): Promise<ReviewCandidate> {
    for (const requestedRoot of this.runRoots) {
      let root: string
      let entries
      try {
        root = await realpath(requestedRoot)
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = await this.readCandidate(join(root, entry.name)).catch(() => undefined)
        if (candidate?.id === id) return candidate
      }
    }
    throw new Error(`review Candidate '${id}' does not exist`)
  }

  private async readCandidate(outputDir: string): Promise<ReviewCandidate | undefined> {
    const stateInfo = await lstat(join(outputDir, 'run-state.json'))
    if (!stateInfo.isFile() || stateInfo.isSymbolicLink()) {
      throw new Error('run-state.json must be a regular owned file')
    }
    const state = await loadShadowRunState(outputDir)
    if (state.phase !== 'complete' || state.outcome?.kind !== 'complete') return undefined
    if (state.proposal === undefined || state.proposalHash === undefined || state.modelUsage === undefined) {
      throw new Error('complete Shadow run has no durable Candidate evidence')
    }
    if (sha256(JSON.stringify(state.proposal)) !== state.proposalHash) {
      throw new Error('durable Candidate proposal does not match its recorded hash')
    }
    const requestedReport = join(outputDir, 'report.json')
    const reportInfo = await lstat(requestedReport)
    if (!reportInfo.isFile() || reportInfo.isSymbolicLink()) {
      throw new Error('terminal Shadow report must be a regular owned file')
    }
    const expectedReport = await realpath(requestedReport)
    const actualReport = await realpath(state.outcome.reportPath)
    if (expectedReport !== actualReport) throw new Error('terminal report path escapes its Shadow run')
    const report = parseReport(JSON.parse(await readFile(expectedReport, 'utf8')))
    if (report.runId !== state.runId
      || report.skillName !== state.identity.skillName
      || report.baseTreeHash !== state.identity.baseTreeHash
      || report.claim !== state.proposal.claim
      || report.evaluatorVersion !== state.identity.evaluatorVersion) {
      throw new Error('Shadow report does not match its durable run identity')
    }
    const proposalPaths = state.proposal.files.map(file => file.path)
    if (JSON.stringify(report.changedFiles) !== JSON.stringify(proposalPaths)) {
      throw new Error('Shadow report changed files do not match its durable proposal')
    }
    if (report.recommendation === 'reject') return undefined
    const evidence = {
      runId: state.runId,
      proposalHash: state.proposalHash,
      candidateTreeHash: report.candidateTreeHash,
      recommendation: report.recommendation,
      reasons: report.reasons,
      limitations: report.limitations,
      cases: report.cases,
      compositionFingerprint: report.compositionFingerprint,
      compositionStable: report.compositionStable,
    }
    const evidenceHash = sha256(JSON.stringify(evidence))
    const id = sha256(JSON.stringify({ runId: state.runId, proposalHash: state.proposalHash }))
    const disposition = await readDisposition(outputDir)
    if (disposition !== undefined
      && (disposition.reviewId !== id || disposition.evidenceHash !== evidenceHash)) {
      throw new Error('review-state.json does not match its Candidate evidence')
    }
    const candidate: ReviewCandidate = {
      id,
      runId: state.runId,
      status: disposition?.status ?? 'pending',
      outputDir,
      skillName: state.identity.skillName,
      recommendation: report.recommendation,
      claim: report.claim,
      changedFiles: report.changedFiles,
      candidateTreeHash: report.candidateTreeHash,
      baseTreeHash: report.baseTreeHash,
      proposalHash: state.proposalHash,
      proposal: state.proposal,
      cases: report.cases,
      cost: {
        inputTokens: state.modelUsage.inputTokens,
        outputTokens: state.modelUsage.outputTokens,
        trialCount: report.trialCount,
      },
      reasons: report.reasons,
      limitations: report.limitations,
      evaluatorVersion: report.evaluatorVersion,
      compositionFingerprint: report.compositionFingerprint,
      compositionStable: report.compositionStable,
      startedAt: state.startedAt,
      completedAt: state.updatedAt,
      ...(state.feedbackSignalId === undefined
        ? {}
        : { feedbackSignalId: state.feedbackSignalId }),
      ...(state.feedbackLaunchMode === undefined
        ? {}
        : { feedbackLaunchMode: state.feedbackLaunchMode }),
      evidenceHash,
      ...disposition === undefined
        ? {}
        : { decisionActor: disposition.actor ?? 'human' },
      ...disposition?.decisionNote === undefined ? {} : { decisionNote: disposition.decisionNote },
      ...disposition?.generationId === undefined ? {} : { generationId: disposition.generationId },
      ...disposition?.activatedAt === undefined ? {} : { activatedAt: disposition.activatedAt },
    }
    const automaticReviewExpiry = this.projectAutomaticReviewExpiry(candidate)
    return {
      ...candidate,
      ...(automaticReviewExpiry === undefined ? {} : { automaticReviewExpiry }),
    }
  }

  private enqueue<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.actionTails.get(id) ?? Promise.resolve()
    const result = previous.then(action)
    const tail = result.then(() => {}, () => {})
    this.actionTails.set(id, tail)
    void tail.finally(() => {
      if (this.actionTails.get(id) === tail) this.actionTails.delete(id)
    })
    return result
  }
}

function parseReport(value: unknown): {
  runId: string
  skillName: string
  baseTreeHash: string
  candidateTreeHash: string
  claim: string
  changedFiles: string[]
  recommendation: 'promote' | 'review' | 'reject'
  reasons: string[]
  limitations: string[]
  cases: ReviewCaseSummary[]
  trialCount: number
  evaluatorVersion: string
  compositionFingerprint: string
  compositionStable: boolean
} {
  if (!isRecord(value) || value.schemaVersion !== 1
    || !isRecord(value.run) || typeof value.run.id !== 'string'
    || !isRecord(value.subject) || typeof value.subject.skillName !== 'string'
    || typeof value.subject.baseTreeHash !== 'string'
    || !isRecord(value.candidate) || typeof value.candidate.treeHash !== 'string'
    || typeof value.candidate.claim !== 'string' || !Array.isArray(value.candidate.changedFiles)
    || !isRecord(value.decision) || !['promote', 'review', 'reject'].includes(String(value.decision.recommendation))
    || !Array.isArray(value.decision.reasons) || !Array.isArray(value.decision.limitations)
    || !Array.isArray(value.cases) || !isRecord(value.trial)
    || !Number.isSafeInteger(value.trial.count) || !isRecord(value.epoch)
    || typeof value.epoch.evaluatorVersion !== 'string' || !isRecord(value.composition)
    || !hashPattern.test(String(value.composition.candidateFingerprint))
    || (value.composition.stable !== undefined && typeof value.composition.stable !== 'boolean')) {
    throw new Error('Shadow report has an invalid review shape')
  }
  const changedFiles = value.candidate.changedFiles
  if (!changedFiles.every(path => typeof path === 'string' && isOwnedRelativePath(path))) {
    throw new Error('Shadow report has an invalid changed-file path')
  }
  const reasons = stringArray(value.decision.reasons, 'reasons')
  const limitations = stringArray(value.decision.limitations, 'limitations')
  if (value.composition.stable === true
    && (!hashPattern.test(String(value.composition.baselineFingerprint))
      || value.composition.baselineFingerprint !== value.composition.candidateFingerprint)) {
    throw new Error('stable Shadow composition has no matching exact baseline fingerprint')
  }
  const cases = value.cases.map((item): ReviewCaseSummary => {
    if (!isRecord(item) || typeof item.id !== 'string'
      || !['pass', 'fail', 'incomplete'].includes(String(item.baseline))
      || !['pass', 'fail', 'incomplete'].includes(String(item.candidate))
      || !Array.isArray(item.checks)) {
      throw new Error('Shadow report has an invalid review case')
    }
    const checks = item.checks
    if (!checks.every(check => isRecord(check) && typeof check.passed === 'boolean')) {
      throw new Error('Shadow report has an invalid review check')
    }
    return {
      id: item.id,
      baseline: item.baseline as ReviewCaseSummary['baseline'],
      candidate: item.candidate as ReviewCaseSummary['candidate'],
      passedChecks: checks.filter(check => (check as { passed: boolean }).passed).length,
      totalChecks: checks.length,
    }
  })
  return {
    runId: value.run.id,
    skillName: value.subject.skillName,
    baseTreeHash: value.subject.baseTreeHash,
    candidateTreeHash: value.candidate.treeHash,
    claim: value.candidate.claim,
    changedFiles: changedFiles as string[],
    recommendation: value.decision.recommendation as 'promote' | 'review' | 'reject',
    reasons,
    limitations,
    cases,
    trialCount: value.trial.count as number,
    evaluatorVersion: value.epoch.evaluatorVersion,
    compositionFingerprint: String(value.composition.candidateFingerprint),
    compositionStable: value.composition.stable === true,
  }
}

async function readDisposition(outputDir: string): Promise<ReviewDisposition | undefined> {
  try {
    const path = join(outputDir, 'review-state.json')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('review-state.json must be a regular owned file')
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isRecord(value) || value.schemaVersion !== 1 || !hashPattern.test(String(value.reviewId))
      || !hashPattern.test(String(value.evidenceHash)) || !['approved', 'rejected'].includes(String(value.status))
      || typeof value.decidedAt !== 'string'
      || (value.actor !== undefined
        && !['human', 'auto-clear-instruction-v1', 'auto-review-expiry-v1'].includes(String(value.actor)))
      || (value.decisionNote !== undefined && typeof value.decisionNote !== 'string')
      || (value.generationId !== undefined && !hashPattern.test(String(value.generationId)))
      || (value.activatedAt !== undefined && typeof value.activatedAt !== 'string')) {
      throw new Error('review-state.json has an invalid shape')
    }
    if ((value.status === 'approved') !== (value.generationId !== undefined)
      || (value.actor === 'auto-clear-instruction-v1' && value.status !== 'approved')
      || (value.actor === 'auto-review-expiry-v1' && value.status !== 'rejected')
      || (value.activatedAt !== undefined && value.actor !== 'auto-clear-instruction-v1')) {
      throw new Error('review-state.json has an invalid terminal disposition')
    }
    return value as unknown as ReviewDisposition
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function assertReviewId(id: string): void {
  if (!hashPattern.test(id)) throw new Error('review action requires the full 64-character review id')
}

function stringArray(value: unknown[], label: string): string[] {
  if (!value.every(item => typeof item === 'string')) {
    throw new Error(`Shadow report has invalid ${label}`)
  }
  return value as string[]
}

function isOwnedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || isAbsolute(path)) return false
  const fromRoot = relative('.', path)
  return fromRoot !== '..' && !fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function warning(path: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${basename(path)}: ${message.replaceAll(/[\r\n]+/g, ' ')}`.slice(0, 500)
}

function isMissingRunState(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const cause = error.cause
  return isRecord(cause) && cause.code === 'ENOENT'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
