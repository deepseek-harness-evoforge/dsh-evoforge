import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'
import type { CapabilityGeneration, SkillGenerationArtifact } from './generation-store.ts'

const execFile = promisify(execFileCallback)
const CACHE_SCHEMA_VERSION = 1
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
const PROVIDER_NAME = 'evoforge-generation'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface GitSkillSourceConfig {
  name: string
  repository: string
  path: string
}

export interface ResolvedGitSkillArtifact {
  artifact: SkillGenerationArtifact
  repository: string
  path: string
  resourceBase: string
}

interface ResolvedGitSkillSource {
  name: string
  repository: string
  path: string
}

interface GitTreeEntry {
  mode: '100644'
  object: string
  size: number
  path: string
  relativePath: string
}

interface CacheMarker {
  schemaVersion: 1
  treeHash: string
  entries: Array<Pick<GitTreeEntry, 'mode' | 'object' | 'size' | 'relativePath'>>
}

export class GitSkillSource {
  private readonly cacheRoot: string
  private readonly sources = new Map<string, ResolvedGitSkillSource>()
  private readonly materializations = new Map<string, Promise<string>>()

  constructor(cacheRoot: string, sources: readonly GitSkillSourceConfig[]) {
    this.cacheRoot = resolve(cacheRoot)
    if (dirname(this.cacheRoot) === this.cacheRoot) {
      throw new Error('dsh-evolve: cacheRoot must not be a filesystem root')
    }
    for (const input of sources) {
      const name = input.name.trim()
      if (name.length === 0) throw new Error('dsh-evolve: source name must not be empty')
      if (this.sources.has(name)) throw new Error(`dsh-evolve: duplicate Git source for Skill '${name}'`)
      this.sources.set(name, {
        name,
        repository: resolve(input.repository),
        path: normalizeGitPath(input.path),
      })
    }
  }

  async providerFor(generation: CapabilityGeneration): Promise<SkillProvider> {
    const definitions = new Map<string, SkillDefinition>()
    for (const artifact of generation.artifacts) {
      if (definitions.has(artifact.name)) {
        throw new Error(`Generation '${generation.id}' contains duplicate Skill '${artifact.name}'`)
      }
      const source = this.sources.get(artifact.name)
      if (source === undefined) {
        throw new Error(`Generation '${generation.id}' has no configured Git source for Skill '${artifact.name}'`)
      }
      definitions.set(artifact.name, await this.loadDefinition(artifact, source))
    }
    return new ImmutableGenerationProvider(generation.id, definitions)
  }

  /** Resolve either an exact Generation artifact or the configured repository HEAD. */
  async resolveArtifact(
    name: string,
    artifact?: SkillGenerationArtifact,
  ): Promise<ResolvedGitSkillArtifact> {
    const source = this.sources.get(name)
    if (source === undefined) throw new Error(`no configured Git source for Skill '${name}'`)
    if (artifact !== undefined && artifact.name !== name) {
      throw new Error(`Git artifact '${artifact.name}' does not match requested Skill '${name}'`)
    }
    const resolvedArtifact = artifact ?? {
      kind: 'skill' as const,
      name,
      gitCommit: await gitText(source.repository, 'rev-parse', '--verify', 'HEAD^{commit}'),
      treeHash: await gitText(source.repository, 'rev-parse', 'HEAD:' + source.path),
    }
    return {
      artifact: resolvedArtifact,
      repository: source.repository,
      path: source.path,
      resourceBase: await this.materialize(resolvedArtifact, source),
    }
  }

  /** Resolve the immutable first-parent Skill tree of an exact Candidate artifact. */
  async resolveParentArtifact(
    name: string,
    candidate: SkillGenerationArtifact,
  ): Promise<ResolvedGitSkillArtifact> {
    const source = this.sources.get(name)
    if (source === undefined) throw new Error(`no configured Git source for Skill '${name}'`)
    if (candidate.name !== name) {
      throw new Error(`Git artifact '${candidate.name}' does not match requested Skill '${name}'`)
    }
    const parentCommit = await gitText(
      source.repository,
      'rev-parse',
      '--verify',
      `${candidate.gitCommit}^1^{commit}`,
    )
    const parentTree = await gitText(source.repository, 'rev-parse', `${parentCommit}:${source.path}`)
    return this.resolveArtifact(name, {
      kind: 'skill',
      name,
      gitCommit: parentCommit,
      treeHash: parentTree,
    })
  }

  private async loadDefinition(
    artifact: SkillGenerationArtifact,
    source: ResolvedGitSkillSource,
  ): Promise<SkillDefinition> {
    const resourceBase = await this.materialize(artifact, source)
    const parsed = parseSkill(await readFile(join(resourceBase, 'SKILL.md'), 'utf8'))
    if (!SKILL_NAME.test(parsed.name)) {
      throw new Error(`Generation SKILL.md has invalid Skill name '${parsed.name}'`)
    }
    if (parsed.name !== artifact.name) {
      throw new Error(
        `Generation Skill '${artifact.name}' resolves to frontmatter name '${parsed.name}'`,
      )
    }
    return Object.freeze({
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse },
      invocation: Object.freeze(parsed.invocation),
      source: 'evoforge-generation',
      provider: PROVIDER_NAME,
      resourceBase: Object.freeze({ kind: 'directory' as const, path: resourceBase }),
      path: join(resourceBase, 'SKILL.md'),
      ...parsed.metadata === undefined ? {} : { metadata: immutableCopy(parsed.metadata) },
      content: parsed.content,
    })
  }

  private materialize(
    artifact: SkillGenerationArtifact,
    source: ResolvedGitSkillSource,
  ): Promise<string> {
    const key = `${source.repository}\0${source.path}\0${artifact.gitCommit}\0${artifact.treeHash}`
    let pending = this.materializations.get(key)
    if (pending === undefined) {
      pending = this.materializeOnce(artifact, source)
      this.materializations.set(key, pending)
      void pending.finally(() => {
        if (this.materializations.get(key) === pending) this.materializations.delete(key)
      }).catch(() => undefined)
    }
    return pending
  }

  private async materializeOnce(
    artifact: SkillGenerationArtifact,
    source: ResolvedGitSkillSource,
  ): Promise<string> {
    const commit = await gitText(source.repository, 'rev-parse', '--verify', `${artifact.gitCommit}^{commit}`)
    if (commit !== artifact.gitCommit) {
      throw new Error(`Git source for Skill '${artifact.name}' did not resolve exact commit '${artifact.gitCommit}'`)
    }
    const treeHash = await gitText(source.repository, 'rev-parse', `${commit}:${source.path}`)
    if (treeHash !== artifact.treeHash) {
      throw new Error(
        `Git tree mismatch for Skill '${artifact.name}': expected '${artifact.treeHash}', received '${treeHash}'`,
      )
    }
    const entries = await listTree(source.repository, commit, source.path)
    if (!entries.some(entry => entry.relativePath === 'SKILL.md')) {
      throw new Error(`Git tree for Skill '${artifact.name}' has no SKILL.md`)
    }
    const marker = markerFor(artifact.treeHash, entries)
    const finalRoot = join(this.cacheRoot, artifact.treeHash)
    const finalTree = join(finalRoot, 'tree')
    if (await pathExists(finalRoot)) {
      await verifyMaterialization(finalRoot, marker)
      return finalTree
    }

    await mkdir(this.cacheRoot, { recursive: true })
    const stage = await mkdtemp(join(this.cacheRoot, '.evoforge-stage-'))
    try {
      const tree = join(stage, 'tree')
      await mkdir(tree, { recursive: true })
      for (const entry of entries) {
        const target = containedPath(tree, entry.relativePath)
        const content = await gitBlob(source.repository, entry.object)
        if (content.byteLength !== entry.size || gitObjectHash(content, entry.object.length) !== entry.object) {
          throw new Error(`Git blob '${entry.object}' failed integrity verification`)
        }
        await mkdir(resolve(target, '..'), { recursive: true })
        await writeFile(target, content, { mode: 0o444 })
        await chmod(target, 0o444)
      }
      await makeDirectoriesReadOnly(tree)
      await writeFile(join(stage, 'evoforge-owner.json'), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o444 })
      await chmod(join(stage, 'evoforge-owner.json'), 0o444)
      let installed = false
      try {
        await rename(stage, finalRoot)
        installed = true
      } catch (error) {
        if (!await pathExists(finalRoot)) throw error
        await verifyMaterialization(finalRoot, marker)
        await makeOwnedStageWritable(stage)
        await rm(stage, { force: true, recursive: true })
      }
      if (installed) await chmod(finalRoot, 0o555)
      return finalTree
    } catch (error) {
      if (await pathExists(stage)) {
        await makeOwnedStageWritable(stage)
        await rm(stage, { force: true, recursive: true })
      }
      throw error
    }
  }
}

class ImmutableGenerationProvider implements SkillProvider {
  readonly name = PROVIDER_NAME
  private readonly generationId: string
  private readonly definitions: ReadonlyMap<string, SkillDefinition>

  constructor(
    generationId: string,
    definitions: ReadonlyMap<string, SkillDefinition>,
  ) {
    this.generationId = generationId
    this.definitions = definitions
  }

  async list(): Promise<SkillCandidate[]> {
    return [...this.definitions.values()].map(definition => ({
      name: definition.name,
      description: definition.description,
      ...definition.whenToUse === undefined ? {} : { whenToUse: definition.whenToUse },
      invocation: definition.invocation,
      source: definition.source,
      provider: this.name,
      ...definition.resourceBase === undefined ? {} : { resourceBase: definition.resourceBase },
      rank: 1,
      locator: Object.freeze({ generationId: this.generationId, name: definition.name }),
      ...definition.path === undefined ? {} : { path: definition.path },
      ...definition.metadata === undefined ? {} : { metadata: definition.metadata },
    }))
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as { generationId?: unknown; name?: unknown }
    if (locator.generationId !== this.generationId || locator.name !== candidate.name) return undefined
    return this.definitions.get(candidate.name)
  }
}

function normalizeGitPath(input: string): string {
  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (normalized.length === 0 || normalized === '.' || normalized.startsWith('/')
    || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`dsh-evolve: invalid repository-relative Skill path '${input}'`)
  }
  return normalized
}

async function listTree(repository: string, commit: string, sourcePath: string): Promise<GitTreeEntry[]> {
  const { stdout } = await execFile(
    'git',
    ['-C', repository, 'ls-tree', '-l', '-r', '-z', commit, '--', sourcePath],
    { encoding: 'buffer', maxBuffer: MAX_ARTIFACT_BYTES * 2 },
  )
  const records = Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean)
  const entries = records.map((record): GitTreeEntry => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(record)
    if (match === null) throw new Error(`unsupported git ls-tree record '${record}'`)
    const [, mode, type, object, rawSize, path] = match
    if (mode !== '100644' || type !== 'blob' || object === undefined || rawSize === undefined || path === undefined) {
      throw new Error(`Generation Skill tree may contain only non-executable regular files: '${path ?? record}'`)
    }
    const relativePath = relativeGitPath(sourcePath, path)
    return { mode, object, size: Number(rawSize), path, relativePath }
  })
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total > MAX_ARTIFACT_BYTES) {
    throw new Error(`Generation Skill tree exceeds ${MAX_ARTIFACT_BYTES} bytes`)
  }
  return entries
}

function relativeGitPath(sourcePath: string, path: string): string {
  const prefix = `${sourcePath}/`
  if (!path.startsWith(prefix)) throw new Error(`Git tree path '${path}' escapes '${sourcePath}'`)
  const value = path.slice(prefix.length)
  if (value.length === 0 || value === '..' || value.startsWith('../') || value.includes('/../')) {
    throw new Error(`Git tree path '${path}' is not contained by '${sourcePath}'`)
  }
  return value
}

async function gitText(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function gitBlob(repository: string, object: string): Promise<Buffer> {
  const { stdout } = await execFile('git', ['-C', repository, 'cat-file', 'blob', object], {
    encoding: 'buffer',
    maxBuffer: MAX_ARTIFACT_BYTES + 1,
  })
  return Buffer.from(stdout)
}

function gitObjectHash(content: Buffer, objectIdLength: number): string {
  const algorithm = objectIdLength === 40 ? 'sha1' : objectIdLength === 64 ? 'sha256' : undefined
  if (algorithm === undefined) throw new Error(`unsupported Git object id length ${objectIdLength}`)
  return createHash(algorithm)
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest('hex')
}

function markerFor(treeHash: string, entries: readonly GitTreeEntry[]): CacheMarker {
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    treeHash,
    entries: entries.map(({ mode, object, size, relativePath }) => ({ mode, object, size, relativePath })),
  }
}

async function verifyMaterialization(root: string, expected: CacheMarker): Promise<void> {
  let marker: CacheMarker
  try {
    marker = JSON.parse(await readFile(join(root, 'evoforge-owner.json'), 'utf8')) as CacheMarker
  } catch (error) {
    throw new Error(`Generation cache '${root}' has no readable EvoForge owner marker`, { cause: error })
  }
  if (JSON.stringify(marker) !== JSON.stringify(expected)) {
    throw new Error(`Generation cache '${root}' does not match its immutable Git tree manifest`)
  }
  const tree = join(root, 'tree')
  const observed = await listMaterializedTree(tree)
  const expectedFiles = expected.entries.map(entry => entry.relativePath).sort()
  const expectedDirectories = [...new Set(expectedFiles.flatMap(parentDirectories))].sort()
  if (JSON.stringify(observed.files) !== JSON.stringify(expectedFiles)
    || JSON.stringify(observed.directories) !== JSON.stringify(expectedDirectories)) {
    throw new Error(`Generation cache '${root}' contains files or directories outside its Git tree`)
  }
  for (const entry of expected.entries) {
    const path = containedPath(tree, entry.relativePath)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size) {
      throw new Error(`Generation cache file '${path}' failed type or size verification`)
    }
    const content = await readFile(path)
    if (gitObjectHash(content, entry.object.length) !== entry.object) {
      throw new Error(`Generation cache file '${path}' failed content verification`)
    }
  }
}

async function listMaterializedTree(root: string): Promise<{
  files: string[]
  directories: string[]
}> {
  const files: string[] = []
  const directories: string[] = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`
      if (entry.isSymbolicLink()) {
        throw new Error(`Generation cache '${root}' contains symbolic link '${relativePath}'`)
      }
      if (entry.isDirectory()) {
        directories.push(relativePath)
        await visit(join(directory, entry.name), relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Generation cache '${root}' contains unsupported entry '${relativePath}'`)
      }
    }
  }
  await visit(root, '')
  return { files: files.sort(), directories: directories.sort() }
}

function parentDirectories(path: string): string[] {
  const parts = path.split('/')
  const directories: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join('/'))
  }
  return directories
}

function containedPath(root: string, child: string): string {
  const path = resolve(root, ...child.split('/'))
  const relativePath = relative(root, path)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Generation cache path '${child}' escapes its owned root`)
  }
  return path
}

async function makeDirectoriesReadOnly(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    await makeDirectoriesReadOnly(join(root, entry.name))
  }
  await chmod(root, 0o555)
}

async function makeOwnedStageWritable(root: string): Promise<void> {
  await chmod(root, 0o755).catch(() => undefined)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeOwnedStageWritable(path)
    else await chmod(path, 0o644).catch(() => undefined)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return false
    throw error
  }
}

interface ParsedSkill {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
  metadata?: Readonly<Record<string, unknown>>
  content: string
}

function parseSkill(raw: string): ParsedSkill {
  const normalized = raw.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('Generation SKILL.md is missing YAML frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('Generation SKILL.md has unterminated YAML frontmatter')
  const parsed = parseYaml(normalized.slice(4, end)) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Generation SKILL.md frontmatter must be an object')
  }
  const data = parsed as Record<string, unknown>
  const name = requiredString(data, 'name')
  const description = requiredString(data, 'description')
  const whenToUse = optionalString(data, 'whenToUse')
  const disableModel = optionalBoolean(data, 'disable-model-invocation')
  const userInvocable = optionalBoolean(data, 'user-invocable')
  return {
    name,
    description,
    ...whenToUse === undefined ? {} : { whenToUse },
    invocation: {
      modelInvocable: disableModel !== true,
      userInvocable: userInvocable !== false,
    },
    metadata: data,
    content: normalized.slice(end + '\n---\n'.length).trim(),
  }
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = optionalString(data, key)
  if (value === undefined) throw new Error(`Generation SKILL.md frontmatter requires '${key}'`)
  return value
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Generation SKILL.md frontmatter '${key}' must be a non-empty string`)
  }
  return value.trim()
}

function optionalBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`Generation SKILL.md frontmatter '${key}' must be a boolean`)
  }
  return value
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
