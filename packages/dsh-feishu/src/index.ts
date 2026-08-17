import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { ChannelRouter, ResolvedChannelRoute } from 'dsh-channel-router'
import { resolveFeishuConfig } from './config.js'
import { openFeishuDeliveryStore } from './delivery-store.js'
import type { FeishuHostNotice, FeishuHostRoute } from './host-route.js'
import { createOfficialFeishuPlatform } from './platform.js'
import { FeishuRuntime } from './runtime.js'

export const name = 'dsh-feishu'
export const inject = ['evoforge.channelRouter', 'storageDomain']

export interface Config {
  readonly routeIds: readonly string[]
  readonly appIdEnv?: string
  readonly appSecretEnv?: string
  readonly handshakeTimeoutMs?: number
  readonly maxDeliveryRecords?: number
  readonly maxRetryAfterSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export const Config: Schema<Config> = z.object({
  routeIds: z.array(z.string()).required(),
  appIdEnv: z.string().default('DSH_FEISHU_APP_ID'),
  appSecretEnv: z.string().default('DSH_FEISHU_APP_SECRET'),
  handshakeTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(15_000),
  maxDeliveryRecords: z.number().step(1).min(1).max(100_000).default(10_000),
  maxRetryAfterSeconds: z.number().step(1).min(1).max(300).default(300),
  maxSendAttempts: z.number().step(1).min(1).max(5).default(3),
  maxTextChars: z.number().step(1).min(256).max(30_000).default(4_000),
}) as Schema<Config>

export async function apply(ctx: Context, config: Config): Promise<void> {
  const router = ctx.get('evoforge.channelRouter' as never) as ChannelRouter | undefined
  if (router === undefined) throw new Error('dsh-feishu: dsh-channel-router service is unavailable')
  const routes: ResolvedChannelRoute[] = []
  for (const id of config.routeIds) {
    const route = router.route(id)
    if (route !== undefined) routes.push(route)
  }
  const resolved = resolveFeishuConfig(config, routes)
  const store = await openFeishuDeliveryStore(ctx.storageDomain, { maxRecords: resolved.maxDeliveryRecords })
  const runtime = new FeishuRuntime(
    ctx,
    resolved,
    router,
    store,
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
    const hostRoute: FeishuHostRoute = Object.freeze({
      routes: Object.freeze(resolved.routes.map(route => Object.freeze({
        routeId: route.id,
        workspaceId: route.workspaceId,
      }))),
      notify: (notice: FeishuHostNotice) => runtime.notifyHost(notice),
    })
    ctx.provide('evoforge.feishuRoute' as never, hostRoute as never)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

export { resolveFeishuConfig, type ResolvedFeishuConfig, type ResolvedFeishuRoute } from './config.js'
export {
  openFeishuDeliveryStore,
  type FeishuDeliveryRecord,
  type FeishuDeliveryStore,
  type PrepareFeishuNoticeInput,
  type PrepareFeishuResponseInput,
  type PrepareFeishuTurnInput,
} from './delivery-store.js'
export {
  beginFeishuDelivery,
  classifyFeishuSendFailure,
  recoverFeishuDelivery,
  type FeishuDeliveryState,
  type FeishuDeliveryStatus,
  type FeishuSendFailure,
} from './delivery-state.js'
export type {
  FeishuHostNotice,
  FeishuHostNoticeReceipt,
  FeishuHostRoute,
  FeishuHostRouteBinding,
} from './host-route.js'
export {
  createOfficialFeishuPlatform,
  FeishuPlatformSendError,
  type FeishuApprovalAction,
  type FeishuInboundMessage,
  type FeishuPlatform,
  type FeishuPlatformOptions,
  type FeishuSendOptions,
} from './platform.js'
export { FeishuRuntime } from './runtime.js'
