import { createHash } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import { hashTree } from './hash.ts'
import { loadShadowRunState, type ShadowRunState } from './shadow-run-state.ts'
import { runShadow, type ShadowOptions } from './shadow.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const TARGET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 20
const MAX_RUNS = 20

export interface FeedbackShadowTargetConfig {
  readonly id: string
  readonly skill: string
  readonly casePackDir: string
  readonly runRoot: string
}

export interface FeedbackShadowTargetView {
  readonly id: string
  readonly skillName: string
}

export interface FeedbackShadowRunView {
  readonly launchId: string
  readonly targetId: string
  readonly skillName: string
  readonly phase: ShadowRunState['phase']
  readonly startedAt: string
  readonly updatedAt: string
}

export interface FeedbackShadowScan {
  readonly runs: readonly FeedbackShadowRunView[]
  readonly warningCount: number
}

export interface FeedbackShadowLaunchReceipt {
  readonly schemaVersion: 1
  readonly action: 'start-shadow'
  readonly launchId: string
  readonly targetId: string
  readonly skillName: string
  readonly runStatus: 'scheduled' | 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete'
  readonly jobId?: string
}

interface FeedbackShadowLauncherOptions {
  readonly targets: readonly FeedbackShadowTargetConfig[]
  readonly supervisorRunRoots: readonly string[]
  readonly drafts: () => Pick<FeedbackCaseDraftBuilder, 'create'> | undefined
  readonly source: Pick<GitSkillSource, 'resolveArtifact'>
  readonly runner?: (options: ShadowOptions) => ReturnType<typeof runShadow>
  readonly modelIdentity?: () => string
}

/** Explicit paid bridge from one exact feedback correction to existing Shadow evidence. */
export class FeedbackShadowLauncher {
  private readonly targetsById = new Map<string, FeedbackShadowTargetConfig>()
  private readonly drafts: FeedbackShadowLauncherOptions['drafts']
  private readonly source: FeedbackShadowLauncherOptions['source']
  private readonly runner: NonNullable<FeedbackShadowLauncherOptions['runner']>
  private readonly modelIdentity: NonNullable<FeedbackShadowLauncherOptions['modelIdentity']>
  private readonly active = new Map<string, FeedbackShadowLaunchReceipt>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: FeedbackShadowLauncherOptions) {
    if (options.targets.length === 0 || options.targets.length > MAX_TARGETS) {
      throw new Error(`feedback Shadow requires between 1 and ${MAX_TARGETS} targets`)
    }
    const supervisorRoots = new Set(options.supervisorRunRoots.map(path => resolve(path)))
    const targetRoots = new Set<string>()
    for (const input of options.targets) {
      if (!TARGET_ID.test(input.id) || !TARGET_ID.test(input.skill)) {
        throw new Error(`invalid feedback Shadow target '${input.id}'`)
      }
      if (!isAbsolute(input.casePackDir) || !isAbsolute(input.runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' paths must be absolute`)
      }
      if (this.targetsById.has(input.id)) {
        throw new Error(`duplicate feedback Shadow target '${input.id}'`)
      }
      const runRoot = resolve(input.runRoot)
      if (!supervisorRoots.has(runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' must use one configured supervisor run root`)
      }
      if (targetRoots.has(runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' must have a unique supervisor run root`)
      }
      targetRoots.add(runRoot)
      this.targetsById.set(input.id, Object.freeze({
        id: input.id,
        skill: input.skill,
        casePackDir: resolve(input.casePackDir),
        runRoot,
      }))
    }
    this.drafts = options.drafts
    this.source = options.source
    this.runner = options.runner ?? runShadow
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('feedback Shadow Jobs seam is already attached')
    this.jobs = jobs
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  available(): boolean {
    return this.jobs !== undefined && this.drafts() !== undefined
  }

  targets(): FeedbackShadowTargetView[] {
    return [...this.targetsById.values()].map(target => Object.freeze({
      id: target.id,
      skillName: target.skill,
    }))
  }

  async launch(signalId: string, targetId: string): Promise<FeedbackShadowLaunchReceipt> {
    if (!CONTENT_ID.test(signalId)) throw new Error('feedback signal id must be a full 64-character id')
    const target = this.targetsById.get(targetId)
    if (target === undefined) throw new Error(`unknown feedback Shadow target '${targetId}'`)
    const jobs = this.jobs
    if (jobs === undefined) throw new Error('native Jobs is unavailable for feedback Shadow')
    const drafts = this.drafts()
    if (drafts === undefined) {
      throw new Error('private Feedback Case Draft creation is unavailable for feedback Shadow')
    }

    const modelIdentity = this.modelIdentity()
    if (modelIdentity.trim() === '') throw new Error('feedback Shadow model identity must not be empty')
    const runRoot = await realpath(target.runRoot)
    const casePackDir = await realpath(target.casePackDir)
    const casePackHash = await hashTree(casePackDir)
    const draft = await drafts.create(signalId, target.skill)
    const resolvedSkill = await this.source.resolveArtifact(target.skill, draft.draft.target.artifact)
    if (resolvedSkill.artifact.treeHash !== draft.draft.target.artifact.treeHash) {
      throw new Error('resolved feedback Shadow Skill does not match its private draft')
    }
    const launchId = sha256(JSON.stringify({
      signalId,
      draftId: draft.draft.id,
      targetId,
      casePackHash,
      modelIdentity,
      skillTree: resolvedSkill.artifact.treeHash,
    }))
    const alreadyActive = this.active.get(launchId)
    if (alreadyActive !== undefined) return alreadyActive

    const outputDir = join(runRoot, launchId)
    let resume = false
    let outputExists = false
    try {
      const existingRoot = await realpath(outputDir)
      if (existingRoot !== outputDir) throw new Error('feedback Shadow run path is not exact')
      outputExists = true
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
    if (outputExists) {
      let existing: ShadowRunState
      try {
        existing = await loadShadowRunState(outputDir)
      } catch (error) {
        if (isMissingPathError(error)) {
          throw new Error('feedback Shadow run directory exists without a durable journal; inspect it before retrying')
        }
        throw error
      }
      if (existing.phase === 'complete' || existing.phase === 'incomplete') {
        return receipt(launchId, target, existing.phase)
      }
      resume = true
    }

    const controller = new AbortController()
    const invocation: ShadowOptions = {
      casePackDir,
      feedbackDraftPath: draft.path,
      outputDir,
      resume,
      signal: controller.signal,
      skillDir: resolvedSkill.resourceBase,
    }
    let jobId: JobId
    jobId = jobs.start({
      kind: 'evolution',
      label: `feedback Shadow: ${target.id}`,
      outputLimitBytes: 2_048,
      run: () => {
        const task = this.runner(invocation)
        return {
          cancel: (reason?: string) => controller.abort(new Error(reason ?? 'feedback Shadow cancelled')),
          done: task.then(result => ({
            status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
            detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : result.status,
            ...controller.signal.aborted ? {} : {
                output: boundedOutput(result.status === 'complete' ? result.summary : result.reason),
              },
          }), (error: unknown) => ({
            status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
            detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
          })).finally(() => {
            this.active.delete(launchId)
          }),
        }
      },
    })
    const launched = receipt(launchId, target, 'scheduled', String(jobId))
    this.active.set(launchId, launched)
    return launched
  }

  async scan(): Promise<FeedbackShadowScan> {
    const runs: FeedbackShadowRunView[] = []
    let warningCount = 0
    for (const target of this.targetsById.values()) {
      let root: string
      let entries
      try {
        root = await realpath(target.runRoot)
        entries = await readdir(root, { withFileTypes: true })
      } catch {
        warningCount += 1
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const state = await loadShadowRunState(join(root, entry.name))
          if (state.identity.skillName !== target.skill) {
            warningCount += 1
            continue
          }
          runs.push(Object.freeze({
            launchId: entry.name,
            targetId: target.id,
            skillName: state.identity.skillName,
            phase: state.phase,
            startedAt: state.startedAt,
            updatedAt: state.updatedAt,
          }))
        } catch {
          warningCount += 1
        }
      }
    }
    runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
      || left.launchId.localeCompare(right.launchId))
    return { runs: runs.slice(0, MAX_RUNS), warningCount }
  }
}

function receipt(
  launchId: string,
  target: FeedbackShadowTargetConfig,
  runStatus: FeedbackShadowLaunchReceipt['runStatus'],
  jobId?: string,
): FeedbackShadowLaunchReceipt {
  return Object.freeze({
    schemaVersion: 1,
    action: 'start-shadow',
    launchId,
    targetId: target.id,
    skillName: target.skill,
    runStatus,
    ...(jobId === undefined ? {} : { jobId }),
  })
}

function configuredModelIdentity(): string {
  const baseUrl = process.env.DSH_EVOLVE_MODEL_BASE_URL
  const model = process.env.DSH_EVOLVE_MODEL_NAME
  if (baseUrl === undefined || baseUrl.trim() === '' || model === undefined || model.trim() === '') {
    throw new Error('feedback Shadow requires DSH_EVOLVE_MODEL_BASE_URL and DSH_EVOLVE_MODEL_NAME')
  }
  return sha256(JSON.stringify({ baseUrl, model }))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isMissingPathError(error: unknown): boolean {
  const candidate = error instanceof Error && error.cause !== undefined ? error.cause : error
  return typeof candidate === 'object'
    && candidate !== null
    && 'code' in candidate
    && candidate.code === 'ENOENT'
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}

function boundedOutput(value: string): string {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= 2_048) return value
  return `${bytes.subarray(0, 2_016).toString('utf8')}\n[output truncated]`
}
