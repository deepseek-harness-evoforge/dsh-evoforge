import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-control-center/client'
import { TelegramSurface } from './TelegramAction.tsx'
import { en, NS, zh } from './locales.ts'
import type { TelegramCommandsClient } from './types.ts'

type WebContext = Context & {
  remote: Context['remote'] & { commands: TelegramCommandsClient }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: Context['slots'] & {
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

export const inject = ['remote', 'remote.commands', 'slots', 'locale']

export function apply(context: Context): void {
  const ctx = context as WebContext
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-telegram.client.locale')
  ctx.slots.inject('evoforge.control.surface', () => ctx.slots.register({
    name: 'evoforge.control.surface',
    id: 'evoforge-telegram',
    order: 25,
    label: () => ctx.locale.bind(NS)('surface.nav'),
    locale: NS,
    inject: () => ({ commands: ctx.remote.commands }),
  }, TelegramSurface))
}

export { TelegramSurface } from './TelegramAction.tsx'
export type { TelegramSurfaceProps, TelegramHealthSnapshot } from './TelegramAction.tsx'
export type { TelegramCommandsClient } from './types.ts'
