import { execFile as execFileCallback } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled GitHub review follow-up', () => {
  it('observes the Agent-scoped Tool result and appends the review through the real Agent Loop', async () => {
    await execFile('pnpm', ['run', 'build'], { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 })
    const root = await mkdtemp(join(tmpdir(), 'dsh-github-review-assembled-'))
    temporaryRoots.push(root)
    const output = join(root, 'composition.jsonl')
    await writeFile(output, '')
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url?.includes('/reviews?')) {
        response.end(JSON.stringify([{
          id: 91,
          state: 'CHANGES_REQUESTED',
          body: 'Keep the cache prefix stable.',
          commit_id: 'b'.repeat(40),
          submitted_at: '2026-08-17T04:00:00Z',
          html_url: 'https://github.com/org/repo/pull/26#pullrequestreview-91',
          user: { login: 'alice', type: 'User' },
        }]))
        return
      }
      if (request.url?.includes('/comments?')) {
        response.end('[]')
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')

    vi.stubEnv('DSH_AGENTS_HOME', join(root, '.agents-home'))
    vi.stubEnv('DSH_HOME', join(root, '.dsh-home'))
    vi.stubEnv('DSH_TELEMETRY_DISABLED', '1')
    const config = join(root, 'cordis.yml')
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
                  id: 'main', sessionId: 'main', provider: 'composition-recorder',
                  model: 'composition-recorder', cwd: root,
                }],
                workspaceContext: false,
                dshHome: join(root, '.dsh-home'),
                skills: { filesystem: { agentsHome: join(root, '.agents-home') } },
                invariants: { package_blocklist: ['^@deepseek-ai/dsh-scope$'] },
                persona: 'GitHub review assembled fixture.',
              },
            },
            { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', disabled: true },
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
      {
        id: 'github-review',
        name: join(packageRoot, 'dist', 'index.mjs'),
        config: {
          agentId: 'main', owner: 'org', repo: 'repo', trustedReviewers: ['alice'],
          apiBase: `http://127.0.0.1:${address.port}`,
        },
      },
    ], null, 2))

    const { boot } = await import(pathToFileURL(
      join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
    ).href)
    const previousCwd = process.cwd()
    process.chdir(root)
    const ctx = await boot('dsh-github-review-assembled-test', config)
    try {
      const agent = ctx.agents.get('main')
      if (agent === undefined) throw new Error('assembled Agent was not created')
      const execution = {
        callId: 'delivery-1', rootCallId: 'delivery-1', name: 'complete_delivery', arguments: {}, agent,
        signal: new AbortController().signal, token: Symbol('delivery-1'),
      }
      const result = {
        isError: false,
        value: {
          schemaVersion: 1,
          status: 'passed',
          reason: 'verified',
          goal: { id: 'goal-1', revision: 4, phase: 'complete' },
          artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature' },
          repository: {}, checks: [],
          draftPr: { status: 'passed', artifact: { number: 26, commit: 'b'.repeat(40) } },
        },
        content: [],
      }
      const emitter = agent.ctx as unknown as {
        emit(name: 'tools/result', execution: object, result: object): void
      }
      emitter.emit('tools/result', execution, result)

      await vi.waitFor(async () => {
        expect((await readFile(output, 'utf8')).trim()).not.toBe('')
        const followups = [...(ctx.storageDomain.get('evoforge_github_review')
          ?.table('followups').entries() ?? [])]
          .map(([, value]) => value as { status?: unknown; messageId?: unknown })
        expect(followups).toEqual([expect.objectContaining({
          status: 'delivered',
          messageId: expect.stringMatching(/^github-review:/u),
        })])
      }, { timeout: 10_000, interval: 25 })
      const request = JSON.parse((await readFile(output, 'utf8')).trim()) as {
        messages?: Array<{ role?: unknown; content?: unknown }>
      }
      expect(request.messages).toEqual(expect.arrayContaining([expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([expect.objectContaining({
          text: expect.stringContaining('untrusted external data'),
        })]),
      })]))
    } finally {
      await ctx.fiber.dispose()
      process.chdir(previousCwd)
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  }, 30_000)
})
