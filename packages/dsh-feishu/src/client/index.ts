import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from 'dsh-control-center/client'
import { FeishuSurface, type FeishuCommandsClient } from './FeishuAction.tsx'
import { en, NS, zh } from './locales.ts'

type WebContext = Context & {
  remote: Context['remote'] & { commands: FeishuCommandsClient }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

export const inject = ['remote', 'remote.commands', 'slots', 'locale']

/** Additive browser half inside the original DSH Web shell. */
export function apply(context: Context): void {
  const ctx = context as WebContext
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-feishu.client.locale')
  ctx.slots.inject('evoforge.control.surface', () => ctx.slots.register({
    name: 'evoforge.control.surface',
    id: 'evoforge-feishu',
    order: 20,
    label: () => ctx.locale.bind(NS)('surface.nav'),
    locale: NS,
    inject: () => ({ commands: ctx.remote.commands }),
  }, FeishuSurface))
}

export {
  FeishuAction,
  FeishuSurface,
  type FeishuActionProps,
  type FeishuCommandsClient,
  type FeishuSurfaceProps,
} from './FeishuAction.tsx'
