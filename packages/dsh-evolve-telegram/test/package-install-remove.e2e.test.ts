import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as services from './fixtures/bridge-services.js'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const temporaryRoots: string[] = []

afterEach(async () => {
  services.reset()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-evolve-telegram package boundary', () => {
  it('adds disabled, boots from the packed artifact, catches up once, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-telegram-package-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-evolve-telegram-package-boundary',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }, null, 2)}\n`)
    await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
    await writeFile(
      join(profileDir, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    )

    await execFile('pnpm', ['pack', '--pack-destination', root], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 10_000,
    })).stdout.trim()
    const tarball = join(root, 'dsh-evolve-telegram-0.1.0-alpha.1.tgz')
    const env = {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      DSH_HOME: dshHome,
      npm_config_ignore_scripts: 'true',
      npm_config_store_dir: storePath,
    }
    await runDsh(
      ['plugin', '--profile', 'fixture', 'add', tarball, '--prefer-offline', '--ignore-scripts'],
      root,
      env,
    )
    const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(installedManifest.dependencies?.['dsh-evolve-telegram']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual(['dsh-evolve-telegram'])
    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', 'fixture', '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(dumped.stdout).toContain('id: evoforge-evolve-telegram')
    expect(dumped.stdout).toContain('name: dsh-evolve-telegram')
    expect(dumped.stdout).toContain('disabled: true')

    services.reset()
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      {
        id: 'services',
        name: join(packageRoot, 'test', 'fixtures', 'bridge-services.ts'),
      },
      { id: 'bridge', name: 'dsh-evolve-telegram' },
    ], null, 2))
    const ctx = await boot(installedConfig)
    try {
      const entry = [...ctx.loader.entries()]
        .find(candidate => candidate.options.name === 'dsh-evolve-telegram')
      expect(entry?.fiber?.state).toBe(2)
      const route = ctx.get('evoforge.telegramRoute') as {
        notices: Array<{ id: string; text: string }>
      } | undefined
      if (route === undefined) throw new Error('fixture Telegram route service did not load')
      await expect.poll(() => route.notices.length).toBe(1)
      expect(route.notices[0]?.text).toContain(`/evolve review ${services.reviewId}`)
      ctx.emit('evoforge/evolution/settled')
      await expect.poll(() => route.notices.length).toBe(2)
      expect(route.notices[1]?.id).toBe(route.notices[0]?.id)
    } finally {
      await ctx.fiber.dispose()
    }

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-evolve-telegram'], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-evolve-telegram']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])
  }, 60_000)
})

async function runDsh(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`DSH profile command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, {
      cause: error,
    })
  }
}

async function boot(configPath: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return appBoot.boot('dsh-evolve-telegram-package-test', configPath)
}
