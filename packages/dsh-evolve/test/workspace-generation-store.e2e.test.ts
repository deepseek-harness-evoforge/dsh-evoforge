import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openEvolutionStore } from '../src/generation-store.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222'

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('Workspace-scoped Capability Generation store', () => {
  it('isolates active pointers and pins, rejects cross-Workspace references, and survives restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-workspace-generations-'))
    temporaryRoots.push(root)
    const config = await writeStorageConfig(root)
    const firstCtx = await bootStorage(config)
    const first = await openEvolutionStore(firstCtx.storageDomain)
    let rootAId = ''
    let candidateAId = ''
    let rootBId = ''
    try {
      rootAId = (await first.publishGeneration(generation(WORKSPACE_A, 1))).generation.id
      rootBId = (await first.publishGeneration(generation(WORKSPACE_B, 2))).generation.id
      expect(rootAId).not.toBe(rootBId)
      await first.promoteGeneration(WORKSPACE_A, rootAId)
      await first.promoteGeneration(WORKSPACE_B, rootBId)
      await first.pinSession(session(WORKSPACE_A, 'a-old', 10))

      candidateAId = (await first.publishGeneration(generation(WORKSPACE_A, 3, rootAId))).generation.id
      await first.promoteGeneration(WORKSPACE_A, candidateAId)
      expect(first.getActiveGeneration(WORKSPACE_A)?.id).toBe(candidateAId)
      expect(first.getActiveGeneration(WORKSPACE_B)?.id).toBe(rootBId)
      expect((await first.pinSession(session(WORKSPACE_A, 'a-old', 10)))?.id).toBe(rootAId)
      expect((await first.pinSession(session(WORKSPACE_A, 'a-new', 11)))?.id).toBe(candidateAId)
      expect((await first.pinSession(session(WORKSPACE_B, 'b-new', 12)))?.id).toBe(rootBId)

      await expect(first.promoteGeneration(WORKSPACE_B, candidateAId))
        .rejects.toThrow('belongs to Workspace')
      await expect(first.publishGeneration(generation(WORKSPACE_B, 4, candidateAId)))
        .rejects.toThrow('parent Generation')
      await expect(first.pinSession(session(WORKSPACE_B, 'cross-child', 13), {
        parentSessionId: 'a-old',
      })).rejects.toThrow('different Workspace')
    } finally {
      await first.close()
      await firstCtx.fiber.dispose()
    }

    const secondCtx = await bootStorage(config)
    const second = await openEvolutionStore(secondCtx.storageDomain)
    try {
      expect(second.getActiveGeneration(WORKSPACE_A)?.id).toBe(candidateAId)
      expect(second.getActiveGeneration(WORKSPACE_B)?.id).toBe(rootBId)
      expect(second.getSessionGeneration(session(WORKSPACE_A, 'a-old', 10))?.id).toBe(rootAId)
      expect(second.getSessionGeneration(session(WORKSPACE_A, 'a-new', 11))?.id).toBe(candidateAId)
      expect(second.getSessionGeneration(session(WORKSPACE_B, 'b-new', 12))?.id).toBe(rootBId)
    } finally {
      await second.close()
      await secondCtx.fiber.dispose()
    }
  })
})

function generation(workspaceId: string, createdAt: number, parentId?: string) {
  return {
    workspaceId,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt,
    artifacts: [{
      kind: 'skill' as const,
      name: 'workspace-skill',
      gitCommit: `${createdAt}`.padStart(40, '0'),
      treeHash: `${createdAt}`.padStart(64, '0'),
    }],
    evaluatorVersion: 'workspace-evaluator-v1',
    policyVersion: 'workspace-policy-v1',
    compositionFingerprint: `${createdAt + 10}`.padStart(64, '0'),
  }
}

function session(workspaceId: string, sessionId: string, createdAt: number) {
  return { workspaceId, sessionId, createdAt, cwd: `/workspace/${workspaceId}` }
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
  const { boot } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  return boot('dsh-evolve-workspace-generation-store-test', configPath)
}
