import { execFile as execFileCallback } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  CapabilityGeneration,
  EvolutionStore,
  SkillGenerationArtifact,
} from './generation-store.ts'
import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import {
  projectNewSkillCandidateImpact,
  type CandidateImpactProjection,
} from './candidate-impact.ts'
import type { ReviewCandidate } from './review-inbox.ts'
import { assembleSkillBundleArchive } from './skill-bundle-archive.ts'
import {
  parseSkillCandidateLineage,
  type SkillCandidateLineage,
} from './skill-candidate-lineage.ts'

const execFile = promisify(execFileCallback)
const MAX_DIFF_PREVIEW_BYTES = 16 * 1024

export interface CandidateDiffPreview {
  patch: string
  shownBytes: number
  totalBytes: number
  truncated: boolean
  impact: CandidateImpactProjection
}

/**
 * Verify and publish a complete, internally authored Skill bundle.
 *
 * Updating an already installed Skill is deliberately fail-closed until DSH can
 * seal a complete baseline bundle through its native Skill provider contract.
 * This module never reads a source repository or writes a Git object/ref.
 */
export class CandidatePublisher {
  private readonly store: EvolutionStore
  private readonly bundles: Pick<GenerationBundleRepository, 'providerFor'>

  constructor(
    store: EvolutionStore,
    bundles: Pick<GenerationBundleRepository, 'providerFor'>,
  ) {
    this.store = store
    this.bundles = bundles
  }

  async preview(candidate: ReviewCandidate): Promise<CandidateDiffPreview> {
    const lineage = requireNewSkillProposal(candidate)
    await this.resolveAbsentBaseline(candidate)
    const stage = await mkdtemp(join(tmpdir(), 'dsh-evolve-preview-'))
    try {
      await mkdir(join(stage, 'a'))
      const candidateTree = join(stage, 'b')
      await mkdir(candidateTree)
      await materializeCandidate(candidateTree, candidate)
      const assembled = await assembleSkillBundleArchive(candidate.proposal.files)
      assertBundleIdentity(candidate, lineage, assembled.treeHash, assembled.artifactDigest)
      const patch = await diffTrees(stage)
      return {
        ...boundDiffPreview(patch),
        impact: projectNewSkillCandidateImpact(candidate.proposal.files),
      }
    } finally {
      await makeWritable(stage).catch(() => undefined)
      await rm(stage, { recursive: true, force: true })
    }
  }

  async publish(
    candidate: ReviewCandidate,
    options: { policyVersion?: 'human-review-v1' | 'auto-clear-instruction-v1' } = {},
  ): Promise<CapabilityGeneration> {
    if (candidate.status !== 'pending') {
      throw new Error('only a pending review Candidate can be published')
    }
    const lineage = requireNewSkillProposal(candidate)
    const { active, activeArtifacts } = await this.resolveAbsentBaseline(candidate)
    const assembled = await assembleSkillBundleArchive(candidate.proposal.files)
    assertBundleIdentity(candidate, lineage, assembled.treeHash, assembled.artifactDigest)
    const artifact = {
      kind: 'skill-bundle' as const,
      name: candidate.skillName,
      artifactDigest: assembled.artifactDigest,
      treeHash: assembled.treeHash,
      contentBase64: assembled.content.toString('base64'),
      lineage,
    }
    const input = generationInput(
      candidate,
      active,
      [...activeArtifacts, artifact],
      options.policyVersion ?? 'human-review-v1',
    )
    // Validate the exact immutable Bundle before any Storage publication.
    await this.bundles.providerFor({ id: '0'.repeat(64), schemaVersion: 2, ...input })
    const published = await this.store.publishGeneration(input)
    if (this.store.getActiveGeneration(candidate.workspaceId)?.id !== active?.id) {
      throw new Error('active Generation changed while the reviewed Candidate was being published')
    }
    return published.generation
  }

  private async resolveAbsentBaseline(candidate: ReviewCandidate): Promise<{
    active: CapabilityGeneration | undefined
    activeArtifacts: SkillGenerationArtifact[]
  }> {
    const active = this.store.getActiveGeneration(candidate.workspaceId)
    const activeArtifacts = active?.artifacts ?? []
    if (active !== undefined) await this.bundles.providerFor(active)
    if (activeArtifacts.some(artifact => artifact.name === candidate.skillName)) {
      throw new Error(
        `capability-absent review conflicts with active Skill '${candidate.skillName}'`,
      )
    }
    return { active, activeArtifacts }
  }
}

function requireNewSkillProposal(candidate: ReviewCandidate): SkillCandidateLineage {
  if (candidate.baselineKind !== 'capability-absent') {
    throw new Error(
      `existing Skill '${candidate.skillName}' cannot be published without a sealed complete baseline Bundle`,
    )
  }
  if (candidate.proposal.files.length === 0) throw new Error('review Candidate proposes no files')
  if (new Set(candidate.proposal.files.map(file => file.path)).size !== candidate.proposal.files.length) {
    throw new Error('review Candidate proposes the same path more than once')
  }
  if (candidate.lineage === undefined) {
    throw new Error('a brand-new internal Skill requires exact Candidate lineage')
  }
  let lineage: SkillCandidateLineage
  try {
    lineage = parseSkillCandidateLineage(candidate.lineage)
  } catch {
    throw new Error('Review lineage does not match its exact Candidate')
  }
  if (lineage.workspaceId !== candidate.workspaceId
    || lineage.skillName !== candidate.skillName
    || lineage.candidateTreeHash !== candidate.candidateTreeHash) {
    throw new Error('Review lineage does not match its exact Candidate')
  }
  return lineage
}

function assertBundleIdentity(
  candidate: ReviewCandidate,
  lineage: SkillCandidateLineage,
  treeHash: string,
  artifactDigest: string,
): void {
  if (treeHash !== candidate.candidateTreeHash || artifactDigest !== lineage.contentHash) {
    throw new Error('brand-new Skill bundle does not match its sealed Candidate identity')
  }
}

async function materializeCandidate(candidateTree: string, candidate: ReviewCandidate): Promise<void> {
  await makeWritable(candidateTree)
  for (const file of candidate.proposal.files) {
    const target = containedPath(candidateTree, file.path)
    await mkdir(dirname(target), { recursive: true })
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(`approved Candidate cannot replace non-file '${file.path}'`)
      }
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    await writeFile(target, file.content, { mode: 0o644 })
  }
}

async function diffTrees(stage: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', [
      'diff',
      '--no-index',
      '--no-color',
      '--no-ext-diff',
      '--no-prefix',
      '--',
      'a',
      'b',
    ], {
      cwd: stage,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    return stdout
  } catch (error) {
    if (isRecord(error) && error.code === 1 && typeof error.stdout === 'string') {
      return error.stdout
    }
    throw error
  }
}

function boundDiffPreview(patch: string): Omit<CandidateDiffPreview, 'impact'> {
  const safePatch = escapeDiffControls(patch)
  const source = Buffer.from(safePatch)
  const totalBytes = source.byteLength
  if (totalBytes <= MAX_DIFF_PREVIEW_BYTES) {
    return { patch: safePatch, shownBytes: totalBytes, totalBytes, truncated: false }
  }
  let end = MAX_DIFF_PREVIEW_BYTES
  while (end > 0 && (source[end] ?? 0) >= 0x80 && (source[end] ?? 0) < 0xc0) end -= 1
  const bounded = source.subarray(0, end).toString('utf8')
  return {
    patch: bounded,
    shownBytes: Buffer.byteLength(bounded),
    totalBytes,
    truncated: true,
  }
}

function escapeDiffControls(value: string): string {
  return value.replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    character => {
      const code = character.codePointAt(0)!
      return code <= 0xff
        ? `\\x${code.toString(16).padStart(2, '0')}`
        : `\\u${code.toString(16).padStart(4, '0')}`
    },
  )
}

function generationInput(
  candidate: ReviewCandidate,
  active: CapabilityGeneration | undefined,
  artifacts: SkillGenerationArtifact[],
  policyVersion: 'human-review-v1' | 'auto-clear-instruction-v1',
) {
  const createdAt = Date.parse(candidate.startedAt)
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error('review Candidate has an invalid startedAt timestamp')
  }
  return {
    workspaceId: candidate.workspaceId,
    ...active === undefined ? {} : { parentId: active.id },
    createdAt,
    artifacts,
    evaluatorVersion: candidate.evaluatorVersion,
    policyVersion,
    compositionFingerprint: candidate.compositionFingerprint,
  }
}

function containedPath(root: string, child: string): string {
  if (child.length === 0 || child.includes('\\') || isAbsolute(child)
    || child.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`approved Candidate path '${child}' is not owned`)
  }
  const target = resolve(root, ...child.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`approved Candidate path '${child}' escapes its Skill`)
  }
  return target
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o755)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o644)
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
