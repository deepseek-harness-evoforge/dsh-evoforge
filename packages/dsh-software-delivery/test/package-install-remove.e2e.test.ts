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
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-software-delivery package boundary', () => {
  it('installs into a real profile, boots, unloads, removes, and leaves native DSH clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-package-install-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-delivery-package-boundary',
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
    const tarball = join(root, 'dsh-software-delivery-0.1.0-alpha.1.tgz')
    const env = {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
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
    expect(installedManifest.dependencies?.['dsh-software-delivery']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual([])

    const packageScope = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageScope, { recursive: true })
    await symlink(join(dshSourceDir, 'packages', 'skill', 'skill'), join(packageScope, 'dsh-skill'), 'dir')
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    const nativeConfig = join(profileDir, 'native.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      { id: 'skill', name: '@deepseek-ai/dsh-skill' },
      { id: 'dsh-software-delivery', name: 'dsh-software-delivery' },
    ], null, 2))
    await writeFile(nativeConfig, JSON.stringify([
      { id: 'skill', name: '@deepseek-ai/dsh-skill' },
    ], null, 2))

    const installedCtx = await boot(installedConfig)
    const installedSkill = await installedCtx.skills.get('software-delivery')
    expect(installedSkill?.content).toContain('dsh-delivery verify')
    await installedCtx.fiber.dispose()
    expect(installedCtx.get('skills')).toBeUndefined()

    const repository = join(root, 'repository')
    const worktree = join(root, 'delivery-worktree')
    await git(root, 'init', '--initial-branch=main', repository)
    await git(repository, 'config', 'user.name', 'DSH Delivery Test')
    await git(repository, 'config', 'user.email', 'delivery@example.invalid')
    await writeFile(join(repository, 'README.md'), 'baseline\n')
    await git(repository, 'add', 'README.md')
    await git(repository, 'commit', '-m', 'baseline')
    await git(repository, 'worktree', 'add', '-b', 'feature/packed-delivery', worktree)
    await writeFile(join(worktree, 'feature.txt'), 'delivered\n')
    await git(worktree, 'add', 'feature.txt')
    await git(worktree, 'commit', '-m', 'deliver feature')
    const verificationConfig = join(root, 'delivery.json')
    await writeFile(verificationConfig, JSON.stringify({
      schemaVersion: 1,
      baseRef: 'main',
      checks: [{ name: 'packed-cli', argv: [process.execPath, '-e', 'process.exit(0)'] }],
    }))
    const cliPath = join(profileDir, 'node_modules', 'dsh-software-delivery', 'dist', 'cli.mjs')
    const cli = await execFile(process.execPath, [
      cliPath,
      'verify',
      '--worktree', worktree,
      '--config', verificationConfig,
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(JSON.parse(cli.stdout)).toMatchObject({
      status: 'passed',
      reason: 'verified',
      repository: { branch: 'feature/packed-delivery', ahead: 1 },
    })

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-software-delivery'], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-software-delivery']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])

    const nativeCtx = await boot(nativeConfig)
    try {
      expect(await nativeCtx.skills.get('software-delivery')).toBeUndefined()
      expect(await nativeCtx.skills.list()).toEqual([])
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

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}

async function boot(configPath: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return appBoot.boot('dsh-software-delivery-package-install-test', configPath)
}
