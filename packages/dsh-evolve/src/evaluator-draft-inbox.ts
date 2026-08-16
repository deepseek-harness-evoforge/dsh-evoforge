import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import { z } from 'zod'
import { calibrateCasePack, type CasePackCalibrationResult } from './case-pack-calibration.ts'
import type { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import type {
  FeedbackShadowLauncher,
  FeedbackShadowLaunchReceipt,
} from './feedback-shadow-launcher.ts'
import { hashTree, sha256 } from './hash.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const TARGET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_TARGETS = 20
const MAX_ROWS = 20
const MAX_FILE_BYTES = 32 * 1024
const MAX_TOTAL_BYTES = 64 * 1024
const MAX_NOTE_BYTES = 2 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 1_600

const MODEL_FIELDS = ['evaluatorSource', 'knownCorrectionSkill', 'searchEvidence', 'usage'] as const
const modelResultSchema = z.strictObject({
  searchEvidence: z.string().min(1),
  knownCorrectionSkill: z.string().min(1),
  evaluatorSource: z.string().min(1),
  usage: z.strictObject({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
})

const FIXED_FILES = [
  'calibration/known-bad/SKILL.md',
  'calibration/known-correction/SKILL.md',
  'final-test/evaluator.mjs',
  'manifest.json',
  'search/evidence.md',
] as const

export interface EvaluatorDraftTargetConfig {
  readonly id: string
  readonly skill: string
  readonly root: string
  readonly dshRevision: string
  readonly shadowRunRoot?: string
}

export type EvaluatorDraftStatus =
  | 'authoring-pending'
  | 'uncertain'
  | 'draft-ready'
  | 'qualification-running'
  | 'qualified'
  | 'incomplete'
  | 'rejected'

export interface EvaluatorDraftTargetView {
  readonly id: string
  readonly skillName: string
}

export interface EvaluatorDraftView {
  readonly id: string
  readonly launchId: string
  readonly targetId: string
  readonly skillName: string
  readonly status: EvaluatorDraftStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly cost: {
    readonly modelCalls: 0 | 1
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export interface EvaluatorDraftDetail extends EvaluatorDraftView {
  readonly files: readonly { readonly path: string; readonly content: string }[]
  readonly limitations: readonly string[]
  readonly qualifiedShadowAvailable: boolean
  readonly decision?: {
    readonly actor: 'human'
    readonly note: string
    readonly decidedAt: string
  }
  readonly qualification?: {
    readonly calibrated: boolean
    readonly attempt: number
  }
  readonly reason?: string
}

export interface EvaluatorDraftScan {
  readonly drafts: readonly EvaluatorDraftView[]
  readonly warningCount: number
}

export interface EvaluatorDraftReceipt {
  readonly schemaVersion: 1
  readonly action: 'author-evaluator' | 'approve-evaluator' | 'reject-evaluator'
  readonly launchId: string
  readonly draftId?: string
  readonly targetId: string
  readonly skillName: string
  readonly draftStatus: 'scheduled' | EvaluatorDraftStatus
  readonly jobId?: string
}

export interface EvaluatorAuthorInput {
  readonly idempotencyKey: string
  readonly signalId: string
  readonly sourceDraftId: string
  readonly targetId: string
  readonly skillName: string
  readonly skillSource: string
  readonly userText: string
  readonly correction: string
  readonly dshRevision: string
  readonly signal?: AbortSignal
}

export interface EvaluatorAuthorResult {
  readonly searchEvidence: string
  readonly knownCorrectionSkill: string
  readonly evaluatorSource: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

interface EvaluatorDraftInboxOptions {
  readonly targets: readonly EvaluatorDraftTargetConfig[]
  readonly drafts: () => Pick<FeedbackCaseDraftBuilder, 'create'> | undefined
  readonly source: Pick<GitSkillSource, 'resolveArtifact'>
  readonly authorModel?: (input: EvaluatorAuthorInput) => Promise<EvaluatorAuthorResult>
  readonly qualify?: (options: {
    casePackDir: string
    outputDir: string
    signal?: AbortSignal
  }) => Promise<CasePackCalibrationResult>
  readonly modelIdentity?: () => string
  readonly shadow?: Pick<FeedbackShadowLauncher, 'available' | 'launchExact'>
}

interface EvaluatorRunState {
  readonly schemaVersion: 1
  readonly launchId: string
  readonly phase:
    | 'prepared'
    | 'authoring-pending'
    | 'uncertain'
    | 'draft-ready'
    | 'qualification-running'
    | 'qualified'
    | 'incomplete'
    | 'rejected'
  readonly createdAt: string
  readonly updatedAt: string
  readonly identity: {
    readonly signalId: string
    readonly sourceDraftId: string
    readonly targetId: string
    readonly skillName: string
    readonly skillTreeHash: string
    readonly modelIdentity: string
    readonly dshRevision: string
  }
  readonly draftId?: string
  readonly packHash?: string
  readonly cost: {
    readonly modelCalls: 0 | 1
    readonly inputTokens: number
    readonly outputTokens: number
  }
  readonly decision?: {
    readonly actor: 'human'
    readonly note: string
    readonly decidedAt: string
  }
  readonly qualification?: {
    readonly calibrated: boolean
    readonly attempt: number
    readonly reportPath: string
  } | undefined
  readonly reason?: string | undefined
}

/** Private host-only inbox for generated evaluator proposals and their human qualification. */
export class EvaluatorDraftInbox {
  private readonly targetsById = new Map<string, EvaluatorDraftTargetConfig>()
  private readonly drafts: EvaluatorDraftInboxOptions['drafts']
  private readonly source: EvaluatorDraftInboxOptions['source']
  private readonly authorModel: NonNullable<EvaluatorDraftInboxOptions['authorModel']>
  private readonly qualify: NonNullable<EvaluatorDraftInboxOptions['qualify']>
  private readonly modelIdentity: NonNullable<EvaluatorDraftInboxOptions['modelIdentity']>
  private readonly shadow: EvaluatorDraftInboxOptions['shadow']
  private readonly active = new Map<string, EvaluatorDraftReceipt>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(options: EvaluatorDraftInboxOptions) {
    if (options.targets.length === 0 || options.targets.length > MAX_TARGETS) {
      throw new Error(`evaluator authoring requires between 1 and ${MAX_TARGETS} targets`)
    }
    const roots = new Set<string>()
    for (const input of options.targets) {
      if (!TARGET_ID.test(input.id) || !TARGET_ID.test(input.skill)) {
        throw new Error(`invalid evaluator target '${input.id}'`)
      }
      if (!isAbsolute(input.root) || dirname(resolve(input.root)) === resolve(input.root)) {
        throw new Error(`evaluator target '${input.id}' root must be an absolute non-root path`)
      }
      if (!GIT_OBJECT.test(input.dshRevision)) {
        throw new Error(`evaluator target '${input.id}' must pin an exact DSH revision`)
      }
      if (input.shadowRunRoot !== undefined
        && (!isAbsolute(input.shadowRunRoot)
          || dirname(resolve(input.shadowRunRoot)) === resolve(input.shadowRunRoot))) {
        throw new Error(`evaluator target '${input.id}' shadow run root must be an absolute non-root path`)
      }
      if (this.targetsById.has(input.id)) throw new Error(`duplicate evaluator target '${input.id}'`)
      const root = resolve(input.root)
      if (roots.has(root)) throw new Error(`evaluator target '${input.id}' must have a unique owned root`)
      roots.add(root)
      this.targetsById.set(input.id, Object.freeze({
        ...input,
        root,
        ...(input.shadowRunRoot === undefined
          ? {}
          : { shadowRunRoot: resolve(input.shadowRunRoot) }),
      }))
    }
    this.drafts = options.drafts
    this.source = options.source
    this.authorModel = options.authorModel ?? requestEvaluatorAuthor
    this.qualify = options.qualify ?? calibrateCasePack
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
    this.shadow = options.shadow
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('evaluator authoring Jobs seam is already attached')
    this.jobs = jobs
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  available(): boolean {
    return this.jobs !== undefined && this.drafts() !== undefined
  }

  targets(): EvaluatorDraftTargetView[] {
    return [...this.targetsById.values()].map(target => Object.freeze({
      id: target.id,
      skillName: target.skill,
    }))
  }

  async author(signalId: string, targetId: string): Promise<EvaluatorDraftReceipt> {
    if (!CONTENT_ID.test(signalId)) throw new Error('feedback signal id must be a full 64-character id')
    const target = this.requireTarget(targetId)
    const jobs = this.jobs
    if (jobs === undefined) throw new Error('native Jobs is unavailable for evaluator authoring')
    const drafts = this.drafts()
    if (drafts === undefined) throw new Error('private Feedback Case Draft creation is unavailable')

    await ensureOwnedRoot(target.root)
    const sourceDraft = await drafts.create(signalId, target.skill)
    const resolved = await this.source.resolveArtifact(target.skill, sourceDraft.draft.target.artifact)
    if (resolved.artifact.treeHash !== sourceDraft.draft.target.artifact.treeHash) {
      throw new Error('resolved evaluator target Skill does not match its private draft')
    }
    const skillSource = await readSingleFileSkill(resolved.resourceBase, target.skill)
    const skillTreeHash = await hashTree(resolved.resourceBase)
    if (skillTreeHash !== sourceDraft.draft.target.contentHash) {
      throw new Error('resolved evaluator target Skill content changed after Feedback Case Draft creation')
    }
    const modelIdentity = this.modelIdentity()
    if (modelIdentity.trim() === '') throw new Error('evaluator authoring model identity must not be empty')
    const identity: EvaluatorRunState['identity'] = {
      signalId,
      sourceDraftId: sourceDraft.draft.id,
      targetId,
      skillName: target.skill,
      skillTreeHash,
      modelIdentity,
      dshRevision: target.dshRevision,
    }
    const launchId = sha256(JSON.stringify(identity))
    const active = this.active.get(launchId)
    if (active !== undefined) return active

    const runDir = join(target.root, 'runs', launchId)
    const existing = await loadStateIfPresent(runDir)
    if (existing !== undefined) {
      assertIdentity(existing, identity)
      if (existing.phase !== 'prepared') {
        return receiptFromState(existing, target, existing.phase === 'authoring-pending' ? 'uncertain' : existing.phase)
      }
    }

    let initial = existing
    if (initial === undefined) {
      await mkdir(runDir, { recursive: true, mode: 0o700 })
      const now = new Date().toISOString()
      initial = {
        schemaVersion: 1,
        launchId,
        phase: 'prepared',
        createdAt: now,
        updatedAt: now,
        identity,
        cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
      }
      await saveState(runDir, initial)
    }
    const controller = new AbortController()
    let jobId: JobId
    jobId = jobs.start({
      kind: 'evolution',
      label: `evaluator authoring: ${target.id}`,
      outputLimitBytes: 2_048,
      run: () => {
        const task = this.runAuthoring({
          controller,
          identity,
          initial,
          runDir,
          skillSource,
          sourceDraft,
          target,
        })
        return {
          cancel: (reason?: string) => controller.abort(new Error(reason ?? 'evaluator authoring cancelled')),
          done: task.then(state => ({
            status: state.phase === 'draft-ready' ? 'completed' as const : 'failed' as const,
            detail: state.phase,
            output: state.draftId === undefined ? state.phase : `${state.phase}: ${state.draftId}`,
          })).finally(() => {
            this.active.delete(launchId)
          }),
        }
      },
    })
    const submitted: EvaluatorDraftReceipt = Object.freeze({
      schemaVersion: 1,
      action: 'author-evaluator',
      launchId,
      targetId,
      skillName: target.skill,
      draftStatus: 'scheduled',
      jobId: String(jobId),
    })
    this.active.set(launchId, submitted)
    return submitted
  }

  async scan(): Promise<EvaluatorDraftScan> {
    const drafts: EvaluatorDraftView[] = []
    let warningCount = 0
    for (const target of this.targetsById.values()) {
      let entries
      const runsRoot = join(target.root, 'runs')
      try {
        entries = await readdir(runsRoot, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        warningCount += 1
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const state = await loadState(join(runsRoot, entry.name))
          if (state.identity.targetId !== target.id || state.identity.skillName !== target.skill) {
            warningCount += 1
            continue
          }
          drafts.push(projectState(state, this.active.has(state.launchId)))
        } catch {
          warningCount += 1
        }
      }
    }
    drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id))
    return { drafts: drafts.slice(0, MAX_ROWS), warningCount }
  }

  async get(draftId: string): Promise<EvaluatorDraftDetail> {
    if (!CONTENT_ID.test(draftId)) throw new Error('evaluator draft id must be a full 64-character id')
    const located = await this.findById(draftId)
    const view = projectState(located.state, this.active.has(located.state.launchId))
    const files = await readAndVerifyPack(located.target, located.state)
    return Object.freeze({
      ...view,
      files,
      limitations: Object.freeze([
        'Generated evaluator code is inactive until a separate human approval and sealed qualification succeed.',
        'Qualification proves only known-bad fail and known-correction pass for this exact hash.',
        'A Qualified Case Pack cannot modify a Skill, start Shadow, or authorize Promotion.',
      ]),
      qualifiedShadowAvailable: located.state.phase === 'qualified'
        && located.target.shadowRunRoot !== undefined
        && this.shadow?.available() === true,
      ...(located.state.decision === undefined ? {} : { decision: { ...located.state.decision } }),
      ...(located.state.qualification === undefined
        ? {}
        : {
            qualification: {
              calibrated: located.state.qualification.calibrated,
              attempt: located.state.qualification.attempt,
            },
          }),
      ...(located.state.reason === undefined ? {} : { reason: located.state.reason }),
    })
  }

  async approve(draftId: string, note: string): Promise<EvaluatorDraftReceipt> {
    enforceNote(note)
    const located = await this.findById(draftId)
    let state = located.state
    if (state.phase === 'qualified') return receiptFromState(state, located.target, 'qualified', 'approve-evaluator')
    if (state.phase === 'rejected') throw new Error('rejected evaluator draft cannot be approved')
    if (!['draft-ready', 'qualification-running', 'incomplete'].includes(state.phase)) {
      throw new Error(`evaluator draft cannot be approved from ${state.phase}`)
    }
    if (state.draftId === undefined || state.packHash === undefined) {
      throw new Error('incomplete evaluator authoring produced no draft to qualify')
    }
    const draftDir = join(located.target.root, 'drafts', draftId)
    if (await hashTree(draftDir) !== state.packHash) {
      state = await updateState(located.runDir, state, {
        phase: 'incomplete',
        reason: 'evaluator draft changed after authoring',
      })
      throw new Error(state.reason)
    }
    const attempt = (state.qualification?.attempt ?? 0) + 1
    const decision = state.decision ?? {
      actor: 'human' as const,
      note: note.trim(),
      decidedAt: new Date().toISOString(),
    }
    const outputDir = join(located.target.root, 'qualification', draftId, `attempt-${attempt}`)
    state = await updateState(located.runDir, state, {
      phase: 'qualification-running',
      decision,
      qualification: {
        calibrated: false,
        attempt,
        reportPath: join(outputDir, 'calibration-report.json'),
      },
      reason: undefined,
    })
    let result: CasePackCalibrationResult
    try {
      await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 })
      result = await this.qualify({ casePackDir: draftDir, outputDir })
    } catch (error) {
      await updateState(located.runDir, state, {
        phase: 'incomplete',
        reason: errorDetail(error),
      })
      throw error
    }
    if (await hashTree(draftDir) !== state.packHash) {
      await updateState(located.runDir, state, {
        phase: 'incomplete',
        reason: 'evaluator draft changed during qualification',
      })
      throw new Error('evaluator draft changed during qualification')
    }
    if (result.status !== 'calibrated') {
      await updateState(located.runDir, state, {
        phase: 'incomplete',
        qualification: { calibrated: false, attempt, reportPath: result.reportPath },
        reason: result.reason,
      })
      throw new Error(`evaluator qualification failed: ${result.reason}`)
    }
    await publishQualifiedPack(located.target.root, draftId, draftDir, state.packHash!)
    state = await updateState(located.runDir, state, {
      phase: 'qualified',
      qualification: { calibrated: true, attempt, reportPath: result.reportPath },
      reason: undefined,
    })
    return receiptFromState(state, located.target, 'qualified', 'approve-evaluator')
  }

  async reject(draftId: string, note: string): Promise<EvaluatorDraftReceipt> {
    enforceNote(note)
    const located = await this.findById(draftId)
    if (located.state.phase === 'qualified') throw new Error('qualified evaluator draft cannot be rejected')
    if (located.state.phase === 'rejected') {
      return receiptFromState(located.state, located.target, 'rejected', 'reject-evaluator')
    }
    const state = await updateState(located.runDir, located.state, {
      phase: 'rejected',
      decision: {
        actor: 'human',
        note: note.trim(),
        decidedAt: new Date().toISOString(),
      },
    })
    return receiptFromState(state, located.target, 'rejected', 'reject-evaluator')
  }

  async startShadow(draftId: string): Promise<FeedbackShadowLaunchReceipt> {
    const located = await this.findById(draftId)
    const state = located.state
    if (state.phase !== 'qualified' || state.draftId === undefined || state.packHash === undefined) {
      throw new Error('Evaluator Draft must be qualified before starting Shadow')
    }
    if (located.target.shadowRunRoot === undefined) {
      throw new Error(`evaluator target '${located.target.id}' has no qualified Shadow run root`)
    }
    if (this.shadow === undefined || !this.shadow.available()) {
      throw new Error('native Jobs and private Feedback Case Draft creation are unavailable for qualified Shadow')
    }
    const draftDir = join(located.target.root, 'drafts', state.draftId)
    if (await hashTree(draftDir) !== state.packHash) {
      throw new Error('Evaluator Draft changed after qualification')
    }
    const casePackDir = join(located.target.root, 'qualified', state.draftId)
    if (await hashTree(casePackDir) !== state.packHash) {
      throw new Error('Qualified Case Pack changed after publication')
    }
    return this.shadow.launchExact(state.identity.signalId, {
      id: located.target.id,
      skill: located.target.skill,
      casePackDir,
      casePackHash: state.packHash,
      runRoot: located.target.shadowRunRoot,
    })
  }

  /** Qualify one exact Draft, then start its paid Shadow only after calibration succeeds. */
  async approveAndStartShadow(
    draftId: string,
    note: string,
  ): Promise<FeedbackShadowLaunchReceipt> {
    await this.approve(draftId, note)
    return this.startShadow(draftId)
  }

  private async runAuthoring(options: {
    controller: AbortController
    identity: EvaluatorRunState['identity']
    initial: EvaluatorRunState
    runDir: string
    skillSource: string
    sourceDraft: Awaited<ReturnType<FeedbackCaseDraftBuilder['create']>>
    target: EvaluatorDraftTargetConfig
  }): Promise<EvaluatorRunState> {
    let state = await updateState(options.runDir, options.initial, {
      phase: 'authoring-pending',
      cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
    })
    let received = false
    try {
      const result = await this.authorModel({
        idempotencyKey: state.launchId,
        signalId: options.identity.signalId,
        sourceDraftId: options.identity.sourceDraftId,
        targetId: options.identity.targetId,
        skillName: options.identity.skillName,
        skillSource: options.skillSource,
        userText: options.sourceDraft.draft.sample.userText,
        correction: options.sourceDraft.draft.sample.correction,
        dshRevision: options.identity.dshRevision,
        signal: options.controller.signal,
      })
      received = true
      const proposal = validateModelResult(result, options.identity.skillName)
      const draftId = sha256(JSON.stringify({
        identity: options.identity,
        knownBadSkill: options.skillSource,
        searchEvidence: proposal.searchEvidence,
        knownCorrectionSkill: proposal.knownCorrectionSkill,
        evaluatorSource: proposal.evaluatorSource,
      }))
      const files = buildFiles(draftId, options.identity, options.skillSource, proposal)
      const draftDir = join(options.target.root, 'drafts', draftId)
      await installPack(draftDir, files)
      const packHash = await hashTree(draftDir)
      state = await updateState(options.runDir, state, {
        phase: 'draft-ready',
        draftId,
        packHash,
        cost: {
          modelCalls: 1,
          inputTokens: proposal.usage.inputTokens,
          outputTokens: proposal.usage.outputTokens,
        },
      })
      return state
    } catch (error) {
      const phase = received || error instanceof ObservedAuthoringResponseError
        ? 'incomplete' as const
        : 'uncertain' as const
      return updateState(options.runDir, state, {
        phase,
        reason: phase === 'uncertain'
          ? `paid authoring outcome is uncertain; refusing automatic retry: ${errorDetail(error)}`
          : errorDetail(error),
      })
    }
  }

  private requireTarget(id: string): EvaluatorDraftTargetConfig {
    const target = this.targetsById.get(id)
    if (target === undefined) throw new Error(`unknown evaluator target '${id}'`)
    return target
  }

  private async findById(id: string): Promise<{
    target: EvaluatorDraftTargetConfig
    runDir: string
    state: EvaluatorRunState
  }> {
    const matches: Array<{
      target: EvaluatorDraftTargetConfig
      runDir: string
      state: EvaluatorRunState
    }> = []
    for (const target of this.targetsById.values()) {
      const runsRoot = join(target.root, 'runs')
      let entries
      try {
        entries = await readdir(runsRoot, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        const runDir = join(runsRoot, entry.name)
        const state = await loadState(runDir)
        if (state.draftId === id || state.launchId === id) matches.push({ target, runDir, state })
      }
    }
    if (matches.length === 0) throw new Error('evaluator draft does not exist')
    if (matches.length !== 1) throw new Error('evaluator draft id is ambiguous across configured targets')
    return matches[0]!
  }
}

function validateModelResult(result: EvaluatorAuthorResult, skillName: string): EvaluatorAuthorResult {
  const parsed = modelResultSchema.parse(result)
  const keys = Object.keys(result).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...MODEL_FIELDS].sort())) {
    throw new Error('evaluator author response contains unsupported fields')
  }
  enforceFileBound('search evidence', parsed.searchEvidence)
  enforceFileBound('known correction Skill', parsed.knownCorrectionSkill)
  enforceFileBound('evaluator source', parsed.evaluatorSource)
  if (skillNameFromSource(parsed.knownCorrectionSkill) !== skillName) {
    throw new Error('known correction Skill name does not match the target')
  }
  return parsed
}

function buildFiles(
  draftId: string,
  identity: EvaluatorRunState['identity'],
  knownBadSkill: string,
  proposal: EvaluatorAuthorResult,
): Readonly<Record<(typeof FIXED_FILES)[number], string>> {
  const manifest = {
    schemaVersion: 1,
    id: draftId,
    epoch: {
      dshRevision: identity.dshRevision,
      evaluatorVersion: `evaluator-draft-${draftId}`,
    },
    budget: {
      candidateLimit: 1,
      trialLimit: 4,
      inputTokenLimit: 12_000,
      outputTokenLimit: AUTHOR_OUTPUT_TOKEN_LIMIT,
    },
    search: { evidence: 'search/evidence.md' },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 15_000,
      outputLimitBytes: 65_536,
      dshAssembled: true,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }
  const files = {
    'calibration/known-bad/SKILL.md': knownBadSkill,
    'calibration/known-correction/SKILL.md': proposal.knownCorrectionSkill,
    'final-test/evaluator.mjs': proposal.evaluatorSource,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'search/evidence.md': proposal.searchEvidence,
  } as const
  let total = 0
  for (const path of FIXED_FILES) {
    enforceFileBound(path, files[path])
    total += Buffer.byteLength(files[path])
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`evaluator draft exceeds ${MAX_TOTAL_BYTES} UTF-8 bytes`)
  return files
}

async function installPack(
  target: string,
  files: Readonly<Record<(typeof FIXED_FILES)[number], string>>,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const stage = join(dirname(target), `.draft-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    for (const path of FIXED_FILES) {
      const destination = join(stage, ...path.split('/'))
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, files[path], { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    }
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const [existingHash, stageHash] = await Promise.all([hashTree(target), hashTree(stage)])
      if (existingHash !== stageHash) throw new Error('content-addressed evaluator draft collision')
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function publishQualifiedPack(root: string, draftId: string, source: string, packHash: string): Promise<void> {
  const parent = join(root, 'qualified')
  const target = join(parent, draftId)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  try {
    if (await hashTree(target) !== packHash) throw new Error('qualified evaluator pack hash mismatch')
    return
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const stage = join(parent, `.qualified-${randomUUID()}`)
  try {
    await cp(source, stage, { recursive: true, errorOnExist: true, force: false })
    if (await hashTree(stage) !== packHash) throw new Error('qualified evaluator staging hash mismatch')
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      if (await hashTree(target) !== packHash) throw new Error('qualified evaluator pack collision')
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function readAndVerifyPack(
  target: EvaluatorDraftTargetConfig,
  state: EvaluatorRunState,
): Promise<readonly { path: string; content: string }[]> {
  if (state.draftId === undefined || state.packHash === undefined) return []
  const root = join(target.root, 'drafts', state.draftId)
  if (await hashTree(root) !== state.packHash) throw new Error('evaluator draft changed after authoring')
  const files = []
  let total = 0
  for (const path of FIXED_FILES) {
    const source = await readFile(join(root, ...path.split('/')), 'utf8')
    enforceFileBound(path, source)
    total += Buffer.byteLength(source)
    files.push(Object.freeze({ path, content: source }))
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`evaluator draft exceeds ${MAX_TOTAL_BYTES} UTF-8 bytes`)
  return Object.freeze(files)
}

async function readSingleFileSkill(root: string, expectedName: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length !== 1 || entries[0]?.name !== 'SKILL.md' || !entries[0].isFile()) {
    throw new Error('evaluator authoring first slice requires an exact single-file Skill')
  }
  const path = join(root, 'SKILL.md')
  if (!(await lstat(path)).isFile()) throw new Error('evaluator target SKILL.md must be a regular file')
  const source = await readFile(path, 'utf8')
  enforceFileBound('known-bad Skill', source)
  if (skillNameFromSource(source) !== expectedName) {
    throw new Error('evaluator target SKILL.md name does not match the configured target')
  }
  return source
}

function skillNameFromSource(source: string): string {
  const match = /^---\n[\s\S]*?^name:\s*([^\n]+)$/m.exec(source)
  if (match?.[1] === undefined) throw new Error('SKILL.md frontmatter must declare name')
  return match[1].trim()
}

function projectState(state: EvaluatorRunState, active: boolean): EvaluatorDraftView {
  const status = state.phase === 'prepared'
    ? 'authoring-pending'
    : state.phase === 'authoring-pending' && !active
      ? 'uncertain'
      : state.phase
  return Object.freeze({
    id: state.draftId ?? state.launchId,
    launchId: state.launchId,
    targetId: state.identity.targetId,
    skillName: state.identity.skillName,
    status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    cost: { ...state.cost },
  })
}

function receiptFromState(
  state: EvaluatorRunState,
  target: EvaluatorDraftTargetConfig,
  status: EvaluatorDraftReceipt['draftStatus'],
  action: EvaluatorDraftReceipt['action'] = 'author-evaluator',
): EvaluatorDraftReceipt {
  return Object.freeze({
    schemaVersion: 1,
    action,
    launchId: state.launchId,
    ...(state.draftId === undefined ? {} : { draftId: state.draftId }),
    targetId: target.id,
    skillName: target.skill,
    draftStatus: status,
  })
}

async function updateState(
  runDir: string,
  current: EvaluatorRunState,
  patch: Partial<Omit<EvaluatorRunState, 'schemaVersion' | 'launchId' | 'identity' | 'createdAt'>>,
): Promise<EvaluatorRunState> {
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  } as EvaluatorRunState
  await saveState(runDir, next)
  return next
}

async function saveState(runDir: string, state: EvaluatorRunState): Promise<void> {
  await writeDurableJson(join(runDir, 'run-state.json'), state)
}

async function loadStateIfPresent(runDir: string): Promise<EvaluatorRunState | undefined> {
  try {
    return await loadState(runDir)
  } catch (error) {
    if (isMissing(error) || (error instanceof Error && isMissing(error.cause))) return undefined
    throw error
  }
}

async function loadState(runDir: string): Promise<EvaluatorRunState> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(runDir, 'run-state.json'), 'utf8'))
  } catch (error) {
    throw new Error('evaluator authoring run requires a readable run-state.json', { cause: error })
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.launchId !== 'string'
    || !CONTENT_ID.test(value.launchId)
    || typeof value.phase !== 'string'
    || !['prepared', 'authoring-pending', 'uncertain', 'draft-ready', 'qualification-running', 'qualified', 'incomplete', 'rejected'].includes(value.phase)
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !isRecord(value.identity)
    || !isRecord(value.cost)) {
    throw new Error('evaluator authoring run state has an invalid shape')
  }
  return value as unknown as EvaluatorRunState
}

function assertIdentity(state: EvaluatorRunState, identity: EvaluatorRunState['identity']): void {
  if (JSON.stringify(state.identity) !== JSON.stringify(identity)) {
    throw new Error('evaluator authoring resume inputs do not match durable identity')
  }
}

async function ensureOwnedRoot(root: string): Promise<void> {
  try {
    const existing = await lstat(root)
    if (existing.isSymbolicLink()) throw new Error('evaluator target root must not be a symlink')
    if (!existing.isDirectory()) throw new Error('evaluator target root must be a directory')
  } catch (error) {
    if (!isMissing(error)) throw error
    await mkdir(root, { recursive: true, mode: 0o700 })
  }
  await chmod(root, 0o700)
}

function enforceFileBound(label: string, value: string): void {
  if (Buffer.byteLength(value) > MAX_FILE_BYTES) {
    throw new Error(`${label} exceeds ${MAX_FILE_BYTES} UTF-8 bytes`)
  }
}

function enforceNote(note: string): void {
  if (note.trim() === '') throw new Error('evaluator decision note must not be empty')
  if (Buffer.byteLength(note) > MAX_NOTE_BYTES) {
    throw new Error(`evaluator decision note exceeds ${MAX_NOTE_BYTES} UTF-8 bytes`)
  }
}

async function requestEvaluatorAuthor(input: EvaluatorAuthorInput): Promise<EvaluatorAuthorResult> {
  const baseUrl = requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL')
  const model = requireEnvironment('DSH_EVOLVE_MODEL_NAME')
  const apiKey = process.env.DSH_EVOLVE_MODEL_API_KEY
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey,
  }
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: AUTHOR_OUTPUT_TOKEN_LIMIT,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Author one deterministic regression evaluator for an explicitly corrected Skill failure.',
            'Return JSON only with exactly: searchEvidence, knownCorrectionSkill, evaluatorSource.',
            'The host owns manifest and known-bad. Do not request network, credentials, permissions, or extra files.',
            'The evaluator must use independently observable behavior and must not hard-code the supplied text.',
            'The host invokes evaluatorSource as: node evaluator.mjs <candidate-dir> <pinned-dsh-source-dir>.',
            'It must run a bounded real DSH assembly check and print exactly one JSON object shaped as:',
            '{"schemaVersion":1,"passed":boolean,"checks":[{"name":string,"passed":boolean}],"composition":{"fingerprint":"64 lowercase hex","modelCalls":nonnegative integer,"usage":{}}}.',
            'Do not emit markdown fences, comments, logs, or any output outside that JSON object.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Target id: ${input.targetId}`,
            `Skill: ${input.skillName}`,
            `Pinned DSH revision: ${input.dshRevision}`,
            `Current exact Skill:\n${input.skillSource}`,
            `Failing user request:\n${input.userText}`,
            `Explicit correction:\n${input.correction}`,
          ].join('\n\n'),
        },
      ],
    }),
    signal: input.signal === undefined
      ? AbortSignal.timeout(60_000)
      : AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) {
    throw new ObservedAuthoringResponseError(`evaluator author request failed with HTTP ${response.status}`)
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ObservedAuthoringResponseError('evaluator author response is not valid JSON')
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])
    || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== 'string') {
    throw new ObservedAuthoringResponseError('evaluator author response has no content')
  }
  let authored: unknown
  try {
    authored = JSON.parse(payload.choices[0].message.content)
  } catch {
    throw new ObservedAuthoringResponseError('evaluator author response content is not valid JSON')
  }
  if (!isRecord(authored)) {
    throw new ObservedAuthoringResponseError('evaluator author response has an invalid shape')
  }
  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    searchEvidence: authored.searchEvidence as string,
    knownCorrectionSkill: authored.knownCorrectionSkill as string,
    evaluatorSource: authored.evaluatorSource as string,
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
    ...Object.keys(authored).some(key => !['searchEvidence', 'knownCorrectionSkill', 'evaluatorSource'].includes(key))
      ? authored
      : {},
  } as EvaluatorAuthorResult
}

class ObservedAuthoringResponseError extends Error {}

function configuredModelIdentity(): string {
  return sha256(JSON.stringify({
    baseUrl: requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL'),
    model: requireEnvironment('DSH_EVOLVE_MODEL_NAME'),
    contract: 'evaluator-author-v1',
  }))
}

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`evaluator authoring requires ${name}`)
  return value
}

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/g, ' ').slice(0, 512) || 'unknown error'
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
