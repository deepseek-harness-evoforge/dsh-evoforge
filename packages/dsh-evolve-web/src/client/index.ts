import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-control-center/client'
import evolutionRemote from 'dsh-evolve/remote'
import { EvolutionSurface } from './EvolutionAction.tsx'
import type { EvolutionRemoteClient } from './remote.ts'
import { en, NS, zh } from './locales.ts'
import { cssText, STYLE_ID } from './style.ts'

type WebContext = Context & {
  remote: Context['remote'] & {
    $mount(contribution: unknown): Promise<() => Promise<void>>
    evoforgeEvolution: EvolutionRemoteClient
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: Context['slots'] & {
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

export const inject = ['remote', 'slots', 'locale']

/** Mount the generated Remote contribution into the native Control Center surface slot. */
export async function apply(context: Context): Promise<void> {
  const ctx = context as WebContext
  const unmountRemote = await ctx.remote.$mount(evolutionRemote)
  ctx.effect(() => unmountRemote, 'dsh-evolve-web.remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-evolve-web.locale')
  ctx.effect(() => {
    const prior = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
    if (prior !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-evolve-web'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = cssText
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-evolve-web.style')
  ctx.inject(['remote.evoforgeEvolution'], (remoteContext) => {
    const scope = remoteContext as WebContext
    scope.slots.inject('evoforge.control.surface', () => scope.slots.register({
      name: 'evoforge.control.surface',
      id: 'evoforge-evolution',
      order: 30,
      locale: NS,
      inject: () => ({ remote: scope.remote.evoforgeEvolution }),
    }, EvolutionSurface))
  })
}

export { EvolutionAction, EvolutionSurface } from './EvolutionAction.tsx'
export type { EvolutionActionProps, EvolutionSurfaceProps } from './EvolutionAction.tsx'
export type { EvolutionRemoteClient } from './remote.ts'
