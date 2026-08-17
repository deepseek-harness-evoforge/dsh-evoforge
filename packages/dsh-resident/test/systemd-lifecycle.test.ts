import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(packageRoot, 'src', 'cli.ts')
const fakeSystemctl = join(packageRoot, 'test', 'fixtures', 'fake-systemctl.mjs')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('dsh-resident systemd lifecycle', () => {
  it('atomically installs, enables, restarts, reports, and removes one user unit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-systemd-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const userHome = join(root, 'home')
    const cwd = join(root, 'cwd')
    const dshEntry = join(root, 'dsh.js')
    const statePath = join(root, 'systemctl-state.json')
    const profile = 'web'
    await Promise.all([
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      writeFile(dshEntry, '#!/usr/bin/env node\n'),
      chmod(fakeSystemctl, 0o755),
    ])
    const env = {
      ...process.env,
      HOME: userHome,
      NODE_ENV: 'test',
      DSH_RESIDENT_TEST_SYSTEMCTL: fakeSystemctl,
      DSH_RESIDENT_TEST_STATE: statePath,
    }

    const applied = await run(['apply',
      '--manager', 'systemd',
      '--profile', profile,
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', cwd,
      '--confirm-deployment',
    ], env)
    expect(applied).toMatchObject({
      action: 'applied',
      manager: 'systemd',
      profile,
      registered: true,
      active: true,
      unitPresent: true,
    })
    expect((await stat(String(applied.unitPath))).mode & 0o777).toBe(0o600)

    const status = await run([
      'status', '--manager', 'systemd', '--profile', profile, '--dsh-home', dshHome,
    ], env)
    expect(status).toMatchObject({ action: 'status', registered: true, active: true, unitPresent: true })

    const removed = await run([
      'remove', '--manager', 'systemd', '--profile', profile, '--dsh-home', dshHome,
      '--confirm-deployment',
    ], env)
    expect(removed).toMatchObject({ action: 'removed', registered: false, active: false, unitPresent: false })

    const state = JSON.parse(await readFile(statePath, 'utf8')) as { calls: string[][] }
    expect(state.calls).toEqual(expect.arrayContaining([
      ['--user', 'daemon-reload'],
      ['--user', 'enable', expect.stringMatching(/^io\.evoforge\.dsh\.[a-f0-9]{16}\.service$/)],
      ['--user', 'restart', expect.stringMatching(/^io\.evoforge\.dsh\.[a-f0-9]{16}\.service$/)],
      ['--user', 'disable', '--now', expect.stringMatching(/^io\.evoforge\.dsh\.[a-f0-9]{16}\.service$/)],
    ]))
  })
})

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const result = await execFile(process.execPath, ['--import', 'tsx/esm', cli, ...args], {
    cwd: packageRoot,
    env,
    encoding: 'utf8',
  })
  return JSON.parse(result.stdout) as Record<string, unknown>
}
