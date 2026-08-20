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
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'
import { parse as parseYaml } from 'yaml'
import type {
  CapabilityGeneration,
  SkillBundleGenerationArtifact,
  SkillGenerationArtifact,
} from './generation-store.ts'
import {
  assembleSealedSkillBundleArchive,
  assembleSkillBundleArchive,
  decodeSkillBundleArchive,
} from './skill-bundle-archive.ts'

const CACHE_SCHEMA_VERSION = 2
const PROVIDER_NAME = 'evoforge-generation'
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface BundleTreeEntry {
  mode: '100444'
  digest: string
  size: number
  relativePath: string
}

interface CacheMarker {
  schemaVersion: 2
  treeHash: string
  entries: BundleTreeEntry[]
}

export interface ResolvedGenerationBundle {
  artifact: SkillBundleGenerationArtifact
  resourceBase: string
}

/**
 * Materialize only Host-authored, content-addressed Generation bundles.
 * There is intentionally no source catalog, repository fallback, network, or
 * method that resolves a name without an exact immutable artifact.
 */
export class GenerationBundleRepository {
  private readonly cacheRoot: string
  private readonly materializations = new Map<string, Promise<string>>()

  constructor(cacheRoot: string) {
    this.cacheRoot = resolve(cacheRoot)
    if (dirname(this.cacheRoot) === this.cacheRoot) {
      throw new Error('dsh-evolve: cacheRoot must not be a filesystem root')
    }
  }

  async providerFor(generation: CapabilityGeneration): Promise<SkillProvider> {
    const definitions = new Map<string, SkillDefinition>()
    for (const artifact of generation.artifacts) {
      if (definitions.has(artifact.name)) {
        throw new Error(`Generation '${generation.id}' contains duplicate Skill '${artifact.name}'`)
      }
      if (artifact.kind !== 'skill-bundle') {
        throw new Error(
          `Generation '${generation.id}' contains a quarantined legacy artifact for Skill '${artifact.name}'`,
        )
      }
      if (artifact.lineage.workspaceId !== generation.workspaceId) {
        throw new Error(`Generation Skill bundle '${artifact.name}' belongs to a different Workspace`)
      }
      definitions.set(artifact.name, await this.loadDefinition(artifact))
    }
    return new ImmutableGenerationProvider(generation.id, definitions)
  }

  async resolveArtifact(
    name: string,
    artifact: SkillGenerationArtifact | undefined,
  ): Promise<ResolvedGenerationBundle> {
    if (artifact === undefined) {
      throw new Error(`Skill '${name}' has no exact content-addressed Generation bundle`)
    }
    if (artifact.kind !== 'skill-bundle') {
      throw new Error(`Skill '${name}' references a quarantined legacy Generation artifact`)
    }
    if (artifact.name !== name) {
      throw new Error(`Skill bundle artifact '${artifact.name}' does not match requested Skill '${name}'`)
    }
    return { artifact, resourceBase: await this.materialize(artifact) }
  }

  private async loadDefinition(artifact: SkillBundleGenerationArtifact): Promise<SkillDefinition> {
    const resolved = await this.resolveArtifact(artifact.name, artifact)
    const parsed = parseSkill(await readFile(join(resolved.resourceBase, 'SKILL.md'), 'utf8'))
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
      resourceBase: Object.freeze({ kind: 'directory' as const, path: resolved.resourceBase }),
      path: join(resolved.resourceBase, 'SKILL.md'),
      ...parsed.metadata === undefined ? {} : { metadata: immutableCopy(parsed.metadata) },
      content: parsed.content,
    })
  }

  private materialize(artifact: SkillBundleGenerationArtifact): Promise<string> {
    const key = `${artifact.artifactDigest}\0${artifact.treeHash}`
    let pending = this.materializations.get(key)
    if (pending === undefined) {
      pending = this.materializeOnce(artifact)
      this.materializations.set(key, pending)
      void pending.finally(() => {
        if (this.materializations.get(key) === pending) this.materializations.delete(key)
      }).catch(() => undefined)
    }
    return pending
  }

  private async materializeOnce(artifact: SkillBundleGenerationArtifact): Promise<string> {
    const content = Buffer.from(artifact.contentBase64, 'base64')
    if (content.toString('base64') !== artifact.contentBase64) {
      throw new Error(`Generation Skill bundle '${artifact.name}' is not canonical base64`)
    }
    const decoded = await decodeSkillBundleArchive(content)
    const assembled = artifact.lineage.kind === 'existing-skill-candidate-lineage-v1'
      ? await assembleSealedSkillBundleArchive(decoded.files)
      : await assembleSkillBundleArchive(decoded.files.map(file => ({
          path: file.path,
          content: decodeCanonicalUtf8(file.content),
        })))
    if (!assembled.content.equals(content)
      || sha256(content) !== artifact.artifactDigest
      || assembled.treeHash !== artifact.treeHash
      || artifact.name !== artifact.lineage.skillName
      || artifact.artifactDigest !== artifact.lineage.contentHash
      || artifact.treeHash !== artifact.lineage.candidateTreeHash) {
      throw new Error(`Generation Skill bundle '${artifact.name}' failed content identity verification`)
    }
    const marker: CacheMarker = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      treeHash: artifact.treeHash,
      entries: assembled.files.map(file => ({
        mode: '100444' as const,
        digest: sha256(file.content),
        size: file.content.byteLength,
        relativePath: file.path,
      })),
    }
    const finalRoot = join(this.cacheRoot, artifact.treeHash)
    const finalTree = join(finalRoot, 'tree')
    if (await pathExists(finalRoot)) {
      await verifyMaterialization(finalRoot, marker)
      return finalTree
    }

    await mkdir(this.cacheRoot, { recursive: true })
    const stage = await mkdtemp(join(this.cacheRoot, '.evoforge-bundle-stage-'))
    try {
      const tree = join(stage, 'tree')
      await mkdir(tree, { recursive: true })
      for (const file of assembled.files) {
        const target = containedPath(tree, file.path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.content, { flag: 'wx', mode: 0o444 })
        await chmod(target, 0o444)
      }
      await makeDirectoriesReadOnly(tree)
      const markerPath = join(stage, 'evoforge-owner.json')
      await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o444 })
      await chmod(markerPath, 0o444)
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

async function verifyMaterialization(root: string, expected: CacheMarker): Promise<void> {
  await assertReadOnlyDirectory(root)
  const markerPath = join(root, 'evoforge-owner.json')
  await assertReadOnlyFile(markerPath)
  let marker: CacheMarker
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8')) as CacheMarker
  } catch (error) {
    throw new Error(`Generation cache '${root}' has no readable EvoForge owner marker`, { cause: error })
  }
  if (JSON.stringify(marker) !== JSON.stringify(expected)) {
    throw new Error(`Generation cache '${root}' does not match its immutable Skill tree manifest`)
  }
  const tree = join(root, 'tree')
  await assertReadOnlyDirectory(tree)
  const observed = await listMaterializedTree(tree)
  const expectedFiles = expected.entries.map(entry => entry.relativePath).sort()
  const expectedDirectories = [...new Set(expectedFiles.flatMap(parentDirectories))].sort()
  if (JSON.stringify(observed.files) !== JSON.stringify(expectedFiles)
    || JSON.stringify(observed.directories) !== JSON.stringify(expectedDirectories)) {
    throw new Error(`Generation cache '${root}' contains files or directories outside its Skill tree`)
  }
  for (const entry of expected.entries) {
    const path = containedPath(tree, entry.relativePath)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size) {
      throw new Error(`Generation cache file '${path}' failed type or size verification`)
    }
    if ((info.mode & 0o222) !== 0) {
      throw new Error(`Generation cache file '${path}' is not read-only`)
    }
    if (sha256(await readFile(path)) !== entry.digest) {
      throw new Error(`Generation cache file '${path}' failed content verification`)
    }
  }
}

async function assertReadOnlyDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Generation cache '${path}' is not an owned directory`)
  }
  if ((info.mode & 0o222) !== 0) {
    throw new Error(`Generation cache directory '${path}' is not read-only`)
  }
}

async function assertReadOnlyFile(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Generation cache owner marker '${path}' is not a regular file`)
  }
  if ((info.mode & 0o222) !== 0) {
    throw new Error(`Generation cache owner marker '${path}' is not read-only`)
  }
}

async function listMaterializedTree(root: string): Promise<{ files: string[]; directories: string[] }> {
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
        const path = join(directory, entry.name)
        await assertReadOnlyDirectory(path)
        await visit(path, relativePath)
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
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeDirectoriesReadOnly(join(root, entry.name))
  }
  await chmod(root, 0o555)
}

async function makeOwnedStageWritable(root: string): Promise<void> {
  await chmod(root, 0o755).catch(() => undefined)
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
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

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function decodeCanonicalUtf8(content: Buffer): string {
  const value = content.toString('utf8')
  if (!Buffer.from(value).equals(content)) {
    throw new Error('Generation Skill bundle contains non-canonical UTF-8 text')
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
