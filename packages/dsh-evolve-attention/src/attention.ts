import { createHash } from 'node:crypto'

const CONTENT_ID = /^[a-f0-9]{64}$/u

/** Minimal read contract projected from dsh-evolve; the bridge does not depend on its generated types. */
export interface EvolutionAttentionOverview {
  readonly workspaceId: string
  readonly reviews: { readonly items: readonly EvolutionAttentionReview[] }
}

export interface EvolutionAttentionReview {
  readonly id: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly recommendation: 'promote' | 'review'
  readonly skillName: string
  readonly decisionActor?: 'human' | 'auto-clear-instruction-v1'
  readonly generationId?: string
  readonly activatedAt?: string
}

export interface EvolutionAttentionNotice {
  readonly id: string
  readonly text: string
  readonly kind: 'candidate-review' | 'candidate-promotion'
}

/** Project bounded host facts only; a channel notice never becomes model input or approval. */
export function projectEvolutionAttention(
  overview: EvolutionAttentionOverview,
): EvolutionAttentionNotice[] {
  const notices: EvolutionAttentionNotice[] = []
  for (const review of overview.reviews.items) {
    const notice = candidateNotice(review)
    if (notice !== undefined) notices.push(notice)
  }
  return notices
}

function candidateNotice(review: EvolutionAttentionReview): EvolutionAttentionNotice | undefined {
  if (!CONTENT_ID.test(review.id)) return undefined
  const stage = review.status === 'pending'
    ? 'review'
    : review.status === 'approved'
      && review.decisionActor === 'auto-clear-instruction-v1'
      && review.generationId !== undefined
      && review.activatedAt === undefined
        ? 'promotion'
        : undefined
  if (stage === undefined) return undefined
  const promotion = stage === 'promotion'
  return {
    id: noticeId('candidate', review.id, stage),
    kind: promotion ? 'candidate-promotion' : 'candidate-review',
    text: [
      'EvoForge attention',
      promotion
        ? 'An inactive Candidate is ready for an explicit promotion decision.'
        : 'A Candidate review needs your decision.',
      `Skill: ${safeLabel(review.skillName)}`,
      `Recommendation: ${review.recommendation}`,
      `ID: ${review.id}`,
      `Inspect: /evolve review ${review.id}`,
      'The original Session continues. This message is not approval.',
    ].join('\n'),
  }
}

function noticeId(kind: string, id: string, stage: string): string {
  return createHash('sha256').update(`${kind}\0${id}\0${stage}`).digest('hex')
}

function safeLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim()
  if (normalized.length === 0) return '(unknown)'
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 79)}…`
}
