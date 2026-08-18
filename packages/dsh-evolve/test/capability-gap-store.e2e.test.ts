import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openCapabilityGapStore } from '../src/capability-gap-store.ts'
import { openSkillDiscoveryStore } from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('Capability Gap durable queue', () => {
  it('deduplicates content identity, evicts oldest records, and recovers after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-capability-gaps-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openCapabilityGapStore(first.storageDomain, { maxRecords: 2 })
    let retainedIds: string[] = []
    try {
      const firstResult = await store.record(gapInput(1, 'first-missing'))
      const duplicate = await store.record(gapInput(1, 'first-missing'))
      expect(duplicate).toEqual({ created: false, gap: firstResult.gap })
      expect(Object.isFrozen(firstResult.gap)).toBe(true)

      await store.record(gapInput(2, 'second-missing'))
      await store.record({
        ...gapInput(3, 'third-missing'),
        evidence: {
          kind: 'model-declared-skill-gap' as const,
          catalog: 'complete' as const,
          routing: 'model-declared-no-applicable-skill' as const,
          providers: 'settled' as const,
        },
      })
      const retained = store.list(WORKSPACE_ID)
      expect(retained.map(gap => gap.requestedSkill)).toEqual(['third-missing', 'second-missing'])
      expect(retained[0]?.evidence).toEqual({
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      })
      expect(retained.every(gap => /^[a-f0-9]{64}$/.test(gap.id))).toBe(true)
      expect(retained.every(gap => gap.status === 'confirmed')).toBe(true)
      retainedIds = retained.map(gap => gap.id)
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openCapabilityGapStore(resumed.storageDomain, { maxRecords: 2 })
    try {
      expect(recovered.list(WORKSPACE_ID).map(gap => gap.id)).toEqual(retainedIds)
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('rejects a Capability Gap whose evidence kind and routing provenance disagree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-capability-gap-evidence-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const store = await openCapabilityGapStore(ctx.storageDomain)
    try {
      const input = gapInput(1, 'mismatched-gap')
      await expect(store.record({
        ...input,
        evidence: {
          ...input.evidence,
          routing: 'model-declared-no-applicable-skill',
        },
      } as never)).rejects.toThrow()
      expect(store.list(WORKSPACE_ID)).toEqual([])
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('recovers quarantined whole-Skill candidates and abstention evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-discovery-store-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openSkillDiscoveryStore(first.storageDomain)
    let candidateIds: string[] = []
    let attemptIds: string[] = []
    try {
      const candidate = await store.recordCandidate(discoveryCandidateInput())
      const duplicate = await store.recordCandidate(discoveryCandidateInput())
      expect(duplicate).toEqual({ created: false, candidate: candidate.candidate })
      const external = await store.recordCandidate(agentSkillsIndexCandidateInput())
      candidateIds = [external.candidate.id, candidate.candidate.id]
      const attempt = await store.recordAttempt(discoveryAttemptInput(candidate.candidate.id))
      const ambiguous = await store.recordAttempt({
        gapId: '6'.repeat(64),
        workspaceId: WORKSPACE_ID,
        requestedSkill: 'publish-dsh-plugin',
        startedAt: 1_786_896_100_002,
        completedAt: 1_786_896_100_003,
        status: 'abstained',
        candidateIds: [],
        reasons: ['ambiguous-semantic-match'],
        sources: [{
          id: 'local-curated',
          status: 'ambiguous',
          revision: 'a'.repeat(40),
        }],
      })
      attemptIds = [ambiguous.attempt.id, attempt.attempt.id]
      expect(store.listCandidates(WORKSPACE_ID, '5'.repeat(64))).toEqual([candidate.candidate])
      expect(store.listCandidates(WORKSPACE_ID, '7'.repeat(64))[0]).toMatchObject({
        source: { kind: 'agent-skills-index', origin: 'https://skills.example.com' },
        artifact: { kind: 'skill-md', content: expect.stringContaining('name: indexed-release-skill') },
        license: { status: 'declared', value: 'MIT' },
      })
      expect(store.listAttempts(WORKSPACE_ID, '5'.repeat(64))).toEqual([attempt.attempt])
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openSkillDiscoveryStore(resumed.storageDomain)
    try {
      expect(recovered.listCandidates(WORKSPACE_ID).map(candidate => candidate.id)).toEqual(candidateIds)
      expect(recovered.listCandidates(WORKSPACE_ID)[0]?.artifact?.content)
        .toContain('name: indexed-release-skill')
      expect(recovered.listAttempts(WORKSPACE_ID).map(attempt => attempt.id)).toEqual(attemptIds)
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })
})

function gapInput(observedAt: number, requestedSkill: string) {
  return {
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${observedAt}`,
    requestedSkill,
    catalogHash: String(observedAt).repeat(64).slice(0, 64),
    catalogSize: observedAt,
    goal: {
      id: `goal-${observedAt}`,
      revision: observedAt,
      objective: `Complete task ${observedAt}.`,
    },
    evidence: {
      kind: 'native-skill-miss' as const,
      catalog: 'complete' as const,
      routing: 'requested-skill-absent' as const,
      providers: 'settled' as const,
    },
  }
}

function discoveryCandidateInput() {
  return {
    discoveredAt: 1_786_896_100_000,
    gapId: '5'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    description: 'Publish a verified release.',
    match: {
      kind: 'deterministic-lexical-v1' as const,
      requestedSkill: 'publish-dsh-plugin',
      score: 18,
      runnerUpScore: 0,
      queryHash: 'f'.repeat(64),
    },
    source: {
      id: 'local-curated',
      kind: 'local-git' as const,
      trust: 'explicit-deployer-config' as const,
    },
    scope: 'workspace' as const,
    version: {
      kind: 'git-tree' as const,
      commit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
    },
    contentHash: 'c'.repeat(64),
    package: {
      path: 'skills/missing-release-skill',
      fileCount: 3,
      totalBytes: 512,
      hasScripts: true,
      hasReferences: true,
    },
    permissions: {
      declared: false,
      executableContent: true,
      externalEffects: 'unknown' as const,
    },
    safety: {
      status: 'quarantined' as const,
      checks: [
        { name: 'git-object-integrity' as const, status: 'passed' as const },
        { name: 'regular-files-only' as const, status: 'passed' as const },
        { name: 'skill-identity' as const, status: 'passed' as const },
        { name: 'effect-review' as const, status: 'required' as const },
      ],
    },
    lifecycle: 'inactive' as const,
    verification: 'unevaluated' as const,
    execution: 'never' as const,
  }
}

function discoveryAttemptInput(candidateId: string) {
  return {
    gapId: '5'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    startedAt: 1_786_896_100_000,
    completedAt: 1_786_896_100_001,
    status: 'candidate-found' as const,
    candidateIds: [candidateId],
    reasons: [],
    sources: [{
      id: 'local-curated',
      status: 'candidate' as const,
      revision: 'a'.repeat(40),
    }],
  }
}

function agentSkillsIndexCandidateInput() {
  const content = [
    '---',
    'name: indexed-release-skill',
    'description: Publish a verified indexed release.',
    'license: MIT',
    '---',
    '',
    'Follow the bounded checks.',
    '',
  ].join('\n')
  return {
    discoveredAt: 1_786_896_100_001,
    gapId: '7'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'indexed-release-skill',
    description: 'Publish a verified indexed release.',
    source: {
      id: 'public-agent-skills',
      kind: 'agent-skills-index' as const,
      trust: 'explicit-deployer-config' as const,
      origin: 'https://skills.example.com',
    },
    scope: 'workspace' as const,
    version: {
      kind: 'agent-skills-index-v0.2' as const,
      indexDigest: 'd'.repeat(64),
      artifactDigest: 'e'.repeat(64),
      treeHash: 'f'.repeat(64),
    },
    contentHash: 'e'.repeat(64),
    package: {
      path: 'indexed-release-skill/SKILL.md',
      fileCount: 1,
      totalBytes: Buffer.byteLength(content),
      hasScripts: false,
      hasReferences: false,
    },
    permissions: {
      declared: false,
      executableContent: false,
      externalEffects: 'unknown' as const,
    },
    license: { status: 'declared' as const, value: 'MIT' },
    safety: {
      status: 'quarantined' as const,
      checks: [
        { name: 'artifact-digest-integrity' as const, status: 'passed' as const },
        { name: 'regular-files-only' as const, status: 'passed' as const },
        { name: 'skill-identity' as const, status: 'passed' as const },
        { name: 'effect-review' as const, status: 'required' as const },
      ],
    },
    artifact: { kind: 'skill-md' as const, content },
    lifecycle: 'inactive' as const,
    verification: 'unevaluated' as const,
    execution: 'never' as const,
  }
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await symlink(source, join(packageScope, name), 'dir')
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    {
      id: 'storage-json',
      name: '@deepseek-ai/dsh-storage-json',
      config: { root: join(root, 'storage') },
    },
    {
      id: 'storage-domain',
      name: '@deepseek-ai/dsh-storage-domain',
      config: { backend: 'json' },
    },
  ], null, 2))
  return configPath
}

async function bootStorage(configPath: string) {
  const { boot } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return boot('dsh-evolve-capability-gap-test', configPath)
}
