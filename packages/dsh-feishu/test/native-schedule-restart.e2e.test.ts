import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeishuSendOptions } from '../src/platform.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFile = promisify(execFileCallback)
const suiteRoot = resolve(packageRoot, '../..')
const gatewayRoot = resolve(packageRoot, '../dsh-gateway')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const crashDriver = join(packageRoot, 'test', 'fixtures', 'native-schedule-crash.ts')
const dispatchCrashDriver = join(packageRoot, 'test', 'fixtures', 'native-schedule-dispatch-crash.ts')
const temporaryRoots: string[] = []

interface SentText {
  readonly chatId: string
  readonly text: string
  readonly options?: FeishuSendOptions
}

interface FeishuTestService {
  readonly platform: {
    readonly texts: readonly SentText[]
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('native Schedule cold restart through Feishu', () => {
  it('resumes one durable overdue reminder on the exact route without replaying it after another restart', async () => {
    for (const cwd of [gatewayRoot, packageRoot]) {
      await execFile('pnpm', ['run', 'build'], { cwd, encoding: 'utf8', timeout: 30_000 })
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-schedule-restart-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'feishu-test'), { recursive: true })
    await writeFile(join(presetRoot, 'feishu-test', 'preset.yml'), 'name: Feishu Schedule Restart Test\n')
    await writeFile(join(presetRoot, 'feishu-test', 'agent.cordis.yml'), '[]\n')
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify(hostConfig(root, presetRoot), null, 2))

    vi.stubEnv('DSH_FEISHU_TEST_APP_ID', 'cli_test_app')
    vi.stubEnv('DSH_FEISHU_TEST_APP_SECRET', 'test-secret')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const seed = spawn(process.execPath, [
        '--import', join(dshSourceDir, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'),
        crashDriver, root, config, dshSourceDir,
      ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      await waitForReady(seed)
      const termination = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
        seed.once('exit', (code, signal) => { resolveExit({ code, signal }) })
      })
      expect(seed.kill('SIGKILL')).toBe(true)
      expect(await termination).toEqual({ code: null, signal: 'SIGKILL' })

      await new Promise(resolve => setTimeout(resolve, 1_100))

      const second = await boot('dsh-feishu-schedule-restart-2', config)
      try {
        const service = requireFeishuService(second)
        await vi.waitFor(() => {
          expect(service.platform.texts).toEqual([{
            chatId: 'oc_main',
            text: expect.stringContaining('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'),
            options: { replyInThread: true },
          }])
        }, { timeout: 15_000, interval: 25 })
        const agent = second.agents.get('main')
        expect(agent).toBeDefined()
        await agent!.whenIdle()
        await expect(second.sessions.flush(agent!.session)).resolves.toBe(true)
        expect(agent!.session.events.filter((event: unknown) => isScheduleChange(event, 'create'))).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleChange(event, 'dispatch'))).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleMessage(event))).toHaveLength(1)
        await vi.waitFor(() => {
          const records = outboundRecords(second)
            .filter(record => record.kind === 'turn' && record.replyToExternalId === undefined)
          expect(records).toEqual([expect.objectContaining({
            attempts: 1,
            intentKey: expect.stringMatching(/^turn:\d+$/u),
            replyInThread: true,
            status: 'delivered',
            waitForTurnEnd: expect.any(Number),
          })])
        }, { timeout: 5_000, interval: 10 })
      } finally {
        await second.fiber.dispose()
      }

      const third = await boot('dsh-feishu-schedule-restart-3', config)
      try {
        const service = requireFeishuService(third)
        const agent = third.agents.get('main')
        expect(agent).toBeDefined()
        await agent!.whenIdle()
        await new Promise(resolve => setTimeout(resolve, 250))
        await expect(third.sessions.flush(agent!.session)).resolves.toBe(true)
        expect(service.platform.texts).toHaveLength(0)
        expect(agent!.session.events.filter((event: unknown) => isScheduleChange(event, 'dispatch'))).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleMessage(event))).toHaveLength(1)
        const records = outboundRecords(third)
          .filter(record => record.kind === 'turn' && record.replyToExternalId === undefined)
        expect(records).toEqual([expect.objectContaining({ status: 'delivered', attempts: 1 })])
      } finally {
        await third.fiber.dispose()
      }
    } finally {
      process.chdir(previousCwd)
    }
  }, 60_000)

  it('does not repeat the platform effect when dispatch durability loses a completed Schedule turn', async () => {
    for (const cwd of [gatewayRoot, packageRoot]) {
      await execFile('pnpm', ['run', 'build'], { cwd, encoding: 'utf8', timeout: 30_000 })
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-schedule-dispatch-crash-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'feishu-test'), { recursive: true })
    await writeFile(join(presetRoot, 'feishu-test', 'preset.yml'), 'name: Feishu Schedule Dispatch Crash Test\n')
    await writeFile(join(presetRoot, 'feishu-test', 'agent.cordis.yml'), '[]\n')
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify(hostConfig(
      root,
      presetRoot,
      join(root, 'platform-effects.jsonl'),
    ), null, 2))

    vi.stubEnv('DSH_FEISHU_TEST_APP_ID', 'cli_test_app')
    vi.stubEnv('DSH_FEISHU_TEST_APP_SECRET', 'test-secret')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const seed = spawn(process.execPath, [
      '--import', join(dshSourceDir, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'),
      dispatchCrashDriver, root, config, dshSourceDir,
    ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    await waitForReady(seed, 'PLATFORM_EFFECT_BEFORE_DISPATCH_DURABLE')
    const termination = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
      seed.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })
    expect(seed.kill('SIGKILL')).toBe(true)
    expect(await termination).toEqual({ code: null, signal: 'SIGKILL' })

    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const { boot } = await import(pathToFileURL(
        join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
      ).href)
      const recovered = await boot('dsh-feishu-schedule-dispatch-crash-recovery', config)
      try {
        const service = requireFeishuService(recovered)
        const agent = recovered.agents.get('main')
        expect(agent).toBeDefined()
        await agent!.whenIdle()
        await expect(recovered.sessions.flush(agent!.session)).resolves.toBe(true)
        await new Promise(resolve => setTimeout(resolve, 250))

        expect(service.platform.texts).toHaveLength(0)
        expect((await readFile(join(root, 'platform-effects.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleChange(event, 'create'))).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleChange(event, 'dispatch'))).toHaveLength(1)
        expect(agent!.session.events.filter((event: unknown) => isScheduleMessage(event))).toHaveLength(1)
        expect(outboundRecords(recovered)
          .filter(record => record.kind === 'turn' && record.replyToExternalId === undefined))
          .toEqual([expect.objectContaining({
            attempts: 1,
            intentKey: 'turn:1',
            status: expect.stringMatching(/^(?:delivered|uncertain)$/u),
            waitForTurnEnd: 1,
          })])
      } finally {
        await recovered.fiber.dispose()
      }
    } finally {
      process.chdir(previousCwd)
    }
  }, 60_000)
})

function hostConfig(root: string, presetRoot: string, textEffectPath?: string): unknown[] {
  return [
    {
      id: 'cli-mock-llm',
      name: join(dshSourceDir, 'examples', 'headless-agent', 'tests', 'fixtures', 'cli-mock-llm.ts'),
    },
    {
      id: 'base',
      name: join(dshSourceDir, 'vendor', 'include', 'lib', 'index.js'),
      config: {
        path: join(dshSourceDir, 'examples', 'headless-agent', 'cordis.yml'),
        patches: [
          { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek', disabled: true },
          {
            id: 'agent-spine',
            name: '@deepseek-ai/dsh-agent-spine-demo',
            config: {
              agents: [],
              workspaceContext: false,
              dshHome: join(root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
              invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
              persona: 'Keyless Feishu Schedule restart smoke.',
            },
          },
          {
            id: 'persistence',
            name: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: join(root, 'sessions'), compression: 'none' },
          },
          { id: 'checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
        ],
      },
    },
    {
      id: 'storage',
      name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js'),
    },
    {
      id: 'storage-json',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
      config: { root: join(root, 'feishu-storage') },
    },
    {
      id: 'storage-domain',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
      config: { backend: 'json' },
    },
    {
      id: 'attachment-local',
      name: join(dshSourceDir, 'packages', 'attachment', 'attachment-local', 'lib', 'index.js'),
      config: { dshHome: join(root, '.dsh-home') },
    },
    {
      id: 'commands',
      name: join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js'),
    },
    {
      id: 'agent-presets',
      name: join(dshSourceDir, 'packages', 'preset', 'agent-presets', 'lib', 'index.js'),
      config: {
        default: 'feishu-test',
        roots: [{ path: presetRoot, trust: 'system' }],
        includeUserRoot: false,
      },
    },
    {
      id: 'workspace',
      name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js'),
    },
    {
      id: 'schedule',
      name: join(dshSourceDir, 'packages', 'schedule', 'schedule', 'lib', 'index.js'),
    },
    {
      id: 'channel-gateway-bootstrap',
      name: join(packageRoot, 'test', 'fixtures', 'gateway-bootstrap.ts'),
      config: {
        gatewayEntry: pathToFileURL(join(gatewayRoot, 'dist', 'index.mjs')).href,
        workspacePath: root,
        routeId: 'feishu-main',
        accountId: 'cli_test_app',
        conversationId: 'oc_main',
        threadId: 'omt_main',
        userId: 'ou_alice',
        sessionId: 'main',
        agentPreset: 'feishu-test',
        provider: 'cli-mock',
        model: 'cli-mock',
      },
    },
    {
      id: 'feishu-test-runtime',
      name: join(packageRoot, 'test', 'fixtures', 'runtime-bootstrap.ts'),
      config: {
        feishuEntry: pathToFileURL(join(packageRoot, 'dist', 'index.mjs')).href,
        routeIds: ['feishu-main'],
        appIdEnv: 'DSH_FEISHU_TEST_APP_ID',
        appSecretEnv: 'DSH_FEISHU_TEST_APP_SECRET',
        ...(textEffectPath === undefined ? {} : { textEffectPath }),
      },
    },
  ]
}

function requireFeishuService(ctx: {
  get(name: string): unknown
}): FeishuTestService {
  const service = ctx.get('evoforge.feishuTest') as FeishuTestService | undefined
  if (service === undefined) throw new Error('Feishu test runtime service did not load')
  return service
}

function outboundRecords(ctx: {
  storageDomain: {
    get(name: string): { table(name: string): { entries(): IterableIterator<[string, unknown]> } } | undefined
  }
}): Array<Record<string, unknown>> {
  return [...(ctx.storageDomain.get('evoforge_gateway_outbound')?.table('outbound').entries() ?? [])]
    .map(([, value]) => value as Record<string, unknown>)
}

function isScheduleChange(event: unknown, operation: 'create' | 'dispatch'): boolean {
  if (typeof event !== 'object' || event === null) return false
  const value = event as { readonly type?: unknown; readonly data?: { readonly operation?: unknown } }
  return value.type === 'schedule/change' && value.data?.operation === operation
}

function isScheduleMessage(event: unknown): boolean {
  if (typeof event !== 'object' || event === null) return false
  const value = event as {
    readonly type?: unknown
    readonly data?: { readonly source?: { readonly kind?: unknown; readonly plugin?: unknown } }
  }
  return value.type === 'user/message'
    && value.data?.source?.kind === 'plugin'
    && value.data.source.plugin === 'schedule'
}

async function waitForReady(child: ReturnType<typeof spawn>, ready = 'READY'): Promise<void> {
  await new Promise<void>((resolveReady, rejectReady) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('exit', onExit)
      action()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => rejectReady(new Error(
        `Schedule crash driver exited before READY: code=${code} signal=${signal}\n${stdout}${stderr}`,
      )))
    }
    const timeout = setTimeout(() => {
      finish(() => rejectReady(new Error(`Schedule crash driver did not reach READY:\n${stdout}${stderr}`)))
    }, 20_000)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.includes(`${ready}\n`)) finish(resolveReady)
    })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('exit', onExit)
  })
}
