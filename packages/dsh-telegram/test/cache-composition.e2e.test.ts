import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
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
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, result: [] }))
    })
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fake Telegram server did not bind')

    vi.stubEnv('DSH_TELEGRAM_TEST_TOKEN', 'test-token')
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    try {
      const native = await captureComposition(root, false, address.port)
      const enabled = await captureComposition(root, true, address.port)
      expect(enabled).toEqual(native)
      expect(JSON.stringify(enabled)).not.toContain('telegram')
    } finally {
      await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
    }
  }, 30_000)
})

async function captureComposition(root: string, telegram: boolean, port: number): Promise<unknown> {
  const label = telegram ? 'enabled' : 'native'
  const output = join(root, `${label}-composition.jsonl`)
  const config = join(root, `${label}-cordis.yml`)
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
              agents: [{
                id: 'main',
                sessionId: 'main',
                provider: 'composition-recorder',
                model: 'composition-recorder',
                cwd: root,
              }],
              workspaceContext: false,
              dshHome: join(root, '.dsh-home'),
              skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
              persona: 'Stable Telegram composition fixture.',
            },
          },
          { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', disabled: true },
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
    ...telegram ? [{
      id: 'telegram',
      name: join(packageRoot, 'dist', 'index.mjs'),
      config: {
        agentId: 'main',
        apiBase: `http://127.0.0.1:${port}`,
        chatId: 1001,
        pollTimeoutSeconds: 1,
        tokenEnv: 'DSH_TELEGRAM_TEST_TOKEN',
        userId: 2002,
      },
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
    const lines = (await readFile(output, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    return JSON.parse(lines[0]!) as unknown
  } finally {
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
  }
}
