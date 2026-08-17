import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  installDeliveryWatchMonitor,
  type GitHubReviewWatchWriter,
} from '../src/delivery-monitor.js'

describe('Draft PR delivery watch monitor', () => {
  it('records only the exact passed Draft PR head for the configured Agent without delaying Tool result', async () => {
    const ctx = new Context()
    const watches = {
      upsertWatch: vi.fn<GitHubReviewWatchWriter['upsertWatch']>(async input => ({
        id: 'f'.repeat(64),
        schemaVersion: 1,
        ...input,
        createdAt: 1_000,
        updatedAt: 1_000,
      })),
    }
    const monitor = installDeliveryWatchMonitor(ctx, watches, {
      agentId: 'coder',
      owner: 'deepseek-harness-evoforge',
      repo: 'dsh-evoforge',
      now: () => 1_000,
    })

    emitToolResult(ctx, execution(), successfulDelivery())

    expect(watches.upsertWatch).not.toHaveBeenCalled()
    await monitor.flush()
    expect(watches.upsertWatch).toHaveBeenCalledWith({
      agentId: 'coder',
      sessionId: 'session-1',
      owner: 'deepseek-harness-evoforge',
      repo: 'dsh-evoforge',
      pullNumber: 26,
      headCommit: 'b'.repeat(40),
    }, 1_000)

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function execution() {
  return {
    callId: 'delivery-1',
    rootCallId: 'delivery-1',
    name: 'complete_delivery',
    arguments: {},
    agent: {
      id: 'coder',
      session: { header: { id: 'session-1', createdAt: 900, cwd: '/private/repo' } },
    },
    signal: new AbortController().signal,
    token: Symbol('delivery-1'),
  }
}

function successfulDelivery() {
  return {
    isError: false,
    value: {
      schemaVersion: 1,
      status: 'passed',
      reason: 'verified',
      goal: { id: 'goal-1', revision: 4, phase: 'complete' },
      artifact: { kind: 'git-commit', commit: 'b'.repeat(40), branch: 'feature' },
      repository: { worktree: '/private/repo' },
      checks: [],
      draftPr: {
        status: 'passed',
        reason: 'created-draft',
        artifact: {
          kind: 'github-draft-pr',
          number: 26,
          url: 'https://github.com/deepseek-harness-evoforge/dsh-evoforge/pull/26',
          head: 'feature',
          base: 'main',
          commit: 'b'.repeat(40),
          reused: false,
        },
        steps: [],
      },
    },
    content: [],
  }
}

function emitToolResult(ctx: Context, executionValue: object, result: object): void {
  const emitter = ctx as unknown as {
    emit(name: 'tools/result', execution: object, result: object): void
  }
  emitter.emit('tools/result', executionValue, result)
}
