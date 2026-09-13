import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { foldTranscriptGoal } from '../src/interaction-goal-witness.ts'
import type { TranscriptEvent } from '../src/interaction-transcript-types.ts'

const create = { type: 'goal/change', seq: 0, time: 900, data: {
  kind: 'goal/change', version: 1, operation: 'create',
  goal: { id: 'goal', revision: 1, objective: 'Fixture objective.', phase: 'active', maxGoalRounds: 8 },
  roundsStarted: 0, createdAt: 900, updatedAt: 900,
} }
const round = (value: number) => ({ type: 'user/message', seq: 1, time: 1_000, surfaceOp: 'append', data: {
  id: 'round', role: 'user', source: { kind: 'goal', goalId: 'goal', revision: 1, round: value }, content: [],
} })

describe('historical Goal fact projection', () => {
  it('keeps native admitted-round accounting and does not mutate source metadata', () => {
    const events = [create, round(1), { type: 'assistant/chunk', seq: 2, time: 1_100, data: {} }]
    const before = structuredClone(events)
    expect(foldTranscriptGoal(events as unknown as TranscriptEvent[]))
      .toEqual(foldGoal(events as unknown as SessionEvent[]))
    expect(foldTranscriptGoal(events as unknown as TranscriptEvent[]).roundsStarted).toBe(1)
    expect(events).toEqual(before)
  })

  it.each([[round(1), create], [create, round(2)], [create, round(1), round(1)]])(
    'does not drop or reorder invalid Goal round claims %#', (...events) => {
      expect(() => foldGoal(events as unknown as SessionEvent[])).toThrow()
      expect(() => foldTranscriptGoal(events as unknown as TranscriptEvent[])).toThrow()
    },
  )
})
