import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { openEvolutionStore, type EvolutionStore } from '../src/generation-store.js'

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
    const expected = {
      id: '40ff403557630f5b5433dd161926d5a2a90e797d4525d82fd6dc80a9712ecf5a',
      schemaVersion: 1,
      ...input,
    }

    const firstCtx = await bootStorage(configPath)
    const firstStore = await openEvolutionStore(firstCtx.storageDomain)
    try {
      expect(await firstStore.publishGeneration(input)).toEqual({ created: true, generation: expected })
      expect(await firstStore.publishGeneration(input)).toEqual({ created: false, generation: expected })
      const loaded = firstStore.getGeneration(expected.id)
      expect(loaded).toEqual(expected)
      expect(Object.isFrozen(loaded)).toBe(true)
      expect(Object.isFrozen(loaded?.artifacts)).toBe(true)
      expect(Object.isFrozen(loaded?.artifacts[0])).toBe(true)
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openEvolutionStore(resumedCtx.storageDomain)
    try {
      expect(resumedStore.getGeneration(expected.id)).toEqual(expected)
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
    const rootId = '40ff403557630f5b5433dd161926d5a2a90e797d4525d82fd6dc80a9712ecf5a'
    const candidateInput = {
      parentId: rootId,
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
    }
    const candidateId = '259e4870a6e10163c66b42110c795edad083ba5025ff010af924cea1bcb97f3a'

    const publishingCtx = await bootStorage(configPath)
    const publishingStore = await openEvolutionStore(publishingCtx.storageDomain)
    try {
      const rootGeneration = (await publishingStore.publishGeneration(rootInput)).generation
      expect(await publishingStore.promoteGeneration(rootId)).toEqual({
        previousId: undefined,
        generation: rootGeneration,
      })
      await publishingStore.publishGeneration(candidateInput)
      expect(publishingStore.getActiveGeneration()).toEqual(rootGeneration)
    } finally {
      await publishingStore.close()
      await publishingCtx.fiber.dispose()
    }

    const promotingCtx = await bootStorage(configPath)
    const promotingStore = await openEvolutionStore(promotingCtx.storageDomain)
    try {
      const rootGeneration = promotingStore.getGeneration(rootId)
      const candidateGeneration = promotingStore.getGeneration(candidateId)
      expect(promotingStore.getActiveGeneration()).toEqual(rootGeneration)
      expect(await promotingStore.promoteGeneration(candidateId)).toEqual({
        previousId: rootId,
        generation: candidateGeneration,
      })
      expect(await promotingStore.rollbackGeneration()).toEqual({
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
      expect(recoveredStore.getActiveGeneration()?.id).toBe(rootId)
      expect(await recoveredStore.rollbackGeneration()).toEqual({
        previousId: rootId,
        generation: undefined,
      })
      expect(recoveredStore.getActiveGeneration()).toBeUndefined()
    } finally {
      await recoveredStore.close()
      await recoveredCtx.fiber.dispose()
    }

    const nativeCtx = await bootStorage(configPath)
    const nativeStore = await openEvolutionStore(nativeCtx.storageDomain)
    try {
      expect(nativeStore.getActiveGeneration()).toBeUndefined()
    } finally {
      await nativeStore.close()
      await nativeCtx.fiber.dispose()
    }
  })

  it('durably pins a native Session and its children to native DSH before the first promotion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-native-session-pins-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = {
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
    const native = { sessionId: 'native-before-promotion', createdAt: 10 }
    const nativeChild = { sessionId: 'native-child-after-promotion', createdAt: 11 }
    const evolved = { sessionId: 'evolved-after-promotion', createdAt: 12 }

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    const generation = (await store.publishGeneration(input)).generation
    try {
      expect(await store.pinSession(native)).toBeUndefined()
      await store.promoteGeneration(generation.id)
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
    const rootId = '40ff403557630f5b5433dd161926d5a2a90e797d4525d82fd6dc80a9712ecf5a'
    const candidateInput = {
      parentId: rootId,
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
    }
    const candidateId = '259e4870a6e10163c66b42110c795edad083ba5025ff010af924cea1bcb97f3a'
    const existing = { sessionId: 'existing', createdAt: 10, cwd: '/workspace/project' }
    const fresh = { sessionId: 'fresh', createdAt: 11, cwd: '/workspace/project' }
    const child = { sessionId: 'child', createdAt: 12, cwd: '/workspace/project' }

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    try {
      await store.publishGeneration(rootInput)
      await store.promoteGeneration(rootId)
      expect((await store.pinSession(existing))?.id).toBe(rootId)

      await store.publishGeneration(candidateInput)
      await store.promoteGeneration(candidateId)
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

  it('loads as a removable host-only DSH plugin without changing model composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-runtime-plugin-'))
    temporaryRoots.push(root)
    const { evolvedConfig, nativeConfig } = await writeRuntimeConfigs(root)
    const input = {
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
      expect(await nativeCtx.systemPrompt.assemble()).toEqual(before)
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
    const rootId = '40ff403557630f5b5433dd161926d5a2a90e797d4525d82fd6dc80a9712ecf5a'
    const candidateInput = {
      parentId: rootId,
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
    }
    const candidateId = '259e4870a6e10163c66b42110c795edad083ba5025ff010af924cea1bcb97f3a'
    const oldLifecycle = { sessionId: 'reused', createdAt: 10 }
    const currentLifecycle = { sessionId: 'reused', createdAt: 20 }
    const child = { sessionId: 'child-of-reused', createdAt: 21 }

    const ctx = await bootStorage(configPath)
    const store = await openEvolutionStore(ctx.storageDomain)
    try {
      await store.publishGeneration(rootInput)
      await store.promoteGeneration(rootId)
      expect((await store.pinSession(oldLifecycle))?.id).toBe(rootId)

      await store.publishGeneration(candidateInput)
      await store.promoteGeneration(candidateId)
      expect((await store.pinSession(currentLifecycle))?.id).toBe(candidateId)
      expect(store.getSessionGeneration(oldLifecycle)).toBeUndefined()
      expect((await store.pinSession(child, { parentSessionId: 'reused' }))?.id).toBe(candidateId)
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })
})

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
    ['dsh-system-prompt', join(dshSourceDir, 'packages', 'core', 'system-prompt')],
    ['dsh-jobs-local', join(dshSourceDir, 'packages', 'jobs', 'jobs-local')],
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
      config: { supervisor: { runRoots: [runRoot], scanIntervalMs: 1_000 } },
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
