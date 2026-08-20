import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  renderSkillContent,
  type SkillDefinition,
  type SkillRegistry,
  type SkillViewOptions,
} from '@deepseek-ai/dsh-skill'
import {
  assembleSealedSkillBundleArchive,
  decodeSkillBundleArchive,
  SKILL_BUNDLE_ARCHIVE_LIMITS,
  type AssembledSkillBundleArchive,
  type SkillBundleArchiveFile,
} from './skill-bundle-archive.ts'
import { writeDurableJson } from './shadow-run-state.ts'

const SHA256 = /^[a-f0-9]{64}$/u
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const STORE_DIRECTORY = 'installed-skill-baselines'

export interface InstalledSkillBaselinePolicy {
  readonly workspaceId: string
  readonly governanceRoot: string
}

export interface InstalledSkillBaselineManifest {
  readonly schemaVersion: 1
  readonly kind: 'installed-skill-baseline-v1'
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly invocationContentHash: string
  readonly provider: string
  readonly source: string
  readonly definitionDigest: string
  readonly createdAt: number
  readonly bundle: {
    readonly format: 'tar.gz'
    readonly artifactDigest: string
    readonly treeHash: string
    readonly fileCount: number
    readonly totalBytes: number
    readonly hasExecutableFiles: false
  }
  readonly releaseAuthority: 'none'
}

export interface InstalledSkillInvocationCapture {
  readonly workspaceId: string
  readonly sessionId: string
  readonly invocationSeq: number
  readonly route: 'model-tool' | 'user-explicit'
  readonly skillName: string
  readonly invocationContent: readonly unknown[]
  readonly cwd?: string
  readonly scope?: SkillViewOptions['scope']
  readonly signal?: AbortSignal
}

export type InstalledSkillBaselineAbstentionReason =
  | 'policy-unavailable'
  | 'skill-unavailable'
  | 'invocation-content-mismatch'
  | 'provider-not-sealable'
  | 'flat-skill-no-package-boundary'
  | 'unsafe-bundle'
  | 'unstable-definition-or-bundle'

export type InstalledSkillBaselineCaptureResult =
  | { readonly status: 'sealed'; readonly baseline: InstalledSkillBaselineManifest }
  | { readonly status: 'abstained'; readonly reason: InstalledSkillBaselineAbstentionReason }

type InstalledSkillBaselineAbstention = Extract<
  InstalledSkillBaselineCaptureResult,
  { readonly status: 'abstained' }
>

interface InstalledSkillInvocationReference {
  readonly schemaVersion: 1
  readonly kind: 'installed-skill-invocation-baseline-v1'
  readonly workspaceId: string
  readonly sessionId: string
  readonly invocationSeq: number
  readonly route: 'model-tool' | 'user-explicit'
  readonly skillName: string
  readonly invocationContentHash: string
  readonly baselineId: string
}

export interface ResolvedInstalledSkillBaseline {
  readonly reference: InstalledSkillInvocationReference
  readonly manifest: InstalledSkillBaselineManifest
  readonly files: readonly SkillBundleArchiveFile[]
}

interface InstalledSkillBaselineVaultOptions {
  readonly now?: () => number
}

/**
 * Host-owned seal for the exact installed Skill package used by one DSH
 * invocation. It does not discover or acquire capabilities and it never
 * changes the active Session; it only creates immutable evaluation evidence.
 */
export class InstalledSkillBaselineVault {
  private readonly policies = new Map<string, InstalledSkillBaselinePolicy>()
  private readonly skills: SkillRegistry
  private readonly now: () => number

  constructor(
    policies: readonly InstalledSkillBaselinePolicy[],
    skills: SkillRegistry,
    options: InstalledSkillBaselineVaultOptions = {},
  ) {
    for (const policy of policies) {
      if (!WORKSPACE_ID.test(policy.workspaceId)) {
        throw new Error('installed Skill baseline policy has an invalid Workspace id')
      }
      const governanceRoot = resolve(policy.governanceRoot)
      if (!isAbsolute(policy.governanceRoot) || dirname(governanceRoot) === governanceRoot) {
        throw new Error('installed Skill baseline governanceRoot must be an absolute non-root path')
      }
      if (this.policies.has(policy.workspaceId)) {
        throw new Error(`duplicate installed Skill baseline policy for Workspace '${policy.workspaceId}'`)
      }
      this.policies.set(policy.workspaceId, Object.freeze({
        workspaceId: policy.workspaceId,
        governanceRoot,
      }))
    }
    this.skills = skills
    this.now = options.now ?? Date.now
  }

  async capture(input: InstalledSkillInvocationCapture): Promise<InstalledSkillBaselineCaptureResult> {
    assertInvocationIdentity(input)
    const policy = this.policies.get(input.workspaceId)
    if (policy === undefined) return abstain('policy-unavailable')

    const lookup = lookupOptions(input)
    const firstDefinition = await this.skills.get(input.skillName, lookup)
    if (firstDefinition === undefined) return abstain('skill-unavailable')
    const invocationContentHash = sha256Json(input.invocationContent)
    if (!matchesInvocationContent(firstDefinition, input.invocationContent)) {
      return abstain('invocation-content-mismatch')
    }
    const packageRoot = packageBoundary(firstDefinition)
    if (packageRoot.status === 'abstained') return packageRoot
    if (pathsOverlap(packageRoot.path, policy.governanceRoot)) return abstain('unsafe-bundle')

    let firstArchive: AssembledSkillBundleArchive
    try {
      firstArchive = await scanAndAssemble(packageRoot.path)
    } catch {
      return abstain('unsafe-bundle')
    }

    const secondDefinition = await this.skills.get(input.skillName, lookup)
    if (secondDefinition === undefined
      || !matchesInvocationContent(secondDefinition, input.invocationContent)
      || definitionDigest(firstDefinition) !== definitionDigest(secondDefinition)) {
      return abstain('unstable-definition-or-bundle')
    }
    const secondBoundary = packageBoundary(secondDefinition)
    if (secondBoundary.status === 'abstained' || secondBoundary.path !== packageRoot.path) {
      return abstain('unstable-definition-or-bundle')
    }

    let secondArchive: AssembledSkillBundleArchive
    try {
      secondArchive = await scanAndAssemble(secondBoundary.path)
    } catch {
      return abstain('unstable-definition-or-bundle')
    }
    if (firstArchive.artifactDigest !== secondArchive.artifactDigest
      || firstArchive.treeHash !== secondArchive.treeHash
      || !firstArchive.content.equals(secondArchive.content)) {
      return abstain('unstable-definition-or-bundle')
    }

    const digest = definitionDigest(secondDefinition)
    const identity = {
      schemaVersion: 1,
      kind: 'installed-skill-baseline-v1',
      workspaceId: input.workspaceId,
      skillName: input.skillName,
      invocationContentHash,
      provider: secondDefinition.provider,
      source: secondDefinition.source,
      definitionDigest: digest,
      artifactDigest: secondArchive.artifactDigest,
      treeHash: secondArchive.treeHash,
    } as const
    const manifest: InstalledSkillBaselineManifest = Object.freeze({
      schemaVersion: 1,
      kind: 'installed-skill-baseline-v1',
      id: sha256Json(identity),
      workspaceId: input.workspaceId,
      skillName: input.skillName,
      invocationContentHash,
      provider: secondDefinition.provider,
      source: secondDefinition.source,
      definitionDigest: digest,
      createdAt: this.now(),
      bundle: Object.freeze({
        format: 'tar.gz',
        artifactDigest: secondArchive.artifactDigest,
        treeHash: secondArchive.treeHash,
        fileCount: secondArchive.files.length,
        totalBytes: secondArchive.totalBytes,
        hasExecutableFiles: false,
      }),
      releaseAuthority: 'none',
    })
    const stored = await persistBundle(policy, manifest, secondArchive)
    await persistInvocationReference(policy, {
      schemaVersion: 1,
      kind: 'installed-skill-invocation-baseline-v1',
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      invocationSeq: input.invocationSeq,
      route: input.route,
      skillName: input.skillName,
      invocationContentHash,
      baselineId: stored.id,
    })
    return Object.freeze({ status: 'sealed', baseline: stored })
  }

  async resolveInvocation(
    workspaceId: string,
    sessionId: string,
    invocationSeq: number,
  ): Promise<ResolvedInstalledSkillBaseline | undefined> {
    const policy = this.policies.get(workspaceId)
    if (policy === undefined) return undefined
    const reference = await readOptionalJson(invocationPath(policy, workspaceId, sessionId, invocationSeq))
    if (reference === undefined) return undefined
    const parsedReference = parseReference(reference)
    if (parsedReference.workspaceId !== workspaceId
      || parsedReference.sessionId !== sessionId
      || parsedReference.invocationSeq !== invocationSeq) {
      throw new Error('installed Skill invocation reference identity does not match its address')
    }
    const resolved = await readAndVerifyBundle(policy, parsedReference.baselineId)
    if (resolved.manifest.workspaceId !== workspaceId
      || resolved.manifest.skillName !== parsedReference.skillName
      || resolved.manifest.invocationContentHash !== parsedReference.invocationContentHash) {
      throw new Error('installed Skill invocation reference does not match its baseline')
    }
    return Object.freeze({
      reference: parsedReference,
      manifest: resolved.manifest,
      files: resolved.files,
    })
  }
}

function lookupOptions(input: InstalledSkillInvocationCapture): SkillViewOptions {
  return {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  }
}

function assertInvocationIdentity(input: InstalledSkillInvocationCapture): void {
  if (!WORKSPACE_ID.test(input.workspaceId)
    || input.sessionId.length === 0
    || !Number.isSafeInteger(input.invocationSeq)
    || input.invocationSeq < 0
    || !['model-tool', 'user-explicit'].includes(input.route)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.skillName)
    || !Array.isArray(input.invocationContent)) {
    throw new Error('installed Skill invocation has an invalid identity')
  }
}

function matchesInvocationContent(
  definition: SkillDefinition,
  actual: readonly unknown[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify([{
    type: 'text',
    text: renderSkillContent(definition),
  }])
}

function packageBoundary(
  definition: SkillDefinition,
): { status: 'ready'; path: string } | InstalledSkillBaselineAbstention {
  if (definition.resourceBase?.kind !== 'directory') {
    return abstain('provider-not-sealable')
  }
  const root = resolve(definition.resourceBase.path)
  if (!isAbsolute(definition.resourceBase.path)
    || definition.path === undefined
    || !isAbsolute(definition.path)
    || resolve(definition.path) !== join(root, 'SKILL.md')) {
    return abstain('flat-skill-no-package-boundary')
  }
  return { status: 'ready', path: root }
}

async function scanAndAssemble(root: string): Promise<AssembledSkillBundleArchive> {
  const rootStats = await lstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('installed Skill package root is not an independent real directory')
  }
  const files: SkillBundleArchiveFile[] = []
  let totalBytes = 0

  const walk = async (directory: string, prefix: readonly string[]): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const stats = await lstat(path)
      if (stats.isSymbolicLink()) throw new Error('installed Skill package contains a symlink')
      if (stats.isDirectory()) {
        await walk(path, [...prefix, entry.name])
        continue
      }
      if (!stats.isFile()) throw new Error('installed Skill package contains a special entry')
      if ((stats.mode & 0o111) !== 0) throw new Error('installed Skill package contains executable content')
      if (files.length >= SKILL_BUNDLE_ARCHIVE_LIMITS.maxFiles
        || stats.size > SKILL_BUNDLE_ARCHIVE_LIMITS.maxFileBytes
        || totalBytes + stats.size > SKILL_BUNDLE_ARCHIVE_LIMITS.maxTotalBytes) {
        throw new Error('installed Skill package exceeds the sealing budget')
      }
      const content = await readFile(path)
      const after = await lstat(path)
      if (!sameFileSnapshot(stats, after) || content.byteLength !== stats.size) {
        throw new Error('installed Skill package changed while it was read')
      }
      totalBytes += content.byteLength
      files.push(Object.freeze({
        path: [...prefix, entry.name].join('/'),
        mode: '100644',
        content,
      }))
    }
  }
  await walk(root, [])
  return assembleSealedSkillBundleArchive(files)
}

function sameFileSnapshot(
  first: Awaited<ReturnType<typeof lstat>>,
  second: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return first.isFile()
    && second.isFile()
    && first.dev === second.dev
    && first.ino === second.ino
    && first.mode === second.mode
    && first.size === second.size
    && first.mtimeMs === second.mtimeMs
    && first.ctimeMs === second.ctimeMs
}

function definitionDigest(definition: SkillDefinition): string {
  return sha256Json([
    definition.name,
    definition.description,
    definition.whenToUse ?? null,
    definition.invocation,
    definition.source,
    definition.provider,
    definition.resourceBase ?? null,
    definition.path ?? null,
    definition.metadata ?? null,
    definition.content,
  ])
}

async function persistBundle(
  policy: InstalledSkillBaselinePolicy,
  manifest: InstalledSkillBaselineManifest,
  archive: AssembledSkillBundleArchive,
): Promise<InstalledSkillBaselineManifest> {
  const bundlesRoot = join(policy.governanceRoot, STORE_DIRECTORY, 'bundles')
  const target = join(bundlesRoot, manifest.id)
  await mkdir(bundlesRoot, { recursive: true })
  if (await exists(target)) {
    const existing = await readAndVerifyBundle(policy, manifest.id)
    assertSameBaseline(existing.manifest, manifest)
    return existing.manifest
  }

  const stage = await mkdtemp(join(bundlesRoot, `.stage-${randomUUID()}-`))
  try {
    await writeDurableBytes(join(stage, 'bundle.tar.gz'), archive.content)
    await writeDurableJson(join(stage, 'manifest.json'), manifest)
    try {
      await rename(stage, target)
      await syncDirectory(bundlesRoot)
    } catch (error) {
      if (!isAlreadyExists(error) || !await exists(target)) throw error
      await rm(stage, { force: true, recursive: true })
    }
    const stored = await readAndVerifyBundle(policy, manifest.id)
    assertSameBaseline(stored.manifest, manifest)
    return stored.manifest
  } catch (error) {
    if (await exists(stage)) await rm(stage, { force: true, recursive: true })
    throw error
  }
}

async function persistInvocationReference(
  policy: InstalledSkillBaselinePolicy,
  reference: InstalledSkillInvocationReference,
): Promise<void> {
  const path = invocationPath(
    policy,
    reference.workspaceId,
    reference.sessionId,
    reference.invocationSeq,
  )
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeExclusiveJson(path, reference)
    await syncDirectory(dirname(path))
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const existing = parseReference(await readJson(path))
    if (JSON.stringify(existing) !== JSON.stringify(reference)) {
      throw new Error('installed Skill invocation already maps to a different baseline')
    }
  }
}

async function readAndVerifyBundle(
  policy: InstalledSkillBaselinePolicy,
  baselineId: string,
): Promise<{ manifest: InstalledSkillBaselineManifest; files: readonly SkillBundleArchiveFile[] }> {
  if (!SHA256.test(baselineId)) throw new Error('installed Skill baseline id is invalid')
  const root = join(policy.governanceRoot, STORE_DIRECTORY, 'bundles', baselineId)
  const manifest = parseManifest(await readJson(join(root, 'manifest.json')))
  if (manifest.id !== baselineId || manifest.workspaceId !== policy.workspaceId) {
    throw new Error('installed Skill baseline manifest identity does not match its address')
  }
  const expectedId = baselineIdFor(manifest)
  if (expectedId !== manifest.id) throw new Error('installed Skill baseline content identity is invalid')
  const content = await readFile(join(root, 'bundle.tar.gz'))
  if (sha256(content) !== manifest.bundle.artifactDigest) {
    throw new Error('installed Skill baseline archive digest is invalid')
  }
  const decoded = await decodeSkillBundleArchive(content)
  if (decoded.treeHash !== manifest.bundle.treeHash
    || decoded.files.length !== manifest.bundle.fileCount
    || decoded.totalBytes !== manifest.bundle.totalBytes) {
    throw new Error('installed Skill baseline archive does not match its manifest')
  }
  return { manifest, files: decoded.files }
}

function baselineIdFor(manifest: InstalledSkillBaselineManifest): string {
  return sha256Json({
    schemaVersion: 1,
    kind: 'installed-skill-baseline-v1',
    workspaceId: manifest.workspaceId,
    skillName: manifest.skillName,
    invocationContentHash: manifest.invocationContentHash,
    provider: manifest.provider,
    source: manifest.source,
    definitionDigest: manifest.definitionDigest,
    artifactDigest: manifest.bundle.artifactDigest,
    treeHash: manifest.bundle.treeHash,
  })
}

function assertSameBaseline(
  actual: InstalledSkillBaselineManifest,
  expected: InstalledSkillBaselineManifest,
): void {
  if (actual.id !== expected.id
    || actual.workspaceId !== expected.workspaceId
    || actual.skillName !== expected.skillName
    || actual.invocationContentHash !== expected.invocationContentHash
    || actual.provider !== expected.provider
    || actual.source !== expected.source
    || actual.definitionDigest !== expected.definitionDigest
    || JSON.stringify(actual.bundle) !== JSON.stringify(expected.bundle)
    || actual.releaseAuthority !== 'none') {
    throw new Error('installed Skill baseline address has conflicting content')
  }
}

function invocationPath(
  policy: InstalledSkillBaselinePolicy,
  workspaceId: string,
  sessionId: string,
  invocationSeq: number,
): string {
  const id = sha256Json(['installed-skill-invocation-baseline-v1', workspaceId, sessionId, invocationSeq])
  return join(policy.governanceRoot, STORE_DIRECTORY, 'invocations', `${id}.json`)
}

function parseManifest(value: unknown): InstalledSkillBaselineManifest {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'installed-skill-baseline-v1'
    || typeof value.id !== 'string'
    || typeof value.workspaceId !== 'string'
    || typeof value.skillName !== 'string'
    || typeof value.invocationContentHash !== 'string'
    || typeof value.provider !== 'string'
    || typeof value.source !== 'string'
    || typeof value.definitionDigest !== 'string'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || value.releaseAuthority !== 'none'
    || !isRecord(value.bundle)
    || value.bundle.format !== 'tar.gz'
    || typeof value.bundle.artifactDigest !== 'string'
    || typeof value.bundle.treeHash !== 'string'
    || typeof value.bundle.fileCount !== 'number'
    || typeof value.bundle.totalBytes !== 'number'
    || value.bundle.hasExecutableFiles !== false
    || !SHA256.test(value.id)
    || !SHA256.test(value.invocationContentHash)
    || !SHA256.test(value.definitionDigest)
    || !SHA256.test(value.bundle.artifactDigest)
    || !SHA256.test(value.bundle.treeHash)) {
    throw new Error('installed Skill baseline manifest has an invalid shape')
  }
  return value as unknown as InstalledSkillBaselineManifest
}

function parseReference(value: unknown): InstalledSkillInvocationReference {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== 'installed-skill-invocation-baseline-v1'
    || typeof value.workspaceId !== 'string'
    || typeof value.sessionId !== 'string'
    || typeof value.invocationSeq !== 'number'
    || !Number.isSafeInteger(value.invocationSeq)
    || value.invocationSeq < 0
    || !['model-tool', 'user-explicit'].includes(String(value.route))
    || typeof value.skillName !== 'string'
    || typeof value.invocationContentHash !== 'string'
    || typeof value.baselineId !== 'string'
    || !SHA256.test(value.invocationContentHash)
    || !SHA256.test(value.baselineId)) {
    throw new Error('installed Skill invocation reference has an invalid shape')
  }
  return value as unknown as InstalledSkillInvocationReference
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

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } catch (error) {
    if (!isRecord(error) || !['EINVAL', 'EISDIR', 'EBADF'].includes(String(error.code))) throw error
  } finally {
    await handle.close()
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`installed Skill baseline requires readable JSON at '${path}'`, { cause: error })
  }
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return undefined
    throw new Error(`installed Skill baseline requires readable JSON at '${path}'`, { cause: error })
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left)
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function abstain(reason: InstalledSkillBaselineAbstentionReason): InstalledSkillBaselineAbstention {
  return Object.freeze({ status: 'abstained', reason })
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(value))
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
}
