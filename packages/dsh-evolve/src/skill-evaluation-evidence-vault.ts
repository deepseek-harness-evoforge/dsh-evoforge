import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'
import {
  assertSkillCandidateEvaluationPolicies,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import type { SkillOpportunity } from './skill-opportunity-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SELECTED_GOALS = 12
const MAX_OBJECTIVE_BYTES = 4 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024

const sampleSchema = z.strictObject({
  role: z.enum(['authoring', 'admission', 'holdout', 'retention']),
  goalId: z.string().min(1).max(512),
  revision: z.number().int().nonnegative(),
  objective: z.string().min(1).max(8_192),
  observedAt: z.number().int().nonnegative(),
  gapIds: z.array(z.string().regex(CONTENT_ID)).min(1).max(1_000),
})

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('internal-skill-evaluation-evidence-v1'),
  id: z.string().regex(CONTENT_ID),
  workspaceId: z.uuid(),
  opportunity: z.strictObject({
    id: z.string().regex(CONTENT_ID),
    skillName: z.string().regex(PUBLIC_ID),
    gapIds: z.array(z.string().regex(CONTENT_ID)).min(4).max(1_000),
    goalIds: z.array(z.string().min(1).max(512)).min(4).max(1_000),
    gapCount: z.number().int().min(4).max(1_000),
    goalCount: z.number().int().min(4).max(1_000),
  }),
  selection: z.strictObject({
    selectedGoalCount: z.number().int().min(4).max(MAX_SELECTED_GOALS),
    omittedGoalCount: z.number().int().nonnegative().max(1_000),
  }),
  samples: z.array(sampleSchema).min(4).max(MAX_SELECTED_GOALS),
  authoringInputDigest: z.string().regex(CONTENT_ID),
  releaseAuthority: z.literal('none'),
}).superRefine((manifest, context) => {
  if (manifest.opportunity.gapIds.length !== new Set(manifest.opportunity.gapIds).size) {
    context.addIssue({ code: 'custom', message: 'evaluation evidence contains duplicate Gap ids' })
  }
  const goalIds = manifest.samples.map(sample => sample.goalId)
  if (goalIds.length !== new Set(goalIds).size) {
    context.addIssue({ code: 'custom', message: 'evaluation evidence samples must use distinct Goals' })
  }
  for (const role of ['authoring', 'admission', 'holdout'] as const) {
    if (!manifest.samples.some(sample => sample.role === role)) {
      context.addIssue({ code: 'custom', message: `evaluation evidence requires a ${role} sample` })
    }
  }
  if (manifest.samples.length >= 5
    && !manifest.samples.some(sample => sample.role === 'retention')) {
    context.addIssue({ code: 'custom', message: 'five-goal evaluation evidence requires a retention sample' })
  }
})

export type SkillEvaluationEvidenceManifest = z.infer<typeof manifestSchema>

export interface SkillAuthoringEvidence {
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly authoringGapIds: readonly string[]
  readonly authoringGoalEvidence: readonly {
    readonly id: string
    readonly revision: number
    readonly objective: string
  }[]
  readonly authoringGoalCount: number
  readonly admissionGoalCount: number
  readonly holdoutGoalCount: number
  readonly retentionGoalCount: number
  readonly authoringInputDigest: string
}

export type SkillEvaluationEvidencePreparation =
  | { readonly status: 'ready'; readonly evidence: SkillAuthoringEvidence }
  | {
      readonly status: 'abstained'
      readonly reason: 'governance-policy-unavailable' | 'fewer-than-four-independent-goals'
      readonly observedGoalCount: number
      readonly requiredGoalCount: 4
    }

export type SkillEvaluationEvidenceReadiness =
  | {
      readonly status: 'ready-to-seal' | 'sealed'
      readonly evidenceId: string
      readonly observedGoalCount: number
      readonly authoringGoalCount: number
      readonly admissionGoalCount: number
      readonly holdoutGoalCount: number
      readonly retentionGoalCount: number
      readonly proposerCanReadProtectedSamples: false
      readonly releaseAuthority: 'none'
    }
  | {
      readonly status: 'waiting'
      readonly reason: 'fewer-than-four-independent-goals'
      readonly observedGoalCount: number
      readonly requiredGoalCount: 4
      readonly releaseAuthority: 'none'
    }
  | {
      readonly status: 'unavailable'
      readonly reason: 'governance-policy-unavailable'
      readonly observedGoalCount: number
      readonly releaseAuthority: 'none'
    }
  | {
      readonly status: 'invalid'
      readonly reason: 'opportunity-evidence-invalid'
      readonly observedGoalCount: number
      readonly releaseAuthority: 'none'
    }

/**
 * Seal an Opportunity's internal Goal evidence before Candidate authoring.
 * The author-facing interface returns only its authoring subset; protected
 * admission and holdout samples remain available solely through the
 * governance reader.
 */
export class SkillEvaluationEvidenceVault {
  private readonly policies = new Map<string, SkillCandidateEvaluationPolicyConfig>()
  private readonly gaps: Pick<CapabilityGapStore, 'list'>

  constructor(
    policies: readonly SkillCandidateEvaluationPolicyConfig[],
    gaps: Pick<CapabilityGapStore, 'list'>,
  ) {
    assertSkillCandidateEvaluationPolicies(policies)
    for (const policy of policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.gaps = gaps
  }

  async readiness(opportunity: SkillOpportunity): Promise<SkillEvaluationEvidenceReadiness> {
    if (!this.policies.has(opportunity.workspaceId)) {
      return Object.freeze({
        status: 'unavailable',
        reason: 'governance-policy-unavailable',
        observedGoalCount: opportunity.goalCount,
        releaseAuthority: 'none',
      })
    }
    if (opportunity.goalCount < 4) {
      return Object.freeze({
        status: 'waiting',
        reason: 'fewer-than-four-independent-goals',
        observedGoalCount: opportunity.goalCount,
        requiredGoalCount: 4,
        releaseAuthority: 'none',
      })
    }
    try {
      const manifest = buildManifest(opportunity, this.gaps.list(opportunity.workspaceId))
      const view = authoringView(manifest)
      let status: 'ready-to-seal' | 'sealed' = 'ready-to-seal'
      try {
        const installed = await this.readForGovernance(
          opportunity.workspaceId,
          opportunity.id,
          manifest.id,
        )
        if (JSON.stringify(installed) !== JSON.stringify(manifest)) {
          throw new Error('content-addressed evaluation evidence collision')
        }
        status = 'sealed'
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      return Object.freeze({
        status,
        evidenceId: manifest.id,
        observedGoalCount: opportunity.goalCount,
        authoringGoalCount: view.authoringGoalCount,
        admissionGoalCount: view.admissionGoalCount,
        holdoutGoalCount: view.holdoutGoalCount,
        retentionGoalCount: view.retentionGoalCount,
        proposerCanReadProtectedSamples: false,
        releaseAuthority: 'none',
      })
    } catch {
      return Object.freeze({
        status: 'invalid',
        reason: 'opportunity-evidence-invalid',
        observedGoalCount: opportunity.goalCount,
        releaseAuthority: 'none',
      })
    }
  }

  async prepare(opportunity: SkillOpportunity): Promise<SkillEvaluationEvidencePreparation> {
    const policy = this.policies.get(opportunity.workspaceId)
    if (policy === undefined) {
      return {
        status: 'abstained',
        reason: 'governance-policy-unavailable',
        observedGoalCount: opportunity.goalCount,
        requiredGoalCount: 4,
      }
    }
    if (opportunity.goalCount < 4) {
      return {
        status: 'abstained',
        reason: 'fewer-than-four-independent-goals',
        observedGoalCount: opportunity.goalCount,
        requiredGoalCount: 4,
      }
    }

    const manifest = buildManifest(opportunity, this.gaps.list(opportunity.workspaceId))
    await installManifest(policy.governanceRoot, manifest)
    return Object.freeze({
      status: 'ready' as const,
      evidence: authoringView(manifest),
    })
  }

  async readForGovernance(
    workspaceId: string,
    opportunityId: string,
    evidenceId: string,
  ): Promise<SkillEvaluationEvidenceManifest> {
    const policy = this.policies.get(workspaceId)
    if (policy === undefined) throw new Error('evaluation evidence governance policy is unavailable')
    if (!CONTENT_ID.test(opportunityId) || !CONTENT_ID.test(evidenceId)) {
      throw new Error('evaluation evidence identity is invalid')
    }
    const root = join(policy.governanceRoot, 'evidence', opportunityId, evidenceId)
    const actualRoot = await exactDirectory(root, 'evaluation evidence root')
    if (actualRoot !== root) throw new Error('evaluation evidence path is not exact')
    const path = join(root, 'manifest.json')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
      throw new Error('evaluation evidence manifest must be an exact real file')
    }
    if (info.size > MAX_MANIFEST_BYTES) {
      throw new Error('evaluation evidence manifest exceeds its byte limit')
    }
    const manifest = manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    assertManifestIdentity(manifest)
    if (manifest.workspaceId !== workspaceId
      || manifest.opportunity.id !== opportunityId
      || manifest.id !== evidenceId) {
      throw new Error('evaluation evidence path does not match its manifest identity')
    }
    return immutableCopy(manifest)
  }

  async verifyCandidateBinding(
    candidate: Pick<ExperienceSkillCandidate,
      'workspaceId' | 'skillName' | 'opportunity' | 'authorship'>,
  ): Promise<void> {
    const manifest = await this.readForGovernance(
      candidate.workspaceId,
      candidate.opportunity.id,
      candidate.authorship.evaluationEvidenceId,
    )
    if (manifest.opportunity.skillName !== candidate.skillName
      || manifest.opportunity.goalCount !== candidate.opportunity.goalCount
      || JSON.stringify([...manifest.opportunity.gapIds].sort())
        !== JSON.stringify([...candidate.opportunity.gapIds].sort())
      || manifest.authoringInputDigest !== candidate.authorship.inputDigest) {
      throw new Error('Candidate authoring does not match its sealed evaluation evidence')
    }
  }

  async verifyEnvelopeProtectedInputs(
    candidate: Pick<ExperienceSkillCandidate,
      'workspaceId' | 'skillName' | 'opportunity' | 'authorship'>,
    inputs: {
      readonly admissionInputDigest: string
      readonly holdoutInputDigest: string
      readonly retentionInputDigest?: string
    },
  ): Promise<void> {
    const manifest = await this.readForGovernance(
      candidate.workspaceId,
      candidate.opportunity.id,
      candidate.authorship.evaluationEvidenceId,
    )
    const hasRetention = manifest.samples.some(sample => sample.role === 'retention')
    if (inputs.admissionInputDigest !== skillEvaluationProtectedInputDigest(manifest, 'admission')
      || inputs.holdoutInputDigest !== skillEvaluationProtectedInputDigest(manifest, 'holdout')
      || (hasRetention
        ? inputs.retentionInputDigest !== skillEvaluationProtectedInputDigest(manifest, 'retention')
        : inputs.retentionInputDigest !== undefined)) {
      throw new Error('Evaluation Envelope protected inputs do not match their evidence seal')
    }
  }
}

export function skillEvaluationProtectedInputDigest(
  manifest: SkillEvaluationEvidenceManifest,
  role: 'admission' | 'holdout' | 'retention',
): string {
  return sha256(JSON.stringify({
    kind: 'internal-skill-evaluation-case-input-v1',
    role,
    evidenceId: manifest.id,
    opportunityId: manifest.opportunity.id,
    skillName: manifest.opportunity.skillName,
    goals: manifest.samples.filter(sample => sample.role === role).map(sample => ({
      id: sample.goalId,
      revision: sample.revision,
      objective: sample.objective,
      gapIds: sample.gapIds,
    })),
  }))
}

function buildManifest(
  opportunity: SkillOpportunity,
  gaps: readonly CapabilityGap[],
): SkillEvaluationEvidenceManifest {
  const exact = new Map(gaps.map(gap => [gap.id, gap]))
  const opportunityGaps = opportunity.gapIds.map((id) => {
    const gap = exact.get(id)
    if (gap === undefined
      || gap.workspaceId !== opportunity.workspaceId
      || gap.requestedSkill !== opportunity.skillName
      || gap.goal === undefined) {
      throw new Error('Skill Opportunity Gap evidence changed before evaluation evidence sealing')
    }
    return gap as CapabilityGap & { readonly goal: NonNullable<CapabilityGap['goal']> }
  })
  const actualGoalIds = [...new Set(opportunityGaps.map(gap => gap.goal.id))].sort()
  if (opportunity.gapCount !== opportunity.gapIds.length
    || opportunity.goalCount !== actualGoalIds.length
    || JSON.stringify([...opportunity.goalIds].sort()) !== JSON.stringify(actualGoalIds)) {
    throw new Error('Skill Opportunity snapshot changed before evaluation evidence sealing')
  }

  const grouped = new Map<string, typeof opportunityGaps>()
  for (const gap of opportunityGaps) {
    const values = grouped.get(gap.goal.id) ?? []
    values.push(gap)
    grouped.set(gap.goal.id, values)
  }
  const ranked = [...grouped.entries()].map(([goalId, values]) => {
    const newest = [...values].sort((left, right) =>
      right.goal.revision - left.goal.revision
      || right.observedAt - left.observedAt
      || left.id.localeCompare(right.id))[0]!
    if (Buffer.byteLength(newest.goal.objective) > MAX_OBJECTIVE_BYTES) {
      throw new Error('evaluation evidence Goal objective exceeds its byte limit')
    }
    return {
      rank: sha256(JSON.stringify(['internal-skill-evaluation-split-v1', opportunity.id, goalId])),
      goalId,
      revision: newest.goal.revision,
      objective: newest.goal.objective,
      observedAt: newest.observedAt,
      gapIds: values.map(value => value.id).sort(),
    }
  }).sort((left, right) => left.rank.localeCompare(right.rank) || left.goalId.localeCompare(right.goalId))
    .slice(0, MAX_SELECTED_GOALS)

  if (ranked.length < 4) throw new Error('evaluation evidence requires four independent Goals')
  const authoringCount = Math.max(2, Math.floor(ranked.length / 2))
  const remaining = ranked.length - authoringCount
  const retentionCount = ranked.length >= 5 ? 1 : 0
  const admissionCount = Math.max(1, Math.floor((remaining - retentionCount) / 2))
  const retentionStart = ranked.length - retentionCount
  const samples = ranked.map((sample, index) => ({
    role: index < authoringCount
      ? 'authoring' as const
      : index < authoringCount + admissionCount
        ? 'admission' as const
        : index < retentionStart
          ? 'holdout' as const
          : 'retention' as const,
    goalId: sample.goalId,
    revision: sample.revision,
    objective: sample.objective,
    observedAt: sample.observedAt,
    gapIds: sample.gapIds,
  }))
  const payload = {
    schemaVersion: 1 as const,
    kind: 'internal-skill-evaluation-evidence-v1' as const,
    workspaceId: opportunity.workspaceId,
    opportunity: {
      id: opportunity.id,
      skillName: opportunity.skillName,
      gapIds: [...opportunity.gapIds].sort(),
      goalIds: actualGoalIds,
      gapCount: opportunity.gapCount,
      goalCount: opportunity.goalCount,
    },
    selection: {
      selectedGoalCount: samples.length,
      omittedGoalCount: opportunity.goalCount - samples.length,
    },
    samples,
    releaseAuthority: 'none' as const,
  }
  const id = sha256(JSON.stringify(payload))
  const authoring = samples.filter(sample => sample.role === 'authoring')
  const authoringInputDigest = sha256(JSON.stringify({
    kind: 'internal-skill-author-input-v2',
    evaluationEvidenceId: id,
    opportunityId: opportunity.id,
    skillName: opportunity.skillName,
    gapIds: authoring.flatMap(sample => sample.gapIds).sort(),
    goals: authoring.map(sample => ({
      id: sample.goalId,
      revision: sample.revision,
      objective: sample.objective,
    })),
  }))
  const manifest = manifestSchema.parse({ ...payload, id, authoringInputDigest })
  if (Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`) > MAX_MANIFEST_BYTES) {
    throw new Error('evaluation evidence manifest exceeds its byte limit')
  }
  return manifest
}

function authoringView(manifest: SkillEvaluationEvidenceManifest): SkillAuthoringEvidence {
  const authoring = manifest.samples.filter(sample => sample.role === 'authoring')
  return immutableCopy({
    id: manifest.id,
    workspaceId: manifest.workspaceId,
    skillName: manifest.opportunity.skillName,
    opportunityId: manifest.opportunity.id,
    authoringGapIds: authoring.flatMap(sample => sample.gapIds).sort(),
    authoringGoalEvidence: authoring.map(sample => ({
      id: sample.goalId,
      revision: sample.revision,
      objective: sample.objective,
    })),
    authoringGoalCount: authoring.length,
    admissionGoalCount: manifest.samples.filter(sample => sample.role === 'admission').length,
    holdoutGoalCount: manifest.samples.filter(sample => sample.role === 'holdout').length,
    retentionGoalCount: manifest.samples.filter(sample => sample.role === 'retention').length,
    authoringInputDigest: manifest.authoringInputDigest,
  })
}

async function installManifest(
  governanceRoot: string,
  manifest: SkillEvaluationEvidenceManifest,
): Promise<void> {
  await ensureExactDirectory(governanceRoot)
  const parent = join(governanceRoot, 'evidence', manifest.opportunity.id)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await exactDirectory(parent, 'evaluation evidence Opportunity root')
  const target = join(parent, manifest.id)
  try {
    const existing = await readInstalledManifest(target)
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
      throw new Error('content-addressed evaluation evidence collision')
    }
    return
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  const stage = join(parent, `.evidence-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    await writeDurableJson(join(stage, 'manifest.json'), manifest)
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = await readInstalledManifest(target)
      if (JSON.stringify(existing) !== JSON.stringify(manifest)) {
        throw new Error('content-addressed evaluation evidence collision')
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function readInstalledManifest(root: string): Promise<SkillEvaluationEvidenceManifest> {
  await exactDirectory(root, 'evaluation evidence root')
  const path = join(root, 'manifest.json')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('evaluation evidence manifest must be an exact real file')
  }
  if (info.size > MAX_MANIFEST_BYTES) {
    throw new Error('evaluation evidence manifest exceeds its byte limit')
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  assertManifestIdentity(manifest)
  return manifest
}

function assertManifestIdentity(manifest: SkillEvaluationEvidenceManifest): void {
  const { id, authoringInputDigest, ...payload } = manifest
  if (sha256(JSON.stringify(payload)) !== id) {
    throw new Error('evaluation evidence content identity mismatch')
  }
  const authoring = manifest.samples.filter(sample => sample.role === 'authoring')
  const expectedInputDigest = sha256(JSON.stringify({
    kind: 'internal-skill-author-input-v2',
    evaluationEvidenceId: id,
    opportunityId: manifest.opportunity.id,
    skillName: manifest.opportunity.skillName,
    gapIds: authoring.flatMap(sample => sample.gapIds).sort(),
    goals: authoring.map(sample => ({
      id: sample.goalId,
      revision: sample.revision,
      objective: sample.objective,
    })),
  }))
  if (expectedInputDigest !== authoringInputDigest) {
    throw new Error('evaluation evidence authoring identity mismatch')
  }
}

async function ensureExactDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await exactDirectory(path, 'evaluation governance root')
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')
}
