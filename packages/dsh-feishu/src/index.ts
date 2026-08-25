import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { DshGateway, ResolvedGatewayRoute } from 'dsh-gateway'
import {
  FEISHU_CONTENT_PERMISSIONS,
  resolveFeishuConfig,
  resolveFeishuPairingConfig,
  type FeishuContentPermission,
} from './config.js'
import {
  createOfficialFeishuPairingPlatform,
  createOfficialFeishuPlatform,
  type FeishuPlatform,
} from './platform.js'
import { FeishuRuntime } from './runtime.js'

export const name = 'dsh-feishu'
export const inject = ['attachments', 'commands', 'evoforge.gateway', 'workspaceRegistry']

export interface Config {
  readonly mode?: 'routes' | 'pairing'
  readonly routeIds?: readonly string[]
  readonly appIdEnv?: string
  readonly appSecretEnv?: string
  readonly handshakeTimeoutMs?: number
  readonly maxRetryAfterSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
  readonly contentPermissions?: readonly FeishuContentPermission[]
  readonly maxContentChars?: number
  readonly maxBitableRecords?: number
}

export const Config: Schema<Config> = z.object({
  mode: z.union(['routes', 'pairing'] as const).default('routes'),
  routeIds: z.array(z.string()).default([]),
  appIdEnv: z.string().default('DSH_FEISHU_APP_ID'),
  appSecretEnv: z.string().default('DSH_FEISHU_APP_SECRET'),
  handshakeTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(15_000),
  maxRetryAfterSeconds: z.number().step(1).min(1).max(300).default(300),
  maxSendAttempts: z.number().step(1).min(1).max(5).default(3),
  maxTextChars: z.number().step(1).min(256).max(30_000).default(4_000),
  contentPermissions: z.array(z.union(FEISHU_CONTENT_PERMISSIONS)).default([]),
  maxContentChars: z.number().step(1).min(1_024).max(100_000).default(20_000),
  maxBitableRecords: z.number().step(1).min(1).max(100).default(20),
}) as Schema<Config>

export async function apply(ctx: Context, config: Config): Promise<void> {
  const routeIds = config.routeIds ?? []
  const gateway = ctx.get('evoforge.gateway' as never) as DshGateway | undefined
  if (gateway === undefined) throw new Error('dsh-feishu: dsh-gateway service is unavailable')
  if (config.mode === 'pairing') {
    const resolved = resolveFeishuPairingConfig({ ...config, mode: 'pairing', routeIds })
    const runtime = new FeishuRuntime(
      ctx,
      resolved,
      gateway,
      createOfficialFeishuPairingPlatform({
        appId: resolved.appId,
        appSecret: resolved.appSecret,
        handshakeTimeoutMs: resolved.handshakeTimeoutMs,
      }),
    )
    ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu.runtime')
    try {
      await runtime.start()
      ctx.provide('evoforge.feishuRoute' as never, runtime.createHostRoute() as never)
    } catch (error) {
      await runtime.dispose()
      throw error
    }
    return
  }
  const routes: ResolvedGatewayRoute[] = []
  for (const id of routeIds) {
    const route = gateway.route(id)
    if (route !== undefined) routes.push(route)
  }
  const resolved = resolveFeishuConfig({ ...config, mode: 'routes', routeIds }, routes)
  const runtime = new FeishuRuntime(
    ctx,
    resolved,
    gateway,
    createOfficialFeishuPlatform({
      appId: resolved.appId,
      appSecret: resolved.appSecret,
      handshakeTimeoutMs: resolved.handshakeTimeoutMs,
      allowedChats: resolved.routes.map(route => route.endpoint.conversationId),
      allowedUsers: resolved.routes.map(route => route.endpoint.userId),
    }),
  )
  ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu.runtime')
  try {
    await runtime.start()
    ctx.provide('evoforge.feishuRoute' as never, runtime.createHostRoute() as never)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

export {
  FEISHU_CONTENT_PERMISSIONS,
  resolveFeishuConfig,
  resolveFeishuPairingConfig,
  type ResolvedFeishuConfig,
  type ResolvedFeishuPairingConfig,
  type ResolvedFeishuRoute,
  type FeishuContentPermission,
} from './config.js'
export {
  FEISHU_CONTENT_TOOL,
  installFeishuContentTool,
  shouldInstallFeishuContentTool,
  type FeishuContentReadRequest,
  type FeishuContentReadResult,
  type FeishuContentReader,
} from './content.js'
export type {
  FeishuHostNotice,
  FeishuHostNoticeReceipt,
  FeishuHostRoute,
  FeishuHostRouteBinding,
} from './host-route.js'
export {
  FEISHU_HEALTH_PREFIX,
  parseFeishuHealthCommand,
  renderFeishuHealthCommand,
  summarizeFeishuContentHealth,
  summarizeFeishuHealth,
  type FeishuContentHealth,
  type FeishuContentHealthStatus,
  type FeishuHealthRoute,
  type FeishuHealthRouteInput,
  type FeishuHealthSnapshot,
  type FeishuHealthStatus,
  type FeishuTransportState,
  type SummarizeFeishuContentHealthInput,
  type SummarizeFeishuHealthInput,
} from './health.js'
export {
  createOfficialFeishuPairingPlatform,
  createOfficialFeishuPlatform,
  FeishuPlatformSendError,
  type FeishuApprovalAction,
  type FeishuInboundMessage,
  type FeishuInboundResource,
  type FeishuPlatform,
  type FeishuPairingPlatformOptions,
  type FeishuPlatformOptions,
  type FeishuSendOptions,
} from './platform.js'
export { FeishuRuntime } from './runtime.js'
