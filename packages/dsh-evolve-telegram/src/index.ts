import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  EvolutionTelegramBridge,
  type EvolutionAttentionSource,
} from './bridge.js'
import type { TelegramHostRoute } from 'dsh-telegram'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Host-only wakeup supplied by the existing dsh-evolve supervisor. */
    'evoforge/evolution/settled'(): void
  }
}

export const name = 'dsh-evolve-telegram'
export const inject = ['evoforge.evolutionControl', 'evoforge.telegramRoute']

export interface Config {}

export const Config: Schema<Config> = z.object({})

export function apply(ctx: Context, _config: Config = {}): void {
  const source = ctx.get('evoforge.evolutionControl' as never) as EvolutionAttentionSource | undefined
  const route = ctx.get('evoforge.telegramRoute' as never) as TelegramHostRoute | undefined
  if (source === undefined || route === undefined) {
    throw new Error('dsh-evolve-telegram: required concrete services are unavailable')
  }
  const bridge = new EvolutionTelegramBridge(
    source,
    route,
    error => ctx.logger.warn(`dsh-evolve-telegram: attention scan failed: ${String(error)}`),
  )
  ctx.on('evoforge/evolution/settled', () => {
    void bridge.scan()
  })
  ctx.effect(() => {
    void bridge.scan()
    return () => bridge.dispose()
  }, 'dsh-evolve-telegram.bridge')
}
