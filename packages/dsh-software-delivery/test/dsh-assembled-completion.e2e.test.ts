import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import * as DeliveryPlugin from '../src/index.js'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const rawDshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('assembled DSH verified completion', () => {
  it('uses pinned native Bash and update_goal through a real Agent without changing the repeat surface', async () => {
    const dshSourceDir = await realpath(rawDshSourceDir)
    const sourcePackage = (path: string) => pathToFileURL(
      join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
    ).href
    const [
      llm,
      session,
      systemPrompt,
      tools,
      skill,
      agent,
      goal,
      toolGoal,
      sessionProjections,
      agentLoop,
      subprocessLocal,
      shellEnv,
      bashLocal,
      toolBash,
    ] = await Promise.all([
      import(sourcePackage('llm/llm')),
      import(sourcePackage('core/session')),
      import(sourcePackage('core/system-prompt')),
      import(sourcePackage('core/tools')),
      import(sourcePackage('skill/skill')),
      import(sourcePackage('core/agent')),
      import(sourcePackage('goal/goal')),
      import(sourcePackage('goal/tool-goal')),
      import(sourcePackage('session/session-projection')),
      import(sourcePackage('core/agent-loop')),
      import(sourcePackage('subprocess/subprocess-local')),
      import(sourcePackage('shell/shell-env')),
      import(sourcePackage('shell/bash-local')),
      import(sourcePackage('shell/tool-bash')),
    ])
    const fixture = await createDeliveryFixture()
    const callArguments: Record<string, unknown> = {
      goal_id: 'set-after-agent-creation',
      revision: 0,
      worktree: fixture.worktree,
      base_ref: 'main',
      checks: [{ name: 'native-bash', argv: [process.execPath, '-e', 'process.exit(0)'] }],
    }
    const ctx = new Context()
    await ctx.plugin(llm.default)
    await ctx.plugin(session.default)
    await ctx.plugin(systemPrompt.default, { persona: 'Pinned native delivery fixture.' })
    await ctx.plugin(tools.default)
    await ctx.plugin(skill.default)
    await ctx.plugin(agent.default)
    await ctx.plugin(goal.default)
    await ctx.plugin(toolGoal, {})
    await ctx.plugin(sessionProjections.default)
    await ctx.plugin(subprocessLocal.default)
    await ctx.plugin(shellEnv)
    await ctx.plugin(bashLocal.default, { cwd: fixture.worktree, timeoutMs: 10_000 })
    await ctx.plugin(toolBash, { enableRunInBackground: false })
    const deliveryFiber = await ctx.plugin(DeliveryPlugin, {
      requireDraftPrChecks: true,
      draftPrCheckWait: { timeoutMs: 60_000, pollIntervalMs: 5_000 },
    })
    await ctx.plugin(agentLoop.default, { agents: [] })

    class ScriptedAdapter extends llm.LlmAdapter {
      readonly requests: unknown[] = []

      resolveModel(provider: string, model: string) {
        return Promise.resolve({ provider, id: model, name: model })
      }

      async * stream(options: unknown) {
        this.requests.push(structuredClone(options))
        if (this.requests.length === 1) {
          const callId = llm.ToolCallId('native-complete-delivery')
          const input = JSON.stringify(callArguments)
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id: callId, name: 'complete_delivery', argumentsDelta: input }
          yield {
            type: 'block-end',
            index: 0,
            block: { type: 'tool-call', id: callId, name: 'complete_delivery', arguments: input },
          }
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'verified delivery complete' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'verified delivery complete' } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }

    const adapter = new ScriptedAdapter()
    const llmService = ctx.get('llm') as { registerAdapter(routes: string[], adapter: unknown): void } | undefined
    const agentService = ctx.get('agents') as {
      create(options: unknown): Promise<{
        agent: {
          followup(message: unknown): void
          whenIdle(): Promise<void>
          session: { events: readonly unknown[] }
        }
      }>
    } | undefined
    const goalService = ctx.get('goals') as {
      create(agent: unknown, input: { objective: string }): { id: string; revision: number }
      get(agent: unknown): { phase: string; revision: number } | undefined
    } | undefined
    if (llmService === undefined || agentService === undefined || goalService === undefined) {
      throw new Error('pinned native Agent or Goal runtime missing')
    }
    llmService.registerAdapter(['delivery-native'], adapter)
    const handle = await agentService.create({
      sessionId: session.SessionId('dsh-software-delivery-native'),
      agentOptions: { provider: 'delivery-native', model: 'delivery-native' },
      meta: { cwd: fixture.worktree },
    })
    const nativeGoal = goalService.create(handle.agent, { objective: 'Complete verified native delivery.' })
    callArguments.goal_id = nativeGoal.id
    callArguments.revision = nativeGoal.revision
    handle.agent.followup(llm.createUserMessage({
      content: [{ type: 'text', text: 'Verify and complete the software delivery.' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    expect(goalService.get(handle.agent)).toMatchObject({
      phase: 'complete',
      revision: nativeGoal.revision + 1,
    })
    expect(adapter.requests).toHaveLength(2)
    const first = requestView(adapter.requests[0])
    const second = requestView(adapter.requests[1])
    expect(first.tools.map(toolName)).toContain('complete_delivery')
    expect(second.tools).toEqual(first.tools)
    const result = findToolResult(typeof (handle.agent.session as any).snapshotEvents === 'function'
      ? (handle.agent.session as any).snapshotEvents()
      : (handle.agent.session as any).events, 'native-complete-delivery')
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      artifact: { kind: 'git-commit', commit: fixture.headCommit },
      checks: [{ name: 'native-bash', status: 'passed', exitCode: 0 }],
    })

    await deliveryFiber.dispose()
    expect((ctx.get('tools') as { get(name: string): unknown }).get('complete_delivery')).toBeUndefined()
    expect((ctx.get('tools') as { get(name: string): unknown }).get('bash')).toBeDefined()
    expect((ctx.get('tools') as { get(name: string): unknown }).get('update_goal')).toBeDefined()
    await ctx.fiber.dispose()
  }, 30_000)
})

function requestView(value: unknown): { tools: unknown[] } {
  if (typeof value !== 'object' || value === null) throw new Error('adapter request missing')
  const request = value as { tools?: unknown }
  if (!Array.isArray(request.tools)) throw new Error('adapter request has no tools array')
  return { tools: request.tools }
}

function toolName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const tool = value as { name?: unknown }
  return typeof tool.name === 'string' ? tool.name : undefined
}

function findToolResult(events: readonly unknown[], callId: string): Record<string, unknown> {
  for (const value of events) {
    if (typeof value !== 'object' || value === null) continue
    const event = value as { type?: unknown; data?: { message?: { content?: unknown[] } } }
    if (event.type !== 'tool/result' || !Array.isArray(event.data?.message?.content)) continue
    for (const blockValue of event.data.message.content) {
      if (typeof blockValue !== 'object' || blockValue === null) continue
      const block = blockValue as { toolCallId?: unknown; content?: unknown[] }
      if (block.toolCallId !== callId || !Array.isArray(block.content)) continue
      const text = block.content.find(item => typeof item === 'object' && item !== null
        && (item as { type?: unknown }).type === 'text') as { text?: unknown } | undefined
      if (typeof text?.text !== 'string') break
      return JSON.parse(text.text) as Record<string, unknown>
    }
  }
  throw new Error(`tool result ${callId} missing`)
}

interface DeliveryFixture {
  readonly worktree: string
  readonly headCommit: string
}

async function createDeliveryFixture(): Promise<DeliveryFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-completion-test-'))
  temporaryRoots.push(root)
  const repository = join(root, 'repository')
  const worktree = join(root, 'feature-worktree')
  await git(root, 'init', '--initial-branch=main', repository)
  await git(repository, 'config', 'user.name', 'DSH Delivery Test')
  await git(repository, 'config', 'user.email', 'delivery@example.invalid')
  await writeFile(join(repository, 'README.md'), 'baseline\n')
  await git(repository, 'add', 'README.md')
  await git(repository, 'commit', '-m', 'baseline')
  await git(repository, 'worktree', 'add', '-b', 'feature/native-delivery', worktree)
  await writeFile(join(worktree, 'feature.txt'), 'delivered\n')
  await git(worktree, 'add', 'feature.txt')
  await git(worktree, 'commit', '-m', 'deliver feature')
  return {
    worktree: await realpath(worktree),
    headCommit: await git(worktree, 'rev-parse', 'HEAD'),
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}
