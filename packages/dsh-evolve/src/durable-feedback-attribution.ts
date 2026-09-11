import { foldGoal } from '@deepseek-ai/dsh-goal'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  durableSkillInvocations,
  hashDurableSkillInvocationContent,
} from './durable-skill-invocation.ts'
import {
  readInteractionSessionStoredCutV1,
  sessionPersistenceReadTimeoutMs,
  type InteractionSessionPersistenceReadPortV1,
} from './interaction-session-persistence-read.ts'

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

export interface DurableFeedbackStoredSession {
  readonly meta: SessionHeader
  readonly inheritedEventCount: number
  readonly fromSeq: number
  readonly events: readonly SessionEvent[]
}

export interface DurableFeedbackAttributionOptions {
  readonly lifecycle: Pick<Context, 'effect'>
  readonly sessionPersistenceReadTimeoutMs?: number
}

/**
 * Resolve one native feedback target from the exact durable Session log.
 * Ambiguous turns abstain; no transcript, Skill body, or feedback text leaves
 * this module's interface.
 */
export class DurableFeedbackAttribution {
  private readonly persistence: InteractionSessionPersistenceReadPortV1
  private readonly lifecycle: Pick<Context, 'effect'>
  private readonly timeoutMs: number

  constructor(
    persistence: InteractionSessionPersistenceReadPortV1,
    options: DurableFeedbackAttributionOptions,
  ) {
    this.persistence = persistence
    this.lifecycle = options.lifecycle
    this.timeoutMs = sessionPersistenceReadTimeoutMs(options.sessionPersistenceReadTimeoutMs)
  }

  async resolve(
    sessionId: string,
    assistantMessageId: string,
  ): Promise<ExactSkillInvocationAttribution | undefined> {
    const stored = await this.readStoredSession(sessionId)
    return this.resolveStored(stored, sessionId, assistantMessageId)
  }

  async readStoredSession(
    sessionId: string,
    requiredEventCount = Number.MAX_SAFE_INTEGER,
  ): Promise<DurableFeedbackStoredSession> {
    const candidate = await readInteractionSessionStoredCutV1(
      this.persistence,
      sessionId as SessionId,
      {
        lifecycle: this.lifecycle,
        timeoutMs: this.timeoutMs,
        requiredEventCount,
      },
    )
    return durableFeedbackStoredSession(candidate, sessionId)
  }

  resolveStored(
    candidate: unknown,
    sessionId: string,
    assistantMessageId: string,
  ): ExactSkillInvocationAttribution | undefined {
    const stored = durableFeedbackStoredSession(candidate, sessionId)
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
      invocationContentHash: hashDurableSkillInvocationContent(invocation.content),
      assistantSeq: assistant.seq,
      turn: assistant.data.turn,
      goal: Object.freeze({ id: String(goal.id), revision: goal.revision }),
    })
  }
}

function durableFeedbackStoredSession(
  candidate: unknown,
  expectedSessionId: string,
): DurableFeedbackStoredSession {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('durable feedback Session read returned no stored cut')
  }
  const stored = candidate as {
    readonly meta?: unknown
    readonly inheritedEventCount?: unknown
    readonly fromSeq?: unknown
    readonly events?: unknown
  }
  if (stored.meta === null || typeof stored.meta !== 'object' || Array.isArray(stored.meta)
    || !Array.isArray(stored.events)
    || stored.fromSeq !== 0
    || !nonNegativeSafeInteger(stored.inheritedEventCount)) {
    throw new Error('durable feedback Session read returned a malformed stored cut')
  }
  let detached: DurableFeedbackStoredSession
  try {
    detached = structuredClone({
      meta: stored.meta,
      inheritedEventCount: stored.inheritedEventCount,
      fromSeq: stored.fromSeq,
      events: stored.events,
    }) as DurableFeedbackStoredSession
  } catch {
    throw new Error('durable feedback Session read returned an unclonable stored cut')
  }
  if (String(detached.meta.id) !== expectedSessionId) {
    throw new Error('durable feedback Session read returned the wrong Session')
  }
  return detached
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return typeof candidate === 'number'
    && Number.isSafeInteger(candidate)
    && candidate >= 0
    && !Object.is(candidate, -0)
}

function sourceKind(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : undefined
}
