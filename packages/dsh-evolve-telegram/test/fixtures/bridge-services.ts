import type { Context } from '@deepseek-ai/cordis'
import type { EvolutionAttentionOverview } from '../../src/attention.js'

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
  ctx.provide('evoforge.telegramRoute', Object.freeze({
    notices,
    notify: (notice: TelegramHostNotice) => {
      notices.push(structuredClone(notice))
      return Promise.resolve({ created: true as const, status: 'prepared' as const })
    },
  }))
}
