import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  EvolutionFeishuBridge,
  EvolutionTelegramBridge,
  type EvolutionAttentionSource,
} from './bridge.js'
import type { FeishuHostRoute } from 'dsh-feishu'
import type { TelegramHostRoute } from 'dsh-telegram'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Host-only wakeup supplied by the existing dsh-evolve supervisor. */
    'evoforge/evolution/settled'(): void
  }
}

export const name = 'dsh-evolve-attention'
export const inject = ['evoforge.evolutionControl']

export interface Config {}

export const Config: Schema<Config> = z.object({})

export function apply(ctx: Context, _config: Config = {}): void {
  const source = ctx.get('evoforge.evolutionControl' as never) as EvolutionAttentionSource | undefined
  if (source === undefined) throw new Error('dsh-evolve-attention: evolution control is unavailable')
  ctx.inject(['evoforge.telegramRoute' as never], (routeCtx) => {
    const route = routeCtx.get('evoforge.telegramRoute' as never) as TelegramHostRoute | undefined
    if (route === undefined) return
    installBridge(routeCtx, new EvolutionTelegramBridge(
      source,
      route,
      error => ctx.logger.warn(`dsh-evolve-attention: Telegram scan failed: ${String(error)}`),
    ), 'telegram')
  })
  ctx.inject(['evoforge.feishuRoute' as never], (routeCtx) => {
    const route = routeCtx.get('evoforge.feishuRoute' as never) as FeishuHostRoute | undefined
    if (route === undefined) return
    installBridge(routeCtx, new EvolutionFeishuBridge(
      source,
      route,
      error => ctx.logger.warn(`dsh-evolve-attention: Feishu scan failed: ${String(error)}`),
    ), 'feishu')
  })
}

function installBridge(
  ctx: Context,
  bridge: { scan(): Promise<void>; dispose(): Promise<void> },
  adapter: 'telegram' | 'feishu',
): void {
  ctx.on('evoforge/evolution/settled', () => { void bridge.scan() })
  ctx.effect(() => {
    void bridge.scan()
    return () => bridge.dispose()
  }, `dsh-evolve-attention.${adapter}`)
}
