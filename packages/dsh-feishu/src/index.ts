import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { ChannelRouter, ResolvedChannelRoute } from 'dsh-channel-router'
import {
  resolveFeishuConfig,
  resolveFeishuPairingConfig,
  type ResolvedFeishuPairingConfig,
} from './config.js'
import { openFeishuDeliveryStore } from './delivery-store.js'
import type { FeishuHostNotice, FeishuHostRoute } from './host-route.js'
import { FeishuPairingRuntime, type FeishuPairingTarget } from './pairing.js'
import {
  createOfficialFeishuPairingPlatform,
  createOfficialFeishuPlatform,
  type FeishuPlatform,
} from './platform.js'
import { FeishuRuntime } from './runtime.js'

export const name = 'dsh-feishu'
export const inject = ['commands', 'evoforge.channelRouter', 'storageDomain', 'workspaceRegistry']

export interface Config {
  readonly mode?: 'routes' | 'pairing'
  readonly routeIds?: readonly string[]
  readonly appIdEnv?: string
  readonly appSecretEnv?: string
  readonly handshakeTimeoutMs?: number
  readonly maxDeliveryRecords?: number
  readonly maxRetryAfterSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export const Config: Schema<Config> = z.object({
  mode: z.union(['routes', 'pairing'] as const).default('routes'),
  routeIds: z.array(z.string()).default([]),
  appIdEnv: z.string().default('DSH_FEISHU_APP_ID'),
  appSecretEnv: z.string().default('DSH_FEISHU_APP_SECRET'),
  handshakeTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(15_000),
  maxDeliveryRecords: z.number().step(1).min(1).max(100_000).default(10_000),
  maxRetryAfterSeconds: z.number().step(1).min(1).max(300).default(300),
  maxSendAttempts: z.number().step(1).min(1).max(5).default(3),
  maxTextChars: z.number().step(1).min(256).max(30_000).default(4_000),
}) as Schema<Config>

export async function apply(ctx: Context, config: Config): Promise<void> {
  const routeIds = config.routeIds ?? []
  if (config.mode === 'pairing') {
    const resolved = resolveFeishuPairingConfig({ ...config, mode: 'pairing', routeIds })
    installFeishuPairing(ctx, resolved, createOfficialFeishuPairingPlatform({
      appId: resolved.appId,
      appSecret: resolved.appSecret,
      handshakeTimeoutMs: resolved.handshakeTimeoutMs,
    }))
    return
  }
  const router = ctx.get('evoforge.channelRouter' as never) as ChannelRouter | undefined
  if (router === undefined) throw new Error('dsh-feishu: dsh-channel-router service is unavailable')
  const routes: ResolvedChannelRoute[] = []
  for (const id of routeIds) {
    const route = router.route(id)
    if (route !== undefined) routes.push(route)
  }
  const resolved = resolveFeishuConfig({ ...config, mode: 'routes', routeIds }, routes)
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

/** Install the DSH-owned command/lifecycle around either the official or a test transport Adapter. */
export function installFeishuPairing(
  ctx: Context,
  config: ResolvedFeishuPairingConfig,
  platform: FeishuPlatform,
): FeishuPairingRuntime {
  const runtime = new FeishuPairingRuntime(platform, {
    appId: config.appId,
    appIdEnv: config.appIdEnv,
    appSecretEnv: config.appSecretEnv,
    pairingWindowMs: config.pairingWindowMs,
  })
  ctx.effect(() => async () => runtime.dispose(), 'dsh-feishu.pairing')
  ctx.commands.register({
    name: 'feishu-pair',
    description: 'pair one exact Feishu chat/user with this native Workspace and Session',
    input: { hint: 'start | status | cancel' },
    recordInput: false,
    handler: ({ agent, rawInput }) => {
      try {
        return runtime.command(resolvePairingTarget(ctx, agent), rawInput)
      } catch (error: unknown) {
        return { kind: 'error', text: error instanceof Error ? error.message : '无法解析目标 DSH Session。' }
      }
    },
  })
  return runtime
}

/** Bind setup to the exact DSH Session where the human invoked the command. */
export function resolvePairingTarget(ctx: Context, agent: Agent): FeishuPairingTarget {
  const sessionId = String(agent.session.id)
  const owners = ctx.workspaceRegistry.list().filter(workspace =>
    workspace.sessionIds.some(id => String(id) === sessionId))
  if (owners.length !== 1) {
    throw new Error('飞书配对要求当前 Session 明确属于一个已注册的 DSH Workspace。')
  }
  const agentPreset = agent.session.header.agentPreset
  const provider = agent.options.provider
  const model = agent.options.model
  if (agentPreset === undefined || provider === undefined || model === undefined) {
    throw new Error('飞书配对要求当前 Session 已选择 Agent preset、provider 和 model。')
  }
  return Object.freeze({
    workspaceId: String(owners[0]!.id),
    sessionId,
    agentPreset,
    provider,
    model,
    ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }),
  })
}

export {
  resolveFeishuConfig,
  resolveFeishuPairingConfig,
  type ResolvedFeishuConfig,
  type ResolvedFeishuPairingConfig,
  type ResolvedFeishuRoute,
} from './config.js'
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
  FEISHU_HEALTH_PREFIX,
  parseFeishuHealthCommand,
  renderFeishuHealthCommand,
  summarizeFeishuHealth,
  type FeishuHealthRoute,
  type FeishuHealthRouteInput,
  type FeishuHealthSnapshot,
  type FeishuHealthStatus,
  type FeishuTransportState,
  type SummarizeFeishuHealthInput,
} from './health.js'
export {
  createOfficialFeishuPairingPlatform,
  createOfficialFeishuPlatform,
  FeishuPlatformSendError,
  type FeishuApprovalAction,
  type FeishuInboundMessage,
  type FeishuPlatform,
  type FeishuPairingPlatformOptions,
  type FeishuPlatformOptions,
  type FeishuSendOptions,
} from './platform.js'
export { FeishuPairingRuntime, type FeishuPairingRuntimeOptions, type FeishuPairingTarget } from './pairing.js'
export { FeishuRuntime } from './runtime.js'
