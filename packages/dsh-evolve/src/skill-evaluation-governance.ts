import { createHash, randomUUID } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import { calibrateCasePack, type CasePackCalibrationResult } from './case-pack-calibration.ts'
import { hashTree } from './hash.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'
import { boundedModelProviderIdentity } from './model-provider-identity.ts'
import {
  assertSkillCandidateEvaluationPolicies,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import {
  skillEvaluationProtectedInputDigest,
  type SkillEvaluationEvidenceManifest,
  type SkillEvaluationEvidenceVault,
} from './skill-evaluation-evidence-vault.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const MAX_AUTHOR_RESPONSE_BYTES = 256 * 1024
const MAX_EVALUATOR_BYTES = 128 * 1024
const MAX_SKILL_BYTES = 64 * 1024
const MAX_EVIDENCE_BYTES = 32 * 1024
const MAX_STATE_BYTES = 64 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 6_000
const MAX_SCAN_ROWS = 1_000

export interface SkillEvaluationGovernancePolicyConfig
  extends SkillCandidateEvaluationPolicyConfig {
  readonly dshRevision: string
  readonly maxAttemptsPerUtcDay: number
}

export interface SkillEvaluationCaseAuthorInput {
  readonly idempotencyKey: string
  readonly role: 'admission' | 'holdout'
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly evaluationEvidenceId: string
  readonly goalEvidence: readonly {
    readonly id: string
    readonly revision: number
    readonly objective: string
    readonly gapIds: readonly string[]
  }[]
  readonly dshRevision: string
  readonly signal?: AbortSignal
}

export interface SkillEvaluationCaseAuthorResult {
  readonly knownCorrectionSkill: string
  readonly evaluatorSource: string
  readonly searchEvidence: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
}

export type SkillEvaluationGovernanceResult =
  | { readonly status: 'ready'; readonly evaluationEvidenceId: string }
  | { readonly status: 'budget-deferred'; readonly evaluationEvidenceId: string; readonly retryAt: number }

export interface SkillEvaluationGovernanceRunView {
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly evaluationEvidenceId: string
  readonly phase:
    | 'prepared'
    | 'budget-deferred'
    | 'authoring-pending'
    | 'admission-ready'
    | 'authored'
    | 'uncertain'
    | 'incomplete'
    | 'ready'
  readonly pendingRole?: 'admission' | 'holdout'
  readonly createdAt: string
  readonly updatedAt: string
  readonly modelCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly retryAt?: number
  readonly failure?:
    | 'paid-authoring-uncertain'
    | 'admission-calibration-failed'
    | 'holdout-calibration-failed'
    | 'governance-incomplete'
  readonly releaseAuthority: 'none'
}

export interface SkillEvaluationGovernanceScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly SkillEvaluationGovernanceRunView[]
}

interface SkillEvaluationGovernanceOptions {
  readonly policies: readonly SkillEvaluationGovernancePolicyConfig[]
  readonly evidence: Pick<SkillEvaluationEvidenceVault, 'readForGovernance' | 'verifyCandidateBinding'>
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly authorModel?: (input: SkillEvaluationCaseAuthorInput) => Promise<SkillEvaluationCaseAuthorResult>
  readonly calibrate?: (options: {
    casePackDir: string
    outputDir: string
    signal?: AbortSignal
  }) => Promise<CasePackCalibrationResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

type CandidateIdentity = Pick<ExperienceSkillCandidate,
  'workspaceId' | 'skillName' | 'opportunity' | 'authorship'>

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(CONTENT_ID),
  phase: z.enum([
    'prepared',
    'budget-deferred',
    'authoring-pending',
    'admission-ready',
    'authored',
    'uncertain',
    'incomplete',
    'ready',
  ]),
  pendingRole: z.enum(['admission', 'holdout']).optional(),
  retryAt: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  identity: z.strictObject({
    policyId: z.string().regex(PUBLIC_ID),
    workspaceId: z.uuid(),
    skillName: z.string().regex(PUBLIC_ID),
    opportunityId: z.string().regex(CONTENT_ID),
    evaluationEvidenceId: z.string().regex(CONTENT_ID),
    authoringInputDigest: z.string().regex(CONTENT_ID),
    admissionInputDigest: z.string().regex(CONTENT_ID),
    holdoutInputDigest: z.string().regex(CONTENT_ID),
    modelIdentityHash: z.string().regex(CONTENT_ID),
    dshRevision: z.string().regex(GIT_OBJECT),
  }),
  cost: z.strictObject({
    modelCalls: z.number().int().min(0).max(2),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((state, context) => {
  if ((state.phase === 'authoring-pending') !== (state.pendingRole !== undefined)) {
    context.addIssue({ code: 'custom', message: 'governance pending role does not match its phase' })
  }
  if ((state.phase === 'budget-deferred') !== (state.retryAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'governance retry time does not match its phase' })
  }
})

type GovernanceState = z.infer<typeof stateSchema>

/**
 * The governance-owned seam that turns one exact pre-authoring evidence seal
 * into calibrated admission and holdout Case Packs. It never receives a
 * Candidate artifact and has no promotion or release interface.
 */
export class SkillEvaluationGovernance {
  private readonly policies = new Map<string, SkillEvaluationGovernancePolicyConfig>()
  private readonly evidence: SkillEvaluationGovernanceOptions['evidence']
  private readonly budget: SkillEvaluationGovernanceOptions['budget']
  private readonly authorModel: NonNullable<SkillEvaluationGovernanceOptions['authorModel']>
  private readonly calibrate: NonNullable<SkillEvaluationGovernanceOptions['calibrate']>
  private readonly modelIdentity: NonNullable<SkillEvaluationGovernanceOptions['modelIdentity']>
  private readonly now: NonNullable<SkillEvaluationGovernanceOptions['now']>
  private tail: Promise<void> = Promise.resolve()

  constructor(options: SkillEvaluationGovernanceOptions) {
    assertPolicies(options.policies)
    for (const policy of options.policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.evidence = options.evidence
    this.budget = options.budget
    this.authorModel = options.authorModel ?? requestCaseAuthor
    this.calibrate = options.calibrate ?? calibrateCasePack
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
    this.now = options.now ?? Date.now
  }

  ensure(candidate: CandidateIdentity): Promise<SkillEvaluationGovernanceResult> {
    let result: SkillEvaluationGovernanceResult | undefined
    const task = this.tail.then(async () => {
      result = await this.ensureNow(candidate)
    })
    this.tail = task.then(() => {}, () => {})
    return task.then(() => result!)
  }

  /** Bounded, redacted durable state for the authoritative Host/Web control plane. */
  async scan(workspaceId?: string): Promise<SkillEvaluationGovernanceScan> {
    const runs: SkillEvaluationGovernanceRunView[] = []
    let warningCount = 0
    let configuredPolicyCount = 0
    for (const policy of this.policies.values()) {
      if (workspaceId !== undefined && policy.workspaceId !== workspaceId) continue
      configuredPolicyCount += 1
      const authoringRoot = join(policy.runRoot, 'envelope-authoring')
      let skillEntries
      try {
        skillEntries = await readdir(authoringRoot, { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) warningCount += 1
        continue
      }
      if (skillEntries.length > MAX_SCAN_ROWS) warningCount += 1
      for (const skillEntry of skillEntries.slice(0, MAX_SCAN_ROWS)) {
        if (runs.length >= MAX_SCAN_ROWS) break
        if (!skillEntry.isDirectory() || !PUBLIC_ID.test(skillEntry.name)) continue
        let runEntries
        try {
          runEntries = await readdir(join(authoringRoot, skillEntry.name, 'runs'), {
            withFileTypes: true,
          })
        } catch (error) {
          if (!isMissing(error)) warningCount += 1
          continue
        }
        if (runEntries.length > MAX_SCAN_ROWS) warningCount += 1
        for (const runEntry of runEntries.slice(0, MAX_SCAN_ROWS)) {
          if (runs.length >= MAX_SCAN_ROWS) break
          if (!runEntry.isDirectory() || !CONTENT_ID.test(runEntry.name)) continue
          try {
            const state = await loadState(join(authoringRoot, skillEntry.name, 'runs', runEntry.name))
            if (state.id !== runEntry.name
              || state.identity.policyId !== policy.id
              || state.identity.workspaceId !== policy.workspaceId
              || state.identity.skillName !== skillEntry.name
              || state.identity.dshRevision !== policy.dshRevision) {
              warningCount += 1
              continue
            }
            runs.push(projectState(state))
          } catch {
            warningCount += 1
          }
        }
      }
    }
    return Object.freeze({
      configuredPolicyCount,
      warningCount,
      runs: Object.freeze(runs
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
        .slice(0, MAX_SCAN_ROWS)),
    })
  }

  private async ensureNow(candidate: CandidateIdentity): Promise<SkillEvaluationGovernanceResult> {
    const policy = this.policies.get(candidate.workspaceId)
    if (policy === undefined) throw new Error('Skill evaluation governance policy is unavailable')
    await this.evidence.verifyCandidateBinding(candidate)
    const evidence = await this.evidence.readForGovernance(
      candidate.workspaceId,
      candidate.opportunity.id,
      candidate.authorship.evaluationEvidenceId,
    )
    assertCandidateSnapshot(candidate, evidence)
    const authorIdentity = this.modelIdentity()
    if (authorIdentity.trim() === '' || Buffer.byteLength(authorIdentity) > 2_048) {
      throw new Error('Skill evaluation governance model identity is invalid')
    }
    if (sha256(authorIdentity) === candidate.authorship.modelIdentityHash) {
      throw new Error('Candidate proposer cannot author its evaluation governance')
    }
    const identity = governanceIdentity(policy, evidence, authorIdentity)
    const runRoot = join(policy.runRoot, 'envelope-authoring', candidate.skillName)
    await ensureExactDirectory(policy.governanceRoot, 'evaluation governance root')
    await ensureExactDirectory(runRoot, 'evaluation governance authoring root')
    if (!separateRoots(policy.governanceRoot, runRoot)) {
      throw new Error('evaluation governance and authoring roots must not overlap')
    }
    const envelopeRoot = join(
      policy.governanceRoot,
      'envelopes',
      candidate.opportunity.id,
      candidate.authorship.evaluationEvidenceId,
    )
    if (await exactEnvelopeExists(envelopeRoot)) {
      return Object.freeze({
        status: 'ready',
        evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      })
    }

    const journalRoot = join(runRoot, 'runs', identity.id)
    await mkdir(journalRoot, { recursive: true, mode: 0o700 })
    await exactDirectory(journalRoot, 'evaluation governance journal root')
    let state = await prepareState(journalRoot, identity, this.now())
    if (state.phase === 'authoring-pending') {
      state = await updateState(journalRoot, state, {
        phase: 'uncertain',
        pendingRole: undefined,
        reason: `paid ${state.pendingRole} evaluator authoring outcome is uncertain; refusing automatic retry`,
      }, this.now())
    }
    if (state.phase === 'budget-deferred') {
      if (state.retryAt! > this.now()) {
        return Object.freeze({
          status: 'budget-deferred',
          evaluationEvidenceId: evidence.id,
          retryAt: state.retryAt!,
        })
      }
      state = await updateState(journalRoot, state, {
        phase: 'prepared',
        retryAt: undefined,
        reason: undefined,
      }, this.now())
    }
    if (state.phase === 'uncertain' || state.phase === 'incomplete') {
      throw new Error(state.reason ?? `Skill evaluation governance is ${state.phase}`)
    }
    if (state.phase === 'ready') {
      if (!await exactEnvelopeExists(envelopeRoot)) {
        throw new Error('ready governance journal has no exact installed Envelope')
      }
      return Object.freeze({ status: 'ready', evaluationEvidenceId: evidence.id })
    }

    if (state.phase === 'prepared') {
      const reservation = await this.budget.reserve({
        id: policy.id,
        workspaceId: policy.workspaceId,
        skill: candidate.skillName,
        runRoot,
        maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay,
      }, evidence.id)
      if (!reservation.allowed) {
        if (reservation.retryAt === undefined) throw new Error('governance budget denied without retry time')
        state = await updateState(journalRoot, state, {
          phase: 'budget-deferred',
          retryAt: reservation.retryAt,
          reason: 'daily paid governance-authoring budget exhausted',
        }, this.now())
        return Object.freeze({
          status: 'budget-deferred',
          evaluationEvidenceId: evidence.id,
          retryAt: reservation.retryAt,
        })
      }
      state = await this.authorRole(policy, evidence, identity, journalRoot, state, 'admission')
    }
    if (state.phase === 'admission-ready') {
      state = await this.authorRole(policy, evidence, identity, journalRoot, state, 'holdout')
    }
    if (state.phase !== 'authored') throw new Error('Skill evaluation governance did not author both roles')

    const draftRoot = join(journalRoot, 'drafts')
    for (const role of ['admission', 'holdout'] as const) {
      const calibrationRoot = join(journalRoot, 'calibration', role)
      await mkdir(dirname(calibrationRoot), { recursive: true, mode: 0o700 })
      const outcome = await this.calibrate({
        casePackDir: join(draftRoot, role),
        outputDir: calibrationRoot,
      })
      if (outcome.status !== 'calibrated') {
        await updateState(journalRoot, state, {
          phase: 'incomplete',
          reason: `${role} Case Pack calibration ${outcome.status}: ${outcome.reason}`,
        }, this.now())
        throw new Error(`${role} Case Pack calibration failed closed`)
      }
    }

    await installEnvelope(policy, evidence, identity, draftRoot, envelopeRoot)
    await updateState(journalRoot, state, { phase: 'ready', reason: undefined }, this.now())
    return Object.freeze({ status: 'ready', evaluationEvidenceId: evidence.id })
  }

  private async authorRole(
    policy: SkillEvaluationGovernancePolicyConfig,
    evidence: SkillEvaluationEvidenceManifest,
    identity: GovernanceState['identity'] & { readonly id: string },
    journalRoot: string,
    initial: GovernanceState,
    role: 'admission' | 'holdout',
  ): Promise<GovernanceState> {
    let state = await updateState(journalRoot, initial, {
      phase: 'authoring-pending',
      pendingRole: role,
      retryAt: undefined,
      cost: { ...initial.cost, modelCalls: initial.cost.modelCalls + 1 },
      reason: undefined,
    }, this.now())
    const samples = evidence.samples.filter(sample => sample.role === role)
    let result: SkillEvaluationCaseAuthorResult
    try {
      result = await this.authorModel({
        idempotencyKey: sha256(JSON.stringify([
          'internal-skill-evaluation-case-author-v1',
          identity.id,
          role,
        ])),
        role,
        workspaceId: evidence.workspaceId,
        skillName: evidence.opportunity.skillName,
        opportunityId: evidence.opportunity.id,
        evaluationEvidenceId: evidence.id,
        goalEvidence: samples.map(sample => Object.freeze({
          id: sample.goalId,
          revision: sample.revision,
          objective: sample.objective,
          gapIds: Object.freeze([...sample.gapIds]),
        })),
        dshRevision: policy.dshRevision,
      })
    } catch (error) {
      await updateState(journalRoot, state, {
        phase: 'uncertain',
        pendingRole: undefined,
        reason: `paid ${role} evaluator authoring outcome is uncertain; refusing automatic retry`,
      }, this.now())
      throw error
    }
    const validated = validateAuthorResult(result, evidence.opportunity.skillName)
    const packDir = join(journalRoot, 'drafts', role)
    await writeCasePack(packDir, policy, evidence, identity, role, validated)
    state = await updateState(journalRoot, state, {
      phase: role === 'admission' ? 'admission-ready' : 'authored',
      pendingRole: undefined,
      cost: {
        modelCalls: state.cost.modelCalls,
        inputTokens: state.cost.inputTokens + validated.usage.inputTokens,
        outputTokens: state.cost.outputTokens + validated.usage.outputTokens,
      },
    }, this.now())
    return state
  }
}

function governanceIdentity(
  policy: SkillEvaluationGovernancePolicyConfig,
  evidence: SkillEvaluationEvidenceManifest,
  modelIdentity: string,
): GovernanceState['identity'] & { readonly id: string } {
  const identity = {
    policyId: policy.id,
    workspaceId: policy.workspaceId,
    skillName: evidence.opportunity.skillName,
    opportunityId: evidence.opportunity.id,
    evaluationEvidenceId: evidence.id,
    authoringInputDigest: evidence.authoringInputDigest,
    admissionInputDigest: skillEvaluationProtectedInputDigest(evidence, 'admission'),
    holdoutInputDigest: skillEvaluationProtectedInputDigest(evidence, 'holdout'),
    modelIdentityHash: sha256(modelIdentity),
    dshRevision: policy.dshRevision,
  } as const
  return Object.freeze({
    ...identity,
    id: sha256(JSON.stringify(['internal-skill-evaluation-governance-v1', identity])),
  })
}

function projectState(state: GovernanceState): SkillEvaluationGovernanceRunView {
  const failure = state.phase === 'uncertain'
    ? 'paid-authoring-uncertain' as const
    : state.phase !== 'incomplete'
      ? undefined
      : state.reason?.startsWith('admission Case Pack calibration')
        ? 'admission-calibration-failed' as const
        : state.reason?.startsWith('holdout Case Pack calibration')
          ? 'holdout-calibration-failed' as const
          : 'governance-incomplete' as const
  return Object.freeze({
    id: state.id,
    policyId: state.identity.policyId,
    workspaceId: state.identity.workspaceId,
    skillName: state.identity.skillName,
    opportunityId: state.identity.opportunityId,
    evaluationEvidenceId: state.identity.evaluationEvidenceId,
    phase: state.phase,
    ...(state.pendingRole === undefined ? {} : { pendingRole: state.pendingRole }),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    modelCalls: state.cost.modelCalls,
    inputTokens: state.cost.inputTokens,
    outputTokens: state.cost.outputTokens,
    ...(state.retryAt === undefined ? {} : { retryAt: state.retryAt }),
    ...(failure === undefined ? {} : { failure }),
    releaseAuthority: 'none',
  })
}

async function writeCasePack(
  path: string,
  policy: SkillEvaluationGovernancePolicyConfig,
  evidence: SkillEvaluationEvidenceManifest,
  identity: GovernanceState['identity'],
  role: 'admission' | 'holdout',
  result: SkillEvaluationCaseAuthorResult,
): Promise<void> {
  await mkdir(join(path, 'calibration', 'known-bad'), { recursive: true, mode: 0o700 })
  await mkdir(join(path, 'calibration', 'known-correction'), { recursive: true, mode: 0o700 })
  await mkdir(join(path, 'final-test'), { recursive: true, mode: 0o700 })
  await mkdir(join(path, 'search'), { recursive: true, mode: 0o700 })
  const evaluatorVersion = sha256(JSON.stringify([
    'internal-governance-evaluator-v1',
    role,
    role === 'admission' ? identity.admissionInputDigest : identity.holdoutInputDigest,
    result.evaluatorSource,
  ]))
  const manifest = {
    schemaVersion: 1,
    id: `internal-${role}-${evidence.id.slice(0, 12)}`,
    workspaceId: evidence.workspaceId,
    epoch: { dshRevision: policy.dshRevision, evaluatorVersion },
    budget: {
      candidateLimit: 1,
      trialLimit: 4,
      inputTokenLimit: 12_000,
      outputTokenLimit: 4_000,
    },
    search: { evidence: 'search/evidence.md' },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 30_000,
      outputLimitBytes: 256 * 1024,
      dshAssembled: role === 'holdout',
      capabilityAbsentBaseline: true,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }
  await Promise.all([
    writeFile(join(path, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 }),
    writeFile(join(path, 'calibration', 'known-bad', 'SKILL.md'), knownBadSkill(evidence.opportunity.skillName), { flag: 'wx', mode: 0o600 }),
    writeFile(join(path, 'calibration', 'known-correction', 'SKILL.md'), result.knownCorrectionSkill, { flag: 'wx', mode: 0o600 }),
    writeFile(join(path, 'final-test', 'evaluator.mjs'), result.evaluatorSource, { flag: 'wx', mode: 0o600 }),
    writeFile(join(path, 'search', 'evidence.md'), `${result.searchEvidence.trim()}\n`, { flag: 'wx', mode: 0o600 }),
  ])
}

async function installEnvelope(
  policy: SkillEvaluationGovernancePolicyConfig,
  evidence: SkillEvaluationEvidenceManifest,
  identity: GovernanceState['identity'],
  draftRoot: string,
  target: string,
): Promise<void> {
  const parent = dirname(target)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await exactDirectory(parent, 'evaluation Envelope evidence parent')
  const stage = join(parent, `.envelope-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    const baselineDir = join(stage, 'baseline')
    await mkdir(baselineDir, { mode: 0o700 })
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      workspaceId: evidence.workspaceId,
      opportunityId: evidence.opportunity.id,
      skillName: evidence.opportunity.skillName,
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await Promise.all([
      cp(join(draftRoot, 'admission'), join(stage, 'admission'), { recursive: true, errorOnExist: true }),
      cp(join(draftRoot, 'holdout'), join(stage, 'holdout'), { recursive: true, errorOnExist: true }),
    ])
    const [baselineHash, admissionCasePackHash, holdoutCasePackHash] = await Promise.all([
      hashTree(baselineDir),
      hashTree(join(stage, 'admission')),
      hashTree(join(stage, 'holdout')),
    ])
    if (admissionCasePackHash === holdoutCasePackHash) {
      throw new Error('independently authored admission and holdout Case Packs are identical')
    }
    await writeDurableJson(join(stage, 'manifest.json'), {
      schemaVersion: 4,
      kind: 'internal-skill-evaluation-envelope-v4',
      workspaceId: evidence.workspaceId,
      evaluationEvidenceId: evidence.id,
      opportunity: {
        id: evidence.opportunity.id,
        skillName: evidence.opportunity.skillName,
        gapIds: [...evidence.opportunity.gapIds],
        goalCount: evidence.opportunity.goalCount,
      },
      governance: {
        modelIdentityHash: identity.modelIdentityHash,
        admissionInputDigest: identity.admissionInputDigest,
        holdoutInputDigest: identity.holdoutInputDigest,
      },
      baseline: { kind: 'capability-absent', descriptorTreeHash: baselineHash },
      admissionCasePackHash,
      holdoutCasePackHash,
    })
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      if (!await exactEnvelopeExists(target)) throw error
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

function validateAuthorResult(
  value: SkillEvaluationCaseAuthorResult,
  skillName: string,
): SkillEvaluationCaseAuthorResult {
  if (!isRecord(value)
    || typeof value.knownCorrectionSkill !== 'string'
    || typeof value.evaluatorSource !== 'string'
    || typeof value.searchEvidence !== 'string'
    || !isRecord(value.usage)
    || !Number.isSafeInteger(value.usage.inputTokens)
    || value.usage.inputTokens < 0
    || !Number.isSafeInteger(value.usage.outputTokens)
    || value.usage.outputTokens < 0
    || value.usage.outputTokens > AUTHOR_OUTPUT_TOKEN_LIMIT
    || value.knownCorrectionSkill.trim() === ''
    || value.evaluatorSource.trim() === ''
    || value.searchEvidence.trim() === ''
    || Buffer.byteLength(value.knownCorrectionSkill) > MAX_SKILL_BYTES
    || Buffer.byteLength(value.evaluatorSource) > MAX_EVALUATOR_BYTES
    || Buffer.byteLength(value.searchEvidence) > MAX_EVIDENCE_BYTES) {
    throw new Error('Skill evaluation governance author response has an invalid shape')
  }
  const header = parseSkillHeader(value.knownCorrectionSkill)
  if (header.name !== skillName) {
    throw new Error('governance known-correction Skill does not match the sealed Opportunity')
  }
  return Object.freeze({
    knownCorrectionSkill: normalizeText(value.knownCorrectionSkill),
    evaluatorSource: normalizeText(value.evaluatorSource),
    searchEvidence: value.searchEvidence.trim(),
    usage: Object.freeze({ ...value.usage }),
  })
}

function parseSkillHeader(source: string): { readonly name: string } {
  const normalized = source.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('governance correction Skill has no frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('governance correction Skill has invalid frontmatter')
  const parsed = parseYaml(normalized.slice(4, end)) as unknown
  if (!isRecord(parsed) || typeof parsed.name !== 'string' || !PUBLIC_ID.test(parsed.name)) {
    throw new Error('governance correction Skill has an invalid name')
  }
  return { name: parsed.name }
}

function normalizeText(value: string): string {
  const normalized = value.replaceAll('\r\n', '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function knownBadSkill(name: string): string {
  return [
    '---',
    `name: ${name}`,
    'description: Deliberately incomplete calibration fixture.',
    '---',
    '',
    'Do not provide the missing capability. Abstain without applying a method.',
    '',
  ].join('\n')
}

function assertCandidateSnapshot(
  candidate: CandidateIdentity,
  evidence: SkillEvaluationEvidenceManifest,
): void {
  if (evidence.workspaceId !== candidate.workspaceId
    || evidence.id !== candidate.authorship.evaluationEvidenceId
    || evidence.authoringInputDigest !== candidate.authorship.inputDigest
    || evidence.opportunity.id !== candidate.opportunity.id
    || evidence.opportunity.skillName !== candidate.skillName
    || evidence.opportunity.goalCount !== candidate.opportunity.goalCount
    || JSON.stringify([...evidence.opportunity.gapIds].sort())
      !== JSON.stringify([...candidate.opportunity.gapIds].sort())) {
    throw new Error('Skill evaluation governance Candidate does not match its exact evidence seal')
  }
}

async function prepareState(
  root: string,
  identity: GovernanceState['identity'] & { readonly id: string },
  now: number,
): Promise<GovernanceState> {
  try {
    const existing = await loadState(root)
    const { id: _id, ...stateIdentity } = identity
    if (existing.id !== identity.id
      || JSON.stringify(existing.identity) !== JSON.stringify(stateIdentity)) {
      throw new Error('Skill evaluation governance journal identity changed')
    }
    return existing
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const instant = new Date(now).toISOString()
  const { id, ...stateIdentity } = identity
  const state = stateSchema.parse({
    schemaVersion: 1,
    id,
    phase: 'prepared',
    createdAt: instant,
    updatedAt: instant,
    identity: stateIdentity,
    cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 },
  })
  await writeDurableJson(join(root, 'state.json'), state)
  return state
}

async function loadState(root: string): Promise<GovernanceState> {
  const path = join(root, 'state.json')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('Skill evaluation governance state must be an exact real file')
  }
  if (info.size > MAX_STATE_BYTES) throw new Error('Skill evaluation governance state exceeds its byte limit')
  return stateSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function updateState(
  root: string,
  current: GovernanceState,
  patch: Partial<Pick<GovernanceState, 'phase' | 'pendingRole' | 'retryAt' | 'cost' | 'reason'>>,
  now: number,
): Promise<GovernanceState> {
  const next = stateSchema.parse({
    ...current,
    ...patch,
    updatedAt: new Date(now).toISOString(),
  })
  await writeDurableJson(join(root, 'state.json'), next)
  return next
}

function assertPolicies(policies: readonly SkillEvaluationGovernancePolicyConfig[]): void {
  assertSkillCandidateEvaluationPolicies(policies)
  if (policies.length === 0 || policies.length > 100) {
    throw new Error('Skill evaluation governance requires 1-100 Workspace policies')
  }
  for (const policy of policies) {
    if (!PUBLIC_ID.test(policy.id)
      || !z.uuid().safeParse(policy.workspaceId).success
      || !GIT_OBJECT.test(policy.dshRevision)
      || !Number.isInteger(policy.maxAttemptsPerUtcDay)
      || policy.maxAttemptsPerUtcDay < 1
      || policy.maxAttemptsPerUtcDay > 20) {
      throw new Error(`invalid Skill evaluation governance policy '${policy.id}'`)
    }
  }
}

async function ensureExactDirectory(path: string, label: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await exactDirectory(path, label)
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

async function exactEnvelopeExists(path: string): Promise<boolean> {
  try {
    await exactDirectory(path, 'Skill Evaluation Envelope')
    const manifest = join(path, 'manifest.json')
    const info = await lstat(manifest)
    return info.isFile() && !info.isSymbolicLink() && await realpath(manifest) === manifest
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

function separateRoots(left: string, right: string): boolean {
  return !containsPath(left, right) && !containsPath(right, left)
}

function containsPath(parent: string, child: string): boolean {
  const value = relative(parent, child)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !value.startsWith('/'))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function configuredModelIdentity(): string {
  return boundedModelProviderIdentity(
    requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL'),
    requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_NAME'),
  )
}

async function requestCaseAuthor(
  input: SkillEvaluationCaseAuthorInput,
): Promise<SkillEvaluationCaseAuthorResult> {
  const baseUrl = requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL')
  const model = requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_NAME')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': input.idempotencyKey,
  }
  const apiKey = process.env.DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY
  if (apiKey !== undefined && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const response = await fetch(new URL('chat/completions', `${baseUrl.replace(/\/+$/u, '')}/`), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: AUTHOR_OUTPUT_TOKEN_LIMIT,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You author an independent hidden evaluator for one missing DSH Skill.',
            'Use only the supplied protected DSH Goal evidence; do not assume or inspect any Candidate.',
            'Return JSON with knownCorrectionSkill, evaluatorSource, and searchEvidence.',
            input.role === 'admission'
              ? 'For admission, evaluatorSource must be a deterministic filesystem-only evaluator.mjs: read the Candidate Skill tree from argv[2], support the capability-absent flags, do not start DSH, spawn processes, call a model, or use network, and emit the required JSON outcome.'
              : 'For holdout, evaluatorSource must run as evaluator.mjs in the DSH EvoForge assembled capability-absent protocol: use the Candidate tree at argv[2], DSH source at argv[3], exercise the real DSH Skill/Agent path, support the capability-absent flags, and emit outcome plus composition evidence.',
            'It must reject an incomplete calibration Skill and accept the independent known correction.',
            'It has no promotion or release authority.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
    ...input.signal === undefined ? {} : { signal: input.signal },
  })
  const payload = await readBoundedJson(response)
  if (!response.ok) throw new ObservedGovernanceResponseError(`governance author request failed with HTTP ${response.status}`)
  const message = isRecord(payload)
    && Array.isArray(payload.choices)
    && isRecord(payload.choices[0])
    && isRecord(payload.choices[0].message)
    && typeof payload.choices[0].message.content === 'string'
    ? payload.choices[0].message.content
    : undefined
  if (message === undefined) throw new ObservedGovernanceResponseError('governance author response has no content')
  let authored: unknown
  try {
    authored = JSON.parse(message)
  } catch {
    throw new ObservedGovernanceResponseError('governance author response content is not valid JSON')
  }
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {}
  return validateAuthorResult({
    ...(isRecord(authored) ? authored : {}),
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
  } as SkillEvaluationCaseAuthorResult, input.skillName)
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_AUTHOR_RESPONSE_BYTES) {
    throw new Error('governance author response exceeds its byte limit')
  }
  if (response.body === null) throw new Error('governance author response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_AUTHOR_RESPONSE_BYTES) {
      await reader.cancel('governance author response exceeds its byte limit')
      throw new Error('governance author response exceeds its byte limit')
    }
    chunks.push(next.value)
  }
  const content = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(content)
  } catch {
    throw new ObservedGovernanceResponseError('governance author response is not valid JSON')
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`Skill evaluation governance requires ${name}`)
  return value
}

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
}

class ObservedGovernanceResponseError extends Error {}
