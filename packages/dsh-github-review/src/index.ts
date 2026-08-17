import { setTimeout as wait } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  resolveGitHubReviewConfig,
} from './config.js'
import { installDeliveryWatchMonitor } from './delivery-monitor.js'
import { GitHubReviewClient } from './github-client.js'
import { GitHubReviewRuntime } from './runtime.js'
import { openGitHubReviewStore } from './review-store.js'

export const name = 'dsh-github-review'
export const inject = ['agents', 'storageDomain']

export interface Config {
  readonly agentId: string
  readonly owner: string
  readonly repo: string
  readonly trustedReviewers: string[]
  readonly tokenEnv?: string
  readonly apiBase?: string
  readonly pollIntervalSeconds?: number
  readonly requestTimeoutSeconds?: number
  readonly maxTextChars?: number
  readonly maxComments?: number
}

export const Config: Schema<Config> = z.object({
  agentId: z.string().required(),
  owner: z.string().required(),
  repo: z.string().required(),
  trustedReviewers: z.array(z.string()).min(1).max(20).required(),
  tokenEnv: z.string(),
  apiBase: z.string().default('https://api.github.com'),
  pollIntervalSeconds: z.number().step(1).min(60).max(3_600).default(300),
  requestTimeoutSeconds: z.number().step(1).min(1).max(60).default(20),
  maxTextChars: z.number().step(1).min(1_024).max(6_000).default(6_000),
  maxComments: z.number().step(1).min(1).max(20).default(20),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveGitHubReviewConfig(config)
  const token = resolved.tokenEnv === undefined ? undefined : process.env[resolved.tokenEnv]
  if (resolved.tokenEnv !== undefined && (token === undefined || token.length === 0)) {
    throw new Error(
      `dsh-github-review: configured token environment variable ${resolved.tokenEnv} is empty`,
    )
  }
  const store = await openGitHubReviewStore(ctx.storageDomain)
  const runtime = new GitHubReviewRuntime(
    ctx,
    store,
    new GitHubReviewClient({
      apiBase: resolved.apiBase,
      ...(token === undefined ? {} : { token }),
      requestTimeoutMs: resolved.requestTimeoutSeconds * 1_000,
    }),
    {
      trustedReviewers: resolved.trustedReviewers,
      maxTextChars: resolved.maxTextChars,
      maxComments: resolved.maxComments,
    },
  )
  const lifecycle = new AbortController()
  const monitors = new Set<ReturnType<typeof installDeliveryWatchMonitor>>()
  const requestScan = async (): Promise<void> => {
    if (lifecycle.signal.aborted) return
    const result = await runtime.scanOnce()
    for (const warning of result.unknown) ctx.logger.warn(`dsh-github-review: ${warning}`)
  }
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const monitor = installDeliveryWatchMonitor(toolCtx, store, {
        agentId: resolved.agentId,
        owner: resolved.owner,
        repo: resolved.repo,
        onWatch: requestScan,
      })
      monitors.add(monitor)
      return async () => {
        await monitor.dispose()
        monitors.delete(monitor)
      }
    }, 'dsh-github-review delivery watch')
  })
  const pollTask = poll(
    requestScan,
    resolved.pollIntervalSeconds * 1_000,
    lifecycle.signal,
    error => ctx.logger.warn(`dsh-github-review: poll scan failed: ${errorMessage(error)}`),
  )
  ctx.effect(() => async () => {
    lifecycle.abort(new Error('dsh-github-review disposed'))
    await Promise.all([...monitors].map(monitor => monitor.dispose()))
    monitors.clear()
    await pollTask
    await runtime.dispose()
    await store.close()
  }, 'dsh-github-review runtime')
}

async function poll(
  scan: () => Promise<void>,
  intervalMs: number,
  signal: AbortSignal,
  onError: (error: unknown) => void,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await scan()
    } catch (error) {
      if (!signal.aborted) onError(error)
    }
    try {
      await wait(intervalMs, undefined, { signal })
    } catch {
      return
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  GitHubReviewClient,
  GitHubReviewRuntime,
  installDeliveryWatchMonitor,
  openGitHubReviewStore,
  resolveGitHubReviewConfig,
}
