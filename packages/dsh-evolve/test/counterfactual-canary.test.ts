import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CounterfactualCanary,
  type CanaryComparisonRunner,
} from '../src/counterfactual-canary.js'
import type { DeliveryOutcome } from '../src/delivery-outcome-monitor.js'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.js'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.js'

const parentId = '1'.repeat(64)
const candidateId = '2'.repeat(64)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('counterfactual Generation canary', () => {
  it('rolls back exactly once when the same sealed case passes on parent and fails on candidate', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    let active: CapabilityGeneration | undefined = candidate
    const rollbackGeneration = vi.fn(async () => {
      const previousId = active?.id
      active = parent
      return { previousId: previousId!, generation: parent }
    })
    const store = {
      getActiveGeneration: () => active,
      getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
      rollbackGeneration,
    } as unknown as EvolutionStore
    const review = reviewCandidate(outputDir)
    const inbox = {
      scanAll: vi.fn(async () => ({ candidates: [review], warnings: [] })),
    } as unknown as ReviewInbox
    const outcome = failedOutcome()
    const outcomes = { list: () => [outcome] }
    const runner: CanaryComparisonRunner = async () => ({
      calibrationPassed: true,
      parentPassed: true,
      candidatePassed: false,
      report: { checks: ['parent:pass', 'candidate:fail'] },
    })
    const canary = new CounterfactualCanary({ inbox, outcomes, runner, store })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [],
      reviewed: [],
      rolledBack: [{
        outcomeId: outcome.id,
        previousId: candidateId,
        activeId: parentId,
      }],
      warnings: [],
    })
    expect(store.getActiveGeneration()?.id).toBe(parentId)

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [],
      reviewed: [],
      rolledBack: [],
      warnings: [],
    })
    expect(rollbackGeneration).toHaveBeenCalledOnce()
  })

  it('keeps the active Generation when its sealed Candidate still passes', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-keep-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    const rollbackGeneration = vi.fn()
    const store = {
      getActiveGeneration: () => candidate,
      getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
      rollbackGeneration,
    } as unknown as EvolutionStore
    const outcome = failedOutcome()
    const canary = new CounterfactualCanary({
      inbox: {
        scanAll: vi.fn(async () => ({ candidates: [reviewCandidate(outputDir)], warnings: [] })),
      } as unknown as ReviewInbox,
      outcomes: { list: () => [outcome] },
      runner: async () => ({
        calibrationPassed: true,
        parentPassed: true,
        candidatePassed: true,
        report: { checks: ['candidate:pass'] },
      }),
      store,
    })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [{ outcomeId: outcome.id, generationId: candidateId }],
      reviewed: [],
      rolledBack: [],
      warnings: [],
    })
    expect(store.getActiveGeneration()?.id).toBe(candidateId)
    expect(rollbackGeneration).not.toHaveBeenCalled()
  })

  it('recovers a rollback whose pointer committed before its canary result', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-crash-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    let active: CapabilityGeneration | undefined = candidate
    const rollbackGeneration = vi.fn(async () => {
      active = parent
      throw new Error('simulated crash after active pointer commit')
    })
    const store = {
      getActiveGeneration: () => active,
      getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
      rollbackGeneration,
    } as unknown as EvolutionStore
    const outcome = failedOutcome()
    const canary = new CounterfactualCanary({
      inbox: {
        scanAll: vi.fn(async () => ({ candidates: [reviewCandidate(outputDir)], warnings: [] })),
      } as unknown as ReviewInbox,
      outcomes: { list: () => [outcome] },
      runner: async () => ({
        calibrationPassed: true,
        parentPassed: true,
        candidatePassed: false,
        report: { checks: ['parent:pass', 'candidate:fail'] },
      }),
      store,
    })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toMatchObject({
      warnings: ['simulated crash after active pointer commit'],
    })
    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [],
      reviewed: [],
      rolledBack: [{
        outcomeId: outcome.id,
        previousId: candidateId,
        activeId: parentId,
      }],
      warnings: [],
    })
    expect(active?.id).toBe(parentId)
    expect(rollbackGeneration).toHaveBeenCalledOnce()
  })

  it('requires review instead of moving a pointer that changed during the sealed Trial', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-race-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    const other = generation('9'.repeat(64))
    let active: CapabilityGeneration | undefined = candidate
    const rollbackGeneration = vi.fn()
    const outcome = failedOutcome()
    const canary = new CounterfactualCanary({
      inbox: {
        scanAll: vi.fn(async () => ({ candidates: [reviewCandidate(outputDir)], warnings: [] })),
      } as unknown as ReviewInbox,
      outcomes: { list: () => [outcome] },
      runner: async () => {
        active = other
        return {
          calibrationPassed: true,
          parentPassed: true,
          candidatePassed: false,
          report: { checks: ['parent:pass', 'candidate:fail'] },
        }
      },
      store: {
        getActiveGeneration: () => active,
        getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
        rollbackGeneration,
      } as unknown as EvolutionStore,
    })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [],
      reviewed: [{
        outcomeId: outcome.id,
        generationId: candidateId,
        reason: 'active Generation changed before canary rollback',
      }],
      rolledBack: [],
      warnings: [],
    })
    expect(active?.id).toBe(other.id)
    expect(rollbackGeneration).not.toHaveBeenCalled()
  })

  it('runs at most one sealed canary for an immutable Generation', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-bounded-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    const first = failedOutcome()
    const second = { ...failedOutcome(), id: '6'.repeat(64), callId: 'later-delivery' }
    const runner = vi.fn<CanaryComparisonRunner>(async () => ({
      calibrationPassed: true,
      parentPassed: true,
      candidatePassed: true,
      report: { checks: ['candidate:pass'] },
    }))
    const canary = new CounterfactualCanary({
      inbox: {
        scanAll: vi.fn(async () => ({ candidates: [reviewCandidate(outputDir)], warnings: [] })),
      } as unknown as ReviewInbox,
      outcomes: { list: () => [first, second] },
      runner,
      store: {
        getActiveGeneration: () => candidate,
        getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
        rollbackGeneration: vi.fn(),
      } as unknown as EvolutionStore,
    })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toMatchObject({
      kept: [{ outcomeId: first.id, generationId: candidateId }],
      reviewed: [],
      rolledBack: [],
    })
    expect(runner).toHaveBeenCalledOnce()
  })

  it('routes an incomplete sealed comparison to review without an automatic retry loop', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-incomplete-'))
    temporaryRoots.push(outputDir)
    const parent = generation(parentId)
    const candidate = generation(candidateId, parentId)
    const outcome = failedOutcome()
    const runner = vi.fn<CanaryComparisonRunner>(async () => {
      throw new Error('case pack unavailable')
    })
    const canary = new CounterfactualCanary({
      inbox: {
        scanAll: vi.fn(async () => ({ candidates: [reviewCandidate(outputDir)], warnings: [] })),
      } as unknown as ReviewInbox,
      outcomes: { list: () => [outcome] },
      runner,
      store: {
        getActiveGeneration: () => candidate,
        getGeneration: (id: string) => id === candidateId ? candidate : id === parentId ? parent : undefined,
        rollbackGeneration: vi.fn(),
      } as unknown as EvolutionStore,
    })

    await expect(canary.scanOnce(new AbortController().signal)).resolves.toEqual({
      kept: [],
      reviewed: [{
        outcomeId: outcome.id,
        generationId: candidateId,
        reason: 'sealed canary incomplete: case pack unavailable',
      }],
      rolledBack: [],
      warnings: [],
    })
    await expect(canary.scanOnce(new AbortController().signal)).resolves.toMatchObject({
      kept: [], reviewed: [], rolledBack: [], warnings: [],
    })
    expect(runner).toHaveBeenCalledOnce()
  })
})

function generation(id: string, parent?: string): CapabilityGeneration {
  return {
    id,
    schemaVersion: 1,
    ...(parent === undefined ? {} : { parentId: parent }),
    createdAt: 1_723_456_789_000,
    artifacts: [{
      kind: 'skill',
      name: 'stable-skill',
      gitCommit: id.slice(0, 40),
      treeHash: id,
    }],
    evaluatorVersion: 'sealed-canary-v1',
    policyVersion: 'auto-clear-instruction-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function reviewCandidate(outputDir: string): ReviewCandidate {
  return {
    id: '3'.repeat(64),
    runId: '4'.repeat(64),
    status: 'approved',
    outputDir,
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'Improve stable behavior',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: candidateId,
    baseTreeHash: parentId,
    proposalHash: '5'.repeat(64),
    proposal: { claim: 'Improve stable behavior', files: [{ path: 'SKILL.md', content: 'body' }] },
    cases: [{ id: 'sealed', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 10, outputTokens: 5, trialCount: 4 },
    reasons: ['sealed clear win'],
    limitations: [],
    evaluatorVersion: 'sealed-canary-v1',
    compositionFingerprint: 'f'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '6'.repeat(64),
    decisionActor: 'auto-clear-instruction-v1',
    generationId: candidateId,
    activatedAt: '2026-08-16T00:01:00.000Z',
  }
}

function failedOutcome(): DeliveryOutcome {
  return {
    id: '7'.repeat(64),
    schemaVersion: 1,
    observedAt: 1_723_456_790_000,
    sessionId: 'delivery-session',
    callId: 'complete-delivery-call',
    generationId: candidateId,
    goal: { id: 'goal-1', revision: 2, phase: 'active' },
    status: 'failed',
    reason: 'check-failed:test',
    commit: '8'.repeat(40),
  }
}
