import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { hashTree } from './hash.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'
import type { SkillOpportunity } from './skill-opportunity-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_POLICIES = 100
const MAX_MANIFEST_BYTES = 64 * 1024

export interface SkillCandidateEvaluationPolicyConfig {
  readonly id: string
  readonly workspaceId: string
  readonly governanceRoot: string
  readonly runRoot: string
}

export interface ResolvedSkillEvaluationEnvelope {
  readonly id: string
  readonly policyId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly gapIds: readonly string[]
  readonly baselineDir: string
  readonly baselineHash: string
  readonly admissionCasePackDir: string
  readonly admissionCasePackHash: string
  readonly holdoutCasePackDir: string
  readonly holdoutCasePackHash: string
  readonly admissionRunRoot: string
  readonly shadowRunRoot: string
}

export interface SkillEvaluationPolicyView {
  readonly id: string
  readonly workspaceId: string
  readonly admissionRunRoot: string
}

interface OpportunityReader {
  discover(workspaceId?: string): SkillOpportunity[]
}

interface ResolvedPolicy extends SkillCandidateEvaluationPolicyConfig {
  readonly governanceRoot: string
  readonly runRoot: string
}

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('internal-skill-evaluation-envelope-v1'),
  workspaceId: z.uuid(),
  opportunity: z.strictObject({
    id: z.string().regex(CONTENT_ID),
    skillName: z.string().regex(PUBLIC_ID),
    gapIds: z.array(z.string().regex(CONTENT_ID)).min(2).max(1_000),
    goalCount: z.number().int().min(2).max(1_000),
  }),
  baselineTreeHash: z.string().regex(CONTENT_ID),
  admissionCasePackHash: z.string().regex(CONTENT_ID),
  holdoutCasePackHash: z.string().regex(CONTENT_ID),
}).superRefine((manifest, context) => {
  if (manifest.opportunity.gapIds.length !== new Set(manifest.opportunity.gapIds).size) {
    context.addIssue({ code: 'custom', message: 'Evaluation Envelope contains duplicate Gap ids' })
  }
})

type SkillEvaluationEnvelopeManifest = z.infer<typeof manifestSchema>

/**
 * Resolve immutable evaluator inputs from a Candidate's Host-authored internal
 * Opportunity. Profile configuration chooses only a Workspace governance root;
 * it cannot name a Skill, baseline, Case Pack, or Candidate direction.
 */
export class SkillEvaluationEnvelopeResolver {
  private readonly policies = new Map<string, ResolvedPolicy>()
  private readonly opportunities: OpportunityReader

  constructor(
    policies: readonly SkillCandidateEvaluationPolicyConfig[],
    opportunities: OpportunityReader,
  ) {
    assertPolicies(policies)
    for (const policy of policies) {
      this.policies.set(policy.workspaceId, Object.freeze({
        ...policy,
        governanceRoot: resolve(policy.governanceRoot),
        runRoot: resolve(policy.runRoot),
      }))
    }
    this.opportunities = opportunities
  }

  hasPolicy(workspaceId: string): boolean {
    return this.policies.has(workspaceId)
  }

  policyViews(workspaceId?: string): SkillEvaluationPolicyView[] {
    return [...this.policies.values()]
      .filter(policy => workspaceId === undefined || policy.workspaceId === workspaceId)
      .map(policy => Object.freeze({
        id: policy.id,
        workspaceId: policy.workspaceId,
        admissionRunRoot: join(policy.runRoot, 'admission'),
      }))
  }

  async resolve(
    candidate: Pick<ExperienceSkillCandidate,
      'workspaceId' | 'skillName' | 'opportunity'>,
  ): Promise<ResolvedSkillEvaluationEnvelope | undefined> {
    const policy = this.policies.get(candidate.workspaceId)
    if (policy === undefined) return undefined
    const opportunity = uniqueOpportunity(
      this.opportunities.discover(candidate.workspaceId),
      candidate.opportunity.id,
    )
    if (opportunity === undefined
      || opportunity.workspaceId !== candidate.workspaceId
      || opportunity.skillName !== candidate.skillName
      || candidate.opportunity.goalCount > opportunity.goalCount
      || !sameSetSubset(candidate.opportunity.gapIds, opportunity.gapIds)) {
      return undefined
    }

    const governanceRoot = await exactDirectory(policy.governanceRoot, 'evaluation governance root')
    await mkdir(policy.runRoot, { recursive: true, mode: 0o700 })
    const runRoot = await exactDirectory(policy.runRoot, 'evaluation run root')
    if (!separateRoots(governanceRoot, runRoot)) {
      throw new Error('evaluation governance and run roots must not overlap')
    }

    const expectedEnvelopeRoot = join(governanceRoot, 'envelopes', candidate.opportunity.id)
    let envelopeRoot: string
    try {
      envelopeRoot = await exactDirectory(expectedEnvelopeRoot, 'Skill Evaluation Envelope')
    } catch (error) {
      if (isMissing(error)) return undefined
      throw error
    }
    if (envelopeRoot !== expectedEnvelopeRoot) {
      throw new Error('Skill Evaluation Envelope path is not exact')
    }
    const manifestPath = join(envelopeRoot, 'manifest.json')
    const [manifestInfo, manifestRealPath] = await Promise.all([
      lstat(manifestPath),
      realpath(manifestPath),
    ])
    if (!manifestInfo.isFile()
      || manifestInfo.isSymbolicLink()
      || manifestRealPath !== manifestPath) {
      throw new Error('Skill Evaluation Envelope manifest must be an exact real file')
    }
    if (manifestInfo.size > MAX_MANIFEST_BYTES) {
      throw new Error('Skill Evaluation Envelope manifest exceeds its byte limit')
    }
    const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
    const gapIds = [...candidate.opportunity.gapIds].sort()
    if (manifest.workspaceId !== candidate.workspaceId
      || manifest.opportunity.id !== candidate.opportunity.id
      || manifest.opportunity.skillName !== candidate.skillName
      || manifest.opportunity.goalCount !== candidate.opportunity.goalCount
      || JSON.stringify([...manifest.opportunity.gapIds].sort()) !== JSON.stringify(gapIds)) {
      throw new Error('Skill Evaluation Envelope does not match its internal Opportunity snapshot')
    }

    const baselineDir = await exactChildDirectory(envelopeRoot, 'baseline')
    const admissionCasePackDir = await exactChildDirectory(envelopeRoot, 'admission')
    const holdoutCasePackDir = await exactChildDirectory(envelopeRoot, 'holdout')
    const [baselineHash, admissionCasePackHash, holdoutCasePackHash] = await Promise.all([
      hashTree(baselineDir),
      hashTree(admissionCasePackDir),
      hashTree(holdoutCasePackDir),
    ])
    if (baselineHash !== manifest.baselineTreeHash
      || admissionCasePackHash !== manifest.admissionCasePackHash
      || holdoutCasePackHash !== manifest.holdoutCasePackHash) {
      throw new Error('Skill Evaluation Envelope content identity mismatch')
    }
    if (admissionCasePackHash === holdoutCasePackHash) {
      throw new Error('Skill Evaluation Envelope requires an independent holdout Case Pack')
    }

    const admissionRunRoot = join(runRoot, 'admission')
    const shadowRunRoot = join(runRoot, 'shadow')
    await Promise.all([
      mkdir(admissionRunRoot, { recursive: true, mode: 0o700 }),
      mkdir(shadowRunRoot, { recursive: true, mode: 0o700 }),
    ])
    await Promise.all([
      exactDirectory(admissionRunRoot, 'evaluation admission run root'),
      exactDirectory(shadowRunRoot, 'evaluation Shadow run root'),
    ])
    const id = evaluationEnvelopeId(policy.id, manifest)
    return Object.freeze({
      id,
      policyId: policy.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      gapIds: Object.freeze(gapIds),
      baselineDir,
      baselineHash,
      admissionCasePackDir,
      admissionCasePackHash,
      holdoutCasePackDir,
      holdoutCasePackHash,
      admissionRunRoot,
      shadowRunRoot,
    })
  }
}

function evaluationEnvelopeId(policyId: string, manifest: SkillEvaluationEnvelopeManifest): string {
  return createHash('sha256').update(JSON.stringify([
    'internal-skill-evaluation-envelope-v1',
    policyId,
    manifest.workspaceId,
    manifest.opportunity.id,
    manifest.opportunity.skillName,
    [...manifest.opportunity.gapIds].sort(),
    manifest.opportunity.goalCount,
    manifest.baselineTreeHash,
    manifest.admissionCasePackHash,
    manifest.holdoutCasePackHash,
  ])).digest('hex')
}

function uniqueOpportunity(
  opportunities: readonly SkillOpportunity[],
  id: string,
): SkillOpportunity | undefined {
  const matches = opportunities.filter(opportunity => opportunity.id === id)
  return matches.length === 1 ? matches[0] : undefined
}

function sameSetSubset(subset: readonly string[], values: readonly string[]): boolean {
  return subset.length >= 2
    && subset.length === new Set(subset).size
    && subset.every(value => values.includes(value))
}

function assertPolicies(policies: readonly SkillCandidateEvaluationPolicyConfig[]): void {
  if (policies.length > MAX_POLICIES) {
    throw new Error(`Skill evaluation supports at most ${MAX_POLICIES} Workspace policies`)
  }
  for (const policy of policies) {
    if (!PUBLIC_ID.test(policy.id) || !z.uuid().safeParse(policy.workspaceId).success) {
      throw new Error(`invalid Skill evaluation policy '${policy.id}'`)
    }
    if (!isAbsolute(policy.governanceRoot) || !isAbsolute(policy.runRoot)) {
      throw new Error(`Skill evaluation policy '${policy.id}' roots must be absolute`)
    }
    if (dirname(resolve(policy.governanceRoot)) === resolve(policy.governanceRoot)
      || dirname(resolve(policy.runRoot)) === resolve(policy.runRoot)) {
      throw new Error(`Skill evaluation policy '${policy.id}' roots must not be filesystem roots`)
    }
    if (!separateRoots(resolve(policy.governanceRoot), resolve(policy.runRoot))) {
      throw new Error(`Skill evaluation policy '${policy.id}' roots must not overlap`)
    }
  }
  if (new Set(policies.map(policy => policy.id)).size !== policies.length
    || new Set(policies.map(policy => policy.workspaceId)).size !== policies.length
    || new Set(policies.map(policy => resolve(policy.governanceRoot))).size !== policies.length
    || new Set(policies.map(policy => resolve(policy.runRoot))).size !== policies.length) {
    throw new Error('Skill evaluation policy ids, Workspaces, governance roots, and run roots must be unique')
  }
}

async function exactChildDirectory(root: string, name: string): Promise<string> {
  const expected = join(root, name)
  const actual = await exactDirectory(expected, `Skill Evaluation Envelope ${name}`)
  if (actual !== expected) throw new Error(`Skill Evaluation Envelope ${name} path is not exact`)
  return actual
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

function separateRoots(left: string, right: string): boolean {
  return !containsPath(left, right) && !containsPath(right, left)
}

function containsPath(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === '' || (!fromParent.startsWith(`..${sep}`) && fromParent !== '..' && !isAbsolute(fromParent))
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
