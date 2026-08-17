import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { DeliveryWatch } from './review-followup.js'
import type { GitHubReviewStore } from './review-store.js'

const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u)
const deliverySchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('passed'),
  goal: z.object({ phase: z.literal('complete') }),
  artifact: z.object({ commit: gitCommitSchema }),
  draftPr: z.object({
    status: z.literal('passed'),
    artifact: z.object({
      number: z.number().int().positive(),
      commit: gitCommitSchema,
    }),
  }),
})

export type GitHubReviewWatchWriter = Pick<GitHubReviewStore, 'upsertWatch'>

export interface DeliveryWatchMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

/** Observe canonical delivery results asynchronously; never reshape or delay the Tool result. */
export function installDeliveryWatchMonitor(
  ctx: Context,
  store: GitHubReviewWatchWriter,
  options: {
    readonly agentId: string
    readonly owner: string
    readonly repo: string
    readonly now?: () => number
    readonly onWatch?: () => Promise<void> | void
  },
): DeliveryWatchMonitor {
  const now = options.now ?? Date.now
  let disposed = false
  let tail: Promise<void> = Promise.resolve()
  const remove = ctx.on('tools/result', (execution, result) => {
    if (disposed
      || execution.name !== 'complete_delivery'
      || execution.agent === undefined
      || String(execution.agent.id) !== options.agentId) return
    const parsed = parseDelivery(result)
    if (parsed === undefined) return
    const watch: DeliveryWatch = {
      agentId: options.agentId,
      sessionId: String(execution.agent.session.header.id),
      owner: options.owner,
      repo: options.repo,
      pullNumber: parsed.pullNumber,
      headCommit: parsed.headCommit,
    }
    tail = tail.then(async () => {
      try {
        await store.upsertWatch(watch, now())
        await options.onWatch?.()
      } catch (error) {
        ctx.logger.warn(`dsh-github-review skipped one delivery watch: ${errorMessage(error)}`)
      }
    })
  })
  return {
    async flush() { await tail },
    async dispose() {
      if (!disposed) {
        disposed = true
        remove()
      }
      await tail
    },
  }
}

function parseDelivery(result: Readonly<ToolExecutionResult>): {
  readonly pullNumber: number
  readonly headCommit: string
} | undefined {
  if (result.isError) return undefined
  const parsed = deliverySchema.safeParse(result.value)
  if (!parsed.success || parsed.data.artifact.commit !== parsed.data.draftPr.artifact.commit) {
    return undefined
  }
  return {
    pullNumber: parsed.data.draftPr.artifact.number,
    headCommit: parsed.data.artifact.commit,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
