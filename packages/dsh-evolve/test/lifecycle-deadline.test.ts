import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLifecycleTimerScope } from '../src/lifecycle-deadline.ts'

describe('Lifecycle timer scope', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('releases each completed timer while retaining its installation owner', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const onTimeout = vi.fn()
    const onLifecycleDispose = vi.fn()
    const scope = createLifecycleTimerScope(ctx, 'fixture.timerScope')

    try {
      const release = scope.register(10, onTimeout, onLifecycleDispose)
      expect(release).toBeTypeOf('function')
      expect(vi.getTimerCount()).toBe(1)
      expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain('fixture.timerScope')

      await vi.advanceTimersByTimeAsync(10)

      expect(onTimeout).toHaveBeenCalledOnce()
      expect(onLifecycleDispose).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(ctx.fiber.getEffects().map(effect => effect.label)).toContain('fixture.timerScope')

      const releaseSettled = scope.register(10, onTimeout, onLifecycleDispose)
      expect(vi.getTimerCount()).toBe(1)
      releaseSettled?.()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(10)
      expect(onTimeout).toHaveBeenCalledOnce()
      expect(onLifecycleDispose).not.toHaveBeenCalled()

      await scope.dispose()
      expect(ctx.fiber.getEffects().map(effect => effect.label)).not.toContain('fixture.timerScope')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels an active timer when its lifecycle owner unloads', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const onTimeout = vi.fn()
    const onLifecycleDispose = vi.fn()
    const scope = createLifecycleTimerScope(ctx, 'fixture.timerScope')

    try {
      expect(scope.register(10, onTimeout, onLifecycleDispose)).toBeTypeOf('function')
      expect(vi.getTimerCount()).toBe(1)

      await ctx.fiber.dispose()

      expect(onTimeout).not.toHaveBeenCalled()
      expect(onLifecycleDispose).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      expect(scope.register(10, onTimeout, onLifecycleDispose)).toBeUndefined()
      expect(onLifecycleDispose).toHaveBeenCalledTimes(2)
    } finally {
      await scope.dispose()
      await ctx.fiber.dispose()
    }
  })
})
