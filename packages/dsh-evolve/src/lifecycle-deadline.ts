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
      const abort = (): void => {
        if (deadlineSettled) return
        deadlineSettled = true
        rejectDeadline(new LifecycleDeadlineDisposedError(
          `${options.label} was disposed before completion`,
        ))
      }
      if (options.signal?.aborted) {
        abort()
      } else {
        timer = setTimeout(() => {
          if (deadlineSettled) return
          deadlineSettled = true
          rejectDeadline(new LifecycleDeadlineExceededError(options.timeoutMessage))
        }, options.timeoutMs)
        options.signal?.addEventListener('abort', abort, { once: true })
      }
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        abort()
      }
    }, options.label)
  } catch (error) {
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
    return await Promise.race([invocation, deadline])
  } finally {
    // This effect owns only synchronous timer/listener cleanup. Calling the
    // disposer directly avoids inserting another microtask between a proven
    // completed turn and the producer's ordered shutdown drain.
    void disposeDeadline()
  }
}
