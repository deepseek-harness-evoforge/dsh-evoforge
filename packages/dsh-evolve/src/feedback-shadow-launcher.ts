import { createHash } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import { hashTree } from './hash.ts'
import { loadShadowRunState, type ShadowRunState } from './shadow-run-state.ts'
import { runShadow, type ShadowOptions } from './shadow.ts'
import type { AutomaticEvolutionInflightStatus } from './automatic-evolution-inflight.ts'

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

export interface FeedbackShadowMonitoredTargetConfig {
  readonly id: string
  readonly skill: string
  readonly runRoot: string
}

export interface FeedbackShadowExactTargetConfig extends FeedbackShadowTargetConfig {
  readonly casePackHash: string
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
  readonly monitoredTargets?: readonly FeedbackShadowMonitoredTargetConfig[]
  readonly supervisorRunRoots: readonly string[]
  readonly drafts: () => Pick<FeedbackCaseDraftBuilder, 'create'> | undefined
  readonly source: Pick<GitSkillSource, 'resolveArtifact'>
  readonly runner?: (options: ShadowOptions) => ReturnType<typeof runShadow>
  readonly modelIdentity?: () => string
}

/** Explicit paid bridge from one exact feedback correction to existing Shadow evidence. */
export class FeedbackShadowLauncher {
  private readonly targetsById = new Map<string, FeedbackShadowTargetConfig>()
  private readonly runTargetsById = new Map<string, FeedbackShadowMonitoredTargetConfig>()
  private readonly drafts: FeedbackShadowLauncherOptions['drafts']
  private readonly source: FeedbackShadowLauncherOptions['source']
  private readonly runner: NonNullable<FeedbackShadowLauncherOptions['runner']>
  private readonly modelIdentity: NonNullable<FeedbackShadowLauncherOptions['modelIdentity']>
  private readonly active = new Map<string, FeedbackShadowLaunchReceipt>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: FeedbackShadowLauncherOptions) {
    const supervisorRoots = new Set(options.supervisorRunRoots.map(path => resolve(path)))
    const targetRoots = new Map<string, string>()
    const registerRunTarget = (input: FeedbackShadowMonitoredTargetConfig) => {
      if (!TARGET_ID.test(input.id) || !TARGET_ID.test(input.skill)) {
        throw new Error(`invalid feedback Shadow target '${input.id}'`)
      }
      if (!isAbsolute(input.runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' run root must be absolute`)
      }
      const runRoot = resolve(input.runRoot)
      if (!supervisorRoots.has(runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' must use one configured supervisor run root`)
      }
      const existing = this.runTargetsById.get(input.id)
      if (existing !== undefined) {
        if (existing.skill !== input.skill || existing.runRoot !== runRoot) {
          throw new Error(`feedback Shadow target '${input.id}' conflicts with its monitored run target`)
        }
        return existing
      }
      const rootOwner = targetRoots.get(runRoot)
      if (rootOwner !== undefined) {
        throw new Error(`feedback Shadow targets '${rootOwner}' and '${input.id}' must use unique run roots`)
      }
      const target = Object.freeze({ id: input.id, skill: input.skill, runRoot })
      targetRoots.set(runRoot, input.id)
      this.runTargetsById.set(input.id, target)
      return target
    }
    for (const input of options.targets) {
      if (!isAbsolute(input.casePackDir) || !isAbsolute(input.runRoot)) {
        throw new Error(`feedback Shadow target '${input.id}' paths must be absolute`)
      }
      if (this.targetsById.has(input.id)) {
        throw new Error(`duplicate feedback Shadow target '${input.id}'`)
      }
      const monitored = registerRunTarget(input)
      this.targetsById.set(input.id, Object.freeze({
        id: input.id,
        skill: input.skill,
        casePackDir: resolve(input.casePackDir),
        runRoot: monitored.runRoot,
      }))
    }
    for (const input of options.monitoredTargets ?? []) registerRunTarget(input)
    if (this.runTargetsById.size === 0 || this.runTargetsById.size > MAX_TARGETS) {
      throw new Error(`feedback Shadow requires between 1 and ${MAX_TARGETS} observed targets`)
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
    const target = this.targetsById.get(targetId)
    if (target === undefined) throw new Error(`unknown feedback Shadow target '${targetId}'`)
    return this.launchTarget(signalId, target)
  }

  async launchExact(
    signalId: string,
    input: FeedbackShadowExactTargetConfig,
  ): Promise<FeedbackShadowLaunchReceipt> {
    return this.launchExactWithPolicy(signalId, input, false)
  }

  async launchAutomaticExact(
    signalId: string,
    input: FeedbackShadowExactTargetConfig,
  ): Promise<FeedbackShadowLaunchReceipt> {
    return this.launchExactWithPolicy(signalId, input, true)
  }

  private async launchExactWithPolicy(
    signalId: string,
    input: FeedbackShadowExactTargetConfig,
    holdUncertainProposal: boolean,
  ): Promise<FeedbackShadowLaunchReceipt> {
    if (!CONTENT_ID.test(input.casePackHash)) {
      throw new Error('qualified feedback Shadow Case Pack hash must be a full 64-character id')
    }
    const monitored = this.runTargetsById.get(input.id)
    if (monitored === undefined) throw new Error(`unknown monitored feedback Shadow target '${input.id}'`)
    if (monitored.skill !== input.skill) {
      throw new Error(`feedback Shadow target '${input.id}' does not match its configured Skill`)
    }
    if (!isAbsolute(input.casePackDir) || !isAbsolute(input.runRoot)) {
      throw new Error(`feedback Shadow target '${input.id}' paths must be absolute`)
    }
    if (resolve(input.runRoot) !== monitored.runRoot) {
      throw new Error(`feedback Shadow target '${input.id}' does not match its configured run root`)
    }
    return this.launchTarget(signalId, Object.freeze({
      id: input.id,
      skill: input.skill,
      casePackDir: resolve(input.casePackDir),
      runRoot: monitored.runRoot,
    }), input.casePackHash, holdUncertainProposal)
  }

  private async launchTarget(
    signalId: string,
    target: FeedbackShadowTargetConfig,
    expectedCasePackHash?: string,
    holdUncertainProposal = false,
  ): Promise<FeedbackShadowLaunchReceipt> {
    if (!CONTENT_ID.test(signalId)) throw new Error('feedback signal id must be a full 64-character id')
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
    if (expectedCasePackHash !== undefined && casePackHash !== expectedCasePackHash) {
      throw new Error('feedback Shadow Case Pack does not match its qualified hash')
    }
    const draft = await drafts.create(signalId, target.skill)
    const resolvedSkill = await this.source.resolveArtifact(target.skill, draft.draft.target.artifact)
    if (resolvedSkill.artifact.treeHash !== draft.draft.target.artifact.treeHash) {
      throw new Error('resolved feedback Shadow Skill does not match its private draft')
    }
    const launchId = sha256(JSON.stringify({
      signalId,
      draftId: draft.draft.id,
      targetId: target.id,
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
      if (holdUncertainProposal && existing.phase === 'proposal-pending') {
        return receipt(launchId, target, existing.phase)
      }
      resume = true
    }

    const controller = new AbortController()
    const invocation: ShadowOptions = {
      casePackDir,
      ...(expectedCasePackHash === undefined ? {} : { expectedCasePackHash }),
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
    const scan = await this.scanRuns()
    return {
      runs: scan.runs.slice(0, MAX_RUNS).map(row => row.view),
      warningCount: scan.warningCount,
    }
  }

  async automaticInflightStatus(
    skillName: string,
    signalId: string,
  ): Promise<AutomaticEvolutionInflightStatus> {
    const scan = await this.scanRuns(skillName)
    if (scan.targetCount === 0) return 'clear'
    if (scan.warningCount > 0) return 'unknown'
    return scan.runs.some(row => row.view.phase !== 'complete'
      && row.view.phase !== 'incomplete'
      && !(row.feedbackSignalId === signalId
        && (row.view.phase === 'prepared' || row.view.phase === 'proposal-pending')))
      ? 'busy'
      : 'clear'
  }

  private async scanRuns(skillName?: string): Promise<{
    runs: Array<{ view: FeedbackShadowRunView; feedbackSignalId?: string }>
    warningCount: number
    targetCount: number
  }> {
    const runs: Array<{ view: FeedbackShadowRunView; feedbackSignalId?: string }> = []
    let warningCount = 0
    let targetCount = 0
    for (const target of this.runTargetsById.values()) {
      if (skillName !== undefined && target.skill !== skillName) continue
      targetCount += 1
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
          runs.push({
            view: Object.freeze({
              launchId: entry.name,
              targetId: target.id,
              skillName: state.identity.skillName,
              phase: state.phase,
              startedAt: state.startedAt,
              updatedAt: state.updatedAt,
            }),
            ...(state.feedbackSignalId === undefined
              ? {}
              : { feedbackSignalId: state.feedbackSignalId }),
          })
        } catch {
          warningCount += 1
        }
      }
    }
    runs.sort((left, right) => right.view.updatedAt.localeCompare(left.view.updatedAt)
      || left.view.launchId.localeCompare(right.view.launchId))
    return { runs, warningCount, targetCount }
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
