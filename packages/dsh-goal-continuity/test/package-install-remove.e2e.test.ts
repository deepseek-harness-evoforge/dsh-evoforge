import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const corepackHome = process.env.COREPACK_HOME
  ?? join(process.env.HOME ?? '', 'Library', 'Caches', 'node', 'corepack')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-goal-continuity package boundary', () => {
  it('installs disabled, boots when explicitly configured, removes, and leaves native Goal clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-goal-continuity-package-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-goal-continuity-package-boundary',
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
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 10_000,
    })).stdout.trim()
    const tarball = join(root, 'dsh-goal-continuity-0.1.0-alpha.1.tgz')
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
      ['plugin', '--profile', 'fixture', 'add', tarball, '--prefer-offline', '--ignore-scripts'],
      root,
      env,
    )
    const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(installedManifest.dependencies?.['dsh-goal-continuity']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual(['dsh-goal-continuity'])
    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', 'fixture', '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(dumped.stdout).toContain('id: evoforge-goal-continuity')
    expect(dumped.stdout).toContain('name: dsh-goal-continuity')
    expect(dumped.stdout).toContain('disabled: true')

    const packageScope = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageScope, { recursive: true })
    const peerPackages = [
      ['core/agent', 'dsh-agent'],
      ['goal/goal', 'dsh-goal'],
    ] as const
    for (const [source, target] of peerPackages) {
      await symlink(join(dshSourceDir, 'packages', source), join(packageScope, target), 'dir')
    }
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    const nativeConfig = join(profileDir, 'native.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      { id: 'agents', name: '@deepseek-ai/dsh-agent' },
      { id: 'goals', name: '@deepseek-ai/dsh-goal' },
      {
        id: 'continuity',
        name: 'dsh-goal-continuity',
        config: { autoResumeSessionIds: [] },
      },
    ], null, 2))
    await writeFile(nativeConfig, JSON.stringify([
      { id: 'agents', name: '@deepseek-ai/dsh-agent' },
      { id: 'goals', name: '@deepseek-ai/dsh-goal' },
    ], null, 2))

    const installedCtx = await boot(installedConfig)
    try {
      expect(installedCtx.get('agents')).toBeDefined()
      expect(installedCtx.get('goals')).toBeDefined()
    } finally {
      await installedCtx.fiber.dispose()
    }

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-goal-continuity'], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-goal-continuity']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])

    const nativeCtx = await boot(nativeConfig)
    try {
      expect(nativeCtx.get('agents')).toBeDefined()
      expect(nativeCtx.get('goals')).toBeDefined()
    } finally {
      await nativeCtx.fiber.dispose()
    }
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
  return appBoot.boot('dsh-goal-continuity-package-test', configPath)
}
