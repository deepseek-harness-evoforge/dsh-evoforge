import { describe, expect, it } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { DurableFeedbackAttribution } from '../src/durable-feedback-attribution.ts'

describe('DurableFeedbackAttribution', () => {
  it('resolves one feedback target to its exact successful Skill invocation and Goal', async () => {
    await expect(resolve(validEvents(), 'assistant-1')).resolves.toEqual({
      kind: 'exact-skill-invocation-v1',
      skillName: 'release-dsh-plugin',
      route: 'model-tool',
      invocationSeq: 3,
      assistantSeq: 5,
      turn: 1,
      goal: { id: 'goal-release', revision: 1 },
    })
  })

  it('abstains when a model Skill call has no source-linked successful result', async () => {
    const events = validEvents().filter(candidate => candidate.type !== 'tool/result')
    await expect(resolve(events, 'assistant-1')).resolves.toBeUndefined()
  })

  it('abstains when the target turn contains more than one successful Skill invocation', async () => {
    const events = validEvents()
    const assistant = events.pop()!
    events.push(
      event('user/message', 5, {
        id: 'skill-explicit',
        role: 'user',
        source: { kind: 'skill-invocation', name: 'review-dsh-plugin' },
        content: [{ type: 'text', text: '<skill_content />' }],
      }) as SessionEvent,
      { ...assistant, seq: 6, time: 7 },
    )
    await expect(resolve(events, 'assistant-1')).resolves.toBeUndefined()
  })

  it('abstains when the target turn has no exact native Goal identity', async () => {
    const events = validEvents().filter(candidate => candidate.type !== 'goal/change')
    await expect(resolve(events, 'assistant-1')).resolves.toBeUndefined()
  })

  it('abstains when feedback does not identify one durable assistant message', async () => {
    await expect(resolve(validEvents(), 'missing-assistant')).resolves.toBeUndefined()
  })
})

function resolve(events: SessionEvent[], assistantMessageId: string) {
  return new DurableFeedbackAttribution({
    inspect: async () => ({
      meta: { version: 0, id: SessionId('session-1'), createdAt: 1, cwd: '/private/project' },
      events,
    }),
  }).resolve('session-1', assistantMessageId)
}

function validEvents(): SessionEvent[] {
  return [
    event('goal/change', 0, {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: 'goal-release',
        revision: 1,
        objective: 'Release one verified native DSH plugin.',
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, {
      id: 'user-1',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Release it safely.' }],
    }),
    event('tool/call', 3, {
      turn: 1,
      step: 1,
      callId: 'call-skill',
      name: 'skill',
      arguments: '{"name":"release-dsh-plugin"}',
    }),
    {
      ...event('tool/result', 4, {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          source: { type: 'tool-result', callId: 'call-skill' },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-skill',
            content: [{ type: 'text', text: '<skill_content />' }],
            isError: false,
          }],
        },
      }),
      sourceEventSeqs: [3],
    },
    event('assistant/message', 5, {
      turn: 1,
      step: 2,
      message: {
        id: 'assistant-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text: 'Released.' }],
      },
    }),
  ] as SessionEvent[]
}

function event(type: string, seq: number, data: unknown): Record<string, unknown> {
  return { type, seq, time: seq + 1, data }
}
