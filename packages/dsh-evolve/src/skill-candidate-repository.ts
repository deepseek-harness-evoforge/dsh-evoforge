import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  assembleSkillBundleArchive,
  assembleSealedSkillBundleArchive,
  decodeSkillBundleArchive,
  AUTHORED_SKILL_BUNDLE_LIMITS,
  type AssembledSkillBundleArchive,
  type SkillBundleArchiveFile,
  type SkillBundleTextFile,
} from './skill-bundle-archive.ts'
import type {
  ExistingSkillBaselineQualificationManifest,
} from './existing-skill-baseline-qualification.ts'
import type { ExistingSkillAuthoringEvidence } from './existing-skill-evaluation-evidence-vault.ts'
import type { ResolvedInstalledSkillBaseline } from './installed-skill-baseline.ts'
import type { SkillImprovementOpportunity } from './skill-opportunity-discovery.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ARTIFACT_BASE64_BYTES = 2 * 1024 * 1024
const MAX_EXISTING_CANDIDATE_MANIFEST_BYTES = 256 * 1024
const hashSchema = z.string().regex(CONTENT_ID)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const candidateSchema = z.strictObject({
  schemaVersion: z.literal(2),
  id: hashSchema,
  createdAt: safeInteger,
  workspaceId: z.uuid(),
  skillName: z.string().regex(PUBLIC_ID),
  description: z.string().min(1).max(2_048),
  opportunity: z.strictObject({
    kind: z.literal('internal-experience-v1'),
    id: hashSchema,
    gapIds: z.array(hashSchema).min(2).max(1_000),
    goalCount: safeInteger.min(2).max(1_000),
  }),
  authorship: z.strictObject({
    kind: z.literal('bounded-model-authoring-v1'),
    policyId: z.string().regex(PUBLIC_ID),
    modelIdentityHash: hashSchema,
    evaluationEvidenceId: hashSchema,
    inputDigest: hashSchema,
  }),
  scope: z.literal('workspace'),
  version: z.strictObject({
    kind: z.literal('experience-authored-bundle-v1'),
    artifactDigest: hashSchema,
    treeHash: hashSchema,
  }),
  contentHash: hashSchema,
  package: z.strictObject({
    path: z.string().regex(PUBLIC_ID),
    fileCount: safeInteger.min(2),
    totalBytes: safeInteger,
    hasScripts: z.literal(false),
    hasReferences: z.literal(true),
  }),
  permissions: z.strictObject({
    declared: z.boolean(),
    executableContent: z.literal(false),
    externalEffects: z.literal('unknown'),
  }),
  license: z.union([
    z.strictObject({ status: z.literal('declared'), value: z.string().min(1).max(256) }),
    z.strictObject({ status: z.literal('unknown') }),
  ]),
  safety: z.strictObject({
    status: z.literal('quarantined'),
    checks: z.tuple([
      z.strictObject({ name: z.literal('artifact-digest-integrity'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('regular-files-only'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('skill-identity'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('effect-review'), status: z.literal('required') }),
    ]),
  }),
  artifact: z.strictObject({
    kind: z.literal('canonical-text-bundle'),
    format: z.literal('tar.gz'),
    contentBase64: z.string().base64().min(1).max(MAX_ARTIFACT_BASE64_BYTES),
  }),
  lifecycle: z.literal('inactive'),
  verification: z.literal('unevaluated'),
  execution: z.literal('never'),
}).superRefine((candidate, context) => {
  if (candidate.opportunity.gapIds.length !== new Set(candidate.opportunity.gapIds).size) {
    context.addIssue({ code: 'custom', message: 'Candidate Opportunity contains duplicate Gap ids' })
  }
  if (candidate.contentHash !== candidate.version.artifactDigest) {
    context.addIssue({ code: 'custom', message: 'Candidate content identity is inconsistent' })
  }
})

export type ExperienceSkillCandidate = z.infer<typeof candidateSchema>
export type ExperienceSkillCandidateInput = Omit<ExperienceSkillCandidate, 'schemaVersion' | 'id'>

export interface SkillCandidateProposal {
  readonly createdAt: number
  readonly workspaceId: string
  readonly skillName: string
  readonly policyId: string
  readonly opportunityId: string
  readonly gapIds: readonly string[]
  readonly goalCount: number
  readonly modelIdentity: string
  readonly evaluationEvidenceId: string
  readonly inputDigest: string
  readonly files: readonly SkillBundleTextFile[]
}

const existingCandidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('existing-skill-improvement-candidate-v1'),
  id: hashSchema,
  createdAt: safeInteger,
  workspaceId: z.uuid(),
  skillName: z.string().regex(PUBLIC_ID),
  description: z.string().min(1).max(2_048),
  opportunity: z.strictObject({
    kind: z.literal('internal-existing-skill-correction-v1'),
    id: hashSchema,
    signalCount: safeInteger.min(4).max(100),
    goalCount: safeInteger.min(4).max(100),
  }),
  baseline: z.strictObject({
    qualificationId: hashSchema,
    id: hashSchema,
    artifactDigest: hashSchema,
    treeHash: hashSchema,
  }),
  authorship: z.strictObject({
    kind: z.literal('protected-correction-authoring-v1'),
    policyId: z.string().regex(PUBLIC_ID),
    modelIdentityHash: hashSchema,
    evaluationEvidenceId: hashSchema,
    inputDigest: hashSchema,
    claim: z.string().min(1).max(2_048),
  }),
  scope: z.literal('workspace'),
  version: z.strictObject({
    kind: z.literal('existing-skill-improvement-bundle-v1'),
    parentBaselineId: hashSchema,
    artifactDigest: hashSchema,
    treeHash: hashSchema,
  }),
  contentHash: hashSchema,
  diff: z.strictObject({
    kind: z.literal('bounded-instruction-tree-diff-v1'),
    changedPaths: z.array(z.string().min(1).max(1_024)).min(1).max(32),
    addedPaths: z.array(z.string().min(1).max(1_024)).max(31),
    preservedFileCount: safeInteger,
    preservedBinaryFileCount: safeInteger,
  }),
  package: z.strictObject({
    path: z.string().regex(PUBLIC_ID),
    fileCount: safeInteger.min(1).max(256),
    totalBytes: safeInteger.max(16 * 1024 * 1024),
    hasExecutableFiles: z.literal(false),
  }),
  permissions: z.strictObject({
    declared: z.boolean(),
    executableContentChanged: z.literal(false),
    externalEffects: z.literal('unchanged-or-unknown'),
  }),
  license: z.union([
    z.strictObject({ status: z.literal('declared'), value: z.string().min(1).max(256) }),
    z.strictObject({ status: z.literal('unknown') }),
  ]),
  safety: z.strictObject({
    status: z.literal('quarantined'),
    checks: z.tuple([
      z.strictObject({ name: z.literal('artifact-digest-integrity'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('exact-baseline-binding'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('whole-tree-inheritance'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('skill-identity'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('instruction-only-diff'), status: z.literal('passed') }),
      z.strictObject({ name: z.literal('effect-review'), status: z.literal('required') }),
    ]),
  }),
  artifact: z.strictObject({
    kind: z.literal('sealed-complete-skill-bundle'),
    format: z.literal('tar.gz'),
    digest: hashSchema,
  }),
  lifecycle: z.literal('inactive'),
  verification: z.literal('unevaluated'),
  execution: z.literal('never'),
  releaseAuthority: z.literal('none'),
}).superRefine((candidate, context) => {
  if (candidate.contentHash !== candidate.version.artifactDigest
    || candidate.contentHash !== candidate.artifact.digest) {
    context.addIssue({ code: 'custom', message: 'existing Skill Candidate content identity is inconsistent' })
  }
  if (candidate.baseline.id !== candidate.version.parentBaselineId) {
    context.addIssue({ code: 'custom', message: 'existing Skill Candidate parent baseline is inconsistent' })
  }
  if (candidate.diff.changedPaths.length !== new Set(candidate.diff.changedPaths).size
    || candidate.diff.addedPaths.length !== new Set(candidate.diff.addedPaths).size
    || candidate.diff.addedPaths.some(path => !candidate.diff.changedPaths.includes(path))) {
    context.addIssue({ code: 'custom', message: 'existing Skill Candidate diff paths are inconsistent' })
  }
})

export type ExistingSkillCandidate = z.infer<typeof existingCandidateSchema>
export type ExistingSkillCandidateInput = Omit<ExistingSkillCandidate, 'schemaVersion' | 'id'>

export interface ExistingSkillInstructionChange {
  readonly path: string
  readonly content: string
}

export interface ExistingSkillCandidateProposal {
  readonly createdAt: number
  readonly policyId: string
  readonly modelIdentity: string
  readonly claim: string
  readonly opportunity: SkillImprovementOpportunity
  readonly qualification: ExistingSkillBaselineQualificationManifest
  readonly baseline: ResolvedInstalledSkillBaseline
  readonly evidence: ExistingSkillAuthoringEvidence
  readonly changes: readonly ExistingSkillInstructionChange[]
}

export interface ExistingSkillCandidatePolicy {
  readonly workspaceId: string
  readonly root: string
}

export interface MaterializedSkillCandidate {
  readonly candidateId: string
  readonly path: string
  readonly contentHash: string
  readonly treeHash: string
  readonly files: readonly {
    readonly path: string
    readonly mode: '100644'
    readonly size: number
  }[]
}

export interface SkillCandidateStore {
  recordCandidate(input: ExperienceSkillCandidateInput): Promise<{
    readonly created: boolean
    readonly candidate: ExperienceSkillCandidate
  }>
  listCandidates(workspaceId?: string, opportunityId?: string): ExperienceSkillCandidate[]
  recordExistingCandidate(input: ExistingSkillCandidateInput): Promise<{
    readonly created: boolean
    readonly candidate: ExistingSkillCandidate
  }>
  listExistingCandidates(workspaceId?: string, opportunityId?: string): ExistingSkillCandidate[]
  close(): Promise<void>
}

const candidateDomainSpec = defineDomain({
  name: 'evoforge_skill_candidates',
  version: 2,
  tables: {
    candidates: domainTable<string, ExperienceSkillCandidate>(candidateSchema),
  },
})

type SkillCandidateDomain = Domain<typeof candidateDomainSpec>

const existingCandidateDomainSpec = defineDomain({
  name: 'evoforge_existing_skill_candidates',
  version: 1,
  tables: {
    candidates: domainTable<string, ExistingSkillCandidate>(existingCandidateSchema),
  },
})

type ExistingSkillCandidateDomain = Domain<typeof existingCandidateDomainSpec>

class DomainSkillCandidateStore implements SkillCandidateStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: SkillCandidateDomain
  private readonly existingDomain: ExistingSkillCandidateDomain
  constructor(domain: SkillCandidateDomain, existingDomain: ExistingSkillCandidateDomain) {
    this.domain = domain
    this.existingDomain = existingDomain
  }

  recordCandidate(input: ExperienceSkillCandidateInput): Promise<{
    readonly created: boolean
    readonly candidate: ExperienceSkillCandidate
  }> {
    return this.enqueue(async () => {
      const id = skillCandidateId(input)
      const table = this.domain.table('candidates')
      const existing = table.get(id)
      if (existing !== undefined) return { created: false, candidate: immutableCopy(existing) }
      const candidate = immutableCopy(candidateSchema.parse({ schemaVersion: 2, id, ...input }))
      await table.put(id, candidate)
      return { created: true, candidate }
    })
  }

  listCandidates(workspaceId?: string, opportunityId?: string): ExperienceSkillCandidate[] {
    return [...this.domain.table('candidates').entries()]
      .map(([, candidate]) => candidate)
      .filter(candidate => (workspaceId === undefined || candidate.workspaceId === workspaceId)
        && (opportunityId === undefined || candidate.opportunity.id === opportunityId))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  recordExistingCandidate(input: ExistingSkillCandidateInput): Promise<{
    readonly created: boolean
    readonly candidate: ExistingSkillCandidate
  }> {
    return this.enqueue(async () => {
      const id = existingSkillCandidateId(input)
      const table = this.existingDomain.table('candidates')
      const existing = table.get(id)
      if (existing !== undefined) return { created: false, candidate: immutableCopy(existing) }
      const candidate = immutableCopy(existingCandidateSchema.parse({ schemaVersion: 1, id, ...input }))
      await table.put(id, candidate)
      return { created: true, candidate }
    })
  }

  listExistingCandidates(workspaceId?: string, opportunityId?: string): ExistingSkillCandidate[] {
    return [...this.existingDomain.table('candidates').entries()]
      .map(([, candidate]) => candidate)
      .filter(candidate => (workspaceId === undefined || candidate.workspaceId === workspaceId)
        && (opportunityId === undefined || candidate.opportunity.id === opportunityId))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(async () => {
      await Promise.all([this.existingDomain.close(), this.domain.close()])
    })
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('Skill Candidate store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

export async function openSkillCandidateStore(
  facility: DomainFacility,
): Promise<SkillCandidateStore> {
  const domain = await facility.open(candidateDomainSpec)
  try {
    const existingDomain = await facility.open(existingCandidateDomainSpec)
    return new DomainSkillCandidateStore(domain, existingDomain)
  } catch (error) {
    await domain.close().catch(() => undefined)
    throw error
  }
}

/**
 * The only Candidate ingress. It accepts a bounded whole-Skill authored from
 * one internally discovered Opportunity and has no search, import, install,
 * activation, evaluation, or release interface.
 */
export class SkillCandidateRepository {
  private readonly store: Pick<SkillCandidateStore, 'recordCandidate'>
    & Partial<Pick<SkillCandidateStore, 'recordExistingCandidate'>>
  private readonly onCandidate: ((candidate: ExperienceSkillCandidate) => void) | undefined
  private readonly onExistingCandidate: ((candidate: ExistingSkillCandidate) => void) | undefined
  private readonly existingRoots = new Map<string, string>()

  constructor(
    store: Pick<SkillCandidateStore, 'recordCandidate'>
      & Partial<Pick<SkillCandidateStore, 'recordExistingCandidate'>>,
    onCandidate?: (candidate: ExperienceSkillCandidate) => void,
    existingPolicies: readonly ExistingSkillCandidatePolicy[] = [],
    onExistingCandidate?: (candidate: ExistingSkillCandidate) => void,
  ) {
    this.store = store
    this.onCandidate = onCandidate
    this.onExistingCandidate = onExistingCandidate
    for (const policy of existingPolicies) {
      if (!z.uuid().safeParse(policy.workspaceId).success
        || !isAbsolute(policy.root)
        || dirname(resolve(policy.root)) === resolve(policy.root)
        || this.existingRoots.has(policy.workspaceId)) {
        throw new Error('existing Skill Candidate policy is invalid or duplicated')
      }
      this.existingRoots.set(policy.workspaceId, resolve(policy.root))
    }
  }

  async quarantine(proposal: SkillCandidateProposal): Promise<{
    readonly created: boolean
    readonly candidate: ExperienceSkillCandidate
  }> {
    assertProposalIdentity(proposal)
    const assembled = await assembleSkillBundleArchive(proposal.files)
    const skillFile = assembled.files.find(file => file.path === 'SKILL.md')
    if (skillFile === undefined) throw new Error('experience-authored whole-Skill has no root SKILL.md')
    const skill = parseSkillHeader(decodeCanonicalUtf8(skillFile.content))
    if (skill.name !== proposal.skillName) {
      throw new Error('experience-authored whole-Skill name does not match its Opportunity')
    }
    const recorded = await this.store.recordCandidate({
      createdAt: proposal.createdAt,
      workspaceId: proposal.workspaceId,
      skillName: proposal.skillName,
      description: skill.description,
      opportunity: {
        kind: 'internal-experience-v1',
        id: proposal.opportunityId,
        gapIds: [...proposal.gapIds],
        goalCount: proposal.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: proposal.policyId,
        modelIdentityHash: sha256(proposal.modelIdentity),
        evaluationEvidenceId: proposal.evaluationEvidenceId,
        inputDigest: proposal.inputDigest,
      },
      scope: 'workspace',
      version: {
        kind: 'experience-authored-bundle-v1',
        artifactDigest: assembled.artifactDigest,
        treeHash: assembled.treeHash,
      },
      contentHash: assembled.artifactDigest,
      package: {
        path: proposal.skillName,
        fileCount: assembled.files.length,
        totalBytes: assembled.totalBytes,
        hasScripts: false,
        hasReferences: true,
      },
      permissions: {
        declared: skill.permissionsDeclared,
        executableContent: false,
        externalEffects: 'unknown',
      },
      license: skill.license === undefined
        ? { status: 'unknown' }
        : { status: 'declared', value: skill.license },
      safety: {
        status: 'quarantined',
        checks: [
          { name: 'artifact-digest-integrity', status: 'passed' },
          { name: 'regular-files-only', status: 'passed' },
          { name: 'skill-identity', status: 'passed' },
          { name: 'effect-review', status: 'required' },
        ],
      },
      artifact: {
        kind: 'canonical-text-bundle',
        format: 'tar.gz',
        contentBase64: assembled.content.toString('base64'),
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    })
    this.onCandidate?.(recorded.candidate)
    return recorded
  }

  async materialize(
    input: ExperienceSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    const candidate = candidateSchema.parse(input)
    if (candidate.id !== skillCandidateId(candidate)) {
      throw new Error('Skill Candidate id does not match its content identity')
    }
    const pinned = await validateCandidate(candidate)
    const requested = resolve(requestedOutputDir)
    if (dirname(requested) === requested) throw new Error('Skill Candidate output must not be a filesystem root')
    const parent = await realpath(dirname(requested))
    const outputDir = resolve(parent, basename(requested))
    await mkdir(outputDir, { mode: 0o700 })
    try {
      for (const file of pinned.files) {
        const target = resolve(outputDir, ...file.path.split('/'))
        assertInside(outputDir, target)
        await mkdir(dirname(target), { mode: 0o700, recursive: true })
        await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
      }
      return Object.freeze({
        candidateId: candidate.id,
        path: outputDir,
        contentHash: pinned.artifactDigest,
        treeHash: pinned.treeHash,
        files: Object.freeze(pinned.files.map(file => Object.freeze({
          path: file.path,
          mode: '100644' as const,
          size: file.content.byteLength,
        }))),
      })
    } catch (error) {
      await rm(outputDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }

  async quarantineExisting(proposal: ExistingSkillCandidateProposal): Promise<{
    readonly created: boolean
    readonly candidate: ExistingSkillCandidate
  }> {
    const recordExistingCandidate = this.store.recordExistingCandidate
    if (recordExistingCandidate === undefined) {
      throw new Error('existing Skill Candidate store is unavailable')
    }
    const root = this.existingRoots.get(proposal.opportunity.workspaceId)
    if (root === undefined) throw new Error('existing Skill Candidate policy is unavailable')
    assertExistingProposalIdentity(proposal)

    const baselineArchive = await assembleSealedSkillBundleArchive(proposal.baseline.files)
    assertExactExistingBaseline(proposal, baselineArchive)
    const originalSkillFile = baselineArchive.files.find(file => file.path === 'SKILL.md')
    if (originalSkillFile === undefined) throw new Error('existing Skill baseline has no root SKILL.md')
    const originalSkill = parseSkillHeader(decodeCanonicalUtf8(originalSkillFile.content))
    if (originalSkill.name !== proposal.opportunity.skillName) {
      throw new Error('existing Skill baseline identity does not match its Opportunity')
    }

    const applied = applyInstructionChanges(baselineArchive.files, proposal.changes)
    const assembled = await assembleSealedSkillBundleArchive(applied.files)
    if (assembled.artifactDigest === baselineArchive.artifactDigest) {
      throw new Error('existing Skill Candidate must change its exact baseline')
    }
    const updatedSkillFile = assembled.files.find(file => file.path === 'SKILL.md')
    if (updatedSkillFile === undefined) throw new Error('existing Skill Candidate has no root SKILL.md')
    const updatedSkill = parseSkillHeader(decodeCanonicalUtf8(updatedSkillFile.content))
    if (updatedSkill.name !== proposal.opportunity.skillName) {
      throw new Error('existing Skill Candidate name does not match its Opportunity')
    }
    if (updatedSkill.permissionFingerprint !== originalSkill.permissionFingerprint) {
      throw new Error('existing Skill Candidate permission declarations require a Protected Action')
    }
    if (updatedSkill.license !== originalSkill.license) {
      throw new Error('existing Skill Candidate license declaration must match its exact baseline')
    }

    const input: ExistingSkillCandidateInput = {
      kind: 'existing-skill-improvement-candidate-v1',
      createdAt: proposal.createdAt,
      workspaceId: proposal.opportunity.workspaceId,
      skillName: proposal.opportunity.skillName,
      description: updatedSkill.description,
      opportunity: {
        kind: 'internal-existing-skill-correction-v1',
        id: proposal.opportunity.id,
        signalCount: proposal.opportunity.signalCount,
        goalCount: proposal.opportunity.goalCount,
      },
      baseline: {
        qualificationId: proposal.qualification.id,
        id: proposal.baseline.manifest.id,
        artifactDigest: baselineArchive.artifactDigest,
        treeHash: baselineArchive.treeHash,
      },
      authorship: {
        kind: 'protected-correction-authoring-v1',
        policyId: proposal.policyId,
        modelIdentityHash: sha256(proposal.modelIdentity),
        evaluationEvidenceId: proposal.evidence.id,
        inputDigest: proposal.evidence.authoringInputDigest,
        claim: proposal.claim.trim(),
      },
      scope: 'workspace',
      version: {
        kind: 'existing-skill-improvement-bundle-v1',
        parentBaselineId: proposal.baseline.manifest.id,
        artifactDigest: assembled.artifactDigest,
        treeHash: assembled.treeHash,
      },
      contentHash: assembled.artifactDigest,
      diff: {
        kind: 'bounded-instruction-tree-diff-v1',
        changedPaths: [...applied.changedPaths],
        addedPaths: [...applied.addedPaths],
        preservedFileCount: applied.preservedFileCount,
        preservedBinaryFileCount: applied.preservedBinaryFileCount,
      },
      package: {
        path: proposal.opportunity.skillName,
        fileCount: assembled.files.length,
        totalBytes: assembled.totalBytes,
        hasExecutableFiles: false,
      },
      permissions: {
        declared: updatedSkill.permissionsDeclared,
        executableContentChanged: false,
        externalEffects: 'unchanged-or-unknown',
      },
      license: updatedSkill.license === undefined
        ? { status: 'unknown' }
        : { status: 'declared', value: updatedSkill.license },
      safety: {
        status: 'quarantined',
        checks: [
          { name: 'artifact-digest-integrity', status: 'passed' },
          { name: 'exact-baseline-binding', status: 'passed' },
          { name: 'whole-tree-inheritance', status: 'passed' },
          { name: 'skill-identity', status: 'passed' },
          { name: 'instruction-only-diff', status: 'passed' },
          { name: 'effect-review', status: 'required' },
        ],
      },
      artifact: {
        kind: 'sealed-complete-skill-bundle',
        format: 'tar.gz',
        digest: assembled.artifactDigest,
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
      releaseAuthority: 'none',
    }
    const id = existingSkillCandidateId(input)
    const candidate = existingCandidateSchema.parse({ schemaVersion: 1, id, ...input })
    await installExistingCandidateArtifact(root, candidate, assembled)
    const recorded = await recordExistingCandidate.call(this.store, input)
    if (recorded.candidate.id !== id
      || canonicalJson(recorded.candidate) !== canonicalJson(candidate)) {
      throw new Error('existing Skill Candidate store returned conflicting content')
    }
    this.onExistingCandidate?.(recorded.candidate)
    return recorded
  }

  async materializeExisting(
    input: ExistingSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    const candidate = existingCandidateSchema.parse(input)
    if (candidate.id !== existingSkillCandidateId(candidate)) {
      throw new Error('existing Skill Candidate id does not match its content identity')
    }
    const root = this.existingRoots.get(candidate.workspaceId)
    if (root === undefined) throw new Error('existing Skill Candidate policy is unavailable')
    const pinned = await readExistingCandidateArtifact(root, candidate)
    const requested = resolve(requestedOutputDir)
    if (dirname(requested) === requested) throw new Error('Skill Candidate output must not be a filesystem root')
    const parent = await realpath(dirname(requested))
    const outputDir = resolve(parent, basename(requested))
    await mkdir(outputDir, { mode: 0o700 })
    try {
      for (const file of pinned.files) {
        const target = resolve(outputDir, ...file.path.split('/'))
        assertInside(outputDir, target)
        await mkdir(dirname(target), { mode: 0o700, recursive: true })
        await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
      }
      return Object.freeze({
        candidateId: candidate.id,
        path: outputDir,
        contentHash: pinned.artifactDigest,
        treeHash: pinned.treeHash,
        files: Object.freeze(pinned.files.map(file => Object.freeze({
          path: file.path,
          mode: '100644' as const,
          size: file.content.byteLength,
        }))),
      })
    } catch (error) {
      await rm(outputDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }
}

export function skillCandidateId(
  candidate: Pick<ExperienceSkillCandidateInput,
    'workspaceId' | 'skillName' | 'opportunity' | 'authorship' | 'version' | 'contentHash'>,
): string {
  return contentId([
    'internal-experience-skill-candidate-v2',
    candidate.workspaceId,
    candidate.skillName,
    candidate.opportunity.id,
    candidate.authorship.policyId,
    candidate.authorship.modelIdentityHash,
    candidate.authorship.evaluationEvidenceId,
    candidate.authorship.inputDigest,
    candidate.version.artifactDigest,
    candidate.version.treeHash,
    candidate.contentHash,
  ])
}

export function existingSkillCandidateId(
  candidate: Pick<ExistingSkillCandidateInput,
    'workspaceId' | 'skillName' | 'opportunity' | 'baseline' | 'authorship' | 'version' | 'contentHash'>,
): string {
  return contentId([
    'existing-skill-improvement-candidate-v1',
    candidate.workspaceId,
    candidate.skillName,
    candidate.opportunity,
    candidate.baseline,
    candidate.authorship,
    candidate.version,
    candidate.contentHash,
  ])
}

async function validateCandidate(candidate: ExperienceSkillCandidate): Promise<{
  readonly files: Awaited<ReturnType<typeof decodeSkillBundleArchive>>['files']
  readonly artifactDigest: string
  readonly treeHash: string
}> {
  const content = Buffer.from(candidate.artifact.contentBase64, 'base64')
  const artifactDigest = sha256Bytes(content)
  const decoded = await decodeSkillBundleArchive(content)
  const assembled = await assembleSkillBundleArchive(decoded.files.map(file => ({
    path: file.path,
    content: decodeCanonicalUtf8(file.content),
  })))
  const skillFile = assembled.files.find(file => file.path === 'SKILL.md')
  if (skillFile === undefined) throw new Error('Skill Candidate has no root SKILL.md')
  const skill = parseSkillHeader(decodeCanonicalUtf8(skillFile.content))
  const license = skill.license === undefined
    ? { status: 'unknown' as const }
    : { status: 'declared' as const, value: skill.license }
  if (!assembled.content.equals(content)
    || artifactDigest !== candidate.version.artifactDigest
    || artifactDigest !== candidate.contentHash
    || assembled.treeHash !== candidate.version.treeHash
    || skill.name !== candidate.skillName
    || skill.description !== candidate.description
    || candidate.package.path !== candidate.skillName
    || candidate.package.fileCount !== assembled.files.length
    || candidate.package.totalBytes !== assembled.totalBytes
    || candidate.permissions.declared !== skill.permissionsDeclared
    || JSON.stringify(candidate.license) !== JSON.stringify(license)) {
    throw new Error('Skill Candidate metadata does not match its canonical bundle')
  }
  return Object.freeze({
    files: assembled.files,
    artifactDigest,
    treeHash: assembled.treeHash,
  })
}

function assertExistingProposalIdentity(proposal: ExistingSkillCandidateProposal): void {
  const opportunity = proposal.opportunity
  const qualification = proposal.qualification
  const baseline = proposal.baseline.manifest
  const evidence = proposal.evidence
  if (!Number.isSafeInteger(proposal.createdAt)
    || proposal.createdAt < 0
    || !PUBLIC_ID.test(proposal.policyId)
    || proposal.modelIdentity.trim() === ''
    || Buffer.byteLength(proposal.modelIdentity) > 2_048
    || proposal.claim.trim() === ''
    || Buffer.byteLength(proposal.claim) > 2_048
    || opportunity.schemaVersion !== 1
    || opportunity.status !== 'waiting-for-baseline-bundle'
    || opportunity.releaseAuthority !== 'none'
    || !CONTENT_ID.test(opportunity.id)
    || !z.uuid().safeParse(opportunity.workspaceId).success
    || !PUBLIC_ID.test(opportunity.skillName)
    || !CONTENT_ID.test(opportunity.invocationContentHash)
    || opportunity.signalCount < 4
    || opportunity.goalCount < 4
    || qualification.status !== 'eligible-for-existing-skill-authoring'
    || qualification.releaseAuthority !== 'none'
    || evidence.releaseAuthority !== 'none'
    || evidence.proposerCanReadProtectedSamples !== false) {
    throw new Error('existing Skill Candidate requires valid protected internal correction provenance')
  }
  if (qualification.opportunityId !== opportunity.id
    || qualification.workspaceId !== opportunity.workspaceId
    || qualification.skillName !== opportunity.skillName
    || qualification.invocationContentHash !== opportunity.invocationContentHash
    || qualification.evidence.invocationCount !== opportunity.signalCount
    || qualification.evidence.goalCount !== opportunity.goalCount
    || baseline.workspaceId !== opportunity.workspaceId
    || baseline.skillName !== opportunity.skillName
    || baseline.invocationContentHash !== opportunity.invocationContentHash
    || baseline.id !== qualification.baseline.id
    || evidence.workspaceId !== opportunity.workspaceId
    || evidence.opportunityId !== opportunity.id
    || evidence.qualificationId !== qualification.id
    || evidence.baselineId !== baseline.id
    || evidence.skillName !== opportunity.skillName
    || evidence.authoringCases.length !== evidence.authoringGoalCount
    || evidence.authoringGoalCount < 2
    || evidence.admissionGoalCount !== 1
    || evidence.holdoutGoalCount !== 1
    || ![0, 1].includes(evidence.retentionGoalCount)
    || !CONTENT_ID.test(evidence.id)
    || !CONTENT_ID.test(evidence.authoringInputDigest)) {
    throw new Error('existing Skill Candidate provenance does not bind one exact baseline and evidence seal')
  }
}

function assertExactExistingBaseline(
  proposal: ExistingSkillCandidateProposal,
  assembled: AssembledSkillBundleArchive,
): void {
  const manifest = proposal.baseline.manifest
  const qualified = proposal.qualification.baseline
  if (assembled.artifactDigest !== manifest.bundle.artifactDigest
    || assembled.treeHash !== manifest.bundle.treeHash
    || assembled.files.length !== manifest.bundle.fileCount
    || assembled.totalBytes !== manifest.bundle.totalBytes
    || manifest.bundle.hasExecutableFiles !== false
    || qualified.artifactDigest !== manifest.bundle.artifactDigest
    || qualified.treeHash !== manifest.bundle.treeHash
    || qualified.fileCount !== manifest.bundle.fileCount
    || qualified.totalBytes !== manifest.bundle.totalBytes
    || qualified.provider !== manifest.provider
    || qualified.source !== manifest.source
    || qualified.definitionDigest !== manifest.definitionDigest
    || proposal.baseline.reference.baselineId !== manifest.id
    || proposal.baseline.reference.workspaceId !== manifest.workspaceId
    || proposal.baseline.reference.skillName !== manifest.skillName
    || proposal.baseline.reference.invocationContentHash !== manifest.invocationContentHash) {
    throw new Error('existing Skill Candidate baseline content does not match its exact qualification')
  }
}

function applyInstructionChanges(
  baseline: readonly SkillBundleArchiveFile[],
  changes: readonly ExistingSkillInstructionChange[],
): {
    readonly files: readonly SkillBundleArchiveFile[]
    readonly changedPaths: readonly string[]
    readonly addedPaths: readonly string[]
    readonly preservedFileCount: number
    readonly preservedBinaryFileCount: number
  } {
  if (changes.length < 1 || changes.length > AUTHORED_SKILL_BUNDLE_LIMITS.maxFiles) {
    throw new Error('existing Skill Candidate requires 1-32 bounded instruction changes')
  }
  const byPath = new Map(baseline.map(file => [file.path, file]))
  const replacements = new Map<string, Buffer>()
  let totalChangedBytes = 0
  for (const change of changes) {
    if (typeof change !== 'object' || change === null
      || Object.keys(change).sort().join(',') !== 'content,path'
      || typeof change.path !== 'string'
      || typeof change.content !== 'string') {
      throw new Error('existing Skill Candidate instruction change has an invalid shape')
    }
    if (change.path !== 'SKILL.md' && !/^references\/[^/]+\.md$/u.test(change.path)) {
      throw new Error('existing Skill Candidate may change only SKILL.md or one-level references/*.md')
    }
    if (replacements.has(change.path)) {
      throw new Error(`duplicate existing Skill Candidate change path: ${change.path}`)
    }
    if (change.content.includes('\0') || /\r(?!\n)/u.test(change.content)) {
      throw new Error(`existing Skill Candidate change is not canonical text: ${change.path}`)
    }
    const normalized = change.content.replaceAll('\r\n', '\n')
    const content = Buffer.from(normalized)
    if (content.byteLength === 0
      || content.byteLength > AUTHORED_SKILL_BUNDLE_LIMITS.maxFileBytes
      || totalChangedBytes + content.byteLength > AUTHORED_SKILL_BUNDLE_LIMITS.maxTotalBytes) {
      throw new Error('existing Skill Candidate instruction changes exceed their byte budget')
    }
    const prior = byPath.get(change.path)
    if (prior !== undefined) decodeCanonicalUtf8(prior.content)
    if (prior?.content.equals(content)) {
      throw new Error(`existing Skill Candidate contains a no-op change: ${change.path}`)
    }
    totalChangedBytes += content.byteLength
    replacements.set(change.path, content)
  }

  const files: SkillBundleArchiveFile[] = baseline.map(file => Object.freeze({
    path: file.path,
    mode: '100644' as const,
    content: Buffer.from(replacements.get(file.path) ?? file.content),
  }))
  for (const [path, content] of replacements) {
    if (!byPath.has(path)) files.push(Object.freeze({ path, mode: '100644', content: Buffer.from(content) }))
  }
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path))
  const changedPaths = ordered.filter(file => replacements.has(file.path)).map(file => file.path)
  const addedPaths = changedPaths.filter(path => !byPath.has(path))
  const preserved = baseline.filter(file => !replacements.has(file.path))
  return Object.freeze({
    files: Object.freeze(files),
    changedPaths: Object.freeze(changedPaths),
    addedPaths: Object.freeze(addedPaths),
    preservedFileCount: preserved.length,
    preservedBinaryFileCount: preserved.filter(file => !isCanonicalUtf8(file.content)).length,
  })
}

async function installExistingCandidateArtifact(
  policyRoot: string,
  candidate: ExistingSkillCandidate,
  archive: AssembledSkillBundleArchive,
): Promise<void> {
  const parent = join(policyRoot, 'existing-skill-candidates')
  await ensureExactDirectory(parent)
  const target = join(parent, candidate.id)
  if (await pathExists(target)) {
    await readExistingCandidateArtifact(policyRoot, candidate)
    return
  }
  const stage = join(parent, `.candidate-${randomUUID()}`)
  await mkdir(stage, { mode: 0o700 })
  try {
    await writeDurableBytes(join(stage, 'bundle.tar.gz'), archive.content)
    await writeDurableJson(join(stage, 'manifest.json'), candidate)
    try {
      await rename(stage, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      await readExistingCandidateArtifact(policyRoot, candidate)
    }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

async function readExistingCandidateArtifact(
  policyRoot: string,
  candidate: ExistingSkillCandidate,
): Promise<AssembledSkillBundleArchive> {
  const root = join(policyRoot, 'existing-skill-candidates', candidate.id)
  await exactDirectory(root, 'existing Skill Candidate root')
  const manifestPath = join(root, 'manifest.json')
  const manifestInfo = await lstat(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()
    || manifestInfo.size > MAX_EXISTING_CANDIDATE_MANIFEST_BYTES
    || await realpath(manifestPath) !== manifestPath) {
    throw new Error('existing Skill Candidate manifest is not an exact bounded file')
  }
  const stored = existingCandidateSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (stored.id !== existingSkillCandidateId(stored)
    || canonicalJson(stored) !== canonicalJson(candidate)) {
    throw new Error('existing Skill Candidate manifest does not match its content address')
  }
  const archivePath = join(root, 'bundle.tar.gz')
  const archiveInfo = await lstat(archivePath)
  if (!archiveInfo.isFile() || archiveInfo.isSymbolicLink() || await realpath(archivePath) !== archivePath) {
    throw new Error('existing Skill Candidate archive is not an exact real file')
  }
  const content = await readFile(archivePath)
  if (sha256Bytes(content) !== candidate.artifact.digest) {
    throw new Error('existing Skill Candidate archive digest is invalid')
  }
  const decoded = await decodeSkillBundleArchive(content)
  const assembled = await assembleSealedSkillBundleArchive(decoded.files)
  if (!assembled.content.equals(content)
    || assembled.artifactDigest !== candidate.version.artifactDigest
    || assembled.treeHash !== candidate.version.treeHash
    || assembled.files.length !== candidate.package.fileCount
    || assembled.totalBytes !== candidate.package.totalBytes) {
    throw new Error('existing Skill Candidate archive does not match its manifest')
  }
  return assembled
}

async function ensureExactDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await exactDirectory(path, 'existing Skill Candidate policy root')
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const info = await lstat(path)
  const actual = await realpath(path)
  if (!info.isDirectory() || info.isSymbolicLink() || actual !== path) {
    throw new Error(`${label} must be an exact real directory`)
  }
  return actual
}

async function writeDurableBytes(path: string, content: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
}

function isCanonicalUtf8(content: Buffer): boolean {
  try {
    decodeCanonicalUtf8(content)
    return true
  } catch {
    return false
  }
}

function assertProposalIdentity(proposal: SkillCandidateProposal): void {
  if (!Number.isSafeInteger(proposal.createdAt)
    || proposal.createdAt < 0
    || !z.uuid().safeParse(proposal.workspaceId).success
    || !PUBLIC_ID.test(proposal.skillName)
    || !PUBLIC_ID.test(proposal.policyId)
    || !CONTENT_ID.test(proposal.opportunityId)
    || !CONTENT_ID.test(proposal.evaluationEvidenceId)
    || !CONTENT_ID.test(proposal.inputDigest)
    || proposal.gapIds.length < 2
    || proposal.gapIds.length > 1_000
    || new Set(proposal.gapIds).size !== proposal.gapIds.length
    || proposal.gapIds.some(id => !CONTENT_ID.test(id))
    || !Number.isSafeInteger(proposal.goalCount)
    || proposal.goalCount < 2
    || proposal.goalCount > 1_000
    || proposal.modelIdentity.trim() === ''
    || Buffer.byteLength(proposal.modelIdentity) > 2_048) {
    throw new Error('Skill Candidate requires at least two distinct Goal-linked gaps and valid internal provenance')
  }
}

function parseSkillHeader(raw: string): {
  readonly name: string
  readonly description: string
  readonly permissionsDeclared: boolean
  readonly permissionFingerprint: string
  readonly license?: string
} {
  const normalized = raw.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('Skill is missing YAML frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('Skill has unterminated YAML frontmatter')
  const parsed = parseYaml(normalized.slice(4, end)) as unknown
  if (!isRecord(parsed)) throw new Error('Skill frontmatter must be an object')
  if (typeof parsed.name !== 'string' || !PUBLIC_ID.test(parsed.name)) {
    throw new Error('Skill has an invalid name')
  }
  if (typeof parsed.description !== 'string'
    || parsed.description.trim().length === 0
    || parsed.description.trim().length > 2_048) {
    throw new Error('Skill has an invalid description')
  }
  if (parsed.license !== undefined && (typeof parsed.license !== 'string'
    || parsed.license.trim().length === 0
    || parsed.license.trim().length > 256)) {
    throw new Error('Skill has an invalid license')
  }
  const permissionDeclarations: Record<string, unknown> = {}
  if (Object.hasOwn(parsed, 'permissions')) permissionDeclarations.permissions = parsed.permissions
  if (Object.hasOwn(parsed, 'allowed-tools')) permissionDeclarations['allowed-tools'] = parsed['allowed-tools']
  return Object.freeze({
    name: parsed.name,
    description: parsed.description.trim(),
    permissionsDeclared: Object.keys(permissionDeclarations).length > 0,
    permissionFingerprint: canonicalJson(permissionDeclarations),
    ...(typeof parsed.license === 'string' ? { license: parsed.license.trim() } : {}),
  })
}

function decodeCanonicalUtf8(content: Buffer): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
  if (!Buffer.from(decoded).equals(content)) throw new Error('Skill is not canonical UTF-8 text')
  return decoded
}

function assertInside(root: string, path: string): void {
  const fromRoot = relative(root, path)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Skill Candidate file escapes its output root')
  }
}

function sha256(value: string): string {
  return sha256Bytes(Buffer.from(value))
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function contentId(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
