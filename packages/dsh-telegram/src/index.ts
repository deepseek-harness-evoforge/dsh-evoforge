import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { TelegramApi } from './telegram-api.js'
import { openTelegramDeliveryStore } from './delivery-store.js'
import { TelegramRuntime } from './runtime.js'
import { resolveTelegramConfig } from './config.js'
import type { TelegramHostNotice, TelegramHostRoute } from './host-route.js'

export const name = 'dsh-telegram'
export const inject = ['agents', 'commands', 'sessions', 'storageDomain']

export interface Config {
  /** One existing root Agent; every completed turn on it routes to the fixed chat. */
  readonly agentId: string
  /** Exact Telegram private chat id authorized by deployment config. */
  readonly chatId: number
  /** Exact Telegram user id authorized to submit messages and approvals. */
  readonly userId: number
  /** Environment variable holding the Bot token. Reading it is an explicit deployment policy. */
  readonly tokenEnv?: string
  /** Official API endpoint, or a loopback endpoint for a local Bot API/test server. */
  readonly apiBase?: string
  readonly pollTimeoutSeconds?: number
  readonly maxSendAttempts?: number
  readonly maxTextChars?: number
}

export const Config: Schema<Config> = z.object({
  agentId: z.string().required(),
  chatId: z.number().required(),
  userId: z.number().required(),
  tokenEnv: z.string().default('DSH_TELEGRAM_BOT_TOKEN'),
  apiBase: z.string().default('https://api.telegram.org'),
  pollTimeoutSeconds: z.number().step(1).min(1).max(50).default(30),
  maxSendAttempts: z.number().step(1).min(1).max(5).default(3),
  maxTextChars: z.number().step(1).min(256).max(4_096).default(4_000),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveTelegramConfig(config)
  const token = process.env[resolved.tokenEnv]
  if (token === undefined || token.length === 0) {
    throw new Error(`dsh-telegram: configured token environment variable ${resolved.tokenEnv} is empty`)
  }
  const store = await openTelegramDeliveryStore(ctx.storageDomain)
  const runtime = new TelegramRuntime(
    ctx,
    resolved,
    new TelegramApi({ token, apiBase: resolved.apiBase }),
    store,
  )
  ctx.effect(() => async () => runtime.dispose(), 'dsh-telegram runtime')
  try {
    await runtime.start()
    const route: TelegramHostRoute = Object.freeze({
      notify: (notice: TelegramHostNotice) => runtime.notifyHost(notice),
    })
    ctx.provide('evoforge.telegramRoute' as never, route as never)
  } catch (error) {
    await runtime.dispose()
    throw error
  }
}
