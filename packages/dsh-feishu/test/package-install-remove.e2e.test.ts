import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const routerRoot = resolve(packageRoot, '../dsh-channel-router')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const corepackHome = process.env.COREPACK_HOME
  ?? join(process.env.HOME ?? '', 'Library', 'Caches', 'node', 'corepack')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('built dsh-feishu package boundary', () => {
  it('adds both Bundles to a clean profile, resolves the official SDK, dumps rows, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-package-install-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileDir = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-feishu-package-boundary',
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
      cwd: routerRoot, encoding: 'utf8', timeout: 30_000,
    })
    await execFile('pnpm', ['pack', '--pack-destination', root], {
      cwd: packageRoot, encoding: 'utf8', timeout: 30_000,
    })
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: packageRoot, encoding: 'utf8', timeout: 10_000,
    })).stdout.trim()
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
    await runDsh([
      'plugin', '--profile', 'fixture', 'add',
      join(root, 'dsh-channel-router-0.1.0-alpha.1.tgz'),
      join(root, 'dsh-feishu-0.1.0-alpha.1.tgz'),
      '--prefer-offline', '--ignore-scripts',
    ], root, env)

    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(manifest.dependencies?.['dsh-channel-router']).toBeDefined()
    expect(manifest.dependencies?.['dsh-feishu']).toBeDefined()
    expect(manifest.dsh.profile.bundles).toEqual(['dsh-channel-router', 'dsh-feishu'])
    const installedFeishuRoot = join(profileDir, 'node_modules', 'dsh-feishu')
    const installedFeishuManifest = JSON.parse(await readFile(join(installedFeishuRoot, 'package.json'), 'utf8'))
    expect(installedFeishuManifest.dsh).toMatchObject({
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    })
    expect(installedFeishuManifest.exports?.['./client']).toBe('./dist/client.js')
    const installedClient = await readFile(join(installedFeishuRoot, 'dist', 'client.js'), 'utf8')
    expect(installedClient).toContain('window.__ModuleLoader__.load({')
    expect(installedClient).toContain('id: "dsh-feishu"')
    expect(installedClient).toContain('sidebar.footer.action')
    const sdkManifest = JSON.parse(await readFile(
      join(profileDir, 'node_modules', '@larksuiteoapi', 'node-sdk', 'package.json'),
      'utf8',
    ))
    expect(sdkManifest.version).toBe('1.73.0')
    const dumped = await execFile(process.execPath, [dshBin, '--profile', 'fixture', '--dump-config'], {
      cwd: root, env, encoding: 'utf8', timeout: 30_000,
    })
    expect(dumped.stdout).toContain('id: evoforge-channel-router')
    expect(dumped.stdout).toContain('id: evoforge-feishu')
    expect(dumped.stdout).toContain('name: dsh-feishu')
    expect(dumped.stdout).toContain('disabled: true')

    await runDsh([
      'plugin', '--profile', 'fixture', 'remove', 'dsh-feishu', 'dsh-channel-router',
    ], root, env)
    const removed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removed.dependencies?.['dsh-feishu']).toBeUndefined()
    expect(removed.dependencies?.['dsh-channel-router']).toBeUndefined()
    expect(removed.dsh.profile.bundles).toEqual([])
    await expect(access(installedFeishuRoot)).rejects.toMatchObject({ code: 'ENOENT' })
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
