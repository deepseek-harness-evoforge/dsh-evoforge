import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const cli = join(packageRoot, 'test', 'fixtures', 'resident-driver.ts')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const dshEntry = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const temporaryRoots: string[] = []
const cleanupInvocations: Array<{ profile: string; dshHome: string; userHome: string }> = []

afterEach(async () => {
  for (const fixture of cleanupInvocations.splice(0)) {
    await runCli('remove', fixture, ['--confirm-deployment']).catch(() => undefined)
  }
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('dsh-resident launchd lifecycle', () => {
  it('starts on apply, restarts after SIGKILL, reports status, and removes cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-launchd-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const userHome = join(root, 'home')
    const cwd = join(root, 'cwd')
    const profile = `fixture-${process.pid}-${Date.now()}`
    await Promise.all([
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
    ])
    await createDshProfile(dshHome, profile)
    cleanupInvocations.push({ profile, dshHome, userHome })

    const applied = await runCli('apply', { profile, dshHome, userHome }, [
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--cwd', cwd,
      '--no-open',
      '--confirm-deployment',
    ])
    expect(applied).toMatchObject({
      schemaVersion: 1,
      action: 'applied',
      manager: 'launchd',
      profile,
      registered: true,
    })
    const unitPath = String(applied.unitPath)
    await expect(access(unitPath)).resolves.toBeUndefined()
    expect((await stat(unitPath)).mode & 0o777).toBe(0o600)

    const marker = join(dshHome, 'resident-fixture.jsonl')
    const first = await waitForStarts(marker, 1)
    expect(first[0]?.argv).toEqual(['--profile', profile, '--no-open'])
    const firstPid = first[0]?.pid
    if (firstPid === undefined) throw new Error('first resident PID missing')
    process.kill(firstPid, 'SIGKILL')

    const restarted = await waitForStarts(marker, 2, 20_000)
    const secondPid = restarted[1]?.pid
    expect(secondPid).toEqual(expect.any(Number))
    expect(secondPid).not.toBe(firstPid)

    const status = await runCli('status', { profile, dshHome, userHome })
    expect(status).toMatchObject({
      schemaVersion: 1,
      action: 'status',
      manager: 'launchd',
      profile,
      registered: true,
      active: true,
      unitPresent: true,
    })

    const removed = await runCli('remove', { profile, dshHome, userHome }, ['--confirm-deployment'])
    cleanupInvocations.length = 0
    expect(removed).toMatchObject({
      schemaVersion: 1,
      action: 'removed',
      manager: 'launchd',
      profile,
      registered: false,
      unitPresent: false,
    })
    await expect(access(unitPath)).rejects.toThrow()
    await waitForGone(Number(secondPid))
    await new Promise(resolveDelay => setTimeout(resolveDelay, 6_000))
    expect(await readStarts(marker)).toHaveLength(2)
  }, 40_000)
})

async function runCli(
  action: 'apply' | 'status' | 'remove',
  fixture: { profile: string; dshHome: string; userHome: string },
  extra: string[] = [],
): Promise<Record<string, unknown>> {
  const result = await execFile(process.execPath, [
    '--import', 'tsx/esm', cli, action,
    '--manager', 'launchd',
    '--profile', fixture.profile,
    '--dsh-home', fixture.dshHome,
    ...extra,
  ], {
    cwd: packageRoot,
    env: { ...process.env, HOME: fixture.userHome },
    encoding: 'utf8',
    timeout: 15_000,
  })
  return JSON.parse(result.stdout) as Record<string, unknown>
}

async function waitForStarts(path: string, count: number, timeoutMs = 10_000): Promise<Array<{
  pid: number
  argv: string[]
}>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const starts = await readStarts(path)
    if (starts.length >= count) return starts
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${count} resident starts`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
}

async function readStarts(path: string): Promise<Array<{ pid: number; argv: string[] }>> {
  const value = await readFile(path, 'utf8').catch(() => '')
  return value.trim() === ''
    ? []
    : value.trim().split('\n').map(line => JSON.parse(line) as { pid: number; argv: string[] })
}

async function waitForGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    if (Date.now() >= deadline) throw new Error(`resident PID ${pid} remained after removal`)
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
}

async function createDshProfile(dshHome: string, profile: string): Promise<void> {
  const profileDir = join(dshHome, 'profiles', profile)
  const bundleDir = join(profileDir, 'node_modules', 'dsh-resident-lifecycle-fixture')
  const plugin = join(bundleDir, 'plugin.mjs')
  await mkdir(bundleDir, { recursive: true })
  await writeFile(plugin, [
    "import { appendFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'dsh-resident-lifecycle-fixture'",
    'export function apply(ctx) {',
    "  appendFileSync(join(process.env.DSH_HOME, 'resident-fixture.jsonl'), `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) })}\\n`)",
    '  const heartbeat = setInterval(() => undefined, 1_000)',
    '  ctx.effect(() => () => clearInterval(heartbeat))',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: dsh-resident-lifecycle-fixture',
    `      name: ${pathToFileURL(plugin).href}`,
    '',
  ].join('\n'))
  await writeFile(join(bundleDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-resident-lifecycle-fixture',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-resident-lifecycle-fixture'] } },
  }, null, 2)}\n`)
  await writeFile(join(profileDir, 'cordis.patch.yml'), '[]\n')
}
