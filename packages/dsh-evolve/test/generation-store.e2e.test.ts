import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { openEvolutionStore, type EvolutionStore } from '../src/generation-store.js'
import {
  openExistingSkillReleaseStore,
  type ExistingSkillReleaseDecision,
} from '../src/existing-skill-release.ts'
import { assembleSkillBundleArchive } from '../src/skill-bundle-archive.js'
import type { SkillCandidateLineage } from '../src/skill-candidate-lineage.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('Capability Generation store', () => {
  it('publishes one immutable content-addressed Generation and returns it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-store-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
        lineage: discoveredLineage('a'.repeat(64)),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    let expected: Awaited<ReturnType<EvolutionStore['publishGeneration']>>['generation'] | undefined

    const firstCtx = await bootStorage(configPath)
    const firstStore = await openEvolutionStore(firstCtx.storageDomain)
    try {
      const published = await firstStore.publishGeneration(input)
      expected = published.generation
      expect(published).toEqual({ created: true, generation: expected })
      expect(expected).toMatchObject({ schemaVersion: 2, ...input })
      expect(await firstStore.publishGeneration(input)).toEqual({ created: false, generation: expected })
      const withoutLineage = await firstStore.publishGeneration({
        ...input,
        artifacts: input.artifacts.map(({ lineage: _lineage, ...artifact }) => artifact),
      })
      expect(withoutLineage.generation.id).not.toBe(expected.id)
      const loaded = firstStore.getGeneration(expected.id)
      expect(loaded).toEqual(expected)
      expect(Object.isFrozen(loaded)).toBe(true)
      expect(Object.isFrozen(loaded?.artifacts)).toBe(true)
      expect(Object.isFrozen(loaded?.artifacts[0])).toBe(true)
      expect(Object.isFrozen(loaded?.artifacts[0]?.lineage)).toBe(true)
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openEvolutionStore(resumedCtx.storageDomain)
    try {
      if (expected === undefined) throw new Error('expected Generation was not published')
      expect(resumedStore.getGeneration(expected.id)).toEqual(expected)
    } finally {
      await resumedStore.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('persists an exact internally authored Skill bundle and rejects tampered content identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-bundle-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const bundle = await assembleSkillBundleArchive([{
      path: 'SKILL.md',
      content: [
        '---',
        'name: build-dsh-plugin',
        'description: Build a verified native DSH plugin.',
        '---',
        '',
        '# Build DSH Plugin',
        '',
        'Follow the [verification contract](references/verification.md).',
        '',
      ].join('\n'),
    }, {
      path: 'references/verification.md',
      content: '# Verification\n\nUse the real assembled DSH path.\n',
    }])
    const lineage = {
      ...discoveredLineage(bundle.treeHash),
      contentHash: bundle.artifactDigest,
    }
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill-bundle' as const,
        name: 'build-dsh-plugin',
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        contentBase64: bundle.content.toString('base64'),
        lineage,
      }],
      evaluatorVersion: 'capability-absent-v1',
      policyVersion: 'human-review-v1',
      compositionFingerprint: 'b'.repeat(64),
    }
    let generationId = ''

    const firstCtx = await bootStorage(configPath)
    const firstStore = await openEvolutionStore(firstCtx.storageDomain)
    try {
      const published = await firstStore.publishGeneration(input)
      generationId = published.generation.id
      expect(published.generation.artifacts[0]).toEqual(input.artifacts[0])
      await expect(firstStore.publishGeneration({
        ...input,
        artifacts: [{
          ...input.artifacts[0]!,
          artifactDigest: '0'.repeat(64),
          lineage: { ...lineage, contentHash: '0'.repeat(64) },
        }],
      })).rejects.toThrow("Skill bundle artifact 'build-dsh-plugin' failed content identity verification")
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openEvolutionStore(resumedCtx.storageDomain)
    try {
      expect(resumedStore.getGeneration(generationId)?.artifacts[0]).toEqual(input.artifacts[0])
    } finally {
      await resumedStore.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('keeps a published Candidate inactive, rolls it back to its parent, then rolls the root back to native DSH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-release-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const rootInput = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    let rootId = ''
    const candidateInput = (parentId: string) => ({
      workspaceId: WORKSPACE_ID,
      parentId,
      createdAt: 1_723_456_789_001,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '89abcdef0123456789abcdef0123456789abcdef',
        treeHash: 'c'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'd'.repeat(64),
    })
    let candidateId = ''

    const publishingCtx = await bootStorage(configPath)
    const publishingStore = await openEvolutionStore(publishingCtx.storageDomain)
    try {
      const rootGeneration = (await publishingStore.publishGeneration(rootInput)).generation
      rootId = rootGeneration.id
      expect(await publishingStore.promoteGeneration(WORKSPACE_ID, rootId)).toEqual({
        previousId: undefined,
        generation: rootGeneration,
      })
      candidateId = (await publishingStore.publishGeneration(candidateInput(rootId))).generation.id
      expect(publishingStore.getActiveGeneration(WORKSPACE_ID)).toEqual(rootGeneration)
    } finally {
      await publishingStore.close()
      await publishingCtx.fiber.dispose()
    }

    const promotingCtx = await bootStorage(configPath)
    const promotingStore = await openEvolutionStore(promotingCtx.storageDomain)
    try {
      const rootGeneration = promotingStore.getGeneration(rootId)
      const candidateGeneration = promotingStore.getGeneration(candidateId)
      expect(promotingStore.getActiveGeneration(WORKSPACE_ID)).toEqual(rootGeneration)
      expect(await promotingStore.promoteGeneration(WORKSPACE_ID, candidateId)).toEqual({
        previousId: rootId,
        generation: candidateGeneration,
      })
      await expect(promotingStore.rollbackGeneration(WORKSPACE_ID, rootId)).rejects.toThrow(
        `active Generation changed from expected '${rootId}' to '${candidateId}'`,
      )
      expect(promotingStore.getActiveGeneration(WORKSPACE_ID)?.id).toBe(candidateId)
      expect(await promotingStore.rollbackGeneration(WORKSPACE_ID, candidateId)).toEqual({
        previousId: candidateId,
        generation: rootGeneration,
      })
    } finally {
      await promotingStore.close()
      await promotingCtx.fiber.dispose()
    }

    const recoveredCtx = await bootStorage(configPath)
    const recoveredStore = await openEvolutionStore(recoveredCtx.storageDomain)
    try {
      expect(recoveredStore.getActiveGeneration(WORKSPACE_ID)?.id).toBe(rootId)
      expect(await recoveredStore.rollbackGeneration(WORKSPACE_ID, rootId)).toEqual({
        previousId: rootId,
        generation: undefined,
      })
      expect(recoveredStore.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
    } finally {
      await recoveredStore.close()
      await recoveredCtx.fiber.dispose()
    }

    const nativeCtx = await bootStorage(configPath)
    const nativeStore = await openEvolutionStore(nativeCtx.storageDomain)
    try {
      expect(nativeStore.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
    } finally {
      await nativeStore.close()
      await nativeCtx.fiber.dispose()
    }
  })

  it('persists resident recovery pause across restart and preserves it through release pointer writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-recovery-pause-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0c.3',
      compositionFingerprint: 'b'.repeat(64),
    }

    const firstCtx = await bootStorage(configPath)
    const firstStore = await openEvolutionStore(firstCtx.storageDomain)
    const generation = (await firstStore.publishGeneration(input)).generation
    try {
      expect(firstStore.isRecoveryPaused(WORKSPACE_ID)).toBe(false)
      await expect(firstStore.setRecoveryPaused(WORKSPACE_ID, true)).resolves.toEqual({ changed: true, paused: true })
      await firstStore.promoteGeneration(WORKSPACE_ID, generation.id)
      expect(firstStore.isRecoveryPaused(WORKSPACE_ID)).toBe(true)
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openEvolutionStore(resumedCtx.storageDomain)
    try {
      expect(resumedStore.isRecoveryPaused(WORKSPACE_ID)).toBe(true)
      await resumedStore.rollbackGeneration(WORKSPACE_ID, generation.id)
      expect(resumedStore.isRecoveryPaused(WORKSPACE_ID)).toBe(true)
      await expect(resumedStore.setRecoveryPaused(WORKSPACE_ID, false)).resolves.toEqual({ changed: true, paused: false })
      await expect(resumedStore.setRecoveryPaused(WORKSPACE_ID, false)).resolves.toEqual({ changed: false, paused: false })
    } finally {
      await resumedStore.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('atomically retains exact promotion and Canary rollback evidence with the active pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-selection-history-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const rootInput = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    const existing = session('selection-history-existing', 10)
    let rootId = ''
    let candidateId = ''
    let expectedHistory: ReturnType<EvolutionStore['listGenerationSelectionEvents']> = []

    const firstCtx = await bootStorage(configPath)
    const first = await openEvolutionStore(firstCtx.storageDomain)
    try {
      const rootGeneration = (await first.publishGeneration(rootInput)).generation
      rootId = rootGeneration.id
      await first.promoteGeneration(WORKSPACE_ID, rootId)
      expect((await first.pinSession(existing))?.id).toBe(rootId)
      const candidate = (await first.publishGeneration({
        ...rootInput,
        parentId: rootId,
        createdAt: rootInput.createdAt + 1,
        artifacts: [{
          kind: 'skill' as const,
          name: 'build-dsh-plugin',
          gitCommit: '89abcdef0123456789abcdef0123456789abcdef',
          treeHash: 'c'.repeat(64),
        }],
        compositionFingerprint: 'd'.repeat(64),
      })).generation
      candidateId = candidate.id
      await first.promoteGeneration(WORKSPACE_ID, candidateId, {
        authority: 'internal-retention',
        reviewId: 'e'.repeat(64),
        retentionId: 'f'.repeat(64),
      })
      await first.promoteGeneration(WORKSPACE_ID, candidateId, {
        authority: 'internal-retention',
        reviewId: 'e'.repeat(64),
        retentionId: 'f'.repeat(64),
      })
      await first.rollbackGeneration(WORKSPACE_ID, candidateId, {
        authority: 'counterfactual-canary',
        canaryId: '0'.repeat(64),
      })

      expectedHistory = first.listGenerationSelectionEvents(WORKSPACE_ID)
      expect(expectedHistory).toHaveLength(3)
      expect(expectedHistory.map(event => ({
        sequence: event.sequence,
        kind: event.kind,
        previousGenerationId: event.previousGenerationId,
        activeGenerationId: event.activeGenerationId,
        evidence: event.evidence,
      }))).toEqual([
        {
          sequence: 1,
          kind: 'promotion',
          previousGenerationId: undefined,
          activeGenerationId: rootId,
          evidence: { authority: 'direct-host' },
        },
        {
          sequence: 2,
          kind: 'promotion',
          previousGenerationId: rootId,
          activeGenerationId: candidateId,
          evidence: {
            authority: 'internal-retention',
            reviewId: 'e'.repeat(64),
            retentionId: 'f'.repeat(64),
          },
        },
        {
          sequence: 3,
          kind: 'rollback',
          previousGenerationId: candidateId,
          activeGenerationId: rootId,
          evidence: {
            authority: 'counterfactual-canary',
            canaryId: '0'.repeat(64),
          },
        },
      ])
      expect(expectedHistory.every(event => /^[a-f0-9]{64}$/u.test(event.id))).toBe(true)
      expect(first.getSessionGeneration(existing)?.id).toBe(rootId)
    } finally {
      await first.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumed = await openEvolutionStore(resumedCtx.storageDomain)
    try {
      expect(resumed.getActiveGeneration(WORKSPACE_ID)?.id).toBe(rootId)
      expect(resumed.listGenerationSelectionEvents(WORKSPACE_ID)).toEqual(expectedHistory)
      expect(resumed.getSessionGeneration(existing)?.id).toBe(rootId)
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('durably pins a native Session and its children to native DSH before the first promotion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-native-session-pins-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    const native = session('native-before-promotion', 10)
    const nativeChild = session('native-child-after-promotion', 11)
    const evolved = session('evolved-after-promotion', 12)

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    const generation = (await store.publishGeneration(input)).generation
    try {
      expect(await store.pinSession(native)).toBeUndefined()
      await store.promoteGeneration(WORKSPACE_ID, generation.id)
      expect(await store.pinSession(native)).toBeUndefined()
      expect(await store.pinSession(nativeChild, { parentSessionId: native.sessionId }))
        .toBeUndefined()
      expect((await store.pinSession(evolved))?.id).toBe(generation.id)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }

    const recoveredCtx = await bootStorage(configPath)
    const recoveredStore = await openEvolutionStore(recoveredCtx.storageDomain)
    try {
      expect(await recoveredStore.pinSession(native)).toBeUndefined()
      expect(await recoveredStore.pinSession(nativeChild, { parentSessionId: native.sessionId }))
        .toBeUndefined()
      expect(recoveredStore.getSessionGeneration(evolved)?.id).toBe(generation.id)
    } finally {
      await recoveredStore.close()
      await recoveredCtx.fiber.dispose()
    }
  })

  it('pins existing Sessions while new roots follow promotion and children inherit their parent Generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-session-pins-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const rootInput = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    let rootId = ''
    const candidateInput = (parentId: string) => ({
      workspaceId: WORKSPACE_ID,
      parentId,
      createdAt: 1_723_456_789_001,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '89abcdef0123456789abcdef0123456789abcdef',
        treeHash: 'c'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'd'.repeat(64),
    })
    let candidateId = ''
    const existing = session('existing', 10)
    const fresh = session('fresh', 11)
    const child = session('child', 12)

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    try {
      rootId = (await store.publishGeneration(rootInput)).generation.id
      await store.promoteGeneration(WORKSPACE_ID, rootId)
      expect((await store.pinSession(existing))?.id).toBe(rootId)

      candidateId = (await store.publishGeneration(candidateInput(rootId))).generation.id
      await store.promoteGeneration(WORKSPACE_ID, candidateId)
      expect((await store.pinSession(existing))?.id).toBe(rootId)
      expect((await store.pinSession(fresh))?.id).toBe(candidateId)
      expect((await store.pinSession(child, { parentSessionId: 'existing' }))?.id).toBe(rootId)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }

    const recoveredCtx = await bootStorage(configPath)
    const recoveredStore = await openEvolutionStore(recoveredCtx.storageDomain)
    try {
      expect(recoveredStore.getSessionGeneration(existing)?.id).toBe(rootId)
      expect(recoveredStore.getSessionGeneration(fresh)?.id).toBe(candidateId)
      expect(recoveredStore.getSessionGeneration(child)?.id).toBe(rootId)
    } finally {
      await recoveredStore.close()
      await recoveredCtx.fiber.dispose()
    }
  })

  it('loads with one stable autonomous Gap Tool and removal restores native model composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-runtime-plugin-'))
    temporaryRoots.push(root)
    const { evolvedConfig, nativeConfig } = await writeRuntimeConfigs(root)
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }

    const evolvedCtx = await bootStorage(evolvedConfig)
    const service = evolvedCtx.get('evoforge.evolution') as EvolutionStore | undefined
    expect(service).toBeDefined()
    if (service === undefined) throw new Error('evolution service did not load')
    const before = await evolvedCtx.systemPrompt.assemble()
    expect(before.tools).toEqual([{
      name: 'report_capability_gap',
      description: 'Report a missing reusable capability only after reviewing the complete Session Skill catalog and finding that no available Skill applies. Propose one kebab-case capability name; EvoForge retains it as internal Goal experience and looks for repeated evidence across Goals without changing the current Session.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Proposed kebab-case name for the missing reusable Skill capability.',
          },
        },
        required: ['name'],
      },
    }])
    const evolvedJobs = evolvedCtx.get('jobs') as JobRegistry | undefined
    expect(evolvedJobs).toBeDefined()
    expect(() => evolvedJobs?.start({
      kind: 'evolution',
      label: 'supervisor controller probe',
      run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed' }) }),
    })).not.toThrow()
    const generation = (await service.publishGeneration(input)).generation
    const after = await evolvedCtx.systemPrompt.assemble()
    expect(after).toEqual(before)
    await evolvedCtx.fiber.dispose()
    expect(evolvedCtx.get('evoforge.evolution')).toBeUndefined()

    const nativeCtx = await bootStorage(nativeConfig)
    try {
      const native = await nativeCtx.systemPrompt.assemble()
      expect(native.tools).toEqual([])
      expect({ ...native, tools: before.tools }).toEqual(before)
    } finally {
      await nativeCtx.fiber.dispose()
    }

    const recoveredCtx = await bootStorage(evolvedConfig)
    try {
      const recovered = recoveredCtx.get('evoforge.evolution') as EvolutionStore | undefined
      expect(recovered?.getGeneration(generation.id)).toEqual(generation)
    } finally {
      await recoveredCtx.fiber.dispose()
    }
  })

  it('replaces a stale reused Session id and lets a child inherit by durable parentSession id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-session-reuse-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const rootInput = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'b'.repeat(64),
    }
    let rootId = ''
    const candidateInput = (parentId: string) => ({
      workspaceId: WORKSPACE_ID,
      parentId,
      createdAt: 1_723_456_789_001,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '89abcdef0123456789abcdef0123456789abcdef',
        treeHash: 'c'.repeat(64),
      }],
      evaluatorVersion: 'private-host-runtime-package-boundary-v1',
      policyVersion: 'p0b.1',
      compositionFingerprint: 'd'.repeat(64),
    })
    let candidateId = ''
    const oldLifecycle = session('reused', 10)
    const currentLifecycle = session('reused', 20)
    const child = session('child-of-reused', 21)

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    try {
      rootId = (await store.publishGeneration(rootInput)).generation.id
      await store.promoteGeneration(WORKSPACE_ID, rootId)
      expect((await store.pinSession(oldLifecycle))?.id).toBe(rootId)

      candidateId = (await store.publishGeneration(candidateInput(rootId))).generation.id
      await store.promoteGeneration(WORKSPACE_ID, candidateId)
      expect((await store.pinSession(currentLifecycle))?.id).toBe(candidateId)
      expect(store.getSessionGeneration(oldLifecycle)).toBeUndefined()
      expect((await store.pinSession(child, { parentSessionId: 'reused' }))?.id).toBe(candidateId)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('persists immutable existing-Skill human and automatic decisions across a real Storage restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-release-store-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const content = {
      kind: 'existing-skill-release-decision-v1' as const,
      candidateId: '1'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'shared-skill',
      status: 'rejected' as const,
      actor: 'human' as const,
      decisionNote: 'Do not release this exact Candidate.',
      decidedAt: '2026-08-21T00:00:00.000Z',
      evidenceHash: '2'.repeat(64),
    }
    const decision: ExistingSkillReleaseDecision = {
      schemaVersion: 1,
      id: sha256Json(content),
      ...content,
    }
    const automaticContent = {
      kind: 'existing-skill-release-decision-v1' as const,
      candidateId: '3'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'shared-skill',
      status: 'approved' as const,
      actor: 'automatic-clear-instruction-v2' as const,
      automaticPolicyId: 'clear-instruction-v2',
      decisionNote: 'Exact append-only instruction improved paired Holdout and independent Retention.',
      decidedAt: '2026-08-21T00:00:01.000Z',
      evidenceHash: '4'.repeat(64),
      admissionId: '5'.repeat(64),
      holdoutEvaluationId: '6'.repeat(64),
      retentionEvaluationId: '7'.repeat(64),
      generationId: '8'.repeat(64),
    }
    const automaticDecision: ExistingSkillReleaseDecision = {
      schemaVersion: 1,
      id: sha256Json(automaticContent),
      ...automaticContent,
    }

    const firstCtx = await bootStorage(configPath)
    const first = await openExistingSkillReleaseStore(firstCtx.storageDomain)
    try {
      await expect(first.record(decision)).resolves.toEqual({ created: true, decision })
      await expect(first.record(decision)).resolves.toEqual({ created: false, decision })
      await expect(first.record(automaticDecision)).resolves.toEqual({
        created: true,
        decision: automaticDecision,
      })
      await expect(first.record({ ...decision, decisionNote: 'Conflicting decision.' }))
        .rejects.toThrow('decision id is invalid')
    } finally {
      await first.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumed = await openExistingSkillReleaseStore(resumedCtx.storageDomain)
    try {
      expect(resumed.get(decision.candidateId)).toEqual(decision)
      expect(resumed.get(automaticDecision.candidateId)).toEqual(automaticDecision)
      expect(resumed.list(WORKSPACE_ID)).toEqual([decision, automaticDecision])
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
    }
  })

  it('rejects new writes once the evolution domains begin closing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-store-close-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = {
      workspaceId: WORKSPACE_ID,
      createdAt: 1_723_456_789_000,
      artifacts: [{
        kind: 'skill' as const,
        name: 'close-guard',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        treeHash: 'a'.repeat(64),
      }],
      evaluatorVersion: 'close-guard-v1',
      policyVersion: 'close-guard-v1',
      compositionFingerprint: 'b'.repeat(64),
    }
    const content = {
      kind: 'existing-skill-release-decision-v1' as const,
      candidateId: '1'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'close-guard',
      status: 'rejected' as const,
      actor: 'human' as const,
      decisionNote: 'Close guard regression.',
      decidedAt: '2026-08-21T00:00:00.000Z',
      evidenceHash: '2'.repeat(64),
    }
    const decision: ExistingSkillReleaseDecision = {
      schemaVersion: 1,
      id: sha256Json(content),
      ...content,
    }

    const ctx = await bootStorage(configPath)
    const generations = await openEvolutionStore(ctx.storageDomain)
    const releases = await openExistingSkillReleaseStore(ctx.storageDomain)
    try {
      await generations.close()
      await releases.close()
      await expect(generations.publishGeneration(input)).rejects.toThrow(
        'Capability Generation store is closing',
      )
      await expect(generations.setRecoveryPaused(WORKSPACE_ID, true)).rejects.toThrow(
        'Capability Generation store is closing',
      )
      await expect(generations.pinSession({
        workspaceId: WORKSPACE_ID,
        sessionId: 'closed-session',
        createdAt: 1_723_456_789_000,
      })).rejects.toThrow('Capability Generation store is closing')
      await expect(releases.record(decision)).rejects.toThrow(
        'existing Skill release store is closing',
      )
    } finally {
      await Promise.all([generations.close(), releases.close()])
      await ctx.fiber.dispose()
    }
  })
})

function discoveredLineage(candidateTreeHash: string): SkillCandidateLineage {
  return {
    kind: 'internal-skill-candidate-lineage-v3',
    candidateId: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'build-dsh-plugin',
    opportunityId: '4'.repeat(64),
    evaluationEvidenceId: '6'.repeat(64),
    policyId: 'build-dsh-plugin-author',
    versionKind: 'experience-authored-bundle-v1',
    contentHash: '2'.repeat(64),
    candidateTreeHash,
    admissionId: '3'.repeat(64),
    evaluationEnvelopeId: 'e'.repeat(64),
    releaseAuthority: 'none',
  }
}

function session(sessionId: string, createdAt: number) {
  return {
    workspaceId: WORKSPACE_ID,
    sessionId,
    createdAt,
    cwd: '/workspace/project',
  }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
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

async function writeRuntimeConfigs(root: string): Promise<{
  evolvedConfig: string
  nativeConfig: string
}> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
    ['dsh-agent', join(dshSourceDir, 'packages', 'core', 'agent')],
    ['dsh-goal', join(dshSourceDir, 'packages', 'goal', 'goal')],
    ['dsh-system-prompt', join(dshSourceDir, 'packages', 'core', 'system-prompt')],
    ['dsh-tools', join(dshSourceDir, 'packages', 'core', 'tools')],
    ['dsh-session', join(dshSourceDir, 'packages', 'core', 'session')],
    ['dsh-session-projection', join(dshSourceDir, 'packages', 'session', 'session-projection')],
    ['dsh-jobs-local', join(dshSourceDir, 'packages', 'jobs', 'jobs-local')],
    ['dsh-session-persistence-jsonl', join(dshSourceDir, 'packages', 'session', 'session-persistence-jsonl')],
    ['dsh-workspace', join(dshSourceDir, 'packages', 'workspace', 'workspace')],
  ] as const) {
    await symlink(source, join(packageScope, name), 'dir')
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const nativeRows = [
    {
      id: 'system-prompt',
      name: '@deepseek-ai/dsh-system-prompt',
      config: { persona: 'Stable P0B composition fixture.' },
    },
    { id: 'tools', name: '@deepseek-ai/dsh-tools' },
    { id: 'session', name: '@deepseek-ai/dsh-session' },
    { id: 'agent', name: '@deepseek-ai/dsh-agent' },
    { id: 'session-projection', name: '@deepseek-ai/dsh-session-projection' },
    { id: 'goal', name: '@deepseek-ai/dsh-goal' },
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
    { id: 'jobs', name: '@deepseek-ai/dsh-jobs-local' },
    {
      id: 'session-persistence',
      name: '@deepseek-ai/dsh-session-persistence-jsonl',
      config: { root: join(root, 'sessions') },
    },
    { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
  ]
  const nativeConfig = join(root, 'native.cordis.yml')
  const evolvedConfig = join(root, 'evolved.cordis.yml')
  const runRoot = join(root, 'runs')
  await mkdir(runRoot)
  await writeFile(nativeConfig, JSON.stringify(nativeRows, null, 2))
  await writeFile(evolvedConfig, JSON.stringify([
    ...nativeRows,
    {
      id: 'dsh-evolve',
      name: join(packageRoot, 'src', 'index.ts'),
      config: {
        supervisor: {
          runRoots: [{ workspaceId: WORKSPACE_ID, path: runRoot }],
          scanIntervalMs: 1_000,
        },
      },
    },
  ], null, 2))
  return { evolvedConfig, nativeConfig }
}

async function bootStorage(configPath: string) {
  const { boot } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return boot('dsh-evolve-generation-store-test', configPath)
}
