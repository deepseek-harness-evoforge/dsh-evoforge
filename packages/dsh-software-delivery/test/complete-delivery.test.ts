import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  createUserMessage,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import * as ToolGoal from '@deepseek-ai/dsh-tool-goal'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it } from 'vitest'
import * as DeliveryPlugin from '../src/index.js'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('complete_delivery Tool', () => {
  it('atomically verifies a real linked-worktree commit and completes the exact native Goal', async () => {
    const fixture = await createDeliveryFixture()
    const test = await setup([
      toolCall('delivery-pass', 'complete_delivery', deliveryArgs(fixture)),
      textResponse('completed'),
    ])
    const goal = test.ctx.goals.create(test.agent, { objective: 'Deliver the verified feature.' })
    test.adapter.replaceFirstArguments({ ...deliveryArgs(fixture), goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(test.ctx.goals.get(test.agent)).toMatchObject({
      id: goal.id,
      revision: goal.revision + 1,
      phase: 'complete',
    })
    const value = toolResultValue(test.agent, 'delivery-pass')
    expect(value).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      goal: { id: goal.id, revision: goal.revision + 1, phase: 'complete' },
      artifact: { kind: 'git-commit', commit: fixture.headCommit, branch: 'feature/delivery' },
    })
    await test.ctx.fiber.dispose()
  })

  it('returns objective failed evidence and leaves the native Goal active', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.checks = [{ name: 'test', argv: [process.execPath, '-e', 'process.stderr.write("x".repeat(5000)); process.exit(4)'] }]
    const test = await setup([
      toolCall('delivery-fail', 'complete_delivery', args),
      textResponse('repair required'),
    ])
    const goal = test.ctx.goals.create(test.agent, { objective: 'Do not self-certify.' })
    test.adapter.replaceFirstArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(test.ctx.goals.get(test.agent)).toMatchObject({ id: goal.id, revision: goal.revision, phase: 'active' })
    expect(toolResultValue(test.agent, 'delivery-fail')).toMatchObject({
      status: 'failed',
      reason: 'check-failed:test',
      goal: { id: goal.id, revision: goal.revision, phase: 'active' },
      checks: [{
        name: 'test',
        status: 'failed',
        exitCode: 4,
        stderrBytes: 5000,
        stderrTruncated: true,
        stderrHashScope: 'retained',
      }],
    })
    expect(Buffer.byteLength((toolResultValue(test.agent, 'delivery-fail').checks[0] as { stderrPreview: string }).stderrPreview)).toBe(4_096)
    await test.ctx.fiber.dispose()
  })

  it('rejects a stale Goal revision before any configured check can execute', async () => {
    const fixture = await createDeliveryFixture()
    const marker = join(fixture.root, 'must-not-exist')
    const args = deliveryArgs(fixture)
    args.checks = [{
      name: 'side-effect',
      argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
    }]
    const test = await setup([
      toolCall('delivery-stale', 'complete_delivery', args),
      textResponse('stale rejected'),
    ])
    const goal = test.ctx.goals.create(test.agent, { objective: 'Keep exact Goal identity.' })
    test.adapter.replaceFirstArguments({ ...args, goal_id: goal.id, revision: goal.revision + 1 })

    await runHumanTurn(test.agent)

    expect(test.ctx.goals.get(test.agent)).toMatchObject({ revision: goal.revision, phase: 'active' })
    expect(toolResult(test.agent, 'delivery-stale')?.data.message.content[0]).toMatchObject({
      type: 'tool-result',
      isError: true,
    })
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await test.ctx.fiber.dispose()
  })

  it('honors a native shell Tool policy denial and leaves the Goal active', async () => {
    const fixture = await createDeliveryFixture()
    const test = await setup([
      toolCall('delivery-denied', 'complete_delivery', deliveryArgs(fixture)),
      textResponse('policy denied'),
    ])
    const goal = test.ctx.goals.create(test.agent, { objective: 'Keep native policy authoritative.' })
    test.adapter.replaceFirstArguments({ ...deliveryArgs(fixture), goal_id: goal.id, revision: goal.revision })
    test.ctx.tools.guard(exec => exec.name === 'bash' ? 'test policy denied nested bash' : undefined)

    await runHumanTurn(test.agent)

    expect(test.ctx.goals.get(test.agent)).toMatchObject({ id: goal.id, revision: goal.revision, phase: 'active' })
    expect(toolResultValue(test.agent, 'delivery-denied')).toMatchObject({
      status: 'unknown',
      reason: 'check-inconclusive:test',
      checks: [{ status: 'unknown', stderrPreview: 'Error: test policy denied nested bash' }],
    })
    await test.ctx.fiber.dispose()
  })

  it('preserves exact argv without allowing shell metacharacter injection', async () => {
    const fixture = await createDeliveryFixture()
    const marker = join(fixture.root, 'injected-marker')
    const payload = `value'; touch ${marker}; $(printf injected)`
    const args = deliveryArgs(fixture)
    args.checks = [{
      name: 'argv-boundary',
      argv: [
        process.execPath,
        '-e',
        `if (process.argv[1] !== ${JSON.stringify(payload)}) process.exit(9)`,
        payload,
      ],
    }]
    const test = await setup([
      toolCall('delivery-argv', 'complete_delivery', args),
      textResponse('argv preserved'),
    ])
    const goal = test.ctx.goals.create(test.agent, { objective: 'Preserve argv boundaries.' })
    test.adapter.replaceFirstArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-argv')).toMatchObject({ status: 'passed' })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'complete' })
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await test.ctx.fiber.dispose()
  })

  it('binds late native Tool providers, then removes only its Tool and Skill on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(GoalService)
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(DeliveryPlugin)
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('complete_delivery')

    installTestBash(ctx)
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('complete_delivery')
    await ctx.plugin(ToolGoal, {})
    const nativeUpdate = ctx.tools.get('update_goal')
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('complete_delivery')
    const completeSchema = ctx.tools.schemas().find(tool => tool.name === 'complete_delivery')
    expect(Buffer.byteLength(JSON.stringify(completeSchema))).toBeLessThanOrEqual(2_048)
    expect(ctx.tools.get('update_goal')).toBe(nativeUpdate)

    await fiber.dispose()

    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('complete_delivery')
    expect(ctx.tools.get('update_goal')).toBe(nativeUpdate)
    expect(await ctx.skills.get('software-delivery')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

type DeliveryArgs = {
  goal_id: string
  revision: number
  worktree: string
  base_ref: string
  checks: { name: string; argv: string[] }[]
}

function deliveryArgs(fixture: DeliveryFixture): DeliveryArgs {
  return {
    goal_id: 'replaced-at-runtime',
    revision: 1,
    worktree: fixture.worktree,
    base_ref: 'main',
    checks: [{ name: 'test', argv: [process.execPath, '-e', 'process.exit(0)'] }],
  }
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(structuredClone(options))
    for (const chunk of this.script.shift() ?? textResponse('done')) yield chunk
  }

  replaceFirstArguments(args: DeliveryArgs): void {
    const chunks = this.script[0]
    const end = chunks?.find(chunk => chunk.type === 'block-end')
    if (end?.type !== 'block-end' || end.block.type !== 'tool-call') throw new Error('first response is not a tool call')
    const json = JSON.stringify(args)
    end.block = { ...end.block, arguments: json }
    const delta = chunks?.find(chunk => chunk.type === 'tool-call-delta')
    if (delta?.type === 'tool-call-delta') delta.argumentsDelta = json
  }
}

async function setup(script: StreamChunk[][]) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Delivery completion fixture.' })
  await ctx.plugin(ToolRuntime)
  installTestBash(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(ToolGoal, {})
  await ctx.plugin(DeliveryPlugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['delivery-test'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`delivery-${Math.random().toString(16).slice(2)}`), {
    provider: 'delivery-test',
    model: 'delivery-test',
  })
  return { ctx, adapter, agent }
}

function installTestBash(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'Execute one test-only bash command.',
    parameters: {
      command: { type: 'string', required: true },
      description: { type: 'string', required: true },
      timeoutMs: { type: 'number' },
      workdir: { type: 'string' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      try {
        const result = await execFile('bash', ['-c', args.command], {
          cwd: args.workdir,
          encoding: 'utf8',
          timeout: args.timeoutMs,
        })
        return shellValue(0, result.stdout, result.stderr) as unknown as JsonValue
      } catch (error) {
        const failed = error as { code?: number | string; signal?: NodeJS.Signals; stdout?: string; stderr?: string }
        return {
          ...shellValue(typeof failed.code === 'number' ? failed.code : null, failed.stdout ?? '', failed.stderr ?? ''),
          signal: failed.signal ?? null,
        } as unknown as JsonValue
      }
    },
  }))
}

function shellValue(exitCode: number | null, stdout: string, stderr: string) {
  return {
    kind: 'foreground',
    exitCode,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: TOOL_TIMEOUT_FIXTURE,
    stdout: { text: stdout, truncated: false },
    stderr: { text: stderr, truncated: false },
  }
}

const TOOL_TIMEOUT_FIXTURE = 15 * 60_000

async function runHumanTurn(agent: { followup(message: unknown): void; whenIdle(): Promise<void> }): Promise<void> {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Finish this delivery.' }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
}

function toolCall(id: string, name: string, args: object): StreamChunk[] {
  const callId = CallId(id)
  const input = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: input },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: input } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResult(agent: { session: { events: readonly any[] } }, callId: string) {
  return agent.session.events.find(event => event.type === 'tool/result'
    && event.data.message.content.some((block: { toolCallId?: string }) => block.toolCallId === callId))
}

function toolResultValue(agent: { session: { events: readonly any[] } }, callId: string): any {
  const event = toolResult(agent, callId)
  const block = event?.data.message.content.find((value: { toolCallId?: string }) => value.toolCallId === callId)
  const text = block?.content?.find((value: { type?: string }) => value.type === 'text')?.text
  if (typeof text !== 'string') throw new Error(`tool result ${callId} has no text`)
  return JSON.parse(text)
}

interface DeliveryFixture {
  root: string
  repository: string
  worktree: string
  baseCommit: string
  headCommit: string
}

async function createDeliveryFixture(): Promise<DeliveryFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-complete-delivery-test-'))
  temporaryRoots.push(root)
  const repository = join(root, 'repository')
  const worktree = join(root, 'feature-worktree')
  await git(root, 'init', '--initial-branch=main', repository)
  await git(repository, 'config', 'user.name', 'DSH Delivery Test')
  await git(repository, 'config', 'user.email', 'delivery@example.invalid')
  await writeFile(join(repository, 'README.md'), 'baseline\n')
  await git(repository, 'add', 'README.md')
  await git(repository, 'commit', '-m', 'baseline')
  const baseCommit = await git(repository, 'rev-parse', 'HEAD')
  await git(repository, 'worktree', 'add', '-b', 'feature/delivery', worktree)
  await writeFile(join(worktree, 'feature.txt'), 'delivered\n')
  await git(worktree, 'add', 'feature.txt')
  await git(worktree, 'commit', '-m', 'deliver feature')
  const headCommit = await git(worktree, 'rev-parse', 'HEAD')
  return {
    root,
    repository: await realpath(repository),
    worktree: await realpath(worktree),
    baseCommit,
    headCommit,
  }
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}
