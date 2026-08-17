import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('packed dsh-resident CLI boundary', () => {
  it('installs its executable and renders a plan without source or dev dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-package-'))
    temporaryRoots.push(root)
    const installRoot = join(root, 'install')
    const dshHome = join(root, 'dsh-home')
    const userHome = join(root, 'home')
    const cwd = join(root, 'cwd')
    const dshEntry = join(root, 'dsh.js')
    await Promise.all([
      mkdir(installRoot, { recursive: true }),
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      writeFile(dshEntry, '#!/usr/bin/env node\n'),
      writeFile(join(installRoot, 'package.json'), '{"private":true}\n'),
    ])

    await execFile('pnpm', ['pack', '--pack-destination', root], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const tarball = join(root, 'dsh-resident-0.1.0-alpha.1.tgz')
    await execFile('pnpm', ['add', tarball, '--ignore-scripts', '--offline'], {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    const binary = join(installRoot, 'node_modules', '.bin', 'dsh-resident')
    await expect(access(binary)).resolves.toBeUndefined()

    const output = await execFile(binary, [
      'plan', '--manager', 'launchd', '--profile', 'fixture',
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', cwd,
    ], {
      cwd: installRoot,
      env: { ...process.env, HOME: userHome },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(JSON.parse(output.stdout)).toMatchObject({
      action: 'plan',
      manager: 'launchd',
      profile: 'fixture',
    })
    expect(output.stderr).toBe('')
  }, 60_000)
})
