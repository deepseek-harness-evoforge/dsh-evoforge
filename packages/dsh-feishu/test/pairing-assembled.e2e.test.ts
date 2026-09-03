import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootLatestDshProfile } from './latest-dsh-test-runtime.ts'
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
  it('keeps the Gateway connected, replies to the first unknown DM with a code, and dispatches only after Host approval', async () => {
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
        name: join(dshSourceDir, 'packages', 'test-support', 'loader-smoke', 'tests', 'fixtures', 'cli-mock-llm.ts'),
      },
      {
        id: 'base',
        name: join(dshSourceDir, 'vendor', 'include', 'lib', 'index.js'),
        config: {
          path: join(dshSourceDir, 'packages', 'bundle', 'base', 'cordis.patch.yml'),
          patches: [
            { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek', disabled: true },
            {
              id: 'agent-loop',
              name: '@deepseek-ai/dsh-agent-loop',
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
              id: 'session-persistence-jsonl',
              name: '@deepseek-ai/dsh-session-persistence-jsonl',
              config: { root: join(root, 'sessions'), compression: 'none' },
            },
            { id: 'session-checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
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
      {
        id: 'attachment-local',
        name: join(dshSourceDir, 'packages', 'attachment', 'attachment-local', 'lib', 'index.js'),
        config: { dshHome: join(root, '.dsh-home') },
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

    const previousCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootLatestDshProfile({
      binName: 'dsh-feishu-pairing-test',
      configPath: config,
      dshSourceDir,
      home: join(root, '.dsh-home'),
    })
    const service = ctx.get('evoforge.feishuPairingTest') as {
      platform: {
        connected: boolean
        disconnectCount: number
        texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }>
        cards: Array<{ messageId: string; chatId: string; card: object; options?: FeishuSendOptions }>
        emitMessage(message: FeishuInboundMessage): Promise<void>
        emitApproval(action: {
          messageId: string
          chatId: string
          operatorId: string
          value: unknown
        }): Promise<void>
      }
    } | undefined
    if (service === undefined) throw new Error('pairing test service unavailable')
    try {
      const gateway = ctx.get('evoforge.gateway') as {
        resolve(id: string): Promise<{
          session: { snapshotEvents(): readonly SessionEvent[] }
          whenIdle(): Promise<void>
        }>
        route(id: string): { workspaceId: string } | undefined
        healthSnapshot(now?: number, routeIds?: readonly string[]): {
          outbound: { prepared: number; sending: number; retrying: number }
        }
        approvePairing(input: {
          adapter: string
          accountId: string
          code: string
          target: {
            id: string
            workspaceId: string
            sessionId: string
            agentPreset: string
            provider: string
            model: string
          }
          now: number
        }): Promise<unknown>
        revokePairing(routeId: string): Promise<unknown>
      }
      const agent = await gateway.resolve('existing-test-route')
      const hostRoute = ctx.get('evoforge.feishuRoute') as {
        readonly routes: readonly { readonly routeId: string; readonly workspaceId: string }[]
        observedChatKind(routeId: string): 'direct' | 'group' | undefined
        notify(input: { readonly id: string; readonly routeId: string; readonly text: string }): Promise<{
          readonly status: string
        }>
      } | undefined
      expect(hostRoute).toBeDefined()
      expect(hostRoute?.routes).toEqual([])
      const beforeMessages = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && String(event.data.id).startsWith('channel:')).length
      expect(ctx.commands.list(agent as never).map((command: { name: string }) => command.name))
        .not.toContain('feishu-pair')
      expect(service.platform.connected).toBe(true)

      await service.platform.emitMessage(message({ content: '你好' }))
      const code = service.platform.texts[0]?.text.match(/[A-HJ-NP-Z2-9]{10}/u)?.[0]
      expect(code).toBeDefined()
      if (code === undefined) throw new Error('pairing code missing')
      expect(service.platform.texts[0]).toEqual({
        chatId: 'oc_discovered',
        text: expect.stringContaining('配对码'),
        options: { replyTo: 'om_discovered' },
      })
      expect(service.platform.connected).toBe(true)
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && String(event.data.id).startsWith('channel:'))).toHaveLength(beforeMessages)

      await gateway.approvePairing({
        adapter: 'feishu',
        accountId: 'cli_test_app',
        code,
        target: {
          id: 'feishu-paired',
          workspaceId: gateway.route('existing-test-route')!.workspaceId,
          sessionId: 'pairing-session',
          agentPreset: 'pairing-test',
          provider: 'cli-mock',
          model: 'cli-mock',
        },
        now: Date.now(),
      })
      await service.platform.emitMessage(message({
        messageId: 'om_trusted',
        content: '现在可以了吗',
      }))
      await agent.whenIdle()
      await eventually(() => {
        const count = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
          && String(event.data.id).startsWith('channel:')).length
        return count === beforeMessages + 1
      })
      expect(hostRoute?.routes).toEqual([{
        routeId: 'feishu-paired',
        workspaceId: gateway.route('existing-test-route')!.workspaceId,
      }])

      const agentModule = await import(pathToFileURL(
        join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
      ).href)
      const approval = agentModule.agentEvents(ctx, agent).waterfall('approval/request', {
        toolName: 'pairing-protected-action',
        reason: 'Verify resident paired Approval.',
        signal: new AbortController().signal,
      }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
      await eventually(() => service.platform.cards.length === 1)
      const card = service.platform.cards[0]!
      const value = (card.card as {
        body?: { elements?: Array<{ actions?: Array<{ value?: unknown }> }> }
      }).body?.elements?.[1]?.actions?.[0]?.value
      await service.platform.emitApproval({
        messageId: card.messageId,
        chatId: 'oc_discovered',
        operatorId: 'ou_discovered',
        value,
      })
      await expect(approval).resolves.toBe('allowed-once')

      await expect(hostRoute?.notify({
        id: 'a'.repeat(64),
        routeId: 'feishu-paired',
        text: 'Resident pairing notice.',
      })).resolves.toMatchObject({ status: 'prepared' })
      await eventually(() => service.platform.texts.some(item => item.text === 'Resident pairing notice.'))
      expect(service.platform.connected).toBe(true)

      const pairedRouteId = hostRoute?.routes[0]?.routeId
      if (pairedRouteId === undefined) throw new Error('paired route was not exposed to Host')
      await eventually(() => {
        const outbound = gateway.healthSnapshot(Date.now(), [pairedRouteId]).outbound
        return outbound.prepared === 0 && outbound.sending === 0 && outbound.retrying === 0
      })
      await expect(gateway.revokePairing(pairedRouteId)).resolves.toMatchObject({
        routeId: pairedRouteId,
        alreadyRevoked: false,
      })
      expect(hostRoute?.routes).toEqual([])
      expect(hostRoute?.observedChatKind(pairedRouteId)).toBeUndefined()
      await expect(hostRoute?.notify({
        id: 'b'.repeat(64),
        routeId: pairedRouteId,
        text: 'Revoked route must not receive notices.',
      })).rejects.toThrow(`dsh-feishu: host notice route '${pairedRouteId}' is not configured`)

      await service.platform.emitMessage(message({
        messageId: 'om_repair',
        content: '撤销后重新配对',
      }))
      const repairCode = service.platform.texts.at(-1)?.text.match(/[A-HJ-NP-Z2-9]{10}/u)?.[0]
      expect(repairCode).toBeDefined()
      if (repairCode === undefined) throw new Error('repair pairing code missing')
      await gateway.approvePairing({
        adapter: 'feishu',
        accountId: 'cli_test_app',
        code: repairCode,
        target: {
          id: 'feishu-repaired',
          workspaceId: gateway.route('existing-test-route')!.workspaceId,
          sessionId: 'pairing-session',
          agentPreset: 'pairing-test',
          provider: 'cli-mock',
          model: 'cli-mock',
        },
        now: Date.now(),
      })
      await service.platform.emitMessage(message({
        messageId: 'om_repaired',
        content: '重新配对后进入 DSH',
      }))
      await agent.whenIdle()
      await eventually(() => hostRoute?.routes.some(route => route.routeId === 'feishu-repaired') === true)
      const feishuCommand = ctx.commands.find(agent as never, 'feishu')
      const health = await feishuCommand?.handler({
        commandId: 'feishu-repaired-health' as never,
        agent,
        rawInput: '',
        attachments: [],
        signal: new AbortController().signal,
      })
      expect(health).toMatchObject({ kind: 'success' })
      expect(health?.text).toContain('feishu-repaired')
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
    }
    expect(service.platform.connected).toBe(false)
    expect(service.platform.disconnectCount).toBe(1)
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

async function eventually(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('condition did not become true')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
