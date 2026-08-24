import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
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

describe.skipIf(process.platform !== 'darwin')('built dsh-doctor package boundary', () => {
  it('adds its Bundle, observes Gateway health across reload, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doctor-package-install-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-doctor-package-boundary',
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
    const tarball = join(root, 'dsh-doctor-0.1.0-alpha.1.tgz')
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
    expect(installedManifest.dependencies?.['dsh-doctor']).toBeDefined()
    expect(installedManifest.dsh.profile.bundles).toEqual(['dsh-doctor'])
    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', 'fixture', '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(dumped.stdout).toContain('id: evoforge-doctor')
    expect(dumped.stdout).toContain('name: dsh-doctor')

    const packageScope = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageScope, { recursive: true })
    await symlink(join(dshSourceDir, 'packages', 'interaction', 'commands'), join(packageScope, 'dsh-commands'), 'dir')

    // This test-only Adapter supplies the same redacted Gateway service that the
    // production dsh-gateway owns.  The plugin under test is the final packed
    // dsh-doctor artifact; the fixture only makes failure/recovery deterministic.
    const fixtureRoot = join(root, 'fixture-dsh-feishu')
    await mkdir(fixtureRoot, { recursive: true })
    await writeFile(join(fixtureRoot, 'package.json'), `${JSON.stringify({
      name: 'dsh-feishu',
      version: '0.0.0-test',
      type: 'module',
      exports: './index.mjs',
    }, null, 2)}\n`)
    await writeFile(join(fixtureRoot, 'index.mjs'), [
      "export const name = 'dsh-feishu-test-adapter'",
      'export function apply(ctx, config = {}) {',
      "  const state = config.state ?? 'degraded'",
      "  ctx.provide('evoforge.gateway', Object.freeze({",
      '    healthSnapshot() {',
      "      return { lifecycle: 'ready', transports: { items: [{ adapter: 'feishu', state }] } }",
      '    },',
      '  }))',
      '}',
      '',
    ].join('\n'))
    await symlink(fixtureRoot, join(profileDir, 'node_modules', 'dsh-feishu'), 'dir')
    const installedConfig = join(profileDir, 'installed.cordis.yml')
    await writeFile(installedConfig, JSON.stringify([
      { id: 'commands', name: '@deepseek-ai/dsh-commands' },
      { id: 'feishu', name: 'dsh-feishu', config: { state: 'degraded' } },
      { id: 'doctor', name: 'dsh-doctor', config: { requiredModules: ['dsh-doctor', 'dsh-feishu'] } },
    ], null, 2))

    const ctx = await boot(installedConfig)
    const agent = {} as Agent
    try {
      const command = ctx.commands.find(agent, 'doctor')
      const result = await command?.handler({
        commandId: 'package-boundary' as never,
        agent,
        rawInput: '',
        signal: new AbortController().signal,
      })
      expect(result).toMatchObject({ kind: 'success' })
      expect(result?.text).toContain('DSH readiness: NOT READY')
      expect(result?.text).toContain('Required Feishu transport is degraded.')

      const feishuEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'feishu')
      if (feishuEntry === undefined) throw new Error('installed fixture Feishu entry is missing')
      await feishuEntry.update({ config: { state: 'ready' } })
      await ctx.loader.await()

      const recovered = await command?.handler({
        commandId: 'package-boundary-recovered' as never,
        agent,
        rawInput: '',
        signal: new AbortController().signal,
      })
      expect(recovered).toMatchObject({ kind: 'success' })
      expect(recovered?.text).toContain('DSH readiness: READY')
      expect(recovered?.text).toContain('2 required plugins are active.')
      expect(recovered?.text).toContain('1 required Feishu transport is ready.')
    } finally {
      await ctx.fiber.dispose()
    }

    await runDsh(['plugin', '--profile', 'fixture', 'remove', 'dsh-doctor'], root, env)
    const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removedManifest.dependencies?.['dsh-doctor']).toBeUndefined()
    expect(removedManifest.dsh.profile.bundles).toEqual([])
  }, 60_000)
})

async function runDsh(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], { cwd, env, encoding: 'utf8', timeout: 60_000 })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`DSH profile command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, { cause: error })
  }
}

async function boot(configPath: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return appBoot.boot('dsh-doctor-package-install-test', configPath)
}
