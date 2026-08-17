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

describe('dsh-resident plan', () => {
  it('renders one inspectable launchd service without secrets or a shell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-plan-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'DSH Home & State')
    const userHome = join(root, 'User Home')
    const cwd = join(root, 'Work Space')
    const dshEntry = join(root, 'dsh entry.js')
    await Promise.all([
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      writeFile(dshEntry, '#!/usr/bin/env node\n'),
    ])

    const result = await execFile(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'launchd',
      '--profile', 'web & review',
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: userHome },
      encoding: 'utf8',
    })

    const plan = JSON.parse(result.stdout) as Record<string, unknown>
    expect(plan).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      manager: 'launchd',
      profile: 'web & review',
      dshHome,
      cwd,
      nodeBin: process.execPath,
      dshEntry,
      command: [process.execPath, dshEntry, '--profile', 'web & review'],
      unitPath: expect.stringMatching(/\/Library\/LaunchAgents\/io\.evoforge\.dsh\.[a-f0-9]{16}\.plist$/),
    })
    expect(plan.serviceId).toMatch(/^io\.evoforge\.dsh\.[a-f0-9]{16}$/)
    expect(plan.definition).toContain('<key>ProgramArguments</key>')
    expect(plan.definition).toContain(`<string>${process.execPath}</string>`)
    expect(plan.definition).toContain('<string>web &amp; review</string>')
    expect(plan.definition).toContain('<key>KeepAlive</key>\n  <true/>')
    expect(plan.definition).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plan.definition).toContain('<key>DSH_HOME</key>')
    expect(plan.definition).toContain('DSH Home &amp; State')
    expect(plan.definition).not.toMatch(/API_KEY|TOKEN|SECRET|<key>PATH<\/key>|\/bin\/(?:ba)?sh/)
    expect(result.stderr).toBe('')
  })

  it('renders a user systemd unit with bounded crash-loop policy and no shell', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-resident-systemd-plan-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'DSH $Home')
    const userHome = join(root, 'User Home')
    const cwd = join(root, 'Work $Space')
    const dshEntry = join(root, 'dsh $entry.js')
    await Promise.all([
      mkdir(dshHome, { recursive: true }),
      mkdir(userHome, { recursive: true }),
      mkdir(cwd, { recursive: true }),
      writeFile(dshEntry, '#!/usr/bin/env node\n'),
    ])

    const result = await execFile(process.execPath, [
      '--import', 'tsx/esm', cli, 'plan',
      '--manager', 'systemd',
      '--profile', 'web review',
      '--dsh-entry', dshEntry,
      '--node-bin', process.execPath,
      '--dsh-home', dshHome,
      '--cwd', cwd,
    ], {
      cwd: packageRoot,
      env: { ...process.env, HOME: userHome },
      encoding: 'utf8',
    })

    const plan = JSON.parse(result.stdout) as Record<string, unknown>
    expect(plan).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      manager: 'systemd',
      profile: 'web review',
      dshHome,
      cwd,
      command: [process.execPath, dshEntry, '--profile', 'web review'],
      unitPath: expect.stringMatching(/\/\.config\/systemd\/user\/io\.evoforge\.dsh\.[a-f0-9]{16}\.service$/),
    })
    expect(plan.definition).toContain('[Service]')
    expect(plan.definition).toContain(`ExecStart="${process.execPath}" "${dshEntry.replaceAll('$', () => '$$')}" "--profile" "web review"`)
    expect(plan.definition).toContain('Restart=always')
    expect(plan.definition).toContain('RestartSec=5s')
    expect(plan.definition).toContain('StartLimitIntervalSec=60')
    expect(plan.definition).toContain('StartLimitBurst=5')
    expect(plan.definition).toContain(`Environment="DSH_HOME=${dshHome}"`)
    expect(plan.definition).toContain(`WorkingDirectory=${cwd.replaceAll(' ', '\\x20')}`)
    expect(plan.definition).not.toMatch(/API_KEY|TOKEN|SECRET|Environment="PATH=|\/bin\/(?:ba)?sh/)
    expect(result.stderr).toBe('')
  })
})
