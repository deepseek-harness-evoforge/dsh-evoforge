import type { Context } from '@deepseek-ai/cordis'
import { EvolutionTelegramBridge, type TelegramHostRoute } from './bridge.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Suite-internal concrete route supplied by dsh-telegram. */
    'evoforge.telegramRoute': TelegramHostRoute
  }
}

export const name = 'dsh-evolve-telegram'
export const inject = ['evoforge.evolutionControl', 'evoforge.telegramRoute']

export function apply(ctx: Context): void {
  const bridge = new EvolutionTelegramBridge(
    ctx['evoforge.evolutionControl'],
    ctx['evoforge.telegramRoute'],
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
