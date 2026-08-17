import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  publishDraftPr,
  type PublishDraftPrOptions,
} from '../src/draft-pr.js'
import type {
  CapturedOutput,
  DeliveryCheckRunResult,
  DeliveryCheckRunner,
} from '../src/verify-delivery.js'

const COMMIT = 'a'.repeat(40)

describe('bounded exact-head Draft PR check wait', () => {
  it('waits through pending and missing checks, then completes without repeating publication', async () => {
    let now = 1_000
    let sleeps = 0
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('IN_PROGRESS', '')]),
      checkView(COMMIT, []),
      checkView(COMMIT, [checkRun('COMPLETED', 'SUCCESS')]),
    ])

    const result = await publishDraftPr(fixture.runner, options({
      timeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => now,
      sleep: async (delayMs) => {
        sleeps += 1
        now += delayMs
      },
    }))

    expect(result).toMatchObject({
      status: 'passed',
      reason: 'existing-draft',
      artifact: { commit: COMMIT, reused: true },
      remoteChecks: { status: 'passed', total: 1, passed: 1, pending: 0, failed: 0 },
    })
    expect(sleeps).toBe(2)
    expect(fixture.calls.filter(call => call.name === 'git-push')).toHaveLength(1)
    expect(fixture.calls.filter(call => call.name === 'github-pr-list')).toHaveLength(1)
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(3)
  })

  it('returns the first failed check result without another poll', async () => {
    let sleeps = 0
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('COMPLETED', 'FAILURE')]),
    ])

    const result = await publishDraftPr(fixture.runner, options({
      timeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => 1_000,
      sleep: async () => { sleeps += 1 },
    }))

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'checks-failed',
      remoteChecks: { failed: 1, pending: 0 },
    })
    expect(sleeps).toBe(0)
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(1)
  })

  it('times out with the last bounded evidence and leaves completion unknown', async () => {
    let now = 1_000
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('IN_PROGRESS', '')]),
    ])

    const result = await publishDraftPr(fixture.runner, options({
      timeoutMs: 10_000,
      pollIntervalMs: 10_000,
      now: () => now,
      sleep: async (delayMs) => { now += delayMs },
    }))

    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'checks-timeout',
      artifact: { commit: COMMIT },
      remoteChecks: { status: 'unknown', total: 1, passed: 0, pending: 1, failed: 0 },
    })
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(1)
  })

  it('re-enters from GitHub facts after an interrupted wait without creating another PR', async () => {
    let now = 1_000
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('IN_PROGRESS', '')]),
      checkView(COMMIT, [checkRun('COMPLETED', 'SUCCESS')]),
    ])
    const checkWait: CheckWaitPolicy = {
      timeoutMs: 10_000,
      pollIntervalMs: 10_000,
      now: () => now,
      sleep: async (delayMs) => { now += delayMs },
    }

    const interrupted = await publishDraftPr(fixture.runner, options(checkWait))
    const resumed = await publishDraftPr(fixture.runner, options(checkWait))

    expect(interrupted).toMatchObject({ status: 'unknown', reason: 'checks-timeout' })
    expect(resumed).toMatchObject({
      status: 'passed',
      reason: 'existing-draft',
      artifact: { commit: COMMIT, reused: true },
    })
    expect(fixture.calls.filter(call => call.name === 'git-push')).toHaveLength(2)
    expect(fixture.calls.filter(call => call.name === 'github-pr-list')).toHaveLength(2)
    expect(fixture.calls.filter(call => call.name === 'github-pr-create')).toHaveLength(0)
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(2)
  })

  it('fails closed immediately when the PR head no longer matches the published commit', async () => {
    let sleeps = 0
    const fixture = scriptedRunner([
      checkView('b'.repeat(40), [checkRun('COMPLETED', 'SUCCESS')]),
    ])

    const result = await publishDraftPr(fixture.runner, options({
      timeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => 1_000,
      sleep: async () => { sleeps += 1 },
    }))

    expect(result).toMatchObject({ status: 'unknown', reason: 'checks-head-not-confirmed' })
    expect(sleeps).toBe(0)
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(1)
  })

  it('refuses completion when the local worktree changes while CI is pending', async () => {
    let now = 1_000
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('IN_PROGRESS', '')]),
      checkView(COMMIT, [checkRun('COMPLETED', 'SUCCESS')]),
    ], { postWaitHead: 'b'.repeat(40) })

    const result = await publishDraftPr(fixture.runner, options({
      timeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => now,
      sleep: async (delayMs) => { now += delayMs },
    }))

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'repository-changed-during-check-wait',
      artifact: { commit: COMMIT },
      remoteChecks: { status: 'passed' },
    })
    expect(fixture.calls.filter(call => call.name === 'post-wait-head')).toHaveLength(1)
    expect(fixture.calls.filter(call => call.name === 'post-wait-status')).toHaveLength(1)
  })

  it('propagates cancellation while no external command is running', async () => {
    const controller = new AbortController()
    const fixture = scriptedRunner([
      checkView(COMMIT, [checkRun('IN_PROGRESS', '')]),
    ])

    await expect(publishDraftPr(fixture.runner, options({
      timeoutMs: 30_000,
      pollIntervalMs: 5_000,
      now: () => 1_000,
      sleep: async (_delayMs, signal) => {
        controller.abort(new Error('delivery cancelled'))
        throw signal?.reason
      },
    }, controller.signal))).rejects.toThrow('delivery cancelled')
    expect(fixture.calls.filter(call => call.name === 'github-pr-checks')).toHaveLength(1)
  })
})

interface CheckWaitPolicy {
  readonly timeoutMs: number
  readonly pollIntervalMs: number
  readonly now: () => number
  readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>
}

function options(checkWait: CheckWaitPolicy, signal?: AbortSignal): PublishDraftPrOptions {
  return {
    worktree: '/private/tmp/dsh-delivery-worktree',
    branch: 'feature/delivery',
    commit: COMMIT,
    baseBranch: 'main',
    title: 'feat: bounded check wait',
    body: 'Wait for exact-head CI without another Agent turn.',
    requireChecks: true,
    checkWait,
    ...(signal === undefined ? {} : { signal }),
  }
}

function scriptedRunner(
  checks: string[],
  final: { readonly postWaitHead?: string; readonly postWaitStatus?: string } = {},
): {
  readonly runner: DeliveryCheckRunner
  readonly calls: Array<{ name: string; argv: readonly string[] }>
} {
  const calls: Array<{ name: string; argv: readonly string[] }> = []
  let checkIndex = 0
  const runner: DeliveryCheckRunner = async (check) => {
    calls.push({ name: check.name, argv: check.argv })
    if (check.name === 'github-pr-list') {
      return passed(JSON.stringify([{
        number: 7,
        url: 'https://github.com/example/project/pull/7',
        isDraft: true,
        headRefName: 'feature/delivery',
        headRefOid: COMMIT,
        baseRefName: 'main',
      }]))
    }
    if (check.name === 'post-publish-head') return passed(`${COMMIT}\n`)
    if (check.name === 'post-wait-head') return passed(`${final.postWaitHead ?? COMMIT}\n`)
    if (check.name === 'post-wait-status') return passed(final.postWaitStatus ?? '')
    if (check.name === 'github-pr-checks') {
      const value = checks[Math.min(checkIndex, checks.length - 1)]!
      checkIndex += 1
      return passed(value)
    }
    return passed('')
  }
  return { runner, calls }
}

function checkView(headRefOid: string, statusCheckRollup: unknown[]): string {
  return JSON.stringify({ headRefOid, statusCheckRollup })
}

function checkRun(status: string, conclusion: string): object {
  return { __typename: 'CheckRun', name: 'CI', status, conclusion }
}

function passed(stdout: string): DeliveryCheckRunResult {
  return {
    status: 'passed',
    exitCode: 0,
    signal: null,
    stdout: output(stdout),
    stderr: output(''),
  }
}

function output(text: string): CapturedOutput {
  return {
    text,
    bytes: Buffer.byteLength(text),
    truncated: false,
    sha256: createHash('sha256').update(text).digest('hex'),
    hashScope: 'full',
  }
}
