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
import type { ResearchSkillHoldoutPassReceipt } from './research-skill-holdout.ts'
import {
  createDiscoveredSkillLineage,
  type DiscoveredSkillLineage,
} from './discovered-skill-lineage.ts'
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
  | 'research-holdout-pass-required'
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
  readonly researchHoldoutResultId?: string
  readonly releaseAuthority: 'none'
  readonly evidence?: {
    readonly baseline: 'pass' | 'fail'
    readonly candidate: 'pass' | 'fail'
    readonly calibrationPassed: boolean
    readonly candidateExecuted: false
    readonly evaluatorClass: 'deterministic-filesystem'
    readonly trialCount: 4
    readonly baselineTreeHash: string
    readonly candidateTreeHash: string
  }
}

export interface QualifiedDiscoveredSkillShadowInput {
  readonly admissionTargetId: string
  readonly baselineDir: string
  readonly candidateDir: string
  readonly admissionCasePackDir: string
  readonly admissionCasePackHash: string
  readonly admissionRunRoot: string
  readonly lineage: DiscoveredSkillLineage
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

  /** Revalidate the exact durable admission evidence before a later Shadow reads its Candidate. */
  async qualifiedShadowInput(
    candidate: DiscoveredSkillCandidate,
    admission: DiscoveredSkillAdmissionResult,
  ): Promise<QualifiedDiscoveredSkillShadowInput> {
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined
      || admission.status !== 'qualified-for-shadow'
      || admission.candidateId !== candidate.id
      || admission.workspaceId !== candidate.workspaceId
      || admission.skillName !== candidate.requestedSkill
      || admission.targetId !== target.id
      || admission.id !== admissionId(candidate, target, admission.researchHoldoutResultId)
      || researchHoldoutBindingRequired(candidate) !== (admission.researchHoldoutResultId !== undefined)
      || admission.evidence === undefined) {
      throw new Error('exact Candidate has no matching qualified admission evidence')
    }
    const [baselineDir, admissionCasePackDir, admissionRunRoot] = await Promise.all([
      realpath(target.baselineDir),
      realpath(target.casePackDir),
      realpath(target.runRoot),
    ])
    const outputDir = join(admissionRunRoot, admission.id)
    const prepared = await readPreparedState(outputDir)
    const stored = await readExistingResult(outputDir, prepared)
    if (stored === undefined || JSON.stringify(stored) !== JSON.stringify(admission)) {
      throw new Error('qualified admission evidence is not the exact durable result')
    }
    const candidateDir = await realpath(join(outputDir, 'candidate'))
    if (candidateDir !== join(outputDir, 'candidate')
      || await hashTree(candidateDir) !== admission.evidence.candidateTreeHash
      || await hashTree(baselineDir) !== target.baselineHash
      || await hashTree(admissionCasePackDir) !== target.casePackHash) {
      throw new Error('qualified admission inputs changed before Shadow handoff')
    }
    return Object.freeze({
      admissionTargetId: target.id,
      baselineDir,
      candidateDir,
      admissionCasePackDir,
      admissionCasePackHash: target.casePackHash,
      admissionRunRoot,
      lineage: createDiscoveredSkillLineage(candidate, admission),
    })
  }

  async evaluate(
    candidate: DiscoveredSkillCandidate,
    options: { signal?: AbortSignal; researchHoldout?: ResearchSkillHoldoutPassReceipt } = {},
  ): Promise<DiscoveredSkillAdmissionResult> {
    options.signal?.throwIfAborted()
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined) {
      return result(candidate, 'abstained', ['no-exact-evaluation-target'])
    }

    const researchHoldoutResultId = exactResearchHoldoutPass(candidate, options.researchHoldout)
    const id = admissionId(candidate, target, researchHoldoutResultId)
    const makeResult = (
      status: DiscoveredSkillAdmissionResult['status'],
      reasons: readonly DiscoveredSkillAdmissionReason[],
      evidence?: DiscoveredSkillAdmissionResult['evidence'],
    ): DiscoveredSkillAdmissionResult => result(
      candidate,
      status,
      reasons,
      target.id,
      id,
      evidence,
      researchHoldoutResultId,
    )
    if (researchHoldoutBindingRequired(candidate)
      ? researchHoldoutResultId === undefined
      : options.researchHoldout !== undefined) {
      return makeResult('incomplete', ['research-holdout-pass-required'])
    }
    const prepared = {
      schemaVersion: 1,
      id,
      candidateId: candidate.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.requestedSkill,
      targetId: target.id,
      baselineHash: target.baselineHash,
      casePackHash: target.casePackHash,
      ...(researchHoldoutResultId === undefined ? {} : { researchHoldoutResultId }),
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
      return makeResult('incomplete', ['evaluation-failed'])
    }
    if (!separateRoots(runRoot, baselineDir)
      || !separateRoots(runRoot, casePackDir)
      || !separateRoots(baselineDir, casePackDir)) {
      return makeResult('incomplete', ['governance-roots-overlap'])
    }

    const outputDir = join(runRoot, id)
    const candidateDir = join(outputDir, 'candidate')
    const trialDir = join(outputDir, 'trial')
    const existing = await readExistingResult(outputDir, prepared)
    if (existing !== undefined) return existing
    if (!await prepareOutput(outputDir, prepared)) {
      return makeResult('incomplete', ['evaluation-failed'])
    }
    const releaseLock = await acquireShadowRunLock(outputDir)
    try {
      const afterLock = await readExistingResult(outputDir, prepared)
      if (afterLock !== undefined) return afterLock
      if (candidate.permissions.executableContent || candidate.package.hasScripts) {
        return await finish(outputDir, makeResult(
          'protected',
          ['candidate-has-executable-content'],
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
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (baselineHash !== target.baselineHash) {
        return await finish(outputDir, makeResult('incomplete', ['baseline-identity-mismatch']))
      }
      if (casePackHash !== target.casePackHash) {
        return await finish(outputDir, makeResult('incomplete', ['case-pack-identity-mismatch']))
      }
      let manifest
      try {
        manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
      } catch {
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (manifest.workspaceId !== candidate.workspaceId
        || manifest.trial === undefined
        || manifest.calibration === undefined) {
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (manifest.trial.dshAssembled === true) {
        return await finish(outputDir, makeResult(
          'incomplete',
          ['assembled-evaluator-not-governance-separated'],
        ))
      }
      await rm(candidateDir, { force: true, recursive: true })
      await rm(trialDir, { force: true, recursive: true })
      await mkdir(trialDir, { mode: 0o700 })

      let materialized: MaterializedSkillCandidate
      try {
        materialized = await this.materializer.materialize(candidate, candidateDir)
      } catch {
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (materialized.candidateId !== candidate.id
        || materialized.contentHash !== candidate.contentHash
        || materialized.treeHash !== candidate.version.treeHash
        || await realpath(materialized.path) !== await realpath(candidateDir)) {
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (candidate.version.kind !== 'git-tree'
        && await hashTree(materialized.path) !== candidate.version.treeHash) {
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (materialized.files.some(file => file.mode !== '100644'
        || !isOwnedRelativePath(file.path)
        || !INSTRUCTION_FILE.test(file.path))) {
        return await finish(outputDir, makeResult(
          'protected',
          ['candidate-is-not-instruction-only'],
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
        return await finish(outputDir, makeResult('incomplete', ['evaluation-failed']))
      }
      if (await hashTree(baselineDir) !== target.baselineHash
        || await hashTree(casePackDir) !== target.casePackHash) {
        return await finish(outputDir, makeResult(
          'incomplete',
          ['governance-input-mutated'],
        ))
      }
      if (paired.assembled) {
        return await finish(outputDir, makeResult(
          'incomplete',
          ['assembled-evaluator-not-governance-separated'],
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
        baselineTreeHash: paired.baseline.treeHash,
        candidateTreeHash: paired.candidate.treeHash,
      }
      if (!calibrationPassed) {
        return await finish(outputDir, makeResult(
          'rejected', ['case-pack-calibration-failed'], evidence,
        ))
      }
      if (!paired.candidate.passed) {
        return await finish(outputDir, makeResult(
          'rejected', ['candidate-failed-admission'], evidence,
        ))
      }
      if (paired.baseline.passed) {
        return await finish(outputDir, makeResult(
          'review', ['baseline-already-passes'], evidence,
        ))
      }
      return await finish(outputDir, makeResult(
        'qualified-for-shadow',
        ['candidate-improves-deterministic-admission'],
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
            || prepared.id !== admissionIdentityId(
              prepared.candidateId,
              target,
              prepared.researchHoldoutResultId,
            )) {
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
  private readonly onResult: ((
    candidate: DiscoveredSkillCandidate,
    result: DiscoveredSkillAdmissionResult,
  ) => void) | undefined
  private readonly pending = new Map<string, {
    readonly candidate: DiscoveredSkillCandidate
    readonly researchHoldout?: ResearchSkillHoldoutPassReceipt
  }>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    admission: Pick<DiscoveredSkillAdmission, 'evaluate' | 'matches'>,
    candidates: CandidateReader,
    options: {
      onResult?: (
        candidate: DiscoveredSkillCandidate,
        result: DiscoveredSkillAdmissionResult,
      ) => void
    } = {},
  ) {
    this.admission = admission
    this.candidates = candidates
    this.onResult = options.onResult
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('Skill admission Jobs seam is already attached')
    this.jobs = jobs
    for (const candidate of this.candidates.listCandidates()) this.observe(candidate)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(
    candidate: DiscoveredSkillCandidate,
    options: { readonly researchHoldout?: ResearchSkillHoldoutPassReceipt } = {},
  ): void {
    if (!this.admission.matches(candidate) || this.active.has(candidate.id)) return
    this.pending.set(candidate.id, {
      candidate,
      ...(options.researchHoldout === undefined ? {} : { researchHoldout: options.researchHoldout }),
    })
    this.schedule(candidate.id)
  }

  private schedule(candidateId: string): void {
    const jobs = this.jobs
    const pending = this.pending.get(candidateId)
    if (jobs === undefined || pending === undefined || this.active.has(candidateId)) return
    const { candidate, researchHoldout } = pending
    this.pending.delete(candidateId)
    this.active.add(candidateId)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `deterministic Skill admission: ${candidate.requestedSkill}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.admission.evaluate(candidate, {
            signal: controller.signal,
            ...(researchHoldout === undefined ? {} : { researchHoldout }),
          })
          return {
            cancel: (reason?: string) => controller.abort(new Error(reason ?? 'Skill admission cancelled')),
            done: task.then(value => {
              if (!controller.signal.aborted) {
                try {
                  this.onResult?.(candidate, value)
                } catch {
                  // Durable Candidate + admission report are the restart queue.
                }
              }
              return {
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : value.status,
                ...controller.signal.aborted ? {} : { output: admissionOutput(value) },
              }
            }, (error: unknown) => ({
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
      this.pending.set(candidateId, pending)
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
  researchHoldoutResultId?: string,
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
    ...(researchHoldoutResultId === undefined ? {} : { researchHoldoutResultId }),
    releaseAuthority: 'none',
    ...(evidence === undefined ? {} : { evidence: Object.freeze({ ...evidence }) }),
  })
}

function admissionId(
  candidate: DiscoveredSkillCandidate,
  target: Pick<ResolvedTarget, 'id' | 'baselineHash' | 'casePackHash'> | string | undefined,
  researchHoldoutResultId?: string,
): string {
  if (typeof target === 'object') {
    return admissionIdentityId(candidate.id, target, researchHoldoutResultId)
  }
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
  researchHoldoutResultId?: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    researchHoldoutResultId === undefined
      ? 'deterministic-skill-admission-v1'
      : 'deterministic-skill-admission-research-pass-v2',
    candidateId,
    target.id,
    target.baselineHash,
    target.casePackHash,
    ...(researchHoldoutResultId === undefined ? [] : [researchHoldoutResultId]),
  ])).digest('hex')
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
}

function researchHoldoutBindingRequired(candidate: DiscoveredSkillCandidate): boolean {
  return candidate.version.kind === 'slow-loop-research-bundle-v2'
    || candidate.version.kind === 'slow-loop-research-revision-v3'
}

function exactResearchHoldoutPass(
  candidate: DiscoveredSkillCandidate,
  holdout: ResearchSkillHoldoutPassReceipt | undefined,
): string | undefined {
  if (!researchHoldoutBindingRequired(candidate) || holdout === undefined) return undefined
  const version = candidate.version
  if ((version.kind !== 'slow-loop-research-bundle-v2'
      && version.kind !== 'slow-loop-research-revision-v3')
    || holdout.kind !== 'research-holdout-pass-v1'
    || !CONTENT_ID.test(holdout.id)
    || holdout.candidateId !== candidate.id
    || holdout.workspaceId !== candidate.workspaceId
    || holdout.skillName !== candidate.requestedSkill
    || holdout.researchDigest !== version.researchDigest
    || holdout.candidateTreeHash !== version.treeHash
    || holdout.releaseAuthority !== 'none'
    || (version.kind === 'slow-loop-research-revision-v3'
      && holdout.id === version.holdoutResultId)) return undefined
  return holdout.id
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
  readonly researchHoldoutResultId?: string
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
    || !CONTENT_ID.test(actual.casePackHash)
    || (actual.researchHoldoutResultId !== undefined
      && (typeof actual.researchHoldoutResultId !== 'string'
        || !CONTENT_ID.test(actual.researchHoldoutResultId)))) {
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
      && value.researchHoldoutResultId === expected.researchHoldoutResultId
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
    || (value.researchHoldoutResultId !== undefined
      && (typeof value.researchHoldoutResultId !== 'string'
        || !CONTENT_ID.test(value.researchHoldoutResultId)))
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
    && typeof value.evidence.baselineTreeHash === 'string'
    && CONTENT_ID.test(value.evidence.baselineTreeHash)
    && typeof value.evidence.candidateTreeHash === 'string'
    && CONTENT_ID.test(value.evidence.candidateTreeHash)
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
  'research-holdout-pass-required',
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
  'research-holdout-pass-required',
  'baseline-identity-mismatch',
  'case-pack-identity-mismatch',
  'assembled-evaluator-not-governance-separated',
  'governance-input-mutated',
  'governance-roots-overlap',
  'evaluation-failed',
])
