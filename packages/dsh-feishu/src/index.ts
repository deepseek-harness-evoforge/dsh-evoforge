import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { DshGateway, ResolvedGatewayRoute } from 'dsh-gateway'
import {
  FEISHU_CONTENT_PERMISSIONS,
  resolveFeishuConfig,
  resolveFeishuPairingConfig,
  type ResolvedFeishuPairingConfig,
  type FeishuContentPermission,
} from './config.js'
import type { FeishuHostNotice, FeishuHostRoute } from './host-route.js'
import { FeishuPairingRuntime, type FeishuPairingTarget } from './pairing.js'
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
  if (config.mode === 'pairing') {
    const resolved = resolveFeishuPairingConfig({ ...config, mode: 'pairing', routeIds })
    installFeishuPairing(ctx, resolved, createOfficialFeishuPairingPlatform({
      appId: resolved.appId,
      appSecret: resolved.appSecret,
      handshakeTimeoutMs: resolved.handshakeTimeoutMs,
    }))
    return
  }
  const gateway = ctx.get('evoforge.gateway' as never) as DshGateway | undefined
  if (gateway === undefined) throw new Error('dsh-feishu: dsh-gateway service is unavailable')
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
export { FeishuPairingRuntime, type FeishuPairingRuntimeOptions, type FeishuPairingTarget } from './pairing.js'
export { FeishuRuntime } from './runtime.js'
