import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { openGatewayIngressJournal } from './ingress-journal.js'
import { openGatewayOutboundJournal, type GatewayOutboundJournal } from './outbound-journal.js'
import { DshGateway } from './gateway.js'
import { GatewayRemoteService } from './gateway-remote.js'
import { openGatewayPairingAuthority, type GatewayPairingAuthority } from './pairing.js'
import { resolveGatewayRoutes, type GatewayRouteConfig } from './routing.js'
export { sessionEvents } from './session-log.ts'

export const name = 'dsh-evoforge-gateway'
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
  /** Gateway-owned unknown-DM pairing; adapters still decide which messages are direct. */
  readonly pairing?: {
    readonly enabled?: boolean
    readonly codeTtlMs?: number
    readonly maxPendingPerAccount?: number
  }
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
  pairing: z.object({
    enabled: z.boolean().default(true),
    codeTtlMs: z.number().step(1).min(60_000).max(3_600_000).default(900_000),
    maxPendingPerAccount: z.number().step(1).min(1).max(20).default(3),
  }).default({ enabled: true, codeTtlMs: 900_000, maxPendingPerAccount: 3 }),
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
  let pairing: GatewayPairingAuthority | undefined
  try {
    if (config.pairing?.enabled !== false) {
      pairing = await openGatewayPairingAuthority(ctx.storageDomain, {
        codeTtlMs: config.pairing?.codeTtlMs ?? 900_000,
        maxPendingPerAccount: config.pairing?.maxPendingPerAccount ?? 3,
      })
    }
  } catch (error) {
    await Promise.allSettled([outbound.close(), journal.close()])
    throw error
  }
  const gateway = new DshGateway(
    ctx,
    resolveGatewayRoutes(config.routes ?? []),
    journal,
    outbound,
    pairing,
  )
  try {
    await gateway.start()
    new GatewayRemoteService(ctx, gateway)
    ctx.effect(() => () => gateway.stop(), 'dsh-gateway.runtime')
    ctx.provide('evoforge.gateway' as never, gateway as never)
  } catch (error: unknown) {
    const cleanup = (await Promise.allSettled([gateway.stop()]))[0]
    if (cleanup?.status === 'rejected') {
      ctx.logger.warn(`dsh-gateway: startup cleanup failed: ${safeMessage(cleanup.reason)}`)
    }
    throw error
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  openGatewayPairingAuthority,
  type GatewayPairingApproval,
  type GatewayPairingApprovalInput,
  type GatewayPairingAuthority,
  type GatewayPairingAuthorityOptions,
  type GatewayPairingOffer,
  type GatewayPairingPendingRequest,
  type GatewayPairingRequestApprovalInput,
  type GatewayPairingRequest,
  type GatewayPairingRevocation,
  type GatewayPairingTarget,
  type GatewayRevokedTrustGrant,
  type GatewayTrustGrant,
} from './pairing.js'
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
  type GatewayOutboundObservation,
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
  GatewayTransportRegistry,
  type GatewayTransportConfig,
  type GatewayTransportHealth,
  type GatewayTransportHealthItem,
  type GatewayTransportObservation,
  type GatewayTransportRegistration,
  type GatewayTransportState,
} from './transport-health.js'
export {
  GatewayIngressUncertainError,
  DshGateway,
  type GatewayAcceptInput,
  type GatewayAcceptResult,
  type GatewayAuthorizationResult,
  type GatewayDispatchInput,
  type GatewayDispatchResult,
  type GatewayHealthRoute,
  type GatewayHealthSnapshot,
  type GatewayRecoveryObservation,
  type GatewayPairingRevocationReceipt,
  type GatewayPairingSessionApprovalInput,
  type GatewayPairingSessionApprovalReceipt,
  type GatewayPairingSessionRequestApprovalInput,
} from './gateway.js'
export { GatewayRemoteService } from './gateway-remote.js'
export type { GatewayRemoteTypertContract } from './gateway-remote.typert.js'
