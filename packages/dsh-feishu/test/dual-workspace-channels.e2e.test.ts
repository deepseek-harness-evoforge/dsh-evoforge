import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeishuApprovalAction, FeishuInboundMessage, FeishuSendOptions } from '../src/platform.js'
import type { FeishuRuntime } from '../src/runtime.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFile = promisify(execFileCallback)
const suiteRoot = resolve(packageRoot, '../..')
const gatewayRoot = resolve(packageRoot, '../dsh-gateway')
const telegramRoot = resolve(packageRoot, '../dsh-telegram')
const attentionRoot = resolve(packageRoot, '../dsh-evolve-attention')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled dual Workspace channels', () => {
  it('keeps Telegram and Feishu Sessions, Commands, Approvals, continuations, and restart state isolated', async () => {
    for (const cwd of [gatewayRoot, telegramRoot, packageRoot, attentionRoot]) {
      await execFile('pnpm', ['run', 'build'], { cwd, encoding: 'utf8', timeout: 30_000 })
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-dual-workspace-channels-'))
    temporaryRoots.push(root)
    const telegramWorkspace = join(root, 'telegram-workspace')
    const feishuWorkspace = join(root, 'feishu-workspace')
    const attentionActivationFile = join(root, 'attention-active')
    const presetRoot = join(root, 'agent-presets')
    await Promise.all([
      mkdir(telegramWorkspace, { recursive: true }),
      mkdir(feishuWorkspace, { recursive: true }),
      mkdir(join(presetRoot, 'channel-test'), { recursive: true }),
    ])
    const canonicalTelegramWorkspace = await realpath(telegramWorkspace)
    const canonicalFeishuWorkspace = await realpath(feishuWorkspace)
    await writeFile(join(presetRoot, 'channel-test', 'preset.yml'), 'name: Dual Channel Test\n')
    await writeFile(join(presetRoot, 'channel-test', 'agent.cordis.yml'), '[]\n')

    const telegramSends: Array<Record<string, unknown>> = []
    const callbackAnswers: Array<Record<string, unknown>> = []
    let serveTelegramCommand = false
    let telegramApprovalCallback: string | undefined
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => { chunks.push(chunk) })
      request.on('end', () => {
        const body = chunks.length === 0
          ? {} as Record<string, unknown>
          : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        response.setHeader('content-type', 'application/json')
        if (request.url?.endsWith('/getUpdates')) {
          const offset = typeof body.offset === 'number' ? body.offset : 0
          const result = offset <= 701
            ? [telegramMessage(701, 41, 'telegram-only-token')]
            : serveTelegramCommand && offset <= 702
              ? [telegramMessage(702, 42, '/telegram')]
              : telegramApprovalCallback !== undefined && offset <= 703
                ? [{
                    update_id: 703,
                    callback_query: {
                      id: 'telegram-approval-1',
                      from: { id: 2002, is_bot: false },
                      message: { message_id: 91, chat: { id: 1001, type: 'private' } },
                      data: telegramApprovalCallback,
                    },
                  }]
                : []
          response.end(JSON.stringify({ ok: true, result }))
          return
        }
        if (request.url?.endsWith('/sendMessage')) {
          telegramSends.push(body)
          response.end(JSON.stringify({ ok: true, result: { message_id: 91 } }))
          return
        }
        if (request.url?.endsWith('/answerCallbackQuery')) {
          callbackAnswers.push(body)
          response.end(JSON.stringify({ ok: true, result: true }))
          return
        }
        response.statusCode = 404
        response.end(JSON.stringify({ ok: false, error_code: 404 }))
      })
    })
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fake Telegram server did not bind')

    const config = join(root, 'cordis.yml')
    await writeFile(config, JSON.stringify(hostConfig({
      root,
      presetRoot,
      telegramWorkspace,
      feishuWorkspace,
      attentionActivationFile,
      telegramApiBase: `http://127.0.0.1:${address.port}`,
    }), null, 2))
    vi.stubEnv('DSH_TELEGRAM_DUAL_TOKEN', 'test-token')
    vi.stubEnv('DSH_FEISHU_DUAL_APP_ID', 'cli_dual_app')
    vi.stubEnv('DSH_FEISHU_DUAL_APP_SECRET', 'test-secret')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const first = await boot('dsh-dual-workspace-channels-test-1', config)
      let firstTelegramExecution = executionCounts()
      let firstFeishuExecution = executionCounts()
      try {
        const feishu = requireFeishuService(first)
        await vi.waitFor(() => { expect(telegramSends).toHaveLength(1) }, { timeout: 15_000, interval: 25 })
        await feishu.platform.emitMessage(feishuMessage({
          messageId: 'om_feishu_1',
          content: 'feishu-only-token',
        }))
        await vi.waitFor(() => { expect(feishu.platform.texts).toHaveLength(1) }, { timeout: 15_000, interval: 25 })

        const telegramAgent = first.agents.get('telegram-session')
        const feishuAgent = first.agents.get('feishu-session')
        expect(telegramAgent?.session.header.cwd).toBe(canonicalTelegramWorkspace)
        expect(feishuAgent?.session.header.cwd).toBe(canonicalFeishuWorkspace)
        await expect(first.workspaceRegistry.resolveByPath(telegramWorkspace)).resolves.toMatchObject({
          sessionIds: expect.arrayContaining(['telegram-session']),
        })
        await expect(first.workspaceRegistry.resolveByPath(feishuWorkspace)).resolves.toMatchObject({
          sessionIds: expect.arrayContaining(['feishu-session']),
        })
        expect(sessionText(telegramAgent?.session.events)).toContain('telegram-only-token')
        expect(sessionText(telegramAgent?.session.events)).not.toContain('feishu-only-token')
        expect(sessionText(feishuAgent?.session.events)).toContain('feishu-only-token')
        expect(sessionText(feishuAgent?.session.events)).not.toContain('telegram-only-token')
        expect(first.commands.list(telegramAgent).map((command: { name: string }) => command.name)).toContain('telegram')
        expect(first.commands.list(telegramAgent).map((command: { name: string }) => command.name)).not.toContain('feishu')
        expect(first.commands.list(feishuAgent).map((command: { name: string }) => command.name)).toContain('feishu')
        expect(first.commands.list(feishuAgent).map((command: { name: string }) => command.name)).not.toContain('telegram')

        serveTelegramCommand = true
        await feishu.platform.emitMessage(feishuMessage({ messageId: 'om_feishu_command', content: '/feishu' }))
        await vi.waitFor(() => {
          expect(telegramSends).toHaveLength(2)
          expect(feishu.platform.texts).toHaveLength(2)
        }, { timeout: 15_000, interval: 25 })
        expect(telegramSends[1]?.text).toEqual(expect.stringContaining('Telegram route: READY'))
        expect(feishu.platform.texts[1]?.text).toContain('Feishu: READY')

        const agentModule = await import(pathToFileURL(
          join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
        ).href)
        const telegramApproval = agentModule.agentEvents(first, telegramAgent).waterfall('approval/request', {
          toolName: 'telegram-deploy',
          reason: 'Telegram Workspace protected action.',
          signal: new AbortController().signal,
        }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
        await vi.waitFor(() => { expect(telegramSends).toHaveLength(3) })
        expect(feishu.platform.cards).toHaveLength(0)
        telegramApprovalCallback = ((telegramSends[2]?.reply_markup as {
          inline_keyboard?: Array<Array<{ callback_data?: string }>>
        })?.inline_keyboard?.[0]?.[0]?.callback_data)
        await expect(telegramApproval).resolves.toBe('allowed-once')
        await vi.waitFor(() => { expect(callbackAnswers).toHaveLength(1) })

        const feishuApproval = agentModule.agentEvents(first, feishuAgent).waterfall('approval/request', {
          toolName: 'feishu-deploy',
          reason: 'Feishu Workspace protected action.',
          signal: new AbortController().signal,
        }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
        await vi.waitFor(() => { expect(feishu.platform.cards).toHaveLength(1) })
        expect(telegramSends).toHaveLength(3)
        const card = feishu.platform.cards[0]!.card as {
          body?: { elements?: Array<{ actions?: Array<{ value?: unknown }> }> }
        }
        const cardMessageId = feishu.platform.cards[0]!.messageId
        const value = card.body?.elements?.[1]?.actions?.[0]?.value
        await feishu.platform.emitApproval({
          messageId: cardMessageId,
          chatId: 'oc_dual',
          operatorId: 'ou_intruder',
          value,
        })
        await expect(Promise.race([
          feishuApproval.then(() => 'resolved'),
          new Promise<string>(accept => setTimeout(() => accept('pending'), 50)),
        ])).resolves.toBe('pending')
        await feishu.platform.emitApproval({
          messageId: cardMessageId,
          chatId: 'oc_dual',
          operatorId: 'ou_dual',
          value,
        })
        await expect(feishuApproval).resolves.toBe('allowed-once')

        telegramAgent?.followup(freezeMessage({
          id: MessageId('native:telegram-continuation:dual'),
          role: 'user',
          content: [{ type: 'text', text: 'telegram continuation only' }],
          source: { kind: 'user' },
        }))
        await vi.waitFor(() => { expect(telegramSends).toHaveLength(4) }, { timeout: 15_000, interval: 25 })
        expect(feishu.platform.texts).toHaveLength(2)
        feishuAgent?.followup(freezeMessage({
          id: MessageId('native:feishu-continuation:dual'),
          role: 'user',
          content: [{ type: 'text', text: 'feishu continuation only' }],
          source: { kind: 'user' },
        }))
        await vi.waitFor(() => { expect(feishu.platform.texts).toHaveLength(3) }, { timeout: 15_000, interval: 25 })
        expect(telegramSends).toHaveLength(4)

        const gateway = first.get('evoforge.gateway') as {
          route(id: string): { workspaceId: string } | undefined
        }
        const telegramWorkspaceId = gateway.route('telegram-dual')?.workspaceId
        const feishuWorkspaceId = gateway.route('feishu-dual')?.workspaceId
        if (telegramWorkspaceId === undefined || feishuWorkspaceId === undefined) {
          throw new Error('dual Workspace routes did not resolve')
        }
        expect(telegramWorkspaceId).not.toBe(feishuWorkspaceId)
        await writeFile(attentionActivationFile, 'active\n')
        first.emit('evoforge/evolution/settled')
        await vi.waitFor(() => {
          expect(telegramSends.filter(send => String(send.text).startsWith('EvoForge attention'))).toHaveLength(1)
          expect(feishu.platform.texts.filter(send => send.text.startsWith('EvoForge attention'))).toHaveLength(1)
        }, { timeout: 15_000, interval: 25 })
        const telegramAttention = telegramSends.find(send => String(send.text).startsWith('EvoForge attention'))
        const feishuAttention = feishu.platform.texts.find(send => send.text.startsWith('EvoForge attention'))
        expect(telegramAttention?.text).toEqual(expect.stringContaining(`Skill: workspace-${telegramWorkspaceId.slice(0, 8)}`))
        expect(telegramAttention?.text).not.toEqual(expect.stringContaining(feishuWorkspaceId.slice(0, 8)))
        expect(feishuAttention?.text).toContain(`Skill: workspace-${feishuWorkspaceId.slice(0, 8)}`)
        expect(feishuAttention?.text).not.toContain(telegramWorkspaceId.slice(0, 8))
        const source = first.get('evoforge.attentionTestSource') as { calls: string[] } | undefined
        expect(new Set(source?.calls)).toEqual(new Set([telegramWorkspaceId, feishuWorkspaceId]))

        firstTelegramExecution = executionCounts(telegramAgent?.session.events)
        firstFeishuExecution = executionCounts(feishuAgent?.session.events)
      } finally {
        await first.fiber.dispose()
      }

      const telegramSendCountBeforeRestart = telegramSends.length
      const second = await boot('dsh-dual-workspace-channels-test-2', config)
      try {
        const feishu = requireFeishuService(second)
        await feishu.platform.emitMessage(feishuMessage({
          messageId: 'om_feishu_1',
          content: 'feishu-only-token',
        }))
        await new Promise(resolve => setTimeout(resolve, 300))
        expect(telegramSends).toHaveLength(telegramSendCountBeforeRestart)
        expect(feishu.platform.texts).toHaveLength(0)
        expect(telegramSends.filter(send => String(send.text).startsWith('EvoForge attention'))).toHaveLength(1)
        const secondSource = second.get('evoforge.attentionTestSource') as { calls: string[] } | undefined
        const secondGateway = second.get('evoforge.gateway') as {
          route(id: string): { workspaceId: string } | undefined
        }
        const secondTelegramWorkspaceId = secondGateway.route('telegram-dual')?.workspaceId
        const secondFeishuWorkspaceId = secondGateway.route('feishu-dual')?.workspaceId
        expect(secondTelegramWorkspaceId).toBeDefined()
        expect(secondFeishuWorkspaceId).toBeDefined()
        expect(new Set(secondSource?.calls)).toEqual(new Set([
          secondTelegramWorkspaceId,
          secondFeishuWorkspaceId,
        ]))
        expect(executionCounts(second.agents.get('telegram-session')?.session.events)).toEqual(firstTelegramExecution)
        expect(executionCounts(second.agents.get('feishu-session')?.session.events)).toEqual(firstFeishuExecution)
        expect(second.agents.get('telegram-session')?.session.header.cwd).toBe(canonicalTelegramWorkspace)
        expect(second.agents.get('feishu-session')?.session.header.cwd).toBe(canonicalFeishuWorkspace)
      } finally {
        await second.fiber.dispose()
      }
    } finally {
      process.chdir(previousCwd)
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 90_000)
})

function hostConfig(input: {
  root: string
  presetRoot: string
  telegramWorkspace: string
  feishuWorkspace: string
  attentionActivationFile: string
  telegramApiBase: string
}): unknown[] {
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
              dshHome: join(input.root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(input.root, '.agents-home') } },
              invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
              persona: 'Keyless dual Workspace channel isolation smoke.',
            },
          },
          {
            id: 'persistence',
            name: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: join(input.root, 'sessions'), compression: 'none' },
          },
          { id: 'checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
        ],
      },
    },
    { id: 'storage', name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js') },
    {
      id: 'storage-json',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
      config: { root: join(input.root, 'channel-storage') },
    },
    {
      id: 'storage-domain',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
      config: { backend: 'json' },
    },
    {
      id: 'attachment-local',
      name: join(dshSourceDir, 'packages', 'attachment', 'attachment-local', 'lib', 'index.js'),
      config: { dshHome: join(input.root, '.dsh-home') },
    },
    { id: 'commands', name: join(dshSourceDir, 'packages', 'interaction', 'commands', 'lib', 'index.js') },
    {
      id: 'agent-presets',
      name: join(dshSourceDir, 'packages', 'preset', 'agent-presets', 'lib', 'index.js'),
      config: {
        default: 'channel-test',
        roots: [{ path: input.presetRoot, trust: 'system' }],
        includeUserRoot: false,
      },
    },
    { id: 'workspace', name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js') },
    {
      id: 'channel-gateway-bootstrap',
      name: join(packageRoot, 'test', 'fixtures', 'dual-workspace-gateway-bootstrap.ts'),
      config: {
        gatewayEntry: pathToFileURL(join(gatewayRoot, 'dist', 'index.mjs')).href,
        routes: [
          {
            id: 'telegram-dual', adapter: 'telegram', accountId: 'test-bot',
            conversationId: '1001', userId: '2002', workspacePath: input.telegramWorkspace,
            sessionId: 'telegram-session', agentPreset: 'channel-test', provider: 'cli-mock', model: 'cli-mock',
          },
          {
            id: 'feishu-dual', adapter: 'feishu', accountId: 'cli_dual_app',
            conversationId: 'oc_dual', userId: 'ou_dual', workspacePath: input.feishuWorkspace,
            sessionId: 'feishu-session', agentPreset: 'channel-test', provider: 'cli-mock', model: 'cli-mock',
          },
        ],
      },
    },
    {
      id: 'telegram',
      name: join(telegramRoot, 'dist', 'index.mjs'),
      config: {
        apiBase: input.telegramApiBase,
        pollTimeoutSeconds: 1,
        routeId: 'telegram-dual',
        tokenEnv: 'DSH_TELEGRAM_DUAL_TOKEN',
      },
    },
    {
      id: 'feishu-test-runtime',
      name: join(packageRoot, 'test', 'fixtures', 'runtime-bootstrap.ts'),
      config: {
        feishuEntry: pathToFileURL(join(packageRoot, 'dist', 'index.mjs')).href,
        routeIds: ['feishu-dual'],
        appIdEnv: 'DSH_FEISHU_DUAL_APP_ID',
        appSecretEnv: 'DSH_FEISHU_DUAL_APP_SECRET',
      },
    },
    {
      id: 'evolution-source',
      name: join(attentionRoot, 'test', 'fixtures', 'evolution-source.ts'),
      config: { activationFile: input.attentionActivationFile },
    },
    {
      id: 'evolve-attention',
      name: join(attentionRoot, 'dist', 'index.mjs'),
    },
  ]
}

function requireFeishuService(ctx: { get(name: string): unknown }): {
  platform: {
    texts: Array<{ chatId: string; text: string; options?: FeishuSendOptions }>
    cards: Array<{ messageId: string; chatId: string; card: object }>
    emitMessage(message: FeishuInboundMessage): Promise<void>
    emitApproval(action: FeishuApprovalAction): Promise<void>
  }
  runtime: FeishuRuntime
} {
  const service = ctx.get('evoforge.feishuTest')
  if (service === undefined) throw new Error('Feishu test runtime service did not load')
  return service as ReturnType<typeof requireFeishuService>
}

function telegramMessage(updateId: number, messageId: number, text: string): object {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      chat: { id: 1001, type: 'private' },
      from: { id: 2002, is_bot: false },
      text,
    },
  }
}

function feishuMessage(overrides: Partial<FeishuInboundMessage>): FeishuInboundMessage {
  return Object.freeze({
    messageId: 'om_default',
    chatId: 'oc_dual',
    chatType: 'p2p',
    senderId: 'ou_dual',
    content: 'feishu-only-token',
    rawContentType: 'text',
    resources: [],
    ...overrides,
  })
}

function sessionText(events: readonly SessionEvent[] | undefined): string {
  return JSON.stringify(events ?? [])
}

function executionCounts(events: readonly SessionEvent[] = []): Record<string, number> {
  return {
    channelMessages: events.filter(event => event.type === 'user/message'
      && String(event.data.id).startsWith('channel:')).length,
    commandRuns: events.filter(event => event.type === 'command/run').length,
    completedTurns: events.filter(event => event.type === 'turn/end').length,
  }
}
