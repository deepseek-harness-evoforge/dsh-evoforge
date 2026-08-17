import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionOverview } from 'dsh-evolve'

interface TelegramHostNotice {
  readonly id: string
  readonly text: string
}

export const reviewId = 'a'.repeat(64)
export const notices: TelegramHostNotice[] = []

export function reset(): void {
  notices.splice(0)
}

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
        claim: 'One bounded fixture review.',
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
  ctx.provide('evoforge.telegramRoute', Object.freeze({
    notices,
    notify: (notice: TelegramHostNotice) => {
      notices.push(structuredClone(notice))
      return Promise.resolve({ created: true as const, status: 'prepared' as const })
    },
  }))
}
