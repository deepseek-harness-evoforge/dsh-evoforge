import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(packageRoot, 'src', 'cli.ts')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('dsh-resident deployment authority', () => {
  it('refuses to install or start a service without explicit deployment confirmation', () => {
    const fixture = createFixture()
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', cli, 'apply',
      '--manager', 'launchd',
      '--profile', 'web',
      '--dsh-entry', fixture.dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', fixture.dshHome,
      '--cwd', fixture.cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: fixture.userHome },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('dsh-resident: apply requires --confirm-deployment')
    expect(existsSync(join(fixture.userHome, 'Library', 'LaunchAgents'))).toBe(false)
  })

  it('refuses to stop or remove a service without explicit deployment confirmation', () => {
    const fixture = createFixture()
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', cli, 'remove',
      '--manager', 'launchd',
      '--profile', 'web',
      '--dsh-home', fixture.dshHome,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: fixture.userHome },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('dsh-resident: remove requires --confirm-deployment')
    expect(existsSync(join(fixture.userHome, 'Library', 'LaunchAgents'))).toBe(false)
  })
})

function createFixture(): {
  root: string
  dshHome: string
  userHome: string
  cwd: string
  dshEntry: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-resident-deployment-'))
  temporaryRoots.push(root)
  const dshHome = join(root, 'dsh-home')
  const userHome = join(root, 'home')
  const cwd = join(root, 'cwd')
  const dshEntry = join(root, 'dsh.js')
  for (const path of [dshHome, userHome, cwd]) mkdirSync(path, { recursive: true })
  writeFileSync(dshEntry, '#!/usr/bin/env node\n')
  return { root, dshHome, userHome, cwd, dshEntry }
}
