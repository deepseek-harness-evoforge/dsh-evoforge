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
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-github-review package boundary', () => {
  it('adds disabled, boots from the packed artifact, disposes, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-github-review-package-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-github-review-package-boundary',
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
    const tarball = join(root, 'dsh-github-review-0.1.0-alpha.1.tgz')
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
    const installed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(installed.dependencies?.['dsh-github-review']).toBeDefined()
    expect(installed.dsh.profile.bundles).toEqual(['dsh-github-review'])
    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', 'fixture', '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(dumped.stdout).toContain('id: evoforge-github-review')
    expect(dumped.stdout).toContain('name: dsh-github-review')
    expect(dumped.stdout).toContain('disabled: true')

    const packageScope = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageScope, { recursive: true })
    for (const [name, source] of [
      ['dsh-agent', join(dshSourceDir, 'packages', 'core', 'agent')],
      ['dsh-llm', join(dshSourceDir, 'packages', 'llm', 'llm')],
      ['dsh-session', join(dshSourceDir, 'packages', 'core', 'session')],
      ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
      ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
      ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ] as const) {
      const target = join(packageScope, name)
      await rm(target, { recursive: true, force: true })
      await symlink(source, target, 'dir')
    }
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      { id: 'session', name: '@deepseek-ai/dsh-session' },
      { id: 'agent', name: '@deepseek-ai/dsh-agent' },
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      {
        id: 'storage-json',
        name: '@deepseek-ai/dsh-storage-json',
        config: { root: join(root, 'storage') },
      },
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
      {
        id: 'github-review',
        name: 'dsh-github-review',
        config: {
          agentId: 'main',
          owner: 'deepseek-harness-evoforge',
          repo: 'dsh-evoforge',
          trustedReviewers: ['alice'],
          apiBase: 'http://127.0.0.1:1',
        },
      },
    ], null, 2))
    const ctx = await boot(installedConfig)
    try {
      const entry = [...ctx.loader.entries()]
        .find(candidate => candidate.options.name === 'dsh-github-review')
      expect(entry?.fiber?.state).toBe(2)
      expect(ctx.storageDomain.get('evoforge_github_review')).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-github-review'], root, env)
    const removed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removed.dependencies?.['dsh-github-review']).toBeUndefined()
    expect(removed.dsh.profile.bundles).toEqual([])
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
    throw new Error(`DSH profile command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, { cause: error })
  }
}

async function boot(configPath: string) {
  const appBoot = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  return appBoot.boot('dsh-github-review-package-test', configPath)
}
