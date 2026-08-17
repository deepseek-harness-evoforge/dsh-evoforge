import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openEvolutionStore } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const driverPath = join(packageRoot, 'test', 'fixtures', 'generation-crash-driver.mjs')
const storeSource = join(packageRoot, 'src', 'generation-store.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('Generation crash recovery', () => {
  it('recovers exact inactive, active, and rolled-back states after SIGKILL at durable boundaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-generation-crash-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const input = rootGenerationInput()
    const inputPath = join(root, 'root-generation.json')
    await writeFile(inputPath, JSON.stringify(input))

    await expectCrash(configPath, 'before-publish', inputPath)
    await withStore(configPath, (store) => {
      expect(store.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
    })

    await expectCrash(configPath, 'after-publish', inputPath)
    let rootGenerationId = ''
    await withStore(configPath, async (store) => {
      const recovered = await store.publishGeneration(input)
      expect(recovered.created).toBe(false)
      rootGenerationId = recovered.generation.id
      expect(store.getGeneration(rootGenerationId)?.id).toBe(rootGenerationId)
      expect(store.getActiveGeneration(WORKSPACE_ID)).toBeUndefined()
    })

    await expectCrash(configPath, 'after-promote', inputPath)
    await withStore(configPath, (store) => {
      expect(store.getActiveGeneration(WORKSPACE_ID)?.id).toBe(rootGenerationId)
    })

    const childInput = {
      ...rootGenerationInput(),
      parentId: rootGenerationId,
      createdAt: 1_723_456_789_001,
      artifacts: [{
        kind: 'skill' as const,
        name: 'build-dsh-plugin',
        gitCommit: '89abcdef0123456789abcdef0123456789abcdef',
        treeHash: 'c'.repeat(64),
      }],
      compositionFingerprint: 'd'.repeat(64),
    }
    let childId = ''
    await withStore(configPath, async (store) => {
      childId = (await store.publishGeneration(childInput)).generation.id
      await store.promoteGeneration(WORKSPACE_ID, childId)
      expect(store.getActiveGeneration(WORKSPACE_ID)?.id).toBe(childId)
    })

    await expectCrash(configPath, 'after-rollback', inputPath)
    await withStore(configPath, (store) => {
      expect(store.getActiveGeneration(WORKSPACE_ID)?.id).toBe(rootGenerationId)
      expect(store.getGeneration(childId)?.parentId).toBe(rootGenerationId)
    })
  })
})

function rootGenerationInput() {
  return {
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
}

async function expectCrash(configPath: string, action: string, inputPath: string): Promise<void> {
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [
      driverPath,
      configPath,
      dshSourceDir,
      storeSource,
      action,
      inputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', rejectChild)
    child.on('close', (code, signal) => {
      if (code !== null && code !== 0) rejectChild(new Error(stderr || `crash child exited ${code}`))
      else resolveChild({ code, signal })
    })
  })
  expect(outcome).toEqual({ code: null, signal: 'SIGKILL' })
}

async function withStore(
  configPath: string,
  use: (store: Awaited<ReturnType<typeof openEvolutionStore>>) => void | Promise<void>,
): Promise<void> {
  const ctx = await bootStorage(configPath)
  const store = await openEvolutionStore(ctx.storageDomain)
  try {
    await use(store)
  } finally {
    await store.close()
    await ctx.fiber.dispose()
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
  return boot('dsh-evolve-generation-crash-test', configPath)
}
