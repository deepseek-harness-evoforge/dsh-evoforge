import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const dshBin = join(dshSourceDir, 'apps', 'cli', 'lib', 'bin.js')
const dshInstallAnchor = join(dshSourceDir, 'apps', 'cli', 'package.json')
const corepackHome = process.env.COREPACK_HOME
  ?? join(process.env.HOME ?? '', 'Library', 'Caches', 'node', 'corepack')
const packageNames = [
  'dsh-gateway',
  'dsh-doctor',
  'dsh-evolve',
  'dsh-evolve-attention',
  'dsh-evolve-web',
  'dsh-feishu',
  'dsh-github-review',
  'dsh-goal-continuity',
  'dsh-resident',
  'dsh-software-delivery',
  'dsh-telegram',
] as const
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('clean-profile assembled EvoForge suite', () => {
  it('installs packed Bundles, uses native Session/Goal/Storage, disposes, removes, and boots native DSH', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evoforge-native-suite-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    // The shipped `web` template is the ordinary long-lived DSH composition:
    // base + native Storage/Session/Goal services. The isolated DSH_HOME keeps
    // this a clean profile without inventing an EvoForge-owned host.
    const profileName = 'web'
    const profileDir = join(dshHome, 'profiles', profileName)
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: suiteRoot,
      encoding: 'utf8',
      timeout: 10_000,
    })).stdout.trim()
    const env = {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_DEFAULT_TO_LATEST: '0',
      COREPACK_HOME: corepackHome,
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: 'danger-full-access',
      HOME: root,
      npm_config_ignore_scripts: 'true',
      npm_config_store_dir: storePath,
    }
    const tarballs: string[] = []
    for (const packageName of packageNames) {
      await execFile('pnpm', ['--filter', packageName, 'pack', '--pack-destination', root], {
        cwd: suiteRoot,
        encoding: 'utf8',
        timeout: 60_000,
      })
      tarballs.push(join(root, `${packageName}-0.1.0-alpha.1.tgz`))
    }

    await runDsh(
      ['plugin', '--profile', profileName, 'add', ...tarballs, '--prefer-offline', '--ignore-scripts'],
      root,
      env,
    )
    const installedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    expect(Object.keys(installedManifest.dependencies).sort()).toEqual([...packageNames].sort())
    expect(installedManifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      ...[...packageNames].sort(),
    ])

    const dumped = await execFile(process.execPath, [
      dshBin, '--profile', profileName, '--dump-config',
    ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
    expect(evoforgeRows(dumped.stdout)).toEqual([
      'dsh-doctor',
      'dsh-evolve',
      'dsh-evolve-attention',
      'dsh-evolve-web',
      'dsh-feishu',
      'dsh-gateway',
      'dsh-github-review',
      'dsh-goal-continuity',
      'dsh-resident',
      'dsh-software-delivery',
      'dsh-telegram',
    ])
    expect(dumped.stdout.match(/name: dsh-evolve$/gmu)).toHaveLength(1)
    expect(dumped.stdout.match(/name: dsh-software-delivery$/gmu)).toHaveLength(1)
    expect(dumped.stdout).toMatch(/id: evoforge-telegram[\s\S]*?disabled: true/u)
    expect(dumped.stdout).toMatch(/id: evoforge-goal-continuity[\s\S]*?disabled: true/u)

    for (const packageName of packageNames) {
      const installed = JSON.parse(await readFile(
        join(profileDir, 'node_modules', packageName, 'package.json'),
        'utf8',
      ))
      expect(installed.bin).toBeUndefined()
      for (const dependency of Object.keys(installed.dependencies ?? {})) {
        expect(dependency === '@deepseek-ai/cordis' || dependency.startsWith('@deepseek-ai/dsh-'))
          .toBe(false)
      }
      const tarList = (await execFile('tar', ['-tf', tarballs[packageNames.indexOf(packageName)]!], {
        encoding: 'utf8',
      })).stdout
      expect(tarList).not.toMatch(/(^|\/)node_modules\//u)
      expect(tarList).not.toContain('/cli.mjs')
    }

    await expectCliHostStarts(profileName, root, env)

    const repository = join(root, 'repository')
    const worktree = join(root, 'delivery-worktree')
    await git(root, 'init', '--initial-branch=main', repository)
    await git(repository, 'config', 'user.name', 'EvoForge Native Contract')
    await git(repository, 'config', 'user.email', 'native-contract@example.invalid')
    await writeFile(join(repository, 'README.md'), 'baseline\n')
    await git(repository, 'add', 'README.md')
    await git(repository, 'commit', '-m', 'baseline')
    await git(repository, 'worktree', 'add', '-b', 'feature/native-contract', worktree)
    await writeFile(join(worktree, 'feature.txt'), 'delivered through DSH\n')
    await git(worktree, 'add', 'feature.txt')
    await git(worktree, 'commit', '-m', 'deliver through native DSH')

    const priorDshHome = process.env.DSH_HOME
    const priorPermissionMode = process.env.DSH_PERMISSION_MODE
    process.env.DSH_HOME = dshHome
    process.env.DSH_PERMISSION_MODE = 'danger-full-access'
    const sessionId = SessionId('evoforge-native-contract')
    try {
      const installedCtx = await bootProfile(profileName, dshHome)
      const toolNames = installedCtx.tools.schemas().map((tool: { name: string }) => tool.name)
      expect(toolNames).toContain('complete_delivery')
      expect(await installedCtx.skills.get('software-delivery')).toBeDefined()
      expect(installedCtx.get('evoforge.evolution')).toBeDefined()
      const preset = await installedCtx.agentPresets.resolve()
      const canonicalWorktree = await realpath(worktree)
      const nativeWorkspace = await installedCtx.workspaceRegistry.create(canonicalWorktree)
      const llm = await import(
        pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
      )
      const callArguments: Record<string, unknown> = {
        goal_id: 'set-after-goal-creation',
        revision: 0,
        worktree: canonicalWorktree,
        base_ref: 'main',
        checks: [{ name: 'node-smoke', argv: [process.execPath, '-e', 'process.exit(0)'] }],
      }
      class NativeContractAdapter extends llm.LlmAdapter {
        readonly requests: unknown[] = []

        resolveModel(provider: string, model: string) {
          return Promise.resolve({ provider, id: model, name: model })
        }

        async * stream(options: unknown) {
          this.requests.push(structuredClone(options))
          if (this.requests.length === 1) {
            const callId = llm.CallId('evoforge-native-complete-delivery')
            const input = JSON.stringify(callArguments)
            yield { type: 'block-start', index: 0, blockType: 'tool-call' }
            yield {
              type: 'tool-call-delta',
              index: 0,
              id: callId,
              name: 'complete_delivery',
              argumentsDelta: input,
            }
            yield {
              type: 'block-end',
              index: 0,
              block: {
                type: 'tool-call',
                id: callId,
                name: 'complete_delivery',
                arguments: input,
              },
            }
            yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
            return
          }
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'native delivery complete' }
          yield {
            type: 'block-end',
            index: 0,
            block: { type: 'text', text: 'native delivery complete' },
          }
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      const adapter = new NativeContractAdapter()
      installedCtx.llm.registerAdapter(['evoforge-native-contract'], adapter)
      const handle = await installedCtx.agents.create({
        sessionId,
        agentOptions: { provider: 'evoforge-native-contract', model: 'fixture' },
        meta: { cwd: canonicalWorktree, agentPreset: preset.id },
        setup: async (agentCtx: unknown) => {
          await installedCtx.agentPresets.mount(agentCtx, preset.id)
        },
      })
      await nativeWorkspace.attachSession(handle.agent.session.header.id)
      const agentToolNames = installedCtx.tools.schemas(handle.agent)
        .map((tool: { name: string }) => tool.name)
      expect(agentToolNames).toEqual(expect.arrayContaining([
        'bash',
        'complete_delivery',
        'update_goal',
      ]))
      const goal = installedCtx.goals.create(handle.agent, {
        objective: 'Verify the exact committed change through the EvoForge DSH Tool.',
      })
      callArguments.goal_id = String(goal.id)
      callArguments.revision = goal.revision
      handle.agent.followup(llm.createUserMessage({
        content: [{ type: 'text', text: 'Complete the verified delivery through the EvoForge Tool.' }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()
      expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
      expect(adapter.requests.length).toBeLessThanOrEqual(3)
      expect(installedCtx.goals.get(handle.agent)).toMatchObject({ phase: 'complete' })
      expect(handle.agent.session.events.some((event: { type: string }) => event.type === 'goal/change'))
        .toBe(true)
      await installedCtx.sessions.flush(handle.agent.session)
      await installedCtx.fiber.dispose()
      expect(installedCtx.get('evoforge.evolution')).toBeUndefined()

      await runDsh(
        ['plugin', '--profile', profileName, 'remove', ...packageNames],
        root,
        env,
      )
      const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      expect(removedManifest.dependencies ?? {}).toEqual({})
      expect(removedManifest.dsh.profile.bundles).toEqual([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
      ])
      const nativeDump = await execFile(process.execPath, [
        dshBin, '--profile', profileName, '--dump-config',
      ], { cwd: root, env, encoding: 'utf8', timeout: 30_000 })
      expect(evoforgeRows(nativeDump.stdout)).toEqual([])

      const nativeCtx = await bootProfile(profileName, dshHome)
      try {
        expect(nativeCtx.tools.get('complete_delivery')).toBeUndefined()
        expect(await nativeCtx.skills.get('software-delivery')).toBeUndefined()
        expect(nativeCtx.get('evoforge.evolution')).toBeUndefined()
        const restored = await nativeCtx.sessionPersistence.load(sessionId)
        expect(restored.events.some((event: { type: string; data?: unknown }) =>
          event.type === 'goal/change' && JSON.stringify(event.data).includes('complete'))).toBe(true)
      } finally {
        await nativeCtx.fiber.dispose()
      }
      await expectCliHostStarts(profileName, root, env)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      if (priorPermissionMode === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = priorPermissionMode
    }
  }, 180_000)
})

function evoforgeRows(dump: string): string[] {
  return [...dump.matchAll(/^\s*name:\s*(dsh-(?:gateway|doctor|evolve(?:-attention|-web)?|feishu|github-review|goal-continuity|resident|software-delivery|telegram))\s*$/gmu)]
    .map(match => match[1]!)
}

async function runDsh(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`DSH command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, { cause: error })
  }
}

async function expectCliHostStarts(
  profile: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  // This is a lifecycle probe, not a browser handoff. Opening the ephemeral
  // port leaves a dead DSH tab behind as soon as the probe terminates.
  const child = spawn(process.execPath, [dshBin, '--profile', profile, '--port', '0', '--no-open'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
  const early = await Promise.race([
    exited.then(result => ({ kind: 'exit' as const, result })),
    new Promise<{ kind: 'running' }>(resolveWait => setTimeout(() => resolveWait({ kind: 'running' }), 1_500)),
  ])
  if (early.kind === 'exit') {
    throw new Error(`DSH Host exited before readiness: ${JSON.stringify(early.result)}\n${stdout}${stderr}`)
  }
  child.kill('SIGTERM')
  const result = await exited
  expect(result).toEqual({ code: 0, signal: null })
  expect(() => process.kill(child.pid!, 0)).toThrow()
}

async function bootProfile(profileName: string, dshHome: string) {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  const { provideCmdline } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'cmdline', 'lib', 'index.js')).href
  )
  appBoot.healProfilesModuleFallback(dshInstallAnchor)
  const profile = appBoot.loadProfile('evoforge-native-contract', profileName, dshInstallAnchor, dshHome)
  const rootConfig = join(profile.dir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  // Mirror the official CLI launcher-owned assembly fact: shipped presets
  // live beside the DSH app, not inside the web Bundle package itself.
  const shippedPresetPatch = {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [{
        path: join(dshSourceDir, 'apps', 'cli', 'config', 'agent-presets'),
        trust: 'system',
      }],
      includeUserRoot: true,
    },
  }
  return appBoot.boot(
    'evoforge-native-contract',
    rootConfig,
    [
      ...profile.layers.flatMap((layer: { patches: unknown[] }) => layer.patches),
      ...profile.patches,
      shippedPresetPatch,
    ],
    (hostCtx: { provide: (...args: unknown[]) => unknown }) => provideCmdline(hostCtx, {
      args: ['--port', '0', '--no-open'],
      exit: () => {},
    }),
  )
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}
