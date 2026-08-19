import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import gatewayRemote from 'dsh-gateway/remote'
import { GatewayAction, type GatewayRemoteClient } from './GatewayAction.tsx'
import { en, NS, zh } from './locales.ts'
import { cssText, STYLE_ID } from './style.ts'

type WebContext = Context & {
  remote: Context['remote'] & {
    $mount(contribution: unknown): Promise<() => Promise<void>>
    evoforgeGateway: GatewayRemoteClient
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: Context['slots'] & {
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

export const inject = ['remote', 'slots', 'locale']

export async function apply(context: Context): Promise<void> {
  const ctx = context as WebContext
  const unmountRemote = await ctx.remote.$mount(gatewayRemote)
  ctx.effect(() => unmountRemote, 'dsh-gateway.client.remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-gateway.client.locale')
  ctx.effect(() => {
    const prior = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
    if (prior !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-gateway'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = cssText
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-gateway.client.style')
  ctx.inject(['remote.evoforgeGateway'], (remoteContext) => {
    const scope = remoteContext as WebContext
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'evoforge-gateway-health',
      order: 32,
      locale: NS,
      inject: () => ({ remote: scope.remote.evoforgeGateway }),
    }, GatewayAction))
  })
}

export { GatewayAction, type GatewayActionProps, type GatewayRemoteClient } from './GatewayAction.tsx'
