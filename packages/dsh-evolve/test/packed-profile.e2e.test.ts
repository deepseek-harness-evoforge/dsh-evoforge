import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'

const execFile = promisify(execFileCallback)
const source = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
const pack = process.env.DSH_EVOLVE_PACK_DIR
const packages = ['dsh-evolve', 'dsh-evolve-web', 'dsh-control-center']

// Explicit opt-in: fresh DSH_HOME, official prebuilt artifacts, no credentials or paid provider.
it.skipIf(source === undefined || pack === undefined)('installs, reloads and removes packed evolution Bundles while native history stays readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'evoforge-packed-profile-'))
  const home = join(root, 'dsh'), profileDir = join(home, 'profiles', 'web')
  const priorHome = process.env.DSH_HOME
  const env = { ...process.env, DSH_HOME: home, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', npm_config_ignore_scripts: 'true' }
  const cli = join(source!, 'apps/cli/lib/bin.js')
  const run = (args: string[]) => execFile(process.execPath, [cli, ...args], { cwd: root, env, timeout: 60_000, maxBuffer: 4_000_000 })
  const native = (path: string) => import(pathToFileURL(join(source!, path, 'lib/index.js')).href)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  let ctx: any
  try {
    await run(['plugin', '--profile', 'web', 'add', ...packages.map(name => join(pack!, `${name}-0.1.0-alpha.1.tgz`)), '--ignore-scripts'])
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...packages].sort())
    const dump = (await run(['--profile', 'web', '--dump-config'])).stdout
    for (const name of packages) expect(dump.match(new RegExp(`name: ${name}\\s*$`, 'gmu'))).toHaveLength(1)
    process.env.DSH_HOME = home
    const appBoot = await native('packages/boot/app-boot')
    const { provideCmdline } = await native('packages/boot/cmdline')
    const llm = await native('packages/llm/llm')
    const { SessionId } = await native('packages/core/session')
    const anchor = join(source!, 'apps/cli/package.json')
    const boot = async () => {
      const profile = appBoot.loadProfile('evoforge-packed-fixture', 'web', anchor, home)
      await appBoot.healProfilesModuleFallback({ installAnchor: anchor, profile, home })
      const config = join(profile.dir, 'cordis.yml')
      await writeFile(config, '[]\n')
      return appBoot.boot('evoforge-packed-fixture', config,
        [...profile.layers.flatMap((layer: { patches: unknown[] }) => layer.patches), ...profile.patches,
          { id: 'agent-presets', config: { default: 'standard', includeUserRoot: false,
            roots: [{ path: join(source!, 'apps/cli/config/agent-presets'), trust: 'system' }] } }],
        (host: unknown) => provideCmdline(host, { args: ['--host', '127.0.0.1', '--port', '0', '--no-open'], exit: () => {} }))
    }
    ctx = await boot()
    await vi.waitFor(() => expect(ctx.get('evoforge.evolutionControl')).toBeDefined())
    expect(ctx.typert.getPackage('dsh-evolve', 'host')).toBeDefined()
    const hostEntry = [...ctx.loader.entries()].find((entry: any) => entry.options.id === 'evoforge-evolution')
    expect(hostEntry).toBeDefined()
    await hostEntry.update({ disabled: true })
    await vi.waitFor(() => expect(ctx.get('evoforge.evolutionControl')).toBeUndefined())
    // Loader update initiates disposal; service disappearance is not disposal completion.
    await ctx.loader.await()
    expect(ctx.loader.getTasks()).toHaveLength(0)
    await hostEntry.update({ disabled: false })
    await vi.waitFor(() => expect(ctx.get('evoforge.evolutionControl')).toBeDefined())
    let calls = 0
    class FixtureAdapter extends llm.LlmAdapter {
      async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
      async *stream() {
        calls++
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Packed profile native readback fixture.' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Packed profile native readback fixture.' } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['packed-fixture'], new FixtureAdapter())
    const id = SessionId('evoforge-packed-readback')
    const preset = await ctx.agentPresets.resolve()
    const cwd = await realpath(root)
    const workspace = await ctx.workspaceRegistry.create(cwd)
    const handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'packed-fixture', model: 'fixture' },
      meta: { cwd, agentPreset: preset.id }, setup: async (agentCtx: unknown) => { await ctx.agentPresets.mount(agentCtx, preset.id) } })
    await workspace.attachSession(id)
    handle.agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'Return the fixed fixture response.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    // This pinned web profile also generates a native title; wait for its durable event before the snapshot.
    await vi.waitFor(() => expect(handle.agent.session.snapshotEvents().some((event: any) => event.type === 'session/title'
      && event.data.source?.provider === 'session-title-first-prompt-llm')).toBe(true))
    expect(calls).toBe(2)
    const events = handle.agent.session.snapshotEvents()
    expect(events.some((event: any) => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
    expect(JSON.stringify(events)).toContain('Packed profile native readback fixture.')
    await ctx.sessions.flush(handle.agent.session)
    await handle.dispose()
    await ctx.fiber.dispose()
    expect(ctx.get('evoforge.evolutionControl')).toBeUndefined()
    ctx = undefined
    await run(['plugin', '--profile', 'web', 'remove', ...packages])
    const removed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(removed.dependencies ?? {}).toEqual({})
    const nativeDump = (await run(['--profile', 'web', '--dump-config'])).stdout
    for (const name of packages) expect(nativeDump).not.toMatch(new RegExp(`name: ${name}\\s*$`, 'mu'))
    ctx = await boot()
    expect(ctx.get('evoforge.evolutionControl')).toBeUndefined()
    expect(ctx.typert.getPackage('dsh-evolve', 'host')).toBeUndefined()
    const reader = await ctx.sessionPersistence.open(id, 'read')
    try { expect((await reader.read()).events).toEqual(events) } finally { await reader.close() }
  } finally {
    await ctx?.fiber.dispose()
    log.mockRestore()
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
