import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-evolve package boundary', () => {
  it('installs the packed plugin into a real profile, boots it, removes it, and boots native DSH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-package-install-'))
    temporaryRoots.push(root)
    const home = join(root, 'dsh-home')
    const profileDir = join(home, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-evolve-package-boundary',
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
    const tarball = join(root, 'dsh-evolve-0.1.0-alpha.1.tgz')
    const env = {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      DSH_HOME: home,
      HOME: root,
      npm_config_ignore_scripts: 'true',
      npm_config_store_dir: storePath,
    }
    await runDsh(
      ['plugin', '--profile', 'fixture', 'add', tarball, '--prefer-offline', '--ignore-scripts'],
      root,
      env,
    )
    const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(installedManifest.dependencies?.['dsh-evolve']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual([])

    await linkPinnedRuntime(profileDir)
    const nativeRows = [
      {
        id: 'system-prompt',
        name: '@deepseek-ai/dsh-system-prompt',
        config: { persona: 'Stable packed-package fixture.' },
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
    ]
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    const nativeConfig = join(profileDir, 'native.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      ...nativeRows,
      { id: 'dsh-evolve', name: 'dsh-evolve', config: { sources: [] } },
    ], null, 2))
    await writeFile(nativeConfig, JSON.stringify(nativeRows, null, 2))

    const installedCtx = await boot(installedConfig)
    const installedComposition = await installedCtx.systemPrompt.assemble()
    expect(installedCtx.get('evoforge.evolution')).toBeDefined()
    await installedCtx.fiber.dispose()
    expect(installedCtx.get('evoforge.evolution')).toBeUndefined()

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-evolve'], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-evolve']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])

    const nativeCtx = await boot(nativeConfig)
    try {
      expect(nativeCtx.get('evoforge.evolution')).toBeUndefined()
      expect(await nativeCtx.systemPrompt.assemble()).toEqual(installedComposition)
    } finally {
      await nativeCtx.fiber.dispose()
    }
  }, 60_000)
})

async function linkPinnedRuntime(profileDir: string): Promise<void> {
  const scope = join(profileDir, 'node_modules', '@deepseek-ai')
  await mkdir(scope, { recursive: true })
  for (const [name, source] of [
    ['dsh-invariants', join(dshSourceDir, 'packages', 'runtime-diagnostics', 'invariants')],
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
    ['dsh-system-prompt', join(dshSourceDir, 'packages', 'core', 'system-prompt')],
    ['dsh-typert-protocol', join(dshSourceDir, 'packages', 'typert', 'protocol')],
  ] as const) {
    await symlink(source, join(scope, name), 'dir')
  }
}

async function runDsh(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(
      `DSH profile command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      { cause: error },
    )
  }
}

async function boot(configPath: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return appBoot.boot('dsh-evolve-package-install-test', configPath)
}
