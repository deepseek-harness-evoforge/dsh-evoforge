import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

describe.skipIf(process.platform !== 'darwin')('complete channel composition cache contract', () => {
  it('keeps both Workspace requests byte-equivalent with Gateway, Telegram, Feishu, and attention active', async () => {
    for (const cwd of [gatewayRoot, telegramRoot, packageRoot, attentionRoot]) {
      await execFile('pnpm', ['run', 'build'], { cwd, encoding: 'utf8', timeout: 30_000 })
    }
    const root = await mkdtemp(join(tmpdir(), 'dsh-full-channel-composition-'))
    temporaryRoots.push(root)
    const sentTelegramTexts: string[] = []
    const server = createServer(async (request, response) => {
      if (request.url?.endsWith('/sendMessage') === true) {
        const body = JSON.parse(await requestText(request)) as { text?: unknown }
        if (typeof body.text === 'string') sentTelegramTexts.push(body.text)
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        ok: true,
        result: request.url?.endsWith('/sendMessage') ? { message_id: 1 } : [],
      }))
    })
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fake Telegram server did not bind')

    vi.stubEnv('DSH_TELEGRAM_CACHE_TOKEN', 'test-token')
    vi.stubEnv('DSH_FEISHU_CACHE_APP_ID', 'cli_cache_app')
    vi.stubEnv('DSH_FEISHU_CACHE_APP_SECRET', 'test-secret')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    try {
      const native = await captureCompositions(root, 'native', address.port, sentTelegramTexts)
      const channels = await captureCompositions(root, 'channels', address.port, sentTelegramTexts)

      expect(channels.requests).toEqual(native.requests)
      const serialized = JSON.stringify(channels.requests)
      expect(serialized).not.toContain('telegram-cache')
      expect(serialized).not.toContain('feishu-cache')
      expect(serialized).not.toContain('cli_cache_app')
      expect(serialized).not.toContain('EvoForge attention')
      expect(sentTelegramTexts.filter(text => text.startsWith('EvoForge attention'))).toHaveLength(1)
      expect(channels.feishuTexts.filter(text => text.startsWith('EvoForge attention'))).toHaveLength(1)
    } finally {
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 60_000)
})

async function captureCompositions(
  root: string,
  mode: 'native' | 'channels',
  telegramPort: number,
  sentTelegramTexts: readonly string[],
): Promise<{ requests: Record<string, unknown>; feishuTexts: string[] }> {
  const output = join(root, `${mode}-composition.jsonl`)
  const config = join(root, `${mode}-cordis.yml`)
  const presetRoot = join(root, `${mode}-agent-presets`)
  const telegramWorkspace = join(root, 'telegram-workspace')
  const feishuWorkspace = join(root, 'feishu-workspace')
  await Promise.all([
    mkdir(join(presetRoot, 'channel-cache'), { recursive: true }),
    mkdir(telegramWorkspace, { recursive: true }),
    mkdir(feishuWorkspace, { recursive: true }),
  ])
  await writeFile(join(presetRoot, 'channel-cache', 'preset.yml'), 'name: Channel Cache\n')
  await writeFile(join(presetRoot, 'channel-cache', 'agent.cordis.yml'), '[]\n')
  await writeFile(output, '')
  await writeFile(config, JSON.stringify(hostConfig({
    root,
    mode,
    output,
    presetRoot,
    telegramWorkspace,
    feishuWorkspace,
    telegramApiBase: `http://127.0.0.1:${telegramPort}`,
  }), null, 2))

  const { boot } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  const previousCwd = process.cwd()
  process.chdir(root)
  const ctx = await boot(`dsh-full-channel-composition-${mode}`, config)
  try {
    const requests: Record<string, unknown> = {}
    for (const id of ['telegram-session', 'feishu-session'] as const) {
      const agent = ctx.agents.get(id)
      if (agent === undefined) throw new Error(`composition Agent ${id} was not created`)
      agent.followup(freezeMessage({
        id: MessageId(`composition:${id}:1`),
        role: 'user',
        content: [{ type: 'text', text: `same native request for ${id}` }],
        source: { kind: 'user' },
      }))
      const expectedLines = Object.keys(requests).length + 1
      await vi.waitFor(async () => {
        expect(nonemptyLines(await readFile(output, 'utf8'))).toHaveLength(expectedLines)
      }, { timeout: 10_000, interval: 25 })
      const lines = nonemptyLines(await readFile(output, 'utf8'))
      requests[id] = JSON.parse(lines[expectedLines - 1]!) as unknown
    }

    const feishuTexts = mode === 'channels'
      ? ((ctx.get('evoforge.feishuTest') as {
          platform: { texts: Array<{ text: string }> }
        } | undefined)?.platform.texts.map(item => item.text) ?? [])
      : []
    if (mode === 'channels') {
      await vi.waitFor(() => {
        expect(sentTelegramTexts.filter(text => text.startsWith('EvoForge attention'))).toHaveLength(1)
        const service = ctx.get('evoforge.feishuTest') as {
          platform: { texts: Array<{ text: string }> }
        } | undefined
        expect(service?.platform.texts.filter(item => item.text.startsWith('EvoForge attention'))).toHaveLength(1)
      }, { timeout: 10_000, interval: 25 })
      const service = ctx.get('evoforge.feishuTest') as {
        platform: { texts: Array<{ text: string }> }
      }
      return { requests, feishuTexts: service.platform.texts.map(item => item.text) }
    }
    return { requests, feishuTexts }
  } finally {
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
  }
}

function hostConfig(input: {
  root: string
  mode: 'native' | 'channels'
  output: string
  presetRoot: string
  telegramWorkspace: string
  feishuWorkspace: string
  telegramApiBase: string
}): unknown[] {
  const native = input.mode === 'native'
  return [
    {
      id: 'composition-llm',
      name: join(telegramRoot, 'test', 'fixtures', 'composition-llm.ts'),
      config: { output: input.output },
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
              agents: native ? [
                {
                  id: 'telegram-session', sessionId: 'telegram-session',
                  provider: 'composition-recorder', model: 'composition-recorder', cwd: input.telegramWorkspace,
                },
                {
                  id: 'feishu-session', sessionId: 'feishu-session',
                  provider: 'composition-recorder', model: 'composition-recorder', cwd: input.feishuWorkspace,
                },
              ] : [],
              workspaceContext: false,
              dshHome: join(input.root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(input.root, '.agents-home') } },
              invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
              persona: 'Stable complete composition fixture.',
            },
          },
          {
            id: 'persistence',
            name: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: join(input.root, `${input.mode}-sessions`), compression: 'none' },
          },
          { id: 'checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
        ],
      },
    },
    { id: 'storage', name: join(dshSourceDir, 'packages', 'storage', 'storage', 'lib', 'index.js') },
    {
      id: 'storage-json',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-json', 'lib', 'index.js'),
      config: { root: join(input.root, `${input.mode}-storage`) },
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
      config: {
        default: 'channel-cache',
        roots: [{ path: input.presetRoot, trust: 'system' }],
        includeUserRoot: false,
      },
    },
    { id: 'workspace', name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js') },
    ...native ? [] : channelPlugins(input),
  ]
}

function channelPlugins(input: {
  telegramWorkspace: string
  feishuWorkspace: string
  telegramApiBase: string
}): unknown[] {
  return [
    {
      id: 'channel-gateway-bootstrap',
      name: join(packageRoot, 'test', 'fixtures', 'dual-workspace-gateway-bootstrap.ts'),
      config: {
        gatewayEntry: pathToFileURL(join(gatewayRoot, 'dist', 'index.mjs')).href,
        routes: [
          {
            id: 'telegram-cache', adapter: 'telegram', accountId: 'test-bot',
            conversationId: '1001', userId: '2002', workspacePath: input.telegramWorkspace,
            sessionId: 'telegram-session', agentPreset: 'channel-cache',
            provider: 'composition-recorder', model: 'composition-recorder',
          },
          {
            id: 'feishu-cache', adapter: 'feishu', accountId: 'cli_cache_app',
            conversationId: 'oc_cache', userId: 'ou_cache', workspacePath: input.feishuWorkspace,
            sessionId: 'feishu-session', agentPreset: 'channel-cache',
            provider: 'composition-recorder', model: 'composition-recorder',
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
        routeId: 'telegram-cache',
        tokenEnv: 'DSH_TELEGRAM_CACHE_TOKEN',
      },
    },
    {
      id: 'feishu-test-runtime',
      name: join(packageRoot, 'test', 'fixtures', 'runtime-bootstrap.ts'),
      config: {
        feishuEntry: pathToFileURL(join(packageRoot, 'dist', 'index.mjs')).href,
        routeIds: ['feishu-cache'],
        appIdEnv: 'DSH_FEISHU_CACHE_APP_ID',
        appSecretEnv: 'DSH_FEISHU_CACHE_APP_SECRET',
      },
    },
    {
      id: 'evolution-source',
      name: join(attentionRoot, 'test', 'fixtures', 'evolution-source.ts'),
      config: { active: true },
    },
    { id: 'evolve-attention', name: join(attentionRoot, 'dist', 'index.mjs') },
  ]
}

function nonemptyLines(value: string): string[] {
  return value.split('\n').filter(line => line.length > 0)
}

async function requestText(request: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}
