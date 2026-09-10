import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  proveInteractionEpisodeTranscript,
  type InteractionEpisodeTranscriptSourceV1,
} from '../src/interaction-episode-projector.ts'

describe('Interaction Episode Session v3 transcript proof', () => {
  it('proves one exact completed direct AgentLoop turn from embedded assistant streams', () => {
    const fixture = completedV3GapTurn()

    const result = proveInteractionEpisodeTranscript(fixture, fixture.turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result).toMatchObject({
      status: 'proven',
      proof: {
        session: {
          id: 'episode-v3-session',
          formatVersion: 3,
          createdAt: 1_000,
          inheritedEventCount: 0,
          agentPreset: 'default',
        },
        source: {
          turn: 1,
          prefixThroughSeq: null,
          enqueueSeq: 0,
          turnStartSeq: 1,
          claimSeq: 2,
          initiatingMessageSeq: 5,
          triggerCallSeq: 9,
          triggerResultSeq: 10,
          turnEndSeq: 15,
          completedAt: 2_000,
        },
        witness: {
          admissionStepStartSeq: 3,
          triggerRequestSeq: 8,
          assistantRequestRoutes: [
            { assistantMessageSeq: 8, headerSeq: 6, contextSeq: 7 },
            { assistantMessageSeq: 13, headerSeq: 6, contextSeq: 7 },
          ],
        },
        trigger: {
          kind: 'successful-gap-report',
          callId: 'gap-call',
          requestedSkill: 'publish-dsh-plugin',
        },
      },
    })
  })

  it.each([1, 2, 4, 99])('abstains from unsupported Session format %i', (version) => {
    const fixture = completedV3GapTurn()
    fixture.header.version = version

    expect(prove(fixture)).toEqual({
      status: 'abstained',
      reason: 'transcript-not-proven',
    })
  })

  it('accepts only the rc.2 in-history system-prompt request context', () => {
    const supported = completedV3GapTurn()
    requestContextData(supported).systemPromptUpdate = 'in-history'

    expect(prove(supported)).toMatchObject({ status: 'proven' })

    const unknown = completedV3GapTurn()
    requestContextData(unknown).systemPromptUpdate = 'leading'
    expect(prove(unknown)).toEqual({
      status: 'abstained',
      reason: 'request-not-proven',
    })
  })

  it('accepts a later System append before a later-step request on an in-history route', () => {
    const fixture = completedV3GapTurn()
    requestContextData(fixture).systemPromptUpdate = 'in-history'
    insertBefore(fixture.events, 13, laterSystemMessage(1, 2))

    expect(prove(fixture)).toMatchObject({ status: 'proven' })
  })

  it('rejects a later System append after admitted input even on an in-history route', () => {
    const fixture = completedV3GapTurn()
    requestContextData(fixture).systemPromptUpdate = 'in-history'
    insertBefore(fixture.events, 6, laterSystemMessage(1, 1))

    expect(prove(fixture)).toMatchObject({ status: 'abstained' })
  })

  it('rejects a later System append without an effective in-history route', () => {
    const fixture = completedV3GapTurn()
    insertBefore(fixture.events, 13, laterSystemMessage(1, 2))

    expect(prove(fixture)).toMatchObject({ status: 'abstained' })
  })

  it('rejects a later System append that repeats the effective prompt', () => {
    const fixture = completedV3GapTurn()
    requestContextData(fixture).systemPromptUpdate = 'in-history'
    insertBefore(fixture.events, 13, laterSystemMessage(
      1,
      2,
      'Use the available tools.',
    ))

    expect(prove(fixture)).toMatchObject({ status: 'abstained' })
  })

  it('rejects a later request that drops in-history while an appended prompt tail survives', () => {
    const fixture = completedV3GapTurn()
    requestContextData(fixture).systemPromptUpdate = 'in-history'
    extendWithIntermediateToolStep(fixture)
    insertBefore(fixture.events, terminalAssistantIndex(fixture), {
      type: 'request/context',
      time: 1_299,
      data: { provider: 'fixed', model: 'fixed' },
    })

    expect(prove(fixture)).toMatchObject({ status: 'abstained' })
  })

  it('rejects a new request series while an appended prompt tail survives', () => {
    const fixture = completedV3GapTurn()
    requestContextData(fixture).systemPromptUpdate = 'in-history'
    extendWithIntermediateToolStep(fixture)
    insertBefore(fixture.events, terminalAssistantIndex(fixture), {
      type: 'request/header',
      time: 1_299,
      data: {
        header: { config: { provider: 'fixed', model: 'fixed' } },
        reason: 'series',
      },
    })

    expect(prove(fixture)).toMatchObject({ status: 'abstained' })
  })

  it('ignores only an explicitly ignorable unknown current-format event', () => {
    const fixture = completedV3GapTurn()
    insertBefore(fixture.events, 6, {
      type: 'future/optional-observation',
      time: 1_099,
      data: { opaque: true },
      ignorable: true,
    })

    expect(prove(fixture)).toMatchObject({ status: 'proven' })
  })

  it('accepts provisional empty identities in raw Tool-call deltas', () => {
    expect(prove(completedV3GapTurn({
      streamMutation: 'provisional-empty-tool-identity',
    }))).toMatchObject({ status: 'proven' })
  })

  it.each([
    ['deliverables/presented', {
      turn: 1,
      callId: 'gap-call',
      files: [{ path: 'artifact.txt' }],
    }],
    ['subagent/catalog', {
      version: 0,
      childId: 'child-session',
      childCreatedAt: 1_000,
      mode: 'one-shot',
    }],
  ] as const)('admits the required current %s vocabulary', (type, data) => {
    const fixture = completedV3GapTurn()
    insertBefore(fixture.events, 11, { type, time: 1_111, data })

    expect(prove(fixture)).toMatchObject({ status: 'proven' })
  })

  it.each([
    ['a top-level legacy chunk', 'legacy-chunk'],
    ['an unsupported native Assistant retry attempt', 'assistant-attempt'],
    ['an unsupported native surface replacement', 'surface-replacement'],
    ['an unsupported native PTC dispatch', 'ptc-dispatch'],
    ['obsolete Assistant chunk citations', 'assistant-citations'],
    ['a negative-zero event coordinate', 'negative-zero-event-seq'],
    ['a negative-zero event time', 'negative-zero-event-time'],
    ['a legacy request-header system field', 'legacy-header-system'],
    ['a System message after the first surface node', 'late-system-message'],
    ['a missing protected System head', 'missing-system-head'],
    ['an unsupported native compaction', 'compaction-prune'],
    ['an unsupported native compaction summary', 'compaction-summary'],
    ['an unsupported native compaction bracket', 'compaction-start'],
    ['surface metadata on a log-only event', 'log-only-surface-metadata'],
    ['a blank Assistant message id', 'blank-assistant-id'],
    ['an extra Assistant message field', 'extra-assistant-message-field'],
    ['an extra Assistant model-source field', 'extra-assistant-source-field'],
    ['an extra System data field', 'extra-system-data-field'],
    ['an extra System message field', 'extra-system-message-field'],
    ['an extra System plugin-source field', 'extra-system-source-field'],
    ['an extra System content-block field', 'extra-system-content-field'],
    ['a non-AgentLoop System plugin source', 'wrong-system-plugin'],
    ['multiple System text blocks', 'multiple-system-text-blocks'],
    ['a blank System text block instead of an empty message', 'blank-system-text-block'],
    ['a false ignorable marker', 'false-ignorable'],
    ['an extra event-envelope field', 'extra-envelope-field'],
    ['empty User source citations', 'empty-user-source-seqs'],
    ['duplicate User source citations', 'duplicate-user-source-seqs'],
    ['a future User source citation', 'future-user-source-seq'],
    ['an unknown required current-format event', 'unknown-required-event'],
    ['an unsupported retry schedule', 'llm-retry'],
    ['an unsupported retry start', 'llm-retry-started'],
    ['a non-string Tool call identity', 'numeric-tool-call-id'],
  ] as const)('fails closed when v3 includes %s', (_label, mutation) => {
    expect(prove(completedV3GapTurn({ mutation }))).toMatchObject({ status: 'abstained' })
  })

  it.each([
    ['a packed run has the wrong dt cardinality', 'dt-cardinality'],
    ['a packed run has a negative-zero index', 'negative-zero-index'],
    ['a packed run has a negative-zero time', 'negative-zero-packed-time'],
    ['a raw chunk has a negative-zero time', 'negative-zero-raw-time'],
    ['a compact record has an extra field', 'extra-record-field'],
    ['a raw chunk has an unknown discriminator', 'unknown-raw-chunk'],
    ['a delta targets no open block', 'orphan-delta'],
    ['a block index is reused', 'reused-index'],
    ['usage is duplicated', 'duplicate-usage'],
    ['the explicit finish is missing', 'missing-finish'],
    ['a record follows the terminal finish', 'after-finish'],
    ['assembled content differs from the durable message', 'content-mismatch'],
    ['assembled usage differs from the durable message', 'usage-mismatch'],
    ['assembled replay state differs from the durable source', 'replay-mismatch'],
    ['a matching replay envelope omits its required response', 'invalid-replay-envelope'],
  ] as const)('abstains when %s', (_label, streamMutation) => {
    expect(prove(completedV3GapTurn({ streamMutation }))).toMatchObject({
      status: 'abstained',
    })
  })

  it('reads max-token settlement from the embedded stream', () => {
    expect(prove(completedV3GapTurn({ terminalFinish: 'max-tokens' }))).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })
})

type FixtureMutation =
  | 'legacy-chunk'
  | 'assistant-attempt'
  | 'surface-replacement'
  | 'ptc-dispatch'
  | 'assistant-citations'
  | 'negative-zero-event-seq'
  | 'negative-zero-event-time'
  | 'legacy-header-system'
  | 'late-system-message'
  | 'missing-system-head'
  | 'compaction-prune'
  | 'compaction-summary'
  | 'compaction-start'
  | 'log-only-surface-metadata'
  | 'blank-assistant-id'
  | 'extra-assistant-message-field'
  | 'extra-assistant-source-field'
  | 'extra-system-data-field'
  | 'extra-system-message-field'
  | 'extra-system-source-field'
  | 'extra-system-content-field'
  | 'wrong-system-plugin'
  | 'multiple-system-text-blocks'
  | 'blank-system-text-block'
  | 'false-ignorable'
  | 'extra-envelope-field'
  | 'empty-user-source-seqs'
  | 'duplicate-user-source-seqs'
  | 'future-user-source-seq'
  | 'unknown-required-event'
  | 'llm-retry'
  | 'llm-retry-started'
  | 'numeric-tool-call-id'

type StreamMutation =
  | 'provisional-empty-tool-identity'
  | 'dt-cardinality'
  | 'negative-zero-index'
  | 'negative-zero-packed-time'
  | 'negative-zero-raw-time'
  | 'extra-record-field'
  | 'unknown-raw-chunk'
  | 'orphan-delta'
  | 'reused-index'
  | 'duplicate-usage'
  | 'missing-finish'
  | 'after-finish'
  | 'content-mismatch'
  | 'usage-mismatch'
  | 'replay-mismatch'
  | 'invalid-replay-envelope'

interface MutableTranscriptSource extends InteractionEpisodeTranscriptSourceV1 {
  header: SessionHeader & { version: number }
  events: Array<Record<string, unknown>>
  triggerCallId: string
}

function completedV3GapTurn(options: {
  readonly mutation?: FixtureMutation
  readonly streamMutation?: StreamMutation
  readonly terminalFinish?: 'stop' | 'max-tokens'
} = {}): MutableTranscriptSource & { readonly turnEndSeq: number } {
  const human = {
    id: 'human-message',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Publish this repository as a verified DSH plugin.' }],
  }
  const gapArguments = '{"name":"publish-dsh-plugin"}'
  const toolBlock = {
    type: 'tool-call',
    id: 'gap-call',
    name: 'report_capability_gap',
    arguments: gapArguments,
  }
  const toolUsage = { inputTokens: 1, outputTokens: 1 }
  const toolStream: Array<Record<string, unknown>> = [
    raw(1_100, { type: 'block-start', index: 0, blockType: 'tool-call' }),
    {
      type: 'tool-call-chunks',
      time0: 1_101,
      index: 0,
      dt: [],
      id: 'gap-call',
      name: 'report_capability_gap',
      args: [gapArguments],
    },
    raw(1_102, { type: 'block-end', index: 0, block: toolBlock }),
    raw(1_103, { type: 'usage', usage: toolUsage }),
    raw(1_104, { type: 'finish', reason: { kind: 'tool-calls' } }),
  ]
  mutateToolStream(toolStream, options.streamMutation)

  const terminalBlock = { type: 'text', text: 'ok' }
  const terminalUsage = { inputTokens: 1, outputTokens: 1 }
  const terminalReplayState = { response: { id: 'provider-response' } }
  const streamReplayState = options.streamMutation === 'invalid-replay-envelope'
    ? { blocks: [] }
    : terminalReplayState
  const terminalStream: Array<Record<string, unknown>> = [
    raw(1_200, { type: 'block-start', index: 0, blockType: 'text' }),
    { type: 'text-chunks', time0: 1_201, index: 0, dt: [], texts: ['ok'] },
    raw(1_202, { type: 'block-end', index: 0, block: terminalBlock }),
    raw(1_203, { type: 'usage', usage: terminalUsage }),
    raw(1_204, {
      type: 'finish',
      reason: { kind: options.terminalFinish ?? 'stop' },
      replayState: streamReplayState,
    }),
  ]

  const events: Array<Record<string, unknown>> = []
  const append = (
    type: string,
    data: unknown,
    surface?: { readonly surfaceOp: unknown; readonly sourceEventSeqs?: readonly number[] },
  ): Record<string, unknown> => {
    const event: Record<string, unknown> = {
      type,
      seq: events.length,
      time: 1_010 + events.length,
      data,
      ...(surface ?? {}),
    }
    events.push(event)
    return event
  }

  append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, inserted: [human],
  })
  append('turn/start', { turn: 1 })
  append('agent/inbox/spliced', {
    target: 'next-turn', start: 0, removedCount: 1, inserted: [],
  })
  append('step/start', { turn: 1, step: 1 })
  append('system/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'system-message',
      role: 'system',
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
      content: [{ type: 'text', text: 'Use the available tools.' }],
    },
  }, { surfaceOp: 'append' })
  append('user/message', human, { surfaceOp: 'append' })
  append('request/header', {
    header: { config: { provider: 'fixed', model: 'fixed' } }, reason: 'initial',
  })
  append('request/context', { provider: 'fixed', model: 'fixed' })
  const toolAssistant = append('assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'assistant-tool-message',
      role: 'assistant',
      source: { kind: 'model', provider: 'fixed', model: 'fixed' },
      content: options.streamMutation === 'content-mismatch'
        ? [{ type: 'text', text: 'forged' }, toolBlock]
        : [toolBlock],
    },
    stream: toolStream,
    usage: options.streamMutation === 'usage-mismatch'
      ? { inputTokens: 2, outputTokens: 1 }
      : toolUsage,
  }, { surfaceOp: 'append' })
  append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'gap-call',
    name: 'report_capability_gap',
    arguments: gapArguments,
  })
  append('tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'gap-result',
      role: 'user',
      source: { kind: 'tool', callId: 'gap-call' },
      content: [{
        type: 'tool-result',
        toolCallId: 'gap-call',
        isError: false,
        content: [{ type: 'text', text: 'Capability Gap recorded.' }],
      }],
    },
  }, { surfaceOp: 'append', sourceEventSeqs: [9] })
  append('step/end', { turn: 1, step: 1 })
  append('step/start', { turn: 1, step: 2 })
  append('assistant/message', {
    turn: 1,
    step: 2,
    message: {
      id: 'assistant-terminal-message',
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'fixed',
        model: 'fixed',
        replayState: options.streamMutation === 'replay-mismatch'
          ? { response: { id: 'forged-response' } }
          : streamReplayState,
      },
      content: [terminalBlock],
    },
    stream: terminalStream,
    usage: terminalUsage,
  }, { surfaceOp: 'append' })
  append('step/end', { turn: 1, step: 2 })
  const turnEnd = append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  turnEnd.time = 2_000
  let triggerCallId = 'gap-call'

  if (options.mutation === 'legacy-chunk') {
    insertBefore(events, 8, {
      type: 'assistant/chunk',
      time: 1_099,
      data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } },
    })
  } else if (options.mutation === 'assistant-attempt') {
    insertBefore(events, 8, {
      type: 'assistant/attempt',
      time: 1_099,
      data: {
        turn: 1,
        step: 1,
        stream: [raw(1_099, {
          type: 'finish',
          reason: { kind: 'error', failure: { message: 'retry', code: 'SERVER' } },
        })],
      },
    })
  } else if (options.mutation === 'surface-replacement') {
    events[5]!.surfaceOp = { op: 'replace', startSeq: 4, endSeq: 4 }
    events[5]!.sourceEventSeqs = [4]
  } else if (options.mutation === 'ptc-dispatch') {
    insertBefore(events, 10, {
      type: 'tool/ptc-dispatch',
      time: 1_109,
      data: {
        rootCallId: 'gap-call',
        parentCallId: 'gap-call',
        subCallId: 'gap-call:ptc:0',
        name: 'read',
        arguments: { path: 'README.md' },
        isError: false,
        content: [{ type: 'text', text: 'README' }],
      },
    })
  } else if (options.mutation === 'assistant-citations') {
    toolAssistant.sourceEventSeqs = [7]
  } else if (options.mutation === 'negative-zero-event-seq') {
    events[0]!.seq = -0
  } else if (options.mutation === 'negative-zero-event-time') {
    events[0]!.time = -0
  } else if (options.mutation === 'legacy-header-system') {
    const data = events[6]!.data as Record<string, unknown>
    const header = data.header as Record<string, unknown>
    header.system = 'legacy duplicate system prompt'
  } else if (options.mutation === 'late-system-message') {
    const [system] = events.splice(4, 1)
    if (system === undefined) throw new Error('fixture System message is missing')
    events.splice(7, 0, system)
    resequence(events)
    relinkToolResults(events)
  } else if (options.mutation === 'missing-system-head') {
    events.splice(4, 1)
    resequence(events)
    relinkToolResults(events)
  } else if (options.mutation === 'compaction-prune') {
    insertBefore(events, 6, {
      type: 'compaction/prune',
      time: 1_099,
      data: {
        shadowedRange: { start: 5, end: 5 },
        shadowedSeqs: [5],
        shadowedTokenCount: 1,
      },
    })
  } else if (options.mutation === 'compaction-summary') {
    insertBefore(events, 6, {
      type: 'compaction/summary',
      time: 1_099,
      data: {
        compactionId: 'compact-one',
        provider: 'fixed',
        model: 'fixed',
        summary: [{ type: 'text', text: 'summary' }],
        shadowedRange: { start: 5, end: 5 },
        shadowedSeqs: [5],
        shadowedTokenCount: 1,
      },
    })
  } else if (options.mutation === 'compaction-start') {
    insertBefore(events, 6, {
      type: 'compaction/start',
      time: 1_099,
      data: { compactionId: 'compact-one', turn: 1 },
    })
  } else if (options.mutation === 'log-only-surface-metadata') {
    events[1]!.surfaceOp = 'append'
  } else if (options.mutation === 'blank-assistant-id') {
    eventMessage(toolAssistant).id = ''
  } else if (options.mutation === 'extra-assistant-message-field') {
    eventMessage(toolAssistant).future = true
  } else if (options.mutation === 'extra-assistant-source-field') {
    messageSource(eventMessage(toolAssistant)).future = true
  } else if (options.mutation === 'extra-system-data-field') {
    eventData(events[4]!).future = true
  } else if (options.mutation === 'extra-system-message-field') {
    eventMessage(events[4]!).future = true
  } else if (options.mutation === 'extra-system-source-field') {
    messageSource(eventMessage(events[4]!)).future = true
  } else if (options.mutation === 'extra-system-content-field') {
    const content = eventMessage(events[4]!).content as Array<Record<string, unknown>>
    content[0]!.future = true
  } else if (options.mutation === 'wrong-system-plugin') {
    messageSource(eventMessage(events[4]!)).plugin = 'another-system-plugin'
  } else if (options.mutation === 'multiple-system-text-blocks') {
    const content = eventMessage(events[4]!).content as Array<Record<string, unknown>>
    content.push({ type: 'text', text: 'second prompt fragment' })
  } else if (options.mutation === 'blank-system-text-block') {
    const content = eventMessage(events[4]!).content as Array<Record<string, unknown>>
    content[0]!.text = ''
  } else if (options.mutation === 'false-ignorable') {
    events[1]!.ignorable = false
  } else if (options.mutation === 'extra-envelope-field') {
    events[1]!.future = true
  } else if (options.mutation === 'empty-user-source-seqs') {
    events[5]!.sourceEventSeqs = []
  } else if (options.mutation === 'duplicate-user-source-seqs') {
    events[5]!.sourceEventSeqs = [0, 0]
  } else if (options.mutation === 'future-user-source-seq') {
    events[5]!.sourceEventSeqs = [5]
  } else if (options.mutation === 'unknown-required-event') {
    insertBefore(events, 6, {
      type: 'future/required-observation',
      time: 1_099,
      data: { opaque: true },
    })
  } else if (options.mutation === 'llm-retry') {
    insertBefore(events, 8, {
      type: 'llm/retry',
      time: 1_099,
      data: {
        retryId: 'retry-one',
        turn: 1,
        step: 1,
        provider: 'fixed',
        mode: 'normal',
        policyKey: 'test',
        retry: 1,
        maxRetries: 2,
        delayMs: 1,
        failure: { message: 'retry', code: 'SERVER' },
      },
    })
  } else if (options.mutation === 'llm-retry-started') {
    insertBefore(events, 8, {
      type: 'llm/retry-started',
      time: 1_099,
      data: { retryId: 'retry-one', turn: 1, step: 1, retry: 1 },
    })
  } else if (options.mutation === 'numeric-tool-call-id') {
    triggerCallId = '7'
    toolBlock.id = triggerCallId
    toolStream[1]!.id = triggerCallId
    const call = events.find(event => event.type === 'tool/call')!
    eventData(call).callId = 7
    const result = events.find(event => event.type === 'tool/result')!
    const resultMessage = eventMessage(result)
    messageSource(resultMessage).callId = triggerCallId
    const [resultBlock] = resultMessage.content as Array<Record<string, unknown>>
    if (resultBlock === undefined) throw new Error('fixture Tool result block is missing')
    resultBlock.toolCallId = triggerCallId
  }

  const header = {
    version: 3,
    id: 'episode-v3-session',
    createdAt: 1_000,
    cwd: '/private/workspace',
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: 'default',
  } as unknown as SessionHeader & { version: number }
  return {
    header,
    inheritedEventCount: 0 as never,
    events,
    triggerCallId,
    snapshotEvents: () => events as unknown as readonly SessionEvent[],
    turnEndSeq: Number(turnEnd.seq),
  }
}

function requestContextData(fixture: MutableTranscriptSource): Record<string, unknown> {
  return fixture.events[7]!.data as Record<string, unknown>
}

function eventData(event: Record<string, unknown>): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

function eventMessage(event: Record<string, unknown>): Record<string, unknown> {
  return eventData(event).message as Record<string, unknown>
}

function messageSource(message: Record<string, unknown>): Record<string, unknown> {
  return message.source as Record<string, unknown>
}

function mutateToolStream(
  stream: Array<Record<string, unknown>>,
  mutation: StreamMutation | undefined,
): void {
  const packed = stream[1]!
  if (mutation === 'provisional-empty-tool-identity') {
    stream.splice(1, 0, raw(1_100, {
      type: 'tool-call-delta',
      index: 0,
      id: '',
      name: '',
      argumentsDelta: '',
    }))
  } else if (mutation === 'dt-cardinality') packed.dt = [1]
  else if (mutation === 'negative-zero-index') packed.index = -0
  else if (mutation === 'negative-zero-packed-time') packed.time0 = -0
  else if (mutation === 'negative-zero-raw-time') stream[0]!.time = -0
  else if (mutation === 'extra-record-field') packed.extra = true
  else if (mutation === 'unknown-raw-chunk') {
    stream[0] = raw(1_100, { type: 'future-chunk', value: true })
  } else if (mutation === 'orphan-delta') {
    stream.shift()
  } else if (mutation === 'reused-index') {
    stream.splice(3, 0,
      raw(1_102, { type: 'block-start', index: 0, blockType: 'text' }),
      { type: 'text-chunks', time0: 1_102, index: 0, dt: [], texts: ['again'] },
      raw(1_102, { type: 'block-end', index: 0, block: { type: 'text', text: 'again' } }),
    )
  } else if (mutation === 'duplicate-usage') {
    stream.splice(4, 0, raw(1_103, {
      type: 'usage', usage: { inputTokens: 1, outputTokens: 1 },
    }))
  } else if (mutation === 'missing-finish') stream.pop()
  else if (mutation === 'after-finish') {
    stream.push(raw(1_105, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }))
  }
}

function raw(time: number, chunk: Record<string, unknown>): Record<string, unknown> {
  return { type: 'chunk', time, chunk }
}

function laterSystemMessage(
  turn: number,
  step: number,
  text = 'Updated system context.',
): Record<string, unknown> {
  return {
    type: 'system/message',
    time: 1_199,
    data: {
      turn,
      step,
      message: {
        id: 'later-system-message',
        role: 'system',
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
        content: [{ type: 'text', text }],
      },
    },
    surfaceOp: 'append',
  }
}

function extendWithIntermediateToolStep(fixture: MutableTranscriptSource): void {
  const terminalIndex = terminalAssistantIndex(fixture)
  const terminal = fixture.events[terminalIndex]!
  const terminalEnd = fixture.events[terminalIndex + 1]!
  eventData(terminal).step = 3
  eventData(terminalEnd).step = 3

  const call = {
    type: 'tool-call',
    id: 'auxiliary-call',
    name: 'inspect_status',
    arguments: '{}',
  }
  const usage = { inputTokens: 1, outputTokens: 1 }
  const stream = [
    raw(1_210, { type: 'block-start', index: 0, blockType: 'tool-call' }),
    {
      type: 'tool-call-chunks',
      time0: 1_211,
      index: 0,
      dt: [],
      id: call.id,
      name: call.name,
      args: [call.arguments],
    },
    raw(1_212, { type: 'block-end', index: 0, block: call }),
    raw(1_213, { type: 'usage', usage }),
    raw(1_214, { type: 'finish', reason: { kind: 'tool-calls' } }),
  ]
  fixture.events.splice(
    terminalIndex,
    0,
    laterSystemMessage(1, 2),
    {
      type: 'assistant/message',
      time: 1_215,
      data: {
        turn: 1,
        step: 2,
        message: {
          id: 'assistant-auxiliary-message',
          role: 'assistant',
          source: { kind: 'model', provider: 'fixed', model: 'fixed' },
          content: [call],
        },
        stream,
        usage,
      },
      surfaceOp: 'append',
    },
    {
      type: 'tool/call',
      time: 1_216,
      data: {
        turn: 1,
        step: 2,
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
      },
    },
    {
      type: 'tool/result',
      time: 1_217,
      data: {
        turn: 1,
        step: 2,
        message: {
          id: 'auxiliary-result',
          role: 'user',
          source: { kind: 'tool', callId: call.id },
          content: [{
            type: 'tool-result',
            toolCallId: call.id,
            isError: false,
            content: [{ type: 'text', text: 'Status inspected.' }],
          }],
        },
      },
      surfaceOp: 'append',
      sourceEventSeqs: [0],
    },
    { type: 'step/end', time: 1_218, data: { turn: 1, step: 2 } },
    { type: 'step/start', time: 1_219, data: { turn: 1, step: 3 } },
  )
  resequence(fixture.events)
  relinkToolResults(fixture.events)
}

function terminalAssistantIndex(fixture: MutableTranscriptSource): number {
  const index = fixture.events.findIndex(event => event.type === 'assistant/message'
    && eventMessage(event).id === 'assistant-terminal-message')
  if (index < 0) throw new Error('fixture terminal Assistant message is missing')
  return index
}

function insertBefore(
  events: Array<Record<string, unknown>>,
  index: number,
  event: Record<string, unknown>,
): void {
  events.splice(index, 0, event)
  resequence(events)
  relinkToolResults(events)
}

function relinkToolResults(events: Array<Record<string, unknown>>): void {
  for (const candidate of events) {
    if (candidate.type !== 'tool/result') continue
    const callId = messageSource(eventMessage(candidate)).callId
    candidate.sourceEventSeqs = [events.findIndex(row => row.type === 'tool/call'
      && eventData(row).callId === callId)]
  }
}

function resequence(events: Array<Record<string, unknown>>): void {
  for (const [seq, event] of events.entries()) event.seq = seq
}

function prove(fixture: MutableTranscriptSource & { readonly turnEndSeq: number }) {
  return proveInteractionEpisodeTranscript(
    fixture,
    fixture.events.length - 1,
    { callId: fixture.triggerCallId },
  )
}
