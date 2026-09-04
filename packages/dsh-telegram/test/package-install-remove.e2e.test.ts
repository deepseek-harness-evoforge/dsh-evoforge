import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gatewayRoot = resolve(packageRoot, '../dsh-gateway')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const corepackHome = process.env.COREPACK_HOME
  ?? join(process.env.HOME ?? '', 'Library', 'Caches', 'node', 'corepack')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-telegram package boundary', () => {
  it('adds the disabled-by-default Bundle, boots the packed plugin, disposes, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-telegram-package-install-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-telegram-package-boundary',
      private: true,
      packageManager: 'pnpm@11.7.0',
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
    await execFile('pnpm', ['pack', '--pack-destination', root], {
      cwd: gatewayRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 10_000,
    })).stdout.trim()
    const tarball = join(root, 'dsh-evoforge-telegram-0.1.0-alpha.1.tgz')
    const gatewayTarball = join(root, 'dsh-evoforge-gateway-0.1.0-alpha.1.tgz')
    const env = {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_DEFAULT_TO_LATEST: '0',
      COREPACK_HOME: corepackHome,
      DSH_HOME: dshHome,
      HOME: root,
      npm_config_ignore_scripts: 'true',
      npm_config_store_dir: storePath,
    }
    await runDsh(
      ['plugin', '--profile', 'fixture', 'add', gatewayTarball, tarball, '--prefer-offline', '--ignore-scripts'],
      root,
      env,
    )
    const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(installedManifest.dependencies?.['dsh-evoforge-telegram']).toBeDefined()
    expect(installedManifest.dependencies?.['dsh-evoforge-gateway']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual(['dsh-evoforge-gateway', 'dsh-evoforge-telegram'])
    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', 'fixture', '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(dumped.stdout).toContain('id: evoforge-telegram')
    expect(dumped.stdout).toContain('name: dsh-evoforge-telegram')
    expect(dumped.stdout).toContain('id: evoforge-gateway')
    expect(dumped.stdout).toContain('disabled: true')

    const packageScope = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageScope, { recursive: true })
    for (const [name, source] of [
      ['cordis', join(dshSourceDir, 'vendor', 'cordis')],
      ['dsh-brand', join(dshSourceDir, 'packages', 'util', 'brand')],
      ['dsh-agent', join(dshSourceDir, 'packages', 'core', 'agent')],
      ['dsh-commands', join(dshSourceDir, 'packages', 'interaction', 'commands')],
      ['dsh-credentials', join(dshSourceDir, 'packages', 'credentials', 'credentials')],
      ['dsh-llm', join(dshSourceDir, 'packages', 'llm', 'llm')],
      ['dsh-session', join(dshSourceDir, 'packages', 'core', 'session')],
      ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
      ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
      ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
      ['dsh-workspace', join(dshSourceDir, 'packages', 'workspace', 'workspace')],
    ] as const) {
      const target = join(packageScope, name)
      await rm(target, { force: true, recursive: true })
      await symlink(source, target, 'dir')
    }
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      {
        id: 'credentials',
        name: join(packageRoot, 'test', 'fixtures', 'credentials-bootstrap.ts'),
      },
      { id: 'session', name: '@deepseek-ai/dsh-session' },
      { id: 'agent', name: '@deepseek-ai/dsh-agent' },
      { id: 'commands', name: '@deepseek-ai/dsh-commands' },
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      {
        id: 'storage-json',
        name: '@deepseek-ai/dsh-storage-json',
        config: { root: join(root, 'storage') },
      },
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
      {
        id: 'channel-gateway-fixture',
        name: join(packageRoot, 'test', 'fixtures', 'package-gateway-service.ts'),
      },
      {
        id: 'telegram',
        name: 'dsh-evoforge-telegram',
        config: {
          apiBase: 'http://127.0.0.1:1',
          pollTimeoutSeconds: 1,
          routeId: 'telegram-package',
          tokenEnv: 'DSH_TELEGRAM_PACKAGE_TEST_TOKEN',
        },
      },
    ], null, 2))
    vi.stubEnv('DSH_TELEGRAM_PACKAGE_TEST_TOKEN', 'test-token')
    const ctx = await boot(installedConfig)
    try {
      const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'dsh-evoforge-telegram')
      expect(entry?.fiber?.state).toBe(2)
      expect(ctx.storageDomain.get('evoforge_telegram')).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }

    await runDsh([
      'plugin', '--profile', 'fixture', 'remove', 'dsh-evoforge-telegram', 'dsh-evoforge-gateway',
    ], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-evoforge-telegram']).toBeUndefined()
    expect(removedManifest.dependencies?.['dsh-evoforge-gateway']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])
  }, 60_000)
})

async function runDsh(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], { cwd, env, encoding: 'utf8', timeout: 30_000 })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`DSH profile command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, { cause: error })
  }
}

async function boot(configPath: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return appBoot.boot('dsh-telegram-package-install-test', configPath)
}
