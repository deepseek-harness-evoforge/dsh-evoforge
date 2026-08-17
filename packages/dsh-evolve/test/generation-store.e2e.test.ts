import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { openEvolutionStore, type EvolutionStore } from '../src/generation-store.js'
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
      if (expected === undefined) throw new Error('expected Generation was not published')
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
      expect(await promotingStore.rollbackGeneration(WORKSPACE_ID)).toEqual({
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
      expect(await recoveredStore.rollbackGeneration(WORKSPACE_ID)).toEqual({
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
      await resumedStore.rollbackGeneration(WORKSPACE_ID)
      expect(resumedStore.isRecoveryPaused(WORKSPACE_ID)).toBe(true)
      await expect(resumedStore.setRecoveryPaused(WORKSPACE_ID, false)).resolves.toEqual({ changed: true, paused: false })
      await expect(resumedStore.setRecoveryPaused(WORKSPACE_ID, false)).resolves.toEqual({ changed: false, paused: false })
    } finally {
      await resumedStore.close()
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

  it('loads as a removable host-only DSH plugin without changing model composition', async () => {
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
})

function session(sessionId: string, createdAt: number) {
  return {
    workspaceId: WORKSPACE_ID,
    sessionId,
    createdAt,
    cwd: '/workspace/project',
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
    ['dsh-session', join(dshSourceDir, 'packages', 'core', 'session')],
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
    { id: 'session', name: '@deepseek-ai/dsh-session' },
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
