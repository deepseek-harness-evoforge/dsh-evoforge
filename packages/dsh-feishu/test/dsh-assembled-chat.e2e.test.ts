import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeishuPlatformSendError } from '../src/platform.js'
import type { FeishuApprovalAction, FeishuInboundMessage, FeishuSendOptions } from '../src/platform.js'
import type { FeishuRuntime } from '../src/runtime.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFile = promisify(execFileCallback)
const suiteRoot = resolve(packageRoot, '../..')
const routerRoot = resolve(packageRoot, '../dsh-channel-router')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Feishu chat', () => {
  it('drives native Agent, Command, Approval, continuation, and host notice through one exact route', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-feishu-assembled-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'feishu-test'), { recursive: true })
    await writeFile(join(presetRoot, 'feishu-test', 'preset.yml'), 'name: Feishu Test\n')
    await writeFile(join(presetRoot, 'feishu-test', 'agent.cordis.yml'), '[]\n')
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
                persona: 'Keyless Feishu assembled smoke.',
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
        id: 'channel-router-bootstrap',
        name: join(packageRoot, 'test', 'fixtures', 'router-bootstrap.ts'),
        config: {
          routerEntry: pathToFileURL(join(routerRoot, 'dist', 'index.mjs')).href,
          workspacePath: root,
          routeId: 'feishu-main',
          accountId: 'cli_test_app',
          conversationId: 'oc_main',
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
    const ctx = await boot('dsh-feishu-assembled-test', config)
    const service = ctx.get('evoforge.feishuTest') as {
      platform: {
        connected: boolean
        sendAttempts: string[]
        texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }>
        cards: Array<{ chatId: string; card: object }>
        emitMessage(message: FeishuInboundMessage): Promise<void>
        emitApproval(action: FeishuApprovalAction): Promise<void>
        queueFailure(error: unknown): void
      }
      runtime: FeishuRuntime
    } | undefined
    if (service === undefined) throw new Error('Feishu test runtime service did not load')
    try {
      expect(service.platform.connected).toBe(true)
      const hostRoute = ctx.get('evoforge.feishuRoute') as {
        routes: readonly { routeId: string; workspaceId: string }[]
      } | undefined
      const router = ctx.get('evoforge.channelRouter') as {
        route(id: string): { workspaceId: string } | undefined
      }
      expect(hostRoute?.routes).toEqual([{
        routeId: 'feishu-main',
        workspaceId: router.route('feishu-main')?.workspaceId,
      }])
      await service.platform.emitMessage(message({ messageId: 'om_denied', senderId: 'ou_mallory' }))
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(service.platform.texts).toHaveLength(0)

      const inbound = message({ messageId: 'om_first', senderId: 'ou_alice' })
      service.platform.queueFailure(new FeishuPlatformSendError('rate_limited', '429', 1_000))
      await service.platform.emitMessage(inbound)
      await vi.waitFor(() => {
        expect(service.platform.texts[0]).toEqual({
          chatId: 'oc_main',
          text: expect.stringContaining('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'),
          options: { replyTo: 'om_first' },
        })
      }, { timeout: 15_000, interval: 25 })
      expect(service.platform.sendAttempts).toHaveLength(2)
      const deliveryDomain = ctx.storageDomain.get('evoforge_feishu')
      await vi.waitFor(() => {
        const deliveries = [...(deliveryDomain?.table('deliveries').entries() ?? [])]
          .map(([, value]) => value as { attempts?: unknown; status?: unknown })
        expect(deliveries).toEqual([expect.objectContaining({ attempts: 2, status: 'delivered' })])
      })
      const agent = ctx.agents.get('main')
      expect(agent).toBeDefined()
      expect(agent?.session.events.some((event: SessionEvent) => event.type === 'user/message'
        && String(event.data.id).startsWith('channel:'))).toBe(true)

      await service.platform.emitMessage(inbound)
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(service.platform.texts).toHaveLength(1)

      await service.platform.emitMessage(message({
        messageId: 'om_command',
        senderId: 'ou_alice',
        content: '/feishu',
      }))
      await vi.waitFor(() => { expect(service.platform.texts).toHaveLength(2) })
      expect(service.platform.texts[1]?.text).toContain('Feishu: READY')
      expect(agent?.session.events.some((event: SessionEvent) => event.type === 'command/run'
        && event.data.name === 'feishu')).toBe(true)

      agent?.followup(freezeMessage({
        id: MessageId('native:feishu-continuation:1'),
        role: 'user',
        content: [{ type: 'text', text: 'native Goal or Schedule continuation' }],
        source: { kind: 'user' },
      }))
      await vi.waitFor(() => { expect(service.platform.texts).toHaveLength(3) }, { timeout: 15_000, interval: 25 })
      expect(service.platform.texts[2]).toMatchObject({ chatId: 'oc_main' })
      expect(service.platform.texts[2]).not.toHaveProperty('options.replyTo')

      const agentModule = await import(pathToFileURL(
        join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
      ).href)
      const approval = agentModule.agentEvents(ctx, agent).waterfall('approval/request', {
        toolName: 'deploy',
        reason: 'Protected action.',
        signal: new AbortController().signal,
      }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
      await vi.waitFor(() => { expect(service.platform.cards).toHaveLength(1) })
      const card = service.platform.cards[0]!.card as {
        body?: { elements?: Array<{ actions?: Array<{ value?: unknown }> }> }
      }
      const value = card.body?.elements?.[1]?.actions?.[0]?.value
      await service.platform.emitApproval({
        messageId: 'om_card_1',
        chatId: 'oc_main',
        operatorId: 'ou_alice',
        value,
      })
      await expect(approval).resolves.toBe('allowed-once')

      await expect(service.runtime.notifyHost({
        id: 'f'.repeat(64),
        routeId: 'feishu-main',
        text: 'EvoForge attention: inspect one Workspace-scoped review.',
      })).resolves.toMatchObject({ created: true, status: 'prepared' })
      await vi.waitFor(() => { expect(service.platform.texts).toHaveLength(4) })
      expect(service.platform.texts[3]?.text).toContain('EvoForge attention')
      await expect(service.runtime.notifyHost({
        id: 'f'.repeat(64),
        routeId: 'feishu-main',
        text: 'EvoForge attention: inspect one Workspace-scoped review.',
      })).resolves.toMatchObject({ created: false, status: 'delivered' })
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
    }
    expect(service.platform.connected).toBe(false)
  }, 30_000)
})

function message(overrides: Partial<FeishuInboundMessage>): FeishuInboundMessage {
  return Object.freeze({
    messageId: 'om_default',
    chatId: 'oc_main',
    chatType: 'p2p',
    senderId: 'ou_alice',
    content: 'verify the real DSH Feishu path',
    rawContentType: 'text',
    ...overrides,
  })
}
