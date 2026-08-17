import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionAttentionOverview } from '../../src/attention.js'

const reviewId = 'a'.repeat(64)

export function apply(ctx: Context): void {
  const overview: EvolutionAttentionOverview = {
    reviews: {
      items: [{
        id: reviewId,
        status: 'pending',
        recommendation: 'review',
        skillName: 'delivery',
      }],
    },
  }
  ctx.provide('evoforge.evolutionControl', Object.freeze({
    overview: () => Promise.resolve(overview),
  }) as never)
}
