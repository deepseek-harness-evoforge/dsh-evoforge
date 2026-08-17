import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionOverview } from 'dsh-evolve'

const reviewId = 'a'.repeat(64)

export function apply(ctx: Context): void {
  const overview: EvolutionOverview = {
    schemaVersion: 1,
    recovery: { available: true, paused: false },
    automaticPromotion: { enabled: false, skills: [] },
    reviews: {
      available: true,
      pendingCount: 1,
      actionableCount: 1,
      warningCount: 0,
      inactiveGenerations: [],
      items: [{
        id: reviewId,
        status: 'pending',
        recommendation: 'review',
        skillName: 'delivery',
        claim: 'Composition fixture.',
        changedFiles: ['SKILL.md'],
        candidateTreeHash: 'b'.repeat(64),
        cases: [],
        cost: { inputTokens: 1, outputTokens: 1, trialCount: 1 },
        reasons: [],
        limitations: [],
        evaluatorVersion: 'fixture-v1',
        compositionFingerprint: 'c'.repeat(64),
        compositionStable: true,
        startedAt: '2026-08-17T00:00:00.000Z',
      }],
    },
  }
  ctx.provide('evoforge.evolutionControl', Object.freeze({
    overview: () => Promise.resolve(overview),
  }) as never)
}
