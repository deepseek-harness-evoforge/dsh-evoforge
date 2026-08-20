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
import type {
  ExistingSkillBaselineQualificationManifest,
} from './existing-skill-baseline-qualification.ts'
import type {
  ExistingSkillAuthoringEvidence,
  ExistingSkillEvaluationEvidenceManifest,
} from './existing-skill-evaluation-evidence-vault.ts'
import { hashTree } from './hash.ts'
import type { ResolvedInstalledSkillBundle } from './installed-skill-baseline.ts'
import { boundedModelProviderIdentity } from './model-provider-identity.ts'
import {
  assembleSealedSkillBundleArchive,
  type SkillBundleArchiveFile,
} from './skill-bundle-archive.ts'
import {
  assertSkillCandidateEvaluationPolicies,
} from './skill-evaluation-envelope.ts'
import type { SkillEvaluationGovernancePolicyConfig } from './skill-evaluation-governance.ts'
import type { SkillImprovementOpportunity } from './skill-opportunity-discovery.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u
const MAX_SCAN_ROWS = 1_000
const MAX_STATE_BYTES = 64 * 1024
const MAX_BINDING_BYTES = 128 * 1024
const MAX_AUTHOR_INPUT_BYTES = 512 * 1024
const MAX_AUTHOR_RESPONSE_BYTES = 256 * 1024
const MAX_EVALUATOR_BYTES = 128 * 1024
const MAX_SKILL_BYTES = 64 * 1024
const AUTHOR_OUTPUT_TOKEN_LIMIT = 6_000

export interface ExistingSkillHoldoutAuthorInput {
  readonly idempotencyKey: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly evaluationEvidenceId: string
  readonly baseline: {
    readonly id: string
    readonly treeHash: string
    readonly files: readonly {
      readonly path: string
      readonly mode: '100644'
      readonly size: number
      readonly digest: string
      readonly representation: 'utf8' | 'binary'
      readonly content?: string
    }[]
  }
  readonly holdoutCase: {
    readonly goal: { readonly id: string; readonly revision: number; readonly objective: string }
    readonly request: string
    readonly requestHasOmittedContent: boolean
    readonly correction: string
  }
  readonly dshRevision: string
  readonly signal?: AbortSignal
}

export interface ExistingSkillHoldoutAuthorResult {
  readonly knownCorrectionSkill: string
  readonly evaluatorSource: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export interface ExistingSkillHoldoutGovernanceSubject {
  readonly opportunity: SkillImprovementOpportunity
  readonly qualification: ExistingSkillBaselineQualificationManifest
  readonly baseline: ResolvedInstalledSkillBundle
  readonly evidence: ExistingSkillAuthoringEvidence
  readonly proposerModelIdentityHash: string
}

export interface ExistingSkillHoldoutEnvelope {
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly evaluationEvidenceId: string
  readonly casePackDir: string
  readonly casePackHash: string
  readonly dshRevision: string
  readonly releaseAuthority: 'none'
}

export type ExistingSkillHoldoutGovernanceResult =
  | { readonly status: 'ready'; readonly envelope: ExistingSkillHoldoutEnvelope }
  | { readonly status: 'budget-deferred'; readonly retryAt: number; readonly releaseAuthority: 'none' }

export interface ExistingSkillHoldoutGovernanceRunView {
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly evaluationEvidenceId: string
  readonly phase: 'prepared' | 'budget-deferred' | 'authoring-pending' | 'uncertain' | 'incomplete' | 'ready'
  readonly createdAt: string
  readonly updatedAt: string
  readonly modelCalls: 0 | 1
  readonly inputTokens: number
  readonly outputTokens: number
  readonly retryAt?: number
  readonly failure?: 'paid-authoring-uncertain' | 'calibration-failed' | 'governance-incomplete'
  readonly releaseAuthority: 'none'
}

export interface ExistingSkillHoldoutGovernanceScan {
  readonly configuredPolicyCount: number
  readonly warningCount: number
  readonly runs: readonly ExistingSkillHoldoutGovernanceRunView[]
}

interface ExistingSkillHoldoutGovernanceOptions {
  readonly policies: readonly SkillEvaluationGovernancePolicyConfig[]
  readonly evidence: {
    readForGovernance(
      workspaceId: string,
      opportunityId: string,
      qualificationId: string,
      evidenceId: string,
    ): Promise<ExistingSkillEvaluationEvidenceManifest>
  }
  readonly budget: Pick<AutomaticEvolutionBudget, 'reserve'>
  readonly authorModel?: (input: ExistingSkillHoldoutAuthorInput) => Promise<ExistingSkillHoldoutAuthorResult>
  readonly calibrate?: (options: {
    casePackDir: string
    outputDir: string
    signal?: AbortSignal
  }) => Promise<CasePackCalibrationResult>
  readonly modelIdentity?: () => string
  readonly now?: () => number
}

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-holdout-governance-state-v1'),
  id: z.string().regex(CONTENT_ID),
  phase: z.enum(['prepared', 'budget-deferred', 'authoring-pending', 'uncertain', 'incomplete', 'ready']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  identity: z.strictObject({
    policyId: z.string().regex(PUBLIC_ID),
    workspaceId: z.uuid(),
    skillName: z.string().regex(PUBLIC_ID),
    opportunityId: z.string().regex(CONTENT_ID),
    qualificationId: z.string().regex(CONTENT_ID),
    baselineId: z.string().regex(CONTENT_ID),
    baselineTreeHash: z.string().regex(CONTENT_ID),
    evaluationEvidenceId: z.string().regex(CONTENT_ID),
    holdoutInputDigest: z.string().regex(CONTENT_ID),
    proposerModelIdentityHash: z.string().regex(CONTENT_ID),
    governanceModelIdentityHash: z.string().regex(CONTENT_ID),
    dshRevision: z.string().regex(GIT_OBJECT),
  }),
  cost: z.strictObject({
    modelCalls: z.union([z.literal(0), z.literal(1)]),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  retryAt: z.number().int().nonnegative().optional(),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((state, context) => {
  if ((state.phase === 'budget-deferred') !== (state.retryAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'existing-Skill holdout retry state is inconsistent' })
  }
  if (state.phase === 'authoring-pending' && state.cost.modelCalls !== 1) {
    context.addIssue({ code: 'custom', message: 'existing-Skill holdout pending state has no paid call' })
  }
})

type HoldoutState = z.infer<typeof stateSchema>

interface HoldoutBinding {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-holdout-envelope-v1'
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly baselineTreeHash: string
  readonly evaluationEvidenceId: string
  readonly governanceModelIdentityHash: string
  readonly holdoutInputDigest: string
  readonly casePackHash: string
  readonly dshRevision: string
  readonly releaseAuthority: 'none'
}

/** Candidate-independent authoring and calibration of one existing-Skill holdout. */
export class ExistingSkillHoldoutGovernance {
  private readonly policies = new Map<string, SkillEvaluationGovernancePolicyConfig>()
  private readonly evidence: ExistingSkillHoldoutGovernanceOptions['evidence']
  private readonly budget: ExistingSkillHoldoutGovernanceOptions['budget']
  private readonly authorModel: NonNullable<ExistingSkillHoldoutGovernanceOptions['authorModel']>
  private readonly calibrate: NonNullable<ExistingSkillHoldoutGovernanceOptions['calibrate']>
  private readonly modelIdentity: NonNullable<ExistingSkillHoldoutGovernanceOptions['modelIdentity']>
  private readonly now: NonNullable<ExistingSkillHoldoutGovernanceOptions['now']>
  private tail: Promise<void> = Promise.resolve()

  constructor(options: ExistingSkillHoldoutGovernanceOptions) {
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
    this.authorModel = options.authorModel ?? requestHoldoutAuthor
    this.calibrate = options.calibrate ?? calibrateCasePack
    this.modelIdentity = options.modelIdentity ?? configuredModelIdentity
    this.now = options.now ?? Date.now
  }

  ensure(
    subject: ExistingSkillHoldoutGovernanceSubject,
    options: { signal?: AbortSignal } = {},
  ): Promise<ExistingSkillHoldoutGovernanceResult> {
    let result: ExistingSkillHoldoutGovernanceResult | undefined
    const task = this.tail.then(async () => {
      result = await this.ensureNow(subject, options)
    })
    this.tail = task.then(() => {}, () => {})
    return task.then(() => result!)
  }

  async scan(workspaceId?: string): Promise<ExistingSkillHoldoutGovernanceScan> {
    const runs: ExistingSkillHoldoutGovernanceRunView[] = []
    let configuredPolicyCount = 0
    let warningCount = 0
    for (const policy of this.policies.values()) {
      if (workspaceId !== undefined && policy.workspaceId !== workspaceId) continue
      configuredPolicyCount += 1
      const root = join(policy.runRoot, 'existing-skill-holdout-authoring')
      let skillEntries
      try {
        skillEntries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if (!isMissing(error)) warningCount += 1
        continue
      }
      if (skillEntries.length > MAX_SCAN_ROWS) warningCount += 1
      for (const skill of skillEntries.slice(0, MAX_SCAN_ROWS)) {
        if (!skill.isDirectory() || !PUBLIC_ID.test(skill.name)) continue
        let entries
        try {
          entries = await readdir(join(root, skill.name, 'runs'), { withFileTypes: true })
        } catch (error) {
          if (!isMissing(error)) warningCount += 1
          continue
        }
        if (entries.length > MAX_SCAN_ROWS) warningCount += 1
        for (const entry of entries.slice(0, MAX_SCAN_ROWS)) {
          if (runs.length >= MAX_SCAN_ROWS) break
          if (!entry.isDirectory() || !CONTENT_ID.test(entry.name)) continue
          try {
            const state = await loadState(join(root, skill.name, 'runs', entry.name))
            if (state.id !== entry.name
              || state.identity.policyId !== policy.id
              || state.identity.workspaceId !== policy.workspaceId
              || state.identity.skillName !== skill.name
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
      runs: Object.freeze(runs.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))),
    })
  }

  private async ensureNow(
    subject: ExistingSkillHoldoutGovernanceSubject,
    options: { signal?: AbortSignal },
  ): Promise<ExistingSkillHoldoutGovernanceResult> {
    options.signal?.throwIfAborted()
    const policy = this.policies.get(subject.opportunity.workspaceId)
    if (policy === undefined) throw new Error('existing-Skill holdout governance policy is unavailable')
    assertSubject(subject)
    const baselineArchive = await assembleSealedSkillBundleArchive(subject.baseline.files)
    assertBaseline(subject, baselineArchive)
    const governed = await this.evidence.readForGovernance(
      subject.opportunity.workspaceId,
      subject.opportunity.id,
      subject.qualification.id,
      subject.evidence.id,
    )
    const holdout = exactHoldout(subject, governed)
    const authorIdentity = this.modelIdentity()
    if (authorIdentity.trim() === '' || Buffer.byteLength(authorIdentity) > 2_048) {
      throw new Error('existing-Skill holdout governance model identity is invalid')
    }
    const governanceModelIdentityHash = sha256(authorIdentity)
    if (governanceModelIdentityHash === subject.proposerModelIdentityHash) {
      throw new Error('Candidate proposer cannot author its existing-Skill holdout')
    }
    const holdoutInputDigest = sha256Json(holdout)
    const identity = governanceIdentity(
      policy,
      subject,
      holdoutInputDigest,
      governanceModelIdentityHash,
    )
    const installedRoot = join(
      policy.governanceRoot,
      'existing-skill-holdouts',
      subject.opportunity.id,
      subject.qualification.id,
      subject.evidence.id,
    )
    const existing = await readOptionalEnvelope(installedRoot, identity)
    if (existing !== undefined) return { status: 'ready', envelope: existing }

    const authoringRoot = join(policy.runRoot, 'existing-skill-holdout-authoring', subject.opportunity.skillName)
    await ensureExactDirectory(policy.governanceRoot)
    await ensureExactDirectory(authoringRoot)
    if (!separateRoots(policy.governanceRoot, authoringRoot)) {
      throw new Error('existing-Skill holdout governance and run roots overlap')
    }
    const runDir = join(authoringRoot, 'runs', identity.id)
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    await exactDirectory(runDir)
    let state = await prepareState(runDir, identity, this.now())
    if (state.phase === 'authoring-pending') {
      state = await updateState(runDir, state, {
        phase: 'uncertain',
        reason: 'paid existing-Skill holdout authoring outcome is uncertain; refusing automatic retry',
      }, this.now())
    }
    if (state.phase === 'budget-deferred') {
      if (state.retryAt! > this.now()) {
        return { status: 'budget-deferred', retryAt: state.retryAt!, releaseAuthority: 'none' }
      }
      state = await updateState(runDir, state, {
        phase: 'prepared',
        retryAt: undefined,
        reason: undefined,
      }, this.now())
    }
    if (state.phase === 'uncertain' || state.phase === 'incomplete') {
      throw new Error(state.reason ?? `existing-Skill holdout governance is ${state.phase}`)
    }
    if (state.phase === 'ready') {
      const envelope = await readOptionalEnvelope(installedRoot, identity)
      if (envelope === undefined) throw new Error('ready holdout governance has no installed envelope')
      return { status: 'ready', envelope }
    }

    const reservation = await this.budget.reserve({
      id: policy.id,
      workspaceId: policy.workspaceId,
      skill: subject.opportunity.skillName,
      runRoot: authoringRoot,
      maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay,
    }, subject.evidence.id)
    if (!reservation.allowed) {
      if (reservation.retryAt === undefined) throw new Error('existing-Skill holdout budget denied without retry time')
      await updateState(runDir, state, {
        phase: 'budget-deferred',
        retryAt: reservation.retryAt,
        reason: 'daily paid existing-Skill holdout budget exhausted',
      }, this.now())
      return { status: 'budget-deferred', retryAt: reservation.retryAt, releaseAuthority: 'none' }
    }

    state = await updateState(runDir, state, {
      phase: 'authoring-pending',
      cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      reason: undefined,
    }, this.now())
    let authored: ExistingSkillHoldoutAuthorResult
    try {
      authored = await this.authorModel(buildAuthorInput(policy, subject, holdout, identity.id, options.signal))
    } catch (error) {
      await updateState(runDir, state, {
        phase: 'uncertain',
        reason: 'paid existing-Skill holdout authoring outcome is uncertain; refusing automatic retry',
      }, this.now())
      throw error
    }
    const observedUsage = authorUsage(authored)
    let validated: ExistingSkillHoldoutAuthorResult
    try {
      options.signal?.throwIfAborted()
      validated = validateAuthorResult(authored, subject.baseline.files)
    } catch (error) {
      await updateState(runDir, state, {
        phase: 'incomplete',
        cost: { modelCalls: 1, ...observedUsage },
        reason: `existing-Skill holdout governance incomplete: ${errorDetail(error)}`,
      }, this.now())
      throw error
    }
    const draft = join(runDir, 'draft-case-pack')
    const calibrationRoot = join(runDir, 'calibration')
    let calibration: CasePackCalibrationResult
    try {
      await rm(draft, { force: true, recursive: true })
      await writeCasePack(draft, policy, subject, baselineArchive.files, holdoutInputDigest, validated)
      await rm(calibrationRoot, { force: true, recursive: true })
      await mkdir(dirname(calibrationRoot), { recursive: true, mode: 0o700 })
      calibration = await this.calibrate({
        casePackDir: draft,
        outputDir: calibrationRoot,
        ...options.signal === undefined ? {} : { signal: options.signal },
      })
    } catch (error) {
      await updateState(runDir, state, {
        phase: 'incomplete',
        cost: { modelCalls: 1, ...validated.usage },
        reason: `existing-Skill holdout governance incomplete: ${errorDetail(error)}`,
      }, this.now())
      throw error
    }
    if (calibration.status !== 'calibrated') {
      await updateState(runDir, state, {
        phase: 'incomplete',
        cost: {
          modelCalls: 1,
          inputTokens: validated.usage.inputTokens,
          outputTokens: validated.usage.outputTokens,
        },
        reason: `existing-Skill holdout calibration ${calibration.status}: ${calibration.reason}`,
      }, this.now())
      throw new Error('existing-Skill holdout calibration failed closed')
    }
    let envelope: ExistingSkillHoldoutEnvelope
    try {
      envelope = await installEnvelope(
        installedRoot,
        identity,
        draft,
        await hashTree(draft),
      )
    } catch (error) {
      await updateState(runDir, state, {
        phase: 'incomplete',
        cost: { modelCalls: 1, ...validated.usage },
        reason: `existing-Skill holdout governance incomplete: ${errorDetail(error)}`,
      }, this.now())
      throw error
    }
    await updateState(runDir, state, {
      phase: 'ready',
      cost: {
        modelCalls: 1,
        inputTokens: validated.usage.inputTokens,
        outputTokens: validated.usage.outputTokens,
      },
      reason: undefined,
    }, this.now())
    return { status: 'ready', envelope }
  }
}

function assertPolicies(policies: readonly SkillEvaluationGovernancePolicyConfig[]): void {
  assertSkillCandidateEvaluationPolicies(policies)
  if (policies.length < 1 || policies.length > 100) {
    throw new Error('existing-Skill holdout governance requires 1-100 policies')
  }
  for (const policy of policies) {
    if (!GIT_OBJECT.test(policy.dshRevision)
      || !Number.isInteger(policy.maxAttemptsPerUtcDay)
      || policy.maxAttemptsPerUtcDay < 1
      || policy.maxAttemptsPerUtcDay > 20) {
      throw new Error(`invalid existing-Skill holdout governance policy '${policy.id}'`)
    }
  }
}

function assertSubject(subject: ExistingSkillHoldoutGovernanceSubject): void {
  const { opportunity, qualification, baseline, evidence } = subject
  if (!CONTENT_ID.test(subject.proposerModelIdentityHash)
    || qualification.opportunityId !== opportunity.id
    || qualification.workspaceId !== opportunity.workspaceId
    || qualification.skillName !== opportunity.skillName
    || qualification.invocationContentHash !== opportunity.invocationContentHash
    || qualification.baseline.id !== baseline.manifest.id
    || evidence.id === ''
    || evidence.workspaceId !== opportunity.workspaceId
    || evidence.opportunityId !== opportunity.id
    || evidence.qualificationId !== qualification.id
    || evidence.baselineId !== baseline.manifest.id
    || evidence.skillName !== opportunity.skillName
    || evidence.holdoutGoalCount !== 1
    || evidence.proposerCanReadProtectedSamples !== false
    || evidence.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout subject does not bind one exact protected baseline')
  }
}

function assertBaseline(
  subject: ExistingSkillHoldoutGovernanceSubject,
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): void {
  const manifest = subject.baseline.manifest
  const qualified = subject.qualification.baseline
  if (manifest.workspaceId !== subject.opportunity.workspaceId
    || manifest.skillName !== subject.opportunity.skillName
    || manifest.invocationContentHash !== subject.opportunity.invocationContentHash
    || manifest.bundle.artifactDigest !== archive.artifactDigest
    || manifest.bundle.treeHash !== archive.treeHash
    || manifest.bundle.fileCount !== archive.files.length
    || manifest.bundle.totalBytes !== archive.totalBytes
    || manifest.bundle.hasExecutableFiles !== false
    || qualified.artifactDigest !== archive.artifactDigest
    || qualified.treeHash !== archive.treeHash
    || qualified.fileCount !== archive.files.length
    || qualified.totalBytes !== archive.totalBytes
    || manifest.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout baseline identity is inconsistent')
  }
}

function exactHoldout(
  subject: ExistingSkillHoldoutGovernanceSubject,
  manifest: ExistingSkillEvaluationEvidenceManifest,
): ExistingSkillEvaluationEvidenceManifest['samples'][number] {
  if (manifest.id !== subject.evidence.id
    || manifest.workspaceId !== subject.opportunity.workspaceId
    || manifest.opportunity.id !== subject.opportunity.id
    || manifest.opportunity.skillName !== subject.opportunity.skillName
    || manifest.opportunity.invocationContentHash !== subject.opportunity.invocationContentHash
    || manifest.qualification.id !== subject.qualification.id
    || manifest.qualification.baselineId !== subject.baseline.manifest.id
    || manifest.authoringInputDigest !== subject.evidence.authoringInputDigest
    || manifest.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout evidence identity is inconsistent')
  }
  const samples = manifest.samples.filter(sample => sample.role === 'holdout')
  if (samples.length !== 1) throw new Error('existing-Skill holdout evidence must contain one protected case')
  return samples[0]!
}

function governanceIdentity(
  policy: SkillEvaluationGovernancePolicyConfig,
  subject: ExistingSkillHoldoutGovernanceSubject,
  holdoutInputDigest: string,
  governanceModelIdentityHash: string,
): HoldoutState['identity'] & { readonly id: string } {
  const identity = {
    policyId: policy.id,
    workspaceId: policy.workspaceId,
    skillName: subject.opportunity.skillName,
    opportunityId: subject.opportunity.id,
    qualificationId: subject.qualification.id,
    baselineId: subject.baseline.manifest.id,
    baselineTreeHash: subject.baseline.manifest.bundle.treeHash,
    evaluationEvidenceId: subject.evidence.id,
    holdoutInputDigest,
    proposerModelIdentityHash: subject.proposerModelIdentityHash,
    governanceModelIdentityHash,
    dshRevision: policy.dshRevision,
  } as const
  return Object.freeze({
    ...identity,
    id: sha256Json(['existing-skill-holdout-governance-v1', identity]),
  })
}

function buildAuthorInput(
  policy: SkillEvaluationGovernancePolicyConfig,
  subject: ExistingSkillHoldoutGovernanceSubject,
  holdout: ExistingSkillEvaluationEvidenceManifest['samples'][number],
  identityId: string,
  signal?: AbortSignal,
): ExistingSkillHoldoutAuthorInput {
  const files = subject.baseline.files.map((file) => {
    const decoded = canonicalUtf8(file.content)
    return Object.freeze({
      path: file.path,
      mode: file.mode,
      size: file.content.byteLength,
      digest: sha256(file.content),
      representation: decoded === undefined ? 'binary' as const : 'utf8' as const,
      ...(decoded === undefined ? {} : { content: decoded }),
    })
  })
  const input: ExistingSkillHoldoutAuthorInput = Object.freeze({
    idempotencyKey: sha256Json(['existing-skill-holdout-author-v1', identityId]),
    workspaceId: subject.opportunity.workspaceId,
    skillName: subject.opportunity.skillName,
    opportunityId: subject.opportunity.id,
    qualificationId: subject.qualification.id,
    evaluationEvidenceId: subject.evidence.id,
    baseline: Object.freeze({
      id: subject.baseline.manifest.id,
      treeHash: subject.baseline.manifest.bundle.treeHash,
      files: Object.freeze(files),
    }),
    holdoutCase: Object.freeze({
      goal: Object.freeze({ ...holdout.goal }),
      request: holdout.request.text,
      requestHasOmittedContent: holdout.request.omittedNonText,
      correction: holdout.correction.note,
    }),
    dshRevision: policy.dshRevision,
    ...(signal === undefined ? {} : { signal }),
  })
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_AUTHOR_INPUT_BYTES) {
    throw new Error('existing-Skill holdout author input exceeds its byte budget')
  }
  return input
}

function validateAuthorResult(
  result: ExistingSkillHoldoutAuthorResult,
  baselineFiles: readonly SkillBundleArchiveFile[],
): ExistingSkillHoldoutAuthorResult {
  if (!isRecord(result)
    || Object.keys(result).sort().join(',') !== 'evaluatorSource,knownCorrectionSkill,usage'
    || typeof result.knownCorrectionSkill !== 'string'
    || typeof result.evaluatorSource !== 'string'
    || !isUsage(result.usage)
    || result.knownCorrectionSkill.trim() === ''
    || result.evaluatorSource.trim() === ''
    || Buffer.byteLength(result.knownCorrectionSkill) > MAX_SKILL_BYTES
    || Buffer.byteLength(result.evaluatorSource) > MAX_EVALUATOR_BYTES) {
    throw new Error('existing-Skill holdout author response has an invalid shape')
  }
  const baselineSkill = baselineFiles.find(file => file.path === 'SKILL.md')
  if (baselineSkill === undefined) throw new Error('existing-Skill holdout baseline has no SKILL.md')
  const baselineHeader = skillHeader(requiredCanonicalUtf8(baselineSkill.content))
  const correction = normalizeText(result.knownCorrectionSkill)
  const correctionHeader = skillHeader(correction)
  if (correctionHeader.name !== baselineHeader.name
    || correctionHeader.permissionFingerprint !== baselineHeader.permissionFingerprint
    || correctionHeader.license !== baselineHeader.license
    || correction === requiredCanonicalUtf8(baselineSkill.content)) {
    throw new Error('existing-Skill holdout known correction changes protected Skill identity')
  }
  return Object.freeze({
    knownCorrectionSkill: correction,
    evaluatorSource: normalizeText(result.evaluatorSource),
    usage: Object.freeze({ ...result.usage }),
  })
}

async function writeCasePack(
  root: string,
  policy: SkillEvaluationGovernancePolicyConfig,
  subject: ExistingSkillHoldoutGovernanceSubject,
  baselineFiles: readonly SkillBundleArchiveFile[],
  holdoutInputDigest: string,
  result: ExistingSkillHoldoutAuthorResult,
): Promise<void> {
  const baselineSkill = baselineFiles.find(file => file.path === 'SKILL.md')
  if (baselineSkill === undefined) throw new Error('existing-Skill holdout baseline has no SKILL.md')
  const knownBadSkill = syntheticKnownBadSkill(requiredCanonicalUtf8(baselineSkill.content))
  const knownBad = replaceSkillFile(baselineFiles, knownBadSkill)
  const knownCorrection = replaceSkillFile(baselineFiles, result.knownCorrectionSkill)
  const [badArchive, correctionArchive, baselineArchive] = await Promise.all([
    assembleSealedSkillBundleArchive(knownBad),
    assembleSealedSkillBundleArchive(knownCorrection),
    assembleSealedSkillBundleArchive(baselineFiles),
  ])
  if (badArchive.treeHash === correctionArchive.treeHash
    || badArchive.treeHash === baselineArchive.treeHash
    || correctionArchive.treeHash === baselineArchive.treeHash) {
    throw new Error('existing-Skill holdout calibration trees are not independent variants')
  }
  await mkdir(join(root, 'calibration', 'known-bad'), { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'calibration', 'known-correction'), { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'final-test'), { recursive: true, mode: 0o700 })
  await Promise.all([
    materializeFiles(join(root, 'calibration', 'known-bad'), badArchive.files),
    materializeFiles(join(root, 'calibration', 'known-correction'), correctionArchive.files),
    writeFile(join(root, 'final-test', 'evaluator.mjs'), result.evaluatorSource, { flag: 'wx', mode: 0o600 }),
  ])
  const manifest = {
    schemaVersion: 1,
    id: `existing-holdout-${subject.evidence.id.slice(0, 12)}`,
    workspaceId: subject.opportunity.workspaceId,
    epoch: {
      dshRevision: policy.dshRevision,
      evaluatorVersion: sha256Json([
        'existing-skill-holdout-evaluator-v1',
        holdoutInputDigest,
        result.evaluatorSource,
      ]),
    },
    budget: {
      candidateLimit: 1,
      trialLimit: 4,
      inputTokenLimit: 12_000,
      outputTokenLimit: 4_000,
    },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 30_000,
      outputLimitBytes: 256 * 1024,
      dshAssembled: true,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
}

async function installEnvelope(
  target: string,
  identity: HoldoutState['identity'] & { readonly id: string },
  draft: string,
  casePackHash: string,
): Promise<ExistingSkillHoldoutEnvelope> {
  const parent = dirname(target)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await exactDirectory(parent)
  const binding: HoldoutBinding = {
    schemaVersion: 1,
    kind: 'existing-skill-holdout-envelope-v1',
    id: sha256Json(['existing-skill-holdout-envelope-v1', identity, casePackHash]),
    workspaceId: identity.workspaceId,
    skillName: identity.skillName,
    opportunityId: identity.opportunityId,
    qualificationId: identity.qualificationId,
    baselineId: identity.baselineId,
    baselineTreeHash: identity.baselineTreeHash,
    evaluationEvidenceId: identity.evaluationEvidenceId,
    governanceModelIdentityHash: identity.governanceModelIdentityHash,
    holdoutInputDigest: identity.holdoutInputDigest,
    casePackHash,
    dshRevision: identity.dshRevision,
    releaseAuthority: 'none',
  }
  const stage = join(parent, `.holdout-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    await cp(draft, join(stage, 'case-pack'), { recursive: true, errorOnExist: true })
    await writeDurableJson(join(stage, 'binding.json'), binding)
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
  const envelope = await readOptionalEnvelope(target, identity)
  if (envelope === undefined) throw new Error('existing-Skill holdout envelope install failed')
  return envelope
}

async function readOptionalEnvelope(
  root: string,
  identity: HoldoutState['identity'] & { readonly id: string },
): Promise<ExistingSkillHoldoutEnvelope | undefined> {
  try {
    await exactDirectory(root)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  const value = await readBoundedJson(join(root, 'binding.json'), MAX_BINDING_BYTES)
  const binding = parseBinding(value)
  const expectedWithoutId = {
    workspaceId: identity.workspaceId,
    skillName: identity.skillName,
    opportunityId: identity.opportunityId,
    qualificationId: identity.qualificationId,
    baselineId: identity.baselineId,
    baselineTreeHash: identity.baselineTreeHash,
    evaluationEvidenceId: identity.evaluationEvidenceId,
    governanceModelIdentityHash: identity.governanceModelIdentityHash,
    holdoutInputDigest: identity.holdoutInputDigest,
    dshRevision: identity.dshRevision,
  }
  if (Object.entries(expectedWithoutId).some(([key, expected]) =>
    binding[key as keyof HoldoutBinding] !== expected)) {
    throw new Error('existing-Skill holdout binding does not match its protected subject')
  }
  const casePackDir = join(root, 'case-pack')
  if (await hashTree(await exactDirectory(casePackDir)) !== binding.casePackHash
    || binding.id !== sha256Json(['existing-skill-holdout-envelope-v1', identity, binding.casePackHash])) {
    throw new Error('existing-Skill holdout Case Pack content identity is invalid')
  }
  return Object.freeze({
    id: binding.id,
    workspaceId: binding.workspaceId,
    skillName: binding.skillName,
    opportunityId: binding.opportunityId,
    qualificationId: binding.qualificationId,
    baselineId: binding.baselineId,
    evaluationEvidenceId: binding.evaluationEvidenceId,
    casePackDir,
    casePackHash: binding.casePackHash,
    dshRevision: binding.dshRevision,
    releaseAuthority: 'none',
  })
}

function parseBinding(value: unknown): HoldoutBinding {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'existing-skill-holdout-envelope-v1'
    || !CONTENT_ID.test(String(value.id))
    || typeof value.workspaceId !== 'string'
    || !PUBLIC_ID.test(String(value.skillName))
    || !CONTENT_ID.test(String(value.opportunityId))
    || !CONTENT_ID.test(String(value.qualificationId))
    || !CONTENT_ID.test(String(value.baselineId))
    || !CONTENT_ID.test(String(value.baselineTreeHash))
    || !CONTENT_ID.test(String(value.evaluationEvidenceId))
    || !CONTENT_ID.test(String(value.governanceModelIdentityHash))
    || !CONTENT_ID.test(String(value.holdoutInputDigest))
    || !CONTENT_ID.test(String(value.casePackHash))
    || !GIT_OBJECT.test(String(value.dshRevision))
    || value.releaseAuthority !== 'none') {
    throw new Error('existing-Skill holdout binding has an invalid shape')
  }
  return value as unknown as HoldoutBinding
}

async function prepareState(
  root: string,
  identity: HoldoutState['identity'] & { readonly id: string },
  now: number,
): Promise<HoldoutState> {
  try {
    const state = await loadState(root)
    const { id: _id, ...expected } = identity
    if (state.id !== identity.id || JSON.stringify(state.identity) !== JSON.stringify(expected)) {
      throw new Error('existing-Skill holdout governance state identity changed')
    }
    return state
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  const { id, ...stateIdentity } = identity
  const instant = isoTime(now)
  const state = stateSchema.parse({
    schemaVersion: 1,
    kind: 'existing-skill-holdout-governance-state-v1',
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

async function loadState(root: string): Promise<HoldoutState> {
  await exactDirectory(root)
  return stateSchema.parse(await readBoundedJson(join(root, 'state.json'), MAX_STATE_BYTES))
}

async function updateState(
  root: string,
  state: HoldoutState,
  patch: Partial<Pick<HoldoutState, 'phase' | 'cost' | 'retryAt' | 'reason'>>,
  now: number,
): Promise<HoldoutState> {
  const next = stateSchema.parse({ ...state, ...patch, updatedAt: isoTime(now) })
  await writeDurableJson(join(root, 'state.json'), next)
  return next
}

function projectState(state: HoldoutState): ExistingSkillHoldoutGovernanceRunView {
  const failure = state.phase === 'uncertain'
    ? 'paid-authoring-uncertain' as const
    : state.phase !== 'incomplete'
      ? undefined
      : state.reason?.startsWith('existing-Skill holdout calibration')
        ? 'calibration-failed' as const
        : 'governance-incomplete' as const
  return Object.freeze({
    id: state.id,
    policyId: state.identity.policyId,
    workspaceId: state.identity.workspaceId,
    skillName: state.identity.skillName,
    opportunityId: state.identity.opportunityId,
    qualificationId: state.identity.qualificationId,
    baselineId: state.identity.baselineId,
    evaluationEvidenceId: state.identity.evaluationEvidenceId,
    phase: state.phase,
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

function replaceSkillFile(
  files: readonly SkillBundleArchiveFile[],
  skill: string,
): SkillBundleArchiveFile[] {
  return files.map(file => Object.freeze({
    path: file.path,
    mode: file.mode,
    content: file.path === 'SKILL.md' ? Buffer.from(skill) : Buffer.from(file.content),
  }))
}

function syntheticKnownBadSkill(baseline: string): string {
  const end = baseline.indexOf('\n---\n', 4)
  if (!baseline.startsWith('---\n') || end < 0) {
    throw new Error('existing-Skill holdout baseline has invalid frontmatter')
  }
  return `${baseline.slice(0, end + 5)}\nDeliberately abstain without applying the release method.\n`
}

async function materializeFiles(root: string, files: readonly SkillBundleArchiveFile[]): Promise<void> {
  for (const file of files) {
    const target = resolve(root, ...file.path.split('/'))
    assertInside(root, target)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
  }
}

function skillHeader(source: string): {
  readonly name: string
  readonly license?: string
  readonly permissionFingerprint: string
} {
  if (!source.startsWith('---\n')) throw new Error('existing-Skill holdout Skill has no frontmatter')
  const end = source.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('existing-Skill holdout Skill has invalid frontmatter')
  const value = parseYaml(source.slice(4, end)) as unknown
  if (!isRecord(value) || typeof value.name !== 'string' || !PUBLIC_ID.test(value.name)) {
    throw new Error('existing-Skill holdout Skill has an invalid name')
  }
  if (value.license !== undefined && (typeof value.license !== 'string' || value.license.trim() === '')) {
    throw new Error('existing-Skill holdout Skill has an invalid license')
  }
  const permissions: Record<string, unknown> = {}
  if (Object.hasOwn(value, 'permissions')) permissions.permissions = value.permissions
  if (Object.hasOwn(value, 'allowed-tools')) permissions['allowed-tools'] = value['allowed-tools']
  return {
    name: value.name,
    ...(typeof value.license === 'string' ? { license: value.license.trim() } : {}),
    permissionFingerprint: JSON.stringify(sortRecord(permissions)),
  }
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function canonicalUtf8(content: Buffer): string | undefined {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
    return Buffer.from(decoded).equals(content) ? decoded : undefined
  } catch {
    return undefined
  }
}

function requiredCanonicalUtf8(content: Buffer): string {
  const decoded = canonicalUtf8(content)
  if (decoded === undefined) throw new Error('existing-Skill holdout instruction is not canonical UTF-8')
  return decoded
}

function normalizeText(value: string): string {
  const normalized = value.replaceAll('\r\n', '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function configuredModelIdentity(): string {
  return boundedModelProviderIdentity(
    requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL'),
    requiredEnvironment('DSH_EVOLVE_GOVERNANCE_MODEL_NAME'),
  )
}

async function requestHoldoutAuthor(
  input: ExistingSkillHoldoutAuthorInput,
): Promise<ExistingSkillHoldoutAuthorResult> {
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
            'Author one independent hidden assembled DSH holdout for an existing Skill.',
            'Use only the exact sealed baseline and supplied protected holdout case.',
            'You never receive a Candidate and must not infer or request Candidate content.',
            'Return JSON with exactly knownCorrectionSkill and evaluatorSource.',
            'knownCorrectionSkill is a complete replacement for root SKILL.md; preserve exact name, license, permissions, and allowed-tools.',
            'evaluatorSource runs at argv[2]=one complete Skill tree and argv[3]=the pinned DSH source, exercises the real DSH Skill/Agent path, and emits schemaVersion/passed/checks/composition JSON.',
            'The same evaluator must reject the synthetic known-bad tree and accept the independent known-correction tree.',
            'Do not use network, external search, promotion, installation outside the sealed Trial, or release authority.',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
    }),
    ...input.signal === undefined ? {} : { signal: input.signal },
  })
  const payload = await readResponseJson(response)
  if (!response.ok) throw new Error(`existing-Skill holdout author request failed with HTTP ${response.status}`)
  const message = isRecord(payload)
    && Array.isArray(payload.choices)
    && isRecord(payload.choices[0])
    && isRecord(payload.choices[0].message)
    && typeof payload.choices[0].message.content === 'string'
    ? payload.choices[0].message.content
    : undefined
  if (message === undefined) throw new Error('existing-Skill holdout author response has no content')
  const authored = JSON.parse(message) as unknown
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {}
  return {
    ...(isRecord(authored) ? authored : {}),
    usage: {
      inputTokens: safeUsage(usage.prompt_tokens),
      outputTokens: safeUsage(usage.completion_tokens),
    },
  } as ExistingSkillHoldoutAuthorResult
}

async function readResponseJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_AUTHOR_RESPONSE_BYTES) {
    throw new Error('existing-Skill holdout author response exceeds its byte limit')
  }
  if (response.body === null) throw new Error('existing-Skill holdout author response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_AUTHOR_RESPONSE_BYTES) {
      await reader.cancel('existing-Skill holdout author response exceeds its byte limit')
      throw new Error('existing-Skill holdout author response exceeds its byte limit')
    }
    chunks.push(next.value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function readBoundedJson(path: string, limit: number): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit || await realpath(path) !== path) {
    throw new Error('existing-Skill holdout document is not an exact bounded file')
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
    throw new Error('existing-Skill holdout path must be an exact real directory')
  }
  return actual
}

function separateRoots(left: string, right: string): boolean {
  return !containsPath(left, right) && !containsPath(right, left)
}

function containsPath(parent: string, child: string): boolean {
  const value = relative(parent, child)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !value.startsWith('/'))
}

function assertInside(root: string, path: string): void {
  const value = relative(root, path)
  if (value === '' || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error('existing-Skill holdout file escapes its root')
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`existing-Skill holdout requires ${name}`)
  return value
}

function isUsage(value: unknown): value is ExistingSkillHoldoutAuthorResult['usage'] {
  return isRecord(value)
    && Object.keys(value).sort().join(',') === 'inputTokens,outputTokens'
    && Number.isSafeInteger(value.inputTokens) && (value.inputTokens as number) >= 0
    && Number.isSafeInteger(value.outputTokens) && (value.outputTokens as number) >= 0
    && (value.outputTokens as number) <= AUTHOR_OUTPUT_TOKEN_LIMIT
}

function safeUsage(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0
}

function authorUsage(value: unknown): ExistingSkillHoldoutAuthorResult['usage'] {
  const usage = isRecord(value) && isRecord(value.usage) ? value.usage : {}
  return {
    inputTokens: safeUsage(usage.inputTokens),
    outputTokens: safeUsage(usage.outputTokens),
  }
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/gu, ' ').slice(0, 384) || 'unknown error'
}

function isoTime(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('existing-Skill holdout clock is invalid')
  return new Date(value).toISOString()
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value))
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
