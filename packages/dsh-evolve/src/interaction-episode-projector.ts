import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-agent'
import { foldGoal } from '@deepseek-ai/dsh-goal'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import {
  canonicalHeader,
  foldSurface,
  headerEquals,
  interruptedTurnClosers,
  isAppendSurfaceEvent,
  isReplacementSurfaceEvent,
  type Session,
  type SessionEvent,
  TOOL_NOT_STARTED,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'

/** Selects one direct AgentLoop Tool pair; nested PTC dispatches are not Episode-v1 triggers. */
export interface InteractionTranscriptDirectTriggerLocatorV1 {
  readonly callId: string
}

export interface InteractionEpisodeTranscriptProofV1 {
  readonly session: {
    readonly id: string
    readonly formatVersion: number
    readonly createdAt: number
    readonly inheritedEventCount: number
    readonly parentSessionId?: string | undefined
    /** Copied Session header metadata; this is not resolved composition evidence. */
    readonly agentPreset?: string | undefined
  }
  readonly source: {
    readonly turn: number
    readonly prefixThroughSeq: number | null
    readonly enqueueSeq: number
    readonly turnStartSeq: number
    readonly claimSeq: number
    readonly initiatingMessageSeq: number
    readonly triggerCallSeq: number
    readonly triggerResultSeq: number
    readonly turnEndSeq: number
    readonly completedAt: number
  }
  readonly witness: {
    readonly admissionStepStartSeq: number
    readonly triggerRequestSeq: number
    /** Effective durable route witnesses for settled assistant messages, not failed attempts. */
    readonly assistantRequestRoutes: readonly {
      readonly assistantMessageSeq: number
      readonly headerSeq: number
      readonly contextSeq: number
    }[]
  }
  readonly ingress: {
    readonly messageId: string
    readonly source: 'user'
    readonly digest: string
  }
  readonly trigger: {
    readonly kind: 'successful-gap-report' | 'skill-tool-error'
    readonly callId: string
    readonly requestedSkill: string
  }
  readonly replay: {
    readonly availability: 'source-dependent'
    /** The digests bind the exact events; they do not contain a transcript. */
    readonly transcript: 'exact'
    readonly prefixDigest: string
    readonly turnDigest: string
  }
  readonly goal?: {
    readonly id: string
    readonly revision: number
  } | undefined
}

export type InteractionEpisodeTranscriptProofResult =
  | { readonly status: 'proven'; readonly proof: InteractionEpisodeTranscriptProofV1 }
  | {
    readonly status: 'abstained'
    readonly reason:
      | 'turn-not-found'
      | 'turn-not-completed'
      | 'subagent-session'
      | 'human-ingress-not-proven'
      | 'trigger-not-proven'
      | 'tool-pairing-invalid'
      | 'request-not-proven'
      | 'causal-order-invalid'
      | 'turn-structure-invalid'
      | 'goal-mutated'
      | 'goal-not-proven'
      | 'transcript-not-proven'
  }

/**
 * Prove the Session-owned transcript portion of one prospective Interaction
 * Episode. Environment, Workspace, catalog, Generation, permission, sandbox,
 * budget, external-effect, and build-provenance facts stay outside this
 * module because the Session log does not authoritatively contain them.
 * Episode v1 selects only a direct AgentLoop `tool/call` + `tool/result` pair;
 * any nested PTC Gap dispatch makes this proof abstain because the durable
 * Episode schema has no transport or call-ancestry fields.
 * This result covers the immutable in-memory snapshot only. A caller MUST
 * await `ctx.sessions.flush(session)` and observe `true` before sealing the
 * proof as durable Episode provenance.
 */
export function proveInteractionEpisodeTranscript(
  session: Session,
  turnEndSeq: number,
  directTrigger: InteractionTranscriptDirectTriggerLocatorV1,
): InteractionEpisodeTranscriptProofResult {
  try {
    return proveInteractionEpisodeTranscriptUnchecked(session, turnEndSeq, directTrigger)
  } catch {
    return abstain('transcript-not-proven')
  }
}

function proveInteractionEpisodeTranscriptUnchecked(
  session: Session,
  turnEndSeq: number,
  directTrigger: InteractionTranscriptDirectTriggerLocatorV1,
): InteractionEpisodeTranscriptProofResult {
  const events = session.snapshotEvents()
  const turnEnd = events[turnEndSeq]
  if (turnEnd?.type !== 'turn/end') return abstain('turn-not-found')
  if (turnEnd.data.reason.kind !== 'completed') return abstain('turn-not-completed')
  if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) {
    return abstain('subagent-session')
  }

  const turn = turnEnd.data.turn
  const turnStarts = events.filter((event): event is SessionEvent<'turn/start'> =>
    event.type === 'turn/start'
    && event.data.turn === turn
    && event.seq < turnEnd.seq)
  if (turnStarts.length !== 1) return abstain('turn-not-found')
  const turnStart = turnStarts[0]!
  if (!hasValidCoreTrace(events, turnEnd)) {
    return abstain('turn-structure-invalid')
  }
  if (!hasValidRequestStateLog(events, turnEnd)) {
    return abstain('request-not-proven')
  }
  const firstStepStart = events.find((event): event is SessionEvent<'step/start'> =>
    event.type === 'step/start'
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq)
  const firstStepEnd = events.find((event): event is SessionEvent<'step/end'> =>
    event.type === 'step/end'
    && firstStepStart !== undefined
    && event.seq > firstStepStart.seq
    && event.seq < turnEnd.seq)
  if (firstStepStart === undefined || firstStepEnd === undefined) {
    return abstain('turn-structure-invalid')
  }
  const directMessages = events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq
    && event.data.source.kind === 'user')
  if (directMessages.length !== 1) return abstain('human-ingress-not-proven')
  const initiating = directMessages[0]!

  const ingress = findIngress(events, session, turnStart, turnEnd, initiating)
  if (ingress === undefined) return abstain('human-ingress-not-proven')
  const firstAdmittedMessage = events.find(event =>
    event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.seq > firstStepStart.seq
    && event.seq < firstStepEnd.seq)
  if (firstAdmittedMessage?.seq !== initiating.seq) {
    return abstain('human-ingress-not-proven')
  }

  const pair = findTriggerPair(events, turnStart, turnEnd, directTrigger)
  if (pair === undefined) return abstain('trigger-not-proven')
  if (!(ingress.enqueue.seq < turnStart.seq
    && turnStart.seq < ingress.claim.seq
    && ingress.claim.seq < firstStepStart.seq
    && firstStepStart.seq < initiating.seq
    && initiating.seq < firstStepEnd.seq
    && initiating.seq < pair.request.seq
    && pair.request.seq < pair.call.seq
    && pair.call.seq < pair.result.seq
    && pair.result.seq < turnEnd.seq)) return abstain('causal-order-invalid')
  if (gapTriggerCount(events, turnStart, turnEnd) !== 1) {
    return abstain('trigger-not-proven')
  }
  if (!allToolCallsArePairedThrough(events, turnEnd)) {
    return abstain('tool-pairing-invalid')
  }
  if (!hasProvenStepContinuationsThrough(
    events,
    Number(session.inheritedEventCount),
    turnEnd,
  )) return abstain('turn-structure-invalid')
  if (!hasProvenCompletedTurnStructure(
    events,
    Number(session.inheritedEventCount),
    turnStart,
    turnEnd,
  )) {
    return abstain('turn-structure-invalid')
  }
  const assistantRequestRoutes = proveAssistantRequestRoutes(events, turnStart, turnEnd)
  if (assistantRequestRoutes === undefined) return abstain('request-not-proven')
  if (!humanIngressRemainsVisibleAtRequest(events, initiating, pair.request)) {
    return abstain('human-ingress-not-proven')
  }
  const pendingNextStep = pendingNextStepAt(events, session.inheritedEventCount, turnEnd)
  if (pendingNextStep === undefined) return abstain('turn-structure-invalid')
  if (pendingNextStep.some(message => message.source.kind === 'user')) {
    return abstain('human-ingress-not-proven')
  }
  if (pendingNextStep.length > 0) return abstain('turn-structure-invalid')
  if (events.some(event => event.type === 'goal/change'
    && event.seq >= ingress.enqueue.seq
    && event.seq <= turnEnd.seq)) return abstain('goal-mutated')

  const { header } = session
  const source = {
    turn,
    prefixThroughSeq: ingress.enqueue.seq === 0 ? null : Number(ingress.enqueue.seq) - 1,
    enqueueSeq: Number(ingress.enqueue.seq),
    turnStartSeq: Number(turnStart.seq),
    claimSeq: Number(ingress.claim.seq),
    initiatingMessageSeq: Number(initiating.seq),
    triggerCallSeq: Number(pair.call.seq),
    triggerResultSeq: Number(pair.result.seq),
    turnEndSeq: Number(turnEnd.seq),
    completedAt: turnEnd.time,
  }
  const sessionIdentity = {
    id: String(header.id),
    formatVersion: header.version,
    createdAt: header.createdAt,
  }
  const prefixEvents = events.slice(0, source.enqueueSeq)
  const turnEvents = events.slice(source.enqueueSeq, source.turnEndSeq + 1)
  let goal: InteractionEpisodeTranscriptProofV1['goal']
  try {
    const durableGoal = foldGoal(prefixEvents).goal
    if (durableGoal?.phase === 'active') {
      goal = { id: String(durableGoal.id), revision: durableGoal.revision }
    }
  } catch {
    return abstain('goal-not-proven')
  }
  return {
    status: 'proven',
    proof: immutableCopy({
      session: {
        ...sessionIdentity,
        inheritedEventCount: Number(session.inheritedEventCount),
        ...(header.parentSession === undefined
          ? {}
          : { parentSessionId: String(header.parentSession) }),
        ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
      },
      source,
      witness: {
        admissionStepStartSeq: Number(firstStepStart.seq),
        triggerRequestSeq: Number(pair.request.seq),
        assistantRequestRoutes,
      },
      ingress: {
        messageId: String(initiating.data.id),
        source: 'user',
        digest: hashCanonical({
          domain: 'evoforge_interaction_episode_ingress',
          version: 1,
          session: sessionIdentity,
          enqueueSeq: source.enqueueSeq,
          messageId: String(initiating.data.id),
          event: ingress.enqueue,
        }),
      },
      trigger: {
        kind: pair.kind,
        callId: String(pair.call.data.callId),
        requestedSkill: pair.requestedSkill,
      },
      replay: {
        availability: 'source-dependent',
        transcript: 'exact',
        prefixDigest: hashCanonical({
          domain: 'evoforge_interaction_episode_prefix',
          version: 1,
          session: {
            header,
            inheritedEventCount: Number(session.inheritedEventCount),
          },
          throughSeq: source.prefixThroughSeq,
          events: prefixEvents,
        }),
        turnDigest: hashCanonical({
          domain: 'evoforge_interaction_episode_turn',
          version: 1,
          session: sessionIdentity,
          fromSeq: source.enqueueSeq,
          throughSeq: source.turnEndSeq,
          events: turnEvents,
        }),
      },
      ...(goal === undefined ? {} : { goal }),
    }),
  }
}

function gapTriggerCount(
  events: readonly SessionEvent[],
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
): number | undefined {
  const results = events.filter((event): event is SessionEvent<'tool/result'> =>
    event.type === 'tool/result'
    && isAppendSurfaceEvent(event)
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq)
  const nativeCount = events.filter((event): event is SessionEvent<'tool/call'> => {
    if (event.type !== 'tool/call'
      || event.seq <= turnStart.seq
      || event.seq >= turnEnd.seq) return false
    if (event.data.name === 'report_capability_gap') return true
    if (event.data.name !== 'skill') return false
    const matches = results.filter(result => resultLinksCall(result, event))
    return matches.length === 1 && matches[0]!.data.message.content[0].isError === true
  }).length
  const nestedCount = nestedGapTriggerCount(events, turnStart, turnEnd)
  if (nestedCount === undefined) return undefined
  return nativeCount + nestedCount
}

function nestedGapTriggerCount(
  events: readonly SessionEvent[],
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
): number | undefined {
  const starts = events.filter((event): event is SessionEvent<'tool/code-dispatch-start'> =>
    event.type === 'tool/code-dispatch-start'
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq)
  const settles = events.filter((event): event is SessionEvent<'tool/code-dispatch'> =>
    event.type === 'tool/code-dispatch'
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq)
  if (starts.length !== settles.length) return undefined
  const usedSettles = new Set<number>()
  let count = 0
  for (const start of starts) {
    const matches = settles.filter(settle => settle.seq > start.seq
      && String(settle.data.rootCallId) === String(start.data.rootCallId)
      && String(settle.data.parentCallId) === String(start.data.parentCallId)
      && String(settle.data.subCallId) === String(start.data.subCallId)
      && settle.data.name === start.data.name
      && canonicalEquals(settle.data.arguments, start.data.arguments))
    if (matches.length !== 1 || usedSettles.has(Number(matches[0]!.seq))) return undefined
    usedSettles.add(Number(matches[0]!.seq))
    if (start.data.name === 'report_capability_gap'
      || (start.data.name === 'skill' && matches[0]!.data.isError)) count++
  }
  return usedSettles.size === settles.length ? count : undefined
}

interface ProvenIngress {
  readonly enqueue: SessionEvent<'agent/inbox/spliced'>
  readonly claim: SessionEvent<'agent/inbox/spliced'>
}

function findIngress(
  events: readonly SessionEvent[],
  session: Session,
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
  initiating: SessionEvent<'user/message'>,
): ProvenIngress | undefined {
  const messageId = String(initiating.data.id)
  const state: Record<'next-turn' | 'next-step', SessionEvent<'user/message'>['data'][]> = {
    'next-turn': [],
    'next-step': [],
  }
  const enqueues: SessionEvent<'agent/inbox/spliced'>[] = []
  const claims: Array<{
    readonly event: SessionEvent<'agent/inbox/spliced'>
    readonly message: SessionEvent<'user/message'>['data']
  }> = []
  const humanRemovals: string[] = []

  for (const event of events) {
    if (event.seq >= turnEnd.seq) break
    if (event.seq < session.inheritedEventCount) continue
    if (event.type !== 'agent/inbox/spliced') continue
    const removed = applyInboxSplice(state, event)
    if (removed === undefined) return undefined
    const removedCount = event.data.removedCount ?? 0
    if (event.seq > turnStart.seq && event.data.outcome === undefined) {
      humanRemovals.push(...removed
        .filter(message => message.source.kind === 'user')
        .map(message => String(message.id)))
    }
    if (event.data.target === 'next-turn'
      && removedCount === 0
      && event.data.outcome === undefined
      && event.data.inserted.length === 1
      && String(event.data.inserted[0]?.id) === messageId
      && event.data.inserted[0]?.source.kind === 'user'
      && event.seq >= session.inheritedEventCount) enqueues.push(event)
    if (event.data.target === 'next-turn'
      && event.data.start === 0
      && event.data.outcome === undefined
      && event.data.inserted.length === 0
      && removed.length === 1
      && String(removed[0]?.id) === messageId
      && event.seq > turnStart.seq) claims.push({ event, message: removed[0]! })
  }

  if (enqueues.length !== 1
    || claims.length !== 1
    || humanRemovals.length !== 1
    || humanRemovals[0] !== messageId) return undefined
  const enqueue = enqueues[0]!
  const claimed = claims[0]!
  const claim = claimed.event
  if (!(enqueue.seq < turnStart.seq
    && turnStart.seq < claim.seq
    && claim.seq < initiating.seq)
    || !canonicalEquals(enqueue.data.inserted[0], initiating.data)
    || !canonicalEquals(claimed.message, initiating.data)) return undefined
  return { enqueue, claim }
}

function humanIngressRemainsVisibleAtRequest(
  events: readonly SessionEvent[],
  initiating: SessionEvent<'user/message'>,
  request: SessionEvent<'assistant/message'>,
): boolean {
  const firstChunkSeq = request.sourceEventSeqs?.map(Number).at(0)
  if (firstChunkSeq === undefined) return false
  const surface = foldSurface(events.slice(0, firstChunkSeq))
  let carrier = initiating.seq
  for (const replacement of surface.replacements) {
    if (!replacement.shadowedSeqs.includes(carrier)) continue
    const replacementEvent = events[Number(replacement.seq)]
    if (replacementEvent?.type !== 'user/message'
      || !canonicalEquals(replacementEvent.data, initiating.data)) return false
    carrier = replacement.seq
  }
  return surface.nodes.includes(carrier)
}

interface TriggerPair {
  readonly request: SessionEvent<'assistant/message'>
  readonly call: SessionEvent<'tool/call'>
  readonly result: SessionEvent<'tool/result'>
  readonly kind: InteractionEpisodeTranscriptProofV1['trigger']['kind']
  readonly requestedSkill: string
}

function findTriggerPair(
  events: readonly SessionEvent[],
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
  trigger: InteractionTranscriptDirectTriggerLocatorV1,
): TriggerPair | undefined {
  const calls = events.filter((event): event is SessionEvent<'tool/call'> =>
    event.type === 'tool/call'
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq
    && String(event.data.callId) === trigger.callId)
  if (calls.length !== 1) return undefined
  const call = calls[0]!
  if (call.data.name !== 'report_capability_gap' && call.data.name !== 'skill') {
    return undefined
  }
  const requestedSkill = parseRequestedSkill(call.data.arguments)
  if (requestedSkill === undefined) return undefined
  const results = events.filter((event): event is SessionEvent<'tool/result'> =>
    event.type === 'tool/result'
    && isAppendSurfaceEvent(event)
    && event.seq > call.seq
    && event.seq < turnEnd.seq
    && String(event.data.message.source.callId) === trigger.callId)
  if (results.length !== 1) return undefined
  const result = results[0]!
  if (!resultLinksCall(result, call)) return undefined
  const requests = toolRequests(events, turnStart, turnEnd).filter(request =>
    request.event.seq < call.seq
    && request.event.data.turn === call.data.turn
    && request.event.data.step === call.data.step
    && String(request.block.id) === String(call.data.callId)
    && request.block.name === call.data.name
    && request.block.arguments === call.data.arguments)
  if (requests.length !== 1) return undefined
  const block = result.data.message.content[0]
  const kind = call.data.name === 'report_capability_gap'
    ? 'successful-gap-report'
    : 'skill-tool-error'
  if ((kind === 'successful-gap-report'
      && (block.isError !== false || result.data.error !== undefined))
    || (kind === 'skill-tool-error' && block.isError !== true)) return undefined
  return { request: requests[0]!.event, call, result, kind, requestedSkill }
}

function allToolCallsArePairedThrough(
  events: readonly SessionEvent[],
  turnEnd: SessionEvent<'turn/end'>,
): boolean {
  const calls = events.filter((event): event is SessionEvent<'tool/call'> =>
    event.type === 'tool/call'
    && event.seq < turnEnd.seq)
  const results = events.filter((event): event is SessionEvent<'tool/result'> =>
    event.type === 'tool/result'
    && isAppendSurfaceEvent(event)
    && event.seq < turnEnd.seq)
  const requested = toolRequestsThrough(events, turnEnd)
  let callIndex = 0
  let resultIndex = 0
  const repairedAssistants = new Set<number>()
  for (const request of requested) {
    const call = calls[callIndex]
    const result = results[resultIndex]
    if (call !== undefined && callMatchesRequest(call, request)) {
      if (repairedAssistants.has(Number(request.event.seq))
        || result === undefined
        || request.event.seq >= call.seq
        || result.seq <= call.seq
        || !resultLinksCall(result, call)) return false
      callIndex++
      resultIndex++
      continue
    }
    if (result === undefined || !isNotStartedRepair(events, turnEnd, result, request)) return false
    repairedAssistants.add(Number(request.event.seq))
    resultIndex++
  }
  return callIndex === calls.length && resultIndex === results.length
}

function callMatchesRequest(
  call: SessionEvent<'tool/call'>,
  request: TranscriptToolRequest,
): boolean {
  return request.event.seq < call.seq
    && request.event.data.turn === call.data.turn
    && request.event.data.step === call.data.step
    && String(request.block.id) === String(call.data.callId)
    && request.block.name === call.data.name
    && request.block.arguments === call.data.arguments
}

function isNotStartedRepair(
  events: readonly SessionEvent[],
  through: SessionEvent<'turn/end'>,
  result: SessionEvent<'tool/result'>,
  request: TranscriptToolRequest,
): boolean {
  const callId = String(request.block.id)
  const block = result.data.message.content[0]
  const expectedSuffix = interruptedTurnClosers(events.slice(0, Number(result.seq)))
  const actualSuffix = events.slice(
    Number(result.seq),
    Number(result.seq) + expectedSuffix.length,
  )
  const expectedEnd = expectedSuffix.at(-1)
  return expectedSuffix[0]?.type === 'tool/result'
    && expectedEnd?.type === 'turn/end'
    && expectedEnd.seq <= through.seq
    && expectedEnd.data.reason.kind === 'interrupted'
    && canonicalEquals(actualSuffix, expectedSuffix)
    && request.event.seq < result.seq
    && result.data.turn === request.event.data.turn
    && result.data.step === request.event.data.step
    && result.sourceEventSeqs === undefined
    && result.data.error?.name === 'ToolNotStartedError'
    && result.data.error.code === TOOL_NOT_STARTED
    && String(result.data.message.id) === `interrupted-tool-result-${callId}-${result.seq}`
    && result.data.message.role === 'user'
    && result.data.message.source.kind === 'tool'
    && String(result.data.message.source.callId) === callId
    && block?.type === 'tool-result'
    && String(block.toolCallId) === callId
    && block.isError === true
    && block.content.length === 1
    && block.content[0]?.type === 'text'
    && block.content[0].text === 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.'
}

function toolRequestsThrough(
  events: readonly SessionEvent[],
  turnEnd: SessionEvent<'turn/end'>,
): TranscriptToolRequest[] {
  return events.flatMap(event => event.type === 'assistant/message'
    && isAppendSurfaceEvent(event)
    && event.data.interrupted !== true
    && event.seq < turnEnd.seq
    ? event.data.message.content.flatMap(block => block.type === 'tool-call'
      ? [{ event, block }]
      : [])
    : [])
}

function hasValidCoreTrace(
  events: readonly SessionEvent[],
  targetEnd: SessionEvent<'turn/end'>,
): boolean {
  let lastSeq = -1
  let openTurn: number | undefined
  let openStep: number | undefined
  let nextTurn = 1
  let nextStep = 1
  const pendingCalls = new Set<string>()
  const activeCodeRoots = new Set<string>()
  const dispatchStarts = new Map<string, {
    readonly root: string
    readonly parent: string
    readonly name: string
    readonly arguments: unknown
  }>()
  const settledDispatches = new Set<string>()

  for (const event of events) {
    if (event.seq > targetEnd.seq) break
    if (event.seq <= lastSeq) return false
    if (!hasValidCoreMessageShape(event)) return false
    lastSeq = Number(event.seq)
    switch (event.type) {
      case 'turn/start':
        if (openTurn !== undefined || event.data.turn !== nextTurn) return false
        openTurn = event.data.turn
        nextStep = 1
        break
      case 'turn/end':
        if (openTurn !== event.data.turn || openStep !== undefined) return false
        openTurn = undefined
        nextTurn++
        if (event.seq === targetEnd.seq) {
          return activeCodeRoots.size === 0
            && dispatchStarts.size === settledDispatches.size
        }
        break
      case 'step/start':
        if (openTurn !== event.data.turn
          || openStep !== undefined
          || event.data.step !== nextStep) return false
        openStep = event.data.step
        break
      case 'step/end':
        if (openTurn !== event.data.turn
          || openStep !== event.data.step
          || activeCodeRoots.size > 0) return false
        pendingCalls.clear()
        openStep = undefined
        nextStep++
        break
      case 'assistant/chunk':
      case 'assistant/message':
      case 'tool/call':
        if (openTurn !== event.data.turn || openStep !== event.data.step) return false
        if (event.type === 'tool/call') {
          const callId = String(event.data.callId)
          if (pendingCalls.has(callId)) return false
          pendingCalls.add(callId)
          if (event.data.name === 'run_code') activeCodeRoots.add(callId)
        }
        break
      case 'tool/result': {
        if (!isAppendSurfaceEvent(event)) {
          if (openTurn === undefined) return false
          break
        }
        if (openTurn !== event.data.turn || openStep !== event.data.step) return false
        const callId = String(event.data.message.source.callId)
        const block = event.data.message.content[0]
        const syntheticNotStarted = block.isError === true
          && event.data.error?.code === 'TOOL_NOT_STARTED'
        if (!pendingCalls.has(callId) && !syntheticNotStarted) return false
        if (activeCodeRoots.has(callId)) {
          const rootDispatches = [...dispatchStarts.entries()].filter(([, start]) =>
            start.root === callId)
          if (rootDispatches.some(([child]) => !settledDispatches.has(child))) return false
          for (const [child] of rootDispatches) {
            dispatchStarts.delete(child)
            settledDispatches.delete(child)
          }
          activeCodeRoots.delete(callId)
        }
        pendingCalls.delete(callId)
        break
      }
      case 'request/header':
      case 'request/context':
        if (openTurn === undefined || openStep === undefined) return false
        break
      case 'tool/code-dispatch-start':
      case 'tool/code-dispatch': {
        if (openTurn === undefined) return false
        const root = String(event.data.rootCallId)
        const parent = String(event.data.parentCallId)
        const child = String(event.data.subCallId)
        if (root.length === 0
          || parent.length === 0
          || child.length === 0
          || child === root
          || !activeCodeRoots.has(root)) return false
        if (event.type === 'tool/code-dispatch-start') {
          const parentStart = dispatchStarts.get(parent)
          if (dispatchStarts.has(child)
            || (parent !== root
              && (parentStart?.root !== root || settledDispatches.has(parent)))) return false
          dispatchStarts.set(child, {
            root,
            parent,
            name: event.data.name,
            arguments: event.data.arguments,
          })
          break
        }
        const start = dispatchStarts.get(child)
        if (start === undefined
          || settledDispatches.has(child)
          || start.root !== root
          || start.parent !== parent
          || start.name !== event.data.name
          || !canonicalEquals(start.arguments, event.data.arguments)) return false
        settledDispatches.add(child)
        break
      }
      default:
        break
    }
  }
  return false
}

function pendingNextStepAt(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  turnEnd: SessionEvent<'turn/end'>,
): readonly SessionEvent<'user/message'>['data'][] | undefined {
  const state: Record<'next-turn' | 'next-step', SessionEvent<'user/message'>['data'][]> = {
    'next-turn': [],
    'next-step': [],
  }
  for (const event of events) {
    if (event.seq < inheritedEventCount) continue
    if (event.seq > turnEnd.seq) break
    if (event.type !== 'agent/inbox/spliced') continue
    if (applyInboxSplice(state, event) === undefined) return undefined
  }
  return state['next-step']
}

type InboxState = Record<'next-turn' | 'next-step', SessionEvent<'user/message'>['data'][]>

function applyInboxSplice(
  state: InboxState,
  event: SessionEvent<'agent/inbox/spliced'>,
): SessionEvent<'user/message'>['data'][] | undefined {
  const queue = state[event.data.target]
  const removedCount = event.data.removedCount ?? 0
  if (!Number.isSafeInteger(event.data.start)
    || event.data.start < 0
    || event.data.start > queue.length
    || !Number.isSafeInteger(removedCount)
    || removedCount < 0
    || event.data.start + removedCount > queue.length) return undefined
  const removed = queue.slice(event.data.start, event.data.start + removedCount)
  const candidate = [
    ...queue.slice(0, event.data.start),
    ...event.data.inserted,
    ...queue.slice(event.data.start + removedCount),
  ]
  const allPending = event.data.target === 'next-turn'
    ? [...candidate, ...state['next-step']]
    : [...state['next-turn'], ...candidate]
  const ids = new Set<string>()
  for (const message of allPending) {
    const id = String(message.id)
    if (ids.has(id)) return undefined
    ids.add(id)
  }
  queue.splice(event.data.start, removedCount, ...event.data.inserted)
  return removed
}

function hasProvenCompletedTurnStructure(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
): boolean {
  interface OpenStep {
    readonly step: number
    readonly requiresAdmittedMessage: boolean
    admittedMessage: boolean
    modelStarted: boolean
    requestStarted: boolean
    assistant?: SessionEvent<'assistant/message'>
  }

  const turn = turnEnd.data.turn
  let expectedStep = 1
  let open: OpenStep | undefined
  let finalAssistant: SessionEvent<'assistant/message'> | undefined
  let previousStepEnd: SessionEvent<'step/end'> | undefined

  for (const event of events) {
    if (event.seq <= turnStart.seq || event.seq >= turnEnd.seq) continue
    if (event.type === 'turn/start' || event.type === 'turn/end') return false
    if (event.type === 'step/start') {
      if (open !== undefined
        || event.data.turn !== turn
        || event.data.step !== expectedStep) return false
      const requiresAdmittedMessage = finalAssistant !== undefined
        && previousStepEnd !== undefined
        && finalAssistant.data.message.content.every(block => block.type !== 'tool-call')
      if (requiresAdmittedMessage
        && !hasProvenNextStepClaim(events, inheritedEventCount, previousStepEnd!, event)) {
        return false
      }
      open = {
        step: expectedStep,
        requiresAdmittedMessage,
        admittedMessage: false,
        modelStarted: false,
        requestStarted: false,
      }
      continue
    }
    if (event.type === 'step/end') {
      if (open === undefined
        || event.data.turn !== turn
        || event.data.step !== open.step
        || open.assistant === undefined) return false
      finalAssistant = open.assistant
      previousStepEnd = event
      open = undefined
      expectedStep++
      continue
    }
    if (event.type === 'user/message' && isAppendSurfaceEvent(event)) {
      if (open === undefined || open.modelStarted || open.requestStarted) return false
      open.admittedMessage = true
      continue
    }
    if (event.type === 'request/header' || event.type === 'request/context') {
      if (open === undefined
        || open.assistant !== undefined
        || (open.requiresAdmittedMessage && !open.admittedMessage)) return false
      open.requestStarted = true
      continue
    }
    if (event.type === 'assistant/chunk') {
      if (open === undefined
        || (open.requiresAdmittedMessage && !open.admittedMessage)
        || event.data.turn !== turn
        || event.data.step !== open.step
        || open.assistant !== undefined) return false
      open.modelStarted = true
      continue
    }
    if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) {
      if (open === undefined
        || (open.requiresAdmittedMessage && !open.admittedMessage)
        || event.data.turn !== turn
        || event.data.step !== open.step
        || event.data.interrupted === true
        || open.assistant !== undefined
        || !assistantMatchesCitedChunks(events, event)) return false
      open.modelStarted = true
      open.assistant = event
      continue
    }
    if (event.type === 'tool/call') {
      if (open === undefined
        || event.data.turn !== turn
        || event.data.step !== open.step
        || open.assistant === undefined) return false
      continue
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      if (open === undefined
        || event.data.turn !== turn
        || event.data.step !== open.step
        || open.assistant === undefined) return false
    }
  }

  return open === undefined
    && expectedStep > 1
    && finalAssistant !== undefined
    && finalAssistant.data.message.content.every(block => block.type !== 'tool-call')
}

function hasProvenNextStepClaim(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  after: SessionEvent<'step/end'>,
  before: SessionEvent<'step/start'>,
): boolean {
  const state: InboxState = { 'next-turn': [], 'next-step': [] }
  let claims = 0
  for (const event of events) {
    if (event.seq < inheritedEventCount) continue
    if (event.seq >= before.seq) break
    if (event.type !== 'agent/inbox/spliced') continue
    const pendingNextStep = state['next-step'].length
    const removed = applyInboxSplice(state, event)
    if (removed === undefined) return false
    if (event.seq <= after.seq || event.data.target !== 'next-step') continue
    if (event.data.outcome === undefined
      && event.data.start === 0
      && event.data.inserted.length === 0
      && pendingNextStep > 0
      && event.data.removedCount === pendingNextStep
      && removed.length === pendingNextStep) claims++
  }
  return claims === 1
}

function hasProvenStepContinuationsThrough(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  turnEnd: SessionEvent<'turn/end'>,
): boolean {
  const steps = completedStepEnvelopes(events, turnEnd)
  for (const step of steps) {
    const admittedMessages = admittedMessagesBeforeModel(events, step)
    if (admittedMessages === undefined
      || (step.start.data.step === 1 && admittedMessages.length === 0)) return false
  }
  const completedTurnEnds = events.filter((event): event is SessionEvent<'turn/end'> =>
    event.type === 'turn/end'
    && event.seq <= turnEnd.seq
    && event.data.reason.kind === 'completed')
  for (const completedEnd of completedTurnEnds) {
    const turnSteps = steps.filter(step => step.end.data.turn === completedEnd.data.turn)
    if (turnSteps.length === 0) continue
    const last = turnSteps.at(-1)!
    const settledAssistants = events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.seq > last.start.seq
      && event.seq < last.end.seq)
    if (settledAssistants.length !== 1) return false
    const toolRequests = settledAssistants[0]!.data.message.content.filter(block =>
      block.type === 'tool-call')
    if (toolRequests.length > 0) {
      const toolResults = events.filter((event): event is SessionEvent<'tool/result'> =>
        event.type === 'tool/result'
        && isAppendSurfaceEvent(event)
        && event.seq > settledAssistants[0]!.seq
        && event.seq < last.end.seq
        && toolRequests.some(request =>
          String(request.id) === String(event.data.message.source.callId)))
      if (toolResults.length === toolRequests.length
        && toolResults.every(result => result.data.message.content[0].isError === true)) {
        return false
      }
    }
  }
  const turnEnds = events.filter((event): event is SessionEvent<'turn/end'> =>
    event.type === 'turn/end' && event.seq <= turnEnd.seq)
  for (const end of turnEnds) {
    const lastStep = steps.filter(step => step.end.data.turn === end.data.turn).at(-1)
    if (lastStep !== undefined
      && isFailedOnlyModelStep(events, lastStep)
      && end.data.reason.kind !== 'error'
      && end.data.reason.kind !== 'aborted') return false
    const assistants = events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.data.turn === end.data.turn
      && event.seq < end.seq)
    const hasMaxTokens = assistants.some(assistant =>
      citedAssistantFinishKind(events, assistant) === 'max-tokens')
    if ((end.data.reason.kind === 'completed' && hasMaxTokens)
      || (end.data.reason.kind === 'max-tokens' && !hasMaxTokens)) return false
  }
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1]!
    const current = steps[index]!
    if (previous.end.data.turn !== current.start.data.turn) continue
    const assistants = events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.seq > previous.start.seq
      && event.seq < previous.end.seq)
    if (assistants.length !== 1) return false
    if (assistants[0]!.data.message.content.some(block => block.type === 'tool-call')) continue
    const admittedMessages = admittedMessagesBeforeModel(events, current)
    if (!hasProvenNextStepClaim(
      events,
      inheritedEventCount,
      previous.end,
      current.start,
    ) || admittedMessages === undefined || admittedMessages.length === 0) return false
  }
  return true
}

function isFailedOnlyModelStep(
  events: readonly SessionEvent[],
  step: CompletedStepEnvelope,
): boolean {
  if (events.some(event =>
    event.type === 'assistant/message'
    && isAppendSurfaceEvent(event)
    && event.seq > step.start.seq
    && event.seq < step.end.seq)) return false
  const chunks = events.filter((event): event is SessionEvent<'assistant/chunk'> =>
    event.type === 'assistant/chunk'
    && event.data.turn === step.start.data.turn
    && event.data.step === step.start.data.step
    && event.seq > step.start.seq
    && event.seq < step.end.seq)
  if (chunks.length === 0) return false
  let attemptHasChunks = false
  for (const event of chunks) {
    attemptHasChunks = true
    if (event.data.chunk.type !== 'finish') continue
    if (event.data.chunk.reason.kind !== 'error'
      && event.data.chunk.reason.kind !== 'aborted') return false
    attemptHasChunks = false
  }
  return !attemptHasChunks
}

function admittedMessagesBeforeModel(
  events: readonly SessionEvent[],
  step: CompletedStepEnvelope,
): readonly SessionEvent<'user/message'>[] | undefined {
  const firstModelEvidence = events.find(event =>
    event.seq > step.start.seq
    && event.seq < step.end.seq
    && (event.type === 'request/header'
      || event.type === 'request/context'
      || event.type === 'assistant/chunk'
      || event.type === 'assistant/message'))
  if (firstModelEvidence === undefined) return undefined
  const admittedMessages = events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.seq > step.start.seq
    && event.seq < step.end.seq)
  return admittedMessages.every(message => message.seq < firstModelEvidence.seq)
    ? admittedMessages
    : undefined
}

function citedAssistantFinishKind(
  events: readonly SessionEvent[],
  assistant: SessionEvent<'assistant/message'>,
): 'stop' | 'tool-calls' | 'max-tokens' | undefined {
  if (!assistantMatchesCitedChunks(events, assistant)) return undefined
  const assembler = new BlockAssembler()
  for (const sourceSeq of assistant.sourceEventSeqs ?? []) {
    const event = events[Number(sourceSeq)]
    if (event?.type !== 'assistant/chunk') return undefined
    assembler.push(event.data.chunk)
  }
  const { kind } = assembler.finish
  return kind === 'stop' || kind === 'tool-calls' || kind === 'max-tokens'
    ? kind
    : undefined
}

function assistantMatchesCitedChunks(
  events: readonly SessionEvent[],
  message: SessionEvent<'assistant/message'>,
): boolean {
  if (message.sourceEventSeqs === undefined) return false
  const assembler = new BlockAssembler()
  let previousSeq = -1
  for (const sourceSeq of message.sourceEventSeqs) {
    const chunk = events[Number(sourceSeq)]
    if (chunk?.type !== 'assistant/chunk'
      || chunk.seq <= previousSeq
      || chunk.seq >= message.seq
      || chunk.data.turn !== message.data.turn
      || chunk.data.step !== message.data.step) return false
    assembler.push(chunk.data.chunk)
    previousSeq = Number(chunk.seq)
  }
  const finish = assembler.finish
  if (finish.kind !== 'stop'
    && finish.kind !== 'tool-calls'
    && finish.kind !== 'max-tokens') return false
  const source = message.data.message.source
  return canonicalEquals(assembler.blocks(), message.data.message.content)
    && optionalCanonicalEquals(assembler.usage, message.data.usage)
    && optionalCanonicalEquals(assembler.replayState, source.replayState)
}

function proveAssistantRequestRoutes(
  events: readonly SessionEvent[],
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
): InteractionEpisodeTranscriptProofV1['witness']['assistantRequestRoutes'] | undefined {
  const witnesses: Array<{
    readonly assistantMessageSeq: number
    readonly headerSeq: number
    readonly contextSeq: number
  }> = []
  let previousRequestAnchor: number | undefined
  for (const step of completedStepEnvelopes(events, turnEnd)) {
    const assistants = events.filter((event): event is SessionEvent<'assistant/message'> =>
      event.type === 'assistant/message'
      && isAppendSurfaceEvent(event)
      && event.seq > step.start.seq
      && event.seq < step.end.seq)
    if (assistants.length === 0) {
      const hasRequestEvidence = events.some(event =>
        event.seq > step.start.seq
        && event.seq < step.end.seq
        && (event.type === 'request/header'
          || event.type === 'request/context'
          || event.type === 'assistant/chunk'))
      if (!hasRequestEvidence) continue
      const failedAnchor = proveFailedModelAttempts(
        events,
        step.start,
        step.end,
        previousRequestAnchor,
      )
      if (failedAnchor === undefined) return undefined
      previousRequestAnchor = failedAnchor
      continue
    }
    if (assistants.length !== 1) return undefined
    const assistant = assistants[0]!
    if (assistant.data.interrupted !== undefined) return undefined
    if (events.some(event =>
      event.seq > assistant.seq
      && event.seq < step.end.seq
      && (event.type === 'request/header'
        || event.type === 'request/context'
        || event.type === 'assistant/chunk'))) return undefined
    const attempt = proveCitedModelAttempt(events, assistant, previousRequestAnchor)
    if (attempt === undefined) return undefined
    const { routeBoundarySeq, requestGenerationAnchor } = attempt
    previousRequestAnchor = requestGenerationAnchor
    const header = latestEventBefore(events, 'request/header', routeBoundarySeq)
    const context = latestEventBefore(events, 'request/context', routeBoundarySeq)
    const source = assistant.data.message.source
    if (header === undefined
      || context === undefined
      || source.kind !== 'model'
      || header.data.header.config.provider !== source.provider
      || header.data.header.config.model !== source.model
      || context.data.provider !== source.provider
      || context.data.model !== source.model) return undefined
    if (assistant.seq < turnStart.seq) continue
    witnesses.push({
      assistantMessageSeq: Number(assistant.seq),
      headerSeq: Number(header.seq),
      contextSeq: Number(context.seq),
    })
  }
  return witnesses
}

interface CompletedStepEnvelope {
  readonly start: SessionEvent<'step/start'>
  readonly end: SessionEvent<'step/end'>
}

function completedStepEnvelopes(
  events: readonly SessionEvent[],
  turnEnd: SessionEvent<'turn/end'>,
): readonly CompletedStepEnvelope[] {
  const steps: CompletedStepEnvelope[] = []
  let open: SessionEvent<'step/start'> | undefined
  for (const event of events) {
    if (event.seq >= turnEnd.seq) break
    if (event.type === 'step/start') {
      if (open !== undefined) return []
      open = event
      continue
    }
    if (event.type !== 'step/end') continue
    if (open === undefined
      || open.data.turn !== event.data.turn
      || open.data.step !== event.data.step) return []
    steps.push({ start: open, end: event })
    open = undefined
  }
  return open === undefined ? steps : []
}

function proveFailedModelAttempts(
  events: readonly SessionEvent[],
  stepStart: SessionEvent<'step/start'>,
  stepEnd: SessionEvent<'step/end'>,
  inheritedRequestAnchor: number | undefined,
): number | undefined {
  const chunks = events.filter((event): event is SessionEvent<'assistant/chunk'> =>
    event.type === 'assistant/chunk'
    && event.data.turn === stepStart.data.turn
    && event.data.step === stepStart.data.step
    && event.seq > stepStart.seq
    && event.seq < stepEnd.seq)
  const attempts: SessionEvent<'assistant/chunk'>[][] = []
  let pending: SessionEvent<'assistant/chunk'>[] = []
  for (const chunk of chunks) {
    pending.push(chunk)
    if (chunk.data.chunk.type !== 'finish') continue
    attempts.push(pending)
    pending = []
  }
  if (attempts.length === 0 || pending.length > 0) return undefined

  let previousBoundary = Number(stepStart.seq)
  let previousRequestAnchor = inheritedRequestAnchor
  for (const attempt of attempts) {
    const first = attempt[0]!
    const last = attempt.at(-1)!
    const finish = last.data.chunk
    if (finish.type !== 'finish'
      || (finish.reason.kind !== 'error' && finish.reason.kind !== 'aborted')) {
      return undefined
    }
    const prelude = requestPreludeBetween(events, previousBoundary, Number(first.seq))
    if (prelude === undefined) return undefined
    const allowsResume = hasValidResumePosition(prelude, stepStart, previousBoundary)
    if (allowsResume === undefined) return undefined
    if (!hasValidRetryAssembly(events, prelude, stepStart, previousBoundary)) return undefined
    const currentRequestAnchor = requestAnchor(prelude, Number(first.seq))
    if (previousRequestAnchor !== undefined
      && !hasRequiredSeriesMarker(
        events,
        previousRequestAnchor,
        currentRequestAnchor,
        prelude,
        allowsResume,
        previousBoundary === Number(stepStart.seq),
      )) return undefined
    if (events.some(event =>
      (event.type === 'request/header' || event.type === 'request/context')
      && event.seq >= first.seq
      && event.seq <= last.seq)) return undefined
    const effectiveHeader = latestEventBefore(events, 'request/header', first.seq)
    const effectiveContext = latestEventBefore(events, 'request/context', first.seq)
    if (effectiveHeader === undefined
      || effectiveContext === undefined
      || effectiveHeader.data.header.config.provider !== effectiveContext.data.provider
      || effectiveHeader.data.header.config.model !== effectiveContext.data.model) return undefined
    const assembler = new BlockAssembler()
    for (const chunk of attempt) assembler.push(chunk.data.chunk)
    if (assembler.finish.kind !== finish.reason.kind) return undefined
    previousRequestAnchor = carriedRequestGenerationAnchor(
      events,
      previousBoundary,
      currentRequestAnchor,
    )
    previousBoundary = Number(last.seq)
  }
  if (events.some(event =>
    (event.type === 'request/header' || event.type === 'request/context')
    && event.seq > previousBoundary
    && event.seq < stepEnd.seq)) return undefined
  return previousRequestAnchor
}

function proveCitedModelAttempt(
  events: readonly SessionEvent[],
  assistant: SessionEvent<'assistant/message'>,
  inheritedRequestAnchor: number | undefined,
): {
  readonly routeBoundarySeq: number
  readonly requestGenerationAnchor: number
} | undefined {
  if (!assistantMatchesCitedChunks(events, assistant)) return undefined
  const cited = assistant.sourceEventSeqs?.map(Number)
  if (cited === undefined) return undefined
  const hasEmptyFinalAttempt = cited.length === 0
  const stepStart = events.find((event): event is SessionEvent<'step/start'> =>
    event.type === 'step/start'
    && event.data.turn === assistant.data.turn
    && event.data.step === assistant.data.step
    && event.seq < assistant.seq)
  if (stepStart === undefined) return undefined
  const chunks = events.filter((event): event is SessionEvent<'assistant/chunk'> =>
    event.type === 'assistant/chunk'
    && event.data.turn === assistant.data.turn
    && event.data.step === assistant.data.step
    && event.seq > stepStart.seq
    && event.seq < assistant.seq)
  const attempts: SessionEvent<'assistant/chunk'>[][] = []
  let pending: SessionEvent<'assistant/chunk'>[] = []
  for (const chunk of chunks) {
    pending.push(chunk)
    if (chunk.data.chunk.type !== 'finish') continue
    attempts.push(pending)
    pending = []
  }
  if (pending.length > 0) attempts.push(pending)
  if (attempts.length === 0 && !hasEmptyFinalAttempt) return undefined

  let previousBoundary = Number(stepStart.seq)
  let previousRequestAnchor = inheritedRequestAnchor
  for (const [index, attempt] of attempts.entries()) {
    const first = attempt[0]!
    const last = attempt.at(-1)!
    const isFinal = !hasEmptyFinalAttempt && index === attempts.length - 1
    const explicitFinish = last.data.chunk.type === 'finish'
      ? last.data.chunk.reason
      : undefined
    const prelude = requestPreludeBetween(events, previousBoundary, Number(first.seq))
    if (prelude === undefined) return undefined
    const allowsResume = hasValidResumePosition(prelude, stepStart, previousBoundary)
    if (allowsResume === undefined) return undefined
    if (!hasValidRetryAssembly(events, prelude, stepStart, previousBoundary)) return undefined
    const currentRequestAnchor = requestAnchor(prelude, Number(first.seq))
    if (previousRequestAnchor !== undefined
      && !hasRequiredSeriesMarker(
        events,
        previousRequestAnchor,
        currentRequestAnchor,
        prelude,
        allowsResume,
        previousBoundary === Number(stepStart.seq),
      )) return undefined
    if (events.some(event =>
      (event.type === 'request/header' || event.type === 'request/context')
      && event.seq >= first.seq
      && event.seq < assistant.seq
      && (event.seq <= last.seq || isFinal))) return undefined

    const effectiveHeader = latestEventBefore(events, 'request/header', first.seq)
    const effectiveContext = latestEventBefore(events, 'request/context', first.seq)
    if (effectiveHeader === undefined
      || effectiveContext === undefined
      || effectiveHeader.data.header.config.provider !== effectiveContext.data.provider
      || effectiveHeader.data.header.config.model !== effectiveContext.data.model) return undefined

    const assembler = new BlockAssembler()
    for (const chunk of attempt) assembler.push(chunk.data.chunk)
    const assembledFinish = assembler.finish
    if (explicitFinish !== undefined && assembledFinish.kind !== explicitFinish.kind) return undefined
    if (!isFinal && (explicitFinish?.kind !== 'error' && explicitFinish?.kind !== 'aborted')) {
      return undefined
    }
    if (isFinal) {
      if (cited.length !== attempt.length
        || attempt.some((chunk, chunkIndex) => Number(chunk.seq) !== cited[chunkIndex])) {
        return undefined
      }
    }
    previousRequestAnchor = carriedRequestGenerationAnchor(
      events,
      previousBoundary,
      currentRequestAnchor,
    )
    previousBoundary = Number(last.seq)
  }
  if (hasEmptyFinalAttempt) {
    const prelude = requestPreludeBetween(events, previousBoundary, Number(assistant.seq))
    if (prelude === undefined) return undefined
    const allowsResume = hasValidResumePosition(prelude, stepStart, previousBoundary)
    if (allowsResume === undefined) return undefined
    if (!hasValidRetryAssembly(events, prelude, stepStart, previousBoundary)) return undefined
    const currentRequestAnchor = requestAnchor(prelude, Number(assistant.seq))
    if (previousRequestAnchor !== undefined
      && !hasRequiredSeriesMarker(
        events,
        previousRequestAnchor,
        currentRequestAnchor,
        prelude,
        allowsResume,
        previousBoundary === Number(stepStart.seq),
      )) return undefined
    const header = latestEventBefore(events, 'request/header', assistant.seq)
    const context = latestEventBefore(events, 'request/context', assistant.seq)
    if (header === undefined
      || context === undefined
      || header.data.header.config.provider !== context.data.provider
      || header.data.header.config.model !== context.data.model) return undefined
    return {
      routeBoundarySeq: Number(assistant.seq),
      requestGenerationAnchor: carriedRequestGenerationAnchor(
        events,
        previousBoundary,
        currentRequestAnchor,
      ),
    }
  }
  return {
    routeBoundarySeq: Number(attempts.at(-1)![0]!.seq),
    requestGenerationAnchor: previousRequestAnchor!,
  }
}

interface RequestPrelude {
  readonly headers: readonly SessionEvent<'request/header'>[]
  readonly contexts: readonly SessionEvent<'request/context'>[]
}

function requestPreludeBetween(
  events: readonly SessionEvent[],
  afterSeq: number,
  beforeSeq: number,
): RequestPrelude | undefined {
  const requestEvents = events.filter(event =>
    (event.type === 'request/header' || event.type === 'request/context')
    && event.seq > afterSeq
    && event.seq < beforeSeq)
  const headers = requestEvents.filter((event): event is SessionEvent<'request/header'> =>
    event.type === 'request/header')
  const contexts = requestEvents.filter((event): event is SessionEvent<'request/context'> =>
    event.type === 'request/context')
  if (headers.length > 1
    || contexts.length > 1
    || (headers.length === 1
      && contexts.length === 1
      && headers[0]!.seq > contexts[0]!.seq)) return undefined
  return { headers, contexts }
}

function requestAnchor(prelude: RequestPrelude, fallback: number): number {
  return Number(prelude.headers[0]?.seq ?? prelude.contexts[0]?.seq ?? fallback)
}

function carriedRequestGenerationAnchor(
  events: readonly SessionEvent[],
  requestStartLowerBound: number,
  currentRequestAnchor: number,
): number {
  return events.some(event =>
    isReplacementSurfaceEvent(event)
    && event.seq > requestStartLowerBound
    && event.seq < currentRequestAnchor)
    ? requestStartLowerBound
    : currentRequestAnchor
}

function hasValidResumePosition(
  prelude: RequestPrelude,
  stepStart: SessionEvent<'step/start'>,
  requestStartLowerBound: number,
): boolean | undefined {
  if (prelude.headers[0]?.data.reason !== 'resume') return false
  return requestStartLowerBound === Number(stepStart.seq) && stepStart.data.step === 1
    ? true
    : undefined
}

function hasValidRetryAssembly(
  events: readonly SessionEvent[],
  prelude: RequestPrelude,
  stepStart: SessionEvent<'step/start'>,
  requestStartLowerBound: number,
): boolean {
  const marker = prelude.headers[0]
  if (marker === undefined || requestStartLowerBound === Number(stepStart.seq)) return true
  const previous = latestEventBefore(events, 'request/header', marker.seq)
  if (previous === undefined) return false
  const previousHeader = canonicalHeader(previous.data.header)
  const nextHeader = canonicalHeader(marker.data.header)
  return previousHeader.system === nextHeader.system
    && JSON.stringify(previousHeader.tools ?? []) === JSON.stringify(nextHeader.tools ?? [])
}

function hasRequiredSeriesMarker(
  events: readonly SessionEvent[],
  previousRequestAnchor: number,
  currentRequestAnchor: number,
  prelude: RequestPrelude,
  allowsResume: boolean,
  firstAttemptInStep: boolean,
): boolean {
  const replacements = events.filter(event =>
    isReplacementSurfaceEvent(event)
    && event.seq > previousRequestAnchor
    && event.seq < currentRequestAnchor)
  const marker = prelude.headers[0]
  if (replacements.length === 0) {
    return firstAttemptInStep
      || (marker?.data.reason !== 'series'
        && !(marker?.data.reason === 'change' && marker.data.startsSeries === true))
  }
  const lastReplacement = replacements.at(-1)!
  return marker !== undefined
    && marker.seq > lastReplacement.seq
    && (marker.data.reason === 'series'
      || (marker.data.reason === 'change' && marker.data.startsSeries === true)
      || (allowsResume && marker.data.reason === 'resume'))
}

function hasValidRequestStateLog(
  events: readonly SessionEvent[],
  targetEnd: SessionEvent<'turn/end'>,
): boolean {
  let header: SessionEvent<'request/header'> | undefined
  let context: SessionEvent<'request/context'> | undefined
  for (const event of events) {
    if (event.seq > targetEnd.seq) break
    if (event.type === 'request/header') {
      const route = event.data.header.config
      if (!hasValidRequestHeaderShape(event.data.header)
        || (event.data.reason !== 'initial'
          && event.data.reason !== 'resume'
          && event.data.reason !== 'change'
          && event.data.reason !== 'series')
        || (Object.hasOwn(event.data, 'startsSeries') && event.data.startsSeries !== true)
        || route.provider.length === 0
        || route.model.length === 0
        || !canonicalEquals(event.data.header, canonicalHeader(event.data.header))) return false
      const same = header !== undefined
        && headerEquals(
          canonicalHeader(header.data.header),
          canonicalHeader(event.data.header),
        )
      if ((event.data.reason === 'initial' && header !== undefined)
        || (event.data.reason === 'resume' && header === undefined)
        || (event.data.reason === 'change' && (header === undefined || same))
        || (event.data.reason === 'series' && (header === undefined || !same))
        || (event.data.startsSeries === true && event.data.reason !== 'change')) return false
      header = event
      continue
    }
    if (event.type !== 'request/context') continue
    if (header === undefined
      || event.data.provider.length === 0
      || event.data.model.length === 0
      || event.data.provider !== header.data.header.config.provider
      || event.data.model !== header.data.header.config.model
      || (event.data.contextWindow !== undefined
        && (!Number.isSafeInteger(event.data.contextWindow) || event.data.contextWindow <= 0))
      || (context !== undefined && canonicalEquals(context.data, event.data))) return false
    context = event
  }
  return true
}

function hasValidRequestHeaderShape(value: unknown): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.config)) return false
  const config = value.config
  if (!hasNonEmptyString(config, 'provider') || !hasNonEmptyString(config, 'model')) {
    return false
  }
  if (config.reasoningEffort !== undefined
    && (typeof config.reasoningEffort !== 'string'
      || config.reasoningEffort.length === 0)) return false
  if (value.adapterDefaults === undefined) return true
  if (!isPlainRecord(value.adapterDefaults)) return false
  const defaults = value.adapterDefaults
  if (Object.keys(defaults).some(key => key !== 'reasoningEffort' && key !== 'maxTokens')
    || Object.values(defaults).some(marker => marker !== true)
    || (defaults.reasoningEffort === true && config.reasoningEffort === undefined)
    || (defaults.maxTokens === true && config.maxTokens === undefined)) return false
  return true
}

function latestEventBefore<Type extends 'request/header' | 'request/context'>(
  events: readonly SessionEvent[],
  type: Type,
  beforeSeq: number,
): SessionEvent<Type> | undefined {
  for (let index = Math.min(Number(beforeSeq) - 1, events.length - 1); index >= 0; index--) {
    const event = events[index]
    if (event?.type === type) return event as SessionEvent<Type>
  }
  return undefined
}

function optionalCanonicalEquals(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return canonicalEquals(left, right)
}

type TranscriptToolCallBlock = Extract<
  SessionEvent<'assistant/message'>['data']['message']['content'][number],
  { type: 'tool-call' }
>

interface TranscriptToolRequest {
  readonly event: SessionEvent<'assistant/message'>
  readonly block: TranscriptToolCallBlock
}

function toolRequests(
  events: readonly SessionEvent[],
  turnStart: SessionEvent<'turn/start'>,
  turnEnd: SessionEvent<'turn/end'>,
): TranscriptToolRequest[] {
  return events.flatMap(event => event.type === 'assistant/message'
    && isAppendSurfaceEvent(event)
    && event.data.interrupted !== true
    && event.seq > turnStart.seq
    && event.seq < turnEnd.seq
    ? event.data.message.content.flatMap(block => block.type === 'tool-call'
      ? [{ event, block }]
      : [])
    : [])
}

function resultLinksCall(
  result: SessionEvent<'tool/result'>,
  call: SessionEvent<'tool/call'>,
): boolean {
  if (!hasValidCoreMessageShape(result)) return false
  const block = result.data.message.content[0]
  return result.data.turn === call.data.turn
    && result.data.step === call.data.step
    && String(result.data.message.source.callId) === String(call.data.callId)
    && result.sourceEventSeqs?.length === 1
    && result.sourceEventSeqs[0] === call.seq
    && block?.type === 'tool-result'
    && String(block.toolCallId) === String(call.data.callId)
}

/** Mirrors the alpha.5 Session seed/load invariants needed for safe replay. */
function hasValidCoreMessageShape(event: SessionEvent): boolean {
  if (event.type !== 'user/message'
    && event.type !== 'assistant/message'
    && event.type !== 'tool/result') return true
  const data = event.data as unknown
  const record = isPlainRecord(data) ? data : undefined
  const message = event.type === 'user/message'
    ? record
    : isPlainRecord(record?.message) ? record.message : undefined
  if (message === undefined
    || typeof message.id !== 'string'
    || message.id.length === 0
    || message.role !== (event.type === 'assistant/message' ? 'assistant' : 'user')
    || !isPlainRecord(message.source)
    || typeof message.source.kind !== 'string'
    || message.source.kind.length === 0
    || !Array.isArray(message.content)) return false

  if (event.type === 'assistant/message') {
    return message.source.kind === 'model'
      && hasNonEmptyString(message.source, 'provider')
      && hasNonEmptyString(message.source, 'model')
  }
  if (event.type !== 'tool/result') return true
  if (message.source.kind !== 'tool'
    || !hasNonEmptyString(message.source, 'callId')
    || message.content.length !== 1) return false
  const block = message.content[0]
  return isPlainRecord(block)
    && block.type === 'tool-result'
    && Array.isArray(block.content)
    && block.toolCallId === message.source.callId
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && record[key].length > 0
}

function parseRequestedSkill(raw: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string') return undefined
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.name) && record.name.length <= 128
    ? record.name
    : undefined
}

function abstain(
  reason: Extract<InteractionEpisodeTranscriptProofResult, { status: 'abstained' }>['reason'],
): InteractionEpisodeTranscriptProofResult {
  return { status: 'abstained', reason }
}

function hashCanonical(value: unknown): string {
  const hash = createHash('sha256')
  for (const chunk of canonicalChunks(value)) hash.update(chunk)
  return hash.digest('hex')
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  const leftChunks = canonicalChunks(left)
  const rightChunks = canonicalChunks(right)
  while (true) {
    const leftChunk = leftChunks.next()
    const rightChunk = rightChunks.next()
    if (leftChunk.done || rightChunk.done) return leftChunk.done === rightChunk.done
    if (leftChunk.value !== rightChunk.value) return false
  }
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

type CanonicalFrame =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'value'; readonly value: unknown }

function* canonicalChunks(root: unknown): Generator<string, void> {
  const stack: CanonicalFrame[] = [{ kind: 'value', value: root }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.kind === 'token') {
      yield frame.token
      continue
    }
    const value = frame.value
    if (value === null) {
      yield 'null'
      continue
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
      yield JSON.stringify(value)
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('non-finite number is not canonical JSON')
      yield JSON.stringify(value)
      continue
    }
    if (Array.isArray(value)) {
      yield '['
      stack.push({ kind: 'token', token: ']' })
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ kind: 'value', value: value[index] })
        if (index > 0) stack.push({ kind: 'token', token: ',' })
      }
      continue
    }
    if (typeof value === 'object') {
      yield '{'
      stack.push({ kind: 'token', token: '}' })
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index]!
        stack.push({ kind: 'value', value: record[key] })
        stack.push({ kind: 'token', token: ':' })
        stack.push({ kind: 'token', token: JSON.stringify(key) })
        if (index > 0) stack.push({ kind: 'token', token: ',' })
      }
      continue
    }
    throw new TypeError(`unsupported canonical JSON value: ${typeof value}`)
  }
}
