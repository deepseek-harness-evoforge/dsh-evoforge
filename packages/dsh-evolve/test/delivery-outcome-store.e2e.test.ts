import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openDeliveryOutcomeStore } from '../src/delivery-outcome-monitor.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('delivery outcome store', () => {
  it('bounds recent measured evidence to the newest twenty outcomes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-delivery-outcome-metrics-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)

    const ctx = await bootStorage(configPath)
    const store = await openDeliveryOutcomeStore(ctx.storageDomain, { maxRecords: 30 })
    try {
      for (let index = 1; index <= 25; index += 1) {
        const callId = `metric-${String(index).padStart(2, '0')}`
        await store.record({
          ...outcome(callId, index, 'passed'),
          goalMetrics: goalMetrics(`goal-${callId}`, index + 10),
        })
      }

      const summary = store.summarize(WORKSPACE_ID)
      expect(summary.metrics.all).toMatchObject({ measured: 25, unmeasured: 0 })
      expect(summary.metrics.recent).toHaveLength(20)
      expect(summary.metrics.recent.map(item => item.observedAt)).toEqual(
        Array.from({ length: 20 }, (_, offset) => 25 - offset),
      )
    } finally {
      await store.close()
      await ctx.fiber.dispose()
    }
  })

  it('deduplicates calls, bounds retained evidence, and recovers it after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-delivery-outcomes-'))
    temporaryRoots.push(root)
    const configPath = await writeStorageConfig(root)

    const firstCtx = await bootStorage(configPath)
    const firstStore = await openDeliveryOutcomeStore(firstCtx.storageDomain, { maxRecords: 2 })
    try {
      const duplicate = outcome('call-1', 1, 'passed', 'a'.repeat(64))
      expect((await firstStore.record(duplicate)).created).toBe(true)
      expect((await firstStore.record(duplicate)).created).toBe(false)
      await firstStore.record(outcome('call-2', 2, 'failed'))
      await firstStore.record(outcome('call-3', 3, 'unknown', 'a'.repeat(64)))
      const summary = firstStore.summarize(WORKSPACE_ID, 'a'.repeat(64), {})
      expect(summary).toMatchObject({
        all: { total: 2, passed: 0, failed: 1, unknown: 1 },
        selected: { total: 1, passed: 0, failed: 0, unknown: 1 },
        baseline: { total: 1, passed: 0, failed: 1, unknown: 0 },
      })
      expect(summary.metrics).toEqual({
        all: metricRollup(1, 1),
        selected: metricRollup(1, 0),
        baseline: metricRollup(0, 1, true),
        recent: [{
          outcomeId: expect.stringMatching(/^[a-f0-9]{64}$/),
          observedAt: 3,
          generationId: 'a'.repeat(64),
          status: 'unknown',
          goal: { id: 'goal-call-3', revision: 1 },
          metrics: goalMetrics('goal-call-3', 12),
        }],
      })
    } finally {
      await firstStore.close()
      await firstCtx.fiber.dispose()
    }

    const resumedCtx = await bootStorage(configPath)
    const resumedStore = await openDeliveryOutcomeStore(resumedCtx.storageDomain, { maxRecords: 2 })
    try {
      expect(resumedStore.summarize(WORKSPACE_ID)).toMatchObject({
        all: { total: 2, passed: 0, failed: 1, unknown: 1 },
        selected: { total: 1, passed: 0, failed: 1, unknown: 0 },
      })
      expect((await resumedStore.record(outcome('call-3', 3, 'unknown', 'a'.repeat(64)))).created)
        .toBe(false)
      expect(resumedStore.list(WORKSPACE_ID).find(item => item.callId === 'call-3')?.goalMetrics)
        .toEqual(goalMetrics('goal-call-3', 12))
    } finally {
      await resumedStore.close()
      await resumedCtx.fiber.dispose()
    }
  })
})

function outcome(
  callId: string,
  observedAt: number,
  status: 'passed' | 'failed' | 'unknown',
  generationId?: string,
) {
  return {
    workspaceId: WORKSPACE_ID,
    observedAt,
    sessionId: `session-${callId}`,
    callId,
    ...(generationId === undefined ? {} : { generationId }),
    goal: { id: `goal-${callId}`, revision: 1, phase: status === 'passed' ? 'complete' : 'active' },
    status,
    reason: status === 'passed' ? 'verified' : 'check-result',
    commit: 'b'.repeat(40),
    ...(callId === 'call-3' ? { goalMetrics: goalMetrics(`goal-${callId}`, 12) } : {}),
  }
}

function goalMetrics(goalId: string, throughEventSeq: number) {
  return {
    schemaVersion: 1 as const,
    source: 'dsh-session-projections' as const,
    goalId,
    throughEventSeq,
    attributedTurns: 2,
    closedSteps: 1,
    activeWallMs: 300,
    providerUsage: {
      uncachedInputTokens: 30,
      outputTokens: 9,
      cacheReadTokens: 70,
      cacheWriteTokens: 5,
    },
    latency: {
      llmMs: 180,
      toolMs: 50,
      ttftMs: 45,
      ttftSteps: 2,
      decodeMs: 135,
      decodeTokens: 9,
    },
    monetaryCost: { status: 'unavailable' as const, reason: 'provider-price-not-projected' as const },
  }
}

function metricRollup(measured: number, unmeasured: number, empty = false) {
  const factor = empty ? 0 : measured
  return {
    measured,
    unmeasured,
    attributedTurns: 2 * factor,
    closedSteps: factor,
    activeWallMs: 300 * factor,
    providerUsage: {
      uncachedInputTokens: 30 * factor,
      outputTokens: 9 * factor,
      cacheReadTokens: 70 * factor,
      cacheWriteTokens: 5 * factor,
    },
    latency: {
      llmMs: 180 * factor,
      toolMs: 50 * factor,
      ttftMs: 45 * factor,
      ttftSteps: 2 * factor,
      decodeMs: 135 * factor,
      decodeTokens: 9 * factor,
    },
    monetaryCost: { status: 'unavailable', reason: 'provider-price-not-projected' },
  }
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
  return boot('dsh-evolve-delivery-outcome-test', configPath)
}
