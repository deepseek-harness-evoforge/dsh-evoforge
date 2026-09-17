/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlCenterView, type ControlCenterViewProps } from '../src/client/ControlCenterView.tsx'
import { createControlCenterViewStore } from '../src/client/view-store.ts'
import { zh } from '../src/client/locales.ts'

const tabs = [{ id: 'doctor', label: '运行诊断' }, { id: 'gateway', label: '渠道' }]
const key = 'evoforge.control-center.view.session-a'

function props(sessionId = 'session-a', available = tabs): ControlCenterViewProps {
  const instance = createControlCenterViewStore().create(sessionId)
  return {
    surfaces: { list: () => available, subscribe: () => () => {}, version: () => 0 },
    t: (name: string) => zh[name as keyof typeof zh] ?? name,
    renderSlot: vi.fn((_name, _owner, options) => <div>{options.only}</div>),
    useStore(selector) {
      return selector(useSyncExternalStore(instance.subscribe, instance.getSnapshot, instance.getSnapshot))
    },
    actions: instance.actions,
  } as ControlCenterViewProps
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('native Control Center view preference', () => {
  it('rehydrates after a fresh store and component mount, and isolates another Session', () => {
    const mounted = render(<ControlCenterView {...props()} />)
    fireEvent.click(screen.getByRole('tab', { name: /渠道/u }))
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ requested: 'gateway' })
    mounted.unmount()
    const restored = render(<ControlCenterView {...props()} />)
    expect(screen.getByRole('tab', { name: /渠道/u }).getAttribute('aria-selected')).toBe('true')
    restored.rerender(<ControlCenterView {...props('session-b')} />)
    expect(screen.getByRole('tab', { name: /运行诊断/u }).getAttribute('aria-selected')).toBe('true')
    expect(localStorage.getItem('evoforge.control-center.view.session-b')).toBeNull()
    restored.rerender(<ControlCenterView {...props()} />)
    expect(screen.getByRole('tab', { name: /渠道/u }).getAttribute('aria-selected')).toBe('true')
  })

  it('falls back while a saved contribution is missing without overwriting its preference', () => {
    localStorage.setItem(key, JSON.stringify({ requested: 'gateway' }))
    const mounted = render(<ControlCenterView {...props('session-a', [])} />)
    expect(screen.getByText('暂无可视化插件')).toBeTruthy()
    mounted.rerender(<ControlCenterView {...props('session-a', tabs.slice(0, 1))} />)
    expect(screen.getByRole('tab', { name: /运行诊断/u }).getAttribute('aria-selected')).toBe('true')
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ requested: 'gateway' })
    mounted.rerender(<ControlCenterView {...props()} />)
    expect(screen.getByRole('tab', { name: /渠道/u }).getAttribute('aria-selected')).toBe('true')
  })

  it.each(['null', '42', '[]', '{"requested":true}', '{"other":"field"}', 'invalid-json'])(
    'recovers unusable preference %s without blocking navigation', raw => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      localStorage.setItem(key, raw)
      render(<ControlCenterView {...props()} />)
      expect(screen.getByRole('tab', { name: /运行诊断/u }).getAttribute('aria-selected')).toBe('true')
      fireEvent.click(screen.getByRole('tab', { name: /渠道/u }))
      expect(screen.getByRole('tab', { name: /渠道/u }).getAttribute('aria-selected')).toBe('true')
      expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ requested: 'gateway' })
    },
  )

  it('keeps navigation usable when browser storage rejects reads and writes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    render(<ControlCenterView {...props()} />)
    fireEvent.keyDown(screen.getByRole('tab', { name: /运行诊断/u }), { key: 'End' })
    expect(screen.getByRole('tab', { name: /渠道/u }).getAttribute('aria-selected')).toBe('true')
  })

  it('lets the native scope owner clear only this Session preference', () => {
    const handle = createControlCenterViewStore()
    const a = handle.create('session-a')
    const b = handle.create('session-b')
    a.actions.selectSurface('gateway')
    b.actions.selectSurface('doctor')
    a.clearPersisted()
    expect(localStorage.getItem(key)).toBeNull()
    expect(JSON.parse(localStorage.getItem('evoforge.control-center.view.session-b')!)).toEqual({ requested: 'doctor' })
  })
})
