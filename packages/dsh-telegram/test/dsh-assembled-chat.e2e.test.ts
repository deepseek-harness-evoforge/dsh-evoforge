import { createServer } from 'node:http'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFile = promisify(execFileCallback)
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Telegram chat', () => {
  it('routes one exact private message through the real Agent Loop and sends the final answer back', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-telegram-assembled-'))
    temporaryRoots.push(root)
    const sends: unknown[] = []
    const callbackAnswers: unknown[] = []
    let servedUpdate = false
    let callbackData: string | undefined
    let servedCallback = false
    let commandRequested = false
    let servedCommand = false
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => { chunks.push(chunk) })
      request.on('end', () => {
        const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
        response.setHeader('content-type', 'application/json')
        if (request.url?.endsWith('/getUpdates')) {
          const result = !servedUpdate
            ? [{
                update_id: 77,
                message: {
                  message_id: 9,
                  chat: { id: 1001, type: 'private' },
                  from: { id: 2002, is_bot: false },
                  text: 'verify the real DSH Telegram path',
                },
              }]
            : callbackData !== undefined && !servedCallback
              ? [{
                  update_id: 78,
                  callback_query: {
                    id: 'approval-callback-1',
                    from: { id: 2002, is_bot: false },
                    message: { message_id: 44, chat: { id: 1001, type: 'private' } },
                    data: callbackData,
                  },
                }]
              : commandRequested && !servedCommand
                ? [{
                    update_id: 79,
                    message: {
                      message_id: 10,
                      chat: { id: 1001, type: 'private' },
                      from: { id: 2002, is_bot: false },
                      text: '/telegram',
                    },
                  }]
              : []
          if (!servedUpdate) servedUpdate = true
          else if (callbackData !== undefined && !servedCallback && result.length > 0) servedCallback = true
          else if (result.length > 0) servedCommand = true
          response.end(JSON.stringify({ ok: true, result }))
          return
        }
        if (request.url?.endsWith('/sendMessage')) {
          sends.push(body)
          if (sends.length === 1) {
            response.statusCode = 429
            response.end(JSON.stringify({
              ok: false,
              error_code: 429,
              parameters: { retry_after: 1 },
            }))
            return
          }
          response.end(JSON.stringify({ ok: true, result: { message_id: 44 } }))
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
                agents: [{ id: 'main', sessionId: 'main', provider: 'cli-mock', model: 'cli-mock', cwd: root }],
                workspaceContext: false,
                dshHome: join(root, '.dsh-home'),
                skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
                invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
                persona: 'Keyless Telegram assembled smoke.',
              },
            },
            {
              id: 'persistence',
              name: '@deepseek-ai/dsh-session-persistence-jsonl',
              disabled: true,
            },
            {
              id: 'checkpoint-policy',
              name: '@deepseek-ai/dsh-session-checkpoint-policy',
              disabled: true,
            },
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
        config: { root: join(root, 'telegram-storage') },
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
        id: 'telegram',
        name: join(packageRoot, 'dist', 'index.mjs'),
        config: {
          agentId: 'main',
          apiBase: `http://127.0.0.1:${address.port}`,
          chatId: 1001,
          pollTimeoutSeconds: 1,
          tokenEnv: 'DSH_TELEGRAM_TEST_TOKEN',
          userId: 2002,
        },
      },
    ], null, 2))
    vi.stubEnv('DSH_TELEGRAM_TEST_TOKEN', 'test-token')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const previousCwd = process.cwd()
    process.chdir(root)
    const ctx = await boot('dsh-telegram-assembled-test', config)
    try {
      try {
        await vi.waitFor(() => {
          expect(sends).toEqual([
            expect.objectContaining({
              chat_id: 1001,
              reply_parameters: { allow_sending_without_reply: true, message_id: 9 },
              text: expect.stringContaining('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'),
            }),
            expect.objectContaining({
              chat_id: 1001,
              reply_parameters: { allow_sending_without_reply: true, message_id: 9 },
              text: expect.stringContaining('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'),
            }),
          ])
        }, { timeout: 15_000, interval: 25 })
      } catch (error) {
        const agent = ctx.agents.get('main')
        const diagnostic = {
          servedUpdate,
          agentIds: ctx.agents.list().map((candidate: { id: unknown }) => String(candidate.id)),
          agentStatus: agent?.status,
          eventTypes: agent?.session.events.map((event: SessionEvent) => event.type),
          deliveries: [...(ctx.storageDomain.get('evoforge_telegram')?.table('deliveries').entries() ?? [])],
        }
        throw new Error(`Telegram assembled path did not send: ${JSON.stringify(diagnostic)}`, { cause: error })
      }
      const agent = ctx.agents.get('main')
      expect(agent).toBeDefined()
      const deliveryDomain = ctx.storageDomain.get('evoforge_telegram')
      await vi.waitFor(() => {
        const records = [...(deliveryDomain?.table('deliveries').entries() ?? [])]
          .map(([, value]) => value as { status?: unknown })
        expect(records).toEqual([expect.objectContaining({ status: 'delivered' })])
      })
      const events = agent?.session.events as readonly SessionEvent[] | undefined
      expect(events?.some(event => event.type === 'user/message'
        && event.data.id === 'telegram:update:77')).toBe(true)

      // Goal and Schedule continuations use the same native Agent followup seam. Prove that a
      // completed turn which did not originate in Telegram is also routed, without reply metadata.
      agent?.followup(freezeMessage({
        id: MessageId('native:continuation:1'),
        role: 'user',
        content: [{ type: 'text', text: 'native continuation outside Telegram' }],
        source: { kind: 'user' },
      }))
      await vi.waitFor(() => { expect(sends).toHaveLength(3) }, { timeout: 15_000, interval: 25 })
      expect(sends[2]).toEqual(expect.objectContaining({
        chat_id: 1001,
        text: expect.stringContaining('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'),
      }))
      expect(sends[2]).not.toHaveProperty('reply_parameters')

      const agentModule = await import(pathToFileURL(
        join(dshSourceDir, 'packages', 'core', 'agent', 'lib', 'index.js'),
      ).href)
      const approval = agentModule.agentEvents(ctx, agent).waterfall('approval/request', {
        toolName: 'deploy',
        reason: 'Protected production action.',
        signal: new AbortController().signal,
      }, () => Promise.resolve<ApprovalOutcome>('unavailable'))
      await vi.waitFor(() => { expect(sends).toHaveLength(4) })
      const approvalSend = sends[3] as {
        reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
        text?: string
      }
      expect(approvalSend.text).toContain('Approval required')
      callbackData = approvalSend.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data
      expect(callbackData).toMatch(/^dsh:a:[A-Za-z0-9_-]{1,32}:allow$/u)
      await expect(approval).resolves.toBe('allowed-once')
      await vi.waitFor(() => {
        expect(callbackAnswers).toEqual([{ callback_query_id: 'approval-callback-1' }])
      })
      commandRequested = true
      await vi.waitFor(() => { expect(sends).toHaveLength(5) })
      expect((sends[4] as { text?: string }).text).toContain('Telegram route: READY')
      expect((sends[4] as { text?: string }).text).toContain('Model surface: 0 tools, 0 prompt sections, 0 skills.')
      await vi.waitFor(() => {
        const currentEvents = agent?.session.events as readonly SessionEvent[] | undefined
        expect(currentEvents?.some(event => event.type === 'command/run'
          && event.data.name === 'telegram')).toBe(true)
      })

      const route = ctx.get('evoforge.telegramRoute') as {
        notify(input: { id: string; text: string }): Promise<{ created: boolean; status: string }>
      } | undefined
      if (route === undefined) throw new Error('Telegram host route service did not load')
      const notice = {
        id: 'f'.repeat(64),
        text: `EvoForge attention\nInspect: /evolve review ${'a'.repeat(64)}`,
      }
      await expect(route.notify(notice)).resolves.toMatchObject({ created: true })
      await vi.waitFor(() => { expect(sends).toHaveLength(6) })
      expect(sends[5]).toEqual(expect.objectContaining({
        chat_id: 1001,
        text: notice.text,
      }))
      await expect(route.notify(notice)).resolves.toMatchObject({
        created: false,
        status: 'delivered',
      })
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(sends).toHaveLength(6)
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 30_000)
})
