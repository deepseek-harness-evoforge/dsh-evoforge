import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type {} from '../../../packages/dsh-evolve/src/shadow-job-runner.ts'
import { AutomaticEvolutionBudget } from '../../../packages/dsh-evolve/src/automatic-evolution-budget.ts'
import type { CapabilityGap } from '../../../packages/dsh-evolve/src/capability-gap-store.ts'
import { InternalSkillRetention } from '../../../packages/dsh-evolve/src/internal-skill-retention.ts'
import { SkillCandidateAdmission } from '../../../packages/dsh-evolve/src/skill-candidate-admission.ts'
import { SkillCandidateShadowLauncher } from '../../../packages/dsh-evolve/src/skill-candidate-shadow.ts'
import {
  SkillCandidateRepository,
  skillCandidateId,
  type ExperienceSkillCandidate,
  type ExperienceSkillCandidateInput,
} from '../../../packages/dsh-evolve/src/skill-candidate-repository.ts'
import { SkillEvaluationEnvelopeResolver } from '../../../packages/dsh-evolve/src/skill-evaluation-envelope.ts'
import { SkillEvaluationEvidenceVault } from '../../../packages/dsh-evolve/src/skill-evaluation-evidence-vault.ts'
import { SkillEvaluationGovernance } from '../../../packages/dsh-evolve/src/skill-evaluation-governance.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../../../packages/dsh-evolve/src/skill-opportunity-discovery.ts'
import { SlowLoopSkillAuthoring } from '../../../packages/dsh-evolve/src/slow-loop-skill-authoring.ts'
import { writeDurableJson } from '../../../packages/dsh-evolve/src/shadow-run-state.ts'
import {
  BENCHMARK_ID,
  type RealProviderAcceptanceResolution,
  type RealProviderExecutionConfig,
} from './contract.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const WORKSPACE_ID = '8db5c24e-b9c3-4de5-8f53-d17f72856752'
const SKILL_NAME = 'recover-dsh-delivery'
const RESULT_FILE = 'result.json'

type ReadyReport = Extract<RealProviderAcceptanceResolution, { status: 'ready' }>['report']
type AuthoringJobs = Parameters<SlowLoopSkillAuthoring['attachJobs']>[0]
type JobId = string
interface JobSnapshot {
  readonly id: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
}

interface RealProviderAcceptanceReport {
  readonly schemaVersion: 1
  readonly benchmarkId: typeof BENCHMARK_ID
  readonly status: 'passed' | 'failed'
  readonly scope: string
  readonly manifestHash: string
  readonly revisions: {
    readonly evoforge: string
    readonly deepseekHarness: string
  }
  readonly proposer: ReadyReport['proposer']
  readonly governance: ReadyReport['governance']
  readonly stage: string
  readonly scenario: {
    readonly workspaceId: string
    readonly skillName: string
    readonly goalCount: number
    readonly externalSkillAcquisition: 'disabled'
  }
  readonly artifacts?: {
    readonly opportunityId: string
    readonly evaluationEvidenceId?: string
    readonly candidateId?: string
    readonly envelopeId?: string
    readonly admissionId?: string
    readonly shadowRunId?: string
    readonly retentionRunId?: string
  }
  readonly usage?: {
    readonly proposer: { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number }
    readonly governance: { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number }
    readonly holdout?: unknown
    readonly retention?: unknown
  }
  readonly outcome?: {
    readonly candidateLifecycle: string
    readonly admission: string
    readonly shadow: string
    readonly retention: string
  }
  readonly hardGates?: Readonly<Record<string, boolean>>
  readonly reasons: readonly string[]
}

/**
 * Execute RP-1 through the production evolution modules. This function never
 * supplies a model fake: both author seams resolve the approved external
 * endpoints from the production environment, while DSH's pinned Jobs provider
 * owns the authoring Job lifecycle.
 */
export async function executeRealProviderAcceptance(
  config: RealProviderExecutionConfig,
  preflight: ReadyReport,
): Promise<RealProviderAcceptanceReport> {
  const manifestSource = await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(manifestSource) as {
    id: string
    scope: string
    revisions: { deepseekHarness: string }
  }
  if (manifest.id !== BENCHMARK_ID || !/^[a-f0-9]{40}$/u.test(manifest.revisions.deepseekHarness)) {
    throw new Error('RP-1 manifest identity is invalid')
  }
  const manifestHash = sha256(manifestSource)
  const [evoforgeRevision, dshRevision, dirty] = await Promise.all([
    git(suiteRoot, 'rev-parse', 'HEAD'),
    git(config.dshSourceDir, 'rev-parse', 'HEAD'),
    git(suiteRoot, 'status', '--porcelain'),
  ])
  if (dirty !== '') throw new Error('RP-1 requires a clean EvoForge revision before paid dispatch')
  if (dshRevision !== manifest.revisions.deepseekHarness) {
    throw new Error(`RP-1 DSH revision mismatch: expected ${manifest.revisions.deepseekHarness}, got ${dshRevision}`)
  }
  await assertDshJobsBuild(config.dshSourceDir)
  const root = await exactDirectory(config.runRoot, true, 'RP-1 run root')
  const runId = sha256(JSON.stringify([
    BENCHMARK_ID,
    manifestHash,
    evoforgeRevision,
    dshRevision,
    preflight.proposer.providerId,
    preflight.proposer.modelIdentity,
    preflight.governance.providerId,
    preflight.governance.modelIdentity,
  ]))
  const runDir = await exactDirectory(join(root, BENCHMARK_ID, runId), true, 'RP-1 exact run')
  const resultPath = join(runDir, RESULT_FILE)
  const previous = await readExistingResult(resultPath, config, {
    manifestHash,
    evoforgeRevision,
    dshRevision,
    preflight,
  })
  if (previous !== undefined) return previous

  const base: Omit<RealProviderAcceptanceReport, 'status' | 'stage' | 'reasons'> = {
    schemaVersion: 1 as const,
    benchmarkId: BENCHMARK_ID,
    scope: manifest.scope,
    manifestHash,
    revisions: { evoforge: evoforgeRevision, deepseekHarness: dshRevision },
    proposer: preflight.proposer,
    governance: preflight.governance,
    scenario: {
      workspaceId: WORKSPACE_ID,
      skillName: SKILL_NAME,
      goalCount: 5,
      externalSkillAcquisition: 'disabled' as const,
    },
  }
  let stage = 'prepared'
  let artifacts: RealProviderAcceptanceReport['artifacts']
  let usage: RealProviderAcceptanceReport['usage']
  const candidateRows: ExperienceSkillCandidate[] = []
  const gaps = scenarioGaps()
  const discovery = new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps })
  const opportunities = discovery.discover(WORKSPACE_ID)
  if (opportunities.length !== 1) {
    return finishFailure(resultPath, base, stage, [`expected one internal Opportunity, observed ${opportunities.length}`])
  }
  const opportunity = opportunities[0]!
  artifacts = { opportunityId: opportunity.id }

  const authoringRoot = await exactDirectory(join(runDir, 'authoring'), true, 'RP-1 authoring root')
  const governanceRoot = await exactDirectory(join(runDir, 'governance'), true, 'RP-1 governance root')
  const evaluationRunRoot = await exactDirectory(join(runDir, 'evaluation-runs'), true, 'RP-1 evaluation run root')
  const authorPolicy = {
    id: 'rp1-proposer',
    workspaceId: WORKSPACE_ID,
    runRoot: authoringRoot,
    maxAttemptsPerUtcDay: 1,
  }
  const evaluationPolicy = {
    id: 'rp1-governance',
    workspaceId: WORKSPACE_ID,
    governanceRoot,
    runRoot: evaluationRunRoot,
    dshRevision,
    maxAttemptsPerUtcDay: 1,
  }
  const evidence = new SkillEvaluationEvidenceVault([evaluationPolicy], { list: () => gaps })
  const candidateRepository = new SkillCandidateRepository({
    async recordCandidate(input: ExperienceSkillCandidateInput) {
      const id = skillCandidateId(input)
      const existing = candidateRows.find(candidate => candidate.id === id)
      if (existing !== undefined) return { created: false, candidate: existing }
      const candidate = structuredClone({ schemaVersion: 2, id, ...input }) as ExperienceSkillCandidate
      candidateRows.push(candidate)
      return { created: true, candidate }
    },
  })
  const authoring = new SlowLoopSkillAuthoring({
    policies: [authorPolicy],
    opportunities: discovery,
    evaluationEvidence: evidence,
    candidates: {
      listCandidates: (workspaceId?: string, opportunityId?: string) => candidateRows.filter(candidate =>
        (workspaceId === undefined || candidate.workspaceId === workspaceId)
        && (opportunityId === undefined || candidate.opportunity.id === opportunityId)),
      quarantine: proposal => candidateRepository.quarantine(proposal),
    },
    budget: new AutomaticEvolutionBudget(),
  })

  const cordisModule = await import(pathToFileURL(join(config.dshSourceDir, 'vendor/cordis/lib/index.js')).href) as {
    Context: new () => {
      jobs: AuthoringJobs & {
        attachController(name: string): () => void
        list(): JobSnapshot[]
        wait(id: JobId, timeoutMs: number): Promise<JobSnapshot>
      }
      plugin(plugin: unknown, config: unknown): Promise<unknown>
      fiber: { dispose(): Promise<void> }
    }
  }
  const jobsContext = new cordisModule.Context()
  let detachController: (() => void) | undefined
  try {
    const jobsModule = (await import(pathToFileURL(join(
      config.dshSourceDir,
      'packages/jobs/jobs-local/lib/index.js',
    )).href)) as { default: new (ctx: unknown, config: { maxConcurrentJobsPerOwner: number }) => unknown }
    await jobsContext.plugin(jobsModule.default, { maxConcurrentJobsPerOwner: 1 })
    detachController = jobsContext.jobs.attachController('evoforge-rp1-real-provider-acceptance')
    const detachAuthoring = authoring.attachJobs(jobsContext.jobs)
    try {
      stage = 'proposer-authoring'
      const scheduled = await authoring.reconcile(WORKSPACE_ID)
      if (scheduled.scheduled !== 1 || scheduled.warnings.length !== 0) {
        throw new Error(`RP-1 proposer was not scheduled exactly once: ${JSON.stringify(scheduled)}`)
      }
      const authoringJob = onlyJob(jobsContext.jobs.list(), 'slow-loop Skill authoring')
      const settled = await jobsContext.jobs.wait(authoringJob.id as JobId, 90_000)
      if (settled.status !== 'completed') {
        throw new Error(`RP-1 proposer Job ${settled.status}: ${settled.detail ?? 'no detail'}`)
      }
    } finally {
      detachAuthoring()
    }

    const authorScan = await authoring.scan(WORKSPACE_ID)
    const authorRun = authorScan.runs.find(run => run.opportunityId === opportunity.id)
    const candidate = candidateRows.find(row => row.opportunity.id === opportunity.id)
    if (authorRun?.phase !== 'candidate-ready' || candidate === undefined) {
      throw new Error(`RP-1 proposer produced no Candidate: ${authorRun?.phase ?? 'missing'}`)
    }
    artifacts = {
      ...artifacts,
      evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      candidateId: candidate.id,
    }
    stage = 'candidate-blind-governance'
    const governance = new SkillEvaluationGovernance({
      policies: [evaluationPolicy],
      evidence,
      budget: new AutomaticEvolutionBudget(),
    })
    const envelopes = new SkillEvaluationEnvelopeResolver(
      [evaluationPolicy],
      discovery,
      evidence,
      governance,
    )
    const envelope = await envelopes.resolve(candidate)
    if (envelope === undefined) throw new Error('RP-1 governance produced no exact Envelope')
    artifacts = { ...artifacts, envelopeId: envelope.id }
    const governanceScan = await governance.scan(WORKSPACE_ID)
    const governanceRun = governanceScan.runs.find(run =>
      run.evaluationEvidenceId === candidate.authorship.evaluationEvidenceId)
    if (governanceRun?.phase !== 'ready' || governanceRun.modelCalls !== 3) {
      throw new Error(`RP-1 governance was not ready after three protected roles: ${governanceRun?.phase ?? 'missing'}`)
    }
    const candidateBlind = await candidateIdentityAbsentFromGovernance(envelope, candidate)
    const noSearchSurface = await noSearchSurfaceInCasePacks(envelope)

    stage = 'deterministic-admission'
    const admission = new SkillCandidateAdmission(envelopes, candidateRepository)
    const admitted = await admission.evaluate(candidate)
    artifacts = { ...artifacts, admissionId: admitted.id }
    if (admitted.status !== 'qualified-for-shadow') {
      throw new Error(`RP-1 admission ${admitted.status}: ${admitted.reasons.join(',')}`)
    }

    stage = 'assembled-holdout-retention'
    const retention = new InternalSkillRetention(admission, {
      runRoots: [{ workspaceId: WORKSPACE_ID, path: envelope.retentionRunRoot! }],
    })
    const launcher = new SkillCandidateShadowLauncher(admission, { retention })
    const shadow = await launcher.launch(candidate, admitted)
    if (shadow.status !== 'complete') throw new Error(`RP-1 Shadow incomplete: ${shadow.reason}`)
    const shadowReport = JSON.parse(await readFile(shadow.reportPath, 'utf8')) as {
      run?: { id?: string }
      decision?: { recommendation?: string }
      trial?: { modelCalls?: unknown; usage?: unknown }
      composition?: { stable?: boolean }
    }
    artifacts = {
      ...artifacts,
      ...(shadowReport.run?.id === undefined ? {} : { shadowRunId: shadowReport.run.id }),
      ...(shadow.retention === undefined ? {} : { retentionRunId: shadow.retention.id }),
    }
    const retentionStatus = shadow.retention?.status ?? 'missing'
    const hardGates = Object.freeze({
      independentDeclaredProviders: preflight.proposer.providerId !== preflight.governance.providerId,
      independentAuthorities: preflight.proposer.authorityHash !== preflight.governance.authorityHash,
      independentProductionModelIdentities: preflight.proposer.modelIdentity !== preflight.governance.modelIdentity,
      internalFiveGoalOpportunity: opportunity.goalCount === 5 && opportunity.gapIds.length === 5,
      candidateInactiveQuarantinedNeverExecuted: candidate.lifecycle === 'inactive'
        && candidate.safety.status === 'quarantined'
        && candidate.verification === 'unevaluated'
        && candidate.execution === 'never',
      candidateAbsentFromGovernanceCasePacks: candidateBlind,
      runtimeSearchSurfaceAbsent: noSearchSurface,
      governanceReadyWithThreeProtectedRoles: governanceRun.phase === 'ready'
        && governanceRun.modelCalls === 3
        && governanceRun.retentionIncluded,
      deterministicAdmissionQualified: admitted.status === 'qualified-for-shadow',
      assembledHoldoutPromotable: shadowReport.decision?.recommendation === 'promote'
        && shadowReport.composition?.stable === true,
      independentRetentionRetained: retentionStatus === 'retained',
    })
    usage = {
      proposer: {
        calls: authorRun.modelCalls,
        inputTokens: authorRun.inputTokens,
        outputTokens: authorRun.outputTokens,
      },
      governance: {
        calls: governanceRun.modelCalls,
        inputTokens: governanceRun.inputTokens,
        outputTokens: governanceRun.outputTokens,
      },
      ...(shadowReport.trial?.usage === undefined ? {} : { holdout: shadowReport.trial.usage }),
      ...(shadow.retention?.evidence?.usage === undefined ? {} : { retention: shadow.retention.evidence.usage }),
    }
    const failedGates = Object.entries(hardGates).filter(([, passed]) => !passed).map(([name]) => name)
    const result: RealProviderAcceptanceReport = Object.freeze({
      ...base,
      status: failedGates.length === 0 ? 'passed' : 'failed',
      stage: 'complete',
      artifacts,
      usage,
      outcome: {
        candidateLifecycle: `${candidate.lifecycle}/${candidate.safety.status}/${candidate.verification}/${candidate.execution}`,
        admission: admitted.status,
        shadow: shadowReport.decision?.recommendation ?? 'missing',
        retention: retentionStatus,
      },
      hardGates,
      reasons: Object.freeze(failedGates.map(name => `hard-gate-failed:${name}`)),
    })
    await writeDurableJson(resultPath, result)
    return result
  } catch (error) {
    return finishFailure(resultPath, base, stage, [boundedError(error, config)], artifacts, usage)
  } finally {
    detachController?.()
    await jobsContext.fiber.dispose()
  }
}

async function finishFailure(
  resultPath: string,
  base: Omit<RealProviderAcceptanceReport, 'status' | 'stage' | 'reasons'>,
  stage: string,
  reasons: readonly string[],
  artifacts?: RealProviderAcceptanceReport['artifacts'],
  usage?: RealProviderAcceptanceReport['usage'],
): Promise<RealProviderAcceptanceReport> {
  const report: RealProviderAcceptanceReport = Object.freeze({
    ...base,
    status: 'failed',
    stage,
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(usage === undefined ? {} : { usage }),
    reasons: Object.freeze([...reasons]),
  })
  await writeDurableJson(resultPath, report)
  return report
}

function scenarioGaps(): CapabilityGap[] {
  return ['a', 'b', 'c', 'd', 'e'].map((suffix, index) => Object.freeze({
    schemaVersion: 1 as const,
    id: sha256(JSON.stringify([BENCHMARK_ID, 'gap', suffix])),
    observedAt: index + 1,
    workspaceId: WORKSPACE_ID,
    sessionId: `rp1-session-${suffix}`,
    requestedSkill: SKILL_NAME,
    catalogHash: sha256(JSON.stringify([BENCHMARK_ID, 'native-catalog-v1'])),
    catalogSize: 3,
    goal: {
      id: `rp1-goal-${suffix}`,
      revision: 1,
      objective: `Recover one distinct failed DSH delivery scenario ${suffix} without repeating external effects.`,
    },
    status: 'confirmed' as const,
    evidence: {
      kind: 'native-skill-miss' as const,
      catalog: 'complete' as const,
      routing: 'requested-skill-absent' as const,
      providers: 'settled' as const,
    },
  }))
}

function onlyJob(jobs: readonly JobSnapshot[], labelPrefix: string): JobSnapshot {
  const matching = jobs.filter(job => job.label.startsWith(labelPrefix))
  if (matching.length !== 1) throw new Error(`expected one ${labelPrefix} Job, observed ${matching.length}`)
  return matching[0]!
}

async function candidateIdentityAbsentFromGovernance(
  envelope: NonNullable<Awaited<ReturnType<SkillEvaluationEnvelopeResolver['resolve']>>>,
  candidate: ExperienceSkillCandidate,
): Promise<boolean> {
  const roots = [
    envelope.admissionCasePackDir,
    envelope.holdoutCasePackDir,
    ...(envelope.retentionCasePackDir === undefined ? [] : [envelope.retentionCasePackDir]),
  ]
  const candidateIdentities = [candidate.id, candidate.contentHash, candidate.version.treeHash]
  for (const root of roots) {
    const content = await boundedTreeText(root)
    if (candidateIdentities.some(identity => content.includes(identity))) return false
  }
  return true
}

async function noSearchSurfaceInCasePacks(
  envelope: NonNullable<Awaited<ReturnType<SkillEvaluationEnvelopeResolver['resolve']>>>,
): Promise<boolean> {
  const roots = [
    envelope.admissionCasePackDir,
    envelope.holdoutCasePackDir,
    ...(envelope.retentionCasePackDir === undefined ? [] : [envelope.retentionCasePackDir]),
  ]
  for (const root of roots) {
    const entries = await readdir(root)
    if (entries.includes('search')) return false
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>
    if (Object.hasOwn(manifest, 'search')) return false
    if (JSON.stringify(manifest.evidence) !== JSON.stringify({ rationale: 'evidence/rationale.md' })) return false
  }
  return true
}

async function boundedTreeText(root: string): Promise<string> {
  const chunks: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        const source = await readFile(path)
        if (source.byteLength > 512 * 1024) throw new Error('RP-1 governance file exceeds audit limit')
        chunks.push(source.toString('utf8'))
      } else throw new Error('RP-1 governance tree contains a non-regular entry')
    }
  }
  await visit(root)
  return chunks.join('\n')
}

async function assertDshJobsBuild(dshRoot: string): Promise<void> {
  const path = join(dshRoot, 'packages/jobs/jobs-local/lib/index.js')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('RP-1 requires the pinned DSH jobs-local build')
  }
}

async function exactDirectory(path: string, create: boolean, label: string): Promise<string> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

async function readExistingResult(
  path: string,
  config: RealProviderExecutionConfig,
  expected: {
    readonly manifestHash: string
    readonly evoforgeRevision: string
    readonly dshRevision: string
    readonly preflight: ReadyReport
  },
): Promise<RealProviderAcceptanceReport | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path || info.size > 1024 * 1024) {
      throw new Error('RP-1 existing result is not an exact bounded file')
    }
    const source = await readFile(path, 'utf8')
    if ([
      config.proposer.apiKey,
      config.proposer.baseUrl,
      config.governance.apiKey,
      config.governance.baseUrl,
    ].some(privateValue => source.includes(privateValue))) {
      throw new Error('RP-1 existing result contains private provider configuration')
    }
    const value = JSON.parse(source) as RealProviderAcceptanceReport
    if (value.schemaVersion !== 1 || value.benchmarkId !== BENCHMARK_ID
      || (value.status !== 'passed' && value.status !== 'failed')
      || value.manifestHash !== expected.manifestHash
      || value.revisions.evoforge !== expected.evoforgeRevision
      || value.revisions.deepseekHarness !== expected.dshRevision
      || JSON.stringify(value.proposer) !== JSON.stringify(expected.preflight.proposer)
      || JSON.stringify(value.governance) !== JSON.stringify(expected.preflight.governance)) {
      throw new Error('RP-1 existing result has an invalid identity')
    }
    return value
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, timeout: 30_000 })
  return result.stdout.trim()
}

function boundedError(error: unknown, config: RealProviderExecutionConfig): string {
  let value = error instanceof Error ? error.message : String(error)
  for (const privateValue of [
    config.proposer.apiKey,
    config.proposer.baseUrl,
    config.governance.apiKey,
    config.governance.baseUrl,
  ]) {
    value = value.replaceAll(privateValue, '[redacted]')
  }
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown RP-1 failure'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
