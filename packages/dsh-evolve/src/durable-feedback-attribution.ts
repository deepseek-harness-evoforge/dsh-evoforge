import { createHash } from 'node:crypto'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { durableSkillInvocations } from './durable-skill-invocation.ts'

export interface ExactSkillInvocationAttribution {
  readonly kind: 'exact-skill-invocation-v1'
  readonly skillName: string
  readonly route: 'user-explicit' | 'model-tool'
  readonly invocationSeq: number
  /** Exact hash of the durable content blocks the model saw for this invocation. */
  readonly invocationContentHash?: string | undefined
  readonly assistantSeq: number
  readonly turn: number
  readonly goal: {
    readonly id: string
    readonly revision: number
  }
}

/**
 * Resolve one native feedback target from the exact durable Session log.
 * Ambiguous turns abstain; no transcript, Skill body, or feedback text leaves
 * this module's interface.
 */
export class DurableFeedbackAttribution {
  private readonly persistence: Pick<SessionPersistence, 'inspect'>

  constructor(
    persistence: Pick<SessionPersistence, 'inspect'>,
  ) {
    this.persistence = persistence
  }

  async resolve(
    sessionId: string,
    assistantMessageId: string,
  ): Promise<ExactSkillInvocationAttribution | undefined> {
    const stored = await this.persistence.inspect(sessionId as SessionId)
    if (String(stored.meta.id) !== sessionId) return undefined
    const assistants = stored.events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message'
      && String(event.data.message.id) === assistantMessageId)
    if (assistants.length !== 1) return undefined
    const assistant = assistants[0]!
    const turnStart = [...stored.events].reverse().find(event =>
      event.seq < assistant.seq
      && event.type === 'turn/start'
      && event.data.turn === assistant.data.turn)
    if (turnStart === undefined) return undefined
    const turnEvents = stored.events.filter(event =>
      event.seq > turnStart.seq && event.seq <= assistant.seq)
    const direct = turnEvents.filter(event =>
      event.type === 'user/message' && sourceKind(event.data.source) === 'user')
    if (direct.length !== 1) return undefined

    const invocations = durableSkillInvocations(turnEvents)
    if (invocations.length !== 1) return undefined
    let goal
    try {
      goal = foldGoal(stored.events.filter(event => event.seq <= assistant.seq)).goal
    } catch {
      return undefined
    }
    if (goal === undefined) return undefined
    const invocation = invocations[0]!
    return Object.freeze({
      kind: 'exact-skill-invocation-v1',
      skillName: invocation.skillName,
      route: invocation.route,
      invocationSeq: invocation.seq,
      invocationContentHash: hashContent(invocation.content),
      assistantSeq: assistant.seq,
      turn: assistant.data.turn,
      goal: Object.freeze({ id: String(goal.id), revision: goal.revision }),
    })
  }
}

function hashContent(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

function sourceKind(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}
