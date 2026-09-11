import type { Context } from '@deepseek-ai/cordis'

export class LifecycleDeadlineExceededError extends Error {
  override readonly name = 'LifecycleDeadlineExceededError'
}

export class LifecycleDeadlineDisposedError extends Error {
  override readonly name = 'LifecycleDeadlineDisposedError'
}

interface LifecycleDeadlineOptions {
  readonly timeoutMs: number
  readonly label: string
  readonly timeoutMessage: string
  readonly signal?: AbortSignal
  /** Synchronous cancellation hook run before a deadline rejection is queued. */
  readonly onDeadline?: () => void
}

export interface LifecycleTimerScope {
  register(
    timeoutMs: number,
    onTimeout: () => void,
    onLifecycleDispose: () => void,
  ): (() => void) | undefined
  dispose(): unknown
}

/**
 * Create one installation-time lifecycle owner for short-lived timers.
 * Registering the owner before runtime work begins keeps teardown ordering in
 * the component's control while every timer remains covered by Cordis unload.
 */
export function createLifecycleTimerScope(
  owner: Pick<Context, 'effect'>,
  label: string,
): LifecycleTimerScope {
  let accepting = true
  const registrations = new Set<(lifecycleDispose: boolean) => void>()
  const disposeEffect = owner.effect(() => () => {
    accepting = false
    for (const cancel of [...registrations]) cancel(true)
    registrations.clear()
  }, label)

  return Object.freeze({
    register(
      timeoutMs: number,
      onTimeout: () => void,
      onLifecycleDispose: () => void,
    ): (() => void) | undefined {
      if (!accepting) {
        onLifecycleDispose()
        return undefined
      }
      let registered = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = (lifecycleDispose: boolean): void => {
        if (!registered) return
        registered = false
        registrations.delete(cancel)
        if (timer !== undefined) clearTimeout(timer)
        if (lifecycleDispose) onLifecycleDispose()
      }
      registrations.add(cancel)
      timer = setTimeout(() => {
        if (!registered) return
        registered = false
        registrations.delete(cancel)
        onTimeout()
      }, timeoutMs)
      return () => cancel(false)
    },
    dispose: () => disposeEffect(),
  })
}

/**
 * Run one invocation behind a timeout owned by the caller's Cordis fiber.
 * Disposing the fiber or aborting the supplied lifecycle signal rejects the
 * race and removes both the timer and abort listener before it settles.
 */
export async function runWithLifecycleDeadline<T>(
  owner: Pick<Context, 'effect'>,
  invoke: () => T | PromiseLike<T>,
  options: LifecycleDeadlineOptions,
): Promise<T> {
  let rejectDeadline!: (reason: unknown) => void
  let deadlineSettled = false
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject
  })
  let disposeDeadline: (() => unknown) | undefined
  try {
    disposeDeadline = owner.effect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const abort = (reason: unknown): void => {
        if (deadlineSettled) return
        deadlineSettled = true
        try {
          options.onDeadline?.()
        } catch {
          // Cancellation must still settle even when a defensive hook fails.
        }
        rejectDeadline(reason)
      }
      if (options.signal?.aborted) {
        abort(new LifecycleDeadlineDisposedError(
          `${options.label} was disposed before completion`,
        ))
      } else {
        timer = setTimeout(() => {
          abort(new LifecycleDeadlineExceededError(options.timeoutMessage))
        }, options.timeoutMs)
        const abortFromSignal = (): void => {
          abort(new LifecycleDeadlineDisposedError(
            `${options.label} was disposed before completion`,
          ))
        }
        options.signal?.addEventListener('abort', abortFromSignal, { once: true })
        return () => {
          if (timer !== undefined) clearTimeout(timer)
          options.signal?.removeEventListener('abort', abortFromSignal)
          abort(new LifecycleDeadlineDisposedError(
            `${options.label} was disposed before completion`,
          ))
        }
      }
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        abort(new LifecycleDeadlineDisposedError(
          `${options.label} was disposed before completion`,
        ))
      }
    }, options.label)
  } catch (error) {
    try {
      options.onDeadline?.()
    } catch {
      // Preserve the lifecycle attachment failure as the primary error.
    }
    throw new LifecycleDeadlineDisposedError(
      `${options.label} could not attach to its Cordis lifecycle`,
      { cause: error },
    )
  }

  try {
    if (options.signal?.aborted) return await deadline
    let invocation: Promise<T>
    try {
      invocation = Promise.resolve(invoke())
    } catch (error) {
      invocation = Promise.reject(error)
    }
    // A lifecycle unload can start inside `invoke()` or in the same producer
    // turn that settles it. Guard fulfillment at its own reaction boundary so
    // the outcome whose cleanup/settlement was published first wins without
    // inserting an unconditional checkpoint that could reverse the order.
    const guardedInvocation = invocation.then(
      value => {
        if (deadlineSettled) return deadline
        deadlineSettled = true
        return value
      },
      error => {
        if (deadlineSettled) return deadline
        deadlineSettled = true
        throw error
      },
    )
    return await Promise.race([guardedInvocation, deadline])
  } finally {
    // The invocation may have won the race. Mark the deadline settled before
    // releasing its effect so ordinary cleanup cannot run onDeadline.
    deadlineSettled = true
    // This effect owns only synchronous timer/listener cleanup. Calling the
    // disposer directly avoids inserting another microtask between a proven
    // completed turn and the producer's ordered shutdown drain.
    void disposeDeadline()
  }
}
