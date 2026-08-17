import { describe, expect, it, vi } from 'vitest'
import {
  AutomaticEvaluatorDraftService,
  assertAutomaticEvaluatorDraftSeparation,
  type AutomaticEvaluatorDraftTarget,
} from '../src/automatic-evaluator-draft.ts'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetReservation,
} from '../src/automatic-evolution-budget.ts'
import type { EvaluatorDraftInbox } from '../src/evaluator-draft-inbox.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import type { FeedbackSignalStore } from '../src/feedback-signal-monitor.ts'
import type { AutomaticEvolutionInflightSource } from '../src/automatic-evolution-inflight.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('Automatic Evaluator Draft', () => {
  it('reserves durable budget before authoring one inactive draft for one exact Skill match', async () => {
    const effects: string[] = []
    const author = vi.fn(async () => {
      effects.push('author')
      return {
        schemaVersion: 1 as const,
        action: 'author-evaluator' as const,
        workspaceId: WORKSPACE_ID,
        launchId: '4'.repeat(64),
        targetId: 'plugin-delivery',
        skillName: 'stable-skill',
        draftStatus: 'scheduled' as const,
        jobId: 'job-1',
      }
    })
    const service = new AutomaticEvaluatorDraftService({
      evolution: generationStore(),
      evaluator: { available: () => true, author },
      signals: oneSignal(),
      targets: [target()],
      inflight: [clearInflight()],
      budget: {
        reserve: vi.fn(async input => {
          effects.push('budget')
          return allowedReservation(input.id, input.skill, input.maxAttemptsPerUtcDay)
        }),
        inspect: vi.fn(),
      },
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      authored: [{
        signalId: '1'.repeat(64),
        targetId: 'plugin-delivery',
        draftStatus: 'scheduled',
      }],
      warnings: [],
    })
    expect(author).toHaveBeenCalledWith(WORKSPACE_ID, '1'.repeat(64), 'plugin-delivery')
    expect(effects).toEqual(['budget', 'author'])
  })

  it('leaves multiple matching Skills for explicit target selection without spending', async () => {
    const author = vi.fn()
    const reserve = vi.fn()
    const service = new AutomaticEvaluatorDraftService({
      evolution: {
        getGeneration: () => generation(['stable-skill', 'other-skill']),
      } as Pick<EvolutionStore, 'getGeneration'>,
      evaluator: { available: () => true, author } as Pick<EvaluatorDraftInbox, 'available' | 'author'>,
      signals: oneSignal(),
      targets: [target(), { ...target(), id: 'other-target', skill: 'other-skill', root: '/private/other' }],
      inflight: [clearInflight()],
      budget: { reserve, inspect: vi.fn() } as Pick<AutomaticEvolutionBudget, 'reserve' | 'inspect'>,
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      authored: [],
      warnings: ['explicit feedback matches multiple automatic Evaluator Targets; choose one explicitly'],
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ authored: [], warnings: [] })
    expect(reserve).not.toHaveBeenCalled()
    expect(author).not.toHaveBeenCalled()
  })

  it('defers new authoring until the next UTC day when budget is exhausted', async () => {
    let now = Date.UTC(2026, 7, 17, 12)
    let exhausted = true
    const reserve = vi.fn(async (): Promise<AutomaticEvolutionBudgetReservation> => exhausted
      ? {
          allowed: false,
          newlyReserved: false,
          retryAt: Date.UTC(2026, 7, 18),
          snapshot: {
            workspaceId: WORKSPACE_ID,
            targetId: 'plugin-delivery',
            skillName: 'stable-skill',
            utcDay: '2026-08-17',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        }
      : allowedReservation('plugin-delivery', 'stable-skill', 1, '2026-08-18'))
    const author = vi.fn(async () => ({
      schemaVersion: 1 as const,
      action: 'author-evaluator' as const,
      workspaceId: WORKSPACE_ID,
      launchId: '4'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'stable-skill',
      draftStatus: 'scheduled' as const,
      jobId: 'job-1',
    }))
    const service = new AutomaticEvaluatorDraftService({
      evolution: generationStore(),
      evaluator: { available: () => true, author },
      signals: oneSignal(),
      targets: [target()],
      inflight: [clearInflight()],
      budget: { reserve, inspect: vi.fn() },
      now: () => now,
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      authored: [],
      warnings: ['automatic evolution budget exhausted for Evaluator Target plugin-delivery until the next UTC day'],
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ authored: [], warnings: [] })
    expect(author).not.toHaveBeenCalled()

    now = Date.UTC(2026, 7, 18, 0, 1)
    exhausted = false
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toMatchObject({
      authored: [{ targetId: 'plugin-delivery', draftStatus: 'scheduled' }],
      warnings: [],
    })
    expect(author).toHaveBeenCalledOnce()
  })

  it('projects bounded fail-closed budget status without private paths', async () => {
    const service = new AutomaticEvaluatorDraftService({
      evolution: generationStore(),
      evaluator: { available: () => true, author: vi.fn() } as Pick<EvaluatorDraftInbox, 'available' | 'author'>,
      signals: oneSignal(),
      targets: [target()],
      inflight: [clearInflight()],
      budget: {
        reserve: vi.fn(),
        inspect: vi.fn(async () => { throw new Error('/private/evaluator-root is corrupt') }),
      },
      now: () => Date.UTC(2026, 7, 17),
    })

    const status = await service.budgetStatus(WORKSPACE_ID)
    expect(status).toEqual({
      warningCount: 1,
      targets: [{
        targetId: 'plugin-delivery',
        workspaceId: WORKSPACE_ID,
        skillName: 'stable-skill',
        utcDay: '2026-08-17',
        used: 0,
        limit: 1,
        remaining: 0,
        status: 'unknown',
      }],
    })
    expect(JSON.stringify(status)).not.toContain('/private')
  })

  it('rejects mutable, duplicate, or unbounded automatic author policies', () => {
    const make = (targets: AutomaticEvaluatorDraftTarget[]) => () => new AutomaticEvaluatorDraftService({
      evolution: generationStore(),
      evaluator: { available: () => true, author: vi.fn() } as Pick<EvaluatorDraftInbox, 'available' | 'author'>,
      signals: oneSignal(),
      targets,
      inflight: [clearInflight()],
      budget: allowingBudget(),
    })

    expect(make([])).toThrow('Automatic Evaluator Draft requires 1-20 exact targets')
    expect(make([{ ...target(), workspaceId: 'not-a-workspace' }]))
      .toThrow('Automatic Evaluator Draft permits exactly one target per Workspace and Skill')
    expect(make([target(), { ...target(), id: 'other-target', root: '/private/other' }]))
      .toThrow('Automatic Evaluator Draft permits exactly one target per Workspace and Skill')
    expect(make([{ ...target(), root: 'relative' }]))
      .toThrow('Automatic Evaluator Draft roots must be absolute')
    expect(make([{ ...target(), root: '/' }]))
      .toThrow('Automatic Evaluator Draft roots must not be filesystem roots')
    expect(make([{ ...target(), maxAttemptsPerUtcDay: 21 }]))
      .toThrow('Automatic Evaluator Draft daily attempt limits must be integers between 1 and 20')
    expect(() => assertAutomaticEvaluatorDraftSeparation(
      [target()],
      new Set([`${WORKSPACE_ID}\0stable-skill`]),
    )).toThrow('one Skill cannot enable both Automatic Feedback Shadow and Automatic Evaluator Draft')
  })

  it('does not spend while the same Skill has an unresolved Draft or Candidate', async () => {
    let status: 'clear' | 'busy' = 'busy'
    const reserve = vi.fn(async input =>
      allowedReservation(input.id, input.skill, input.maxAttemptsPerUtcDay))
    const author = vi.fn(async () => ({
      schemaVersion: 1 as const,
      action: 'author-evaluator' as const,
      workspaceId: WORKSPACE_ID,
      launchId: '4'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'stable-skill',
      draftStatus: 'scheduled' as const,
      jobId: 'job-1',
    }))
    const service = new AutomaticEvaluatorDraftService({
      evolution: generationStore(),
      evaluator: { available: () => true, author },
      signals: oneSignal(),
      targets: [target()],
      inflight: [{ automaticInflightStatus: vi.fn(async () => status) }],
      budget: { reserve, inspect: vi.fn() },
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      authored: [],
      warnings: ['automatic evolution deferred for Skill stable-skill while prior work is unresolved'],
    })
    expect(reserve).not.toHaveBeenCalled()
    expect(author).not.toHaveBeenCalled()

    status = 'clear'
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toMatchObject({
      authored: [{ targetId: 'plugin-delivery', draftStatus: 'scheduled' }],
      warnings: [],
    })
    expect(reserve).toHaveBeenCalledOnce()
    expect(author).toHaveBeenCalledOnce()
  })
})

function target(): AutomaticEvaluatorDraftTarget {
  return {
    id: 'plugin-delivery',
    workspaceId: WORKSPACE_ID,
    skill: 'stable-skill',
    root: '/private/evaluator-root',
    maxAttemptsPerUtcDay: 1,
  }
}

function generationStore(): Pick<EvolutionStore, 'getGeneration'> {
  return { getGeneration: () => generation(['stable-skill']) }
}

function generation(skills: string[]) {
  return {
    id: '2'.repeat(64),
    schemaVersion: 2 as const,
    workspaceId: WORKSPACE_ID,
    createdAt: 1,
    artifacts: skills.map((name, index) => ({
      kind: 'skill' as const,
      name,
      gitCommit: String(index + 3).repeat(40),
      treeHash: String(index + 5).repeat(40),
    })),
    evaluatorVersion: 'fixture-v1',
    policyVersion: 'fixture-v1',
    compositionFingerprint: '7'.repeat(64),
  }
}

function oneSignal(): Pick<FeedbackSignalStore, 'list'> {
  return { list: () => [{
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    id: '1'.repeat(64),
    observedAt: 1,
    sessionId: 'session-1',
    messageId: 'message-1',
    feedbackVersion: '00000000-0000-4000-8000-000000000001',
    sourceUpdatedAt: 2,
    generationId: '2'.repeat(64),
  }] }
}

function allowedReservation(
  targetId: string,
  skillName: string,
  limit: number,
  utcDay = '2026-08-17',
): AutomaticEvolutionBudgetReservation {
  return {
    allowed: true,
    newlyReserved: true,
    snapshot: {
      targetId,
      workspaceId: WORKSPACE_ID,
      skillName,
      utcDay,
      used: 1,
      limit,
      remaining: limit - 1,
    },
  }
}

function allowingBudget(): Pick<AutomaticEvolutionBudget, 'reserve' | 'inspect'> {
  return {
    reserve: vi.fn(async input => allowedReservation(input.id, input.skill, input.maxAttemptsPerUtcDay)),
    inspect: vi.fn(),
  }
}

function clearInflight(): AutomaticEvolutionInflightSource {
  return { automaticInflightStatus: vi.fn(async () => 'clear' as const) }
}
