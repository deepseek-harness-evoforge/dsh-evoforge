import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ResidentPlugin from '../src/index.js'

const temporaryRoots: string[] = []
const fakeSystemctl = fileURLToPath(new URL('./fixtures/fake-systemctl.mjs', import.meta.url))

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('dsh-resident runtime plugin', () => {
  it('owns one DSH command and requires the exact reviewed plan hash before apply', async () => {
    const fixture = await createFixture()
    vi.stubEnv('HOME', fixture.userHome)
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const agent = {} as Agent
    const before = ctx.commands.list(agent)

    const fiber = await ctx.plugin(ResidentPlugin, {
      manager: 'launchd',
      profile: 'web',
      dshHome: fixture.dshHome,
      cwd: fixture.cwd,
      dshEntry: fixture.dshEntry,
      nodeBin: process.execPath,
    })

    expect(ResidentPlugin.inject).toEqual(['commands'])
    expect(ctx.commands.list(agent)).toEqual([
      ...before,
      expect.objectContaining({ name: 'resident' }),
    ])
    const command = ctx.commands.find(agent, 'resident')
    const plan = await command?.handler(invocation(agent, 'plan'))
    expect(plan).toMatchObject({ kind: 'success' })
    expect(plan?.text).toContain('"action": "plan"')
    expect(plan?.text).toMatch(/\/resident apply [a-f0-9]{64}$/u)

    const refused = await command?.handler(invocation(agent, 'apply'))
    expect(refused).toEqual({
      kind: 'error',
      text: expect.stringContaining('Apply refused'),
    })
    await expect(access(join(fixture.userHome, 'Library', 'LaunchAgents'))).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.commands.list(agent)).toEqual(before)
    await ctx.fiber.dispose()
  })

  it('applies and removes through the DSH command only after exact confirmations', async () => {
    const fixture = await createFixture()
    const statePath = join(fixture.root, 'systemctl-state.json')
    await chmod(fakeSystemctl, 0o755)
    vi.stubEnv('HOME', fixture.userHome)
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DSH_RESIDENT_TEST_SYSTEMCTL', fakeSystemctl)
    vi.stubEnv('DSH_RESIDENT_TEST_STATE', statePath)
    const config = {
      manager: 'systemd' as const,
      profile: 'web',
      dshHome: fixture.dshHome,
      cwd: fixture.cwd,
      dshEntry: fixture.dshEntry,
      nodeBin: process.execPath,
    }
    const plan = await ResidentPlugin.createPlan(config)
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(ResidentPlugin, config)
    const agent = {} as Agent
    const command = ctx.commands.find(agent, 'resident')

    await expect(command?.handler(invocation(
      agent,
      `apply ${ResidentPlugin.planFingerprint(plan)}`,
    ))).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('"action": "applied"') })
    await expect(command?.handler(invocation(agent, 'status')))
      .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('"active": true') })
    await expect(command?.handler(invocation(agent, `remove ${plan.serviceId}`)))
      .resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('"action": "removed"') })

    const state = JSON.parse(await readFile(statePath, 'utf8')) as { calls: string[][] }
    expect(state.calls).toEqual(expect.arrayContaining([
      ['--user', 'enable', expect.stringContaining('.service')],
      ['--user', 'restart', expect.stringContaining('.service')],
      ['--user', 'disable', '--now', expect.stringContaining('.service')],
    ]))
    await ctx.fiber.dispose()
  })
})

function invocation(agent: Agent, rawInput: string) {
  return {
    commandId: 'resident-command-fixture' as never,
    agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  }
}

async function createFixture(): Promise<{
  root: string
  dshHome: string
  userHome: string
  cwd: string
  dshEntry: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-resident-command-'))
  temporaryRoots.push(root)
  const dshHome = join(root, 'dsh-home')
  const userHome = join(root, 'home')
  const cwd = join(root, 'cwd')
  const dshEntry = join(root, 'dsh.js')
  await Promise.all([
    mkdir(dshHome),
    mkdir(userHome),
    mkdir(cwd),
    writeFile(dshEntry, '#!/usr/bin/env node\n'),
  ])
  return { root, dshHome, userHome, cwd, dshEntry }
}
