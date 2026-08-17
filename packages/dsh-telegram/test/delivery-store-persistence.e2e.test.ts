import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openTelegramDeliveryStore } from '../src/delivery-store.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('Telegram Storage Domain crash recovery', () => {
  it('reopens a real JSON domain and quarantines a pre-crash sending record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-telegram-store-restart-'))
    temporaryRoots.push(root)
    const config = await writeStorageConfig(root)

    const firstCtx = await boot(config)
    const first = await openTelegramDeliveryStore(firstCtx.storageDomain)
    const prepared = await first.prepareTurn({ now: 100, sessionId: 'main', turn: 1 })
    await first.markSending(prepared.record.id, 200)
    await first.close()
    await firstCtx.fiber.dispose()

    const resumedCtx = await boot(config)
    const resumed = await openTelegramDeliveryStore(resumedCtx.storageDomain)
    try {
      expect(resumed.get(prepared.record.id)).toMatchObject({ status: 'sending', attempts: 1 })
      await expect(resumed.recoverInflight(300)).resolves.toBe(1)
      expect(resumed.get(prepared.record.id)).toMatchObject({
        status: 'uncertain',
        error: expect.stringContaining('automatic retry is disabled'),
      })
    } finally {
      await resumed.close()
      await resumedCtx.fiber.dispose()
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
  const config = join(root, 'cordis.yml')
  await writeFile(config, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    {
      id: 'storage-json',
      name: '@deepseek-ai/dsh-storage-json',
      config: { root: join(root, 'storage') },
    },
    { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
  ], null, 2))
  return config
}

async function boot(config: string) {
  const appBoot = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  return appBoot.boot('dsh-telegram-store-restart-test', config)
}
