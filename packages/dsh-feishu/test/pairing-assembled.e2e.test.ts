import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeishuInboundMessage, FeishuSendOptions } from '../src/platform.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const gatewayRoot = resolve(packageRoot, '../dsh-gateway')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Feishu pairing', () => {
  it('pairs from one native Workspace Session without forwarding discovery messages to its Agent', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-pairing-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'pairing-test'), { recursive: true })
    await writeFile(join(presetRoot, 'pairing-test', 'preset.yml'), 'name: Pairing Test\n')
    await writeFile(join(presetRoot, 'pairing-test', 'agent.cordis.yml'), '[]\n')
    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify([
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
                persona: 'Keyless pairing assembled smoke.',
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
      { id: 'storage', name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js') },
      {
        id: 'storage-json',
        name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
        config: { root: join(root, 'storage') },
      },
      {
        id: 'storage-domain',
        name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
        config: { backend: 'json' },
      },
      { id: 'commands', name: join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js') },
      {
        id: 'agent-presets',
        name: join(dshSourceDir, 'packages', 'preset', 'agent-presets', 'lib', 'index.js'),
        config: { default: 'pairing-test', roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false },
      },
      { id: 'workspace', name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js') },
      {
        id: 'channel-gateway-bootstrap',
        name: join(packageRoot, 'test', 'fixtures', 'gateway-bootstrap.ts'),
        config: {
          gatewayEntry: pathToFileURL(join(gatewayRoot, 'dist', 'index.mjs')).href,
          workspacePath: root,
          routeId: 'existing-test-route',
          accountId: 'cli_test_app',
          conversationId: 'oc_config_placeholder',
          userId: 'ou_config_placeholder',
          sessionId: 'pairing-session',
          agentPreset: 'pairing-test',
          provider: 'cli-mock',
          model: 'cli-mock',
        },
      },
      {
        id: 'feishu-pairing-bootstrap',
        name: join(packageRoot, 'test', 'fixtures', 'pairing-bootstrap.ts'),
        config: {
          feishuEntry: pathToFileURL(join(packageRoot, 'dist', 'index.mjs')).href,
          appIdEnv: 'DSH_FEISHU_TEST_APP_ID',
          appSecretEnv: 'DSH_FEISHU_TEST_APP_SECRET',
        },
      },
    ], null, 2))
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
    const ctx = await boot('dsh-feishu-pairing-test', config)
    const service = ctx.get('evoforge.feishuPairingTest') as {
      platform: {
        connected: boolean
        disconnectCount: number
        texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }>
        emitMessage(message: FeishuInboundMessage): Promise<void>
      }
    } | undefined
    if (service === undefined) throw new Error('pairing test service unavailable')
    try {
      const gateway = ctx.get('evoforge.gateway') as {
        resolve(id: string): Promise<{ session: { events: readonly SessionEvent[] } }>
        route(id: string): { workspaceId: string } | undefined
      }
      const agent = await gateway.resolve('existing-test-route')
      const beforeMessages = agent.session.events.filter(event => event.type === 'user/message').length
      expect(ctx.commands.list(agent as never).map((command: { name: string }) => command.name))
        .toContain('feishu-pair')

      const started = await ctx.commands.execute(agent as never, '/feishu-pair start', new AbortController().signal)
      const phrase = started?.result.text?.match(/EVOFORGE PAIR [A-Z2-9]{16}/u)?.[0]
      expect(phrase).toBeDefined()
      if (phrase === undefined) throw new Error('pairing phrase missing')
      expect(service.platform.connected).toBe(true)

      await service.platform.emitMessage(message({ content: 'unrelated external text' }))
      await service.platform.emitMessage(message({ content: phrase }))
      expect(service.platform.texts).toEqual([{
        chatId: 'oc_discovered',
        text: expect.stringContaining('配对信息已收到'),
        options: { replyTo: 'om_discovered' },
      }])
      expect(service.platform.connected).toBe(false)
      expect(agent.session.events.filter(event => event.type === 'user/message')).toHaveLength(beforeMessages)

      const status = await ctx.commands.execute(agent as never, '/feishu-pair status', new AbortController().signal)
      expect(status?.result.text).toContain('conversationId: "oc_discovered"')
      expect(status?.result.text).toContain('userId: "ou_discovered"')
      expect(status?.result.text).toContain(`workspaceId: "${gateway.route('existing-test-route')?.workspaceId}"`)
      expect(status?.result.text).toContain('sessionId: "pairing-session"')
      expect(status?.result.text).toContain('agentPreset: "pairing-test"')
      expect(status?.result.text).toContain('provider: "cli-mock"')
      expect(status?.result.text).toContain('model: "cli-mock"')

      await ctx.commands.execute(agent as never, '/feishu-pair cancel', new AbortController().signal)
      await ctx.commands.execute(agent as never, '/feishu-pair start', new AbortController().signal)
      expect(service.platform.connected).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
    }
    expect(service.platform.connected).toBe(false)
    expect(service.platform.disconnectCount).toBeGreaterThanOrEqual(2)
  }, 45_000)
})

function message(overrides: Partial<FeishuInboundMessage>): FeishuInboundMessage {
  return {
    messageId: 'om_discovered',
    chatId: 'oc_discovered',
    chatType: 'p2p',
    senderId: 'ou_discovered',
    content: 'ignored',
    rawContentType: 'text',
    resources: [],
    ...overrides,
  }
}
