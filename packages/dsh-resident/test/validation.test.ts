import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(packageRoot, 'test', 'fixtures', 'resident-driver.ts')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('dsh-resident validation', () => {
  it('rejects a non-executable Node path before producing a deployment plan', () => {
    const fixture = createFixture()
    const fakeNode = join(fixture.root, 'node')
    writeFileSync(fakeNode, 'not executable\n', { mode: 0o600 })

    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'launchd',
      '--profile', 'web',
      '--dsh-entry', fixture.dshEntry,
      '--node-bin', fakeNode,
      '--dsh-home', fixture.dshHome,
      '--cwd', fixture.cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: fixture.userHome },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('dsh-resident: --node-bin must be executable')
  })

  it.each([
    { name: 'profile traversal', profile: '../web', dshHome: undefined, expected: 'invalid DSH profile name', missingEntry: false },
    { name: 'non-normalized home', profile: 'web', dshHome: 'non-normalized', expected: '--dsh-home must be an absolute normalized path', missingEntry: false },
    { name: 'missing entry', profile: 'web', dshHome: undefined, expected: '--dsh-entry must name an existing file', missingEntry: true },
  ])('rejects $name before producing a plan', testCase => {
    const fixture = createFixture()
    const dshHome = testCase.dshHome === 'non-normalized'
      ? `${fixture.dshHome}/../dsh-home`
      : fixture.dshHome
    const dshEntry = testCase.missingEntry === true
      ? join(fixture.root, 'missing.js')
      : fixture.dshEntry
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'launchd',
      '--profile', testCase.profile,
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', fixture.cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: fixture.userHome },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`dsh-resident: ${testCase.expected}`)
  })

  it('rejects a control character before a path can alter a unit definition', () => {
    const fixture = createFixture()
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'systemd',
      '--profile', 'web',
      '--dsh-entry', fixture.dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', fixture.dshHome,
      '--cwd', `${fixture.cwd}\nInjected=directive`,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: fixture.userHome },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('dsh-resident: --cwd must not contain control characters')
  })
})

function createFixture(): {
  root: string
  dshHome: string
  userHome: string
  cwd: string
  dshEntry: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-resident-validation-'))
  temporaryRoots.push(root)
  const dshHome = join(root, 'dsh-home')
  const userHome = join(root, 'home')
  const cwd = join(root, 'cwd')
  const dshEntry = join(root, 'dsh.js')
  for (const path of [dshHome, userHome, cwd]) mkdirSync(path, { recursive: true })
  writeFileSync(dshEntry, '#!/usr/bin/env node\n')
  return { root, dshHome, userHome, cwd, dshEntry }
}
