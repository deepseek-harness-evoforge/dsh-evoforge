import { createHash } from 'node:crypto'
import {
  canonicalHeader,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type { InteractionEpisodeTranscriptProofV1 } from './interaction-episode-projector.ts'
import {
  INTERACTION_SESSION_V3_DIALECT,
  interactionSessionDialectForFormatVersion,
  type InteractionSessionDialect,
} from './interaction-session-dialect.ts'

const hashPattern = /^[a-f0-9]{64}$/u

/**
 * Digest-only correlation of the exact logged controls for the model request
 * associated with the settled assistant message containing an Interaction
 * Episode trigger.
 *
 * `declaredRoute` and `loggedControlDigest` describe Session-authored request
 * state only. They do not attest a provider dispatch, the model that served it,
 * complete Host composition, permissions, or an Episode budget.
 *
 * @internal Trusted composition only; never persist or expose the raw request
 * header from which this fact is derived.
 */
export interface InteractionEpisodeTriggerRequestControlFactV1 {
  readonly schemaVersion: 1
  readonly kind: 'interaction-episode-trigger-request-control-fact-v1'
  /** Projector/reader semantics, not evidence of the historical DSH revision. */
  readonly sourceDialect: InteractionSessionDialect
  readonly subject: {
    readonly sessionId: string
    readonly sessionFormatVersion: number
    readonly inheritedEventCount: number
    readonly throughSeq: number
    readonly prefixDigest: string
    readonly turnDigest: string
  }
  readonly boundary: {
    readonly kind: 'trigger-assistant-and-tool-pair'
    readonly requestHeaderSeq: number
    readonly requestContextSeq: number
    readonly assistantMessageSeq: number
    readonly triggerCallSeq: number
    readonly triggerResultSeq: number
  }
  /** Labels recorded in the request header/context and assistant source. */
  readonly declaredRoute: {
    readonly provider: string
    readonly model: string
  }
  /**
   * Unkeyed equality fingerprint of the effective header, context, and logged
   * assistant route. It proves neither authorship nor secrecy.
   */
  readonly loggedControlDigest: string
}

export type InteractionEpisodeTriggerRequestControlProjectionV1 =
  | {
    readonly status: 'projected'
    readonly fact: InteractionEpisodeTriggerRequestControlFactV1
  }
  | {
    readonly status: 'abstained'
    readonly reason: 'subject-mismatch'
  }

/** Minimal already-durable subject shape owned by the evidence resolver. */
export interface InteractionEpisodeTriggerRequestControlSubjectV1 {
  readonly schemaVersion: 1
  readonly kind: 'durable-interaction-episode-subject-v1'
  readonly session: {
    readonly header: SessionHeader
    readonly inheritedEventCount: number
    readonly throughSeq: number
    readonly events: readonly SessionEvent[]
  }
  readonly transcript: InteractionEpisodeTranscriptProofV1
}

/**
 * Project the trigger request from a resolver-created durable subject.
 *
 * This is deliberately not a verifier credential for arbitrary caller-made
 * objects. It rechecks the correlations and transcript digests a Host attestor
 * will depend on, and fails closed on any mismatch it observes.
 */
export function projectInteractionEpisodeTriggerRequestControlV1(
  subject: InteractionEpisodeTriggerRequestControlSubjectV1,
): InteractionEpisodeTriggerRequestControlProjectionV1 {
  try {
    return projectUnchecked(snapshotJsonValue(subject))
  } catch {
    return abstained()
  }
}

function projectUnchecked(
  snapshot: JsonValue,
): InteractionEpisodeTriggerRequestControlProjectionV1 {
  const root = record(snapshot)
  if (root === undefined
    || root.schemaVersion !== 1
    || root.kind !== 'durable-interaction-episode-subject-v1') return abstained()
  const session = record(root.session)
  const transcript = record(root.transcript)
  const sessionHeader = record(session?.header)
  const events = array(session?.events)
  const transcriptSession = record(transcript?.session)
  const source = record(transcript?.source)
  const witness = record(transcript?.witness)
  const replay = record(transcript?.replay)
  const trigger = record(transcript?.trigger)
  if (session === undefined
    || transcript === undefined
    || sessionHeader === undefined
    || events === undefined
    || transcriptSession === undefined
    || source === undefined
    || witness === undefined
    || replay === undefined
    || trigger === undefined) return abstained()

  const throughSeq = safeNonNegativeInteger(session.throughSeq)
  const inheritedEventCount = safeNonNegativeInteger(session.inheritedEventCount)
  const sessionFormatVersion = safeNonNegativeInteger(sessionHeader.version)
  const sourceDialect = interactionSessionDialectForFormatVersion(sessionFormatVersion)
  const sessionCreatedAt = safeInteger(sessionHeader.createdAt)
  const sessionId = nonEmptyString(sessionHeader.id)
  if (throughSeq === undefined
    || inheritedEventCount === undefined
    || sessionFormatVersion === undefined
    || sourceDialect === undefined
    || sessionCreatedAt === undefined
    || sessionId === undefined
    || events.length !== throughSeq + 1
    || !hasDenseEventEnvelope(events)) return abstained()

  if (transcriptSession.id !== sessionId
    || transcriptSession.formatVersion !== sessionFormatVersion
    || transcriptSession.createdAt !== sessionCreatedAt
    || transcriptSession.inheritedEventCount !== inheritedEventCount
    || !sameOptionalString(
      sessionHeader.parentSession,
      transcriptSession.parentSessionId,
    )
    || !sameOptionalString(
      sessionHeader.agentPreset,
      transcriptSession.agentPreset,
    )) return abstained()

  const enqueueSeq = safeNonNegativeInteger(source.enqueueSeq)
  const prefixThroughSeq = source.prefixThroughSeq === null
    ? null
    : safeNonNegativeInteger(source.prefixThroughSeq)
  const turnEndSeq = safeNonNegativeInteger(source.turnEndSeq)
  const triggerRequestSeq = safeNonNegativeInteger(witness.triggerRequestSeq)
  const triggerCallSeq = safeNonNegativeInteger(source.triggerCallSeq)
  const triggerResultSeq = safeNonNegativeInteger(source.triggerResultSeq)
  const prefixDigest = exactHash(replay.prefixDigest)
  const turnDigest = exactHash(replay.turnDigest)
  const triggerCallId = nonEmptyString(trigger.callId)
  if (enqueueSeq === undefined
    || prefixThroughSeq === undefined
    || turnEndSeq === undefined
    || triggerRequestSeq === undefined
    || triggerCallSeq === undefined
    || triggerResultSeq === undefined
    || prefixDigest === undefined
    || turnDigest === undefined
    || triggerCallId === undefined
    || turnEndSeq !== throughSeq
    || enqueueSeq > throughSeq
    || prefixThroughSeq !== (enqueueSeq === 0 ? null : enqueueSeq - 1)) return abstained()

  const expectedPrefixDigest = hashCanonical({
    domain: 'evoforge_interaction_episode_prefix',
    version: 1,
    session: {
      header: sessionHeader,
      inheritedEventCount,
    },
    throughSeq: prefixThroughSeq,
    events: events.slice(0, enqueueSeq),
  })
  const expectedTurnDigest = hashCanonical({
    domain: 'evoforge_interaction_episode_turn',
    version: 1,
    session: {
      id: sessionId,
      formatVersion: sessionFormatVersion,
      createdAt: sessionCreatedAt,
    },
    fromSeq: enqueueSeq,
    throughSeq: turnEndSeq,
    events: events.slice(enqueueSeq, turnEndSeq + 1),
  })
  if (prefixDigest !== expectedPrefixDigest || turnDigest !== expectedTurnDigest) {
    return abstained()
  }

  const rawRoutes = array(witness.assistantRequestRoutes)
  if (rawRoutes === undefined || rawRoutes.length === 0) return abstained()
  const routes: RequestRoute[] = []
  let previousAssistantSeq = -1
  for (const rawRoute of rawRoutes) {
    const route = parseRequestRoute(rawRoute)
    if (route === undefined
      || route.assistantMessageSeq <= previousAssistantSeq
      || !routeMatchesEvents(route, events, throughSeq, sourceDialect)) return abstained()
    routes.push(route)
    previousAssistantSeq = route.assistantMessageSeq
  }
  const selected = routes.filter(route =>
    route.assistantMessageSeq === triggerRequestSeq)
  if (selected.length !== 1) return abstained()
  const route = selected[0]!

  if (!(route.headerSeq < route.assistantMessageSeq
    && route.contextSeq < route.assistantMessageSeq
    && route.assistantMessageSeq === triggerRequestSeq
    && triggerRequestSeq < triggerCallSeq
    && triggerCallSeq < triggerResultSeq
    && triggerResultSeq <= throughSeq)) return abstained()

  const assistant = eventAt(events, route.assistantMessageSeq, 'assistant/message')
  const headerEvent = eventAt(events, route.headerSeq, 'request/header')
  const contextEvent = eventAt(events, route.contextSeq, 'request/context')
  const callEvent = eventAt(events, triggerCallSeq, 'tool/call')
  const resultEvent = eventAt(events, triggerResultSeq, 'tool/result')
  if (assistant === undefined
    || headerEvent === undefined
    || contextEvent === undefined
    || callEvent === undefined
    || resultEvent === undefined) return abstained()

  const assistantData = record(assistant.data)
  const assistantMessage = record(assistantData?.message)
  const assistantSource = record(assistantMessage?.source)
  const headerData = record(headerEvent.data)
  const header = canonicalRequestHeader(headerData?.header, sourceDialect)
  const context = canonicalRequestContext(contextEvent.data, sourceDialect)
  const callData = record(callEvent.data)
  const resultData = record(resultEvent.data)
  const resultMessage = record(resultData?.message)
  const resultSource = record(resultMessage?.source)
  if (assistantData === undefined
    || assistantMessage === undefined
    || assistantSource === undefined
    || headerData === undefined
    || header === undefined
    || context === undefined
    || callData === undefined
    || resultData === undefined
    || resultMessage === undefined
    || resultSource === undefined
    || assistant.surfaceOp !== 'append'
    || Object.hasOwn(assistantData, 'interrupted')
    || assistantMessage.role !== 'assistant'
    || assistantSource.kind !== 'model'
    || callData.callId !== triggerCallId
    || resultSource.kind !== 'tool'
    || resultSource.callId !== triggerCallId
    || callData.turn !== assistantData.turn
    || callData.step !== assistantData.step
    || resultData.turn !== assistantData.turn
    || resultData.step !== assistantData.step
    || !matchesTriggerPair({
      assistantMessage,
      callData,
      callSeq: triggerCallSeq,
      resultEvent,
      resultData,
      resultMessage,
      trigger,
      triggerCallId,
    })) return abstained()

  const provider = nonEmptyString(assistantSource.provider)
  const model = nonEmptyString(assistantSource.model)
  if (provider === undefined
    || model === undefined
    || header.config.provider !== provider
    || header.config.model !== model
    || context.provider !== provider
    || context.model !== model) return abstained()

  const loggedControlDigest = hashCanonical({
    domain: 'evoforge_interaction_episode_trigger_request_control',
    version: 1,
    sourceDialect,
    header: requestHeaderDigestValue(header),
    context,
    assistantSource: { kind: 'model', provider, model },
  })
  return immutable({
    status: 'projected',
    fact: {
      schemaVersion: 1,
      kind: 'interaction-episode-trigger-request-control-fact-v1',
      sourceDialect,
      subject: {
        sessionId,
        sessionFormatVersion,
        inheritedEventCount,
        throughSeq,
        prefixDigest,
        turnDigest,
      },
      boundary: {
        kind: 'trigger-assistant-and-tool-pair',
        requestHeaderSeq: route.headerSeq,
        requestContextSeq: route.contextSeq,
        assistantMessageSeq: route.assistantMessageSeq,
        triggerCallSeq,
        triggerResultSeq,
      },
      declaredRoute: { provider, model },
      loggedControlDigest,
    },
  } as const)
}

function requestHeaderDigestValue(header: CanonicalRequestHeader): JsonRecord {
  const digestHeader: Record<string, JsonValue> = { ...header }
  if (Object.hasOwn(header, 'tools')) {
    const tools = array(header.tools)!
    // Both admitted dialect cohorts preserve request ToolSchema JSON ordering,
    // so nested schema key order remains part of this logged identity.
    digestHeader.tools = tools.map(tool => JSON.stringify(tool))
  }
  return digestHeader
}

function matchesTriggerPair(input: {
  readonly assistantMessage: JsonRecord
  readonly callData: JsonRecord
  readonly callSeq: number
  readonly resultEvent: JsonRecord
  readonly resultData: JsonRecord
  readonly resultMessage: JsonRecord
  readonly trigger: JsonRecord
  readonly triggerCallId: string
}): boolean {
  const {
    assistantMessage,
    callData,
    callSeq,
    resultEvent,
    resultData,
    resultMessage,
    trigger,
    triggerCallId,
  } = input
  const callName = nonEmptyString(callData.name)
  const callArguments = typeof callData.arguments === 'string'
    ? callData.arguments
    : undefined
  const requestedSkill = nonEmptyString(trigger.requestedSkill)
  const content = array(assistantMessage.content)
  const resultContent = array(resultMessage.content)
  const sourceEventSeqs = array(resultEvent.sourceEventSeqs)
  if (callName === undefined
    || callArguments === undefined
    || requestedSkill === undefined
    || content === undefined
    || resultContent?.length !== 1
    || sourceEventSeqs?.length !== 1
    || sourceEventSeqs[0] !== callSeq
    || resultEvent.surfaceOp !== 'append'
    || resultMessage.role !== 'user'
    || parseRequestedSkill(callArguments) !== requestedSkill) return false

  const requests = content.flatMap((value) => {
    const block = record(value)
    return block?.type === 'tool-call' && block.id === triggerCallId ? [block] : []
  })
  if (requests.length !== 1
    || requests[0]!.name !== callName
    || requests[0]!.arguments !== callArguments) return false

  const resultBlock = record(resultContent[0])
  const resultBlockContent = array(resultBlock?.content)
  if (resultBlock === undefined
    || resultBlock.type !== 'tool-result'
    || resultBlock.toolCallId !== triggerCallId
    || resultBlockContent === undefined) return false

  if (callName === 'report_capability_gap') {
    return trigger.kind === 'successful-gap-report'
      && resultBlock.isError === false
      && !Object.hasOwn(resultData, 'error')
  }
  if (callName === 'skill') {
    return trigger.kind === 'skill-tool-error' && resultBlock.isError === true
  }
  return false
}

function parseRequestedSkill(raw: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  const request = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
  const name = request?.name
  return typeof name === 'string'
    && name.length <= 128
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
    ? name
    : undefined
}

interface RequestRoute {
  readonly assistantMessageSeq: number
  readonly headerSeq: number
  readonly contextSeq: number
}

function parseRequestRoute(value: JsonValue): RequestRoute | undefined {
  const route = record(value)
  if (route === undefined
    || !hasExactKeys(route, ['assistantMessageSeq', 'headerSeq', 'contextSeq'])) {
    return undefined
  }
  const assistantMessageSeq = safeNonNegativeInteger(route.assistantMessageSeq)
  const headerSeq = safeNonNegativeInteger(route.headerSeq)
  const contextSeq = safeNonNegativeInteger(route.contextSeq)
  return assistantMessageSeq === undefined
    || headerSeq === undefined
    || contextSeq === undefined
    ? undefined
    : { assistantMessageSeq, headerSeq, contextSeq }
}

function routeMatchesEvents(
  route: RequestRoute,
  events: readonly JsonValue[],
  throughSeq: number,
  sourceDialect: InteractionSessionDialect,
): boolean {
  if (route.assistantMessageSeq > throughSeq
    || route.headerSeq >= route.assistantMessageSeq
    || route.contextSeq >= route.assistantMessageSeq
    || latestEventSeqBefore(events, 'request/header', route.assistantMessageSeq)
      !== route.headerSeq
    || latestEventSeqBefore(events, 'request/context', route.assistantMessageSeq)
      !== route.contextSeq) return false
  const assistant = eventAt(events, route.assistantMessageSeq, 'assistant/message')
  const header = eventAt(events, route.headerSeq, 'request/header')
  const context = eventAt(events, route.contextSeq, 'request/context')
  const assistantData = record(assistant?.data)
  const message = record(assistantData?.message)
  const loggedSource = record(message?.source)
  const headerData = record(header?.data)
  const requestHeader = canonicalRequestHeader(headerData?.header, sourceDialect)
  const requestContext = canonicalRequestContext(context?.data, sourceDialect)
  return assistant !== undefined
    && header !== undefined
    && context !== undefined
    && assistant.surfaceOp === 'append'
    && assistantData !== undefined
    && !Object.hasOwn(assistantData, 'interrupted')
    && message?.role === 'assistant'
    && loggedSource?.kind === 'model'
    && requestHeader !== undefined
    && requestContext !== undefined
    && nonEmptyString(loggedSource.provider) === requestHeader.config.provider
    && nonEmptyString(loggedSource.model) === requestHeader.config.model
    && requestContext.provider === requestHeader.config.provider
    && requestContext.model === requestHeader.config.model
}

interface CanonicalRequestHeader extends JsonRecord {
  readonly config: JsonRecord & { readonly provider: string; readonly model: string }
}

interface CanonicalRequestContext extends JsonRecord {
  readonly provider: string
  readonly model: string
}

function canonicalRequestHeader(
  value: JsonValue | undefined,
  sourceDialect: InteractionSessionDialect,
): CanonicalRequestHeader | undefined {
  const header = record(value)
  const config = record(header?.config)
  const headerKeys = sourceDialect === INTERACTION_SESSION_V3_DIALECT
    ? ['config', 'adapterDefaults', 'tools']
    : ['config', 'adapterDefaults', 'system', 'tools']
  if (header === undefined
    || config === undefined
    || !hasOnlyKeys(header, headerKeys)
    || !hasOnlyKeys(config, [
      'provider',
      'model',
      'reasoningEffort',
      'temperature',
      'maxTokens',
      'stop',
    ])) return undefined
  const provider = nonEmptyString(config.provider)
  const model = nonEmptyString(config.model)
  if (provider === undefined || model === undefined) return undefined
  if (Object.hasOwn(config, 'reasoningEffort')
    && nonEmptyString(config.reasoningEffort) === undefined) return undefined
  if (Object.hasOwn(config, 'temperature')
    && typeof config.temperature !== 'number') return undefined
  if (Object.hasOwn(config, 'maxTokens')
    && (safeNonNegativeInteger(config.maxTokens) === undefined
      || config.maxTokens === 0)) return undefined
  if (Object.hasOwn(config, 'stop')) {
    const stop = array(config.stop)
    if (stop === undefined || stop.some(value => typeof value !== 'string')) return undefined
  }
  if (Object.hasOwn(header, 'system') && nonEmptyString(header.system) === undefined) {
    return undefined
  }
  if (Object.hasOwn(header, 'tools')) {
    const tools = array(header.tools)
    if (tools === undefined || tools.length === 0 || tools.some(tool => record(tool) === undefined)) {
      return undefined
    }
  }
  if (Object.hasOwn(header, 'adapterDefaults')) {
    const defaults = record(header.adapterDefaults)
    if (defaults === undefined
      || !hasOnlyKeys(defaults, ['reasoningEffort', 'maxTokens'])
      || Object.keys(defaults).length === 0
      || Object.values(defaults).some(value => value !== true)
      || defaults.reasoningEffort === true && !Object.hasOwn(config, 'reasoningEffort')
      || defaults.maxTokens === true && !Object.hasOwn(config, 'maxTokens')) return undefined
  }
  const canonical = canonicalHeader(header as unknown as SessionEvent<'request/header'>['data']['header'])
  return canonicalEquals(header, canonical)
    ? header as CanonicalRequestHeader
    : undefined
}

function canonicalRequestContext(
  value: JsonValue | undefined,
  sourceDialect: InteractionSessionDialect,
): CanonicalRequestContext | undefined {
  const context = record(value)
  const contextKeys = sourceDialect === INTERACTION_SESSION_V3_DIALECT
    ? ['provider', 'model', 'contextWindow', 'systemPromptUpdate']
    : ['provider', 'model', 'contextWindow']
  if (context === undefined
    || !hasOnlyKeys(context, contextKeys)) return undefined
  const provider = nonEmptyString(context.provider)
  const model = nonEmptyString(context.model)
  if (provider === undefined || model === undefined) return undefined
  if (Object.hasOwn(context, 'contextWindow')
    && (safeNonNegativeInteger(context.contextWindow) === undefined
      || context.contextWindow === 0)) return undefined
  if (Object.hasOwn(context, 'systemPromptUpdate')
    && context.systemPromptUpdate !== 'in-history') return undefined
  return context as CanonicalRequestContext
}

function eventAt(
  events: readonly JsonValue[],
  seq: number,
  type: string,
): JsonRecord | undefined {
  const event = record(events[seq])
  return event?.seq === seq && event.type === type ? event : undefined
}

function latestEventSeqBefore(
  events: readonly JsonValue[],
  type: string,
  beforeSeq: number,
): number | undefined {
  for (let seq = beforeSeq - 1; seq >= 0; seq -= 1) {
    const event = record(events[seq])
    if (event?.type === type) return seq
  }
  return undefined
}

function hasDenseEventEnvelope(events: readonly JsonValue[]): boolean {
  return events.every((value, seq) => {
    const event = record(value)
    return event !== undefined
      && hasOnlyKeys(event, [
        'type',
        'seq',
        'time',
        'data',
        'surfaceOp',
        'sourceEventSeqs',
        'ignorable',
      ])
      && nonEmptyString(event.type) !== undefined
      && event.seq === seq
      && safeInteger(event.time) !== undefined
      && Object.hasOwn(event, 'data')
  })
}

function sameOptionalString(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return typeof left === 'string' && left === right
}

function safeNonNegativeInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
    ? value
    : undefined
}

function safeInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && !Object.is(value, -0)
    ? value
    : undefined
}

function nonEmptyString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function exactHash(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && hashPattern.test(value) ? value : undefined
}

function hasExactKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(record, key))
}

function hasOnlyKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(record).every(key => allowed.has(key))
}

function record(value: JsonValue | undefined): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function array(value: JsonValue | undefined): JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function hashCanonical(value: JsonValue): string {
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
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        throw new TypeError('non-canonical number')
      }
      yield JSON.stringify(value)
      continue
    }
    if (Array.isArray(value)) {
      yield '['
      stack.push({ kind: 'token', token: ']' })
      for (let index = value.length - 1; index >= 0; index -= 1) {
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
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!
        stack.push({ kind: 'value', value: record[key] })
        stack.push({ kind: 'token', token: ':' })
        stack.push({ kind: 'token', token: JSON.stringify(key) })
        if (index > 0) stack.push({ kind: 'token', token: ',' })
      }
      continue
    }
    throw new TypeError('unsupported canonical JSON value')
  }
}

type JsonScalar = null | boolean | number | string
type JsonValue = JsonScalar | JsonValue[] | JsonRecord
interface JsonRecord { readonly [key: string]: JsonValue }

type SnapshotFrame =
  | { readonly kind: 'leave'; readonly source: object }
  | {
    readonly kind: 'value'
    readonly source: unknown
    readonly assign: (snapshot: JsonValue) => void
  }

/** Copy lossless JSON through own data descriptors without invoking getters. */
function snapshotJsonValue(value: unknown): JsonValue {
  const root: { value?: JsonValue } = {}
  const active = new Set<object>()
  const stack: SnapshotFrame[] = [{
    kind: 'value',
    source: value,
    assign: snapshot => { root.value = snapshot },
  }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.kind === 'leave') {
      active.delete(frame.source)
      continue
    }
    const current = frame.source
    if (current === null
      || typeof current === 'string'
      || typeof current === 'boolean') {
      frame.assign(current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) {
        throw new TypeError('invalid JSON number')
      }
      frame.assign(current)
      continue
    }
    if (typeof current !== 'object') throw new TypeError('not lossless JSON')
    if (active.has(current)) throw new TypeError('cyclic JSON')

    const prototype = Object.getPrototypeOf(current)
    const descriptors = Object.getOwnPropertyDescriptors(current) as Record<
      PropertyKey,
      PropertyDescriptor | undefined
    >
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) throw new TypeError('exotic array')
      const lengthDescriptor = descriptors.length
      const length = lengthDescriptor?.value
      if (lengthDescriptor === undefined
        || !('value' in lengthDescriptor)
        || lengthDescriptor.enumerable
        || typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || Reflect.ownKeys(descriptors).length !== length + 1) {
        throw new TypeError('decorated or sparse array')
      }
      const result = new Array<JsonValue>(length)
      frame.assign(result)
      active.add(current)
      stack.push({ kind: 'leave', source: current })
      for (let index = length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[String(index)]
        if (descriptor === undefined
          || !descriptor.enumerable
          || !('value' in descriptor)) throw new TypeError('invalid array element')
        stack.push({
          kind: 'value',
          source: descriptor.value,
          assign: snapshot => { result[index] = snapshot },
        })
      }
      continue
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('exotic object')
    const entries: Array<readonly [string, unknown]> = []
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key]
      if (typeof key !== 'string'
        || descriptor === undefined
        || !descriptor.enumerable
        || !('value' in descriptor)) throw new TypeError('decorated object')
      entries.push([key, descriptor.value])
    }
    const result: Record<string, JsonValue> = Object.create(null)
    frame.assign(result)
    active.add(current)
    stack.push({ kind: 'leave', source: current })
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!
      stack.push({
        kind: 'value',
        source: child,
        assign: snapshot => { result[key] = snapshot },
      })
    }
  }
  if (root.value === undefined) throw new TypeError('missing JSON snapshot')
  return root.value
}

function abstained(): InteractionEpisodeTriggerRequestControlProjectionV1 {
  return immutable({ status: 'abstained', reason: 'subject-mismatch' } as const)
}

function immutable<T>(value: T): T {
  const pending: object[] = []
  if (value !== null && typeof value === 'object') pending.push(value)
  while (pending.length > 0) {
    const current = pending.pop()!
    if (Object.isFrozen(current)) continue
    Object.freeze(current)
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
  return value
}
