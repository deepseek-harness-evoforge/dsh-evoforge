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
  it.runIf(process.env.DSH_DELIVERY_LIVE_WORKTREE !== undefined)(
    'reuses the authenticated repository Draft PR without creating another one',
    async () => {
      const worktree = await realpath(process.env.DSH_DELIVERY_LIVE_WORKTREE!)
      const branch = await git(worktree, 'symbolic-ref', '--short', 'HEAD')
      const headCommit = await git(worktree, 'rev-parse', 'HEAD')
      const existing = JSON.parse((await execFile('gh', [
        'pr', 'list', '--state', 'open', '--head', branch, '--base', 'main',
        '--json', 'number,url,isDraft,headRefName,headRefOid,baseRefName',
      ], { cwd: worktree, encoding: 'utf8' })).stdout) as ReturnType<typeof draftPrView>[]
      expect(existing).toHaveLength(1)
      expect(existing[0]).toMatchObject({ isDraft: true, headRefOid: headCommit })
      const fixture: DeliveryFixture = {
        root: worktree,
        repository: worktree,
        worktree,
        baseCommit: await git(worktree, 'rev-parse', 'main'),
        headCommit,
      }
      const args = deliveryArgs(fixture)
      args.draft_pr = { base_branch: 'main', title: 'unused because the Draft exists', body: '' }
      const test = await setup([
        toolCall('delivery-live-github', 'complete_delivery', args),
        textResponse('existing draft reused'),
      ], undefined, { requireDraftPrChecks: true })
      const goal = test.ctx.goals.create(test.agent, { objective: 'Reuse the existing authenticated Draft PR.' })
      test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

      await runHumanTurn(test.agent)

      expect(toolResultValue(test.agent, 'delivery-live-github')).toMatchObject({
        status: 'passed',
        goal: { phase: 'complete' },
        draftPr: {
          status: 'passed',
          reason: 'existing-draft',
          artifact: {
            number: existing[0]?.number,
            url: existing[0]?.url,
            commit: headCommit,
            reused: true,
          },
          remoteChecks: {
            status: 'passed',
            pending: 0,
            failed: 0,
          },
        },
      })
      await test.ctx.fiber.dispose()
    },
    30_000,
  )

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

  it('recovers an uncertain Draft PR create by reusing remote facts before completing the Goal', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = {
      base_branch: 'main',
      title: 'feat: verified delivery',
      body: 'Created by the delivery test.',
    }
    let remotelyCreated = false
    const commands: string[] = []
    const test = await setup([
      toolCall('delivery-publish-uncertain', 'complete_delivery', args),
      toolCall('delivery-publish-retry', 'complete_delivery', args),
      textResponse('draft ready'),
    ], (command) => {
      commands.push(command)
      if (command.includes("'gh' 'auth' 'status'")) return shellValue(0, '', '')
      if (command.includes("'git' 'push'")) return shellValue(0, '', '')
      if (command.includes("'gh' 'pr' 'list'")) {
        return shellValue(0, remotelyCreated ? JSON.stringify([draftPrView(fixture, true)]) : '[]', '')
      }
      if (command.includes("'gh' 'pr' 'create'")) {
        remotelyCreated = true
        return shellValue(1, '', 'response lost after create')
      }
      return undefined
    })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Publish one idempotent Draft PR.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-publish-uncertain')).toMatchObject({
      status: 'unknown',
      reason: 'draft-pr-create-inconclusive',
      goal: { phase: 'active', revision: goal.revision },
      draftPr: { status: 'unknown', reason: 'create-inconclusive' },
    })
    expect(toolResultValue(test.agent, 'delivery-publish-retry')).toMatchObject({
      status: 'passed',
      reason: 'verified',
      goal: { phase: 'complete', revision: goal.revision + 1 },
      draftPr: {
        status: 'passed',
        reason: 'existing-draft',
        artifact: {
          kind: 'github-draft-pr',
          number: 7,
          url: 'https://github.com/example/project/pull/7',
          head: 'feature/delivery',
          base: 'main',
          commit: fixture.headCommit,
          reused: true,
        },
      },
    })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'complete' })
    expect(commands.filter(command => command.includes("'gh' 'pr' 'create'"))).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('keeps the Goal active for non-green Draft PR checks and completes by reusing the same green PR', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = {
      base_branch: 'main',
      title: 'feat: require remote checks',
      body: 'Complete only after the exact Draft PR head is green.',
    }
    let checkQuery = 0
    const commands: string[] = []
    const test = await setup([
      toolCall('delivery-checks-pending', 'complete_delivery', args),
      toolCall('delivery-checks-failed', 'complete_delivery', args),
      toolCall('delivery-checks-missing', 'complete_delivery', args),
      toolCall('delivery-checks-green', 'complete_delivery', args),
      textResponse('draft checks passed'),
    ], (command) => {
      commands.push(command)
      if (command.includes("'gh' 'auth' 'status'") || command.includes("'git' 'push'")) {
        return shellValue(0, '', '')
      }
      if (command.includes("'gh' 'pr' 'list'")) {
        return shellValue(0, JSON.stringify([draftPrView(fixture, true)]), '')
      }
      if (command.includes("'gh' 'pr' 'view'")) {
        checkQuery += 1
        return shellValue(0, JSON.stringify({
          headRefOid: fixture.headCommit,
          statusCheckRollup: checkQuery === 3
            ? []
            : [{
                __typename: 'CheckRun',
                name: 'CI',
                status: checkQuery === 1 ? 'IN_PROGRESS' : 'COMPLETED',
                conclusion: checkQuery === 1 ? '' : checkQuery === 2 ? 'FAILURE' : 'SUCCESS',
              }],
        }), '')
      }
      return undefined
    }, { requireDraftPrChecks: true })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Deliver only after remote CI passes.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-checks-pending')).toMatchObject({
      status: 'unknown',
      reason: 'draft-pr-checks-pending',
      goal: { phase: 'active', revision: goal.revision },
      draftPr: {
        status: 'unknown',
        reason: 'checks-pending',
        artifact: { number: 7, commit: fixture.headCommit, reused: true },
        remoteChecks: { status: 'unknown', total: 1, passed: 0, pending: 1, failed: 0 },
      },
    })
    expect(toolResultValue(test.agent, 'delivery-checks-green')).toMatchObject({
      status: 'passed',
      reason: 'verified',
      goal: { phase: 'complete', revision: goal.revision + 1 },
      draftPr: {
        status: 'passed',
        reason: 'existing-draft',
        artifact: { number: 7, commit: fixture.headCommit, reused: true },
        remoteChecks: { status: 'passed', total: 1, passed: 1, pending: 0, failed: 0 },
      },
    })
    expect(toolResultValue(test.agent, 'delivery-checks-failed')).toMatchObject({
      status: 'failed',
      reason: 'draft-pr-checks-failed',
      goal: { phase: 'active', revision: goal.revision },
      draftPr: {
        status: 'failed',
        reason: 'checks-failed',
        remoteChecks: { status: 'failed', total: 1, passed: 0, pending: 0, failed: 1 },
      },
    })
    expect(toolResultValue(test.agent, 'delivery-checks-missing')).toMatchObject({
      status: 'unknown',
      reason: 'draft-pr-checks-missing',
      goal: { phase: 'active', revision: goal.revision },
      draftPr: {
        status: 'unknown',
        reason: 'checks-missing',
        remoteChecks: { status: 'unknown', total: 0, passed: 0, pending: 0, failed: 0 },
      },
    })
    expect(commands.filter(command => command.includes("'gh' 'pr' 'create'"))).toHaveLength(0)
    expect(commands.filter(command => command.includes("'gh' 'pr' 'view'"))).toHaveLength(4)
    expect(test.adapter.requests[1]?.tools).toEqual(test.adapter.requests[0]?.tools)
    expect(test.adapter.requests[2]?.tools).toEqual(test.adapter.requests[0]?.tools)
    expect(test.adapter.requests[3]?.tools).toEqual(test.adapter.requests[0]?.tools)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'complete' })
    await test.ctx.fiber.dispose()
  })

  it('refuses green checks that are not bound to the exact published head', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = { base_branch: 'main', title: 'feat: exact check head', body: '' }
    const test = await setup([
      toolCall('delivery-checks-wrong-head', 'complete_delivery', args),
      textResponse('head changed'),
    ], (command) => {
      if (command.includes("'gh' 'auth' 'status'") || command.includes("'git' 'push'")) {
        return shellValue(0, '', '')
      }
      if (command.includes("'gh' 'pr' 'list'")) {
        return shellValue(0, JSON.stringify([draftPrView(fixture, true)]), '')
      }
      if (command.includes("'gh' 'pr' 'view'")) {
        return shellValue(0, JSON.stringify({
          headRefOid: '0'.repeat(40),
          statusCheckRollup: [{
            __typename: 'CheckRun',
            name: 'CI',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          }],
        }), '')
      }
      return undefined
    }, { requireDraftPrChecks: true })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Bind remote checks to the exact commit.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-checks-wrong-head')).toMatchObject({
      status: 'unknown',
      reason: 'draft-pr-checks-head-not-confirmed',
      goal: { phase: 'active', revision: goal.revision },
      draftPr: {
        status: 'unknown',
        reason: 'checks-head-not-confirmed',
        artifact: { commit: fixture.headCommit },
      },
    })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active' })
    await test.ctx.fiber.dispose()
  })

  it('creates and confirms one new Draft PR before completing the Goal', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = { base_branch: 'main', title: 'feat: create draft', body: 'Verified body.' }
    const test = await setup([
      toolCall('delivery-create-draft', 'complete_delivery', args),
      textResponse('draft created'),
    ], (command) => {
      if (command.includes("'gh' 'auth' 'status'") || command.includes("'git' 'push'")) {
        return shellValue(0, '', '')
      }
      if (command.includes("'gh' 'pr' 'list'")) return shellValue(0, '[]', '')
      if (command.includes("'gh' 'pr' 'create'")) {
        return shellValue(0, 'https://github.com/example/project/pull/7\n', '')
      }
      if (command.includes("'gh' 'pr' 'view'")) {
        return shellValue(0, JSON.stringify(draftPrView(fixture, true)), '')
      }
      return undefined
    })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Create a verified Draft PR.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-create-draft')).toMatchObject({
      status: 'passed',
      goal: { phase: 'complete' },
      draftPr: {
        status: 'passed',
        reason: 'created-draft',
        artifact: { kind: 'github-draft-pr', reused: false, commit: fixture.headCommit },
      },
    })
    await test.ctx.fiber.dispose()
  })

  it('fails before push when native GitHub authentication is unavailable', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = { base_branch: 'main', title: 'feat: no credentials', body: '' }
    const commands: string[] = []
    const test = await setup([
      toolCall('delivery-auth-fail', 'complete_delivery', args),
      textResponse('authentication required'),
    ], (command) => {
      commands.push(command)
      if (command.includes("'gh' 'auth' 'status'")) return shellValue(1, '', 'not logged in')
      return undefined
    })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Respect native GitHub authority.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-auth-fail')).toMatchObject({
      status: 'failed',
      reason: 'draft-pr-auth-unavailable',
      draftPr: { status: 'failed', reason: 'auth-unavailable' },
    })
    expect(commands.some(command => command.includes("'git' 'push'"))).toBe(false)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active' })
    await test.ctx.fiber.dispose()
  })

  it('rejects an invalid Draft PR base before authentication or push', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = { base_branch: 'bad..base', title: 'feat: invalid base', body: '' }
    const commands: string[] = []
    const test = await setup([
      toolCall('delivery-invalid-base', 'complete_delivery', args),
      textResponse('invalid base rejected'),
    ], (command) => {
      commands.push(command)
      return undefined
    })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Reject invalid remote refs.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-invalid-base')).toMatchObject({
      status: 'failed',
      reason: 'draft-pr-base-invalid',
      draftPr: { status: 'failed', reason: 'base-invalid' },
    })
    expect(commands.some(command => command.includes("'gh' 'auth'") || command.includes("'git' 'push'"))).toBe(false)
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active' })
    await test.ctx.fiber.dispose()
  })

  it('does not alter an existing ready PR or complete the Goal as if it were a Draft', async () => {
    const fixture = await createDeliveryFixture()
    const args = deliveryArgs(fixture)
    args.draft_pr = { base_branch: 'main', title: 'feat: draft only', body: '' }
    const commands: string[] = []
    const test = await setup([
      toolCall('delivery-ready-conflict', 'complete_delivery', args),
      textResponse('human decision required'),
    ], (command) => {
      commands.push(command)
      if (command.includes("'gh' 'auth' 'status'") || command.includes("'git' 'push'")) {
        return shellValue(0, '', '')
      }
      if (command.includes("'gh' 'pr' 'list'")) {
        return shellValue(0, JSON.stringify([draftPrView(fixture, false)]), '')
      }
      return undefined
    })
    const goal = test.ctx.goals.create(test.agent, { objective: 'Never rewrite PR review state.' })
    test.adapter.replaceAllArguments({ ...args, goal_id: goal.id, revision: goal.revision })

    await runHumanTurn(test.agent)

    expect(toolResultValue(test.agent, 'delivery-ready-conflict')).toMatchObject({
      status: 'failed',
      reason: 'draft-pr-existing-not-draft',
      draftPr: { status: 'failed', reason: 'existing-not-draft' },
    })
    expect(test.ctx.goals.get(test.agent)).toMatchObject({ phase: 'active', revision: goal.revision })
    expect(commands.some(command => command.includes("'gh' 'pr' 'create'"))).toBe(false)
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
    const gatedFiber = await ctx.plugin(DeliveryPlugin, { requireDraftPrChecks: true })
    expect(ctx.tools.schemas().find(tool => tool.name === 'complete_delivery')).toEqual(completeSchema)
    await gatedFiber.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('complete_delivery')
    await ctx.fiber.dispose()
  })
})

type DeliveryArgs = {
  goal_id: string
  revision: number
  worktree: string
  base_ref: string
  checks: { name: string; argv: string[] }[]
  draft_pr?: { base_branch: string; title: string; body: string }
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

  replaceAllArguments(args: DeliveryArgs): void {
    for (const chunks of this.script) {
      const end = chunks.find(chunk => chunk.type === 'block-end')
      if (end?.type !== 'block-end' || end.block.type !== 'tool-call' || end.block.name !== 'complete_delivery') continue
      const json = JSON.stringify(args)
      end.block = { ...end.block, arguments: json }
      const delta = chunks.find(chunk => chunk.type === 'tool-call-delta')
      if (delta?.type === 'tool-call-delta') delta.argumentsDelta = json
    }
  }
}

async function setup(
  script: StreamChunk[][],
  interceptBash?: TestBashInterceptor,
  deliveryConfig: { requireDraftPrChecks?: boolean } = {},
) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Delivery completion fixture.' })
  await ctx.plugin(ToolRuntime)
  installTestBash(ctx, interceptBash)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(ToolGoal, {})
  await ctx.plugin(DeliveryPlugin, deliveryConfig)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['delivery-test'], adapter)
  const agent = ctx.agentLoop.create(SessionId(`delivery-${Math.random().toString(16).slice(2)}`), {
    provider: 'delivery-test',
    model: 'delivery-test',
  })
  return { ctx, adapter, agent }
}

type TestBashInterceptor = (command: string) => ReturnType<typeof shellValue> | undefined

function installTestBash(ctx: Context, intercept?: TestBashInterceptor): void {
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
      const intercepted = intercept?.(args.command)
      if (intercepted !== undefined) return intercepted as unknown as JsonValue
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

function draftPrView(fixture: DeliveryFixture, isDraft: boolean) {
  return {
    number: 7,
    url: 'https://github.com/example/project/pull/7',
    isDraft,
    headRefName: 'feature/delivery',
    headRefOid: fixture.headCommit,
    baseRefName: 'main',
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
