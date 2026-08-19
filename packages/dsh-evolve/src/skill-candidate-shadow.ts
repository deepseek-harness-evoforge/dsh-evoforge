import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { lstat, readFile, realpath } from 'node:fs/promises'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { hashTree } from './hash.ts'
import type {
  SkillCandidateAdmission,
  SkillCandidateAdmissionResult,
  QualifiedSkillCandidateShadowInput,
} from './skill-candidate-admission.ts'
import { parseCasePackManifest, runShadow } from './shadow.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'

type ShadowResult = Awaited<ReturnType<typeof runShadow>>

interface QualifiedAdmissionReader {
  qualifiedShadowInput(
    candidate: ExperienceSkillCandidate,
    admission: SkillCandidateAdmissionResult,
  ): Promise<QualifiedSkillCandidateShadowInput>
}

/** Governance-separated assembled holdout for one exact pre-admitted internal Candidate. */
export class SkillCandidateShadowLauncher {
  private readonly admission: QualifiedAdmissionReader
  private readonly runner: typeof runShadow

  constructor(
    admission: Pick<SkillCandidateAdmission, 'qualifiedShadowInput'>,
    options: { runShadow?: typeof runShadow } = {},
  ) {
    this.admission = admission
    this.runner = options.runShadow ?? runShadow
  }

  matches(
    candidate: ExperienceSkillCandidate,
    admission: SkillCandidateAdmissionResult,
  ): boolean {
    return admission.status === 'qualified-for-shadow'
      && admission.candidateId === candidate.id
      && admission.workspaceId === candidate.workspaceId
      && admission.skillName === candidate.skillName
  }

  async launch(
    candidate: ExperienceSkillCandidate,
    admission: SkillCandidateAdmissionResult,
    options: { signal?: AbortSignal } = {},
  ): Promise<ShadowResult> {
    options.signal?.throwIfAborted()
    if (!this.matches(candidate, admission)) {
      throw new Error('Candidate has no exact qualified admission for Shadow')
    }
    const source = await this.admission.qualifiedShadowInput(candidate, admission)
    const [casePackDir, runRoot] = await Promise.all([
      realpath(source.holdoutCasePackDir),
      realpath(source.shadowRunRoot),
    ])
    assertIndependentRoots(source, casePackDir, runRoot)
    if (source.holdoutCasePackHash === source.admissionCasePackHash) {
      throw new Error('Skill Candidate Shadow must use an independent holdout Case Pack')
    }
    if (await hashTree(casePackDir) !== source.holdoutCasePackHash) {
      throw new Error('Skill Candidate Shadow Case Pack identity mismatch')
    }
    const manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
    if (manifest.workspaceId !== candidate.workspaceId
      || manifest.trial?.dshAssembled !== true
      || manifest.trial.capabilityAbsentBaseline !== true
      || manifest.calibration === undefined) {
      throw new Error('Skill Candidate Shadow requires its exact assembled holdout manifest')
    }
    const id = shadowId(candidate, admission, manifest.id, source.holdoutCasePackHash)
    const outputDir = join(runRoot, id)
    let resume = false
    try {
      const info = await lstat(outputDir)
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(outputDir) !== outputDir) {
        throw new Error('Skill Candidate Shadow output is not an exact owned directory')
      }
      resume = true
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    return this.runner({
      baselineKind: source.baselineKind,
      baselineSkillName: source.baselineSkillName,
      casePackDir,
      exactCandidate: {
        claim: candidate.description,
        lineage: source.lineage,
        skillDir: source.candidateDir,
      },
      expectedCasePackHash: source.holdoutCasePackHash,
      outputDir,
      resume,
      ...options.signal === undefined ? {} : { signal: options.signal },
      skillDir: source.baselineDir,
    })
  }
}

/** Native Jobs handoff; a rejected start stays pending until the next Job settlement. */
export class SkillCandidateShadowScheduler {
  private readonly launcher: Pick<SkillCandidateShadowLauncher, 'launch' | 'matches'>
  private readonly pending = new Map<string, {
    candidate: ExperienceSkillCandidate
    admission: SkillCandidateAdmissionResult
  }>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start' | 'onJobDone'> | undefined

  constructor(launcher: Pick<SkillCandidateShadowLauncher, 'launch' | 'matches'>) {
    this.launcher = launcher
  }

  attachJobs(jobs: Pick<JobRegistry, 'start' | 'onJobDone'>): () => void {
    if (this.jobs !== undefined) throw new Error('Skill Candidate Shadow Jobs seam is already attached')
    this.jobs = jobs
    const detachDone = jobs.onJobDone(() => this.drain())
    this.drain()
    return () => {
      detachDone()
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(candidate: ExperienceSkillCandidate, admission: SkillCandidateAdmissionResult): void {
    if (!this.launcher.matches(candidate, admission)
      || admission.status !== 'qualified-for-shadow'
      || this.active.has(admission.id)) return
    this.pending.set(admission.id, { candidate, admission })
    this.drain()
  }

  private drain(): void {
    const jobs = this.jobs
    if (jobs === undefined) return
    for (const [id, input] of this.pending) {
      if (this.active.has(id)) continue
      this.pending.delete(id)
      this.active.add(id)
      const controller = new AbortController()
      try {
        jobs.start({
          kind: 'evolution',
          label: `assembled Skill Candidate Shadow: ${input.candidate.skillName}`,
          outputLimitBytes: 2_048,
          run: () => {
            const task = this.launcher.launch(input.candidate, input.admission, {
              signal: controller.signal,
            })
            return {
              cancel: (reason?: string) => controller.abort(new Error(reason ?? 'Skill Candidate Shadow cancelled')),
              done: task.then(value => ({
                status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
                detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : value.status,
                ...controller.signal.aborted ? {} : {
                    output: boundedOutput(value.status === 'complete' ? value.summary : value.reason),
                  },
              }), (error: unknown) => ({
                status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
                detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
              })).finally(() => {
                this.active.delete(id)
                this.drain()
              }),
            }
          },
        })
      } catch {
        this.active.delete(id)
        this.pending.set(id, input)
        break
      }
    }
  }
}

function assertIndependentRoots(
  source: QualifiedSkillCandidateShadowInput,
  casePackDir: string,
  runRoot: string,
): void {
  const admissionRoots = [
    source.baselineDir,
    source.candidateDir,
    source.admissionCasePackDir,
    source.admissionRunRoot,
  ]
  for (const shadowRoot of [casePackDir, runRoot]) {
    for (const admissionRoot of admissionRoots) {
      if (!separate(shadowRoot, admissionRoot)) {
        throw new Error('Skill Candidate Shadow governance roots must be isolated from admission inputs')
      }
    }
  }
  if (!separate(casePackDir, runRoot)) {
    throw new Error('Skill Candidate Shadow Case Pack and run root must be isolated')
  }
}

function separate(left: string, right: string): boolean {
  const contains = (root: string, path: string): boolean => {
    const value = relative(root, path)
    return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  }
  return !contains(left, right) && !contains(right, left)
}

function shadowId(
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
  holdoutId: string,
  holdoutCasePackHash: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    'opportunity-bound-skill-candidate-shadow-v2',
    candidate.id,
    admission.id,
    holdoutId,
    holdoutCasePackHash,
  ])).digest('hex')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorDetail(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}

function boundedOutput(value: string): string {
  return Buffer.from(value).subarray(0, 2_048).toString('utf8')
}
