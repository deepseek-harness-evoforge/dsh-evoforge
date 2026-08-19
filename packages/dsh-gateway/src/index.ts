import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { openGatewayIngressJournal } from './ingress-journal.js'
import { openGatewayOutboundJournal, type GatewayOutboundJournal } from './outbound-journal.js'
import { DshGateway } from './gateway.js'
import { resolveGatewayRoutes, type GatewayRouteConfig } from './routing.js'

export const name = 'dsh-gateway'
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
  readonly routes?: readonly GatewayRouteConfig[]
  /** Retained ingress journal bound; active effects are never pruned. */
  readonly maxIngressRecords?: number
  /** Retained outbound journal bound; active deliveries are never pruned. */
  readonly maxOutboundRecords?: number
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
  provider: z.string().required(),
  model: z.string().required(),
  maxTokens: z.number().step(1).min(1),
})

export const Config: Schema<Config> = z.object({
  routes: z.array(routeSchema).default([]),
  maxIngressRecords: z.number().step(1).min(1).max(100_000).default(10_000),
  maxOutboundRecords: z.number().step(1).min(1).max(100_000).default(10_000),
}) as Schema<Config>

/** Install one shared Host Gateway for transport-only channel Adapters. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const journal = await openGatewayIngressJournal(ctx.storageDomain, {
    maxRecords: config.maxIngressRecords ?? 10_000,
  })
  let outbound: GatewayOutboundJournal
  try {
    outbound = await openGatewayOutboundJournal(ctx.storageDomain, {
      maxRecords: config.maxOutboundRecords ?? 10_000,
    })
  } catch (error) {
    await journal.close()
    throw error
  }
  const gateway = new DshGateway(ctx, resolveGatewayRoutes(config.routes ?? []), journal, outbound)
  try {
    await gateway.start()
    ctx.effect(() => () => gateway.stop(), 'dsh-gateway.runtime')
    ctx.provide('evoforge.gateway' as never, gateway as never)
  } catch (error: unknown) {
    await gateway.stop()
    throw error
  }
}

export {
  endpointKey,
  resolveGatewayRoutes,
  type GatewayEndpoint,
  type GatewayRouteConfig,
  type ResolvedGatewayRoute,
  type ResolvedGatewayRoutes,
} from './routing.js'
export {
  openGatewayIngressJournal,
  type GatewayCommandResult,
  type GatewayIngressRecord,
  type GatewayIngressJournal,
  type GatewayIngressJournalOptions,
  type PrepareGatewayIngressInput,
} from './ingress-journal.js'
export {
  GatewayOutboundCoordinator,
  type GatewayOutboundHealth,
  type GatewayOutboundPolicy,
  type GatewayOutboundReceipt,
  type GatewayOutboundSendInput,
  type GatewayOutboundSendResult,
  type GatewayTextAdapterConfig,
  type GatewayTextAdapterRegistration,
  type GatewayTextDeliveryIntent,
} from './outbound.js'
export {
  openGatewayOutboundJournal,
  type GatewayOutboundJournal,
  type GatewayOutboundRecord,
  type GatewayOutboundStatus,
} from './outbound-journal.js'
export {
  GatewayIngressUncertainError,
  DshGateway,
  type GatewayDispatchInput,
  type GatewayDispatchResult,
  type GatewayHealthRoute,
  type GatewayHealthSnapshot,
} from './gateway.js'
