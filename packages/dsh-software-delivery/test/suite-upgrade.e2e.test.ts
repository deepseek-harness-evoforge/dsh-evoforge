import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
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
const upgradeFromRevision = 'b0e4360b49c243535395b7b1ffba59b9ce0ae2c6'
const upgradeFromVersion = '0.1.0-alpha.0'
const currentVersion = '0.1.0-alpha.1'
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
  'dsh-control-center',
] as const
const historicalPackageNames = packageNames.filter(name => name !== 'dsh-control-center')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('assembled EvoForge suite upgrade', () => {
  it('upgrades packed Bundles without losing native or evolution state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evoforge-suite-upgrade-'))
    temporaryRoots.push(root)
    const dshHome = join(root, 'dsh-home')
    const profileName = 'web'
    const profileDir = join(dshHome, 'profiles', profileName)
    const workspacePath = join(root, 'workspace')
    const historicalSource = join(root, 'historical-source')
    const historicalArtifacts = join(root, 'historical-artifacts')
    const currentArtifacts = join(root, 'current-artifacts')
    await Promise.all([
      mkdir(workspacePath, { recursive: true }),
      mkdir(historicalSource, { recursive: true }),
      mkdir(historicalArtifacts, { recursive: true }),
      mkdir(currentArtifacts, { recursive: true }),
    ])
    const storePath = (await execFile('pnpm', ['store', 'path'], {
      cwd: suiteRoot,
      encoding: 'utf8',
      timeout: 10_000,
    })).stdout.trim()
    const env = suiteEnvironment(root, dshHome, storePath)
    const historicalTarballs = await packHistoricalSuite(
      root,
      historicalSource,
      historicalArtifacts,
      storePath,
      env,
    )
    const currentTarballs = await packSuite(suiteRoot, currentArtifacts, currentVersion, env)
    expect(await sha256(historicalTarballs[2]!)).not.toBe(await sha256(currentTarballs[2]!))

    await runDsh(
      [
        'plugin', '--profile', profileName, 'add', ...historicalTarballs,
        '--prefer-offline', '--ignore-scripts', '--store-dir', storePath,
      ],
      root,
      env,
    )
    await expectInstalledSuite(profileDir, upgradeFromVersion, historicalPackageNames)
    const historicalDump = await dumpProfile(profileName, root, env)
    expectSuiteRowsOnce(historicalDump, historicalPackageNames)

    const priorDshHome = process.env.DSH_HOME
    const priorPermissionMode = process.env.DSH_PERMISSION_MODE
    process.env.DSH_HOME = dshHome
    process.env.DSH_PERMISSION_MODE = 'danger-full-access'
    let oldSessionId = ''
    let currentSessionId = ''
    let workspaceId = ''
    let oldGapId = ''
    try {
      const historicalCtx = await bootProfile(profileName, dshHome)
      try {
        const seeded = await recordGapThroughInstalledSuite(
          historicalCtx,
          workspacePath,
          'suite-upgrade-before',
          'Preserve a native Goal and internal capability evidence across the plugin upgrade.',
          'suite-upgrade-proof',
        )
        oldSessionId = seeded.sessionId
        workspaceId = seeded.workspaceId
        oldGapId = seeded.gapId
        expect(seeded.overview).toMatchObject({
          capabilityGaps: {
            confirmedCount: 1,
            items: [{ id: oldGapId, requestedSkill: 'suite-upgrade-proof' }],
          },
          skillOpportunities: { eligibleCount: 0 },
        })
      } finally {
        await historicalCtx.fiber.dispose()
      }

      await runDsh(
        [
          'plugin', '--profile', profileName, 'add', ...currentTarballs,
          '--prefer-offline', '--ignore-scripts', '--store-dir', storePath,
        ],
        root,
        env,
      )
      await expectInstalledSuite(profileDir, currentVersion, packageNames)
      const currentDump = await dumpProfile(profileName, root, env)
      expectSuiteRowsOnce(currentDump, packageNames)
      expect(evoforgeRows(currentDump)).toEqual([...evoforgeRows(historicalDump), 'dsh-control-center'])

      const currentCtx = await bootProfile(profileName, dshHome)
      try {
        const recoveredControl = evolutionControl(currentCtx)
        const recovered = await recoveredControl.overview(workspaceId, oldSessionId)
        expect(recovered).toMatchObject({
          capabilityGaps: {
            confirmedCount: 1,
            items: [{ id: oldGapId, requestedSkill: 'suite-upgrade-proof' }],
          },
          skillOpportunities: { eligibleCount: 0 },
        })
        const oldSession = await currentCtx.sessionPersistence.load(SessionId(oldSessionId))
        expect(oldSession.events.some((event: { type: string; data?: unknown }) =>
          event.type === 'goal/change'
          && JSON.stringify(event.data).includes('Preserve a native Goal'))).toBe(true)

        const appended = await recordGapThroughInstalledSuite(
          currentCtx,
          workspacePath,
          'suite-upgrade-after',
          'Use the upgraded plugin set to discover the same reusable capability in another Goal.',
          'suite-upgrade-proof',
        )
        currentSessionId = appended.sessionId
        expect(appended.workspaceId).toBe(workspaceId)
        expect(appended.overview).toMatchObject({
          capabilityGaps: { confirmedCount: 2 },
          skillOpportunities: {
            eligibleCount: 1,
            items: [{ skillName: 'suite-upgrade-proof', goalCount: 2 }],
          },
        })
      } finally {
        await currentCtx.fiber.dispose()
      }

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
      expect(evoforgeRows(await dumpProfile(profileName, root, env))).toEqual([])

      const nativeCtx = await bootProfile(profileName, dshHome)
      try {
        expect(nativeCtx.get('evoforge.evolution')).toBeUndefined()
        for (const sessionId of [oldSessionId, currentSessionId]) {
          const restored = await nativeCtx.sessionPersistence.load(SessionId(sessionId))
          expect(restored.events.some((event: { type: string }) => event.type === 'goal/change')).toBe(true)
        }
      } finally {
        await nativeCtx.fiber.dispose()
      }
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      if (priorPermissionMode === undefined) delete process.env.DSH_PERMISSION_MODE
      else process.env.DSH_PERMISSION_MODE = priorPermissionMode
    }
  }, 420_000)
})

function suiteEnvironment(root: string, dshHome: string, storePath: string): NodeJS.ProcessEnv {
  return {
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
}

async function packHistoricalSuite(
  root: string,
  source: string,
  destination: string,
  storePath: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  await execFile('git', ['cat-file', '-e', `${upgradeFromRevision}^{commit}`], {
    cwd: suiteRoot,
    encoding: 'utf8',
    timeout: 10_000,
  })
  const archive = join(root, 'historical-source.tar')
  await execFile('git', [
    'archive', '--format=tar', '--output', archive, upgradeFromRevision,
  ], { cwd: suiteRoot, encoding: 'utf8', timeout: 30_000 })
  await execFile('tar', ['-xf', archive, '-C', source], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  try {
    await execFile('pnpm', [
      'install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', storePath,
    ], {
      cwd: source,
      env,
      encoding: 'utf8',
      timeout: 180_000,
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(
      `historical dependency restore failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      { cause: error },
    )
  }
  // Keep dependency restoration against the exact historical lockfile. The
  // synthetic predecessor version is packaging metadata only: it gives pnpm
  // a real lower version to replace without changing the historical runtime.
  for (const packageName of historicalPackageNames) {
    const manifestPath = join(source, 'packages', packageName, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = upgradeFromVersion
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  return packSuite(source, destination, upgradeFromVersion, env, historicalPackageNames)
}

async function packSuite(
  source: string,
  destination: string,
  version: string,
  env: NodeJS.ProcessEnv,
  packages: readonly string[] = packageNames,
): Promise<string[]> {
  const tarballs: string[] = []
  for (const packageName of packages) {
    await execFile('pnpm', [
      '--filter', packageName, 'pack', '--pack-destination', destination,
    ], { cwd: source, env, encoding: 'utf8', timeout: 90_000 })
    tarballs.push(join(destination, `${packageName}-${version}.tgz`))
  }
  return tarballs
}

async function expectInstalledSuite(profileDir: string, version: string, packages: readonly string[]): Promise<void> {
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  expect(Object.keys(manifest.dependencies).sort()).toEqual([...packages].sort())
  expect(new Set(manifest.dsh.profile.bundles).size).toBe(manifest.dsh.profile.bundles.length)
  expect([...manifest.dsh.profile.bundles].sort()).toEqual([
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    ...packages,
  ].sort())
  for (const packageName of packages) {
    const installed = JSON.parse(await readFile(
      join(profileDir, 'node_modules', packageName, 'package.json'),
      'utf8',
    ))
    expect(installed.version, packageName).toBe(version)
  }
}

async function recordGapThroughInstalledSuite(
  ctx: any,
  workspacePath: string,
  sessionName: string,
  objective: string,
  requestedSkill: string,
): Promise<{
  sessionId: string
  workspaceId: string
  gapId: string
  overview: any
}> {
  const canonicalWorkspace = await realpath(workspacePath)
  const workspace = await ctx.workspaceRegistry.create(canonicalWorkspace)
  const preset = await ctx.agentPresets.resolve()
  const sessionId = SessionId(sessionName)
  const llm = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'llm', 'llm', 'lib', 'index.js')).href
  )
  class UpgradeContractAdapter extends llm.LlmAdapter {
    readonly requests: unknown[] = []

    resolveModel(provider: string, model: string) {
      return Promise.resolve({ provider, id: model, name: model })
    }

    async * stream(request: unknown) {
      this.requests.push(structuredClone(request))
      if (this.requests.length === 1) {
        const callId = llm.CallId(`${sessionName}:report-capability-gap`)
        const argumentsJson = JSON.stringify({ name: requestedSkill })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: 0,
          id: callId,
          name: 'report_capability_gap',
          argumentsDelta: argumentsJson,
        }
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: callId,
            name: 'report_capability_gap',
            arguments: argumentsJson,
          },
        }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'capability gap recorded' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'capability gap recorded' },
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new UpgradeContractAdapter()
  ctx.llm.registerAdapter(['suite-upgrade-contract'], adapter)
  const handle = await ctx.agents.create({
    sessionId,
    agentOptions: { provider: 'suite-upgrade-contract', model: 'keyless' },
    meta: { cwd: canonicalWorkspace, agentPreset: preset.id },
    setup: async (agentCtx: unknown) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
    },
  })
  await workspace.attachSession(handle.agent.session.header.id)
  ctx.goals.create(handle.agent, { objective })
  expect(ctx.tools.schemas(handle.agent).map((tool: { name: string }) => tool.name))
    .toContain('report_capability_gap')
  const before = await evolutionControl(ctx).overview(String(workspace.id), String(sessionId))
  const beforeIds = new Set((before.capabilityGaps?.items ?? []).map((gap: { id: string }) => gap.id))
  handle.agent.followup(llm.createUserMessage({
    content: [{ type: 'text', text: objective }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
  await ctx.sessions.flush(handle.agent.session)
  // Native Session title/projection plugins may issue bounded auxiliary calls;
  // the retained Gap below is the authoritative behavior, not an internal
  // request-count assumption.
  expect(adapter.requests.length).toBeGreaterThanOrEqual(2)
  expect(adapter.requests.length).toBeLessThanOrEqual(4)
  const overview = await evolutionControl(ctx).overview(String(workspace.id), String(sessionId))
  const addedGap = overview.capabilityGaps?.items.find((gap: { id: string; requestedSkill: string }) =>
    gap.requestedSkill === requestedSkill && !beforeIds.has(gap.id))
  if (addedGap === undefined) {
    throw new Error(`installed Agent turn did not retain ${requestedSkill} as a new Capability Gap`)
  }
  return {
    sessionId: String(sessionId),
    workspaceId: String(workspace.id),
    gapId: String(addedGap.id),
    overview,
  }
}

function evolutionControl(ctx: any): {
  overview(workspaceId: string, sessionId?: string): Promise<any>
} {
  const control = ctx.get('evoforge.evolutionControl')
  if (control === undefined) throw new Error('installed evolution control service did not load')
  return control
}

async function runDsh(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await execFile(process.execPath, [dshBin, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`DSH command failed:\n${failed.stdout ?? ''}${failed.stderr ?? ''}`, { cause: error })
  }
}

async function dumpProfile(profile: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return (await execFile(process.execPath, [
    dshBin, '--profile', profile, '--dump-config',
  ], { cwd, env, encoding: 'utf8', timeout: 30_000 })).stdout
}

function expectSuiteRowsOnce(dump: string, packages: readonly string[]): void {
  const expected = [
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
    ...(packages.includes('dsh-control-center') ? ['dsh-control-center'] : []),
  ]
  expect(evoforgeRows(dump)).toEqual(expected)
}

function evoforgeRows(dump: string): string[] {
  return [...dump.matchAll(/^\s*name:\s*(dsh-(?:control-center|gateway|doctor|evolve(?:-attention|-web)?|feishu|github-review|goal-continuity|resident|software-delivery|telegram))\s*$/gmu)]
    .map(match => match[1]!)
}

async function bootProfile(profileName: string, dshHome: string): Promise<any> {
  const appBoot = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  const { provideCmdline } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'cmdline', 'lib', 'index.js')).href
  )
  appBoot.healProfilesModuleFallback(dshInstallAnchor)
  const profile = appBoot.loadProfile('evoforge-suite-upgrade', profileName, dshInstallAnchor, dshHome)
  const rootConfig = join(profile.dir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
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
    'evoforge-suite-upgrade',
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

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
