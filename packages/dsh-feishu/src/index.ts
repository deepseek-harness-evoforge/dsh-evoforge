import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { DshGateway, ResolvedGatewayRoute } from 'dsh-evoforge-gateway'
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
import { FeishuCredentialRemoteService } from './feishu-credentials-remote.js'
import type { FeishuHostNotice, FeishuHostRoute } from './host-route.js'
import { FeishuRuntime } from './runtime.js'

export const name = 'dsh-evoforge-feishu'
export const inject = ['attachments', 'commands', 'credentials', 'evoforge.gateway', 'workspaceRegistry']

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
  const appIdRef = config.appIdEnv ?? 'DSH_FEISHU_APP_ID'
  const appSecretRef = config.appSecretEnv ?? 'DSH_FEISHU_APP_SECRET'
  let runtime: FeishuRuntime | undefined
  let startPromise: Promise<void> | undefined
  let disposed = false
  let credentialGeneration = 0
  let restartChain: Promise<void> = Promise.resolve()
  const hostRoute: FeishuHostRoute = Object.freeze({
    get routes() {
      return runtime?.createHostRoute().routes ?? []
    },
    observedChatKind: (routeId: string) => runtime?.observedChatKind(routeId),
    notify: (notice: FeishuHostNotice) => {
      const current = runtime
      if (current === undefined) return Promise.reject(new Error('dsh-feishu: Adapter is not ready'))
      return current.notifyHost(notice)
    },
  })
  // Register exactly once. A credential rotation may replace the runtime, but
  // Cordis services are single-assignment; this dynamic façade keeps all
  // downstream injectors attached to the same native service identity.
  ctx.provide('evoforge.feishuRoute' as never, hostRoute as never)
  new FeishuCredentialRemoteService(ctx, { appIdRef, appSecretRef })

  const start = async (): Promise<void> => {
    if (disposed || runtime !== undefined) return
    const pending = startPromise
    if (pending !== undefined) {
      await pending
      // A credential event may have invalidated the in-flight attempt. Once
      // that attempt has fully settled, immediately retry the new generation
      // instead of accidentally retaining a runtime built from old secrets.
      if (!disposed && runtime === undefined) await start()
      return
    }
    const generation = credentialGeneration
    const attempt = (async () => {
      let candidate: FeishuRuntime | undefined
      try {
        if (config.mode === 'pairing') {
          const resolved = await resolveFeishuPairingConfig({ ...config, mode: 'pairing', routeIds }, ctx.credentials)
          candidate = new FeishuRuntime(
            ctx,
            resolved,
            gateway,
            createOfficialFeishuPairingPlatform({
              appId: resolved.appId,
              appSecret: resolved.appSecret,
              handshakeTimeoutMs: resolved.handshakeTimeoutMs,
            }),
          )
        } else {
          const routes: ResolvedGatewayRoute[] = []
          for (const id of routeIds) {
            const route = gateway.route(id)
            if (route !== undefined) routes.push(route)
          }
          const resolved = await resolveFeishuConfig({ ...config, mode: 'routes', routeIds }, routes, ctx.credentials)
          candidate = new FeishuRuntime(
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
        }
        await candidate.start()
        if (disposed || generation !== credentialGeneration) {
          try {
            await candidate.dispose()
          } catch (error: unknown) {
            ctx.logger.warn(`dsh-feishu: stale Adapter disposal failed: ${safeMessage(error)}`)
          }
          candidate = undefined
          return
        }
        runtime = candidate
      } catch (error: unknown) {
        if (candidate !== undefined) {
          try {
            await candidate.dispose()
          } catch (disposeError: unknown) {
            ctx.logger.warn(`dsh-feishu: failed to dispose an unsuccessful start: ${safeMessage(disposeError)}`)
          }
        }
        if (!isCredentialUnavailableError(error)) throw error
        // A missing/invalid secret is a fail-closed channel state, not a reason
        // to take down the native DSH Host. The credential event below retries
        // the same start path after an official Web/Host write commits.
        ctx.logger.warn(`dsh-feishu: waiting for credential references ${appIdRef} and ${appSecretRef}`)
      }
    })()
    let run!: Promise<void>
    run = (async () => {
      try {
        await attempt
      } finally {
        if (startPromise === run) startPromise = undefined
      }
    })()
    startPromise = run
    await run
  }

  const removeCredentialUpdate = ctx.on('credentials/reference-updated', (reference) => {
    const ref = String(reference)
    if (ref !== appIdRef && ref !== appSecretRef) return
    credentialGeneration += 1
    const previous = runtime
    runtime = undefined
    restartChain = restartChain.then(async () => {
      if (previous !== undefined) {
        try {
          await previous.dispose()
        } catch (error: unknown) {
          // A partially stopped old Adapter must not prevent the new
          // credential generation from being attempted. Its own teardown
          // remains observable, but recovery stays fail-closed and live.
          if (!disposed) ctx.logger.warn(`dsh-feishu: previous Adapter disposal failed during credential update: ${safeMessage(error)}`)
        }
      }
      await start()
    }).catch(error => {
      if (!disposed) ctx.logger.warn(`dsh-feishu: credential update could not start Adapter: ${safeMessage(error)}`)
    })
  })
  ctx.effect(() => async () => {
    disposed = true
    removeCredentialUpdate()
    await restartChain
    await startPromise
    await runtime?.dispose()
    runtime = undefined
  }, 'dsh-feishu.runtime')
  await start()
}

/** Only missing/invalid resolved values are deferred; malformed config still fails the Host. */
function isCredentialUnavailableError(error: unknown): boolean {
  return error instanceof Error
    && /configured credential reference [A-Za-z_][A-Za-z0-9_]* is empty or invalid/u.test(error.message)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  FEISHU_EVENT_SUBSCRIPTION_READ_SCOPE,
  FEISHU_TRANSPORT_SCOPES,
  inspectFeishuPlatformAccess,
  type FeishuApprovalAction,
  type FeishuInboundMessage,
  type FeishuInboundResource,
  type FeishuPlatform,
  type FeishuPlatformAccess,
  type FeishuPlatformAccessClient,
  type FeishuPlatformAccessReason,
  type FeishuPlatformAccessStatus,
  type FeishuPlatformReject,
  type FeishuPlatformRejectReason,
  type FeishuPairingPlatformOptions,
  type FeishuPlatformOptions,
  type FeishuSendOptions,
} from './platform.js'
export { FeishuRuntime } from './runtime.js'
export { FeishuCredentialRemoteService } from './feishu-credentials-remote.js'
export type { FeishuCredentialReferences } from './feishu-credentials-remote.js'
export type { FeishuCredentialRemoteTypertContract } from './feishu-credentials-remote.typert.js'
