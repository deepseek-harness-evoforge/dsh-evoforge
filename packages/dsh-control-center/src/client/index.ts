import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ControlCenterView, type ControlCenterViewProps, type ControlSurfaceCatalog, type ControlSurfaceTab } from './ControlCenterView.tsx'
import { en, NS, zh } from './locales.ts'
import { cssText, STYLE_ID } from './style.ts'

interface StoredSurfaceEntry {
  readonly options: { readonly id?: string; readonly label?: string | (() => string) }
}

type WebContext = Context & {
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: {
    entries(name: string): readonly StoredSurfaceEntry[]
    subscribe(name: string, listener: () => void): () => void
    getVersion(name: string): number
    inject(name: string, install: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

export const inject = ['slots', 'locale']

/** Compose the native DSH view and declare the one additive plugin-surface seam. */
export function apply(context: Context): void {
  const ctx = context as WebContext
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-control-center.client.locale')
  ctx.effect(() => {
    const prior = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
    if (prior !== null) return () => {}
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-control-center'
    style.dataset.pluginCss = STYLE_ID
    style.textContent = cssText
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-control-center.client.style')

  const surfaces: ControlSurfaceCatalog = {
    list: (): readonly ControlSurfaceTab[] => ctx.slots.entries('evoforge.control.surface').flatMap((entry) => {
      const id = entry.options.id
      if (id === undefined) return []
      const label = typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label
      return [{ id, label: label ?? id }]
    }),
    subscribe: listener => ctx.slots.subscribe('evoforge.control.surface', listener),
    version: () => ctx.slots.getVersion('evoforge.control.surface'),
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'evoforge-control-center',
    order: 30,
    label: () => t('view.label'),
    locale: NS,
    children: {
      'evoforge.control.surface': { kind: 'list', scope: 'session' },
    },
    inject: (): Pick<ControlCenterViewProps, 'surfaces' | 't'> => ({ surfaces, t }),
  }, ControlCenterView))
}

export { ControlCenterView } from './ControlCenterView.tsx'
export { controlSurfaceUI } from './primitives.tsx'
export type {
  ControlCenterViewProps,
  ControlSurfaceCatalog,
  ControlSurfaceOwnerProps,
  ControlSurfaceProps,
  ControlSurfaceTab,
} from './ControlCenterView.tsx'
export type {
  ActionButtonProps,
  ControlSurfaceUI,
  ControlTone,
  EmptyStateProps,
  EntityRowProps,
  InlineNoticeProps,
  LoadingSkeletonProps,
  MetricItem,
  MetricStripProps,
  SectionCardProps,
  StatusBadgeProps,
  SurfaceHeaderProps,
  SurfaceProps,
} from './primitives.tsx'
