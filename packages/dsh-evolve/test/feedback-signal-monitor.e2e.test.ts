import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { SessionId, SessionLogOffset, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.js'
import {
  installFeedbackSignalMonitor,
  openFeedbackSignalStore,
  type FeedbackSignalStore,
} from '../src/feedback-signal-monitor.js'
import { openEvolutionStore } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []
const sourceDshVersion = JSON.parse(readFileSync(
  join(dshSourceDir, 'packages', 'core', 'session', 'package.json'),
  'utf8',
)) as { readonly version?: unknown }
const isCurrentDsh = sourceDshVersion.version === '0.1.5-rc.2'

const sourceFeedbackSpec = defineDomain({
  name: 'message_feedback',
  version: 0,
  tables: { sessions: domainTable<string, unknown>(z.unknown()) },
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('explicit feedback learning signal', () => {
  it.skipIf(!isCurrentDsh)('projects real current live and cold feedback and repairs a failed live durability barrier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-current-feedback-'))
    temporaryRoots.push(root)
    const current = await currentDshModules()
    const signals = inMemoryFeedbackSignals()
    const first = new current.Context()
    installWorkspaceFixture(first)
    await first.plugin(current.SessionStore)
    await first.plugin(current.JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await first.plugin(current.MessageFeedback, { maxNoteBytes: 1024 })
    const firstAttribution = new DurableFeedbackAttribution(first.sessionPersistence, {
      lifecycle: first as unknown as Context,
    })
    const firstMonitor = installFeedbackSignalMonitor(first as unknown as Context, signals, {
      getSessionGeneration: () => ({ id: 'c'.repeat(64) }),
    } as never, currentMonitorOptions(first, firstAttribution, 61))
    const session = first.sessions.create(current.SessionId('current-feedback-session'), {
      meta: { cwd: '/private/customer-repo' },
    })
    const writer = await first.sessionPersistence.create(session.header)
    const assistantMessageId = appendCurrentAttributedTranscript(current, session)
    const flushLive = first.sessions.flush.bind(first.sessions)
    const flush = vi.spyOn(first.sessions, 'flush')
      .mockRejectedValueOnce(new Error('injected live durability failure'))
      .mockImplementation(liveSession => flushLive(liveSession))
    await expect(first.messageFeedback.put({
      sessionId: session.id,
      messageId: assistantMessageId,
      rating: 'negative',
      note: 'live correction',
      ifVersion: null,
    })).rejects.toThrow('injected live durability failure')
    await firstMonitor.flush()
    const live = await first.messageFeedback.list({ sessionId: session.id }) as {
      readonly ok?: unknown
      readonly value?: { readonly items?: ReadonlyArray<{ readonly version?: unknown }> }
    }
    const liveVersion = live.ok === true && live.value?.items?.length === 1
      ? String(live.value.items[0]?.version)
      : undefined
    if (liveVersion === undefined) throw new Error('current live feedback was not retained after failed flush')

    expect(signals.list(WORKSPACE_ID)).toEqual([
      expect.objectContaining({
        observedAt: 61,
        sessionId: 'current-feedback-session',
        messageId: String(assistantMessageId),
        feedbackVersion: liveVersion,
        generationId: 'c'.repeat(64),
        attribution: expect.objectContaining({
          skillName: 'build-dsh-plugin',
          route: 'user-explicit',
          goal: { id: 'goal-current-feedback', revision: 1 },
        }),
      }),
    ])
    expect(flush).toHaveBeenCalledTimes(2)

    flush.mockRejectedValueOnce(new Error('injected live delete durability failure'))
    await expect(first.messageFeedback.delete({
      sessionId: session.id,
      messageId: assistantMessageId,
      ifVersion: liveVersion,
    })).rejects.toThrow('injected live delete durability failure')
    await firstMonitor.flush()
    expect(signals.list(WORKSPACE_ID)).toEqual([])

    const recreated = await first.messageFeedback.put({
      sessionId: session.id,
      messageId: assistantMessageId,
      rating: 'negative',
      note: 'live correction restored',
      ifVersion: null,
    })
    if (!recreated.ok) throw new Error(`current live feedback failed: ${String(recreated.error.code)}`)
    await firstMonitor.flush()
    const liveVersionAfterDelete = String(recreated.value.version)
    expect(signals.list(WORKSPACE_ID)).toEqual([
      expect.objectContaining({ feedbackVersion: liveVersionAfterDelete }),
    ])
    flush.mockRestore()
    await writer.close()
    await firstMonitor.dispose()
    await first.fiber.dispose()

    const second = new current.Context()
    const recoveredSignals = inMemoryFeedbackSignals()
    installWorkspaceFixture(second)
    await second.plugin(current.SessionStore)
    await second.plugin(current.JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await second.plugin(current.MessageFeedback, { maxNoteBytes: 1024 })
    const secondAttribution = new DurableFeedbackAttribution(second.sessionPersistence, {
      lifecycle: second as unknown as Context,
    })
    const secondMonitor = installFeedbackSignalMonitor(second as unknown as Context, recoveredSignals, {
      getSessionGeneration: () => ({ id: 'c'.repeat(64) }),
    } as never, currentMonitorOptions(second, secondAttribution, 62))
    try {
      await secondMonitor.reconcileCurrent()
      expect(recoveredSignals.list(WORKSPACE_ID)).toEqual([
        expect.objectContaining({
          sessionId: 'current-feedback-session',
          feedbackVersion: liveVersionAfterDelete,
          attribution: expect.objectContaining({ skillName: 'build-dsh-plugin' }),
        }),
      ])

      const coldPositive = await second.messageFeedback.put({
        sessionId: session.id,
        messageId: assistantMessageId,
        rating: 'positive',
        note: 'resolved',
        ifVersion: liveVersionAfterDelete,
      })
      if (!coldPositive.ok) throw new Error(`current cold feedback failed: ${String(coldPositive.error.code)}`)
      await secondMonitor.flush()
      expect(recoveredSignals.list(WORKSPACE_ID)).toEqual([])

      const coldNegative = await second.messageFeedback.put({
        sessionId: session.id,
        messageId: assistantMessageId,
        rating: 'negative',
        note: 'cold correction',
        ifVersion: coldPositive.value.version,
      })
      if (!coldNegative.ok) throw new Error(`current cold feedback failed: ${String(coldNegative.error.code)}`)
      await secondMonitor.flush()
      expect(recoveredSignals.list(WORKSPACE_ID)).toEqual([
        expect.objectContaining({
          observedAt: 62,
          sessionId: 'current-feedback-session',
          feedbackVersion: String(coldNegative.value.version),
          attribution: expect.objectContaining({ skillName: 'build-dsh-plugin' }),
        }),
      ])
      expect(second.sessions.get(session.id)).toBeUndefined()
    } finally {
      await secondMonitor.dispose()
      await second.fiber.dispose()
    }
  })

  it('persists only a retractable reference to negative feedback with a note', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-feedback-signal-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const ctx = await bootStorage(configPath)
    installWorkspaceFixture(ctx)
    const evolution = await openEvolutionStore(ctx.storageDomain)
    const signals = await openFeedbackSignalStore(ctx.storageDomain)
    const source = await ctx.storageDomain.open(sourceFeedbackSpec)
    const lifecycle = {
      workspaceId: WORKSPACE_ID,
      sessionId: 'feedback-session',
      createdAt: 1_723_456_789_100,
      cwd: '/private/customer-repo',
    }
    const generation = (await evolution.publishGeneration(generationInput())).generation
    await evolution.promoteGeneration(WORKSPACE_ID, generation.id)
    await evolution.pinSession(lifecycle)
    const monitor = installFeedbackSignalMonitor(ctx, signals, evolution, {
      now: () => 42,
      attribution: new DurableFeedbackAttribution({
        readFrom: async () => ({
          meta: {
            version: 0,
            id: SessionId(lifecycle.sessionId),
            createdAt: lifecycle.createdAt,
            cwd: lifecycle.cwd,
            isSeeded: false,
          },
          inheritedEventCount: SessionLogOffset(0),
          fromSeq: SessionLogOffset(0),
          events: attributedFeedbackEvents('assistant-negative'),
        }),
      }, { lifecycle: ctx }),
    })
    const negativeVersion = '11111111-1111-4111-8111-111111111111'
    const secretNote = ' API key leaked in logs '

    try {
      await source.table('sessions').put(lifecycle.sessionId, {
        session: { createdAt: lifecycle.createdAt, cwd: lifecycle.cwd },
        items: [
          {
            messageId: 'assistant-negative',
            rating: 'negative',
            note: secretNote,
            version: negativeVersion,
            createdAt: 20,
            updatedAt: 21,
          },
          {
            messageId: 'assistant-positive',
            rating: 'positive',
            note: 'good answer',
            version: '22222222-2222-4222-8222-222222222222',
            createdAt: 22,
            updatedAt: 22,
          },
          {
            messageId: 'assistant-no-note',
            rating: 'negative',
            version: '33333333-3333-4333-8333-333333333333',
            createdAt: 23,
            updatedAt: 23,
          },
        ],
      })
      await monitor.flush()

      const expectedId = sha256(JSON.stringify([
        WORKSPACE_ID,
        lifecycle.sessionId,
        'assistant-negative',
        negativeVersion,
      ]))
      expect(signals.list(WORKSPACE_ID)).toEqual([{
        schemaVersion: 2,
        id: expectedId,
        workspaceId: WORKSPACE_ID,
        observedAt: 42,
        sessionId: lifecycle.sessionId,
        messageId: 'assistant-negative',
        feedbackVersion: negativeVersion,
        sourceUpdatedAt: 21,
        generationId: generation.id,
        attribution: {
          kind: 'exact-skill-invocation-v1',
          skillName: 'build-dsh-plugin',
          route: 'user-explicit',
          invocationSeq: 3,
          invocationContentHash: sha256(JSON.stringify([{
            type: 'text',
            text: '<skill_content />',
          }])),
          assistantSeq: 4,
          turn: 1,
          goal: { id: 'goal-feedback', revision: 1 },
        },
      }])
      expect(signals.summarize(WORKSPACE_ID, generation.id)).toEqual({ all: 1, selected: 1 })
      expect(JSON.stringify(signals.list(WORKSPACE_ID))).not.toContain(secretNote.trim())
      expect(JSON.stringify(signals.list(WORKSPACE_ID))).not.toContain(sha256(secretNote))
      expect(JSON.stringify(signals.list(WORKSPACE_ID))).not.toContain(lifecycle.cwd)
      expect(JSON.stringify(signals.list(WORKSPACE_ID))).not.toContain(sha256(JSON.stringify([
        lifecycle.sessionId,
        lifecycle.createdAt,
        lifecycle.cwd,
      ])))

      await source.table('sessions').put(lifecycle.sessionId, {
        session: { createdAt: lifecycle.createdAt, cwd: lifecycle.cwd },
        items: [{
          messageId: 'assistant-negative',
          rating: 'positive',
          note: 'the correction was retracted',
          version: '44444444-4444-4444-8444-444444444444',
          createdAt: 20,
          updatedAt: 24,
        }],
      })
      await monitor.flush()
      expect(signals.list(WORKSPACE_ID)).toEqual([])
    } finally {
      await monitor.dispose()
      await source.close()
      await signals.close()
      await evolution.close()
      await ctx.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openFeedbackSignalStore(resumed.storageDomain)
    try {
      expect(recovered.list(WORKSPACE_ID)).toEqual([])
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })

  it('recovers durably landed references after restart and evicts whole old Sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-feedback-recovery-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)
    const first = await bootStorage(configPath)
    const firstStore = await openFeedbackSignalStore(first.storageDomain, { maxSessions: 2 })
    try {
      // Recovery order/observation time must not make old source feedback evict
      // a newer Session. Replay the oldest source last.
      for (const index of [3, 2, 1]) {
        const sessionId = `session-${index}`
        await firstStore.replaceSession({
          observedAt: 100 - index,
          workspaceId: WORKSPACE_ID,
          sessionId,
          generationId: 'a'.repeat(64),
          items: [{
            id: sha256(`signal-${index}`),
            messageId: `message-${index}`,
            feedbackVersion: `00000000-0000-4000-8000-00000000000${index}`,
            sourceUpdatedAt: index,
            attribution: {
              kind: 'exact-skill-invocation-v1',
              skillName: 'release-dsh-plugin',
              route: 'model-tool',
              invocationSeq: 3,
              assistantSeq: 5,
              turn: 1,
              goal: { id: `goal-${index}`, revision: 1 },
            },
          }],
        })
      }
      expect(firstStore.list(WORKSPACE_ID).map(signal => signal.sessionId)).toEqual(['session-2', 'session-3'])
      const prior = firstStore.list(WORKSPACE_ID)[0]!
      const { schemaVersion: _schemaVersion, observedAt: _observedAt,
        workspaceId, sessionId, generationId, ...item } = prior
      expect(await firstStore.replaceSession({
        observedAt: 1000, workspaceId, sessionId, generationId, items: [item],
      })).toBe(false)
      expect(firstStore.list(WORKSPACE_ID)[0]!.observedAt).toBe(98)
      let active = true
      const retiredWrite = firstStore.replaceSession({
        observedAt: 1001, workspaceId, sessionId, generationId, items: [],
      }, () => active)
      active = false
      expect(await retiredWrite).toBe(false)
      expect(firstStore.list(WORKSPACE_ID).map(signal => signal.sessionId)).toEqual(['session-2', 'session-3'])
    } finally {
      await firstStore.close()
      await first.fiber.dispose()
    }

    const resumed = await bootStorage(configPath)
    const recovered = await openFeedbackSignalStore(resumed.storageDomain, { maxSessions: 2 })
    try {
      expect(recovered.list(WORKSPACE_ID).map(signal => signal.sessionId)).toEqual(['session-2', 'session-3'])
      expect(recovered.list(WORKSPACE_ID).map(signal => signal.attribution)).toEqual([
        expect.objectContaining({
          skillName: 'release-dsh-plugin',
          goal: { id: 'goal-2', revision: 1 },
        }),
        expect.objectContaining({
          skillName: 'release-dsh-plugin',
          goal: { id: 'goal-3', revision: 1 },
        }),
      ])
      expect(recovered.summarize(WORKSPACE_ID, 'a'.repeat(64))).toEqual({ all: 2, selected: 2 })
    } finally {
      await recovered.close()
      await resumed.fiber.dispose()
    }
  })
})

function generationInput() {
  return {
    workspaceId: WORKSPACE_ID,
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill' as const,
      name: 'build-dsh-plugin',
      gitCommit: '0123456789abcdef0123456789abcdef01234567',
      treeHash: 'a'.repeat(64),
    }],
    evaluatorVersion: 'private-host-runtime-package-boundary-v1',
    policyVersion: 'p1.3-explicit-feedback-intake-v1',
    compositionFingerprint: 'b'.repeat(64),
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function attributedFeedbackEvents(assistantMessageId: string): SessionEvent[] {
  return [
    sessionEvent('goal/change', 0, {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: 'goal-feedback',
        revision: 1,
        objective: 'Build and verify one native DSH plugin.',
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
    sessionEvent('turn/start', 1, { turn: 1 }),
    sessionEvent('user/message', 2, {
      id: 'direct-user',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Build it.' }],
    }),
    sessionEvent('user/message', 3, {
      id: 'invoked-skill',
      role: 'user',
      source: { kind: 'skill-invocation', name: 'build-dsh-plugin', form: 'instructions' },
      content: [{ type: 'text', text: '<skill_content />' }],
    }),
    sessionEvent('assistant/message', 4, {
      turn: 1,
      step: 1,
      message: {
        id: assistantMessageId,
        role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text: 'Built.' }],
      },
    }),
  ] as SessionEvent[]
}

function sessionEvent(type: string, seq: number, data: unknown): Record<string, unknown> {
  return { type, seq: SessionSeq(seq), time: seq + 1, data }
}

interface CurrentSessionLike {
  readonly id: string
  readonly header: unknown
  append(type: string, data: unknown, options?: unknown): unknown
}

interface CurrentContextLike {
  plugin(plugin: unknown, config?: unknown): Promise<unknown>
  readonly fiber: { dispose(): Promise<void> }
  readonly sessions: {
    create(id: string, options?: unknown): CurrentSessionLike
    get(id: string): unknown
    flush(session: unknown): Promise<boolean>
  }
  readonly sessionPersistence: {
    readonly readFrom?: (...args: never[]) => unknown
    readonly open?: (...args: never[]) => unknown
    create(header: unknown): Promise<{ close(): Promise<void> }>
    list(options?: { readonly signal?: AbortSignal }): Promise<ReadonlyArray<{
      readonly header: { readonly id: string }
    }>>
  }
  readonly messageFeedback: {
    list(request: { readonly sessionId: string }): Promise<unknown>
    delete(request: Record<string, unknown>): Promise<unknown>
    put(request: Record<string, unknown>): Promise<{
      readonly ok: boolean
      readonly value: { readonly version: string }
      readonly error: { readonly code: string }
    }>
  }
}

interface CurrentDshModules {
  readonly Context: new () => CurrentContextLike
  readonly SessionStore: never
  readonly JsonlPersistence: never
  readonly MessageFeedback: never
  readonly SessionId: (id: string) => string
  readonly createUserMessage: (input: Record<string, unknown>) => { readonly id: string }
  readonly createAssistantMessage: (input: Record<string, unknown>) => { readonly id: string }
}

async function currentDshModules(): Promise<CurrentDshModules> {
  const packageEntry = (path: string) => pathToFileURL(
    join(dshSourceDir, 'packages', path, 'lib', 'index.js'),
  ).href
  const [cordis, session, persistence, feedback, llm] = await Promise.all([
    import(pathToFileURL(join(dshSourceDir, 'vendor', 'cordis', 'lib', 'index.js')).href),
    import(packageEntry('core/session')),
    import(packageEntry('session/session-persistence-jsonl')),
    import(packageEntry('feedback/message-feedback')),
    import(packageEntry('llm/llm')),
  ])
  return {
    Context: cordis.Context as CurrentDshModules['Context'],
    SessionStore: session.default as never,
    JsonlPersistence: persistence.default as never,
    MessageFeedback: feedback.default as never,
    SessionId: session.SessionId as CurrentDshModules['SessionId'],
    createUserMessage: llm.createUserMessage as CurrentDshModules['createUserMessage'],
    createAssistantMessage: llm.createAssistantMessage as CurrentDshModules['createAssistantMessage'],
  }
}

function currentMonitorOptions(
  ctx: CurrentContextLike,
  attribution: DurableFeedbackAttribution,
  observedAt: number,
) {
  const reconcile = async (sessionId: string, recoverLive: boolean) => {
    const result = await ctx.messageFeedback.list({ sessionId }) as {
      readonly ok?: unknown
      readonly value?: { readonly items?: unknown }
    }
    if (result.ok !== true || !Array.isArray(result.value?.items)) {
      throw new Error('real current feedback reconciliation failed')
    }
    if (recoverLive) {
      const live = ctx.sessions.get(sessionId)
      if (live !== undefined && await ctx.sessions.flush(live) !== true) {
        throw new Error('real current feedback durability barrier was unavailable')
      }
    }
    return {
      dialect: 'current' as const,
      stored: await attribution.readStoredSession(sessionId),
      listedItems: structuredClone(result.value.items),
    }
  }
  return {
    now: () => observedAt,
    attribution,
    currentSession: {
      reconcile: (sessionId: string) => reconcile(sessionId, false),
      recover: (sessionId: string) => reconcile(sessionId, true),
      listSessionIds: async () => (await ctx.sessionPersistence.list())
        .map(snapshot => String(snapshot.header.id))
        .sort((left, right) => left.localeCompare(right)),
    },
  }
}

function appendCurrentAttributedTranscript(
  current: CurrentDshModules,
  session: CurrentSessionLike,
): string {
  session.append('goal/change', {
    kind: 'goal/change',
    version: 1,
    operation: 'create',
    goal: {
      id: 'goal-current-feedback',
      revision: 1,
      objective: 'Build and verify one native DSH plugin.',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const direct = current.createUserMessage({
    content: [{ type: 'text', text: 'Build it.' }],
    source: { kind: 'user' },
  })
  session.append('user/message', direct, { surfaceOp: 'append' })
  const skill = current.createUserMessage({
    content: [{ type: 'text', text: '<skill_content />' }],
    source: { kind: 'skill-invocation', name: 'build-dsh-plugin', form: 'instructions' },
  })
  session.append('user/message', skill, { surfaceOp: 'append' })
  const assistant = current.createAssistantMessage({
    content: [{ type: 'text', text: 'Built.' }],
    source: { provider: 'fixture', model: 'fixture' },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: assistant,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return assistant.id
}

function inMemoryFeedbackSignals(): FeedbackSignalStore {
  const sessions = new Map<string, Parameters<FeedbackSignalStore['replaceSession']>[0]>()
  return {
    async replaceSession(input) {
      if (input.items.length === 0) sessions.delete(input.sessionId)
      else sessions.set(input.sessionId, structuredClone(input))
    },
    async removeSession(sessionId) { sessions.delete(sessionId) },
    get(id, workspaceId) {
      return this.list(workspaceId).find(signal => signal.id === id)
    },
    list(workspaceId) {
      return [...sessions.values()]
        .filter(session => workspaceId === undefined || session.workspaceId === workspaceId)
        .flatMap(session => session.items.map(item => ({
          schemaVersion: 2 as const,
          id: item.id,
          observedAt: session.observedAt,
          workspaceId: session.workspaceId,
          sessionId: session.sessionId,
          messageId: item.messageId,
          feedbackVersion: item.feedbackVersion,
          sourceUpdatedAt: item.sourceUpdatedAt,
          ...(session.generationId === undefined ? {} : { generationId: session.generationId }),
          ...(item.attribution === undefined ? {} : { attribution: item.attribution }),
        })))
    },
    summarize(workspaceId, selectedGenerationId) {
      const all = this.list(workspaceId)
      return {
        all: all.length,
        selected: all.filter(item => item.generationId === selectedGenerationId).length,
      }
    },
    async close() {},
  }
}

function installWorkspaceFixture(ctx: object): void {
  Object.defineProperty(ctx, 'workspaceRegistry', {
    configurable: true,
    value: { resolveByPath: async () => ({ id: WORKSPACE_ID }) },
  })
}

async function writeStorageConfig(root: string): Promise<string> {
  const packageScope = join(root, 'node_modules', '@deepseek-ai')
  await mkdir(packageScope, { recursive: true })
  for (const [name, source] of [
    ['dsh-storage', join(dshSourceDir, 'packages', 'storage', 'storage')],
    ['dsh-storage-json', join(dshSourceDir, 'packages', 'storage', 'storage-json')],
    ['dsh-storage-domain', join(dshSourceDir, 'packages', 'storage', 'storage-domain')],
  ] as const) {
    await symlink(source, join(packageScope, name), 'dir')
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: '@deepseek-ai/dsh-storage' },
    {
      id: 'storage-json',
      name: '@deepseek-ai/dsh-storage-json',
      config: { root: join(root, 'storage') },
    },
    {
      id: 'storage-domain',
      name: '@deepseek-ai/dsh-storage-domain',
      config: { backend: 'json' },
    },
  ], null, 2))
  return configPath
}

async function bootStorage(configPath: string) {
  const { boot } = await import(
    pathToFileURL(join(dshSourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js')).href
  )
  return boot('dsh-evolve-feedback-signal-test', configPath)
}
