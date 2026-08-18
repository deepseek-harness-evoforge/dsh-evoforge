import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { hashTree } from './hash.ts'
import { parseCasePackManifest } from './shadow.ts'
import { acquireShadowRunLock, writeDurableJson } from './shadow-run-state.ts'
import type {
  DiscoveredSkillCandidate,
  MaterializedSkillCandidate,
} from './trusted-skill-discovery.ts'
import { runPairedTrial, type PairedTrialResult } from './trial.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 100
const INSTRUCTION_FILE = /(?:^SKILL\.md$|\.(?:json|md|txt|ya?ml)$)/iu

export interface DiscoveredSkillAdmissionTargetConfig {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly baselineDir: string
  readonly baselineHash: string
  readonly casePackDir: string
  readonly casePackHash: string
  readonly runRoot: string
}

export type DiscoveredSkillAdmissionReason =
  | 'no-exact-evaluation-target'
  | 'candidate-has-executable-content'
  | 'candidate-is-not-instruction-only'
  | 'baseline-identity-mismatch'
  | 'case-pack-identity-mismatch'
  | 'assembled-evaluator-not-governance-separated'
  | 'case-pack-calibration-failed'
  | 'candidate-failed-admission'
  | 'baseline-already-passes'
  | 'candidate-improves-deterministic-admission'
  | 'governance-input-mutated'
  | 'governance-roots-overlap'
  | 'evaluation-failed'

export interface DiscoveredSkillAdmissionResult {
  readonly schemaVersion: 1
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: 'abstained' | 'protected' | 'incomplete' | 'rejected' | 'review' | 'qualified-for-shadow'
  readonly reasons: readonly DiscoveredSkillAdmissionReason[]
  readonly targetId?: string
  readonly releaseAuthority: 'none'
  readonly evidence?: {
    readonly baseline: 'pass' | 'fail'
    readonly candidate: 'pass' | 'fail'
    readonly calibrationPassed: boolean
    readonly candidateExecuted: false
    readonly evaluatorClass: 'deterministic-filesystem'
    readonly trialCount: 4
  }
}

export interface DiscoveredSkillAdmissionScan {
  readonly configuredTargetCount: number
  readonly warningCount: number
  readonly results: readonly DiscoveredSkillAdmissionResult[]
}

interface ResolvedTarget extends DiscoveredSkillAdmissionTargetConfig {
  readonly baselineDir: string
  readonly casePackDir: string
  readonly runRoot: string
}

interface CandidateMaterializer {
  materialize(candidate: DiscoveredSkillCandidate, outputDir: string): Promise<MaterializedSkillCandidate>
}

interface CandidateReader {
  listCandidates(workspaceId?: string): DiscoveredSkillCandidate[]
}

type TrialRunner = typeof runPairedTrial

/**
 * Deterministic pre-admission only. Candidate files are never executed and an
 * assembled/model evaluator is refused; a win can request later Shadow review
 * but can never publish or activate a Skill.
 */
export class DiscoveredSkillAdmission {
  private readonly targets = new Map<string, ResolvedTarget>()
  private readonly targetsById = new Map<string, ResolvedTarget>()
  private readonly materializer: CandidateMaterializer
  private readonly runTrial: TrialRunner

  constructor(
    targets: readonly DiscoveredSkillAdmissionTargetConfig[],
    materializer: CandidateMaterializer,
    options: { runTrial?: TrialRunner } = {},
  ) {
    if (targets.length > MAX_TARGETS) throw new Error(`Skill admission supports at most ${MAX_TARGETS} targets`)
    for (const input of targets) {
      assertTarget(input)
      const key = targetKey(input.workspaceId, input.skill)
      if (this.targets.has(key)) {
        throw new Error(`duplicate Skill admission target for '${input.skill}' in Workspace '${input.workspaceId}'`)
      }
      if (this.targetsById.has(input.id)) throw new Error(`duplicate Skill admission target '${input.id}'`)
      const target = Object.freeze({
        ...input,
        baselineDir: resolve(input.baselineDir),
        casePackDir: resolve(input.casePackDir),
        runRoot: resolve(input.runRoot),
      })
      this.targets.set(key, target)
      this.targetsById.set(input.id, target)
    }
    this.materializer = materializer
    this.runTrial = options.runTrial ?? runPairedTrial
  }

  /** Jobs are created only when governance configured this exact Workspace+Skill pair. */
  matches(candidate: Pick<DiscoveredSkillCandidate, 'workspaceId' | 'requestedSkill'>): boolean {
    return this.targets.has(targetKey(candidate.workspaceId, candidate.requestedSkill))
  }

  async evaluate(
    candidate: DiscoveredSkillCandidate,
    options: { signal?: AbortSignal } = {},
  ): Promise<DiscoveredSkillAdmissionResult> {
    options.signal?.throwIfAborted()
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined) {
      return result(candidate, 'abstained', ['no-exact-evaluation-target'])
    }

    const id = admissionId(candidate, target)
    const prepared = {
      schemaVersion: 1,
      id,
      candidateId: candidate.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.requestedSkill,
      targetId: target.id,
      baselineHash: target.baselineHash,
      casePackHash: target.casePackHash,
    } as const

    let baselineDir: string
    let casePackDir: string
    let runRoot: string
    try {
      [baselineDir, casePackDir, runRoot] = await Promise.all([
        realpath(target.baselineDir),
        realpath(target.casePackDir),
        realpath(target.runRoot),
      ])
    } catch {
      return result(candidate, 'incomplete', ['evaluation-failed'], target.id, id)
    }
    if (!separateRoots(runRoot, baselineDir)
      || !separateRoots(runRoot, casePackDir)
      || !separateRoots(baselineDir, casePackDir)) {
      return result(candidate, 'incomplete', ['governance-roots-overlap'], target.id, id)
    }

    const outputDir = join(runRoot, id)
    const candidateDir = join(outputDir, 'candidate')
    const trialDir = join(outputDir, 'trial')
    const existing = await readExistingResult(outputDir, prepared)
    if (existing !== undefined) return existing
    if (!await prepareOutput(outputDir, prepared)) {
      return result(candidate, 'incomplete', ['evaluation-failed'], target.id, id)
    }
    const releaseLock = await acquireShadowRunLock(outputDir)
    try {
      const afterLock = await readExistingResult(outputDir, prepared)
      if (afterLock !== undefined) return afterLock
      if (candidate.permissions.executableContent || candidate.package.hasScripts) {
        return await finish(outputDir, result(
          candidate,
          'protected',
          ['candidate-has-executable-content'],
          target.id,
          id,
        ))
      }
      let baselineHash: string
      let casePackHash: string
      try {
        [baselineHash, casePackHash] = await Promise.all([
          hashTree(baselineDir),
          hashTree(casePackDir),
        ])
      } catch {
        return await finish(outputDir, result(
          candidate, 'incomplete', ['evaluation-failed'], target.id, id,
        ))
      }
      if (baselineHash !== target.baselineHash) {
        return await finish(outputDir, result(
          candidate, 'incomplete', ['baseline-identity-mismatch'], target.id, id,
        ))
      }
      if (casePackHash !== target.casePackHash) {
        return await finish(outputDir, result(
          candidate, 'incomplete', ['case-pack-identity-mismatch'], target.id, id,
        ))
      }
      let manifest
      try {
        manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
      } catch {
        return await finish(outputDir, result(
          candidate, 'incomplete', ['evaluation-failed'], target.id, id,
        ))
      }
      if (manifest.workspaceId !== candidate.workspaceId
        || manifest.trial === undefined
        || manifest.calibration === undefined) {
        return await finish(outputDir, result(
          candidate, 'incomplete', ['evaluation-failed'], target.id, id,
        ))
      }
      if (manifest.trial.dshAssembled === true) {
        return await finish(outputDir, result(
          candidate,
          'incomplete',
          ['assembled-evaluator-not-governance-separated'],
          target.id,
          id,
        ))
      }
      await rm(candidateDir, { force: true, recursive: true })
      await rm(trialDir, { force: true, recursive: true })
      await mkdir(trialDir, { mode: 0o700 })

      let materialized: MaterializedSkillCandidate
      try {
        materialized = await this.materializer.materialize(candidate, candidateDir)
      } catch {
        return await finish(outputDir, result(candidate, 'incomplete', ['evaluation-failed'], target.id, id))
      }
      if (materialized.candidateId !== candidate.id
        || materialized.contentHash !== candidate.contentHash
        || materialized.treeHash !== candidate.version.treeHash
        || await realpath(materialized.path) !== await realpath(candidateDir)) {
        return await finish(outputDir, result(candidate, 'incomplete', ['evaluation-failed'], target.id, id))
      }
      if (materialized.files.some(file => file.mode !== '100644'
        || !isOwnedRelativePath(file.path)
        || !INSTRUCTION_FILE.test(file.path))) {
        return await finish(outputDir, result(
          candidate,
          'protected',
          ['candidate-is-not-instruction-only'],
          target.id,
          id,
        ))
      }

      let paired: PairedTrialResult
      try {
        paired = await this.runTrial({
          calibration: manifest.calibration,
          casePackDir,
          candidateSkillDir: materialized.path,
          dshRevision: manifest.epoch.dshRevision,
          outputDir: trialDir,
          ...options.signal === undefined ? {} : { signal: options.signal },
          skillDir: baselineDir,
          trial: manifest.trial,
          trialLimit: manifest.budget.trialLimit,
        })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        return await finish(outputDir, result(candidate, 'incomplete', ['evaluation-failed'], target.id, id))
      }
      if (await hashTree(baselineDir) !== target.baselineHash
        || await hashTree(casePackDir) !== target.casePackHash) {
        return await finish(outputDir, result(
          candidate,
          'incomplete',
          ['governance-input-mutated'],
          target.id,
          id,
        ))
      }
      if (paired.assembled) {
        return await finish(outputDir, result(
          candidate,
          'incomplete',
          ['assembled-evaluator-not-governance-separated'],
          target.id,
          id,
        ))
      }
      const calibrationPassed = paired.calibration.every(row => row.passed)
      const evidence: NonNullable<DiscoveredSkillAdmissionResult['evidence']> = {
        baseline: paired.baseline.passed ? 'pass' : 'fail',
        candidate: paired.candidate.passed ? 'pass' : 'fail',
        calibrationPassed,
        candidateExecuted: false,
        evaluatorClass: 'deterministic-filesystem',
        trialCount: 4,
      }
      if (!calibrationPassed) {
        return await finish(outputDir, result(
          candidate, 'rejected', ['case-pack-calibration-failed'], target.id, id, evidence,
        ))
      }
      if (!paired.candidate.passed) {
        return await finish(outputDir, result(
          candidate, 'rejected', ['candidate-failed-admission'], target.id, id, evidence,
        ))
      }
      if (paired.baseline.passed) {
        return await finish(outputDir, result(
          candidate, 'review', ['baseline-already-passes'], target.id, id, evidence,
        ))
      }
      return await finish(outputDir, result(
        candidate,
        'qualified-for-shadow',
        ['candidate-improves-deterministic-admission'],
        target.id,
        id,
        evidence,
      ))
    } finally {
      await releaseLock()
    }
  }

  async scan(workspaceId?: string): Promise<DiscoveredSkillAdmissionScan> {
    const results = new Map<string, DiscoveredSkillAdmissionResult>()
    let warningCount = 0
    for (const target of this.targetsById.values()) {
      if (workspaceId !== undefined && target.workspaceId !== workspaceId) continue
      let runRoot: string
      let entries
      try {
        runRoot = await realpath(target.runRoot)
        entries = await readdir(runRoot, { withFileTypes: true })
      } catch {
        warningCount += 1
        continue
      }
      if (entries.length > 1_000) warningCount += 1
      for (const entry of entries.slice(0, 1_000)) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const outputDir = join(runRoot, entry.name)
          const prepared = await readPreparedState(outputDir)
          if (prepared.id !== entry.name
            || prepared.targetId !== target.id
            || prepared.workspaceId !== target.workspaceId
            || prepared.skillName !== target.skill
            || prepared.baselineHash !== target.baselineHash
            || prepared.casePackHash !== target.casePackHash
            || prepared.id !== admissionIdentityId(prepared.candidateId, target)) {
            warningCount += 1
            continue
          }
          const value = await readExistingResult(outputDir, prepared)
          if (value !== undefined) {
            results.set(value.id, value)
          } else {
            try {
              await lstat(join(outputDir, 'admission-result.json'))
              warningCount += 1
            } catch (error) {
              if (!isRecord(error) || error.code !== 'ENOENT') warningCount += 1
            }
          }
        } catch {
          warningCount += 1
        }
      }
    }
    return {
      configuredTargetCount: [...this.targetsById.values()]
        .filter(target => workspaceId === undefined || target.workspaceId === workspaceId).length,
      warningCount,
      results: [...results.values()].sort((left, right) => left.id.localeCompare(right.id)),
    }
  }
}

/** Native Jobs bridge; durable Candidates remain the restart queue and reports remain idempotent. */
export class DiscoveredSkillAdmissionScheduler {
  private readonly admission: Pick<DiscoveredSkillAdmission, 'evaluate' | 'matches'>
  private readonly candidates: CandidateReader
  private readonly pending = new Map<string, DiscoveredSkillCandidate>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    admission: Pick<DiscoveredSkillAdmission, 'evaluate' | 'matches'>,
    candidates: CandidateReader,
  ) {
    this.admission = admission
    this.candidates = candidates
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('Skill admission Jobs seam is already attached')
    this.jobs = jobs
    for (const candidate of this.candidates.listCandidates()) this.observe(candidate)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(candidate: DiscoveredSkillCandidate): void {
    if (!this.admission.matches(candidate) || this.active.has(candidate.id)) return
    this.pending.set(candidate.id, candidate)
    this.schedule(candidate.id)
  }

  private schedule(candidateId: string): void {
    const jobs = this.jobs
    const candidate = this.pending.get(candidateId)
    if (jobs === undefined || candidate === undefined || this.active.has(candidateId)) return
    this.pending.delete(candidateId)
    this.active.add(candidateId)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `deterministic Skill admission: ${candidate.requestedSkill}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.admission.evaluate(candidate, { signal: controller.signal })
          return {
            cancel: (reason?: string) => controller.abort(new Error(reason ?? 'Skill admission cancelled')),
            done: task.then(value => ({
              status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
              detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : value.status,
              ...controller.signal.aborted ? {} : { output: admissionOutput(value) },
            }), (error: unknown) => ({
              status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
            })).finally(() => {
              this.active.delete(candidateId)
              this.schedule(candidateId)
            }),
          }
        },
      })
    } catch {
      this.active.delete(candidateId)
      this.pending.set(candidateId, candidate)
    }
  }
}

function result(
  candidate: DiscoveredSkillCandidate,
  status: DiscoveredSkillAdmissionResult['status'],
  reasons: readonly DiscoveredSkillAdmissionReason[],
  targetId?: string,
  id = admissionId(candidate, targetId),
  evidence?: DiscoveredSkillAdmissionResult['evidence'],
): DiscoveredSkillAdmissionResult {
  return Object.freeze({
    schemaVersion: 1,
    id,
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.requestedSkill,
    status,
    reasons: Object.freeze([...reasons]),
    ...(targetId === undefined ? {} : { targetId }),
    releaseAuthority: 'none',
    ...(evidence === undefined ? {} : { evidence: Object.freeze({ ...evidence }) }),
  })
}

function admissionId(
  candidate: DiscoveredSkillCandidate,
  target: Pick<ResolvedTarget, 'id' | 'baselineHash' | 'casePackHash'> | string | undefined,
): string {
  if (typeof target === 'object') return admissionIdentityId(candidate.id, target)
  const identity = [target ?? 'no-target']
  return createHash('sha256').update(JSON.stringify([
    'deterministic-skill-admission-v1',
    candidate.id,
    ...identity,
  ])).digest('hex')
}

function admissionIdentityId(
  candidateId: string,
  target: Pick<ResolvedTarget, 'id' | 'baselineHash' | 'casePackHash'>,
): string {
  return createHash('sha256').update(JSON.stringify([
    'deterministic-skill-admission-v1',
    candidateId,
    target.id,
    target.baselineHash,
    target.casePackHash,
  ])).digest('hex')
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
}

function assertTarget(target: DiscoveredSkillAdmissionTargetConfig): void {
  if (!PUBLIC_ID.test(target.id) || !PUBLIC_ID.test(target.skill)) {
    throw new Error(`invalid Skill admission target '${target.id}'`)
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(target.workspaceId)) {
    throw new Error(`Skill admission target '${target.id}' has an invalid Workspace id`)
  }
  if (!CONTENT_ID.test(target.baselineHash) || !CONTENT_ID.test(target.casePackHash)) {
    throw new Error(`Skill admission target '${target.id}' requires exact content hashes`)
  }
  if (!isAbsolute(target.baselineDir)
    || !isAbsolute(target.casePackDir)
    || !isAbsolute(target.runRoot)) {
    throw new Error(`Skill admission target '${target.id}' paths must be absolute`)
  }
  if (dirname(resolve(target.runRoot)) === resolve(target.runRoot)) {
    throw new Error(`Skill admission target '${target.id}' run root must not be a filesystem root`)
  }
}

interface AdmissionPreparedState {
  readonly schemaVersion: 1
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly targetId: string
  readonly baselineHash: string
  readonly casePackHash: string
}

async function prepareOutput(outputDir: string, expected: AdmissionPreparedState): Promise<boolean> {
  try {
    await mkdir(outputDir, { mode: 0o700 })
    await writeDurableJson(join(outputDir, 'admission-state.json'), expected)
    return true
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') return false
    try {
      const stats = await lstat(outputDir)
      if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(outputDir) !== outputDir) return false
    } catch {
      return false
    }
    return await readPrepared(outputDir, expected)
  }
}

async function readPrepared(outputDir: string, expected: AdmissionPreparedState): Promise<boolean> {
  try {
    return JSON.stringify(await readPreparedState(outputDir)) === JSON.stringify(expected)
  } catch {
    return false
  }
}

async function readPreparedState(outputDir: string): Promise<AdmissionPreparedState> {
  const actual = JSON.parse(await readFile(join(outputDir, 'admission-state.json'), 'utf8')) as unknown
  if (!isRecord(actual)
    || actual.schemaVersion !== 1
    || typeof actual.id !== 'string'
    || !CONTENT_ID.test(actual.id)
    || typeof actual.candidateId !== 'string'
    || !CONTENT_ID.test(actual.candidateId)
    || typeof actual.workspaceId !== 'string'
    || typeof actual.skillName !== 'string'
    || typeof actual.targetId !== 'string'
    || typeof actual.baselineHash !== 'string'
    || !CONTENT_ID.test(actual.baselineHash)
    || typeof actual.casePackHash !== 'string'
    || !CONTENT_ID.test(actual.casePackHash)) {
    throw new Error('Skill admission state has an invalid shape')
  }
  return actual as unknown as AdmissionPreparedState
}

async function readExistingResult(
  outputDir: string,
  expected: AdmissionPreparedState,
): Promise<DiscoveredSkillAdmissionResult | undefined> {
  if (!await readPrepared(outputDir, expected)) return undefined
  try {
    const value = JSON.parse(await readFile(join(outputDir, 'admission-result.json'), 'utf8')) as unknown
    return isAdmissionResult(value)
      && value.id === expected.id
      && value.candidateId === expected.candidateId
      && value.workspaceId === expected.workspaceId
      && value.skillName === expected.skillName
      && value.targetId === expected.targetId
      ? Object.freeze(structuredClone(value))
      : undefined
  } catch {
    return undefined
  }
}

async function finish(
  outputDir: string,
  value: DiscoveredSkillAdmissionResult,
): Promise<DiscoveredSkillAdmissionResult> {
  await writeDurableJson(join(outputDir, 'admission-result.json'), value)
  return value
}

function isAdmissionResult(value: unknown): value is DiscoveredSkillAdmissionResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.id !== 'string'
    || typeof value.candidateId !== 'string'
    || typeof value.workspaceId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value.workspaceId)
    || typeof value.skillName !== 'string'
    || !PUBLIC_ID.test(value.skillName)
    || !CONTENT_ID.test(value.id)
    || !CONTENT_ID.test(value.candidateId)
    || !Array.isArray(value.reasons)
    || value.reasons.some(reason => typeof reason !== 'string' || !ADMISSION_REASONS.has(reason))
    || (value.targetId !== undefined && (typeof value.targetId !== 'string' || !PUBLIC_ID.test(value.targetId)))
    || value.releaseAuthority !== 'none') return false
  if (!ADMISSION_STATUSES.has(String(value.status))) return false
  const evidenceValid = value.evidence !== undefined
    && isRecord(value.evidence)
    && ['pass', 'fail'].includes(String(value.evidence.baseline))
    && ['pass', 'fail'].includes(String(value.evidence.candidate))
    && typeof value.evidence.calibrationPassed === 'boolean'
    && value.evidence.candidateExecuted === false
    && value.evidence.evaluatorClass === 'deterministic-filesystem'
    && value.evidence.trialCount === 4
  const evidence = evidenceValid ? value.evidence as Record<string, unknown> : undefined
  const targetBound = typeof value.targetId === 'string'
  const reasons = value.reasons as string[]
  const hasReason = (reason: DiscoveredSkillAdmissionReason): boolean =>
    reasons.length === 1 && reasons[0] === reason
  switch (value.status) {
    case 'abstained':
      return !targetBound && value.evidence === undefined && hasReason('no-exact-evaluation-target')
    case 'protected':
      return targetBound && value.evidence === undefined
        && (hasReason('candidate-has-executable-content')
          || hasReason('candidate-is-not-instruction-only'))
    case 'incomplete':
      return targetBound && value.evidence === undefined
        && INCOMPLETE_REASONS.has(String(reasons[0]))
        && reasons.length === 1
    case 'rejected':
      return targetBound && evidence !== undefined
        && (hasReason('case-pack-calibration-failed')
          ? evidence.calibrationPassed === false
          : hasReason('candidate-failed-admission')
            && evidence.calibrationPassed === true
            && evidence.candidate === 'fail')
    case 'review':
      return targetBound && evidence !== undefined
        && hasReason('baseline-already-passes')
        && evidence.calibrationPassed === true
        && evidence.baseline === 'pass'
        && evidence.candidate === 'pass'
    case 'qualified-for-shadow':
      return targetBound && evidence !== undefined
        && hasReason('candidate-improves-deterministic-admission')
        && evidence.calibrationPassed === true
        && evidence.baseline === 'fail'
        && evidence.candidate === 'pass'
    default:
      return false
  }
}

function separateRoots(left: string, right: string): boolean {
  return !contains(left, right) && !contains(right, left)
}

function contains(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function isOwnedRelativePath(path: string): boolean {
  return path.length > 0
    && !path.includes('\\')
    && !isAbsolute(path)
    && path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function admissionOutput(value: DiscoveredSkillAdmissionResult): string {
  return JSON.stringify({
    candidateId: value.candidateId,
    status: value.status,
    reasons: value.reasons,
    releaseAuthority: value.releaseAuthority,
  }).slice(0, 2_048)
}

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}

const ADMISSION_STATUSES = new Set([
  'abstained',
  'protected',
  'incomplete',
  'rejected',
  'review',
  'qualified-for-shadow',
])

const ADMISSION_REASONS: ReadonlySet<string> = new Set<DiscoveredSkillAdmissionReason>([
  'no-exact-evaluation-target',
  'candidate-has-executable-content',
  'candidate-is-not-instruction-only',
  'baseline-identity-mismatch',
  'case-pack-identity-mismatch',
  'assembled-evaluator-not-governance-separated',
  'case-pack-calibration-failed',
  'candidate-failed-admission',
  'baseline-already-passes',
  'candidate-improves-deterministic-admission',
  'governance-input-mutated',
  'governance-roots-overlap',
  'evaluation-failed',
])

const INCOMPLETE_REASONS: ReadonlySet<string> = new Set<DiscoveredSkillAdmissionReason>([
  'baseline-identity-mismatch',
  'case-pack-identity-mismatch',
  'assembled-evaluator-not-governance-separated',
  'governance-input-mutated',
  'governance-roots-overlap',
  'evaluation-failed',
])
