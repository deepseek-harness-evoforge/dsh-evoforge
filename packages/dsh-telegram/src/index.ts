import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { DshGateway } from 'dsh-gateway'
import { TelegramApi } from './telegram-api.js'
import { TelegramRuntime } from './runtime.js'
import { TelegramPairingRuntime } from './pairing-runtime.js'
import { resolveTelegramConfig, resolveTelegramPairingConfig } from './config.js'
import type { TelegramHostNotice, TelegramHostRoute } from './host-route.js'

export const name = 'dsh-telegram'
export const inject = ['evoforge.gateway']

export interface Config {
  /** Static route mode is retained for existing profiles. */
  readonly mode?: 'routes' | 'pairing'
  /** Legacy one-route spelling; mutually exclusive with pairing mode. */
  readonly routeId?: string
  /** Exact static Gateway route ids; routes mode currently accepts one route. */
  readonly routeIds?: readonly string[]
  /** Gateway account identity used by resident pairing mode. */
  readonly accountId?: string
  /** Environment variable holding the Bot token. Reading it is an explicit deployment policy. */
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
  if (config.mode === 'pairing') {
    const resolved = resolveTelegramPairingConfig(config)
    const token = process.env[resolved.tokenEnv]!
    const runtime = new TelegramPairingRuntime(
      ctx,
      resolved,
      gateway,
      new TelegramApi({ token, apiBase: resolved.apiBase }),
    )
    ctx.effect(() => async () => runtime.dispose(), 'dsh-telegram pairing runtime')
    try {
      await runtime.start()
    } catch (error) {
      await runtime.dispose()
      throw error
    }
    return
  }
  const routeId = config.routeId ?? (config.routeIds?.length === 1 ? config.routeIds[0] : undefined)
  if (routeId === undefined) throw new Error('dsh-telegram: routes mode requires exactly one routeId')
  const route = gateway.route(routeId)
  if (route === undefined) throw new Error(`dsh-telegram: unknown Gateway route '${routeId}'`)
  const resolved = resolveTelegramConfig({ ...config, routeId }, route)
  const token = process.env[resolved.tokenEnv]
  if (token === undefined || token.length === 0) {
    throw new Error(`dsh-telegram: configured token environment variable ${resolved.tokenEnv} is empty`)
  }
  const runtime = new TelegramRuntime(
    ctx,
    resolved,
    gateway,
    new TelegramApi({ token, apiBase: resolved.apiBase }),
  )
  ctx.effect(() => async () => runtime.dispose(), 'dsh-telegram runtime')
  try {
    await runtime.start()
    const hostRoute: TelegramHostRoute = Object.freeze({
      workspaceId: route.workspaceId,
      notify: (notice: TelegramHostNotice) => runtime.notifyHost(notice),
    })
    ctx.provide('evoforge.telegramRoute' as never, hostRoute as never)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}

export type { TelegramHostNotice, TelegramHostNoticeReceipt, TelegramHostRoute } from './host-route.js'
export { resolveTelegramConfig, resolveTelegramPairingConfig } from './config.js'
export type { ResolvedTelegramConfig, ResolvedTelegramPairingConfig } from './config.js'
export { TelegramPairingRuntime } from './pairing-runtime.js'
