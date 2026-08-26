import type { ComponentType, ReactNode } from 'react'

export type ControlTone = 'healthy' | 'working' | 'attention' | 'danger' | 'neutral'

export interface SurfaceProps {
  readonly children: ReactNode
  readonly ariaLabel: string
}

export interface SurfaceHeaderProps {
  readonly eyebrow?: string
  readonly title: string
  readonly description: string
  readonly status?: ReactNode
  readonly actions?: ReactNode
}

export interface StatusBadgeProps {
  readonly tone: ControlTone
  readonly children: ReactNode
}

export interface MetricItem {
  readonly label: string
  readonly value: ReactNode
  readonly hint?: string
  readonly tone?: ControlTone
}

export interface MetricStripProps {
  readonly items: readonly MetricItem[]
}

export interface SectionCardProps {
  readonly title: string
  readonly description?: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}

export interface EntityRowProps {
  readonly icon?: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly status?: ReactNode
  readonly actions?: ReactNode
  readonly details?: ReactNode
}

export interface InlineNoticeProps {
  readonly tone?: ControlTone
  readonly title?: string
  readonly children: ReactNode
  readonly role?: 'status' | 'alert'
}

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly tone?: 'primary' | 'quiet' | 'danger'
}

export interface EmptyStateProps {
  readonly title: string
  readonly description: string
}

export interface LoadingSkeletonProps {
  readonly cards?: number
}

export interface ControlSurfaceUI {
  readonly Surface: ComponentType<SurfaceProps>
  readonly Header: ComponentType<SurfaceHeaderProps>
  readonly Status: ComponentType<StatusBadgeProps>
  readonly Metrics: ComponentType<MetricStripProps>
  readonly Section: ComponentType<SectionCardProps>
  readonly Entity: ComponentType<EntityRowProps>
  readonly Notice: ComponentType<InlineNoticeProps>
  readonly Button: ComponentType<ActionButtonProps>
  readonly Empty: ComponentType<EmptyStateProps>
  readonly Loading: ComponentType<LoadingSkeletonProps>
}

function Surface({ children, ariaLabel }: SurfaceProps) {
  return <main className="dsh-cc-surface" aria-label={ariaLabel}>{children}</main>
}

function Header({ eyebrow, title, description, status, actions }: SurfaceHeaderProps) {
  return <header className="dsh-cc-surface-head">
    <div className="dsh-cc-surface-copy">
      {eyebrow !== undefined && <span className="dsh-cc-eyebrow">{eyebrow}</span>}
      <div className="dsh-cc-title-line"><h2>{title}</h2>{status}</div>
      <p>{description}</p>
    </div>
    {actions !== undefined && <div className="dsh-cc-head-actions">{actions}</div>}
  </header>
}

function Status({ tone, children }: StatusBadgeProps) {
  return <span className={`dsh-cc-status is-${tone}`}><span aria-hidden="true" />{children}</span>
}

function Metrics({ items }: MetricStripProps) {
  return <dl className="dsh-cc-metrics">{items.map((item, index) => <div key={`${item.label}-${index}`} className={item.tone === undefined ? undefined : `is-${item.tone}`}>
    <dt>{item.label}</dt><dd>{item.value}</dd>{item.hint !== undefined && <small>{item.hint}</small>}
  </div>)}</dl>
}

function Section({ title, description, actions, children }: SectionCardProps) {
  return <section className="dsh-cc-card">
    <header className="dsh-cc-card-head"><div><h3>{title}</h3>{description !== undefined && <p>{description}</p>}</div>{actions}</header>
    <div className="dsh-cc-card-body">{children}</div>
  </section>
}

function Entity({ icon, title, description, status, actions, details }: EntityRowProps) {
  return <article className="dsh-cc-entity">
    {icon !== undefined && <span className="dsh-cc-entity-icon" aria-hidden="true">{icon}</span>}
    <div className="dsh-cc-entity-copy"><strong>{title}</strong>{description !== undefined && <span>{description}</span>}{details}</div>
    {status !== undefined && <div className="dsh-cc-entity-status">{status}</div>}
    {actions !== undefined && <div className="dsh-cc-entity-actions">{actions}</div>}
  </article>
}

function Notice({ tone = 'neutral', title, children, role = 'status' }: InlineNoticeProps) {
  return <div className={`dsh-cc-notice is-${tone}`} role={role}>{title !== undefined && <strong>{title}</strong>}<span>{children}</span></div>
}

function Button({ tone = 'quiet', className, ...props }: ActionButtonProps) {
  return <button {...props} className={`dsh-cc-button is-${tone}${className === undefined ? '' : ` ${className}`}`} />
}

function Empty({ title, description }: EmptyStateProps) {
  return <div className="dsh-cc-empty"><span aria-hidden="true">◇</span><h2>{title}</h2><p>{description}</p></div>
}

function Loading({ cards = 3 }: LoadingSkeletonProps) {
  return <div className="dsh-cc-loading" role="status" aria-label="Loading">
    <div className="dsh-cc-skeleton is-head" />
    <div className="dsh-cc-skeleton-grid">{Array.from({ length: cards }, (_, index) => <div key={index} className="dsh-cc-skeleton" />)}</div>
  </div>
}

export const controlSurfaceUI: ControlSurfaceUI = Object.freeze({
  Surface,
  Header,
  Status,
  Metrics,
  Section,
  Entity,
  Notice,
  Button,
  Empty,
  Loading,
})
