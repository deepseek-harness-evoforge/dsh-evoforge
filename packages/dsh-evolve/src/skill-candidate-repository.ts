import { createHash } from 'node:crypto'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  assembleSkillBundleArchive,
  decodeSkillBundleArchive,
  type SkillBundleTextFile,
} from './skill-bundle-archive.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ARTIFACT_BASE64_BYTES = 2 * 1024 * 1024
const hashSchema = z.string().regex(CONTENT_ID)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const candidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
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
  readonly inputDigest: string
  readonly files: readonly SkillBundleTextFile[]
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
  close(): Promise<void>
}

const candidateDomainSpec = defineDomain({
  name: 'evoforge_skill_candidates',
  version: 1,
  tables: {
    candidates: domainTable<string, ExperienceSkillCandidate>(candidateSchema),
  },
})

type SkillCandidateDomain = Domain<typeof candidateDomainSpec>

class DomainSkillCandidateStore implements SkillCandidateStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: SkillCandidateDomain
  constructor(domain: SkillCandidateDomain) {
    this.domain = domain
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
      const candidate = immutableCopy(candidateSchema.parse({ schemaVersion: 1, id, ...input }))
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

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
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
  return new DomainSkillCandidateStore(await facility.open(candidateDomainSpec))
}

/**
 * The only Candidate ingress. It accepts a bounded whole-Skill authored from
 * one internally discovered Opportunity and has no search, import, install,
 * activation, evaluation, or release interface.
 */
export class SkillCandidateRepository {
  private readonly store: Pick<SkillCandidateStore, 'recordCandidate'>
  private readonly onCandidate: ((candidate: ExperienceSkillCandidate) => void) | undefined

  constructor(
    store: Pick<SkillCandidateStore, 'recordCandidate'>,
    onCandidate?: (candidate: ExperienceSkillCandidate) => void,
  ) {
    this.store = store
    this.onCandidate = onCandidate
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
}

export function skillCandidateId(
  candidate: Pick<ExperienceSkillCandidateInput,
    'workspaceId' | 'skillName' | 'opportunity' | 'authorship' | 'version' | 'contentHash'>,
): string {
  return contentId([
    'internal-experience-skill-candidate-v1',
    candidate.workspaceId,
    candidate.skillName,
    candidate.opportunity.id,
    candidate.authorship.policyId,
    candidate.authorship.modelIdentityHash,
    candidate.authorship.inputDigest,
    candidate.version.artifactDigest,
    candidate.version.treeHash,
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

function assertProposalIdentity(proposal: SkillCandidateProposal): void {
  if (!Number.isSafeInteger(proposal.createdAt)
    || proposal.createdAt < 0
    || !z.uuid().safeParse(proposal.workspaceId).success
    || !PUBLIC_ID.test(proposal.skillName)
    || !PUBLIC_ID.test(proposal.policyId)
    || !CONTENT_ID.test(proposal.opportunityId)
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
  return Object.freeze({
    name: parsed.name,
    description: parsed.description.trim(),
    permissionsDeclared: Object.hasOwn(parsed, 'permissions') || Object.hasOwn(parsed, 'allowed-tools'),
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
