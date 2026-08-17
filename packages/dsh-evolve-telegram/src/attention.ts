import { createHash } from 'node:crypto'
import type {
  EvolutionEvaluatorDraftView,
  EvolutionOverview,
  EvolutionReviewView,
} from 'dsh-evolve'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const EVALUATOR_ACTIONS = new Set<EvolutionEvaluatorDraftView['status']>([
  'uncertain',
  'draft-ready',
  'incomplete',
])

export interface EvolutionAttentionNotice {
  readonly id: string
  readonly text: string
  readonly kind: 'candidate-review' | 'candidate-promotion' | 'evaluator-draft'
}

/** Project bounded host facts only; the Telegram message never becomes model input or approval. */
export function projectEvolutionAttention(
  overview: EvolutionOverview,
): EvolutionAttentionNotice[] {
  const notices: EvolutionAttentionNotice[] = []
  for (const review of overview.reviews.items) {
    const notice = candidateNotice(review)
    if (notice !== undefined) notices.push(notice)
  }
  for (const draft of overview.evaluatorAuthoring?.drafts ?? []) {
    const notice = evaluatorNotice(draft)
    if (notice !== undefined) notices.push(notice)
  }
  return notices
}

function candidateNotice(review: EvolutionReviewView): EvolutionAttentionNotice | undefined {
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

function evaluatorNotice(
  draft: EvolutionEvaluatorDraftView,
): EvolutionAttentionNotice | undefined {
  if (!CONTENT_ID.test(draft.id) || !EVALUATOR_ACTIONS.has(draft.status)) return undefined
  return {
    id: noticeId('evaluator', draft.id, draft.status),
    kind: 'evaluator-draft',
    text: [
      'EvoForge attention',
      'An Evaluator Draft needs your decision.',
      `Skill: ${safeLabel(draft.skillName)}`,
      `Status: ${draft.status}`,
      `ID: ${draft.id}`,
      `Inspect: /evolve evaluator ${draft.id}`,
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
