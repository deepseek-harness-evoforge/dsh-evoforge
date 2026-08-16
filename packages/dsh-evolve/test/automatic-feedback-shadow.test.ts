import { describe, expect, it, vi } from 'vitest'
import {
  AutomaticFeedbackShadowService,
  type AutomaticFeedbackShadowTarget,
} from '../src/automatic-feedback-shadow.ts'
import type { EvolutionStore } from '../src/generation-store.ts'
import type { FeedbackSignalStore } from '../src/feedback-signal-monitor.ts'
import type { FeedbackShadowLauncher } from '../src/feedback-shadow-launcher.ts'

describe('automatic Feedback Shadow', () => {
  it('launches one exact Target for an explicit signal with one matching Generation Skill', async () => {
    const launchAutomaticExact = vi.fn(async () => ({
      schemaVersion: 1 as const,
      action: 'start-shadow' as const,
      launchId: '4'.repeat(64),
      targetId: 'plugin-delivery',
      skillName: 'stable-skill',
      runStatus: 'scheduled' as const,
      jobId: 'job-1',
    }))
    const service = new AutomaticFeedbackShadowService({
      evolution: {
        getGeneration: () => ({
          id: '2'.repeat(64),
          schemaVersion: 1,
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
          schemaVersion: 1 as const,
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
    })

    await expect(service.scanOnce()).resolves.toEqual({
      launched: [{
        signalId: '1'.repeat(64),
        targetId: 'plugin-delivery',
        runStatus: 'scheduled',
      }],
      warnings: [],
    })
    expect(launchAutomaticExact).toHaveBeenCalledWith('1'.repeat(64), target())
  })

  it('leaves a signal with multiple matching Generation Skills for explicit target selection', async () => {
    const launchAutomaticExact = vi.fn()
    const service = new AutomaticFeedbackShadowService({
      evolution: {
        getGeneration: () => ({
          id: '2'.repeat(64),
          schemaVersion: 1,
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
        schemaVersion: 1 as const,
        id: '1'.repeat(64),
        observedAt: 1,
        sessionId: 'session-1',
        messageId: 'message-1',
        feedbackVersion: '00000000-0000-4000-8000-000000000001',
        sourceUpdatedAt: 2,
        generationId: '2'.repeat(64),
      }] } as Pick<FeedbackSignalStore, 'list'>,
      targets: [target(), { ...target(), id: 'other-target', skill: 'other-skill' }],
    })

    await expect(service.scanOnce()).resolves.toEqual({
      launched: [],
      warnings: ['explicit feedback matches multiple automatic Shadow Targets; choose one explicitly'],
    })
    await expect(service.scanOnce()).resolves.toEqual({ launched: [], warnings: [] })
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
      })

    expect(make([])).toThrow('automatic Feedback Shadow requires 1-20 exact targets')
    expect(make([{ ...target(), casePackHash: 'mutable' }]))
      .toThrow('automatic Feedback Shadow Case Pack hashes must be exact')
    expect(make([target(), { ...target(), id: 'duplicate-skill' }]))
      .toThrow('automatic Feedback Shadow permits exactly one target per Skill')
  })
})

function target(): AutomaticFeedbackShadowTarget {
  return {
    id: 'plugin-delivery',
    skill: 'stable-skill',
    casePackDir: '/private/case-pack',
    casePackHash: '6'.repeat(64),
    runRoot: '/private/shadow-runs',
  }
}
