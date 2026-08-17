import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(packageRoot, 'test', 'fixtures', 'resident-driver.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'linux')('dsh-resident systemd unit', () => {
  it('passes the native systemd unit verifier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-systemd-verify-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const userHome = join(root, 'home')
    const cwd = join(root, 'cwd')
    const dshEntry = join(root, 'dsh.js')
    const unitPath = join(root, 'fixture.service')
    await Promise.all([
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      writeFile(dshEntry, '#!/usr/bin/env node\n'),
    ])
    const result = await execFile(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'systemd',
      '--profile', 'fixture',
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: userHome },
      encoding: 'utf8',
    })
    const plan = JSON.parse(result.stdout) as { definition: string }
    await writeFile(unitPath, plan.definition)

    const verified = await execFile('/usr/bin/systemd-analyze', ['verify', unitPath], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(verified.stderr).toBe('')
  })
})
