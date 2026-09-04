import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from 'dsh-control-center/client'
import { FeishuSurface, type FeishuCommandsClient, type FeishuCredentialReferencesClient, type FeishuCredentialsClient } from './FeishuAction.tsx'
import { en, NS, zh } from './locales.ts'
import feishuRemote from 'dsh-evoforge-feishu/remote'

type WebContext = Context & {
  remote: Context['remote'] & {
    $mount(contribution: unknown): Promise<() => Promise<void>>
    commands: FeishuCommandsClient
    credentials: FeishuCredentialsClient
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  inject(requirements: readonly string[], callback: (context: Context) => unknown): void
}

export const inject = ['remote', 'remote.commands', 'remote.credentials', 'slots', 'locale']

/** Additive browser half inside the original DSH Web shell. */
export async function apply(context: Context): Promise<void> {
  const ctx = context as WebContext
  const unmountRemote = await ctx.remote.$mount(feishuRemote)
  ctx.effect(() => unmountRemote, 'dsh-feishu.client.remote')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-feishu.client.locale')
  ctx.inject(['remote.evoforgeFeishu'], (remoteContext) => {
    const scope = remoteContext as WebContext & {
      remote: WebContext['remote'] & { evoforgeFeishu: FeishuCredentialReferencesClient }
    }
    scope.slots.inject('evoforge.control.surface', () => scope.slots.register({
      name: 'evoforge.control.surface',
      id: 'evoforge-feishu',
      order: 20,
      label: () => scope.locale.bind(NS)('surface.nav'),
      locale: NS,
      inject: () => ({
        commands: scope.remote.commands,
        credentials: scope.remote.credentials,
        credentialReferences: scope.remote.evoforgeFeishu,
      }),
    }, FeishuSurface))
  })
}

export {
  FeishuAction,
  FeishuSurface,
  type FeishuActionProps,
  type FeishuCommandsClient,
  type FeishuCredentialReferencesClient,
  type FeishuCredentialsClient,
  type FeishuSurfaceProps,
} from './FeishuAction.tsx'
