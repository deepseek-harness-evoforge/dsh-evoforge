import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.js'
import {
  installFeedbackSignalMonitor,
  openFeedbackSignalStore,
} from '../src/feedback-signal-monitor.js'
import { openEvolutionStore } from '../src/generation-store.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

const sourceFeedbackSpec = defineDomain({
  name: 'message_feedback',
  version: 0,
  tables: { sessions: domainTable<string, unknown>(z.unknown()) },
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('explicit feedback learning signal', () => {
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
        inspect: async () => ({
          meta: {
            version: 0,
            id: SessionId(lifecycle.sessionId),
            createdAt: lifecycle.createdAt,
            cwd: lifecycle.cwd,
          },
          events: attributedFeedbackEvents('assistant-negative'),
        }),
      }),
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
      for (let index = 1; index <= 3; index += 1) {
        const sessionId = `session-${index}`
        await firstStore.replaceSession({
          observedAt: index,
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
  return { type, seq, time: seq + 1, data }
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
