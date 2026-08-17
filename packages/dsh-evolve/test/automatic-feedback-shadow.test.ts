import { describe, expect, it, vi } from 'vitest'
import {
  AutomaticFeedbackShadowService,
  type AutomaticFeedbackShadowTarget,
} from '../src/automatic-feedback-shadow.ts'
import type {
  AutomaticEvolutionBudget,
  AutomaticEvolutionBudgetReservation,
} from '../src/automatic-evolution-budget.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import type { FeedbackSignalStore } from '../src/feedback-signal-monitor.ts'
import type { FeedbackShadowLauncher } from '../src/feedback-shadow-launcher.ts'
import type { AutomaticEvolutionInflightSource } from '../src/automatic-evolution-inflight.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('automatic Feedback Shadow', () => {
  it('launches one exact Target for an explicit signal with one matching Generation Skill', async () => {
    const effects: string[] = []
    const launchAutomaticExact = vi.fn(async () => {
      effects.push('launch')
      return {
        schemaVersion: 1 as const,
        action: 'start-shadow' as const,
        workspaceId: WORKSPACE_ID,
        launchId: '4'.repeat(64),
        targetId: 'plugin-delivery',
        skillName: 'stable-skill',
        runStatus: 'scheduled' as const,
        jobId: 'job-1',
      }
    })
    const service = new AutomaticFeedbackShadowService({
      evolution: {
        getGeneration: () => ({
          id: '2'.repeat(64),
          schemaVersion: 2,
          workspaceId: WORKSPACE_ID,
          createdAt: 1,
          artifacts: [{
            kind: 'skill' as const,
            name: 'stable-skill',
            gitCommit: '3'.repeat(40),
            treeHash: '4'.repeat(40),
          }],
          evaluatorVersion: 'fixture-v1',
          policyVersion: 'fixture-v1',
          compositionFingerprint: '5'.repeat(64),
        }),
      } as Pick<EvolutionStore, 'getGeneration'>,
      shadow: {
        available: () => true,
        launchAutomaticExact,
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: {
        list: () => [{
          schemaVersion: 2 as const,
          workspaceId: WORKSPACE_ID,
          id: '1'.repeat(64),
          observedAt: 1,
          sessionId: 'session-1',
          messageId: 'message-1',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          sourceUpdatedAt: 2,
          generationId: '2'.repeat(64),
        }],
      } as Pick<FeedbackSignalStore, 'list'>,
      targets: [target()],
      inflight: [clearInflight()],
      budget: {
        reserve: vi.fn(async target => {
          effects.push('budget')
          return {
            allowed: true as const,
            newlyReserved: true as const,
            snapshot: {
              workspaceId: WORKSPACE_ID,
              targetId: target.id,
              skillName: target.skill,
              utcDay: '2026-08-17',
              used: 1,
              limit: target.maxAttemptsPerUtcDay,
              remaining: target.maxAttemptsPerUtcDay - 1,
            },
          }
        }),
        inspect: vi.fn(),
      },
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      launched: [{
        signalId: '1'.repeat(64),
        targetId: 'plugin-delivery',
        runStatus: 'scheduled',
      }],
      warnings: [],
    })
    expect(launchAutomaticExact).toHaveBeenCalledWith('1'.repeat(64), target())
    expect(effects).toEqual(['budget', 'launch'])
  })

  it('leaves a signal with multiple matching Generation Skills for explicit target selection', async () => {
    const launchAutomaticExact = vi.fn()
    const service = new AutomaticFeedbackShadowService({
      evolution: {
        getGeneration: () => ({
          id: '2'.repeat(64),
          schemaVersion: 2,
          workspaceId: WORKSPACE_ID,
          createdAt: 1,
          artifacts: [
            { kind: 'skill' as const, name: 'stable-skill', gitCommit: '3'.repeat(40), treeHash: '4'.repeat(40) },
            { kind: 'skill' as const, name: 'other-skill', gitCommit: '5'.repeat(40), treeHash: '6'.repeat(40) },
          ],
          evaluatorVersion: 'fixture-v1',
          policyVersion: 'fixture-v1',
          compositionFingerprint: '7'.repeat(64),
        }),
      } as Pick<EvolutionStore, 'getGeneration'>,
      shadow: {
        available: () => true,
        launchAutomaticExact,
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: { list: () => [{
        schemaVersion: 2 as const,
        workspaceId: WORKSPACE_ID,
        id: '1'.repeat(64),
        observedAt: 1,
        sessionId: 'session-1',
        messageId: 'message-1',
        feedbackVersion: '00000000-0000-4000-8000-000000000001',
        sourceUpdatedAt: 2,
        generationId: '2'.repeat(64),
      }] } as Pick<FeedbackSignalStore, 'list'>,
      targets: [target(), { ...target(), id: 'other-target', skill: 'other-skill' }],
      inflight: [clearInflight()],
      budget: allowingBudget(),
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      launched: [],
      warnings: ['explicit feedback matches multiple automatic Shadow Targets; choose one explicitly'],
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ launched: [], warnings: [] })
    expect(launchAutomaticExact).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous or mutable automatic feedback policy', () => {
    const make = (targets: AutomaticFeedbackShadowTarget[]) => () =>
      new AutomaticFeedbackShadowService({
        evolution: { getGeneration: vi.fn() } as Pick<EvolutionStore, 'getGeneration'>,
        shadow: {
          available: () => true,
          launchAutomaticExact: vi.fn(),
        } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
        signals: { list: vi.fn() } as Pick<FeedbackSignalStore, 'list'>,
        targets,
        inflight: [clearInflight()],
        budget: allowingBudget(),
      })

    expect(make([])).toThrow('automatic Feedback Shadow requires 1-20 exact targets')
    expect(make([{ ...target(), casePackHash: 'mutable' }]))
      .toThrow('automatic Feedback Shadow Case Pack hashes must be exact')
    expect(make([target(), { ...target(), id: 'duplicate-skill' }]))
      .toThrow('automatic Feedback Shadow permits exactly one target per Workspace and Skill')
    expect(make([{ ...target(), maxAttemptsPerUtcDay: 21 }]))
      .toThrow('automatic Feedback Shadow daily attempt limits must be integers between 1 and 20')
    expect(make([{ ...target(), maxPendingReviewAgeHours: 0 }]))
      .toThrow('automatic Feedback Shadow pending review ages must be integer hours between 1 and 2160')
    expect(make([{ ...target(), maxPendingReviewAgeHours: 2_161 }]))
      .toThrow('automatic Feedback Shadow pending review ages must be integer hours between 1 and 2160')
  })

  it('defers a new signal without launching when the durable UTC-day budget is exhausted', async () => {
    let now = Date.UTC(2026, 7, 17, 12)
    let exhausted = true
    const reserve = vi.fn(async (): Promise<AutomaticEvolutionBudgetReservation> => exhausted
      ? ({
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
        })
      : ({
          allowed: true,
          newlyReserved: true,
          snapshot: {
            workspaceId: WORKSPACE_ID,
            targetId: 'plugin-delivery',
            skillName: 'stable-skill',
            utcDay: '2026-08-18',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        }))
    const launchAutomaticExact = vi.fn()
    const service = new AutomaticFeedbackShadowService({
      evolution: generationStore(),
      shadow: {
        available: () => true,
        launchAutomaticExact,
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: oneSignal(),
      targets: [target()],
      inflight: [clearInflight()],
      budget: {
        reserve,
        inspect: vi.fn(),
      },
      now: () => now,
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      launched: [],
      warnings: ['automatic evolution budget exhausted for Target plugin-delivery until the next UTC day'],
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ launched: [], warnings: [] })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(launchAutomaticExact).not.toHaveBeenCalled()

    now = Date.UTC(2026, 7, 18, 0, 1)
    exhausted = false
    launchAutomaticExact.mockResolvedValueOnce({
      schemaVersion: 1,
      action: 'start-shadow',
      workspaceId: WORKSPACE_ID,
      launchId: '4'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'stable-skill',
      runStatus: 'scheduled',
      jobId: 'job-1',
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toMatchObject({
      launched: [{ targetId: 'plugin-delivery', runStatus: 'scheduled' }],
      warnings: [],
    })
  })

  it('projects a fail-closed bounded status when the journal is unreadable', async () => {
    const service = new AutomaticFeedbackShadowService({
      evolution: generationStore(),
      shadow: {
        available: () => true,
        launchAutomaticExact: vi.fn(),
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: oneSignal(),
      targets: [target()],
      inflight: [clearInflight()],
      budget: {
        reserve: vi.fn(),
        inspect: vi.fn(async () => { throw new Error('corrupt') }),
      },
      now: () => Date.UTC(2026, 7, 17),
    })

    await expect(service.budgetStatus()).resolves.toEqual({
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
  })

  it('defers before budget while one Skill has unresolved work and resumes when it clears', async () => {
    let status: 'clear' | 'busy' | 'unknown' = 'busy'
    const automaticInflightStatus = vi.fn(async () => status)
    const reserve = vi.fn(async input => ({
      allowed: true as const,
      newlyReserved: true as const,
        snapshot: {
        workspaceId: WORKSPACE_ID,
        targetId: input.id,
        skillName: input.skill,
        utcDay: '2026-08-17',
        used: 1,
        limit: input.maxAttemptsPerUtcDay,
        remaining: input.maxAttemptsPerUtcDay - 1,
      },
    }))
    const launchAutomaticExact = vi.fn(async () => ({
      schemaVersion: 1 as const,
      action: 'start-shadow' as const,
      workspaceId: WORKSPACE_ID,
      launchId: '4'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'stable-skill',
      runStatus: 'scheduled' as const,
      jobId: 'job-1',
    }))
    const service = new AutomaticFeedbackShadowService({
      evolution: generationStore(),
      shadow: {
        available: () => true,
        launchAutomaticExact,
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: {
        list: () => [
          ...oneSignal().list(),
          { ...oneSignal().list()[0]!, id: '2'.repeat(64), messageId: 'message-2' },
        ],
      },
      targets: [target()],
      inflight: [{ automaticInflightStatus }],
      budget: { reserve, inspect: vi.fn() },
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      launched: [],
      warnings: ['automatic evolution deferred for Skill stable-skill while prior work is unresolved'],
    })
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({ launched: [], warnings: [] })
    expect(reserve).not.toHaveBeenCalled()
    expect(launchAutomaticExact).not.toHaveBeenCalled()
    expect(automaticInflightStatus).toHaveBeenCalledTimes(2)

    status = 'clear'
    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toMatchObject({
      launched: [{ targetId: 'plugin-delivery', runStatus: 'scheduled' }],
      warnings: [],
    })
    expect(reserve).toHaveBeenCalledOnce()
    expect(launchAutomaticExact).toHaveBeenCalledOnce()
  })

  it('fails closed without spending when prior-work authority is unreadable', async () => {
    const reserve = vi.fn()
    const service = new AutomaticFeedbackShadowService({
      evolution: generationStore(),
      shadow: {
        available: () => true,
        launchAutomaticExact: vi.fn(),
      } as unknown as Pick<FeedbackShadowLauncher, 'available' | 'launchAutomaticExact'>,
      signals: oneSignal(),
      targets: [target()],
      inflight: [{ automaticInflightStatus: vi.fn(async () => 'unknown' as const) }],
      budget: { reserve, inspect: vi.fn() },
    })

    await expect(service.scanOnce(WORKSPACE_ID)).resolves.toEqual({
      launched: [],
      warnings: ['automatic evolution deferred because prior-work state is unavailable for Skill stable-skill'],
    })
    expect(reserve).not.toHaveBeenCalled()
  })
})

function target(): AutomaticFeedbackShadowTarget {
  return {
    id: 'plugin-delivery',
    workspaceId: WORKSPACE_ID,
    skill: 'stable-skill',
    casePackDir: '/private/case-pack',
    casePackHash: '6'.repeat(64),
    runRoot: '/private/shadow-runs',
    maxAttemptsPerUtcDay: 1,
    maxPendingReviewAgeHours: 168,
  }
}

function allowingBudget(): Pick<AutomaticEvolutionBudget, 'reserve' | 'inspect'> {
  return {
    reserve: vi.fn(async target => ({
      allowed: true,
      newlyReserved: true,
      snapshot: {
        workspaceId: WORKSPACE_ID,
        targetId: target.id,
        skillName: target.skill,
        utcDay: '2026-08-17',
        used: 1,
        limit: target.maxAttemptsPerUtcDay,
        remaining: target.maxAttemptsPerUtcDay - 1,
      },
    })),
    inspect: vi.fn(),
  }
}

function generationStore(): Pick<EvolutionStore, 'getGeneration'> {
  return {
    getGeneration: () => ({
      id: '2'.repeat(64),
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      createdAt: 1,
      artifacts: [{
        kind: 'skill' as const,
        name: 'stable-skill',
        gitCommit: '3'.repeat(40),
        treeHash: '4'.repeat(40),
      }],
      evaluatorVersion: 'fixture-v1',
      policyVersion: 'fixture-v1',
      compositionFingerprint: '5'.repeat(64),
    }),
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

function clearInflight(): AutomaticEvolutionInflightSource {
  return { automaticInflightStatus: vi.fn(async () => 'clear' as const) }
}
