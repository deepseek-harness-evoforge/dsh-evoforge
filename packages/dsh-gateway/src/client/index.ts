import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from 'dsh-control-center/client'
import gatewayRemote from 'dsh-gateway/remote'
import { GatewaySurface, type GatewayRemoteClient } from './GatewayAction.tsx'
import { en, NS, zh } from './locales.ts'

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
  ctx.inject(['remote.evoforgeGateway'], (remoteContext) => {
    const scope = remoteContext as WebContext
    scope.slots.inject('evoforge.control.surface', () => scope.slots.register({
      name: 'evoforge.control.surface',
      id: 'evoforge-gateway',
      order: 10,
      label: () => scope.locale.bind(NS)('surface.nav'),
      locale: NS,
      inject: () => ({ remote: scope.remote.evoforgeGateway }),
    }, GatewaySurface))
  })
}

export {
  GatewayAction,
  GatewaySurface,
  type GatewayActionProps,
  type GatewayRemoteClient,
  type GatewaySurfaceProps,
} from './GatewayAction.tsx'
