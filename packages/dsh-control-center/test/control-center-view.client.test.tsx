/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlCenterView, type ControlCenterViewProps, type ControlSurfaceCatalog } from '../src/client/ControlCenterView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ControlCenterView', () => {
  it('renders contributed DSH surfaces inside one native view and switches locally', () => {
    const catalog: ControlSurfaceCatalog = {
      list: () => [
        { id: 'gateway', label: '渠道' },
        { id: 'feishu', label: '飞书' },
      ],
      subscribe: () => () => {},
      version: () => 1,
    }
    const renderSlot = vi.fn((_name: string, _owner: unknown, options: { only?: string }) => <div>{options.only}</div>)
    const props = {
      surfaces: catalog,
      t: (key: string) => zh[key as keyof typeof zh] ?? key,
      renderSlot,
    } as unknown as ControlCenterViewProps

    render(<ControlCenterView {...props} />)
    expect(screen.getByText('gateway')).toBeTruthy()
    const gatewayTab = screen.getByRole('tab', { name: /渠道/u })
    const feishuTab = screen.getByRole('tab', { name: /飞书/u })
    expect(gatewayTab.getAttribute('aria-selected')).toBe('true')
    const panelId = gatewayTab.getAttribute('aria-controls')
    expect(panelId).toMatch(/^dsh-cc-.+-panel$/u)
    expect(gatewayTab.getAttribute('tabindex')).toBe('0')
    expect(feishuTab.getAttribute('tabindex')).toBe('-1')
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('id')).toBe(panelId)
    expect(panel.getAttribute('aria-labelledby')).toMatch(/^dsh-cc-.+-tab-0$/u)

    fireEvent.keyDown(gatewayTab, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(feishuTab)
    expect(feishuTab.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(feishuTab, { key: 'Home' })
    expect(document.activeElement).toBe(gatewayTab)
    fireEvent.click(feishuTab)
    expect(screen.getByText('feishu')).toBeTruthy()
    expect(renderSlot).toHaveBeenLastCalledWith(
      'evoforge.control.surface', expect.objectContaining({ ui: expect.any(Object) }), { only: 'feishu' },
    )
  })

  it('keeps ARIA ids isolated when two native views are mounted', () => {
    const catalog: ControlSurfaceCatalog = {
      list: () => [{ id: 'gateway', label: '渠道' }],
      subscribe: () => () => {},
      version: () => 1,
    }
    const props = {
      surfaces: catalog,
      t: (key: string) => zh[key as keyof typeof zh] ?? key,
      renderSlot: vi.fn(() => <div>surface</div>),
    } as unknown as ControlCenterViewProps

    render(<><ControlCenterView {...props} /><ControlCenterView {...props} /></>)
    const tabs = screen.getAllByRole('tab')
    const panels = screen.getAllByRole('tabpanel')
    expect(tabs).toHaveLength(2)
    expect(panels).toHaveLength(2)
    expect(new Set(tabs.map(tab => tab.id)).size).toBe(2)
    expect(new Set(panels.map(panel => panel.id)).size).toBe(2)
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panels[0]?.id)
    expect(tabs[1]?.getAttribute('aria-controls')).toBe(panels[1]?.id)
    expect(panels[0]?.getAttribute('aria-labelledby')).toBe(tabs[0]?.id)
    expect(panels[1]?.getAttribute('aria-labelledby')).toBe(tabs[1]?.id)
  })

  it('owns a stable empty state when no Adapter is installed', () => {
    const props = {
      surfaces: { list: () => [], subscribe: () => () => {}, version: () => 0 },
      t: (key: string) => zh[key as keyof typeof zh] ?? key,
      renderSlot: vi.fn(),
    } as unknown as ControlCenterViewProps
    render(<ControlCenterView {...props} />)
    expect(screen.getByText('暂无可视化插件')).toBeTruthy()
    expect(screen.getByText(/自动出现在这里/u)).toBeTruthy()
    expect(screen.getByText('按能力安装')).toBeTruthy()
    expect(screen.getByText('自进化、诊断与统一控制面')).toBeTruthy()
    expect(screen.getByText('这些是用户入口；底层 Bundle 仍可独立启停和卸载。')).toBeTruthy()
  })
})
