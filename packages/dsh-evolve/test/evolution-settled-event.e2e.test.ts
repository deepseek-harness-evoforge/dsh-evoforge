import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as EvolvePlugin from '../src/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('resident evolution settled signal', () => {
  it('emits after the existing supervisor scan without adding another timer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolution-settled-'))
    temporaryRoots.push(root)
    const runRoot = join(root, 'runs')
    await mkdir(runRoot)
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify([
      {
        id: 'storage',
        name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js'),
      },
      {
        id: 'storage-json',
        name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
        config: { root: join(root, 'storage') },
      },
      {
        id: 'storage-domain',
        name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
        config: { backend: 'json' },
      },
    ], null, 2))
    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const ctx = await boot('dsh-evolution-settled-test', config)
    let settled = 0
    ctx.on('evoforge/evolution/settled', () => { settled += 1 })
    try {
      await ctx.plugin(EvolvePlugin, {
        cacheRoot: join(root, 'cache'),
        supervisor: { runRoots: [runRoot], scanIntervalMs: 1_000 },
      })
      const jobs = await import(pathToFileURL(
        join(dshSourceDir, 'packages', 'jobs', 'jobs-local', 'lib', 'index.js'),
      ).href)
      await ctx.plugin(jobs.default)
      await expect.poll(() => settled).toBeGreaterThanOrEqual(1)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 15_000)
})
