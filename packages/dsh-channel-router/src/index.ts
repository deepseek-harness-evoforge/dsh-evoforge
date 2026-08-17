import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { openChannelIngressStore } from './ingress-store.js'
import { ChannelRouter } from './router.js'
import { resolveChannelRoutes, type ChannelRouteConfig } from './routes.js'

export const name = 'dsh-channel-router'
export const inject = [
  'agents',
  'agentPresets',
  'commands',
  'sessionPersistence',
  'storageDomain',
  'workspaceRegistry',
]

export interface Config {
  /** Complete deny-by-default table. No endpoint is inferred or wildcarded. */
  readonly routes?: readonly ChannelRouteConfig[]
  /** Retained ingress journal bound; active effects are never pruned. */
  readonly maxIngressRecords?: number
}

const routeSchema = z.object({
  id: z.string().required(),
  adapter: z.string().required(),
  accountId: z.string().required(),
  conversationId: z.string().required(),
  threadId: z.string(),
  userId: z.string().required(),
  workspaceId: z.string().required(),
  sessionId: z.string().required(),
  agentPreset: z.string().required(),
})

export const Config: Schema<Config> = z.object({
  routes: z.array(routeSchema).default([]),
  maxIngressRecords: z.number().step(1).min(1).max(100_000).default(10_000),
}) as Schema<Config>

/** Install one shared Host router for transport-only channel adapters. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const store = await openChannelIngressStore(ctx.storageDomain, {
    maxRecords: config.maxIngressRecords ?? 10_000,
  })
  const router = new ChannelRouter(ctx, resolveChannelRoutes(config.routes ?? []), store)
  try {
    await router.start()
    ctx.effect(() => () => router.stop(), 'dsh-channel-router.runtime')
    ctx.provide('evoforge.channelRouter' as never, router as never)
  } catch (error: unknown) {
    await router.stop()
    throw error
  }
}

export {
  endpointKey,
  resolveChannelRoutes,
  type ChannelEndpoint,
  type ChannelRouteConfig,
  type ResolvedChannelRoute,
  type ResolvedChannelRoutes,
} from './routes.js'
export {
  openChannelIngressStore,
  type ChannelCommandResult,
  type ChannelIngressRecord,
  type ChannelIngressStore,
  type ChannelIngressStoreOptions,
  type PrepareChannelIngressInput,
} from './ingress-store.js'
export {
  ChannelIngressUncertainError,
  ChannelRouter,
  type ChannelDispatchInput,
  type ChannelDispatchResult,
} from './router.js'
