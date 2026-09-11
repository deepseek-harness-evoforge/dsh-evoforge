import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import {
  installFeedbackSignalMonitor,
  type FeedbackSignalStore,
} from '../src/feedback-signal-monitor.ts'
import type { DurableFeedbackStoredSession } from '../src/durable-feedback-attribution.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('current feedback signal projection', () => {
  it('waits for live reconciliation and publishes only the physically returned feedback prefix', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const pending = deferred<ReturnType<typeof reconciled>>()
    const reconcile = vi.fn(async () => reconciled([]))
    const recover = vi.fn(() => pending.promise)
    const resolve = vi.fn(async () => undefined)
    const resolveStored = vi.fn(() => ({
      kind: 'exact-skill-invocation-v1' as const,
      skillName: 'release-dsh-plugin',
      route: 'user-explicit' as const,
      invocationSeq: 2,
      invocationContentHash: 'a'.repeat(64),
      assistantSeq: 3,
      turn: 1,
      goal: { id: 'goal-1', revision: 1 },
    }))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => ({ id: 'b'.repeat(64) }),
    } as never, {
      now: () => 42,
      attribution: { resolve, resolveStored },
      currentSession: { reconcile, recover },
    })
    const trigger = putEvent(4, 'negative', 'please fix this')
    const session = liveSession(trigger)

    ctx.emit('session/event', session, trigger)
    await Promise.resolve()

    expect(reconcile).not.toHaveBeenCalled()
    expect(recover).toHaveBeenCalledWith('session-current')
    expect(signals.replaceSession).not.toHaveBeenCalled()
    pending.resolve(reconciled([trigger]))
    await monitor.flush()

    expect(signals.replaceSession).toHaveBeenCalledWith({
      observedAt: 42,
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-current',
      generationId: 'b'.repeat(64),
      items: [{
        id: expect.stringMatching(/^[a-f0-9]{64}$/u),
        messageId: 'assistant-1',
        feedbackVersion: '11111111-1111-4111-8111-111111111111',
        sourceUpdatedAt: 11,
        attribution: expect.objectContaining({ skillName: 'release-dsh-plugin' }),
      }],
    })
    expect(resolveStored).toHaveBeenCalledWith(
      expect.objectContaining({ fromSeq: 0 }),
      'session-current',
      'assistant-1',
    )
    expect(resolve).not.toHaveBeenCalled()
    await monitor.dispose()
  })

  it('clones a borrowed cold committed prefix before enqueueing its projection', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const trigger = putEvent(4, 'negative', 'original private note')
    const durable = structuredClone(trigger)
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      now: () => 51,
      currentSession: {
        reconcile: async () => reconciled([durable]),
      },
    })
    const inspection = {
      meta: storedSession([]).meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [trigger],
    }

    ctx.emit('feedback/committed', inspection)
    ;(inspection.events[0]!.data as { item: { note: string } }).item.note = 'mutated after callback'
    inspection.events.splice(0)
    await monitor.flush()

    expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
      observedAt: 51,
      sessionId: 'session-current',
      items: [expect.objectContaining({
        feedbackVersion: '11111111-1111-4111-8111-111111111111',
      })],
    }))
    await monitor.dispose()
  })

  it('retracts the whole current projection when the committed mutation deletes its last item', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const changed = vi.fn()
    const put = putEvent(4, 'negative', 'fix it')
    const deleted = {
      type: 'feedback/message-delete',
      seq: SessionSeq(5),
      time: 12,
      data: { sessionId: 'session-current', messageId: 'assistant-1' },
    }
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      onSignalsChanged: changed,
      currentSession: {
        reconcile: async () => reconciled([put, deleted], []),
      },
    })

    ctx.emit('feedback/committed', {
      meta: storedSession([]).meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [put, deleted],
    })
    await monitor.flush()

    expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-current',
      items: [],
    }))
    expect(changed).toHaveBeenCalledWith(WORKSPACE_ID)
    await monitor.dispose()
  })

  it('does not let an older cold projection erase a newer pending live trigger', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const coldProjection = deferred<void>()
    signals.replaceSession.mockImplementationOnce(() => coldProjection.promise)
    const live = putEvent(5, 'negative', 'newer live correction')
    const cold = putEvent(4, 'negative', 'older cold correction')
    const reconcile = vi.fn(async () => reconciled([cold]))
    const recover = vi.fn()
      .mockResolvedValueOnce(reconciled([cold]))
      .mockResolvedValueOnce(reconciled([live]))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      currentSession: { reconcile, recover },
    })

    ctx.emit('feedback/committed', {
      meta: storedSession([]).meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [cold],
    })
    await vi.waitFor(() => expect(signals.replaceSession).toHaveBeenCalledOnce())
    ctx.emit('session/event', liveSession(live), live)
    coldProjection.resolve()
    await monitor.flush()

    expect(recover).toHaveBeenCalledWith('session-current')
    expect(signals.replaceSession).toHaveBeenCalledTimes(2)
    await monitor.dispose()
  })

  it('treats a global committed event only as a trigger and rejects a forged physical prefix', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const forged = putEvent(4, 'negative', 'forged global event')
    const reconcile = vi.fn(async () => reconciled([], [feedbackItem(forged)]))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: { reconcile } })

    ctx.emit('feedback/committed', {
      meta: storedSession([]).meta,
      inheritedEventCount: SessionLogOffset(0),
      events: [forged],
    })
    await monitor.flush()

    expect(reconcile).toHaveBeenCalledWith('session-current')
    expect(signals.replaceSession).not.toHaveBeenCalled()
    await monitor.dispose()
  })

  it('ignores a forged live feedback notification that is not the Session event object', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const reconcile = vi.fn(async () => reconciled([]))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: { reconcile } })
    const canonical = putEvent(4, 'negative', 'canonical')
    const forged = structuredClone(canonical)

    ctx.emit('session/event', liveSession(canonical), forged)
    await monitor.flush()

    expect(reconcile).not.toHaveBeenCalled()
    expect(signals.replaceSession).not.toHaveBeenCalled()
    await monitor.dispose()
  })

  it('fails closed when live reconciliation omits the exact triggering event', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const trigger = putEvent(4, 'negative', 'must be durable')
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      currentSession: { reconcile: async () => reconciled([], [feedbackItem(trigger)]) },
    })

    const session = liveSession(trigger)
    ctx.emit('session/event', session, trigger)
    await monitor.flush()

    expect(signals.replaceSession).not.toHaveBeenCalled()
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('skipped one feedback signal update'))
    await monitor.dispose()
  })

  it('retries a retained live trigger after physical reconciliation fails', async () => {
    vi.useFakeTimers()
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const trigger = putEvent(4, 'negative', 'retry after durability')
    const reconcile = vi.fn()
      .mockResolvedValueOnce(reconciled([], [feedbackItem(trigger)]))
      .mockResolvedValueOnce(reconciled([trigger]))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: { reconcile } })
    const session = liveSession(trigger)

    try {
      ctx.emit('session/event', session, trigger)
      await monitor.flush()
      expect(signals.replaceSession).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1_000)
      await monitor.flush()
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-current',
        items: [expect.objectContaining({ messageId: 'assistant-1' })],
      }))
      await monitor.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('replays durable current feedback during activation without a live notification', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const trigger = putEvent(4, 'negative', 'recover after restart')
    const reconcile = vi.fn(async () => reconciled([trigger]))
    const listSessionIds = vi.fn(async () => ['session-current'])
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: { reconcile, listSessionIds } })

    await monitor.reconcileCurrent()

    expect(listSessionIds).toHaveBeenCalledOnce()
    expect(reconcile).toHaveBeenCalledWith('session-current')
    expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-current',
      items: [expect.objectContaining({ messageId: 'assistant-1' })],
    }))
    await monitor.dispose()
  })

  it('replays an alpha.5 sidecar row against its matching physical Session identity', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const item = feedbackItem(putEvent(4, 'negative', 'recover alpha sidecar'))
    const sourceRow = {
      session: { createdAt: 1, cwd: '/private/project' },
      items: [item],
    }
    const recover = vi.fn(async () => ({
      dialect: 'alpha5' as const,
      stored: storedSession([]),
      listedItems: structuredClone(sourceRow.items),
      sourceRow: structuredClone(sourceRow),
    }))
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      currentSession: {
        reconcile: recover,
        recover,
        listSessionIds: async () => ['session-current'],
      },
    })

    await monitor.reconcileCurrent()

    expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-current',
      items: [expect.objectContaining({ messageId: 'assistant-1' })],
    }))
    await monitor.dispose()
  })

  it('does not register as a Session durability participant', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never)

    expect(ctx.listenerCount('session/flush')).toBe(0)
    await monitor.dispose()
  })

  it('keeps recovery failure observable and retries only the failed Session', async () => {
    vi.useFakeTimers()
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const ready = vi.fn()
    const attempts = new Map<string, number>()
    const recover = vi.fn(async (id: string) => {
      const count = (attempts.get(id) ?? 0) + 1
      attempts.set(id, count)
      if (id === 'failed' && count === 1) throw new Error('temporary physical read failure')
      return reconciled([])
    })
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      currentSession: { reconcile: recover, listSessionIds: async () => ['healthy', 'failed'] },
      onRecoveryReady: ready,
    })
    try {
      await expect(monitor.reconcileCurrent()).rejects.toThrow('recovery pass was incomplete')
      expect(ready).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      await monitor.flush()
      expect(attempts.get('healthy')).toBe(1)
      expect(attempts.get('failed')).toBe(2)
      expect(ready).toHaveBeenCalledOnce()
      await monitor.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('processes a live notification before the next catalog Session and drops its superseded scan', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const old = putEvent(4, 'negative', 'old scan')
    const live = putEvent(5, 'negative', 'new live correction')
    const scan = deferred<ReturnType<typeof reconciled>>()
    const calls: string[] = []
    const reconcile = vi.fn(async (id: string) => {
      calls.push(id)
      if (calls.length === 1) return scan.promise
      return id === 'session-current' ? reconciled([old, live]) : reconciled([])
    })
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: {
      reconcile,
      listSessionIds: async () => ['session-current', 'second-catalog-session'],
    } })
    const recovering = monitor.reconcileCurrent()
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    ctx.emit('session/event', liveSession(live), live)
    scan.resolve(reconciled([old]))
    await recovering
    await monitor.flush()
    expect(calls).toEqual(['session-current', 'session-current', 'second-catalog-session'])
    expect(signals.replaceSession).toHaveBeenCalledOnce()
    await monitor.dispose()
  })

  it('accepts upstream Session and Message identifiers beyond old projection limits', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const sessionId = 's'.repeat(257)
    const messageId = 'm'.repeat(513)
    const trigger = putEvent(4, 'negative', 'long native identifiers')
    trigger.data.sessionId = sessionId
    trigger.data.item.messageId = messageId
    const cut = reconciled([trigger])
    const stored = { ...cut.stored, meta: { ...cut.stored.meta, id: SessionId(sessionId) } }
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      currentSession: {
        reconcile: async () => ({ ...cut, stored }),
        listSessionIds: async () => [sessionId],
      },
    })
    await monitor.reconcileCurrent()
    expect(signals.replaceSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      items: [expect.objectContaining({ messageId })],
    }))
    await monitor.dispose()
  })

  it('does not project a newer unflushed live mutation through an older cold trigger', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const cold = putEvent(4, 'positive')
    const live = putEvent(5, 'negative', 'not durable yet')
    const reconcile = vi.fn(async () => reconciled([cold, live]))
    const recover = vi.fn(async () => { throw new Error('live flush failed') })
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, { currentSession: { reconcile, recover } })
    ctx.emit('feedback/committed', {
      meta: storedSession([]).meta,
      inheritedEventCount: 0,
      events: [cold],
    })
    await monitor.flush()
    expect(recover).toHaveBeenCalledOnce()
    expect(reconcile).not.toHaveBeenCalled()
    expect(signals.replaceSession).not.toHaveBeenCalled()
    await monitor.dispose()
  })

  it('revokes in-flight provider work before it can write or notify a replacement generation', async () => {
    const ctx = feedbackContext()
    const signals = feedbackStore()
    const trigger = putEvent(4, 'negative', 'old provider')
    const pending = deferred<ReturnType<typeof reconciled>>()
    const recover = vi.fn(() => pending.promise)
    const changed = vi.fn()
    let active = true
    const monitor = installFeedbackSignalMonitor(ctx.context, signals.store, {
      getSessionGeneration: () => undefined,
    } as never, {
      isActive: () => active,
      currentSession: { dialect: 'current', reconcile: recover, recover },
      onSignalsChanged: changed,
    })
    ctx.emit('session/event', liveSession(trigger), trigger)
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
    active = false
    const disposing = monitor.dispose()
    pending.resolve(reconciled([trigger]))
    await disposing
    expect(signals.replaceSession).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(ctx.listenerCount('session/event')).toBe(0)
  })
})

function storedSession(events: readonly unknown[]): DurableFeedbackStoredSession {
  return {
    meta: {
      version: 0,
      id: SessionId('session-current'),
      createdAt: 1,
      cwd: '/private/project',
      isSeeded: false,
    },
    inheritedEventCount: SessionLogOffset(0),
    fromSeq: SessionLogOffset(0),
    events: structuredClone(events) as never,
  }
}

function reconciled(events: readonly unknown[], listedItems?: readonly unknown[]) {
  const folded = new Map<string, unknown>()
  for (const event of events as ReadonlyArray<{
    readonly type?: unknown
    readonly data?: { readonly item?: { readonly messageId?: unknown }; readonly messageId?: unknown }
  }>) {
    if (event.type === 'feedback/message-put' && typeof event.data?.item?.messageId === 'string') {
      folded.set(event.data.item.messageId, event.data.item)
    } else if (event.type === 'feedback/message-delete' && typeof event.data?.messageId === 'string') {
      folded.delete(event.data.messageId)
    }
  }
  return {
    dialect: 'current' as const,
    stored: storedSession(events),
    listedItems: structuredClone(listedItems ?? [...folded.values()]),
  }
}

function feedbackItem(event: ReturnType<typeof putEvent>) {
  return (event.data as { readonly item: unknown }).item
}

function putEvent(seq: number, rating: 'positive' | 'negative', note?: string) {
  return {
    type: 'feedback/message-put',
    seq: SessionSeq(seq),
    time: 11,
    data: {
      sessionId: 'session-current',
      item: {
        messageId: 'assistant-1',
        rating,
        ...(note === undefined ? {} : { note }),
        version: '11111111-1111-4111-8111-111111111111',
        createdAt: 10,
        updatedAt: 11,
      },
    },
  }
}

function liveSession(event: ReturnType<typeof putEvent>) {
  return {
    id: SessionId('session-current'),
    eventAt: (seq: number) => seq === event.seq ? event : undefined,
  }
}

function feedbackStore() {
  const replaceSession = vi.fn(async () => {})
  const removeSession = vi.fn(async () => {})
  return {
    replaceSession,
    removeSession,
    store: {
      replaceSession,
      removeSession,
      get: () => undefined,
      list: () => [],
      summarize: () => ({ all: 0, selected: 0 }),
      close: async () => {},
    } as FeedbackSignalStore,
  }
}

function feedbackContext() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const warn = vi.fn()
  const context = {
    logger: { warn },
    workspaceRegistry: {
      resolveByPath: async () => ({ id: WORKSPACE_ID }),
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const selected = listeners.get(event) ?? new Set()
      selected.add(listener)
      listeners.set(event, selected)
      return () => { selected.delete(listener) }
    },
    effect(callback: () => unknown) {
      const dispose = callback()
      return () => typeof dispose === 'function' ? dispose() : undefined
    },
  } as unknown as Context
  return {
    context,
    warn,
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
