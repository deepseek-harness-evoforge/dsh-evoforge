import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { DshGateway } from 'dsh-evoforge-gateway'
import { TelegramApi } from './telegram-api.js'
import { TelegramRuntime } from './runtime.js'
import { TelegramPairingRuntime } from './pairing-runtime.js'
import { resolveTelegramConfig, resolveTelegramPairingConfig, resolveTelegramToken } from './config.js'
import type { TelegramHostNotice, TelegramHostRoute } from './host-route.js'

export const name = 'dsh-evoforge-telegram'
export const inject = ['credentials', 'evoforge.gateway']

export interface Config {
  /** Static route mode is retained for existing profiles. */
  readonly mode?: 'routes' | 'pairing'
  /** Legacy one-route spelling; mutually exclusive with pairing mode. */
  readonly routeId?: string
  /** Exact static Gateway route ids; routes mode currently accepts one route. */
  readonly routeIds?: readonly string[]
  /** Gateway account identity used by resident pairing mode. */
  readonly accountId?: string
  /** DSH credential reference holding the Bot token; legacy `Env` suffix retained for profile compatibility. */
  readonly tokenEnv?: string
  /** Official API endpoint, or a loopback endpoint for a local Bot API/test server. */
  readonly apiBase?: string
  readonly pollTimeoutSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export const Config: Schema<Config> = z.object({
  mode: z.union(['routes', 'pairing'] as const).default('routes'),
  routeId: z.string(),
  routeIds: z.array(z.string()).default([]),
  accountId: z.string(),
  tokenEnv: z.string().default('DSH_TELEGRAM_BOT_TOKEN'),
  apiBase: z.string().default('https://api.telegram.org'),
  pollTimeoutSeconds: z.number().step(1).min(1).max(50).default(30),
  maxSendAttempts: z.number().step(1).min(1).max(5).default(3),
  maxTextChars: z.number().step(1).min(256).max(4_096).default(4_000),
}) as Schema<Config>

export async function apply(ctx: Context, config: Config): Promise<void> {
  const gateway = ctx.get('evoforge.gateway' as never) as DshGateway | undefined
  if (gateway === undefined) throw new Error('dsh-telegram: dsh-gateway service is unavailable')
  const pairing = config.mode === 'pairing'
  const resolvedPairing = pairing ? resolveTelegramPairingConfig(config) : undefined
  const routeId = pairing ? undefined : config.routeId ?? (config.routeIds?.length === 1 ? config.routeIds[0] : undefined)
  if (!pairing && routeId === undefined) throw new Error('dsh-telegram: routes mode requires exactly one routeId')
  const route = routeId === undefined ? undefined : gateway.route(routeId)
  if (routeId !== undefined && route === undefined) throw new Error(`dsh-telegram: unknown Gateway route '${routeId}'`)
  const resolved = route === undefined || routeId === undefined
    ? undefined
    : resolveTelegramConfig({ ...config, routeId }, route)
  const tokenRef = resolvedPairing?.tokenEnv ?? resolved?.tokenEnv ?? config.tokenEnv ?? 'DSH_TELEGRAM_BOT_TOKEN'
  let runtime: TelegramRuntime | TelegramPairingRuntime | undefined
  let startPromise: Promise<void> | undefined
  let disposed = false

  if (resolved !== undefined && route !== undefined) {
    const hostRoute: TelegramHostRoute = Object.freeze({
      workspaceId: route.workspaceId,
      notify: (notice: TelegramHostNotice) => {
        const current = runtime
        if (!(current instanceof TelegramRuntime)) return Promise.reject(new Error('dsh-telegram: Adapter is not ready'))
        return current.notifyHost(notice)
      },
    })
    // Keep one stable DSH service while a credential rotation replaces only
    // the underlying long-poll runtime.
    ctx.provide('evoforge.telegramRoute' as never, hostRoute as never)
  }

  const start = async (): Promise<void> => {
    if (disposed || runtime !== undefined) return
    if (startPromise !== undefined) return startPromise
    const attempt = (async () => {
      let candidate: TelegramRuntime | TelegramPairingRuntime | undefined
      try {
        const token = await resolveTelegramToken(tokenRef, ctx.credentials)
        if (resolvedPairing !== undefined) {
          candidate = new TelegramPairingRuntime(
            ctx,
            resolvedPairing,
            gateway,
            new TelegramApi({ token, apiBase: resolvedPairing.apiBase }),
          )
        } else if (resolved !== undefined) {
          candidate = new TelegramRuntime(
            ctx,
            resolved,
            gateway,
            new TelegramApi({ token, apiBase: resolved.apiBase }),
          )
        } else {
          throw new Error('dsh-telegram: resolved route is unavailable')
        }
        await candidate.start()
        if (disposed) {
          await candidate.dispose()
          return
        }
        runtime = candidate
      } catch (error: unknown) {
        if (candidate !== undefined) await candidate.dispose().catch(() => undefined)
        if (!isCredentialUnavailableError(error)) throw error
        ctx.logger.warn(`dsh-telegram: waiting for credential reference ${tokenRef}`)
      }
    })()
    startPromise = attempt
    try {
      await attempt
    } finally {
      if (startPromise === attempt) startPromise = undefined
    }
  }

  ctx.on('credentials/reference-updated', (reference) => {
    if (String(reference) !== tokenRef) return
    const previous = runtime
    runtime = undefined
    void (async () => {
      if (previous !== undefined) await previous.dispose()
      await start()
    })().catch(error => {
      if (!disposed) ctx.logger.warn(`dsh-telegram: credential update could not start Adapter: ${safeMessage(error)}`)
    })
  })
  ctx.effect(() => async () => {
    disposed = true
    await startPromise
    await runtime?.dispose()
    runtime = undefined
  }, `dsh-telegram ${pairing ? 'pairing ' : ''}runtime`)
  await start()
}

function isCredentialUnavailableError(error: unknown): boolean {
  return error instanceof Error
    && /configured credential reference [A-Za-z_][A-Za-z0-9_]* is empty or invalid/u.test(error.message)
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type { TelegramHostNotice, TelegramHostNoticeReceipt, TelegramHostRoute } from './host-route.js'
export { resolveTelegramConfig, resolveTelegramPairingConfig, resolveTelegramToken } from './config.js'
export type { ResolvedTelegramConfig, ResolvedTelegramPairingConfig } from './config.js'
export { TelegramPairingRuntime } from './pairing-runtime.js'
