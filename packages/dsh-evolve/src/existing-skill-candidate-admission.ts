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
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { ExistingSkillEvaluationEvidenceManifest } from './existing-skill-evaluation-evidence-vault.ts'
import type { InstalledSkillBaselineManifest } from './installed-skill-baseline.ts'
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
import { acquireShadowRunLock, writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_RUNS_PER_POLICY = 1_000
const MAX_STATE_BYTES = 64 * 1024
const MAX_RESULT_BYTES = 128 * 1024
const EDITABLE_INSTRUCTION = /^(?:SKILL\.md|references\/[^/]+\.md)$/u

export type ExistingSkillCandidateAdmissionReason =
  | 'no-governance-policy'
  | 'baseline-unavailable'
  | 'protected-evidence-unavailable'
  | 'protected-evidence-binding-mismatch'
  | 'baseline-identity-mismatch'
  | 'candidate-materialization-failed'
  | 'candidate-identity-mismatch'
  | 'undeclared-tree-difference'
  | 'unsupported-tree-difference'
  | 'evaluation-failed'
  | 'exact-paired-subjects-admitted'

export interface ExistingSkillCandidateAdmissionResult {
  readonly schemaVersion: 1
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly status: 'abstained' | 'incomplete' | 'protected' | 'qualified-for-holdout'
  readonly reasons: readonly ExistingSkillCandidateAdmissionReason[]
  readonly evidence?: {
    readonly baselineId: string
    readonly baselineArtifactDigest: string
    readonly baselineTreeHash: string
    readonly candidateArtifactDigest: string
    readonly candidateTreeHash: string
    readonly evaluationEvidenceId: string
    readonly protectedAdmissionSampleHash: string
    readonly protectedAdmissionSampleCount: 1
    readonly changedFileCount: number
    readonly addedFileCount: number
    readonly preservedFileCount: number
    readonly preservedBinaryFileCount: number
    readonly candidateExecuted: false
    readonly evaluatorClass: 'host-structural'
  }
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillCandidateAdmissionScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly results: readonly ExistingSkillCandidateAdmissionResult[]
}

interface BaselineBundle {
  readonly manifest: InstalledSkillBaselineManifest
  readonly files: readonly SkillBundleArchiveFile[]
}

interface ExistingSkillCandidateAdmissionOptions {
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
  readonly evidence: {
    readForGovernance(
      workspaceId: string,
      opportunityId: string,
      qualificationId: string,
      evidenceId: string,
    ): Promise<ExistingSkillEvaluationEvidenceManifest>
  }
}

interface AdmissionState {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-candidate-admission-state-v1'
  readonly id: string
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly evaluationEvidenceId: string
}

/**
 * Host-only structural admission for an improvement to an installed Skill.
 * It seals the exact parent and Candidate trees as a pair, consumes only the
 * governance-owned admission partition, and never executes either Skill.
 */
export class ExistingSkillCandidateAdmission {
  private readonly policies = new Map<string, SkillCandidateEvaluationPolicyConfig>()
  private readonly baselines: ExistingSkillCandidateAdmissionOptions['baselines']
  private readonly candidates: ExistingSkillCandidateAdmissionOptions['candidates']
  private readonly evidence: ExistingSkillCandidateAdmissionOptions['evidence']

  constructor(options: ExistingSkillCandidateAdmissionOptions) {
    assertSkillCandidateEvaluationPolicies(options.policies)
    for (const policy of options.policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.baselines = options.baselines
    this.candidates = options.candidates
    this.evidence = options.evidence
  }

  matches(candidate: Pick<ExistingSkillCandidate, 'workspaceId'>): boolean {
    return this.policies.has(candidate.workspaceId)
  }

  async evaluate(
    candidate: ExistingSkillCandidate,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExistingSkillCandidateAdmissionResult> {
    options.signal?.throwIfAborted()
    const policy = this.policies.get(candidate.workspaceId)
    const id = admissionId(candidate)
    if (policy === undefined) {
      return admissionResult(candidate, id, 'abstained', ['no-governance-policy'])
    }

    const runRoot = join(policy.runRoot, 'existing-skill-admission', 'runs')
    const runDir = join(runRoot, id)
    const state = admissionState(candidate, id)
    try {
      await ensureExactDirectory(runRoot)
      await mkdir(runDir, { mode: 0o700 })
    } catch (error) {
      if (!isAlreadyExists(error)) {
        return admissionResult(candidate, id, 'incomplete', ['evaluation-failed'])
      }
    }

    let releaseLock: () => Promise<void>
    try {
      releaseLock = await acquireShadowRunLock(runDir)
    } catch {
      return admissionResult(candidate, id, 'incomplete', ['evaluation-failed'])
    }
    try {
      options.signal?.throwIfAborted()
      const prepared = await prepareState(runDir, state)
      if (!prepared) {
        return admissionResult(candidate, id, 'incomplete', ['evaluation-failed'])
      }
      const existing = await readResult(runDir, state)
      if (existing !== undefined && existing.status !== 'incomplete') return existing

      let baseline: BaselineBundle | undefined
      try {
        baseline = await this.baselines.resolveBaseline(candidate.workspaceId, candidate.baseline.id)
      } catch {
        options.signal?.throwIfAborted()
        return await finish(runDir, admissionResult(candidate, id, 'incomplete', ['baseline-unavailable']))
      }
      options.signal?.throwIfAborted()
      if (baseline === undefined) {
        return await finish(runDir, admissionResult(candidate, id, 'incomplete', ['baseline-unavailable']))
      }

      let governed: ExistingSkillEvaluationEvidenceManifest
      try {
        governed = await this.evidence.readForGovernance(
          candidate.workspaceId,
          candidate.opportunity.id,
          candidate.baseline.qualificationId,
          candidate.authorship.evaluationEvidenceId,
        )
      } catch {
        options.signal?.throwIfAborted()
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'incomplete',
          ['protected-evidence-unavailable'],
        ))
      }
      options.signal?.throwIfAborted()
      const admissionSamples = governed.samples.filter(sample => sample.role === 'admission')
      if (!bindsProtectedEvidence(candidate, governed) || admissionSamples.length !== 1) {
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          ['protected-evidence-binding-mismatch'],
        ))
      }

      let baselineArchive
      try {
        baselineArchive = await assembleSealedSkillBundleArchive(baseline.files)
      } catch {
        options.signal?.throwIfAborted()
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          ['baseline-identity-mismatch'],
        ))
      }
      if (!bindsBaseline(candidate, baseline, baselineArchive)) {
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          ['baseline-identity-mismatch'],
        ))
      }

      const baselineDir = join(runDir, 'baseline')
      const candidateDir = join(runDir, 'candidate')
      await rm(baselineDir, { recursive: true, force: true })
      await rm(candidateDir, { recursive: true, force: true })
      try {
        options.signal?.throwIfAborted()
        await materializeFiles(baselineDir, baselineArchive.files)
      } catch {
        options.signal?.throwIfAborted()
        return await finish(runDir, admissionResult(candidate, id, 'incomplete', ['evaluation-failed']))
      }

      let materialized: MaterializedSkillCandidate
      try {
        materialized = await this.candidates.materializeExisting(candidate, candidateDir)
      } catch {
        options.signal?.throwIfAborted()
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'incomplete',
          ['candidate-materialization-failed'],
        ))
      }
      options.signal?.throwIfAborted()

      let candidateArchive
      try {
        candidateArchive = await assembleSealedSkillBundleArchive(await scanMaterialized(candidateDir))
      } catch {
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          ['candidate-identity-mismatch'],
        ))
      }
      if (!bindsCandidate(candidate, materialized, candidateDir, candidateArchive)) {
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          ['candidate-identity-mismatch'],
        ))
      }

      const comparison = compareTrees(candidate, baselineArchive.files, candidateArchive.files)
      if (comparison.status !== 'admitted') {
        return await finish(runDir, admissionResult(
          candidate,
          id,
          'protected',
          [comparison.reason],
        ))
      }
      const protectedAdmissionSampleHash = sha256Json(admissionSamples[0])
      return await finish(runDir, admissionResult(
        candidate,
        id,
        'qualified-for-holdout',
        ['exact-paired-subjects-admitted'],
        {
          baselineId: candidate.baseline.id,
          baselineArtifactDigest: baselineArchive.artifactDigest,
          baselineTreeHash: baselineArchive.treeHash,
          candidateArtifactDigest: candidateArchive.artifactDigest,
          candidateTreeHash: candidateArchive.treeHash,
          evaluationEvidenceId: governed.id,
          protectedAdmissionSampleHash,
          protectedAdmissionSampleCount: 1,
          changedFileCount: comparison.changedFileCount,
          addedFileCount: comparison.addedFileCount,
          preservedFileCount: comparison.preservedFileCount,
          preservedBinaryFileCount: comparison.preservedBinaryFileCount,
          candidateExecuted: false,
          evaluatorClass: 'host-structural',
        },
      ))
    } catch {
      options.signal?.throwIfAborted()
      return admissionResult(candidate, id, 'incomplete', ['evaluation-failed'])
    } finally {
      await releaseLock()
    }
  }

  async scan(workspaceId?: string): Promise<ExistingSkillCandidateAdmissionScan> {
    const policies = [...this.policies.values()]
      .filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
    const results = new Map<string, ExistingSkillCandidateAdmissionResult>()
    let warningCount = 0
    for (const policy of policies) {
      const runRoot = join(policy.runRoot, 'existing-skill-admission', 'runs')
      let entries
      try {
        entries = await readdir(await exactDirectory(runRoot), { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) warningCount += 1
        continue
      }
      if (entries.length > MAX_RUNS_PER_POLICY) warningCount += 1
      for (const entry of entries.slice(0, MAX_RUNS_PER_POLICY)) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const runDir = join(runRoot, entry.name)
          const state = await readState(runDir)
          if (state.id !== entry.name || admissionStateId(state) !== entry.name) {
            warningCount += 1
            continue
          }
          const result = await readResult(runDir, state)
          if (result === undefined) continue
          results.set(result.id, result)
        } catch {
          warningCount += 1
        }
      }
    }
    return Object.freeze({
      configuredPolicyCount: policies.length,
      warningCount,
      results: Object.freeze([...results.values()].sort((left, right) => left.id.localeCompare(right.id))),
    })
  }
}

/** Native Jobs bridge; durable Candidates and admission reports are the restart queue. */
export class ExistingSkillCandidateAdmissionScheduler {
  private readonly admission: Pick<ExistingSkillCandidateAdmission, 'evaluate' | 'matches'>
  private readonly candidates: {
    listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[]
  }
  private readonly onResult: ((
    candidate: ExistingSkillCandidate,
    result: ExistingSkillCandidateAdmissionResult,
  ) => void) | undefined
  private readonly pending = new Map<string, ExistingSkillCandidate>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(
    admission: Pick<ExistingSkillCandidateAdmission, 'evaluate' | 'matches'>,
    candidates: { listExistingCandidates(workspaceId?: string): ExistingSkillCandidate[] },
    options: {
      onResult?: (
        candidate: ExistingSkillCandidate,
        result: ExistingSkillCandidateAdmissionResult,
      ) => void
    } = {},
  ) {
    this.admission = admission
    this.candidates = candidates
    this.onResult = options.onResult
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('existing Skill admission Jobs seam is already attached')
    this.jobs = jobs
    this.reconcile()
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  reconcile(workspaceId?: string): void {
    for (const candidate of this.candidates.listExistingCandidates(workspaceId)) this.observe(candidate)
  }

  observe(candidate: ExistingSkillCandidate): void {
    if (!this.admission.matches(candidate)) return
    this.pending.set(candidate.id, candidate)
    if (this.active.has(candidate.id)) return
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
        label: `existing Skill paired admission: ${candidate.skillName}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.admission.evaluate(candidate, { signal: controller.signal })
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'existing Skill admission cancelled'),
            ),
            done: task.then(value => {
              if (!controller.signal.aborted) {
                try {
                  this.onResult?.(candidate, value)
                } catch {
                  // The exact Candidate and result remain durable for restart.
                }
              }
              return {
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted
                  ? errorDetail(controller.signal.reason)
                  : value.status,
                ...controller.signal.aborted ? {} : { output: JSON.stringify({
                    candidateId: value.candidateId,
                    admissionId: value.id,
                    status: value.status,
                  }) },
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
      this.pending.set(candidateId, candidate)
    }
  }
}

function admissionState(candidate: ExistingSkillCandidate, id: string): AdmissionState {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'existing-skill-candidate-admission-state-v1',
    id,
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
  })
}

function admissionId(candidate: ExistingSkillCandidate): string {
  return sha256Json([
    'existing-skill-candidate-admission-v1',
    candidate.id,
    candidate.workspaceId,
    candidate.skillName,
    candidate.opportunity.id,
    candidate.baseline.qualificationId,
    candidate.baseline.id,
    candidate.authorship.evaluationEvidenceId,
  ])
}

function admissionStateId(state: AdmissionState): string {
  return sha256Json([
    'existing-skill-candidate-admission-v1',
    state.candidateId,
    state.workspaceId,
    state.skillName,
    state.opportunityId,
    state.qualificationId,
    state.baselineId,
    state.evaluationEvidenceId,
  ])
}

function admissionResult(
  candidate: ExistingSkillCandidate,
  id: string,
  status: ExistingSkillCandidateAdmissionResult['status'],
  reasons: readonly ExistingSkillCandidateAdmissionReason[],
  evidence?: ExistingSkillCandidateAdmissionResult['evidence'],
): ExistingSkillCandidateAdmissionResult {
  return Object.freeze({
    schemaVersion: 1,
    id,
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    status,
    reasons: Object.freeze([...reasons]),
    ...(evidence === undefined ? {} : { evidence: Object.freeze({ ...evidence }) }),
    releaseAuthority: 'none',
  })
}

function bindsProtectedEvidence(
  candidate: ExistingSkillCandidate,
  evidence: ExistingSkillEvaluationEvidenceManifest,
): boolean {
  return evidence.id === candidate.authorship.evaluationEvidenceId
    && evidence.workspaceId === candidate.workspaceId
    && evidence.opportunity.id === candidate.opportunity.id
    && evidence.opportunity.skillName === candidate.skillName
    && evidence.opportunity.signalCount === candidate.opportunity.signalCount
    && evidence.opportunity.goalCount === candidate.opportunity.goalCount
    && evidence.qualification.id === candidate.baseline.qualificationId
    && evidence.qualification.baselineId === candidate.baseline.id
    && evidence.authoringInputDigest === candidate.authorship.inputDigest
    && evidence.releaseAuthority === 'none'
}

function bindsBaseline(
  candidate: ExistingSkillCandidate,
  baseline: BaselineBundle,
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): boolean {
  const manifest = baseline.manifest
  return manifest.id === candidate.baseline.id
    && manifest.workspaceId === candidate.workspaceId
    && manifest.skillName === candidate.skillName
    && manifest.bundle.artifactDigest === candidate.baseline.artifactDigest
    && manifest.bundle.treeHash === candidate.baseline.treeHash
    && manifest.bundle.fileCount === archive.files.length
    && manifest.bundle.totalBytes === archive.totalBytes
    && manifest.bundle.hasExecutableFiles === false
    && manifest.bundle.artifactDigest === archive.artifactDigest
    && manifest.bundle.treeHash === archive.treeHash
    && manifest.releaseAuthority === 'none'
}

function bindsCandidate(
  candidate: ExistingSkillCandidate,
  materialized: MaterializedSkillCandidate,
  candidateDir: string,
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): boolean {
  const actualFiles = new Map(archive.files.map(file => [file.path, file.content.byteLength]))
  return materialized.candidateId === candidate.id
    && resolve(materialized.path) === candidateDir
    && materialized.contentHash === candidate.contentHash
    && materialized.treeHash === candidate.version.treeHash
    && materialized.files.length === archive.files.length
    && new Set(materialized.files.map(file => file.path)).size === materialized.files.length
    && materialized.files.every(file => file.mode === '100644'
      && actualFiles.get(file.path) === file.size)
    && candidate.contentHash === candidate.version.artifactDigest
    && candidate.contentHash === candidate.artifact.digest
    && candidate.version.parentBaselineId === candidate.baseline.id
    && candidate.version.artifactDigest === archive.artifactDigest
    && candidate.version.treeHash === archive.treeHash
    && candidate.package.fileCount === archive.files.length
    && candidate.package.totalBytes === archive.totalBytes
    && candidate.package.hasExecutableFiles === false
    && candidate.permissions.executableContentChanged === false
    && candidate.lifecycle === 'inactive'
    && candidate.verification === 'unevaluated'
    && candidate.execution === 'never'
    && candidate.releaseAuthority === 'none'
}

function compareTrees(
  candidate: ExistingSkillCandidate,
  baselineFiles: readonly SkillBundleArchiveFile[],
  candidateFiles: readonly SkillBundleArchiveFile[],
):
  | {
      readonly status: 'admitted'
      readonly changedFileCount: number
      readonly addedFileCount: number
      readonly preservedFileCount: number
      readonly preservedBinaryFileCount: number
    }
  | {
      readonly status: 'protected'
      readonly reason: 'undeclared-tree-difference' | 'unsupported-tree-difference'
    } {
  const baseline = new Map(baselineFiles.map(file => [file.path, file]))
  const current = new Map(candidateFiles.map(file => [file.path, file]))
  if ([...baseline.keys()].some(path => !current.has(path))) {
    return { status: 'protected', reason: 'undeclared-tree-difference' }
  }
  const changedPaths = candidateFiles
    .filter(file => !baseline.get(file.path)?.content.equals(file.content))
    .map(file => file.path)
    .sort()
  const addedPaths = changedPaths.filter(path => !baseline.has(path))
  const declaredChanged = [...candidate.diff.changedPaths].sort()
  const declaredAdded = [...candidate.diff.addedPaths].sort()
  if (JSON.stringify(changedPaths) !== JSON.stringify(declaredChanged)
    || JSON.stringify(addedPaths) !== JSON.stringify(declaredAdded)
    || changedPaths.length === 0
    || candidate.diff.preservedFileCount !== baselineFiles.length - changedPaths.length + addedPaths.length) {
    return { status: 'protected', reason: 'undeclared-tree-difference' }
  }
  if (changedPaths.some(path => !EDITABLE_INSTRUCTION.test(path))) {
    return { status: 'protected', reason: 'unsupported-tree-difference' }
  }
  const preserved = baselineFiles.filter(file => !changedPaths.includes(file.path))
  const preservedBinaryFileCount = preserved.filter(file => !isCanonicalUtf8(file.content)).length
  if (preservedBinaryFileCount !== candidate.diff.preservedBinaryFileCount) {
    return { status: 'protected', reason: 'undeclared-tree-difference' }
  }
  return {
    status: 'admitted',
    changedFileCount: changedPaths.length,
    addedFileCount: addedPaths.length,
    preservedFileCount: preserved.length,
    preservedBinaryFileCount,
  }
}

async function materializeFiles(root: string, files: readonly SkillBundleArchiveFile[]): Promise<void> {
  await mkdir(root, { mode: 0o700 })
  for (const file of files) {
    const target = resolve(root, ...file.path.split('/'))
    assertInside(root, target)
    await mkdir(dirname(target), { mode: 0o700, recursive: true })
    await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
  }
}

async function scanMaterialized(root: string): Promise<SkillBundleArchiveFile[]> {
  if (await exactDirectory(root) !== root) throw new Error('Candidate root is not exact')
  const files: SkillBundleArchiveFile[] = []
  const walk = async (directory: string, prefix: readonly string[]): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Candidate contains a symlink')
      if (info.isDirectory()) {
        await walk(path, [...prefix, entry.name])
      } else if (info.isFile()) {
        files.push({
          path: [...prefix, entry.name].join('/'),
          mode: '100644',
          content: await readFile(path),
        })
      } else {
        throw new Error('Candidate contains a special entry')
      }
    }
  }
  await walk(root, [])
  return files
}

async function prepareState(runDir: string, expected: AdmissionState): Promise<boolean> {
  try {
    const actual = await readState(runDir)
    return JSON.stringify(actual) === JSON.stringify(expected)
  } catch (error) {
    if (!isMissing(error)) return false
  }
  await writeDurableJson(join(runDir, 'state.json'), expected)
  return true
}

async function readState(runDir: string): Promise<AdmissionState> {
  if (await exactDirectory(runDir) !== runDir) throw new Error('admission run is not exact')
  const value = await readBoundedJson(join(runDir, 'state.json'), MAX_STATE_BYTES)
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-candidate-admission-state-v1'
    || !CONTENT_ID.test(String(value.id))
    || !CONTENT_ID.test(String(value.candidateId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !CONTENT_ID.test(String(value.opportunityId))
    || !CONTENT_ID.test(String(value.qualificationId))
    || !CONTENT_ID.test(String(value.baselineId))
    || !CONTENT_ID.test(String(value.evaluationEvidenceId))) {
    throw new Error('existing Skill admission state has an invalid shape')
  }
  return value as unknown as AdmissionState
}

async function readResult(
  runDir: string,
  state: AdmissionState,
): Promise<ExistingSkillCandidateAdmissionResult | undefined> {
  let value: unknown
  try {
    value = await readBoundedJson(join(runDir, 'result.json'), MAX_RESULT_BYTES)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  if (!isAdmissionResult(value)
    || value.id !== state.id
    || value.candidateId !== state.candidateId
    || value.workspaceId !== state.workspaceId
    || value.skillName !== state.skillName) {
    throw new Error('existing Skill admission result does not match its state')
  }
  return Object.freeze(structuredClone(value))
}

async function finish(
  runDir: string,
  result: ExistingSkillCandidateAdmissionResult,
): Promise<ExistingSkillCandidateAdmissionResult> {
  await writeDurableJson(join(runDir, 'result.json'), result)
  return result
}

function isAdmissionResult(value: unknown): value is ExistingSkillCandidateAdmissionResult {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !CONTENT_ID.test(String(value.id))
    || !CONTENT_ID.test(String(value.candidateId))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !ADMISSION_STATUSES.has(String(value.status) as ExistingSkillCandidateAdmissionResult['status'])
    || !Array.isArray(value.reasons)
    || value.reasons.length !== 1
    || !ADMISSION_REASONS.has(String(value.reasons[0]) as ExistingSkillCandidateAdmissionReason)
    || value.releaseAuthority !== 'none') return false
  if (value.status === 'qualified-for-holdout') {
    return value.reasons[0] === 'exact-paired-subjects-admitted'
      && isRecord(value.evidence)
      && CONTENT_ID.test(String(value.evidence.baselineId))
      && CONTENT_ID.test(String(value.evidence.baselineArtifactDigest))
      && CONTENT_ID.test(String(value.evidence.baselineTreeHash))
      && CONTENT_ID.test(String(value.evidence.candidateArtifactDigest))
      && CONTENT_ID.test(String(value.evidence.candidateTreeHash))
      && CONTENT_ID.test(String(value.evidence.evaluationEvidenceId))
      && CONTENT_ID.test(String(value.evidence.protectedAdmissionSampleHash))
      && value.evidence.protectedAdmissionSampleCount === 1
      && nonnegativeInteger(value.evidence.changedFileCount)
      && nonnegativeInteger(value.evidence.addedFileCount)
      && nonnegativeInteger(value.evidence.preservedFileCount)
      && nonnegativeInteger(value.evidence.preservedBinaryFileCount)
      && value.evidence.candidateExecuted === false
      && value.evidence.evaluatorClass === 'host-structural'
  }
  if (value.evidence !== undefined) return false
  const reason = value.reasons[0] as ExistingSkillCandidateAdmissionReason
  switch (value.status) {
    case 'abstained':
      return reason === 'no-governance-policy'
    case 'incomplete':
      return INCOMPLETE_REASONS.has(reason)
    case 'protected':
      return PROTECTED_REASONS.has(reason)
    default:
      return false
  }
}

async function readBoundedJson(path: string, maxBytes: number): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes || await realpath(path) !== path) {
    throw new Error('admission document is not an exact bounded file')
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function ensureExactDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await exactDirectory(path)
}

async function exactDirectory(path: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error('admission path must be an exact real directory')
  }
  return actual
}

function assertInside(root: string, path: string): void {
  const fromRoot = relative(root, path)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error('admission file escapes its root')
  }
}

function isCanonicalUtf8(content: Buffer): boolean {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
    return Buffer.from(decoded).equals(content)
  } catch {
    return false
  }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown error'
}

const ADMISSION_STATUSES = new Set<ExistingSkillCandidateAdmissionResult['status']>([
  'abstained',
  'incomplete',
  'protected',
  'qualified-for-holdout',
])

const ADMISSION_REASONS = new Set<ExistingSkillCandidateAdmissionReason>([
  'no-governance-policy',
  'baseline-unavailable',
  'protected-evidence-unavailable',
  'protected-evidence-binding-mismatch',
  'baseline-identity-mismatch',
  'candidate-materialization-failed',
  'candidate-identity-mismatch',
  'undeclared-tree-difference',
  'unsupported-tree-difference',
  'evaluation-failed',
  'exact-paired-subjects-admitted',
])

const INCOMPLETE_REASONS = new Set<ExistingSkillCandidateAdmissionReason>([
  'baseline-unavailable',
  'protected-evidence-unavailable',
  'candidate-materialization-failed',
  'evaluation-failed',
])

const PROTECTED_REASONS = new Set<ExistingSkillCandidateAdmissionReason>([
  'protected-evidence-binding-mismatch',
  'baseline-identity-mismatch',
  'candidate-identity-mismatch',
  'undeclared-tree-difference',
  'unsupported-tree-difference',
])
