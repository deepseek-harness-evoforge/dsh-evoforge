import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [candidateInput, dshInput, pnpmInput] = process.argv.slice(2)
if (candidateInput === undefined || dshInput === undefined || pnpmInput === undefined) {
  throw new Error('profile-install-remove evaluator requires <candidate-dir> <dsh-source-dir> <pnpm-bin>')
}

const candidateDir = await realpath(candidateInput)
const dshDir = await realpath(dshInput)
const workspace = dirname(candidateDir)
const skillSource = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
const bundleRequired = skillSource.includes('Use a **Bundle** only when installation should automatically add a profile patch layer')
  || skillSource.includes('Use a Bundle when installation should automatically add a profile patch layer')
const dshBin = join(dshDir, 'apps', 'cli', 'lib', 'bin.js')
const home = join(workspace, 'dsh-home')
const profileDir = join(home, 'profiles', 'fixture')
const bundleDir = join(workspace, 'bundle-source')
const marker = join(workspace, 'profile-loaded.txt')
const packageName = 'dsh-evoforge-profile-fixture'

await mkdir(profileDir, { recursive: true })
await mkdir(bundleDir)
await writeFile(join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-fixture',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: [] } },
}, null, 2) + '\n')
await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
await writeFile(join(bundleDir, 'package.json'), JSON.stringify(bundleManifest(bundleRequired), null, 2) + '\n')
await writeFile(join(bundleDir, 'plugin.mjs'), `
import { writeFileSync } from 'node:fs'

export const name = 'evoforge-profile-fixture'

export function apply(_ctx, config = {}) {
  writeFileSync(config.marker, String(config.value ?? 'missing'))
}
`)
await writeFile(join(bundleDir, 'cordis.patch.yml'), `
- insert:
    - id: evoforge-profile-fixture
      name: '${packageName}'
      config:
        marker: ${JSON.stringify(marker)}
        value: installed
`)

const baseEnv = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  DSH_HOME: home,
  HOME: workspace,
  PATH: `${dirname(pnpmInput)}:${dirname(process.execPath)}:/usr/bin:/bin`,
  PNPM_HOME: join(workspace, '.pnpm-home'),
  TMPDIR: join(workspace, '.trial-tmp'),
  XDG_CACHE_HOME: join(workspace, '.cache'),
  npm_config_ignore_scripts: 'true',
  npm_config_store_dir: join(workspace, '.pnpm-store'),
}
const initialDump = await runDsh(['--profile', 'fixture', '--dump-config'], baseEnv)
const parse = await runBounded(process.execPath, ['--check', join(bundleDir, 'plugin.mjs')], {
  cwd: workspace,
  env: baseEnv,
  maxBytes: 128 * 1024,
  timeoutMs: 5_000,
})
const add = await runDsh(
  ['plugin', '--profile', 'fixture', 'add', bundleDir, '--offline', '--ignore-scripts'],
  baseEnv,
)
if (add.exitCode !== 0) {
  throw new Error(`real dsh plugin add failed: ${add.stderr.trim() || add.stdout.trim() || `exit ${add.exitCode}`}`)
}
const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
const installedDump = await runDsh(['--profile', 'fixture', '--dump-config'], baseEnv)
await rm(marker, { force: true })
const installedConfig = join(profileDir, 'installed.cordis.yml')
await writeFile(installedConfig, installedDump.stdout.trim() === '' ? '[]\n' : installedDump.stdout)
const { boot } = await import(pathToFileURL(join(dshDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href)
let installedCtx
try {
  installedCtx = await boot('profile-install-remove-installed', installedConfig)
} finally {
  await installedCtx?.fiber.dispose()
}
const markerValue = await readFile(marker, 'utf8').catch(() => '')

const remove = await runDsh(
  ['plugin', '--profile', 'fixture', 'remove', packageName],
  baseEnv,
)
if (remove.exitCode !== 0) {
  throw new Error(`real dsh plugin remove failed: ${remove.stderr.trim() || remove.stdout.trim() || `exit ${remove.exitCode}`}`)
}
const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
const removedDump = await runDsh(['--profile', 'fixture', '--dump-config'], baseEnv)
await rm(marker, { force: true })
const nativeConfig = join(profileDir, 'native.cordis.yml')
await writeFile(nativeConfig, removedDump.stdout.trim() === '' ? '[]\n' : removedDump.stdout)
let nativeCtx
try {
  nativeCtx = await boot('profile-install-remove-native', nativeConfig)
} finally {
  await nativeCtx?.fiber.dispose()
}
const markerAfterRemoval = await readFile(marker, 'utf8').catch(() => undefined)

const selectedBundles = installedManifest.dsh?.profile?.bundles ?? []
const removedBundles = removedManifest.dsh?.profile?.bundles ?? []
const installedRows = occurrences(installedDump.stdout, 'id: evoforge-profile-fixture')
const checks = [
  { name: 'plugin-parse', passed: parse.exitCode === 0 },
  { name: 'real-dsh-plugin-add', passed: add.exitCode === 0 },
  {
    name: 'bundle-selected-on-install',
    passed: selectedBundles.length === 1 && selectedBundles[0] === packageName
      && installedManifest.dependencies?.[packageName] !== undefined,
  },
  {
    name: 'dump-config-has-exact-row',
    passed: installedDump.exitCode === 0 && installedRows === 1
      && installedDump.stdout.includes(`name: ${packageName}`)
      && installedDump.stdout.includes('value: installed')
      && !installedDump.stdout.includes('system-prompt')
      && !installedDump.stdout.includes('tools:'),
  },
  {
    name: 'installed-profile-boots',
    passed: installedCtx !== undefined && markerValue === 'installed',
  },
  { name: 'real-dsh-plugin-remove', passed: remove.exitCode === 0 },
  {
    name: 'profile-manifest-restored',
    passed: removedBundles.length === 0
      && removedManifest.dependencies?.[packageName] === undefined,
  },
  {
    name: 'native-dump-restored',
    passed: removedDump.exitCode === 0 && removedDump.stdout === initialDump.stdout,
  },
  {
    name: 'native-profile-boots',
    passed: nativeCtx !== undefined && markerAfterRemoval === undefined,
  },
]

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  passed: checks.every(check => check.passed),
  checks,
  composition: {
    fingerprint: createHash('sha256').update(removedDump.stdout).digest('hex'),
    modelCalls: 0,
    usage: {},
  },
}))

function bundleManifest(includeBundle) {
  return {
    name: packageName,
    version: '0.0.0-fixture',
    type: 'module',
    main: './plugin.mjs',
    exports: {
      '.': './plugin.mjs',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['plugin.mjs', 'cordis.patch.yml'],
    ...includeBundle ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {},
  }
}

function occurrences(source, needle) {
  return source.split(needle).length - 1
}

function runDsh(args, env) {
  return runBounded(process.execPath, [dshBin, ...args], {
    cwd: workspace,
    env,
    maxBytes: 512 * 1024,
    timeoutMs: 12_000,
  })
}

function runBounded(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    let settled = false
    let timedOut = false
    const kill = () => {
      if (child.pid === undefined) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
    const collect = target => chunk => {
      bytes += chunk.byteLength
      if (bytes > options.maxBytes) {
        kill()
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    const timeout = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs)
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', exitCode => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (bytes > options.maxBytes) {
        reject(new Error('profile command exceeded output budget'))
        return
      }
      if (timedOut) {
        reject(new Error(`profile command timed out: ${args.join(' ')}`))
        return
      }
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
  })
}
