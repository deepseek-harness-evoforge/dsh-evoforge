import { createServer } from 'node:http'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootLatestDshProfile } from './latest-dsh-test-runtime.ts'

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

describe.skipIf(process.platform !== 'darwin')('DSH assembled Telegram pairing', () => {
  it('returns a code for an unknown DM and dispatches only the next message after Gateway approval', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-telegram-pairing-'))
    temporaryRoots.push(root)
    const presetRoot = join(root, 'agent-presets')
    await mkdir(join(presetRoot, 'pairing-test'), { recursive: true })
    await writeFile(join(presetRoot, 'pairing-test', 'preset.yml'), 'name: Telegram Pairing Test\n')
    await writeFile(join(presetRoot, 'pairing-test', 'agent.cordis.yml'), '[]\n')

    const sends: Array<Record<string, unknown>> = []
    let firstServed = false
    let secondServed = false
    let approved = false
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => { chunks.push(chunk) })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        if (request.url?.endsWith('/getUpdates')) {
          const result = !firstServed
            ? [{
                update_id: 1,
                message: {
                  message_id: 10,
                  chat: { id: 3003, type: 'private' },
                  from: { id: 4004, is_bot: false },
                  text: 'first contact',
                },
              }]
            : approved && !secondServed
              ? [{
                  update_id: 2,
                  message: {
                    message_id: 11,
                    chat: { id: 3003, type: 'private' },
                    from: { id: 4004, is_bot: false },
                    text: 'continue after approval',
                  },
                }]
              : []
          if (!firstServed) firstServed = true
          else if (approved && !secondServed) secondServed = true
          response.end(JSON.stringify({ ok: true, result }))
          return
        }
        if (request.url?.endsWith('/sendMessage')) {
          const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          sends.push(body)
          response.end(JSON.stringify({ ok: true, result: { message_id: 90 + sends.length } }))
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
                persona: 'Keyless Telegram pairing assembled smoke.',
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
      { id: 'storage-json', name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'), config: { root: join(root, 'storage') } },
      { id: 'storage-domain', name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'), config: { backend: 'json' } },
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
          accountId: 'test-bot',
          conversationId: '9999',
          userId: '9998',
          sessionId: 'pairing-session',
          agentPreset: 'pairing-test',
          provider: 'cli-mock',
          model: 'cli-mock',
        },
      },
      {
        id: 'telegram',
        name: join(packageRoot, 'dist', 'index.mjs'),
        config: {
          mode: 'pairing',
          accountId: 'test-bot',
          apiBase: `http://127.0.0.1:${address.port}`,
          pollTimeoutSeconds: 1,
          tokenEnv: 'DSH_TELEGRAM_TEST_TOKEN',
        },
      },
    ], null, 2))
    vi.stubEnv('DSH_TELEGRAM_TEST_TOKEN', 'test-token')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const previousCwd = process.cwd()
    process.chdir(root)
    const ctx = await bootLatestDshProfile({
      binName: 'dsh-telegram-pairing-test',
      configPath: config,
      dshSourceDir,
      home: join(root, '.dsh-home'),
    })
    try {
      const gateway = ctx.get('evoforge.gateway') as {
        resolve(id: string): Promise<{ session: { snapshotEvents(): readonly SessionEvent[] }; whenIdle(): Promise<void> }>
        route(id: string): { workspaceId: string } | undefined
        approvePairing(input: { adapter: string; accountId: string; code: string; target: { id: string; workspaceId: string; sessionId: string; agentPreset: string; provider: string; model: string }; now: number }): Promise<unknown>
        healthSnapshot(now?: number): { routes: { items: readonly { id: string; adapter: string; paired: boolean }[] } }
      }
      const agent = await gateway.resolve('existing-test-route')
      await vi.waitFor(() => { expect(sends[0]?.text).toEqual(expect.stringContaining('EvoForge pairing code')) }, { timeout: 10_000 })
      const code = String(sends[0]?.text).match(/[A-HJ-NP-Z2-9]{10}/u)?.[0]
      expect(code).toBeDefined()
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && String(event.data.id).startsWith('channel:'))).toHaveLength(0)
      if (code === undefined) throw new Error('Telegram pairing code missing')
      approved = true
      await gateway.approvePairing({
        adapter: 'telegram',
        accountId: 'test-bot',
        code,
        target: {
          id: 'telegram-paired',
          workspaceId: gateway.route('existing-test-route')!.workspaceId,
          sessionId: 'pairing-session',
          agentPreset: 'pairing-test',
          provider: 'cli-mock',
          model: 'cli-mock',
        },
        now: Date.now(),
      })
      await agent.whenIdle()
      try {
        await vi.waitFor(() => {
          expect(sends.some(item => typeof item.text === 'string'
            && item.text.includes('CLI tool round trip complete: CLI_TOOL_ROUND_TRIP'))).toBe(true)
        }, { timeout: 15_000 })
      } catch (error) {
        throw new Error(JSON.stringify({
          sends,
          events: agent.session.snapshotEvents().map(event => ({ type: event.type, data: event.data })),
          routes: gateway.healthSnapshot(Date.now()).routes,
        }), { cause: error })
      }
      const channelMessages = agent.session.snapshotEvents().filter(event => event.type === 'user/message'
        && String(event.data.id).startsWith('channel:'))
      expect(channelMessages).toHaveLength(1)
      expect(gateway.healthSnapshot(Date.now()).routes.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String), adapter: 'telegram', paired: true }),
      ]))
      expect(sends[0]?.reply_parameters).toEqual(expect.objectContaining({ message_id: 10 }))
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 45_000)
})
