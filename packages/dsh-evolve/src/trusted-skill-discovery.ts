import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
import {
  decodeAgentSkillArchive,
  type AgentSkillArchiveFile,
  type AgentSkillArchiveFormat,
} from './agent-skill-archive.ts'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'

const execFile = promisify(execFileCallback)
const DEFAULT_MAX_RECORDS = 1_000
const MAX_PACKAGE_FILES = 256
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
const MAX_GIT_OUTPUT_BYTES = MAX_PACKAGE_BYTES * 2
const MAX_CATALOG_SKILLS = 512
const MAX_SKILL_HEADER_BYTES = 64 * 1024
const MAX_DISCOVERY_INDEX_BYTES = 1024 * 1024
const MAX_DISCOVERY_REDIRECTS = 3
const DISCOVERY_FETCH_TIMEOUT_MS = 10_000
const MAX_ARCHIVE_BASE64_BYTES = Math.ceil(MAX_PACKAGE_BYTES / 3) * 4
const AGENT_SKILLS_INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
const SEMANTIC_MIN_SCORE = 8
const SEMANTIC_MARGIN_PERCENT = 125
const SEMANTIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it',
  'of', 'on', 'or', 'the', 'this', 'to', 'use', 'using', 'with', 'without',
  'dsh', 'skill', 'skills', 'plugin', 'plugins', 'native',
])
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILL_NAME = SOURCE_ID
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const gitHashSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const sourceSchema = z.union([
  z.strictObject({
    id: z.string().regex(SOURCE_ID),
    kind: z.literal('local-git'),
    trust: z.literal('explicit-deployer-config'),
  }),
  z.strictObject({
    id: z.string().regex(SOURCE_ID),
    kind: z.literal('agent-skills-index'),
    trust: z.literal('explicit-deployer-config'),
    origin: z.url().max(2_048),
  }),
  z.strictObject({
    id: z.string().regex(SOURCE_ID),
    kind: z.literal('slow-loop-author'),
    trust: z.literal('bounded-host-authoring'),
  }),
])
const sourceObservationSchema = z.strictObject({
  id: z.string().regex(SOURCE_ID),
  status: z.enum([
    'candidate',
    'absent',
    'no-match',
    'ambiguous',
    'invalid',
    'unavailable',
    'unsupported-schema',
    'unsupported-artifact',
    'untrusted-origin',
    'digest-mismatch',
  ]),
  revision: gitHashSchema.optional(),
})
const versionSchema = z.union([
  z.strictObject({
    kind: z.literal('git-tree'),
    commit: gitHashSchema,
    treeHash: gitHashSchema,
  }),
  z.strictObject({
    kind: z.literal('agent-skills-index-v0.2'),
    indexDigest: hashSchema,
    artifactDigest: hashSchema,
    treeHash: hashSchema,
  }),
  z.strictObject({
    kind: z.literal('slow-loop-author-v1'),
    modelIdentityHash: hashSchema,
    inputDigest: hashSchema,
    artifactDigest: hashSchema,
    treeHash: hashSchema,
  }),
])
const candidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: hashSchema,
  discoveredAt: safeInteger,
  gapId: hashSchema,
  workspaceId: z.uuid(),
  requestedSkill: z.string().regex(SKILL_NAME),
  description: z.string().min(1).max(2_048),
  demand: z.strictObject({
    kind: z.literal('cross-goal-cluster-v1'),
    clusterId: hashSchema,
    gapIds: z.array(hashSchema).min(2).max(1_000),
    goalCount: safeInteger.min(2).max(1_000),
  }).optional(),
  match: z.strictObject({
    kind: z.literal('deterministic-lexical-v1'),
    requestedSkill: z.string().regex(SKILL_NAME),
    score: safeInteger,
    runnerUpScore: safeInteger,
    queryHash: hashSchema,
  }).optional(),
  source: sourceSchema,
  scope: z.literal('workspace'),
  version: versionSchema,
  distribution: z.union([
    z.strictObject({ kind: z.literal('skill-md') }),
    z.strictObject({
      kind: z.literal('archive'),
      format: z.enum(['tar.gz', 'zip']),
    }),
  ]).optional(),
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
  license: z.union([
    z.strictObject({ status: z.literal('declared'), value: z.string().min(1).max(256) }),
    z.strictObject({ status: z.literal('unknown') }),
  ]).optional(),
  safety: z.strictObject({
    status: z.literal('quarantined'),
    checks: z.array(z.strictObject({
      name: z.enum([
        'git-object-integrity',
        'artifact-digest-integrity',
        'regular-files-only',
        'skill-identity',
        'effect-review',
      ]),
      status: z.enum(['passed', 'required']),
    })).length(4),
  }),
  artifact: z.union([
    z.strictObject({
      kind: z.literal('skill-md'),
      content: z.string().min(1).max(MAX_SKILL_HEADER_BYTES),
    }),
    z.strictObject({
      kind: z.literal('archive'),
      format: z.enum(['tar.gz', 'zip']),
      contentBase64: z.string().base64().min(1).max(MAX_ARCHIVE_BASE64_BYTES),
    }),
  ]).optional(),
  lifecycle: z.literal('inactive'),
  verification: z.literal('unevaluated'),
  execution: z.literal('never'),
}).superRefine((candidate, context) => {
  if (candidate.source.kind === 'local-git') {
    if (candidate.version.kind !== 'git-tree'
      || candidate.artifact !== undefined
      || candidate.distribution !== undefined
      || candidate.demand !== undefined) {
      context.addIssue({ code: 'custom', message: 'local Git candidate has inconsistent provenance' })
    }
    return
  }
  if (candidate.source.kind === 'slow-loop-author') {
    if (candidate.version.kind !== 'slow-loop-author-v1'
      || candidate.artifact?.kind !== 'skill-md'
      || candidate.distribution?.kind !== 'skill-md'
      || candidate.demand === undefined
      || candidate.gapId !== candidate.demand.gapIds[0]
      || new Set(candidate.demand.gapIds).size !== candidate.demand.gapIds.length) {
      context.addIssue({ code: 'custom', message: 'slow-loop authored candidate has inconsistent provenance' })
    }
    return
  }
  if (candidate.version.kind !== 'agent-skills-index-v0.2'
    || candidate.artifact === undefined
    || candidate.demand !== undefined) {
    context.addIssue({ code: 'custom', message: 'Agent Skills candidate has inconsistent provenance' })
    return
  }
  if (candidate.distribution === undefined) return // Backward-compatible V4-4 durable record.
  if (candidate.artifact.kind !== candidate.distribution.kind
    || (candidate.artifact.kind === 'archive'
      && candidate.distribution.kind === 'archive'
      && candidate.artifact.format !== candidate.distribution.format)) {
    context.addIssue({ code: 'custom', message: 'Agent Skills candidate distribution does not match its artifact' })
  }
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
    'no-semantic-match',
    'ambiguous-semantic-match',
    'invalid-skill-package',
    'source-unavailable',
    'unsupported-index-schema',
    'unsupported-artifact-type',
    'untrusted-artifact-origin',
    'artifact-digest-mismatch',
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

export interface AgentSkillsIndexSourceConfig {
  readonly id: string
  readonly indexUrl: string
}

/** Private authoring handoff; raw generated content never enters the Web projection. */
export interface AuthoredSkillCandidateInput {
  readonly discoveredAt: number
  readonly workspaceId: string
  readonly requestedSkill: string
  readonly sourceId: string
  readonly clusterId: string
  readonly gapIds: readonly string[]
  readonly goalCount: number
  readonly modelIdentity: string
  readonly inputDigest: string
  readonly skillMd: string
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
        ...versionIdentity(input.version),
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

interface ResolvedAgentSkillsIndexSource {
  readonly id: string
  readonly indexUrl: URL
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
  readonly files: readonly {
    readonly path: string
    readonly mode: '100644' | '100755'
    readonly size: number
  }[]
}

export interface TrustedSkillDiscoveryLoop {
  observe(gap: CapabilityGap): void
  flush(): Promise<void>
  dispose(): Promise<void>
}

/** Exact-first deterministic acquisition from explicitly trusted sources; never a task router. */
export class TrustedSkillDiscovery {
  private readonly sources: readonly ResolvedSource[]
  private readonly indexSources: readonly ResolvedAgentSkillsIndexSource[]
  private readonly store: Pick<SkillDiscoveryStore, 'recordCandidate' | 'recordAttempt'>
  private readonly now: () => number
  private readonly onCandidate: ((candidate: DiscoveredSkillCandidate) => void) | undefined
  private readonly settledGapIds = new Set<string>()

  constructor(
    sources: readonly TrustedSkillDiscoverySourceConfig[],
    store: Pick<SkillDiscoveryStore, 'recordCandidate' | 'recordAttempt'>,
    options: {
      now?: () => number
      onCandidate?: (candidate: DiscoveredSkillCandidate) => void
      agentSkillIndexes?: readonly AgentSkillsIndexSourceConfig[]
    } = {},
  ) {
    const sourceIds = new Set<string>()
    this.sources = resolveSources(sources, sourceIds)
    this.indexSources = resolveAgentSkillsIndexSources(options.agentSkillIndexes ?? [], sourceIds)
    this.store = store
    this.now = options.now ?? Date.now
    this.onCandidate = options.onCandidate
  }

  async discover(gap: CapabilityGap): Promise<SkillDiscoveryResult> {
    const startedAt = this.now()
    const candidateIds: string[] = []
    const reasons: SkillDiscoveryAttempt['reasons'][number][] = []
    const sourceObservations: SkillDiscoveryAttempt['sources'][number][] = []

    if (this.sources.length === 0 && this.indexSources.length === 0) reasons.push('no-trusted-sources')
    for (const source of this.sources) {
      const inspected: Awaited<ReturnType<typeof inspectSource>> = await inspectSource(source, gap).catch(() => ({
        status: 'unavailable' as const,
      }))
      if (inspected.status === 'candidate') {
        const recorded = await this.store.recordCandidate({
          discoveredAt: startedAt,
          gapId: gap.id,
          workspaceId: gap.workspaceId,
          requestedSkill: inspected.skillName,
          ...inspected.candidate,
        })
        this.onCandidate?.(recorded.candidate)
        candidateIds.push(recorded.candidate.id)
        sourceObservations.push({ id: source.id, status: 'candidate', revision: inspected.revision })
      } else {
        sourceObservations.push({
          id: source.id,
          status: inspected.status,
          ...(inspected.revision === undefined ? {} : { revision: inspected.revision }),
        })
        reasons.push(discoveryReason(inspected.status))
      }
    }
    for (const source of this.indexSources) {
      const inspected: Awaited<ReturnType<typeof inspectAgentSkillsIndex>> =
        await inspectAgentSkillsIndex(source, gap).catch(() => ({ status: 'unavailable' as const }))
      if (inspected.status === 'candidate') {
        const recorded = await this.store.recordCandidate({
          discoveredAt: startedAt,
          gapId: gap.id,
          workspaceId: gap.workspaceId,
          requestedSkill: inspected.skillName,
          ...inspected.candidate,
        })
        this.onCandidate?.(recorded.candidate)
        candidateIds.push(recorded.candidate.id)
        sourceObservations.push({ id: source.id, status: 'candidate', revision: inspected.revision })
      } else {
        sourceObservations.push({
          id: source.id,
          status: inspected.status,
          ...(inspected.revision === undefined ? {} : { revision: inspected.revision }),
        })
        reasons.push(discoveryReason(inspected.status))
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
    if (uniqueReasons.includes('source-unavailable')) this.settledGapIds.delete(gap.id)
    else this.settledGapIds.add(gap.id)
    return {
      status,
      candidateCount: candidateIds.length,
      ...(uniqueReasons.length === 0 ? {} : { reasons: uniqueReasons }),
    }
  }

  /** Current-process proof that this Gap was checked against the current configured sources. */
  isSettled(gapId: string): boolean {
    return this.settledGapIds.has(gapId)
  }

  /** Validate and persist one generated SKILL.md as inactive quarantined content. */
  async quarantineAuthored(input: AuthoredSkillCandidateInput): Promise<{
    readonly created: boolean
    readonly candidate: DiscoveredSkillCandidate
  }> {
    if (!SOURCE_ID.test(input.sourceId)
      || !SKILL_NAME.test(input.requestedSkill)
      || !hashSchema.safeParse(input.clusterId).success
      || !hashSchema.safeParse(input.inputDigest).success
      || input.gapIds.length < 2
      || input.gapIds.length > 1_000
      || new Set(input.gapIds).size !== input.gapIds.length
      || input.gapIds.some(id => !hashSchema.safeParse(id).success)
      || !Number.isSafeInteger(input.goalCount)
      || input.goalCount < 2
      || input.goalCount > 1_000
      || input.modelIdentity.trim() === ''
      || Buffer.byteLength(input.modelIdentity) > 2_048) {
      throw new Error('slow-loop authored Skill provenance is invalid')
    }
    const content = Buffer.from(input.skillMd)
    if (content.byteLength === 0 || content.byteLength > MAX_SKILL_HEADER_BYTES) {
      throw new Error('slow-loop authored SKILL.md exceeds its byte limit')
    }
    const canonical = decodeCanonicalUtf8(content)
    const skill = parseSkillHeader(canonical)
    if (skill.name !== input.requestedSkill) {
      throw new Error('slow-loop authored SKILL.md name does not match its exact target')
    }
    const decoded = singleSkillPackage(content)
    const artifactDigest = sha256Bytes(content)
    const recorded = await this.store.recordCandidate({
      discoveredAt: input.discoveredAt,
      gapId: input.gapIds[0]!,
      workspaceId: input.workspaceId,
      requestedSkill: input.requestedSkill,
      description: skill.description,
      demand: {
        kind: 'cross-goal-cluster-v1',
        clusterId: input.clusterId,
        gapIds: [...input.gapIds],
        goalCount: input.goalCount,
      },
      source: {
        id: input.sourceId,
        kind: 'slow-loop-author',
        trust: 'bounded-host-authoring',
      },
      scope: 'workspace',
      version: {
        kind: 'slow-loop-author-v1',
        modelIdentityHash: sha256Bytes(Buffer.from(input.modelIdentity)),
        inputDigest: input.inputDigest,
        artifactDigest,
        treeHash: decoded.treeHash,
      },
      distribution: { kind: 'skill-md' },
      contentHash: artifactDigest,
      package: {
        path: `${input.requestedSkill}/SKILL.md`,
        fileCount: 1,
        totalBytes: decoded.totalBytes,
        hasScripts: false,
        hasReferences: false,
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
      artifact: { kind: 'skill-md', content: canonical },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    })
    this.onCandidate?.(recorded.candidate)
    return recorded
  }

  /** Reconstruct one exact candidate from pinned Git objects into a new non-executable directory. */
  async materialize(
    input: DiscoveredSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    const candidate = candidateSchema.parse(input)
    if (candidate.source.kind === 'slow-loop-author') {
      return this.materializeSlowLoopCandidate(candidate, requestedOutputDir)
    }
    if (candidate.source.kind === 'agent-skills-index') {
      return this.materializeAgentSkillsIndexCandidate(candidate, requestedOutputDir)
    }
    if (candidate.version.kind !== 'git-tree') {
      throw new Error('local Git Skill candidate has an invalid version kind')
    }
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
      ...versionIdentity(candidate.version),
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
        files: Object.freeze(entries.map(entry => Object.freeze({
          path: entry.relativePath,
          mode: entry.mode,
          size: entry.size,
        }))),
      })
    } catch (error) {
      await rm(outputDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }

  private async materializeSlowLoopCandidate(
    candidate: DiscoveredSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    if (candidate.source.kind !== 'slow-loop-author'
      || candidate.version.kind !== 'slow-loop-author-v1'
      || candidate.artifact?.kind !== 'skill-md'
      || candidate.demand === undefined) {
      throw new Error('slow-loop authored candidate has invalid pinned content')
    }
    const expectedId = contentId([
      candidate.workspaceId,
      candidate.gapId,
      candidate.source.id,
      ...versionIdentity(candidate.version),
      candidate.contentHash,
    ])
    if (candidate.id !== expectedId) throw new Error('slow-loop authored candidate id does not match its identity')
    const content = Buffer.from(candidate.artifact.content)
    const artifactDigest = sha256Bytes(content)
    const decoded = singleSkillPackage(content)
    const skill = parseSkillHeader(decodeCanonicalUtf8(content))
    if (artifactDigest !== candidate.version.artifactDigest
      || artifactDigest !== candidate.contentHash
      || decoded.treeHash !== candidate.version.treeHash
      || skill.name !== candidate.requestedSkill
      || skill.description !== candidate.description
      || candidate.package.path !== `${skill.name}/SKILL.md`
      || candidate.package.fileCount !== 1
      || candidate.package.totalBytes !== content.byteLength
      || candidate.package.hasScripts
      || candidate.package.hasReferences
      || candidate.permissions.executableContent
      || candidate.permissions.declared !== skill.permissionsDeclared) {
      throw new Error('slow-loop authored candidate metadata does not match its pinned SKILL.md')
    }
    const requested = resolve(requestedOutputDir)
    if (dirname(requested) === requested) {
      throw new Error('slow-loop authored candidate output must not be a filesystem root')
    }
    const parent = await realpath(dirname(requested))
    const outputDir = resolve(parent, basename(requested))
    await mkdir(outputDir, { mode: 0o700 })
    try {
      await writeFile(join(outputDir, 'SKILL.md'), content, { flag: 'wx', mode: 0o600 })
      return Object.freeze({
        candidateId: candidate.id,
        path: outputDir,
        contentHash: artifactDigest,
        treeHash: decoded.treeHash,
        files: Object.freeze([Object.freeze({
          path: 'SKILL.md',
          mode: '100644' as const,
          size: content.byteLength,
        })]),
      })
    } catch (error) {
      await rm(outputDir, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }

  private async materializeAgentSkillsIndexCandidate(
    candidate: DiscoveredSkillCandidate,
    requestedOutputDir: string,
  ): Promise<MaterializedSkillCandidate> {
    if (candidate.source.kind !== 'agent-skills-index'
      || candidate.version.kind !== 'agent-skills-index-v0.2'
      || candidate.artifact === undefined) {
      throw new Error('Agent Skills index candidate has an invalid pinned artifact')
    }
    const source = this.indexSources.find(item => item.id === candidate.source.id)
    if (source === undefined || source.indexUrl.origin !== candidate.source.origin) {
      throw new Error(`trusted Agent Skills index '${candidate.source.id}' is not configured`)
    }
    const expectedId = contentId([
      candidate.workspaceId,
      candidate.gapId,
      candidate.source.id,
      ...versionIdentity(candidate.version),
      candidate.contentHash,
    ])
    if (candidate.id !== expectedId) throw new Error('Agent Skills index candidate id does not match its identity')
    const content = candidate.artifact.kind === 'skill-md'
      ? Buffer.from(candidate.artifact.content)
      : Buffer.from(candidate.artifact.contentBase64, 'base64')
    const artifactDigest = sha256Bytes(content)
    const decoded = candidate.artifact.kind === 'skill-md'
      ? singleSkillPackage(content)
      : await decodeAgentSkillArchive(content, candidate.artifact.format)
    const treeHash = decoded.treeHash
    if (artifactDigest !== candidate.version.artifactDigest
      || artifactDigest !== candidate.contentHash
      || treeHash !== candidate.version.treeHash) {
      throw new Error('Agent Skills index candidate content does not match its pinned identity')
    }
    const skillFile = decoded.files.find(file => file.path === 'SKILL.md')
    if (skillFile === undefined) throw new Error('Agent Skills archive candidate has no root SKILL.md')
    const skillContent = decodeCanonicalUtf8(skillFile.content)
    const skill = parseSkillHeader(skillContent)
    const expectedLicense = skill.license === undefined
      ? { status: 'unknown' as const }
      : { status: 'declared' as const, value: skill.license }
    const expectedDistribution = candidate.artifact.kind === 'skill-md'
      ? { kind: 'skill-md' as const }
      : { kind: 'archive' as const, format: candidate.artifact.format }
    const hasScripts = packageHasDirectory(decoded.files, 'scripts')
    const hasReferences = packageHasDirectory(decoded.files, 'references')
    const executableContent = hasScripts || decoded.files.some(file => file.mode === '100755')
    const expectedPackagePath = candidate.artifact.kind === 'skill-md'
      ? `${skill.name}/SKILL.md`
      : skill.name
    if (candidate.requestedSkill !== skill.name
      || candidate.description !== skill.description
      || candidate.package.path !== expectedPackagePath
      || candidate.package.fileCount !== decoded.files.length
      || candidate.package.totalBytes !== decoded.totalBytes
      || candidate.package.hasScripts !== hasScripts
      || candidate.package.hasReferences !== hasReferences
      || candidate.permissions.executableContent !== executableContent
      || candidate.permissions.declared !== skill.permissionsDeclared
      || (candidate.distribution !== undefined
        && JSON.stringify(candidate.distribution) !== JSON.stringify(expectedDistribution))
      || JSON.stringify(candidate.license) !== JSON.stringify(expectedLicense)) {
      throw new Error('Agent Skills index candidate metadata does not match its SKILL.md')
    }

    const requested = resolve(requestedOutputDir)
    if (dirname(requested) === requested) {
      throw new Error('Agent Skills index candidate output must not be a filesystem root')
    }
    const parent = await realpath(dirname(requested))
    const outputDir = resolve(parent, basename(requested))
    await mkdir(outputDir, { mode: 0o700 })
    try {
      for (const file of decoded.files) {
        const target = resolve(outputDir, ...file.path.split('/'))
        assertInside(outputDir, target, 'Agent Skills archive candidate file')
        await mkdir(dirname(target), { mode: 0o700, recursive: true })
        await writeFile(target, file.content, { flag: 'wx', mode: 0o600 })
      }
      return Object.freeze({
        candidateId: candidate.id,
        path: outputDir,
        contentHash: artifactDigest,
        treeHash,
        files: Object.freeze(decoded.files.map(file => Object.freeze({
          path: file.path,
          mode: file.mode,
          size: file.content.byteLength,
        }))),
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
  options: {
    readonly onSettled?: (gap: CapabilityGap) => Promise<void> | void
  } = {},
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
          } finally {
            try {
              await options.onSettled?.(gap)
            } catch (error) {
              ctx.logger.warn(`dsh-evolve skipped one slow-loop Skill authoring reconciliation: ${errorMessage(error)}`)
            }
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

type InspectedCandidate = Omit<DiscoveredSkillCandidateInput,
  'discoveredAt' | 'gapId' | 'workspaceId' | 'requestedSkill'>

const agentSkillsIndexSchema = z.object({
  $schema: z.literal(AGENT_SKILLS_INDEX_SCHEMA),
  skills: z.array(z.object({
    name: z.string().regex(SKILL_NAME).max(64),
    type: z.string().min(1).max(32),
    description: z.string().min(1).max(1_024),
    url: z.string().min(1).max(2_048),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })).max(MAX_CATALOG_SKILLS),
})

type AgentSkillsIndexEntry = z.infer<typeof agentSkillsIndexSchema>['skills'][number]

async function inspectAgentSkillsIndex(
  source: ResolvedAgentSkillsIndexSource,
  gap: CapabilityGap,
): Promise<{
  readonly status: 'candidate'
  readonly revision: string
  readonly skillName: string
  readonly candidate: InspectedCandidate
} | {
  readonly status:
    | 'absent'
    | 'no-match'
    | 'ambiguous'
    | 'invalid'
    | 'unavailable'
    | 'unsupported-schema'
    | 'unsupported-artifact'
    | 'untrusted-origin'
    | 'digest-mismatch'
  readonly revision?: string
}> {
  let fetchedIndex: Awaited<ReturnType<typeof fetchBounded>>
  try {
    fetchedIndex = await fetchBounded(
      source.indexUrl,
      source.indexUrl.origin,
      MAX_DISCOVERY_INDEX_BYTES,
      ['application/json'],
    )
  } catch (error) {
    return { status: fetchFailureStatus(error) }
  }
  const indexBytes = fetchedIndex.bytes
  const revision = sha256Bytes(indexBytes)
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(indexBytes))
  } catch {
    return { status: 'invalid', revision }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)
    || (raw as Readonly<Record<string, unknown>>).$schema !== AGENT_SKILLS_INDEX_SCHEMA) {
    return { status: 'unsupported-schema', revision }
  }
  const parsed = agentSkillsIndexSchema.safeParse(raw)
  if (!parsed.success || new Set(parsed.data.skills.map(skill => skill.name)).size !== parsed.data.skills.length) {
    return { status: 'invalid', revision }
  }

  let selected = parsed.data.skills.find(skill => skill.name === gap.requestedSkill)
  let match: NonNullable<DiscoveredSkillCandidateInput['match']> | undefined
  if (selected === undefined) {
    if (gap.goal === undefined) return { status: 'absent', revision }
    const semantic = selectSemanticCandidateFromCatalog(
      parsed.data.skills.map(skill => ({ name: skill.name, description: skill.description })),
      gap.requestedSkill,
      gap.goal,
    )
    if (semantic.status !== 'selected') return { status: semantic.status, revision }
    selected = parsed.data.skills.find(skill => skill.name === semantic.skill.name)
    if (selected === undefined) return { status: 'invalid', revision }
    match = {
      kind: 'deterministic-lexical-v1',
      requestedSkill: gap.requestedSkill,
      score: semantic.score,
      runnerUpScore: semantic.runnerUpScore,
      queryHash: contentId([
        gap.requestedSkill,
        gap.goal.id,
        gap.goal.revision,
        gap.goal.objective,
      ]),
    }
  }
  if (selected.type !== 'skill-md' && selected.type !== 'archive') {
    return { status: 'unsupported-artifact', revision }
  }

  let artifactUrl: URL
  try {
    artifactUrl = new URL(selected.url, fetchedIndex.finalUrl)
  } catch {
    return { status: 'invalid', revision }
  }
  if (artifactUrl.origin !== source.indexUrl.origin
    || artifactUrl.username.length > 0
    || artifactUrl.password.length > 0) {
    return { status: 'untrusted-origin', revision }
  }
  let fetchedArtifact: Awaited<ReturnType<typeof fetchBounded>>
  try {
    fetchedArtifact = await fetchBounded(
      artifactUrl,
      source.indexUrl.origin,
      selected.type === 'skill-md' ? MAX_SKILL_HEADER_BYTES : MAX_PACKAGE_BYTES,
      selected.type === 'skill-md'
        ? ['text/markdown', 'text/plain']
        : ['application/gzip', 'application/x-gzip', 'application/zip', 'application/octet-stream'],
      selected.type === 'archive',
    )
  } catch (error) {
    return { status: fetchFailureStatus(error), revision }
  }
  const artifactBytes = fetchedArtifact.bytes
  const artifactDigest = sha256Bytes(artifactBytes)
  if (selected.digest !== `sha256:${artifactDigest}`) {
    return { status: 'digest-mismatch', revision }
  }
  let content: string
  let skill: ReturnType<typeof parseSkillHeader>
  let distribution: NonNullable<DiscoveredSkillCandidateInput['distribution']>
  let artifact: NonNullable<DiscoveredSkillCandidateInput['artifact']>
  let files: readonly AgentSkillArchiveFile[]
  let treeHash: string
  let totalBytes: number
  try {
    if (selected.type === 'skill-md') {
      content = decodeCanonicalUtf8(artifactBytes)
      const decoded = singleSkillPackage(artifactBytes)
      files = decoded.files
      treeHash = decoded.treeHash
      totalBytes = decoded.totalBytes
      distribution = { kind: 'skill-md' }
      artifact = { kind: 'skill-md', content }
    } else {
      const format = agentSkillArchiveFormat(fetchedArtifact.finalUrl, fetchedArtifact.mediaType)
      if (format === undefined) throw new Error('Agent Skills archive has an unsupported format')
      const decoded = await decodeAgentSkillArchive(artifactBytes, format)
      const skillFile = decoded.files.find(file => file.path === 'SKILL.md')
      if (skillFile === undefined) throw new Error('Agent Skills archive has no root SKILL.md')
      content = decodeCanonicalUtf8(skillFile.content)
      files = decoded.files
      treeHash = decoded.treeHash
      totalBytes = decoded.totalBytes
      distribution = { kind: 'archive', format }
      artifact = { kind: 'archive', format, contentBase64: artifactBytes.toString('base64') }
    }
    skill = parseSkillHeader(content)
  } catch {
    return { status: 'invalid', revision }
  }
  if (skill.name !== selected.name || skill.description !== selected.description) {
    return { status: 'invalid', revision }
  }
  const hasScripts = packageHasDirectory(files, 'scripts')
  const hasReferences = packageHasDirectory(files, 'references')
  const executableContent = hasScripts || files.some(file => file.mode === '100755')
  return {
    status: 'candidate',
    revision,
    skillName: skill.name,
    candidate: {
      description: skill.description,
      ...(match === undefined ? {} : { match }),
      source: {
        id: source.id,
        kind: 'agent-skills-index',
        trust: 'explicit-deployer-config',
        origin: source.indexUrl.origin,
      },
      scope: 'workspace',
      version: {
        kind: 'agent-skills-index-v0.2',
        indexDigest: revision,
        artifactDigest,
        treeHash,
      },
      distribution,
      contentHash: artifactDigest,
      package: {
        path: selected.type === 'skill-md' ? `${skill.name}/SKILL.md` : skill.name,
        fileCount: files.length,
        totalBytes,
        hasScripts,
        hasReferences,
      },
      permissions: {
        declared: skill.permissionsDeclared,
        executableContent,
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
      artifact,
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    },
  }
}

async function inspectSource(source: ResolvedSource, gap: CapabilityGap): Promise<{
  readonly status: 'candidate'
  readonly revision: string
  readonly skillName: string
  readonly candidate: InspectedCandidate
} | {
  readonly status: 'absent' | 'no-match' | 'ambiguous' | 'invalid' | 'unavailable'
  readonly revision?: string
}> {
  let revision: string
  try {
    revision = await gitText(source.repository, 'rev-parse', '--verify', 'HEAD^{commit}')
  } catch {
    return { status: 'unavailable' }
  }
  const skillPath = `${source.skillsRoot}/${gap.requestedSkill}`
  if (await gitObjectExists(source.repository, `${revision}:${skillPath}`)) {
    return inspectCandidate(source, revision, gap.requestedSkill)
  }
  if (gap.goal === undefined) return { status: 'absent', revision }
  let semantic: SemanticSelection
  try {
    semantic = await selectSemanticCandidate(
      source,
      revision,
      gap.requestedSkill,
      gap.goal,
    )
  } catch {
    return { status: 'unavailable', revision }
  }
  if (semantic.status !== 'selected') return { status: semantic.status, revision }
  return inspectCandidate(source, revision, semantic.skill.name, {
    kind: 'deterministic-lexical-v1',
    requestedSkill: gap.requestedSkill,
    score: semantic.score,
    runnerUpScore: semantic.runnerUpScore,
    queryHash: contentId([
      gap.requestedSkill,
      gap.goal.id,
      gap.goal.revision,
      gap.goal.objective,
    ]),
  })
}

async function inspectCandidate(
  source: ResolvedSource,
  revision: string,
  skillName: string,
  match?: NonNullable<DiscoveredSkillCandidateInput['match']>,
): Promise<{
  readonly status: 'candidate'
  readonly revision: string
  readonly skillName: string
  readonly candidate: InspectedCandidate
} | {
  readonly status: 'invalid'
  readonly revision: string
}> {
  const skillPath = `${source.skillsRoot}/${skillName}`
  if (!await gitObjectExists(source.repository, `${revision}:${skillPath}`)) {
    return { status: 'invalid', revision }
  }
  try {
    const treeHash = await gitText(source.repository, 'rev-parse', `${revision}:${skillPath}`)
    const entries = await listTree(source.repository, revision, skillPath)
    const skillEntry = entries.find(entry => entry.relativePath === 'SKILL.md')
    if (skillEntry === undefined) return { status: 'invalid', revision }
    const skill = parseSkillHeader(await gitBlobText(source.repository, skillEntry.object))
    if (skill.name !== skillName) return { status: 'invalid', revision }
    const hasScripts = entries.some(entry => entry.relativePath === 'scripts'
      || entry.relativePath.startsWith('scripts/'))
    const hasReferences = entries.some(entry => entry.relativePath === 'references'
      || entry.relativePath.startsWith('references/'))
    const executableContent = hasScripts || entries.some(entry => entry.mode === '100755')
    return {
      status: 'candidate',
      revision,
      skillName,
      candidate: {
        description: skill.description,
        ...(match === undefined ? {} : { match }),
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

type SemanticSelection = {
  readonly status: 'selected'
  readonly skill: CatalogSkill
  readonly score: number
  readonly runnerUpScore: number
} | {
  readonly status: 'no-match' | 'ambiguous'
}

interface CatalogSkill {
  readonly name: string
  readonly description: string
}

async function selectSemanticCandidate(
  source: ResolvedSource,
  revision: string,
  requestedSkill: string,
  goal: NonNullable<CapabilityGap['goal']>,
): Promise<SemanticSelection> {
  const catalog = await listCatalogSkills(source.repository, revision, source.skillsRoot)
  return selectSemanticCandidateFromCatalog(catalog, requestedSkill, goal)
}

function selectSemanticCandidateFromCatalog(
  catalog: readonly CatalogSkill[],
  requestedSkill: string,
  goal: NonNullable<CapabilityGap['goal']>,
): SemanticSelection {
  const requestedTerms = lexicalTerms(requestedSkill)
  const goalTerms = lexicalTerms(goal.objective)
  const ranked = catalog.map(skill => ({
    skill,
    ...semanticScore(skill, requestedTerms, goalTerms),
  })).sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
  const winner = ranked[0]
  if (winner === undefined || winner.score < SEMANTIC_MIN_SCORE
    || (winner.requestedMatches === 0 && winner.goalMatches < 2)) {
    return { status: 'no-match' }
  }
  const runnerUp = ranked[1]
  const runnerUpScore = runnerUp?.score ?? 0
  if (runnerUp !== undefined
    && runnerUp.score >= SEMANTIC_MIN_SCORE
    && (runnerUp.requestedMatches > 0 || runnerUp.goalMatches >= 2)
    && winner.score * 100 < runnerUp.score * SEMANTIC_MARGIN_PERCENT) {
    return { status: 'ambiguous' }
  }
  return {
    status: 'selected',
    skill: winner.skill,
    score: winner.score,
    runnerUpScore,
  }
}

function semanticScore(
  skill: CatalogSkill,
  requestedTerms: ReadonlySet<string>,
  goalTerms: ReadonlySet<string>,
): { readonly score: number; readonly requestedMatches: number; readonly goalMatches: number } {
  const nameTerms = lexicalTerms(skill.name)
  const descriptionTerms = lexicalTerms(skill.description)
  const candidateWeight = (term: string): number => nameTerms.has(term) ? 4 : descriptionTerms.has(term) ? 1 : 0
  let score = 0
  let requestedMatches = 0
  let goalMatches = 0
  for (const term of requestedTerms) {
    const weight = candidateWeight(term)
    if (weight === 0) continue
    requestedMatches += 1
    score += 4 * weight
  }
  for (const term of goalTerms) {
    const weight = candidateWeight(term)
    if (weight === 0) continue
    goalMatches += 1
    score += weight
  }
  return { score, requestedMatches, goalMatches }
}

function resolveSources(
  input: readonly TrustedSkillDiscoverySourceConfig[],
  seen: Set<string> = new Set<string>(),
): ResolvedSource[] {
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

function resolveAgentSkillsIndexSources(
  input: readonly AgentSkillsIndexSourceConfig[],
  seen: Set<string>,
): ResolvedAgentSkillsIndexSource[] {
  return input.map((source) => {
    const id = source.id.trim()
    if (!SOURCE_ID.test(id)) throw new Error(`invalid trusted discovery source id '${source.id}'`)
    if (seen.has(id)) throw new Error(`duplicate trusted discovery source '${id}'`)
    seen.add(id)
    let indexUrl: URL
    try {
      indexUrl = new URL(source.indexUrl)
    } catch {
      throw new Error(`trusted Agent Skills index '${id}' has an invalid URL`)
    }
    const loopback = indexUrl.hostname === '127.0.0.1'
      || indexUrl.hostname === 'localhost'
      || indexUrl.hostname === '[::1]'
    if (indexUrl.protocol !== 'https:' && !(indexUrl.protocol === 'http:' && loopback)) {
      throw new Error(`trusted Agent Skills index '${id}' must use HTTPS (plain HTTP is loopback-only)`)
    }
    if (indexUrl.username.length > 0 || indexUrl.password.length > 0) {
      throw new Error(`trusted Agent Skills index '${id}' must not contain credentials`)
    }
    if (indexUrl.pathname !== '/.well-known/agent-skills/index.json'
      || indexUrl.search.length > 0
      || indexUrl.hash.length > 0) {
      throw new Error(`trusted Agent Skills index '${id}' must use the v0.2 well-known index path`)
    }
    return { id, indexUrl }
  })
}

function discoveryReason(
  status:
    | 'absent'
    | 'no-match'
    | 'ambiguous'
    | 'invalid'
    | 'unavailable'
    | 'unsupported-schema'
    | 'unsupported-artifact'
    | 'untrusted-origin'
    | 'digest-mismatch',
): SkillDiscoveryAttempt['reasons'][number] {
  switch (status) {
    case 'absent': return 'no-exact-skill'
    case 'no-match': return 'no-semantic-match'
    case 'ambiguous': return 'ambiguous-semantic-match'
    case 'invalid': return 'invalid-skill-package'
    case 'unavailable': return 'source-unavailable'
    case 'unsupported-schema': return 'unsupported-index-schema'
    case 'unsupported-artifact': return 'unsupported-artifact-type'
    case 'untrusted-origin': return 'untrusted-artifact-origin'
    case 'digest-mismatch': return 'artifact-digest-mismatch'
  }
}

async function listCatalogSkills(
  repository: string,
  revision: string,
  skillsRoot: string,
): Promise<CatalogSkill[]> {
  const { stdout } = await execFile(
    'git',
    ['-C', repository, 'ls-tree', '-l', '-r', '-z', revision, '--', skillsRoot],
    { encoding: 'buffer', maxBuffer: MAX_GIT_OUTPUT_BYTES },
  )
  const prefix = `${skillsRoot}/`
  const headers: Array<{ readonly name: string; readonly object: string }> = []
  for (const record of Buffer.from(stdout).toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+)\t(.+)$/.exec(record)
    if (match === null) throw new Error('unsupported trusted Skill catalog tree record')
    const [, mode, type, object, rawSize, path] = match
    if (mode !== '100644' || type !== 'blob' || object === undefined
      || rawSize === undefined || path === undefined || !path.startsWith(prefix)) continue
    const parts = path.slice(prefix.length).split('/')
    if (parts.length !== 2 || parts[1] !== 'SKILL.md' || !SKILL_NAME.test(parts[0]!)) continue
    const size = Number(rawSize)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SKILL_HEADER_BYTES) continue
    headers.push({ name: parts[0]!, object })
    if (headers.length > MAX_CATALOG_SKILLS) {
      throw new Error('trusted Skill catalog exceeds the Skill limit')
    }
  }
  const catalog: CatalogSkill[] = []
  for (const header of headers.sort((left, right) => left.name.localeCompare(right.name))) {
    try {
      const skill = parseSkillHeader(await gitBlobText(repository, header.object))
      if (skill.name === header.name) catalog.push({ name: skill.name, description: skill.description })
    } catch {
      // Invalid catalog entries cannot become candidates and do not poison other trusted packages.
    }
  }
  return catalog
}

function lexicalTerms(value: string): Set<string> {
  const terms = new Set<string>()
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replaceAll('-', ' ')
  for (const raw of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/^\p{Script=Han}+$/u.test(raw)) {
      const characters = [...raw]
      if (characters.length === 1) terms.add(raw)
      else for (let index = 0; index < characters.length - 1; index += 1) {
        terms.add(`${characters[index]}${characters[index + 1]}`)
      }
      continue
    }
    if (SEMANTIC_STOP_WORDS.has(raw)) continue
    const term = normalizeEnglishTerm(raw)
    if (term.length > 1 && !SEMANTIC_STOP_WORDS.has(term)) terms.add(term)
  }
  return terms
}

function normalizeEnglishTerm(value: string): string {
  if (value.length > 5 && value.endsWith('ing')) return value.slice(0, -3)
  if (value.length > 4 && value.endsWith('ied')) return `${value.slice(0, -3)}y`
  if (value.length > 4 && value.endsWith('ed')) return value.slice(0, -2)
  if (value.length > 4 && value.endsWith('es')) return value.slice(0, -2)
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1)
  return value
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
  readonly license?: string
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
  if (typeof data.description !== 'string' || data.description.trim().length === 0
    || data.description.trim().length > 2_048) {
    throw new Error('Skill has an invalid description')
  }
  if (data.license !== undefined && (typeof data.license !== 'string'
    || data.license.trim().length === 0
    || data.license.trim().length > 256)) {
    throw new Error('Skill has an invalid license')
  }
  return {
    name: data.name,
    description: data.description.trim(),
    permissionsDeclared: Object.hasOwn(data, 'permissions') || Object.hasOwn(data, 'allowed-tools'),
    ...(typeof data.license === 'string' ? { license: data.license.trim() } : {}),
  }
}

class DiscoveryFetchError extends Error {
  readonly status: 'unavailable' | 'untrusted-origin'

  constructor(status: 'unavailable' | 'untrusted-origin', message: string) {
    super(message)
    this.status = status
  }
}

async function fetchBounded(
  initialUrl: URL,
  expectedOrigin: string,
  maxBytes: number,
  acceptedMediaTypes: readonly string[],
  allowMissingMediaType = false,
): Promise<{ readonly bytes: Buffer; readonly finalUrl: URL; readonly mediaType?: string }> {
  let current = new URL(initialUrl)
  for (let redirects = 0; redirects <= MAX_DISCOVERY_REDIRECTS; redirects += 1) {
    let response: Response
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(DISCOVERY_FETCH_TIMEOUT_MS),
        headers: { accept: acceptedMediaTypes.join(', ') },
      })
    } catch {
      throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills endpoint is unavailable')
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null || redirects === MAX_DISCOVERY_REDIRECTS) {
        throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills endpoint has an invalid redirect')
      }
      const next = new URL(location, current)
      if (next.origin !== expectedOrigin || next.username.length > 0 || next.password.length > 0) {
        throw new DiscoveryFetchError('untrusted-origin', 'trusted Agent Skills endpoint redirected across origins')
      }
      current = next
      continue
    }
    if (!response.ok || response.body === null) {
      throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills endpoint returned an error')
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if ((mediaType === undefined && !allowMissingMediaType)
      || (mediaType !== undefined && !acceptedMediaTypes.includes(mediaType))) {
      await response.body.cancel().catch(() => undefined)
      throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills endpoint returned an invalid media type')
    }
    const contentLength = response.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      await response.body.cancel().catch(() => undefined)
      throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills artifact exceeds the byte limit')
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined)
          throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills artifact exceeds the byte limit')
        }
        chunks.push(Buffer.from(next.value))
      }
    } finally {
      reader.releaseLock()
    }
    if (total === 0) throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills artifact is empty')
    return {
      bytes: Buffer.concat(chunks, total),
      finalUrl: current,
      ...(mediaType === undefined ? {} : { mediaType }),
    }
  }
  throw new DiscoveryFetchError('unavailable', 'trusted Agent Skills endpoint exceeded its redirect limit')
}

function fetchFailureStatus(error: unknown): 'unavailable' | 'untrusted-origin' {
  return error instanceof DiscoveryFetchError ? error.status : 'unavailable'
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

function singleSkillPackage(content: Buffer): {
  readonly files: readonly AgentSkillArchiveFile[]
  readonly treeHash: string
  readonly totalBytes: number
} {
  return Object.freeze({
    files: Object.freeze([Object.freeze({
      path: 'SKILL.md',
      mode: '100644' as const,
      content,
    })]),
    treeHash: singleSkillTreeHash(content),
    totalBytes: content.byteLength,
  })
}

function singleSkillTreeHash(content: Uint8Array): string {
  return createHash('sha256')
    .update('SKILL.md')
    .update('\0')
    .update(content)
    .update('\0')
    .digest('hex')
}

function decodeCanonicalUtf8(content: Buffer): string {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(content)
  if (!Buffer.from(decoded).equals(content)) throw new Error('Skill is not canonical UTF-8 text')
  return decoded
}

function packageHasDirectory(files: readonly AgentSkillArchiveFile[], directory: string): boolean {
  return files.some(file => file.path === directory || file.path.startsWith(`${directory}/`))
}

function agentSkillArchiveFormat(
  url: URL,
  mediaType: string | undefined,
): AgentSkillArchiveFormat | undefined {
  if (mediaType === 'application/gzip' || mediaType === 'application/x-gzip') return 'tar.gz'
  if (mediaType === 'application/zip') return 'zip'
  if (mediaType !== undefined && mediaType !== 'application/octet-stream') return undefined
  const path = url.pathname.toLocaleLowerCase('en-US')
  if (path.endsWith('.tar.gz') || path.endsWith('.tgz')) return 'tar.gz'
  if (path.endsWith('.zip')) return 'zip'
  return undefined
}

function sha256Bytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
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

function versionIdentity(version: DiscoveredSkillCandidate['version']): readonly string[] {
  if (version.kind === 'git-tree') return [version.commit, version.treeHash]
  if (version.kind === 'agent-skills-index-v0.2') {
    return [version.indexDigest, version.artifactDigest, version.treeHash]
  }
  return [
    version.modelIdentityHash,
    version.inputDigest,
    version.artifactDigest,
    version.treeHash,
  ]
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
