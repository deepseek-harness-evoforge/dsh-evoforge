import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  projectEvolutionAttention,
  type EvolutionAttentionOverview,
} from '../src/attention.js'

const candidateId = 'a'.repeat(64)
const evaluatorId = 'b'.repeat(64)

describe('Evolve Telegram attention projection', () => {
  it('projects only states that require a human action', () => {
    const notices = projectEvolutionAttention(overview({
      review: {
        id: candidateId,
        status: 'pending',
        recommendation: 'review',
        skillName: 'software-delivery',
        claim: 'Keep the delivery verifier deterministic.',
      },
      evaluator: {
        id: evaluatorId,
        status: 'draft-ready',
        skillName: 'software-delivery',
      },
    }))

    expect(notices).toHaveLength(2)
    expect(notices[0]).toMatchObject({
      id: digest(`candidate\0${candidateId}\0review`),
      kind: 'candidate-review',
    })
    expect(notices[0]?.text).toContain(`/evolve review ${candidateId}`)
    expect(notices[0]?.text).toContain('This message is not approval')
    expect(notices[1]).toMatchObject({
      id: digest(`evaluator\0${evaluatorId}\0draft-ready`),
      kind: 'evaluator-draft',
    })
    expect(notices[1]?.text).toContain(`/evolve evaluator ${evaluatorId}`)
  })

  it.each(['uncertain', 'draft-ready', 'incomplete'] as const)(
    'notifies the evaluator %s decision stage with a distinct durable id',
    (status) => {
      const notices = projectEvolutionAttention(overview({
        evaluator: { id: evaluatorId, status, skillName: 'delivery' },
      }))
      expect(notices).toHaveLength(1)
      expect(notices[0]?.id).toBe(digest(`evaluator\0${evaluatorId}\0${status}`))
    },
  )

  it.each(['authoring-pending', 'qualification-running', 'qualified', 'rejected'] as const)(
    'does not notify evaluator state %s because no immediate human action is available',
    (status) => {
      expect(projectEvolutionAttention(overview({
        evaluator: { id: evaluatorId, status, skillName: 'delivery' },
      }))).toEqual([])
    },
  )

  it('distinguishes an auto-approved inactive Candidate from a pending review', () => {
    const notices = projectEvolutionAttention(overview({
      review: {
        id: candidateId,
        status: 'approved',
        recommendation: 'promote',
        skillName: 'delivery',
        claim: 'Clear instruction-only improvement.',
        decisionActor: 'auto-clear-instruction-v1',
        generationId: 'c'.repeat(64),
      },
    }))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      id: digest(`candidate\0${candidateId}\0promotion`),
      kind: 'candidate-promotion',
    })
  })

  it.each([
    { decisionActor: 'human' as const },
    { decisionActor: 'auto-clear-instruction-v1' as const, activatedAt: '2026-08-17T00:01:00.000Z' },
  ])('does not notify an already handled approved Candidate: $decisionActor', (extra) => {
    expect(projectEvolutionAttention(overview({
      review: {
        id: candidateId,
        status: 'approved',
        recommendation: 'promote',
        skillName: 'delivery',
        claim: 'Already handled.',
        generationId: 'c'.repeat(64),
        ...extra,
      },
    }))).toEqual([])
  })

  it('keeps sensitive host facts out of deterministic bounded text', () => {
    const notices = projectEvolutionAttention(overview({
      review: {
        id: candidateId,
        status: 'pending',
        recommendation: 'review',
        skillName: 'delivery',
        claim: `safe${'x'.repeat(1_000)} /private/run secret-token`,
      },
    }))
    expect(notices[0]?.text.length).toBeLessThanOrEqual(1_024)
    expect(notices[0]?.text).not.toContain('/private/run')
    expect(notices[0]?.text).not.toContain('secret-token')
  })
})

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function overview(input: {
  review?: {
    id: string
    status: 'pending' | 'approved' | 'rejected'
    recommendation: 'promote' | 'review'
    skillName: string
    claim: string
    decisionActor?: 'human' | 'auto-clear-instruction-v1' | 'auto-review-expiry-v1'
    generationId?: string
    activatedAt?: string
  }
  evaluator?: {
    id: string
    status: 'authoring-pending' | 'uncertain' | 'draft-ready' | 'qualification-running' | 'qualified' | 'incomplete' | 'rejected'
    skillName: string
  }
} = {}): EvolutionAttentionOverview {
  const review = input.review === undefined ? [] : [{
    id: input.review.id,
    status: input.review.status,
    recommendation: input.review.recommendation,
    skillName: input.review.skillName,
    ...(input.review.decisionActor === undefined ? {} : { decisionActor: input.review.decisionActor }),
    ...(input.review.generationId === undefined ? {} : { generationId: input.review.generationId }),
    ...(input.review.activatedAt === undefined ? {} : { activatedAt: input.review.activatedAt }),
  }]
  const evaluator = input.evaluator === undefined ? [] : [{
    id: input.evaluator.id,
    status: input.evaluator.status,
    skillName: input.evaluator.skillName,
  }]
  return {
    evaluatorAuthoring: {
      drafts: evaluator,
    },
    reviews: {
      items: review,
    },
  }
}
