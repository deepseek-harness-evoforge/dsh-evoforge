import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { FeishuAction, type FeishuCommandsClient } from './FeishuAction.tsx'
import { en, NS, zh } from './locales.ts'
import { cssText, STYLE_ID } from './style.ts'

type WebContext = Context & {
  remote: Context['remote'] & { commands: FeishuCommandsClient }
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

/** Additive browser half inside the original DSH Web shell. */
export function apply(context: Context): void {
  const ctx = context as WebContext
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-feishu.client.locale')
  ctx.effect(() => {
    const prior = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
    if (prior !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-feishu'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = cssText
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-feishu.client.style')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'evoforge-feishu-health',
    order: 31,
    locale: NS,
    inject: () => ({ commands: ctx.remote.commands }),
  }, FeishuAction))
}

export { FeishuAction, type FeishuActionProps, type FeishuCommandsClient } from './FeishuAction.tsx'
