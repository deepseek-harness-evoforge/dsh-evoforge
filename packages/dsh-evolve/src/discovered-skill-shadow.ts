import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstat, readFile, realpath } from 'node:fs/promises'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { hashTree } from './hash.ts'
import type {
  DiscoveredSkillAdmission,
  DiscoveredSkillAdmissionResult,
  QualifiedDiscoveredSkillShadowInput,
} from './discovered-skill-admission.ts'
import { parseCasePackManifest, runShadow } from './shadow.ts'
import type { DiscoveredSkillCandidate } from './trusted-skill-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 100

export interface DiscoveredSkillShadowTargetConfig {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly casePackDir: string
  readonly casePackHash: string
  readonly runRoot: string
}

interface ResolvedTarget extends DiscoveredSkillShadowTargetConfig {
  readonly casePackDir: string
  readonly runRoot: string
}

type ShadowResult = Awaited<ReturnType<typeof runShadow>>

interface QualifiedAdmissionReader {
  qualifiedShadowInput(
    candidate: DiscoveredSkillCandidate,
    admission: DiscoveredSkillAdmissionResult,
  ): Promise<QualifiedDiscoveredSkillShadowInput>
}

/** Governance-separated assembled holdout for one exact pre-admitted discovery Candidate. */
export class DiscoveredSkillShadowLauncher {
  private readonly targets = new Map<string, ResolvedTarget>()
  private readonly admission: QualifiedAdmissionReader
  private readonly runner: typeof runShadow

  constructor(
    targets: readonly DiscoveredSkillShadowTargetConfig[],
    admission: Pick<DiscoveredSkillAdmission, 'qualifiedShadowInput'>,
    options: { runShadow?: typeof runShadow } = {},
  ) {
    if (targets.length > MAX_TARGETS) {
      throw new Error(`discovered Skill Shadow supports at most ${MAX_TARGETS} targets`)
    }
    for (const input of targets) {
      assertTarget(input)
      const key = targetKey(input.workspaceId, input.skill)
      if (this.targets.has(key)) {
        throw new Error(`duplicate discovered Skill Shadow target for '${input.skill}'`)
      }
      this.targets.set(key, Object.freeze({
        ...input,
        casePackDir: resolve(input.casePackDir),
        runRoot: resolve(input.runRoot),
      }))
    }
    this.admission = admission
    this.runner = options.runShadow ?? runShadow
  }

  matches(
    candidate: DiscoveredSkillCandidate,
    admission: DiscoveredSkillAdmissionResult,
  ): boolean {
    return admission.status === 'qualified-for-shadow'
      && admission.candidateId === candidate.id
      && this.targets.has(targetKey(candidate.workspaceId, candidate.requestedSkill))
  }

  async launch(
    candidate: DiscoveredSkillCandidate,
    admission: DiscoveredSkillAdmissionResult,
    options: { signal?: AbortSignal } = {},
  ): Promise<ShadowResult> {
    options.signal?.throwIfAborted()
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined || !this.matches(candidate, admission)) {
      throw new Error('qualified Candidate has no exact discovered Skill Shadow target')
    }
    const source = await this.admission.qualifiedShadowInput(candidate, admission)
    const [casePackDir, runRoot] = await Promise.all([
      realpath(target.casePackDir),
      realpath(target.runRoot),
    ])
    assertIndependentRoots(source, casePackDir, runRoot)
    if (target.casePackHash === source.admissionCasePackHash) {
      throw new Error('discovered Skill Shadow must use an independent holdout Case Pack')
    }
    if (await hashTree(casePackDir) !== target.casePackHash) {
      throw new Error('discovered Skill Shadow Case Pack identity mismatch')
    }
    const manifest = parseCasePackManifest(await readFile(join(casePackDir, 'manifest.json'), 'utf8'))
    if (manifest.id !== target.id
      || manifest.workspaceId !== candidate.workspaceId
      || manifest.trial?.dshAssembled !== true
      || manifest.calibration === undefined) {
      throw new Error('discovered Skill Shadow requires its exact assembled holdout manifest')
    }
    const id = shadowId(candidate, admission, target)
    const outputDir = join(runRoot, id)
    let resume = false
    try {
      const info = await lstat(outputDir)
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(outputDir) !== outputDir) {
        throw new Error('discovered Skill Shadow output is not an exact owned directory')
      }
      resume = true
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    return this.runner({
      casePackDir,
      exactCandidate: {
        claim: candidate.description,
        lineage: source.lineage,
        skillDir: source.candidateDir,
      },
      expectedCasePackHash: target.casePackHash,
      outputDir,
      resume,
      ...options.signal === undefined ? {} : { signal: options.signal },
      skillDir: source.baselineDir,
    })
  }
}

/** Native Jobs handoff; a rejected start stays pending until the next Job settlement. */
export class DiscoveredSkillShadowScheduler {
  private readonly launcher: Pick<DiscoveredSkillShadowLauncher, 'launch' | 'matches'>
  private readonly pending = new Map<string, {
    candidate: DiscoveredSkillCandidate
    admission: DiscoveredSkillAdmissionResult
  }>()
  private readonly active = new Set<string>()
  private jobs: Pick<JobRegistry, 'start' | 'onJobDone'> | undefined

  constructor(launcher: Pick<DiscoveredSkillShadowLauncher, 'launch' | 'matches'>) {
    this.launcher = launcher
  }

  attachJobs(jobs: Pick<JobRegistry, 'start' | 'onJobDone'>): () => void {
    if (this.jobs !== undefined) throw new Error('discovered Skill Shadow Jobs seam is already attached')
    this.jobs = jobs
    const detachDone = jobs.onJobDone(() => this.drain())
    this.drain()
    return () => {
      detachDone()
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  observe(candidate: DiscoveredSkillCandidate, admission: DiscoveredSkillAdmissionResult): void {
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
          label: `assembled discovered Skill Shadow: ${input.candidate.requestedSkill}`,
          outputLimitBytes: 2_048,
          run: () => {
            const task = this.launcher.launch(input.candidate, input.admission, {
              signal: controller.signal,
            })
            return {
              cancel: (reason?: string) => controller.abort(new Error(reason ?? 'discovered Skill Shadow cancelled')),
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

function assertTarget(target: DiscoveredSkillShadowTargetConfig): void {
  if (!PUBLIC_ID.test(target.id) || !PUBLIC_ID.test(target.skill)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(target.workspaceId)
    || !CONTENT_ID.test(target.casePackHash)) {
    throw new Error(`invalid discovered Skill Shadow target '${target.id}'`)
  }
  if (!isAbsolute(target.casePackDir) || !isAbsolute(target.runRoot)
    || dirname(resolve(target.runRoot)) === resolve(target.runRoot)) {
    throw new Error(`discovered Skill Shadow target '${target.id}' requires absolute non-root paths`)
  }
}

function assertIndependentRoots(
  source: QualifiedDiscoveredSkillShadowInput,
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
        throw new Error('discovered Skill Shadow governance roots must be isolated from admission inputs')
      }
    }
  }
  if (!separate(casePackDir, runRoot)) {
    throw new Error('discovered Skill Shadow Case Pack and run root must be isolated')
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
  candidate: DiscoveredSkillCandidate,
  admission: DiscoveredSkillAdmissionResult,
  target: ResolvedTarget,
): string {
  return createHash('sha256').update(JSON.stringify([
    'discovered-skill-shadow-v1',
    candidate.id,
    admission.id,
    target.id,
    target.casePackHash,
  ])).digest('hex')
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
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
