import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootLatestDshProfile } from './latest-dsh-test-runtime.ts'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled GitHub review cache contract', () => {
  it('keeps the complete normal model request composition identical while the host poller is enabled', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-github-review-composition-'))
    temporaryRoots.push(root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')

    const native = await captureComposition(root, 'native')
    const github = await captureComposition(root, 'github')

    expect(github).toEqual(native)
    const modelMessages = JSON.stringify(github)
    expect(modelMessages).not.toContain('trustedReviewers')
    expect(modelMessages).not.toContain('Keep the cache prefix stable.')
  }, 30_000)
})

async function captureComposition(root: string, mode: 'native' | 'github'): Promise<unknown> {
  const output = join(root, `${mode}-composition.jsonl`)
  const config = join(root, `${mode}-cordis.yml`)
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
        path: join(dshSourceDir, 'packages', 'bundle', 'base', 'cordis.patch.yml'),
        patches: [
          { id: 'llm-deepseek', name: '@deepseek-ai/dsh-llm-deepseek', disabled: true },
          {
            id: 'agent-loop',
            name: '@deepseek-ai/dsh-agent-loop',
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
              invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
              persona: 'Stable review composition fixture.',
            },
          },
          { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl', disabled: true },
          { id: 'session-checkpoint-policy', name: '@deepseek-ai/dsh-session-checkpoint-policy', disabled: true },
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
      config: { root: join(root, `${mode}-storage`) },
    },
    {
      id: 'storage-domain',
      name: join(dshSourceDir, 'packages', 'storage', 'storage-domain', 'lib', 'index.js'),
      config: { backend: 'json' },
    },
    ...mode === 'native' ? [] : [{
      id: 'github-review',
      name: join(packageRoot, 'dist', 'index.mjs'),
      config: {
        agentId: 'main',
        owner: 'deepseek-harness-evoforge',
        repo: 'dsh-evoforge',
        trustedReviewers: ['alice'],
        apiBase: 'http://127.0.0.1:9',
      },
    }],
  ], null, 2))

  const previousCwd = process.cwd()
  process.chdir(root)
  const ctx = await bootLatestDshProfile({
    binName: `dsh-github-review-composition-${mode}`,
    configPath: config,
    dshSourceDir,
    home: join(root, '.dsh-home'),
  })
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
    // Current DSH may issue an additional title/metadata request during the
    // same normal turn. Compare the complete request sequence, not only the
    // first call, so a new core lifecycle does not silently escape this cache
    // contract.
    expect(lines.length).toBeGreaterThan(0)
    return lines.map(line => stripEphemeralMessageIds(JSON.parse(line) as unknown))
  } finally {
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
  }
}

/** DSH message ids are UUIDs allocated per boot and are not request semantics. */
function stripEphemeralMessageIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEphemeralMessageIds)
  if (value === null || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' && typeof child === 'string') continue
    result[key] = stripEphemeralMessageIds(child)
  }
  return result
}
