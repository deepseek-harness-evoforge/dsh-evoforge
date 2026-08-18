import { execFile as execFileCallback } from 'node:child_process'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { EvolutionStore, SkillGenerationArtifact } from './generation-store.ts'
import { projectCandidateImpact, type CandidateImpactProjection } from './candidate-impact.ts'
import type { GitSkillSource } from './git-skill-source.ts'
import { hashTree } from './hash.ts'
import type { ReviewCandidate } from './review-inbox.ts'
import {
  parseDiscoveredSkillLineage,
  type DiscoveredSkillLineage,
} from './discovered-skill-lineage.ts'

const execFile = promisify(execFileCallback)
const MAX_DIFF_PREVIEW_BYTES = 16 * 1024

export interface CandidateDiffPreview {
  patch: string
  shownBytes: number
  totalBytes: number
  truncated: boolean
  impact: CandidateImpactProjection
}

/** Verify, preview, and publish one evaluated Skill proposal without moving a user branch. */
export class CandidatePublisher {
  private readonly store: EvolutionStore
  private readonly source: GitSkillSource

  constructor(store: EvolutionStore, source: GitSkillSource) {
    this.store = store
    this.source = source
  }

  /** Render a bounded diff from the same exact Git baseline required for publication. */
  async preview(candidate: ReviewCandidate): Promise<CandidateDiffPreview> {
    assertProposal(candidate)
    const { base } = await this.resolveBaseline(candidate)
    const baselineSkill = await readFile(join(base.resourceBase, 'SKILL.md'), 'utf8')
    const impact = projectCandidateImpact(baselineSkill, candidate.proposal.files)
    const stage = await mkdtemp(join(tmpdir(), 'dsh-evolve-preview-'))
    try {
      const baselineTree = join(stage, 'a')
      const candidateTree = join(stage, 'b')
      await cp(base.resourceBase, baselineTree, { recursive: true })
      await cp(base.resourceBase, candidateTree, { recursive: true })
      await materializeCandidate(candidateTree, candidate)
      const patch = await diffTrees(stage)
      return { ...boundDiffPreview(patch), impact }
    } finally {
      await makeWritable(stage).catch(() => undefined)
      await rm(stage, { recursive: true, force: true })
    }
  }

  async publish(
    candidate: ReviewCandidate,
    options: { policyVersion?: 'human-review-v1' | 'auto-clear-instruction-v1' } = {},
  ) {
    if (candidate.status !== 'pending') throw new Error('only a pending review Candidate can be published')
    const lineage = assertProposal(candidate)
    const { active, activeArtifacts, base } = await this.resolveBaseline(candidate)

    const stage = await mkdtemp(join(tmpdir(), 'dsh-evolve-approved-'))
    try {
      const candidateTree = join(stage, 'candidate')
      await cp(base.resourceBase, candidateTree, { recursive: true })
      await materializeCandidate(candidateTree, candidate)
      const artifact = await writeImmutableCommit({
        baseCommit: base.artifact.gitCommit,
        candidate,
        candidateTree,
        repository: base.repository,
        ...(lineage === undefined ? {} : { lineage }),
        sourcePath: base.path,
        stage,
      })
      const artifacts = active === undefined
        ? [artifact]
        : activeArtifacts.map(item => item.name === candidate.skillName ? artifact : item)
      const createdAt = Date.parse(candidate.startedAt)
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new Error('review Candidate has an invalid startedAt timestamp')
      }
      const input = {
        workspaceId: candidate.workspaceId,
        ...active === undefined ? {} : { parentId: active.id },
        createdAt,
        artifacts,
        evaluatorVersion: candidate.evaluatorVersion,
        policyVersion: options.policyVersion ?? 'human-review-v1',
        compositionFingerprint: candidate.compositionFingerprint,
      }
      // Fail before Storage publication if the exact Git tree or Skill definition is invalid.
      await this.source.providerFor({ id: '0'.repeat(64), schemaVersion: 2, ...input })
      const published = await this.store.publishGeneration(input)
      if (this.store.getActiveGeneration(candidate.workspaceId)?.id !== active?.id) {
        throw new Error('active Generation changed while the reviewed Candidate was being published')
      }
      return published.generation
    } finally {
      await makeWritable(stage).catch(() => undefined)
      await rm(stage, { recursive: true, force: true })
    }
  }

  private async resolveBaseline(candidate: ReviewCandidate) {
    const active = this.store.getActiveGeneration(candidate.workspaceId)
    const activeArtifacts = active?.artifacts ?? []
    if (active !== undefined) await this.source.providerFor(active)
    const prior = activeArtifacts.find(artifact => artifact.name === candidate.skillName)
    if (active !== undefined && prior === undefined) {
      throw new Error(`active Generation has no artifact for Skill '${candidate.skillName}'`)
    }
    const base = await this.source.resolveArtifact(candidate.skillName, prior)
    if (await hashTree(base.resourceBase) !== candidate.baseTreeHash) {
      throw new Error('reviewed baseline does not match the exact Git Skill tree')
    }
    return { active, activeArtifacts, base }
  }
}

function assertProposal(candidate: ReviewCandidate): DiscoveredSkillLineage | undefined {
  if (candidate.proposal.files.length === 0) throw new Error('review Candidate proposes no files')
  if (new Set(candidate.proposal.files.map(file => file.path)).size !== candidate.proposal.files.length) {
    throw new Error('review Candidate proposes the same path more than once')
  }
  if (candidate.lineage === undefined) return undefined
  let lineage: DiscoveredSkillLineage
  try {
    lineage = parseDiscoveredSkillLineage(candidate.lineage)
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
  if (await hashTree(candidateTree) !== candidate.candidateTreeHash) {
    throw new Error('approved proposal does not reproduce the sealed Candidate tree')
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

async function writeImmutableCommit(input: {
  baseCommit: string
  candidate: ReviewCandidate
  candidateTree: string
  repository: string
  lineage?: DiscoveredSkillLineage
  sourcePath: string
  stage: string
}): Promise<SkillGenerationArtifact> {
  const indexPath = join(input.stage, 'git-index')
  const gitEnv = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'DSH EvoForge',
    GIT_AUTHOR_EMAIL: 'evoforge@users.noreply.github.com',
    GIT_COMMITTER_NAME: 'DSH EvoForge',
    GIT_COMMITTER_EMAIL: 'evoforge@users.noreply.github.com',
    GIT_AUTHOR_DATE: input.candidate.startedAt,
    GIT_COMMITTER_DATE: input.candidate.startedAt,
  }
  await git(input.repository, gitEnv, 'read-tree', input.baseCommit)
  for (const file of input.candidate.proposal.files) {
    const blob = await git(
      input.repository,
      gitEnv,
      'hash-object',
      '-w',
      containedPath(input.candidateTree, file.path),
    )
    await git(
      input.repository,
      gitEnv,
      'update-index',
      '--add',
      '--cacheinfo',
      '100644',
      blob,
      `${input.sourcePath}/${file.path}`,
    )
  }
  const repositoryTree = await git(input.repository, gitEnv, 'write-tree')
  const claim = input.candidate.claim.replaceAll(/[\r\n]+/g, ' ').trim().slice(0, 120)
  const commit = await git(
    input.repository,
    gitEnv,
    'commit-tree',
    repositoryTree,
    '-p',
    input.baseCommit,
    '-m',
    `dsh-evolve: ${claim || 'approved Skill Candidate'}`,
  )
  const reference = `refs/evoforge/generations/${input.candidate.id}`
  const existing = await gitOptional(input.repository, gitEnv, 'rev-parse', '--verify', reference)
  if (existing !== undefined && existing !== commit) {
    throw new Error(`immutable EvoForge Git ref '${reference}' already points to different evidence`)
  }
  if (existing === undefined) {
    await git(
      input.repository,
      gitEnv,
      'update-ref',
      reference,
      commit,
      '0'.repeat(input.baseCommit.length),
    )
  }
  const treeHash = await git(input.repository, gitEnv, 'rev-parse', `${commit}:${input.sourcePath}`)
  return {
    kind: 'skill',
    name: input.candidate.skillName,
    gitCommit: commit,
    treeHash,
    ...(input.lineage === undefined ? {} : { lineage: input.lineage }),
  }
}

async function git(
  repository: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function gitOptional(
  repository: string,
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<string | undefined> {
  try {
    return await git(repository, env, ...args)
  } catch (error) {
    if (isRecord(error) && error.code === 128) return undefined
    throw error
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
