import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { controlSurfaceUI, type ControlSurfaceUI } from './primitives.tsx'

export interface ControlSurfaceOwnerProps {
  /** Common visual primitives owned by the Control Center shell. */
  readonly ui: ControlSurfaceUI
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Additive, Session-scoped plugin surfaces rendered inside the native Control Center view. */
    'evoforge.control.surface': {
      kind: 'list'
      scope: 'session'
      owner: ControlSurfaceOwnerProps
    }
  }
}

export type ControlSurfaceProps = PropsRuntime<'evoforge.control.surface'>

export interface ControlSurfaceTab {
  readonly id: string
  readonly label: string
}

export interface ControlSurfaceCatalog {
  list(): readonly ControlSurfaceTab[]
  subscribe(listener: () => void): () => void
  version(): number
}

export type ControlCenterViewProps = PropsRuntime<'conversation.view'>
  & PropsRenderSlots<'evoforge.control.surface'>
  & {
    readonly surfaces: ControlSurfaceCatalog
    readonly t: (key: string) => string
  }

/** One native DSH conversation view that owns layout while plugins own surface data. */
export function ControlCenterView({ renderSlot, surfaces, t }: ControlCenterViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useSyncExternalStore(surfaces.subscribe, surfaces.version, surfaces.version)
  const tabs = surfaces.list()
  const [requested, setRequested] = useState<string>()
  const active = tabs.find(tab => tab.id === requested) ?? tabs[0]
  useLayoutEffect(() => {
    rootRef.current?.scrollIntoView?.({ block: 'start' })
  }, [])

  return <div ref={rootRef} className="dsh-cc-root">
    <div className="dsh-cc-shell">
      <aside className="dsh-cc-nav" aria-label={t('nav.title')}>
        <div className="dsh-cc-brand">
          <span className="dsh-cc-brand-mark" aria-hidden="true">E</span>
          <div><span>{t('nav.eyebrow')}</span><strong>{t('nav.title')}</strong></div>
        </div>
        <p className="dsh-cc-nav-description">{t('nav.description')}</p>
        <span className="dsh-cc-nav-label">{t('nav.surfaces')}</span>
        <div className="dsh-cc-nav-items" role="tablist" aria-orientation="vertical">
          {tabs.map((tab, index) => <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active?.id}
            className={tab.id === active?.id ? 'is-active' : undefined}
            onClick={() => { setRequested(tab.id) }}
          >
            <span className="dsh-cc-nav-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span>{tab.label}</span>
          </button>)}
        </div>
        <p className="dsh-cc-authority"><span aria-hidden="true" />{t('nav.noModel')}</p>
      </aside>
      <div className="dsh-cc-stage">
        {active === undefined
          ? <div className="dsh-cc-empty-state">
            <controlSurfaceUI.Empty title={t('empty.title')} description={t('empty.description')} />
            <section className="dsh-cc-empty-guide" aria-label={t('empty.guideTitle')}>
              <div className="dsh-cc-empty-guide-head">
                <span>{t('empty.guideEyebrow')}</span>
                <strong>{t('empty.guideTitle')}</strong>
              </div>
              <div className="dsh-cc-empty-suite-grid">
                {(['core', 'channels', 'delivery', 'continuity'] as const).map(suite => (
                  <article key={suite} className="dsh-cc-empty-suite">
                    <span className="dsh-cc-empty-suite-key">{suite}</span>
                    <p>{t(`empty.suite.${suite}`)}</p>
                  </article>
                ))}
              </div>
              <p className="dsh-cc-empty-note">{t('empty.guideNote')}</p>
            </section>
          </div>
          : renderSlot('evoforge.control.surface', { ui: controlSurfaceUI }, { only: active.id })}
      </div>
    </div>
  </div>
}
