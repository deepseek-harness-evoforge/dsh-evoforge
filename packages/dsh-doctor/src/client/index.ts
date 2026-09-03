import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-control-center/client'
import { DoctorSurface } from './DoctorAction.tsx'
import { en, NS, zh } from './locales.ts'
import type { DoctorCommandsClient } from './types.ts'

type WebContext = Context & {
  remote: Context['remote'] & { commands: DoctorCommandsClient }
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

export function apply(context: Context): void {
  const ctx = context as WebContext
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-doctor.client.locale')
  ctx.slots.inject('evoforge.control.surface', () => ctx.slots.register({
    name: 'evoforge.control.surface',
    id: 'evoforge-doctor',
    order: 5,
    label: () => ctx.locale.bind(NS)('surface.nav'),
    locale: NS,
    inject: () => ({ commands: ctx.remote.commands }),
  }, DoctorSurface))
}

export { DoctorSurface } from './DoctorAction.tsx'
export type { DoctorSurfaceProps, DoctorReport, DoctorCheck } from './DoctorAction.tsx'
export type { DoctorCommandsClient } from './types.ts'
