import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import {
  defineDomain,
  domainTable,
  type Domain,
  type DomainFacility,
} from '@deepseek-ai/dsh-storage-domain'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'

const execFile = promisify(execFileCallback)
const DEFAULT_MAX_RECORDS = 1_000
const MAX_PACKAGE_FILES = 256
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
const MAX_GIT_OUTPUT_BYTES = MAX_PACKAGE_BYTES * 2
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_NAME = SOURCE_ID
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitHashSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const sourceSchema = z.strictObject({
  id: z.string().regex(SOURCE_ID),
  kind: z.literal('local-git'),
  trust: z.literal('explicit-deployer-config'),
})
const sourceObservationSchema = z.strictObject({
  id: z.string().regex(SOURCE_ID),
  status: z.enum(['candidate', 'absent', 'invalid', 'unavailable']),
  revision: gitHashSchema.optional(),
})
const candidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: hashSchema,
  discoveredAt: safeInteger,
  gapId: hashSchema,
  workspaceId: z.uuid(),
  requestedSkill: z.string().regex(SKILL_NAME),
  description: z.string().min(1).max(2_048),
  source: sourceSchema,
  scope: z.literal('workspace'),
  version: z.strictObject({
    kind: z.literal('git-tree'),
    commit: gitHashSchema,
    treeHash: gitHashSchema,
  }),
  contentHash: hashSchema,
  package: z.strictObject({
    path: z.string().min(1).max(1_024),
    fileCount: safeInteger,
    totalBytes: safeInteger,
    hasScripts: z.boolean(),
    hasReferences: z.boolean(),
  }),
  permissions: z.strictObject({
    declared: z.boolean(),
    executableContent: z.boolean(),
    externalEffects: z.literal('unknown'),
  }),
  safety: z.strictObject({
    status: z.literal('quarantined'),
    checks: z.array(z.strictObject({
      name: z.enum(['git-object-integrity', 'regular-files-only', 'skill-identity', 'effect-review']),
      status: z.enum(['passed', 'required']),
    })).length(4),
  }),
  lifecycle: z.literal('inactive'),
  verification: z.literal('unevaluated'),
  execution: z.literal('never'),
})
const attemptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: hashSchema,
  gapId: hashSchema,
  workspaceId: z.uuid(),
  requestedSkill: z.string().regex(SKILL_NAME),
  startedAt: safeInteger,
  completedAt: safeInteger,
  status: z.enum(['candidate-found', 'abstained', 'partial']),
  candidateIds: z.array(hashSchema).max(100),
  reasons: z.array(z.enum([
    'no-trusted-sources',
    'no-exact-skill',
    'invalid-skill-package',
    'source-unavailable',
  ])).max(100),
  sources: z.array(sourceObservationSchema).max(100),
})

export type DiscoveredSkillCandidate = z.infer<typeof candidateSchema>
export type SkillDiscoveryAttempt = z.infer<typeof attemptSchema>
export type DiscoveredSkillCandidateInput = Omit<DiscoveredSkillCandidate, 'schemaVersion' | 'id'>
export type SkillDiscoveryAttemptInput = Omit<SkillDiscoveryAttempt, 'schemaVersion' | 'id'>

export interface TrustedSkillDiscoverySourceConfig {
  readonly id: string
  readonly repository: string
  readonly skillsRoot: string
}

export interface SkillDiscoveryStore {
  recordCandidate(input: DiscoveredSkillCandidateInput): Promise<{
    created: boolean
    candidate: DiscoveredSkillCandidate
  }>
  recordAttempt(input: SkillDiscoveryAttemptInput): Promise<{
    created: boolean
    attempt: SkillDiscoveryAttempt
  }>
  listCandidates(workspaceId?: string, gapId?: string): DiscoveredSkillCandidate[]
  listAttempts(workspaceId?: string, gapId?: string): SkillDiscoveryAttempt[]
  close(): Promise<void>
}

const discoveryDomainSpec = defineDomain({
  name: 'evoforge_skill_discovery',
  version: 1,
  tables: {
    candidates: domainTable<string, DiscoveredSkillCandidate>(candidateSchema),
    attempts: domainTable<string, SkillDiscoveryAttempt>(attemptSchema),
  },
})

type SkillDiscoveryDomain = Domain<typeof discoveryDomainSpec>

class DomainSkillDiscoveryStore implements SkillDiscoveryStore {
  private writeTail: Promise<void> = Promise.resolve()
  private closing?: Promise<void>
  private readonly domain: SkillDiscoveryDomain
  private readonly maxRecords: number

  constructor(domain: SkillDiscoveryDomain, maxRecords: number) {
    this.domain = domain
    this.maxRecords = maxRecords
  }

  recordCandidate(input: DiscoveredSkillCandidateInput): Promise<{
    created: boolean
    candidate: DiscoveredSkillCandidate
  }> {
    return this.enqueue(async () => {
      const id = contentId([
        input.workspaceId,
        input.gapId,
        input.source.id,
        input.version.commit,
        input.version.treeHash,
        input.contentHash,
      ])
      const table = this.domain.table('candidates')
      const existing = table.get(id)
      if (existing !== undefined) return { created: false, candidate: immutableCopy(existing) }
      const candidate = immutableCopy(candidateSchema.parse({ schemaVersion: 1, id, ...input }))
      await table.put(id, candidate)
      await evictOldest(table, this.maxRecords, row => row.discoveredAt)
      return { created: true, candidate }
    })
  }

  recordAttempt(input: SkillDiscoveryAttemptInput): Promise<{
    created: boolean
    attempt: SkillDiscoveryAttempt
  }> {
    return this.enqueue(async () => {
      const id = contentId([
        input.gapId,
        input.status,
        input.candidateIds,
        input.reasons,
        input.sources,
      ])
      const table = this.domain.table('attempts')
      const existing = table.get(id)
      if (existing !== undefined) return { created: false, attempt: immutableCopy(existing) }
      const attempt = immutableCopy(attemptSchema.parse({ schemaVersion: 1, id, ...input }))
      await table.put(id, attempt)
      await evictOldest(table, this.maxRecords, row => row.completedAt)
      return { created: true, attempt }
    })
  }

  listCandidates(workspaceId?: string, gapId?: string): DiscoveredSkillCandidate[] {
    return [...this.domain.table('candidates').entries()]
      .map(([, candidate]) => candidate)
      .filter(candidate => (workspaceId === undefined || candidate.workspaceId === workspaceId)
        && (gapId === undefined || candidate.gapId === gapId))
      .sort((left, right) => right.discoveredAt - left.discoveredAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  listAttempts(workspaceId?: string, gapId?: string): SkillDiscoveryAttempt[] {
    return [...this.domain.table('attempts').entries()]
      .map(([, attempt]) => attempt)
      .filter(attempt => (workspaceId === undefined || attempt.workspaceId === workspaceId)
        && (gapId === undefined || attempt.gapId === gapId))
      .sort((left, right) => right.completedAt - left.completedAt || left.id.localeCompare(right.id))
      .map(immutableCopy)
  }

  close(): Promise<void> {
    this.closing ??= this.writeTail.then(() => this.domain.close())
    return this.closing
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('skill discovery store is closing'))
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }
}

export async function openSkillDiscoveryStore(
  facility: DomainFacility,
  options: { maxRecords?: number } = {},
): Promise<SkillDiscoveryStore> {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('skill discovery maxRecords must be a positive integer')
  }
  return new DomainSkillDiscoveryStore(await facility.open(discoveryDomainSpec), maxRecords)
}

interface ResolvedSource {
  readonly id: string
  readonly repository: string
  readonly skillsRoot: string
}

interface GitEntry {
  readonly mode: '100644' | '100755'
  readonly object: string
  readonly size: number
  readonly relativePath: string
}

export interface SkillDiscoveryResult {
  readonly status: 'candidate-found' | 'abstained' | 'partial'
  readonly candidateCount: number
  readonly reasons?: readonly SkillDiscoveryAttempt['reasons'][number][]
}

export interface MaterializedSkillCandidate {
  readonly candidateId: string
  readonly path: string
  readonly contentHash: string
  readonly treeHash: string
}

export interface TrustedSkillDiscoveryLoop {
  observe(gap: CapabilityGap): void
  flush(): Promise<void>
  dispose(): Promise<void>
}

/** Exact-name acquisition from deployer-trusted local Git mirrors; never a task router. */
export class TrustedSkillDiscovery {
  private readonly sources: readonly ResolvedSource[]
  private readonly store: Pick<SkillDiscoveryStore, 'recordCandidate' | 'recordAttempt'>
  private readonly now: () => number

  constructor(
    sources: readonly TrustedSkillDiscoverySourceConfig[],
    store: Pick<SkillDiscoveryStore, 'recordCandidate' | 'recordAttempt'>,
    options: { now?: () => number } = {},
  ) {
    this.sources = resolveSources(sources)
    this.store = store
    this.now = options.now ?? Date.now
  }

  async discover(gap: CapabilityGap): Promise<SkillDiscoveryResult> {
    const startedAt = this.now()
    const candidateIds: string[] = []
    const reasons: SkillDiscoveryAttempt['reasons'][number][] = []
    const sourceObservations: SkillDiscoveryAttempt['sources'][number][] = []

    if (this.sources.length === 0) reasons.push('no-trusted-sources')
    for (const source of this.sources) {
      const inspected: Awaited<ReturnType<typeof inspectSource>> = await inspectSource(source, gap).catch(() => ({
        status: 'unavailable' as const,
      }))
      if (inspected.status === 'candidate') {
        const recorded = await this.store.recordCandidate({
          discoveredAt: startedAt,
          gapId: gap.id,
          workspaceId: gap.workspaceId,
          requestedSkill: gap.requestedSkill,
          ...inspected.candidate,
        })
        candidateIds.push(recorded.candidate.id)
        sourceObservations.push({ id: source.id, status: 'candidate', revision: inspected.revision })
      } else {
        sourceObservations.push({
          id: source.id,
          status: inspected.status,
          ...(inspected.revision === undefined ? {} : { revision: inspected.revision }),
        })
        reasons.push(inspected.status === 'absent'
          ? 'no-exact-skill'
          : inspected.status === 'invalid' ? 'invalid-skill-package' : 'source-unavailable')
      }
    }
    const uniqueReasons = [...new Set(reasons)]
    const status = candidateIds.length === 0
      ? 'abstained' as const
      : uniqueReasons.length === 0 ? 'candidate-found' as const : 'partial' as const
    const completedAt = this.now()
    await this.store.recordAttempt({
      gapId: gap.id,
      workspaceId: gap.workspaceId,
      requestedSkill: gap.requestedSkill,
      startedAt,
      completedAt,
      status,
      candidateIds,
      reasons: uniqueReasons,
      sources: sourceObservations,
    })
    return {
      status,
      candidateCount: candidateIds.length,
      ...(uniqueReasons.length === 0 ? {} : { reasons: uniqueReasons }),
    }
  }

  /** Reconstruct one exact candidate from pinned Git objects into a new non-executable directory. */
  async materialize(
    input: DiscoveredSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    const candidate = candidateSchema.parse(input)
    const source = this.sources.find(item => item.id === candidate.source.id)
    if (source === undefined) throw new Error(`trusted Skill source '${candidate.source.id}' is not configured`)
    const skillPath = `${source.skillsRoot}/${candidate.requestedSkill}`
    if (candidate.package.path !== skillPath) {
      throw new Error('trusted Skill candidate package path does not match its source')
    }
    const expectedId = contentId([
      candidate.workspaceId,
      candidate.gapId,
      candidate.source.id,
      candidate.version.commit,
      candidate.version.treeHash,
      candidate.contentHash,
    ])
    if (candidate.id !== expectedId) throw new Error('trusted Skill candidate id does not match its identity')
    const repository = await realpath(source.repository)

    const treeHash = await gitText(
      repository,
      'rev-parse',
      `${candidate.version.commit}:${skillPath}`,
    )
    if (treeHash !== candidate.version.treeHash) {
      throw new Error('trusted Skill candidate tree no longer matches its pinned identity')
    }
    const entries = await listTree(repository, candidate.version.commit, skillPath)
    const contentHash = packageContentHash(entries)
    if (contentHash !== candidate.contentHash) {
      throw new Error('trusted Skill candidate content no longer matches its pinned identity')
    }
    await assertCandidatePackage(repository, candidate, entries)

    const requested = resolve(requestedOutputDir)
    if (dirname(requested) === requested) {
      throw new Error('trusted Skill candidate output must not be a filesystem root')
    }
    const parent = await realpath(dirname(requested))
    const outputDir = resolve(parent, basename(requested))
    assertSeparateMaterialization(outputDir, repository)
    await mkdir(outputDir, { mode: 0o700 })
    try {
      for (const entry of entries) {
        const target = resolve(outputDir, ...entry.relativePath.split('/'))
        assertInside(outputDir, target, 'trusted Skill candidate file')
        await mkdir(dirname(target), { mode: 0o700, recursive: true })
        const content = await gitBlob(repository, entry.object)
        if (content.byteLength !== entry.size) {
          throw new Error('trusted Skill candidate blob size does not match its Git tree')
        }
        await writeFile(target, content, { flag: 'wx', mode: 0o600 })
      }
      return Object.freeze({
        candidateId: candidate.id,
        path: outputDir,
        contentHash,
        treeHash,
      })
    } catch (error) {
      await rm(outputDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }
}

/** Resume durable gaps at startup and process new gaps without blocking their Session. */
export function installTrustedSkillDiscoveryLoop(
  ctx: Context,
  gaps: Pick<CapabilityGapStore, 'list'>,
  discovery: Pick<TrustedSkillDiscovery, 'discover'>,
): TrustedSkillDiscoveryLoop {
  const pending = new Map<string, CapabilityGap>()
  let scanAll = true
  let disposed = false
  let running: Promise<void> | undefined

  const schedule = () => {
    if (disposed || running !== undefined) return
    running = Promise.resolve().then(async () => {
      while (!disposed && (scanAll || pending.size > 0)) {
        const next = scanAll ? gaps.list() : [...pending.values()]
        scanAll = false
        pending.clear()
        for (const gap of next) {
          if (disposed) return
          try {
            await discovery.discover(gap)
          } catch (error) {
            ctx.logger.warn(`dsh-evolve skipped one trusted Skill discovery: ${errorMessage(error)}`)
          }
        }
      }
    }).finally(() => {
      running = undefined
      if (!disposed && (scanAll || pending.size > 0)) schedule()
    })
  }
  schedule()

  return {
    observe(gap) {
      if (disposed) return
      pending.set(gap.id, gap)
      schedule()
    },
    async flush() {
      while (running !== undefined) await running
    },
    async dispose() {
      disposed = true
      await running
      pending.clear()
    },
  }
}

async function inspectSource(source: ResolvedSource, gap: CapabilityGap): Promise<{
  readonly status: 'candidate'
  readonly revision: string
  readonly candidate: Omit<DiscoveredSkillCandidateInput,
    'discoveredAt' | 'gapId' | 'workspaceId' | 'requestedSkill'>
} | {
  readonly status: 'absent' | 'invalid' | 'unavailable'
  readonly revision?: string
}> {
  let revision: string
  try {
    revision = await gitText(source.repository, 'rev-parse', '--verify', 'HEAD^{commit}')
  } catch {
    return { status: 'unavailable' }
  }
  const skillPath = `${source.skillsRoot}/${gap.requestedSkill}`
  if (!await gitObjectExists(source.repository, `${revision}:${skillPath}`)) {
    return { status: 'absent', revision }
  }
  try {
    const treeHash = await gitText(source.repository, 'rev-parse', `${revision}:${skillPath}`)
    const entries = await listTree(source.repository, revision, skillPath)
    const skillEntry = entries.find(entry => entry.relativePath === 'SKILL.md')
    if (skillEntry === undefined) return { status: 'invalid', revision }
    const skill = parseSkillHeader(await gitBlobText(source.repository, skillEntry.object))
    if (skill.name !== gap.requestedSkill) return { status: 'invalid', revision }
    const hasScripts = entries.some(entry => entry.relativePath === 'scripts'
      || entry.relativePath.startsWith('scripts/'))
    const hasReferences = entries.some(entry => entry.relativePath === 'references'
      || entry.relativePath.startsWith('references/'))
    const executableContent = hasScripts || entries.some(entry => entry.mode === '100755')
    return {
      status: 'candidate',
      revision,
      candidate: {
        description: skill.description,
        source: {
          id: source.id,
          kind: 'local-git',
          trust: 'explicit-deployer-config',
        },
        scope: 'workspace',
        version: { kind: 'git-tree', commit: revision, treeHash },
        contentHash: packageContentHash(entries),
        package: {
          path: skillPath,
          fileCount: entries.length,
          totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
          hasScripts,
          hasReferences,
        },
        permissions: {
          declared: skill.permissionsDeclared,
          executableContent,
          externalEffects: 'unknown',
        },
        safety: {
          status: 'quarantined',
          checks: [
            { name: 'git-object-integrity', status: 'passed' },
            { name: 'regular-files-only', status: 'passed' },
            { name: 'skill-identity', status: 'passed' },
            { name: 'effect-review', status: 'required' },
          ],
        },
        lifecycle: 'inactive',
        verification: 'unevaluated',
        execution: 'never',
      },
    }
  } catch {
    return { status: 'invalid', revision }
  }
}

function resolveSources(input: readonly TrustedSkillDiscoverySourceConfig[]): ResolvedSource[] {
  const seen = new Set<string>()
  return input.map((source) => {
    const id = source.id.trim()
    if (!SOURCE_ID.test(id)) throw new Error(`invalid trusted discovery source id '${source.id}'`)
    if (seen.has(id)) throw new Error(`duplicate trusted discovery source '${id}'`)
    seen.add(id)
    const repository = resolve(source.repository)
    if (dirname(repository) === repository) {
      throw new Error(`trusted discovery repository for '${id}' must not be a filesystem root`)
    }
    return { id, repository, skillsRoot: normalizeGitPath(source.skillsRoot) }
  })
}

async function listTree(repository: string, commit: string, sourcePath: string): Promise<GitEntry[]> {
  const { stdout } = await execFile(
    'git',
    ['-C', repository, 'ls-tree', '-l', '-r', '-z', commit, '--', sourcePath],
    { encoding: 'buffer', maxBuffer: MAX_GIT_OUTPUT_BYTES },
  )
  const records = Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean)
  if (records.length === 0 || records.length > MAX_PACKAGE_FILES) {
    throw new Error('trusted Skill package has an invalid file count')
  }
  const entries = records.map((record): GitEntry => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(record)
    if (match === null) throw new Error('unsupported git tree record')
    const [, rawMode, type, object, rawSize, path] = match
    if ((rawMode !== '100644' && rawMode !== '100755')
      || type !== 'blob'
      || object === undefined
      || rawSize === undefined
      || path === undefined) {
      throw new Error('trusted Skill package contains a non-regular file')
    }
    const relativePath = relativeGitPath(sourcePath, path)
    return {
      mode: rawMode,
      object,
      size: Number(rawSize),
      relativePath,
    }
  }).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  const total = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (total > MAX_PACKAGE_BYTES) throw new Error('trusted Skill package exceeds the byte limit')
  return entries
}

function parseSkillHeader(raw: string): {
  readonly name: string
  readonly description: string
  readonly permissionsDeclared: boolean
} {
  const normalized = raw.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) throw new Error('Skill is missing YAML frontmatter')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('Skill has unterminated YAML frontmatter')
  const parsed = parseYaml(normalized.slice(4, end)) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Skill frontmatter must be an object')
  }
  const data = parsed as Readonly<Record<string, unknown>>
  if (typeof data.name !== 'string' || !SKILL_NAME.test(data.name)) {
    throw new Error('Skill has an invalid name')
  }
  if (typeof data.description !== 'string' || data.description.trim().length === 0) {
    throw new Error('Skill has an invalid description')
  }
  return {
    name: data.name,
    description: data.description.trim(),
    permissionsDeclared: Object.hasOwn(data, 'permissions'),
  }
}

async function gitText(repository: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function gitBlobText(repository: string, object: string): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repository, 'cat-file', 'blob', object], {
    encoding: 'utf8',
    maxBuffer: MAX_PACKAGE_BYTES + 1,
  })
  return stdout
}

async function gitBlob(repository: string, object: string): Promise<Buffer> {
  const { stdout } = await execFile('git', ['-C', repository, 'cat-file', 'blob', object], {
    encoding: 'buffer',
    maxBuffer: MAX_PACKAGE_BYTES + 1,
  })
  return Buffer.from(stdout)
}

async function gitObjectExists(repository: string, object: string): Promise<boolean> {
  try {
    await execFile('git', ['-C', repository, 'cat-file', '-e', object], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}

function normalizeGitPath(input: string): string {
  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (normalized.length === 0 || normalized === '.' || normalized.startsWith('/')
    || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`invalid trusted discovery skillsRoot '${input}'`)
  }
  return normalized
}

function relativeGitPath(sourcePath: string, path: string): string {
  const prefix = `${sourcePath}/`
  if (!path.startsWith(prefix)) throw new Error('Skill tree path escapes its root')
  const value = path.slice(prefix.length)
  if (value.length === 0 || value === '..' || value.startsWith('../') || value.includes('/../')) {
    throw new Error('Skill tree path is not contained')
  }
  const resolved = resolve('/candidate', ...value.split('/'))
  const relativePath = relative('/candidate', resolved)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Skill tree path is not contained')
  }
  return value
}

function packageContentHash(entries: readonly GitEntry[]): string {
  return contentId(entries.map(entry => [
    entry.relativePath,
    entry.mode,
    entry.object,
    entry.size,
  ]))
}

async function assertCandidatePackage(
  repository: string,
  candidate: DiscoveredSkillCandidate,
  entries: readonly GitEntry[],
): Promise<void> {
  const fileCount = entries.length
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0)
  const hasScripts = entries.some(entry => entry.relativePath === 'scripts'
    || entry.relativePath.startsWith('scripts/'))
  const hasReferences = entries.some(entry => entry.relativePath === 'references'
    || entry.relativePath.startsWith('references/'))
  const executableContent = hasScripts || entries.some(entry => entry.mode === '100755')
  if (candidate.package.fileCount !== fileCount
    || candidate.package.totalBytes !== totalBytes
    || candidate.package.hasScripts !== hasScripts
    || candidate.package.hasReferences !== hasReferences
    || candidate.permissions.executableContent !== executableContent) {
    throw new Error('trusted Skill candidate package metadata does not match its pinned tree')
  }
  const skillEntry = entries.find(entry => entry.relativePath === 'SKILL.md')
  if (skillEntry === undefined) throw new Error('trusted Skill candidate has no SKILL.md')
  const skill = parseSkillHeader(await gitBlobText(repository, skillEntry.object))
  if (skill.name !== candidate.requestedSkill
    || skill.description !== candidate.description
    || skill.permissionsDeclared !== candidate.permissions.declared) {
    throw new Error('trusted Skill candidate metadata does not match its SKILL.md')
  }
}

function assertSeparateMaterialization(outputDir: string, repository: string): void {
  const source = resolve(repository)
  if (contains(source, outputDir) || contains(outputDir, source)) {
    throw new Error('trusted Skill candidate output and source repository must be separate')
  }
}

function assertInside(root: string, path: string, label: string): void {
  if (!contains(root, path) || root === path) throw new Error(`${label} escapes its output root`)
}

function contains(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

async function evictOldest<T>(
  table: {
    readonly size: number
    entries(): IterableIterator<[string, T]>
    delete(key: string): Promise<unknown>
  },
  maxRecords: number,
  timestamp: (row: T) => number,
): Promise<void> {
  if (table.size <= maxRecords) return
  const expired = [...table.entries()]
    .sort((left, right) => timestamp(left[1]) - timestamp(right[1]) || left[0].localeCompare(right[0]))
    .slice(0, table.size - maxRecords)
  for (const [id] of expired) await table.delete(id)
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
