import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const bridgeRoot = resolve(packageRoot, '../dsh-evolve-telegram')
const routerRoot = resolve(packageRoot, '../dsh-channel-router')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Telegram cache contract', () => {
  it('keeps the complete model request composition identical when the adapter is enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-telegram-composition-'))
    temporaryRoots.push(root)
    const sentTexts: string[] = []
    const server = createServer(async (request, response) => {
      if (request.url?.endsWith('/sendMessage') === true) {
        const body = JSON.parse(await requestText(request)) as { text?: unknown }
        if (typeof body.text === 'string') sentTexts.push(body.text)
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

    vi.stubEnv('DSH_TELEGRAM_TEST_TOKEN', 'test-token')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    try {
      const native = await captureComposition(root, 'native', address.port, sentTexts)
      const telegram = await captureComposition(root, 'telegram', address.port, sentTexts)
      const attention = await captureComposition(root, 'attention', address.port, sentTexts)
      expect(telegram).toEqual(native)
      expect(attention).toEqual(native)
      expect(JSON.stringify(attention)).not.toContain('telegram')
      expect(JSON.stringify(attention)).not.toContain('evolve')
      expect(sentTexts.filter(text => text.startsWith('EvoForge attention'))).toHaveLength(1)
    } finally {
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 30_000)
})

async function captureComposition(
  root: string,
  mode: 'native' | 'telegram' | 'attention',
  port: number,
  sentTexts: readonly string[],
): Promise<unknown> {
  const label = mode
  const output = join(root, `${label}-composition.jsonl`)
  const config = join(root, `${label}-cordis.yml`)
  const presetRoot = join(root, `${label}-agent-presets`)
  await mkdir(join(presetRoot, 'telegram-test'), { recursive: true })
  await writeFile(join(presetRoot, 'telegram-test', 'preset.yml'), 'name: Telegram Test\n')
  await writeFile(join(presetRoot, 'telegram-test', 'agent.cordis.yml'), '[]\n')
  await writeFile(output, '')
  await writeFile(config, JSON.stringify([
    {
      id: 'composition-llm',
      name: join(packageRoot, 'test', 'fixtures', 'composition-llm.ts'),
      config: { output },
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
              agents: mode === 'native' ? [{
                id: 'main',
                sessionId: 'main',
                provider: 'composition-recorder',
                model: 'composition-recorder',
                cwd: root,
              }] : [],
              workspaceContext: false,
              dshHome: join(root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
              persona: 'Stable Telegram composition fixture.',
            },
          },
          {
            id: 'persistence',
            name: '@deepseek-ai/dsh-session-persistence-jsonl',
            config: { root: join(root, `${label}-sessions`), compression: 'none' },
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
      config: { root: join(root, `${label}-storage`) },
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
        default: 'telegram-test',
        roots: [{ path: presetRoot, trust: 'system' }],
        includeUserRoot: false,
      },
    },
    {
      id: 'workspace',
      name: join(dshSourceDir, 'packages', 'workspace', 'workspace', 'lib', 'index.js'),
    },
    ...mode === 'native' ? [] : [{
      id: 'channel-router-bootstrap',
      name: join(packageRoot, 'test', 'fixtures', 'router-bootstrap.ts'),
      config: {
        routerEntry: pathToFileURL(join(routerRoot, 'dist', 'index.mjs')).href,
        workspacePath: root,
        routeId: 'telegram-main',
        accountId: 'test-bot',
        conversationId: '1001',
        userId: '2002',
        sessionId: 'main',
        agentPreset: 'telegram-test',
        provider: 'composition-recorder',
        model: 'composition-recorder',
      },
    }],
    ...mode === 'native' ? [] : [{
      id: 'telegram',
      name: join(packageRoot, 'dist', 'index.mjs'),
      config: {
        apiBase: `http://127.0.0.1:${port}`,
        pollTimeoutSeconds: 1,
        routeId: 'telegram-main',
        tokenEnv: 'DSH_TELEGRAM_TEST_TOKEN',
      },
    }],
    ...mode === 'attention' ? [{
      id: 'evolution-source',
      name: join(bridgeRoot, 'test', 'fixtures', 'evolution-source.ts'),
    }, {
      id: 'evolve-telegram',
      name: join(bridgeRoot, 'dist', 'index.mjs'),
    }] : [],
  ], null, 2))

  const { boot } = await import(pathToFileURL(
    join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
  ).href)
  const previousCwd = process.cwd()
  process.chdir(root)
  const ctx = await boot(`dsh-telegram-composition-${label}`, config)
  try {
    const agent = ctx.agents.get('main')
    if (agent === undefined) throw new Error('composition Agent was not created')
    agent.followup(freezeMessage({
      id: MessageId('composition:user:1'),
      role: 'user',
      content: [{ type: 'text', text: 'same native request' }],
      source: { kind: 'user' },
    }))
    await vi.waitFor(async () => {
      expect((await readFile(output, 'utf8')).trim()).not.toBe('')
    }, { timeout: 10_000, interval: 25 })
    if (mode === 'attention') {
      await vi.waitFor(() => {
        expect(sentTexts.filter(text => text.startsWith('EvoForge attention'))).toHaveLength(1)
      }, { timeout: 10_000, interval: 25 })
    }
    const lines = (await readFile(output, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    return JSON.parse(lines[0]!) as unknown
  } finally {
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
  }
}

async function requestText(request: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}
