import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { assembleAgentSkillTextArchive, type AgentSkillTextManifestFile } from './agent-skill-archive.ts'
import type { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import { sha256 } from './hash.ts'
import type {
  ResearchSkillHoldoutResult,
  ResearchSkillRevisionInput,
} from './research-skill-holdout.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import type {
  DiscoveredSkillCandidate,
  MaterializedSkillCandidate,
  RevisedSkillBundleCandidateInput,
} from './trusted-skill-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const INSTRUCTION_FILE = /(?:^SKILL\.md$|\.md$)/iu
const MAX_TARGETS = 20
const MAX_CANDIDATE_BYTES = 256 * 1024
const MAX_MODEL_INPUT_BYTES = 384 * 1024
const MAX_MODEL_RESPONSE_BYTES = 128 * 1024
const MAX_STATE_BYTES = 64 * 1024
const REVISION_OUTPUT_TOKEN_LIMIT = 6_000
const POLICY_VERSION = 'research-holdout-one-shot-revision-v1'

export interface ResearchSkillRevisionTargetConfig {
  readonly id: string
  readonly workspaceId: string
  readonly skill: string
  readonly runRoot: string
  readonly maxAttemptsPerUtcDay: number
}

export interface ResearchSkillRevisionModelInput extends ResearchSkillRevisionInput {
  readonly idempotencyKey: string
  readonly targetId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly files: readonly AgentSkillTextManifestFile[]
  readonly signal?: AbortSignal
}

export interface ResearchSkillRevisionModelResult {
  readonly files: readonly AgentSkillTextManifestFile[]
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

interface ValidatedRevisionProposal extends ResearchSkillRevisionModelResult {
  readonly artifactDigest: string
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
}

export type ResearchSkillRevisionStatus =
  | 'cancelled'
  | 'budget-deferred'
  | 'uncertain'
  | 'incomplete'
  | 'candidate-ready'

export type ResearchSkillRevisionReason =
  | 'cancelled-before-dispatch'
  | 'daily-revision-budget-exhausted'
  | 'local-validation-failed'
  | 'paid-revision-outcome-uncertain'
  | 'invalid-reviser-response'
  | 'candidate-quarantine-failed'
  | 'revised-candidate-ready'

export interface ResearchSkillRevisionResult {
  readonly schemaVersion: 1
  readonly id: string
  readonly parentCandidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly targetId: string
  readonly status: ResearchSkillRevisionStatus
  readonly reason: ResearchSkillRevisionReason
  readonly holdoutResultId: string
  readonly researchDigest: string
  readonly parentTreeHash: string
  readonly inputDigest: string
  readonly reviserIdentityHash: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly cost: {
    readonly modelCalls: 0 | 1
    readonly inputTokens: number
    readonly outputTokens: number
  }
  readonly candidateId?: string
  readonly retryAt?: number
  readonly releaseAuthority: 'none'
}

export interface ResearchSkillRevisionScan {
  readonly configuredTargetCount: number
  readonly warningCount: number
  readonly runs: readonly ResearchSkillRevisionResult[]
}

interface ResearchSkillRevisionOptions {
  readonly targets: readonly ResearchSkillRevisionTargetConfig[]
  readonly holdout: {
    revisionInput(
      candidate: DiscoveredSkillCandidate,
      result: ResearchSkillHoldoutResult,
    ): Promise<ResearchSkillRevisionInput>
  }
  readonly candidates: {
    materialize(candidate: DiscoveredSkillCandidate, outputDir: string): Promise<MaterializedSkillCandidate>
    quarantineRevisedBundle(input: RevisedSkillBundleCandidateInput): Promise<{
      readonly created: boolean
      readonly candidate: DiscoveredSkillCandidate
    }>
  }
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly reviser?: (input: ResearchSkillRevisionModelInput) => Promise<ResearchSkillRevisionModelResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

interface ResolvedTarget extends ResearchSkillRevisionTargetConfig {
  readonly runRoot: string
}

interface RevisionIdentity {
  readonly schemaVersion: 1
  readonly id: string
  readonly parentCandidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly targetId: string
  readonly holdoutResultId: string
  readonly researchDigest: string
  readonly parentTreeHash: string
  readonly inputDigest: string
  readonly reviserIdentityHash: string
}

interface RevisionState extends RevisionIdentity {
  readonly phase: 'prepared' | 'revision-pending' | 'complete'
  readonly createdAt: string
  readonly updatedAt: string
}

/** Refuse a revision journal that could overlap Holdout, authoring, discovery, or governance inputs. */
export function assertResearchSkillRevisionRootSeparation(
  targets: readonly ResearchSkillRevisionTargetConfig[],
  protectedRoots: readonly string[],
): void {
  for (const target of targets) {
    const revisionRoot = resolve(target.runRoot)
    for (const input of protectedRoots) {
      if (!isAbsolute(input)) continue
      const protectedRoot = resolve(input)
      if (contains(revisionRoot, protectedRoot) || contains(protectedRoot, revisionRoot)) {
        throw new Error('research Skill revision roots must not overlap Holdout or governance roots')
      }
    }
  }
}

/** Every configured Holdout has exactly one bounded revision policy and vice versa. */
export function assertResearchSkillRevisionCoverage(
  revisions: readonly Pick<ResearchSkillRevisionTargetConfig, 'workspaceId' | 'skill'>[],
  holdouts: readonly { readonly workspaceId: string; readonly skill: string }[],
): void {
  const revised = new Set(revisions.map(value => targetKey(value.workspaceId, value.skill)))
  const held = new Set(holdouts.map(value => targetKey(value.workspaceId, value.skill)))
  if (revised.size !== revisions.length || held.size !== holdouts.length
    || revised.size !== held.size || [...revised].some(key => !held.has(key))) {
    throw new Error('research Skill revision targets must exactly cover independent Holdout targets')
  }
}

/**
 * Produce at most one bounded whole-Skill revision for an original v2 Candidate.
 * The service cannot install, activate, publish, release, or execute either Candidate.
 */
export class ResearchSkillRevision {
  private readonly targets = new Map<string, ResolvedTarget>()
  private readonly holdout: ResearchSkillRevisionOptions['holdout']
  private readonly candidates: ResearchSkillRevisionOptions['candidates']
  private readonly budget: ResearchSkillRevisionOptions['budget']
  private readonly reviser: NonNullable<ResearchSkillRevisionOptions['reviser']>
  private readonly modelIdentity: NonNullable<ResearchSkillRevisionOptions['modelIdentity']>
  private readonly now: NonNullable<ResearchSkillRevisionOptions['now']>

  constructor(options: ResearchSkillRevisionOptions) {
    assertTargets(options.targets)
    for (const input of options.targets) {
      this.targets.set(targetKey(input.workspaceId, input.skill), Object.freeze({
        ...input,
        runRoot: resolve(input.runRoot),
      }))
    }
    this.holdout = options.holdout
    this.candidates = options.candidates
    this.budget = options.budget
    this.reviser = options.reviser ?? requestResearchSkillRevision
    this.modelIdentity = options.modelIdentity ?? configuredRevisionModelIdentity
    this.now = options.now ?? Date.now
  }

  matches(
    candidate: DiscoveredSkillCandidate,
    result: ResearchSkillHoldoutResult,
  ): boolean {
    return isOriginalResearchCandidate(candidate)
      && (result.status === 'fail' || result.status === 'inconclusive')
      && result.candidateId === candidate.id
      && result.workspaceId === candidate.workspaceId
      && result.skillName === candidate.requestedSkill
      && result.researchDigest === candidate.version.researchDigest
      && result.candidateTreeHash === candidate.version.treeHash
      && this.targets.has(targetKey(candidate.workspaceId, candidate.requestedSkill))
  }

  async revise(
    candidate: DiscoveredSkillCandidate,
    holdoutResult: ResearchSkillHoldoutResult,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ResearchSkillRevisionResult> {
    const target = this.targets.get(targetKey(candidate.workspaceId, candidate.requestedSkill))
    if (target === undefined || !this.matches(candidate, holdoutResult)) {
      throw new Error('research Skill revision requires one original failed research-grounded Candidate')
    }
    if (!isOriginalResearchCandidate(candidate)) {
      throw new Error('research Skill revision requires one original failed research-grounded Candidate')
    }
    const version = candidate.version

    let handoff: ResearchSkillRevisionInput
    try {
      handoff = validateRevisionHandoff(
        await this.holdout.revisionInput(candidate, holdoutResult),
        candidate,
        holdoutResult,
      )
    } catch (error) {
      throw new Error(`research Skill revision requires exact durable Holdout findings: ${errorDetail(error)}`)
    }
    const modelIdentity = this.modelIdentity()
    if (modelIdentity.trim() === '' || Buffer.byteLength(modelIdentity) > 2_048) {
      throw new Error('research Skill revision model identity is invalid')
    }
    const inputDigest = sha256(JSON.stringify({
      parentCandidateId: handoff.parentCandidateId,
      parentTreeHash: handoff.parentTreeHash,
      holdoutResultId: handoff.holdoutResultId,
      researchDigest: handoff.researchDigest,
      findings: handoff.findings,
    }))
    const identity = makeIdentity(target, candidate, handoff, inputDigest, sha256(modelIdentity))
    const runDir = join(target.runRoot, 'runs', identity.id)
    let state = await prepareState(runDir, identity, this.now())
    const existing = await readExistingResult(runDir, identity)
    if (existing !== undefined
      && !(existing.status === 'budget-deferred'
        && existing.retryAt !== undefined
        && existing.retryAt <= this.now())) return existing
    if (state.phase === 'revision-pending') {
      return finish(runDir, state, makeResult(state, 'uncertain',
        'paid-revision-outcome-uncertain', oneCallCost()), this.now())
    }
    if (options.signal?.aborted) {
      return finish(runDir, state, makeResult(state, 'cancelled',
        'cancelled-before-dispatch', zeroCost()), this.now())
    }
    if (!isSafeOriginalCandidate(candidate)) {
      return finish(runDir, state, makeResult(state, 'incomplete',
        'local-validation-failed', zeroCost()), this.now())
    }

    let files: readonly AgentSkillTextManifestFile[]
    let materializationRoot: string | undefined
    try {
      materializationRoot = await mkdtemp(join(runDir, 'materialization-'))
      const materialized = await this.candidates.materialize(candidate, join(materializationRoot, 'parent'))
      files = await readCandidateFiles(candidate, materialized)
      assertModelInputBudget(target, handoff, files)
    } catch {
      return finish(runDir, state, makeResult(state, 'incomplete',
        'local-validation-failed', zeroCost()), this.now())
    } finally {
      if (materializationRoot !== undefined) {
        await rm(materializationRoot, { force: true, recursive: true }).catch(() => undefined)
      }
    }
    if (options.signal?.aborted) {
      return finish(runDir, state, makeResult(state, 'cancelled',
        'cancelled-before-dispatch', zeroCost()), this.now())
    }

    const reservation = await this.budget.reserve(target, identity.id)
    if (!reservation.allowed) {
      return finish(runDir, state, makeResult(state, 'budget-deferred',
        'daily-revision-budget-exhausted', zeroCost(), undefined, reservation.retryAt), this.now())
    }
    if (options.signal?.aborted) {
      return finish(runDir, state, makeResult(state, 'cancelled',
        'cancelled-before-dispatch', zeroCost()), this.now())
    }

    state = await updateState(runDir, state, 'revision-pending', this.now())
    let received = false
    let response: ResearchSkillRevisionModelResult
    try {
      response = await this.reviser({
        ...handoff,
        idempotencyKey: identity.id,
        targetId: target.id,
        workspaceId: target.workspaceId,
        skillName: target.skill,
        files,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      received = true
    } catch (error) {
      const observed = error instanceof ObservedRevisionResponseError
      return finish(runDir, state, makeResult(state, observed ? 'incomplete' : 'uncertain',
        observed ? 'invalid-reviser-response' : 'paid-revision-outcome-uncertain', oneCallCost()), this.now())
    }
    if (options.signal?.aborted) {
      return finish(runDir, state, makeResult(state, 'uncertain',
        'paid-revision-outcome-uncertain', oneCallCost()), this.now())
    }

    let proposal: ValidatedRevisionProposal
    try {
      proposal = await validateRevisionResult(response, target.skill, version.treeHash)
    } catch {
      return finish(runDir, state, makeResult(state, 'incomplete',
        'invalid-reviser-response', costFrom(response, received)), this.now())
    }
    let revised: { readonly created: boolean; readonly candidate: DiscoveredSkillCandidate }
    try {
      revised = await this.candidates.quarantineRevisedBundle({
        discoveredAt: this.now(),
        workspaceId: candidate.workspaceId,
        requestedSkill: candidate.requestedSkill,
        sourceId: candidate.source.id,
        clusterId: candidate.demand.clusterId,
        gapIds: [...candidate.demand.gapIds],
        goalCount: candidate.demand.goalCount,
        modelIdentity,
        inputDigest,
        researchDigest: handoff.researchDigest,
        parentCandidateId: candidate.id,
        parentTreeHash: version.treeHash,
        holdoutResultId: handoff.holdoutResultId,
        files: proposal.files,
      })
    } catch {
      return finish(runDir, state, makeResult(state, 'incomplete',
        'candidate-quarantine-failed', costFrom(proposal, true)), this.now())
    }
    if (!isExactRevisedCandidate(revised.candidate, candidate, identity, handoff, proposal)) {
      return finish(runDir, state, makeResult(state, 'incomplete',
        'candidate-quarantine-failed', costFrom(proposal, true)), this.now())
    }
    return finish(runDir, state, makeResult(state, 'candidate-ready',
      'revised-candidate-ready', costFrom(proposal, true), revised.candidate.id), this.now())
  }

  async scan(workspaceId?: string): Promise<ResearchSkillRevisionScan> {
    const runs: ResearchSkillRevisionResult[] = []
    let warningCount = 0
    let configuredTargetCount = 0
    for (const target of this.targets.values()) {
      if (workspaceId !== undefined && target.workspaceId !== workspaceId) continue
      configuredTargetCount += 1
      let entries
      try {
        entries = await readdir(join(target.runRoot, 'runs'), { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) warningCount += 1
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
        try {
          const value = JSON.parse(await readFile(join(target.runRoot, 'runs', entry.name, 'result.json'), 'utf8'))
          if (!isRevisionResult(value)
            || value.id !== entry.name
            || value.targetId !== target.id
            || value.workspaceId !== target.workspaceId
            || value.skillName !== target.skill) {
            warningCount += 1
            continue
          }
          runs.push(deepFreeze(structuredClone(value)))
        } catch (error) {
          if (!isMissing(error)) warningCount += 1
        }
      }
    }
    return deepFreeze({
      configuredTargetCount,
      warningCount,
      runs: runs.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)),
    })
  }
}

/** Native Jobs bridge with per-Skill single flight; v3 Candidates are never owned. */
export class ResearchSkillRevisionScheduler {
  private readonly revision: Pick<ResearchSkillRevision, 'matches' | 'revise'>
  private readonly pending = new Map<string, {
    readonly candidate: DiscoveredSkillCandidate
    readonly holdout: ResearchSkillHoldoutResult
  }>()
  private readonly active = new Set<string>()
  private readonly activeTargets = new Set<string>()
  private jobs: Pick<JobRegistry, 'start'> | undefined

  constructor(revision: Pick<ResearchSkillRevision, 'matches' | 'revise'>) {
    this.revision = revision
  }

  attachJobs(jobs: Pick<JobRegistry, 'start'>): () => void {
    if (this.jobs !== undefined) throw new Error('research Skill revision Jobs seam is already attached')
    this.jobs = jobs
    for (const candidateId of this.pending.keys()) this.schedule(candidateId)
    return () => {
      if (this.jobs === jobs) this.jobs = undefined
    }
  }

  /** True means this one-shot revision gate owns the exact Candidate/Holdout pair. */
  observe(candidate: DiscoveredSkillCandidate, holdout: ResearchSkillHoldoutResult): boolean {
    if (!this.revision.matches(candidate, holdout)) return false
    if (!this.active.has(candidate.id) && !this.pending.has(candidate.id)) {
      this.pending.set(candidate.id, { candidate, holdout })
      this.schedule(candidate.id)
    }
    return true
  }

  private schedule(candidateId: string): void {
    const jobs = this.jobs
    const pending = this.pending.get(candidateId)
    if (jobs === undefined || pending === undefined || this.active.has(candidateId)) return
    const key = targetKey(pending.candidate.workspaceId, pending.candidate.requestedSkill)
    if (this.activeTargets.has(key)) return
    this.pending.delete(candidateId)
    this.active.add(candidateId)
    this.activeTargets.add(key)
    const controller = new AbortController()
    try {
      jobs.start({
        kind: 'evolution',
        label: `one-shot research Skill revision: ${pending.candidate.requestedSkill}`,
        outputLimitBytes: 2_048,
        run: () => {
          const task = this.revision.revise(pending.candidate, pending.holdout, {
            signal: controller.signal,
          })
          return {
            cancel: (reason?: string) => controller.abort(
              new Error(reason ?? 'research Skill revision cancelled'),
            ),
            done: task.then(value => ({
              status: controller.signal.aborted
                ? 'killed' as const
                : value.status === 'candidate-ready' || value.status === 'budget-deferred'
                  ? 'completed' as const
                  : 'failed' as const,
              detail: controller.signal.aborted
                ? errorDetail(controller.signal.reason)
                : `${value.status}: ${value.reason}`,
              ...(value.candidateId === undefined ? {} : { output: `quarantined: ${value.candidateId}` }),
            }), (error: unknown) => ({
              status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
              detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
            })).finally(() => {
              this.active.delete(candidateId)
              this.activeTargets.delete(key)
              const next = [...this.pending.values()].find(value =>
                targetKey(value.candidate.workspaceId, value.candidate.requestedSkill) === key)
              if (next !== undefined) this.schedule(next.candidate.id)
            }),
          }
        },
      })
    } catch {
      this.active.delete(candidateId)
      this.activeTargets.delete(key)
      this.pending.set(candidateId, pending)
    }
  }
}

function validateRevisionHandoff(
  input: ResearchSkillRevisionInput,
  candidate: DiscoveredSkillCandidate & {
    readonly version: Extract<DiscoveredSkillCandidate['version'], { kind: 'slow-loop-research-bundle-v2' }>
  },
  result: ResearchSkillHoldoutResult,
): ResearchSkillRevisionInput {
  if (!isRecord(input)
    || Object.keys(input).sort().join(',') !== 'findings,holdoutResultId,parentCandidateId,parentTreeHash,researchDigest'
    || input.holdoutResultId !== result.id
    || input.parentCandidateId !== candidate.id
    || input.parentTreeHash !== candidate.version.treeHash
    || input.researchDigest !== candidate.version.researchDigest
    || !Array.isArray(input.findings)
    || input.findings.length < 1
    || input.findings.length > 8) {
    throw new Error('revision handoff identity is invalid')
  }
  const findings = input.findings.map(finding => {
    if (!isRecord(finding)
      || Object.keys(finding).sort().join(',') !== 'anchorDigest,assessment,attribution'
      || typeof finding.anchorDigest !== 'string' || !CONTENT_ID.test(finding.anchorDigest)
      || (finding.assessment !== 'violated' && finding.assessment !== 'unresolved')
      || typeof finding.attribution !== 'string' || finding.attribution.trim() === ''
      || Buffer.byteLength(finding.attribution) > 1_024) {
      throw new Error('revision handoff finding is invalid')
    }
    return Object.freeze({
      anchorDigest: finding.anchorDigest,
      assessment: finding.assessment,
      attribution: finding.attribution,
    })
  })
  if (new Set(findings.map(finding => finding.anchorDigest)).size !== findings.length) {
    throw new Error('revision handoff findings are duplicated')
  }
  return deepFreeze({
    holdoutResultId: input.holdoutResultId,
    researchDigest: input.researchDigest,
    parentCandidateId: input.parentCandidateId,
    parentTreeHash: input.parentTreeHash,
    findings: findings.sort((left, right) => left.anchorDigest.localeCompare(right.anchorDigest)),
  })
}

function makeIdentity(
  target: ResolvedTarget,
  candidate: DiscoveredSkillCandidate,
  handoff: ResearchSkillRevisionInput,
  inputDigest: string,
  reviserIdentityHash: string,
): RevisionIdentity {
  const unsigned = {
    policyVersion: POLICY_VERSION,
    targetId: target.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.requestedSkill,
    parentCandidateId: candidate.id,
    parentTreeHash: handoff.parentTreeHash,
    holdoutResultId: handoff.holdoutResultId,
    researchDigest: handoff.researchDigest,
    inputDigest,
    reviserIdentityHash,
  }
  return Object.freeze({
    schemaVersion: 1,
    id: sha256(JSON.stringify(unsigned)),
    parentCandidateId: unsigned.parentCandidateId,
    workspaceId: unsigned.workspaceId,
    skillName: unsigned.skillName,
    targetId: unsigned.targetId,
    holdoutResultId: unsigned.holdoutResultId,
    researchDigest: unsigned.researchDigest,
    parentTreeHash: unsigned.parentTreeHash,
    inputDigest: unsigned.inputDigest,
    reviserIdentityHash: unsigned.reviserIdentityHash,
  })
}

type OriginalResearchCandidate = DiscoveredSkillCandidate & {
  readonly version: Extract<DiscoveredSkillCandidate['version'], { kind: 'slow-loop-research-bundle-v2' }>
  readonly source: Extract<DiscoveredSkillCandidate['source'], { kind: 'slow-loop-author' }>
  readonly demand: NonNullable<DiscoveredSkillCandidate['demand']>
}

function isOriginalResearchCandidate(candidate: DiscoveredSkillCandidate): candidate is OriginalResearchCandidate {
  return candidate.version.kind === 'slow-loop-research-bundle-v2'
    && candidate.source.kind === 'slow-loop-author'
    && candidate.demand !== undefined
}

function isSafeOriginalCandidate(candidate: DiscoveredSkillCandidate): candidate is OriginalResearchCandidate {
  return isOriginalResearchCandidate(candidate)
    && candidate.lifecycle === 'inactive'
    && candidate.verification === 'unevaluated'
    && candidate.execution === 'never'
    && !candidate.permissions.executableContent
    && !candidate.package.hasScripts
    && candidate.package.hasReferences
    && candidate.package.fileCount >= 2
    && candidate.package.fileCount <= 32
    && candidate.package.totalBytes <= MAX_CANDIDATE_BYTES
}

async function readCandidateFiles(
  candidate: DiscoveredSkillCandidate & {
    readonly version: Extract<DiscoveredSkillCandidate['version'], { kind: 'slow-loop-research-bundle-v2' }>
  },
  materialized: MaterializedSkillCandidate,
): Promise<readonly AgentSkillTextManifestFile[]> {
  if (materialized.candidateId !== candidate.id
    || materialized.contentHash !== candidate.contentHash
    || materialized.treeHash !== candidate.version.treeHash
    || materialized.path !== resolve(materialized.path)
    || await realpath(materialized.path) !== materialized.path
    || materialized.files.length !== candidate.package.fileCount
    || materialized.files.some(file => file.mode !== '100644' || !INSTRUCTION_FILE.test(file.path))) {
    throw new Error('research Skill revision materialized parent identity is invalid')
  }
  let totalBytes = 0
  const files: AgentSkillTextManifestFile[] = []
  for (const file of [...materialized.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    if (!isOwnedRelativePath(file.path)) throw new Error('research Skill revision parent path is unsafe')
    const path = resolve(materialized.path, ...file.path.split('/'))
    if (!contains(materialized.path, path) || path === materialized.path) {
      throw new Error('research Skill revision parent path escapes materialization')
    }
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size) {
      throw new Error('research Skill revision materialized parent changed')
    }
    totalBytes += info.size
    if (totalBytes > MAX_CANDIDATE_BYTES) throw new Error('research Skill revision parent exceeds its byte limit')
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path))
    files.push(Object.freeze({ path: file.path, content }))
  }
  if (totalBytes !== candidate.package.totalBytes || !files.some(file => file.path === 'SKILL.md')) {
    throw new Error('research Skill revision parent package metadata changed')
  }
  const assembled = await assembleAgentSkillTextArchive(files)
  if (assembled.treeHash !== candidate.version.treeHash
    || assembled.artifactDigest !== candidate.version.artifactDigest
    || assembled.artifactDigest !== candidate.contentHash) {
    throw new Error('research Skill revision parent content identity changed')
  }
  return deepFreeze(files)
}

function assertModelInputBudget(
  target: ResolvedTarget,
  handoff: ResearchSkillRevisionInput,
  files: readonly AgentSkillTextManifestFile[],
): void {
  if (Buffer.byteLength(JSON.stringify({
    targetId: target.id,
    workspaceId: target.workspaceId,
    skillName: target.skill,
    ...handoff,
    files,
  })) > MAX_MODEL_INPUT_BYTES) throw new Error('research Skill revision input exceeds its byte limit')
}

async function validateRevisionResult(
  input: ResearchSkillRevisionModelResult,
  skillName: string,
  parentTreeHash: string,
): Promise<ValidatedRevisionProposal> {
  if (!isRecord(input)
    || Object.keys(input).sort().join(',') !== 'files,usage'
    || !Array.isArray(input.files)
    || !isUsage(input.usage)) {
    throw new Error('research Skill reviser response has an invalid shape')
  }
  const assembled = await assembleAgentSkillTextArchive(input.files)
  if (assembled.treeHash === parentTreeHash) {
    throw new Error('research Skill revision must change its exact parent tree')
  }
  const skillFile = assembled.files.find(file => file.path === 'SKILL.md')
  const skillMd = skillFile?.content.toString('utf8')
  if (skillMd === undefined
    || !skillMd.startsWith('---\n')
    || !new RegExp(`(?:^|\\n)name:[ \\t]*${escapeRegExp(skillName)}[ \\t]*(?:\\n|$)`, 'u').test(skillMd)) {
    throw new Error('research Skill revised SKILL.md name does not match its exact target')
  }
  return deepFreeze({
    files: assembled.files.map(file => Object.freeze({
      path: file.path,
      content: file.content.toString('utf8'),
    })),
    usage: { ...input.usage },
    artifactDigest: assembled.artifactDigest,
    treeHash: assembled.treeHash,
    fileCount: assembled.files.length,
    totalBytes: assembled.totalBytes,
  })
}

function isExactRevisedCandidate(
  revised: DiscoveredSkillCandidate,
  parent: DiscoveredSkillCandidate,
  identity: RevisionIdentity,
  handoff: ResearchSkillRevisionInput,
  proposal: ValidatedRevisionProposal,
): boolean {
  return revised.version.kind === 'slow-loop-research-revision-v3'
    && revised.version.revision === 1
    && revised.workspaceId === parent.workspaceId
    && revised.requestedSkill === parent.requestedSkill
    && revised.source.kind === 'slow-loop-author'
    && revised.source.id === parent.source.id
    && revised.version.parentCandidateId === parent.id
    && revised.version.parentTreeHash === handoff.parentTreeHash
    && revised.version.holdoutResultId === handoff.holdoutResultId
    && revised.version.researchDigest === handoff.researchDigest
    && revised.version.inputDigest === identity.inputDigest
    && revised.version.modelIdentityHash === identity.reviserIdentityHash
    && revised.version.artifactDigest === proposal.artifactDigest
    && revised.version.treeHash === proposal.treeHash
    && revised.version.treeHash !== handoff.parentTreeHash
    && revised.contentHash === proposal.artifactDigest
    && revised.distribution?.kind === 'archive'
    && revised.distribution.format === 'tar.gz'
    && revised.package.fileCount === proposal.fileCount
    && revised.package.totalBytes === proposal.totalBytes
    && !revised.package.hasScripts
    && revised.package.hasReferences
    && revised.demand?.clusterId === parent.demand?.clusterId
    && JSON.stringify(revised.demand?.gapIds) === JSON.stringify(parent.demand?.gapIds)
    && revised.demand?.goalCount === parent.demand?.goalCount
    && !revised.permissions.executableContent
    && revised.lifecycle === 'inactive'
    && revised.verification === 'unevaluated'
    && revised.execution === 'never'
}

async function prepareState(
  runDir: string,
  identity: RevisionIdentity,
  now: number,
): Promise<RevisionState> {
  await ensureRunRoot(dirname(dirname(runDir)))
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  const info = await lstat(runDir)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runDir) !== runDir) {
    throw new Error('research Skill revision run is not an exact real directory')
  }
  try {
    const existing = await loadState(runDir)
    if (JSON.stringify(projectIdentity(existing)) !== JSON.stringify(identity)) {
      throw new Error('research Skill revision run identity changed')
    }
    return existing
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const instant = isoTime(now)
  const state = deepFreeze({
    ...identity,
    phase: 'prepared' as const,
    createdAt: instant,
    updatedAt: instant,
  })
  await writeDurableJson(join(runDir, 'state.json'), state)
  return state
}

async function ensureRunRoot(runRoot: string): Promise<void> {
  await mkdir(runRoot, { recursive: true, mode: 0o700 })
  const info = await lstat(runRoot)
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(runRoot) !== runRoot) {
    throw new Error('research Skill revision run root must be an exact real directory')
  }
  const runs = join(runRoot, 'runs')
  await mkdir(runs, { recursive: true, mode: 0o700 })
  if (await realpath(runs) !== runs) throw new Error('research Skill revision runs path must be exact')
}

async function loadState(runDir: string): Promise<RevisionState> {
  const statePath = join(runDir, 'state.json')
  if ((await stat(statePath)).size > MAX_STATE_BYTES) throw new Error('research Skill revision state is oversized')
  const value = JSON.parse(await readFile(statePath, 'utf8')) as unknown
  if (!isRevisionState(value)) throw new Error('research Skill revision state is invalid')
  return deepFreeze(structuredClone(value))
}

async function updateState(
  runDir: string,
  state: RevisionState,
  phase: RevisionState['phase'],
  now: number,
): Promise<RevisionState> {
  const next = deepFreeze({ ...state, phase, updatedAt: isoTime(now) })
  await writeDurableJson(join(runDir, 'state.json'), next)
  return next
}

async function finish(
  runDir: string,
  state: RevisionState,
  result: ResearchSkillRevisionResult,
  now: number,
): Promise<ResearchSkillRevisionResult> {
  const completed = deepFreeze({ ...result, updatedAt: isoTime(now) })
  await writeDurableJson(join(runDir, 'result.json'), completed)
  await updateState(runDir, state, 'complete', now)
  return completed
}

function makeResult(
  state: RevisionState,
  status: ResearchSkillRevisionStatus,
  reason: ResearchSkillRevisionReason,
  cost: ResearchSkillRevisionResult['cost'],
  candidateId?: string,
  retryAt?: number,
): ResearchSkillRevisionResult {
  return deepFreeze({
    ...projectIdentity(state),
    status,
    reason,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    cost: { ...cost },
    ...(candidateId === undefined ? {} : { candidateId }),
    ...(retryAt === undefined ? {} : { retryAt }),
    releaseAuthority: 'none' as const,
  })
}

async function readExistingResult(
  runDir: string,
  identity: RevisionIdentity,
): Promise<ResearchSkillRevisionResult | undefined> {
  try {
    const value = JSON.parse(await readFile(join(runDir, 'result.json'), 'utf8')) as unknown
    if (!isRevisionResult(value)
      || JSON.stringify(projectResultIdentity(value)) !== JSON.stringify(identity)) {
      throw new Error('research Skill revision durable result identity changed')
    }
    return deepFreeze(structuredClone(value))
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function projectIdentity(state: RevisionState): RevisionIdentity {
  return {
    schemaVersion: state.schemaVersion,
    id: state.id,
    parentCandidateId: state.parentCandidateId,
    workspaceId: state.workspaceId,
    skillName: state.skillName,
    targetId: state.targetId,
    holdoutResultId: state.holdoutResultId,
    researchDigest: state.researchDigest,
    parentTreeHash: state.parentTreeHash,
    inputDigest: state.inputDigest,
    reviserIdentityHash: state.reviserIdentityHash,
  }
}

function projectResultIdentity(result: ResearchSkillRevisionResult): RevisionIdentity {
  return {
    schemaVersion: result.schemaVersion,
    id: result.id,
    parentCandidateId: result.parentCandidateId,
    workspaceId: result.workspaceId,
    skillName: result.skillName,
    targetId: result.targetId,
    holdoutResultId: result.holdoutResultId,
    researchDigest: result.researchDigest,
    parentTreeHash: result.parentTreeHash,
    inputDigest: result.inputDigest,
    reviserIdentityHash: result.reviserIdentityHash,
  }
}

function isRevisionState(value: unknown): value is RevisionState {
  return isRecord(value)
    && isRevisionIdentity(value)
    && (value.phase === 'prepared' || value.phase === 'revision-pending' || value.phase === 'complete')
    && typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
    && typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
}

function isRevisionResult(value: unknown): value is ResearchSkillRevisionResult {
  if (!isRecord(value)
    || !isRevisionIdentity(value)
    || !REVISION_STATUSES.has(value.status as ResearchSkillRevisionStatus)
    || !REVISION_REASONS.has(value.reason as ResearchSkillRevisionReason)
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))
    || !isCost(value.cost)
    || (value.candidateId !== undefined && (typeof value.candidateId !== 'string' || !CONTENT_ID.test(value.candidateId)))
    || (value.retryAt !== undefined && (!Number.isSafeInteger(value.retryAt) || (value.retryAt as number) < 0))
    || value.releaseAuthority !== 'none') return false
  if (value.status === 'candidate-ready') {
    return value.reason === 'revised-candidate-ready'
      && value.cost.modelCalls === 1
      && typeof value.candidateId === 'string'
  }
  if (value.status === 'budget-deferred') {
    return value.reason === 'daily-revision-budget-exhausted'
      && value.cost.modelCalls === 0
      && typeof value.retryAt === 'number'
      && value.candidateId === undefined
  }
  if (value.status === 'cancelled') {
    return value.reason === 'cancelled-before-dispatch'
      && value.cost.modelCalls === 0
      && value.candidateId === undefined
  }
  if (value.status === 'uncertain') {
    return value.reason === 'paid-revision-outcome-uncertain'
      && value.cost.modelCalls === 1
      && value.candidateId === undefined
  }
  return ['local-validation-failed', 'invalid-reviser-response', 'candidate-quarantine-failed']
    .includes(String(value.reason)) && value.candidateId === undefined
}

function isRevisionIdentity(value: Record<string, unknown>): boolean {
  return value.schemaVersion === 1
    && typeof value.id === 'string' && CONTENT_ID.test(value.id)
    && typeof value.parentCandidateId === 'string' && CONTENT_ID.test(value.parentCandidateId)
    && typeof value.workspaceId === 'string' && WORKSPACE_ID.test(value.workspaceId)
    && typeof value.skillName === 'string' && PUBLIC_ID.test(value.skillName)
    && typeof value.targetId === 'string' && PUBLIC_ID.test(value.targetId)
    && typeof value.holdoutResultId === 'string' && CONTENT_ID.test(value.holdoutResultId)
    && typeof value.researchDigest === 'string' && CONTENT_ID.test(value.researchDigest)
    && typeof value.parentTreeHash === 'string' && CONTENT_ID.test(value.parentTreeHash)
    && typeof value.inputDigest === 'string' && CONTENT_ID.test(value.inputDigest)
    && typeof value.reviserIdentityHash === 'string' && CONTENT_ID.test(value.reviserIdentityHash)
}

function isCost(value: unknown): value is ResearchSkillRevisionResult['cost'] {
  return isRecord(value)
    && (value.modelCalls === 0 || value.modelCalls === 1)
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0
}

function isUsage(value: unknown): value is ResearchSkillRevisionModelResult['usage'] {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === 'inputTokens,outputTokens'
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0
}

function zeroCost(): ResearchSkillRevisionResult['cost'] {
  return Object.freeze({ modelCalls: 0, inputTokens: 0, outputTokens: 0 })
}

function oneCallCost(): ResearchSkillRevisionResult['cost'] {
  return Object.freeze({ modelCalls: 1, inputTokens: 0, outputTokens: 0 })
}

function costFrom(value: unknown, called: boolean): ResearchSkillRevisionResult['cost'] {
  return isRecord(value) && isUsage(value.usage)
    ? Object.freeze({ modelCalls: called ? 1 as const : 0 as const, ...value.usage })
    : called ? oneCallCost() : zeroCost()
}

function assertTargets(targets: readonly ResearchSkillRevisionTargetConfig[]): void {
  if (targets.length === 0 || targets.length > MAX_TARGETS) {
    throw new Error(`research Skill revision requires 1-${MAX_TARGETS} static targets`)
  }
  const ids = new Set<string>()
  const keys = new Set<string>()
  const roots = new Set<string>()
  for (const target of targets) {
    const root = resolve(target.runRoot)
    const key = targetKey(target.workspaceId, target.skill)
    if (!PUBLIC_ID.test(target.id)
      || !WORKSPACE_ID.test(target.workspaceId)
      || !PUBLIC_ID.test(target.skill)
      || !isAbsolute(target.runRoot)
      || dirname(root) === root
      || !Number.isInteger(target.maxAttemptsPerUtcDay)
      || target.maxAttemptsPerUtcDay < 1
      || target.maxAttemptsPerUtcDay > 20
      || ids.has(target.id)
      || keys.has(key)
      || roots.has(root)) {
      throw new Error('research Skill revision target configuration is invalid or duplicated')
    }
    ids.add(target.id)
    keys.add(key)
    roots.add(root)
  }
}

async function requestResearchSkillRevision(
  input: ResearchSkillRevisionModelInput,
): Promise<ResearchSkillRevisionModelResult> {
  const route = configuredRevisionRoute()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey,
  }
  if (route.apiKey !== undefined) headers.authorization = `Bearer ${route.apiKey}`
  const response = await fetch(`${route.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: route.model,
      max_tokens: REVISION_OUTPUT_TOKEN_LIMIT,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Revise one complete instruction-only Agent Skill bundle exactly once.',
            'Return JSON only with exactly one field: files.',
            'files must contain root SKILL.md plus 1-31 one-level references/*.md entries as {path, content}.',
            'Preserve the exact Skill name and return the complete replacement bundle, not a patch.',
            'Address only the supplied bounded Holdout findings; the withheld evidence itself is unavailable.',
            'Do not invent evidence, URLs, test outcomes, permissions, scripts, executable content, credentials, network calls, or release instructions.',
            'The result remains inactive and quarantined with no install, activation, execution, publication, or release authority.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            targetId: input.targetId,
            workspaceId: input.workspaceId,
            skillName: input.skillName,
            parentCandidateId: input.parentCandidateId,
            parentTreeHash: input.parentTreeHash,
            holdoutResultId: input.holdoutResultId,
            researchDigest: input.researchDigest,
            files: input.files,
            findings: input.findings,
          }),
        },
      ],
    }),
    signal: input.signal === undefined
      ? AbortSignal.timeout(60_000)
      : AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]),
  })
  if (!response.ok) {
    throw new ObservedRevisionResponseError(`research Skill revision request failed with HTTP ${response.status}`)
  }
  let payload: unknown
  try {
    payload = await readBoundedResponseJson(response)
  } catch {
    throw new ObservedRevisionResponseError('research Skill revision response is not valid JSON')
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])
    || !isRecord(payload.choices[0].message) || typeof payload.choices[0].message.content !== 'string') {
    throw new ObservedRevisionResponseError('research Skill revision response has no content')
  }
  let revised: unknown
  try {
    revised = JSON.parse(payload.choices[0].message.content)
  } catch {
    throw new ObservedRevisionResponseError('research Skill revision response content is not valid JSON')
  }
  if (!isRecord(revised) || Object.keys(revised).join(',') !== 'files') {
    throw new ObservedRevisionResponseError('research Skill revision response content has an invalid shape')
  }
  const usage = isRecord(payload.usage) ? payload.usage : {}
  return {
    ...revised,
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
  } as ResearchSkillRevisionModelResult
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_MODEL_RESPONSE_BYTES)) {
    throw new Error('research Skill revision response exceeds its byte limit')
  }
  if (response.body === null) throw new Error('research Skill revision response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > MAX_MODEL_RESPONSE_BYTES) {
        await reader.cancel('research Skill revision response exceeds its byte limit')
        throw new Error('research Skill revision response exceeds its byte limit')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.allocUnsafe(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

class ObservedRevisionResponseError extends Error {}

function configuredRevisionRoute(): { readonly baseUrl: string; readonly model: string; readonly apiKey?: string } {
  const baseUrl = optionalEnvironment('DSH_EVOLVE_REVISION_MODEL_BASE_URL')
    ?? requireEnvironment('DSH_EVOLVE_MODEL_BASE_URL')
  const model = optionalEnvironment('DSH_EVOLVE_REVISION_MODEL_NAME')
    ?? requireEnvironment('DSH_EVOLVE_MODEL_NAME')
  const apiKey = optionalEnvironment('DSH_EVOLVE_REVISION_MODEL_API_KEY')
    ?? optionalEnvironment('DSH_EVOLVE_MODEL_API_KEY')
  return { baseUrl, model, ...(apiKey === undefined ? {} : { apiKey }) }
}

function configuredRevisionModelIdentity(): string {
  const route = configuredRevisionRoute()
  return JSON.stringify({ baseUrl: route.baseUrl, model: route.model, contract: POLICY_VERSION })
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? undefined : value
}

function requireEnvironment(name: string): string {
  const value = optionalEnvironment(name)
  if (value === undefined) throw new Error(`research Skill revision requires ${name}`)
  return value
}

function targetKey(workspaceId: string, skill: string): string {
  return `${workspaceId}\0${skill}`
}

function contains(root: string, input: string): boolean {
  const fromRoot = relative(root, input)
  return fromRoot === '' || (fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot))
}

function isOwnedRelativePath(path: string): boolean {
  if (path === '' || path.includes('\\') || path.includes('\0') || isAbsolute(path)) return false
  const parts = path.split('/')
  return parts.every(part => part !== '' && part !== '.' && part !== '..')
}

function isoTime(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('research Skill revision clock is invalid')
  return new Date(value).toISOString()
}

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

const REVISION_STATUSES = new Set<ResearchSkillRevisionStatus>([
  'cancelled',
  'budget-deferred',
  'uncertain',
  'incomplete',
  'candidate-ready',
])

const REVISION_REASONS = new Set<ResearchSkillRevisionReason>([
  'cancelled-before-dispatch',
  'daily-revision-budget-exhausted',
  'local-validation-failed',
  'paid-revision-outcome-uncertain',
  'invalid-reviser-response',
  'candidate-quarantine-failed',
  'revised-candidate-ready',
])
