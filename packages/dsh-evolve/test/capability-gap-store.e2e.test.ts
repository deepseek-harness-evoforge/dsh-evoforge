import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openCapabilityGapStore } from '../src/capability-gap-store.ts'
import {
  openSkillCandidateStore,
  type ExperienceSkillCandidateInput,
} from '../src/skill-candidate-repository.ts'
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

  it('recovers only internally authored quarantined whole-Skill Candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-candidate-store-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const store = await openSkillCandidateStore(first.storageDomain)
    let candidateIds: string[] = []
    try {
      const candidate = await store.recordCandidate(skillCandidateInput('1', 1))
      const duplicate = await store.recordCandidate(skillCandidateInput('1', 1))
      expect(duplicate).toEqual({ created: false, candidate: candidate.candidate })
      const second = await store.recordCandidate(skillCandidateInput('2', 2))
      candidateIds = [second.candidate.id, candidate.candidate.id]
      expect(store.listCandidates(WORKSPACE_ID, '1'.repeat(64))).toEqual([candidate.candidate])
      expect(JSON.stringify(store.listCandidates(WORKSPACE_ID))).not.toMatch(
        /agent-skills|local-git|research|trusted-source/iu,
      )
    } finally {
      await store.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openSkillCandidateStore(resumed.storageDomain)
    try {
      expect(recovered.listCandidates(WORKSPACE_ID).map(candidate => candidate.id)).toEqual(candidateIds)
      expect(recovered.listCandidates(WORKSPACE_ID)[0]).toMatchObject({
        opportunity: { kind: 'internal-experience-v1' },
        authorship: { kind: 'bounded-model-authoring-v1' },
        version: { kind: 'experience-authored-bundle-v1' },
        artifact: { kind: 'canonical-text-bundle', format: 'tar.gz' },
      })
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('retains every content-addressed Candidate until an explicit governance decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-skill-candidate-retention-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    const store = await openSkillCandidateStore(ctx.storageDomain)
    try {
      const base = skillCandidateInput('1', 0)
      for (let index = 0; index < 1_001; index += 1) {
        await store.recordCandidate({
          ...base,
          createdAt: index,
          authorship: {
            ...base.authorship,
            inputDigest: index.toString(16).padStart(64, '0'),
          },
        })
      }
      expect(store.listCandidates(WORKSPACE_ID)).toHaveLength(1_001)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  }, 30_000)
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

function skillCandidateInput(marker: string, createdAt: number): ExperienceSkillCandidateInput {
  return {
    createdAt,
    workspaceId: WORKSPACE_ID,
    skillName: `release-proof-${marker}`,
    description: 'Publish a verified release.',
    opportunity: {
      kind: 'internal-experience-v1' as const,
      id: marker.repeat(64),
      gapIds: ['a'.repeat(64), 'b'.repeat(64)],
      goalCount: 2,
    },
    authorship: {
      kind: 'bounded-model-authoring-v1' as const,
      policyId: 'workspace-experience-author',
      modelIdentityHash: 'c'.repeat(64),
      inputDigest: 'd'.repeat(64),
    },
    scope: 'workspace' as const,
    version: {
      kind: 'experience-authored-bundle-v1' as const,
      artifactDigest: 'e'.repeat(64),
      treeHash: 'f'.repeat(64),
    },
    contentHash: 'e'.repeat(64),
    package: {
      path: `release-proof-${marker}`,
      fileCount: 2,
      totalBytes: 512,
      hasScripts: false as const,
      hasReferences: true as const,
    },
    permissions: {
      declared: false,
      executableContent: false as const,
      externalEffects: 'unknown' as const,
    },
    license: { status: 'unknown' as const },
    safety: {
      status: 'quarantined' as const,
      checks: [
        { name: 'artifact-digest-integrity' as const, status: 'passed' as const },
        { name: 'regular-files-only' as const, status: 'passed' as const },
        { name: 'skill-identity' as const, status: 'passed' as const },
        { name: 'effect-review' as const, status: 'required' as const },
      ],
    },
    artifact: {
      kind: 'canonical-text-bundle' as const,
      format: 'tar.gz' as const,
      contentBase64: 'YQ==',
    },
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
