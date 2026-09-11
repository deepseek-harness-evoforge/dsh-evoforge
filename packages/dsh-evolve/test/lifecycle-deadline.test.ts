import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLifecycleTimerScope,
  LifecycleDeadlineDisposedError,
  LifecycleDeadlineExceededError,
  runWithLifecycleDeadline,
} from '../src/lifecycle-deadline.ts'

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

describe('Lifecycle deadline', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs cancellation synchronously before publishing a timeout', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const order: string[] = []
    try {
      const outcome = runWithLifecycleDeadline(
        ctx,
        () => new Promise<never>(() => {}),
        {
          timeoutMs: 10,
          label: 'fixture.deadline',
          timeoutMessage: 'fixture timed out',
          onDeadline: () => { order.push('cancel') },
        },
      ).then(() => undefined, error => {
        order.push('reject')
        return error
      })

      await vi.advanceTimersByTimeAsync(10)

      await expect(outcome).resolves.toBeInstanceOf(LifecycleDeadlineExceededError)
      expect(order).toEqual(['cancel', 'reject'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not run cancellation when the invocation wins the race', async () => {
    const ctx = new Context()
    const onDeadline = vi.fn()
    try {
      await expect(runWithLifecycleDeadline(ctx, async () => 'completed', {
        timeoutMs: 10,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
        onDeadline,
      })).resolves.toBe('completed')
      expect(onDeadline).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not let a synchronous success win after its signal aborts', async () => {
    const ctx = new Context()
    const controller = new AbortController()
    const onDeadline = vi.fn()
    try {
      await expect(runWithLifecycleDeadline(ctx, () => {
        controller.abort()
        return 'success-after-abort'
      }, {
        timeoutMs: 10,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
        signal: controller.signal,
        onDeadline,
      })).rejects.toBeInstanceOf(LifecycleDeadlineDisposedError)
      expect(onDeadline).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('observes an invocation that loses to a synchronous signal abort', async () => {
    const ctx = new Context()
    const controller = new AbortController()
    const invocation = new Promise<string>(() => {})
    const then = vi.spyOn(invocation, 'then')
    try {
      await expect(runWithLifecycleDeadline(ctx, () => {
        controller.abort()
        return invocation
      }, {
        timeoutMs: 10,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
        signal: controller.signal,
      })).rejects.toBeInstanceOf(LifecycleDeadlineDisposedError)
      expect(then).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('prioritizes lifecycle disposal started inside a synchronous invocation', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    let disposal: Promise<void> | undefined
    try {
      await expect(runWithLifecycleDeadline(owner.ctx, () => {
        disposal = owner.dispose()
        return 'success-after-dispose-start'
      }, {
        timeoutMs: 1_000,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
      })).rejects.toBeInstanceOf(LifecycleDeadlineDisposedError)
      await disposal
    } finally {
      await disposal
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('prioritizes lifecycle disposal published before a pending invocation fulfills', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    let fulfill!: (value: string) => void
    const invocation = new Promise<string>((resolve) => { fulfill = resolve })
    try {
      const outcome = runWithLifecycleDeadline(owner.ctx, () => invocation, {
        timeoutMs: 1_000,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
      })
      const disposal = owner.dispose()
      fulfill('success-after-dispose-start')

      await expect(outcome).rejects.toBeInstanceOf(LifecycleDeadlineDisposedError)
      await disposal
    } finally {
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('preserves invocation fulfillment published before lifecycle disposal', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    let fulfill!: (value: string) => void
    const invocation = new Promise<string>((resolve) => { fulfill = resolve })
    const onDeadline = vi.fn()
    try {
      const outcome = runWithLifecycleDeadline(owner.ctx, () => invocation, {
        timeoutMs: 1_000,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
        onDeadline,
      })
      fulfill('success-before-dispose')
      const disposal = owner.dispose()

      await expect(outcome).resolves.toBe('success-before-dispose')
      await disposal
      expect(onDeadline).not.toHaveBeenCalled()
    } finally {
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('prioritizes lifecycle disposal published before a pending invocation rejects', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    let reject!: (reason: unknown) => void
    const invocation = new Promise<never>((_resolve, fail) => { reject = fail })
    try {
      const outcome = runWithLifecycleDeadline(owner.ctx, () => invocation, {
        timeoutMs: 1_000,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
      })
      const disposal = owner.dispose()
      reject(new Error('private rejection after dispose'))

      await expect(outcome).rejects.toBeInstanceOf(LifecycleDeadlineDisposedError)
      await disposal
    } finally {
      await owner.dispose()
      await root.fiber.dispose()
    }
  })

  it('preserves invocation rejection published before lifecycle disposal', async () => {
    const root = new Context()
    const owner = await root.plugin(() => {})
    const failure = new Error('invocation failed first')
    let reject!: (reason: unknown) => void
    const invocation = new Promise<never>((_resolve, fail) => { reject = fail })
    const onDeadline = vi.fn()
    try {
      const outcome = runWithLifecycleDeadline(owner.ctx, () => invocation, {
        timeoutMs: 1_000,
        label: 'fixture.deadline',
        timeoutMessage: 'fixture timed out',
        onDeadline,
      })
      reject(failure)
      const disposal = owner.dispose()

      await expect(outcome).rejects.toBe(failure)
      await disposal
      expect(onDeadline).not.toHaveBeenCalled()
    } finally {
      await owner.dispose()
      await root.fiber.dispose()
    }
  })
})
