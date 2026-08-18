import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openCapabilityGapStore } from '../src/capability-gap-store.ts'
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
      await store.record(gapInput(3, 'third-missing'))
      const retained = store.list(WORKSPACE_ID)
      expect(retained.map(gap => gap.requestedSkill)).toEqual(['third-missing', 'second-missing'])
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
