import { createHash } from 'node:crypto'
import {
  Session,
  SessionId,
  SessionLogOffset,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { DurableInteractionEpisodeSubjectV1 } from '../src/interaction-episode-evidence-resolver.ts'
import { proveInteractionEpisodeTranscript } from '../src/interaction-episode-projector.ts'
import {
  projectInteractionEpisodeTriggerRequestControlV1,
} from '../src/interaction-trigger-request-control.ts'
import * as publicApi from '../src/index.ts'

describe('Interaction Episode trigger request control projection', () => {
  it('projects one digest-only, subject-bound alpha.5 request-control fact', () => {
    const subject = fixtureSubject()

    const result = projectSubject(subject)

    expect(result).toEqual({
      status: 'projected',
      fact: {
        schemaVersion: 1,
        kind: 'interaction-episode-trigger-request-control-fact-v1',
        sourceDialect: 'deepseek-harness@0.1.2-alpha.5',
        subject: {
          sessionId: 'episode-session',
          sessionFormatVersion: 0,
          inheritedEventCount: 0,
          throughSeq: 22,
          prefixDigest: subject.transcript.replay.prefixDigest,
          turnDigest: subject.transcript.replay.turnDigest,
        },
        boundary: {
          kind: 'trigger-assistant-and-tool-pair',
          requestHeaderSeq: 5,
          requestContextSeq: 6,
          assistantMessageSeq: 11,
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
        declaredRoute: {
          provider: 'fixture',
          model: 'fixture-model',
        },
        loggedControlDigest: 'b8206ce885bfed23f813f3c63c3014bf69ebc47ec682fc4f2dd92d6b6419e763',
      },
    })
    if (result.status !== 'projected') throw new Error('fixture did not project')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.fact)).toBe(true)
    expect(Object.isFrozen(result.fact.subject)).toBe(true)
    expect(Object.isFrozen(result.fact.boundary)).toBe(true)
    expect(Object.isFrozen(result.fact.declaredRoute)).toBe(true)
    expect(JSON.stringify(result.fact)).not.toContain('private system control')
    expect(JSON.stringify(result.fact)).not.toContain('ordered-tool')
    expect(result.fact).not.toHaveProperty('header')
    expect(result.fact).not.toHaveProperty('context')
    expect(result.fact).not.toHaveProperty('messages')
    expect(result.fact).not.toHaveProperty('servedModel')
    expect(result.fact).not.toHaveProperty('composition')
    expect(result.fact).not.toHaveProperty('budget')
  })

  it('projects the Session v3 request-control cohort under its exact dialect identity', () => {
    const subject = mutableSubject()
    subject.session.header.version = 3
    subject.transcript.session.formatVersion = 3
    Reflect.deleteProperty(requestHeader(subject).data.header, 'system')
    rebindReplayDigests(subject)

    const result = projectSubject(subject)

    expect(result).toMatchObject({
      status: 'projected',
      fact: {
        sourceDialect: 'deepseek-harness@0.1.5-rc.2',
        subject: { sessionFormatVersion: 3 },
      },
    })
    expect(projectedFact(subject).loggedControlDigest)
      .not.toBe(projectedFact(fixtureSubject()).loggedControlDigest)
  })

  it('binds only the rc.2 in-history system-prompt request context', () => {
    const baseline = mutableSubject()
    baseline.session.header.version = 3
    baseline.transcript.session.formatVersion = 3
    Reflect.deleteProperty(requestHeader(baseline).data.header, 'system')
    rebindReplayDigests(baseline)

    const supported = structuredClone(baseline) as unknown as MutableSubject
    requestContext(supported).data.systemPromptUpdate = 'in-history'
    rebindReplayDigests(supported)

    expect(projectSubject(supported)).toMatchObject({ status: 'projected' })
    expect(projectedFact(supported).loggedControlDigest)
      .not.toBe(projectedFact(baseline).loggedControlDigest)

    const unknown = structuredClone(baseline) as unknown as MutableSubject
    requestContext(unknown).data.systemPromptUpdate = 'leading'
    rebindReplayDigests(unknown)
    expect(projectSubject(unknown)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('rejects the retired request-header system field in Session v3', () => {
    const subject = mutableSubject()
    subject.session.header.version = 3
    subject.transcript.session.formatVersion = 3
    rebindReplayDigests(subject)

    expect(projectSubject(subject)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('rejects a Session header/transcript dialect mismatch', () => {
    const subject = mutableSubject()
    subject.session.header.version = 3
    rebindReplayDigests(subject)

    expect(projectSubject(subject)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('binds the controls to the transcript digests before projecting them', () => {
    const changed = mutableSubject()
    requestHeader(changed).data.header.system = 'different system control'

    expect(projectSubject(changed)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('hashes logged controls but excludes assistant replay state', () => {
    const baseline = projectedFact(fixtureSubject())
    const replayOnly = mutableSubject()
    assistantSource(replayOnly).replayState = { opaque: 'changed' }
    rebindReplayDigests(replayOnly)

    expect(projectedFact(replayOnly).loggedControlDigest)
      .toBe(baseline.loggedControlDigest)

    const changedSystem = mutableSubject()
    requestHeader(changedSystem).data.header.system = 'different system control'
    rebindReplayDigests(changedSystem)
    expect(projectedFact(changedSystem).loggedControlDigest)
      .not.toBe(baseline.loggedControlDigest)

    const changedToolOrder = mutableSubject()
    requestHeader(changedToolOrder).data.header.tools.reverse()
    rebindReplayDigests(changedToolOrder)
    expect(projectedFact(changedToolOrder).loggedControlDigest)
      .not.toBe(baseline.loggedControlDigest)

    const changedSchemaKeyOrder = mutableSubject()
    const firstTool = requestHeader(changedSchemaKeyOrder).data.header.tools[0]!
    const parameters = firstTool.parameters as Record<string, unknown>
    firstTool.parameters = {
      properties: structuredClone(parameters.properties),
      type: parameters.type,
    }
    rebindReplayDigests(changedSchemaKeyOrder)
    expect(projectedFact(changedSchemaKeyOrder).loggedControlDigest)
      .not.toBe(baseline.loggedControlDigest)

    const changedContext = mutableSubject()
    requestContext(changedContext).data.contextWindow = 65_536
    rebindReplayDigests(changedContext)
    expect(projectedFact(changedContext).loggedControlDigest)
      .not.toBe(baseline.loggedControlDigest)
  })

  it('accepts a changed header that reuses an older effective context', () => {
    const subject = mutableSubject()
    const oldHeader = requestHeader(subject)
    oldHeader.data.header.system = 'older system control'
    oldHeader.seq = 2
    subject.session.events[2] = oldHeader
    subject.session.events[5] = {
      type: 'request/header',
      seq: 5,
      time: 1_005,
      data: {
        header: {
          ...structuredClone(oldHeader.data.header),
          system: 'private system control',
        },
        reason: 'change',
      },
    }
    requestContext(subject).seq = 3
    subject.session.events[3] = requestContext(subject)
    subject.session.events[6] = fixtureEvent(6)
    subject.transcript.witness.assistantRequestRoutes[0]!.contextSeq = 3
    subject.transcript.witness.assistantRequestRoutes[1]!.contextSeq = 3
    rebindReplayDigests(subject)

    const result = projectSubject(subject)

    expect(result).toMatchObject({
      status: 'projected',
      fact: {
        boundary: { requestHeaderSeq: 5, requestContextSeq: 3 },
      },
    })
  })

  it('projects the alpha.5 Skill Tool error trigger with its exact polarity', () => {
    const subject = mutableSubject()
    subject.session.events[8]!.data.chunk.name = 'skill'
    subject.session.events[9]!.data.chunk.block.name = 'skill'
    subject.session.events[11]!.data.message.content[0].name = 'skill'
    subject.session.events[12]!.data.name = 'skill'
    subject.session.events[13]!.data.message.content[0].isError = true
    subject.transcript.trigger.kind = 'skill-tool-error'
    rebindReplayDigests(subject)

    expect(projectSubject(productionSubject(subject))).toMatchObject({
      status: 'projected',
      fact: {
        boundary: {
          triggerCallSeq: 12,
          triggerResultSeq: 13,
        },
      },
    })

    subject.session.events[13]!.data.message.content[0].isError = false
    rebindReplayDigests(subject)
    expect(projectSubject(subject)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('binds a seeded, inherited event prefix and nonzero enqueue coordinate', () => {
    const subject = productionSubject(seededSubject())

    expect(projectSubject(subject)).toMatchObject({
      status: 'projected',
      fact: {
        subject: {
          inheritedEventCount: 2,
          throughSeq: 25,
          prefixDigest: subject.transcript.replay.prefixDigest,
        },
        boundary: {
          requestHeaderSeq: 8,
          requestContextSeq: 9,
          assistantMessageSeq: 14,
          triggerCallSeq: 15,
          triggerResultSeq: 16,
        },
      },
    })

    const stalePrefix = structuredClone(subject) as unknown as MutableSubject
    stalePrefix.session.events[0]!.data.turn = 99
    expect(projectSubject(stalePrefix)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })

    const staleHeader = structuredClone(subject) as unknown as MutableSubject
    staleHeader.session.header.cwd = '/different/private/workspace'
    expect(projectSubject(staleHeader)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it.each([
    ['missing trigger route', (subject: MutableSubject) => {
      subject.transcript.witness.assistantRequestRoutes.splice(0, 1)
    }],
    ['duplicate trigger route', (subject: MutableSubject) => {
      subject.transcript.witness.assistantRequestRoutes.push(
        structuredClone(subject.transcript.witness.assistantRequestRoutes[0]!),
      )
    }],
    ['wrong header event type', (subject: MutableSubject) => {
      subject.session.events[5]!.type = 'request/context'
    }],
    ['stale header witness', (subject: MutableSubject) => {
      subject.session.events[7] = structuredClone(subject.session.events[5]!)
      subject.session.events[7]!.seq = 7
    }],
    ['out-of-cut context witness', (subject: MutableSubject) => {
      subject.transcript.witness.assistantRequestRoutes[0]!.contextSeq = 23
    }],
    ['non-dense event coordinates', (subject: MutableSubject) => {
      subject.session.events[8]!.seq = 7
    }],
    ['durable cut mismatch', (subject: MutableSubject) => {
      subject.session.throughSeq = 21
    }],
    ['transcript session mismatch', (subject: MutableSubject) => {
      subject.transcript.session.id = 'different-session'
    }],
    ['unsupported Session format', (subject: MutableSubject) => {
      subject.session.header.version = 1
      subject.transcript.session.formatVersion = 1
    }],
    ['assistant before request controls', (subject: MutableSubject) => {
      subject.transcript.witness.assistantRequestRoutes[0]!.headerSeq = 12
    }],
    ['trigger call before assistant', (subject: MutableSubject) => {
      subject.transcript.source.triggerCallSeq = 10
    }],
    ['trigger result before call', (subject: MutableSubject) => {
      subject.transcript.source.triggerResultSeq = 12
    }],
    ['non-model assistant source', (subject: MutableSubject) => {
      assistantSource(subject).kind = 'user'
    }],
    ['header and context provider disagree', (subject: MutableSubject) => {
      requestContext(subject).data.provider = 'other-provider'
    }],
    ['header and assistant model disagree', (subject: MutableSubject) => {
      assistantSource(subject).model = 'other-model'
    }],
    ['assistant trigger arguments disagree with the call', (subject: MutableSubject) => {
      subject.session.events[11]!.data.message.content[0].arguments = '{"name":"other"}'
    }],
    ['trigger call name disagrees with the proof', (subject: MutableSubject) => {
      subject.session.events[12]!.data.name = 'skill'
    }],
    ['trigger requested Skill disagrees with the call', (subject: MutableSubject) => {
      subject.transcript.trigger.requestedSkill = 'other-skill'
    }],
    ['trigger result polarity disagrees with the proof', (subject: MutableSubject) => {
      subject.session.events[13]!.data.message.content[0].isError = true
    }],
    ['successful trigger carries error metadata', (subject: MutableSubject) => {
      subject.session.events[13]!.data.error = { name: 'Error', code: 'CONTRADICTORY' }
    }],
    ['duplicate trigger block', (subject: MutableSubject) => {
      subject.session.events[11]!.data.message.content.push(
        structuredClone(subject.session.events[11]!.data.message.content[0]),
      )
    }],
    ['trigger result block cites a different call', (subject: MutableSubject) => {
      subject.session.events[13]!.data.message.content[0].toolCallId = 'other-call'
    }],
    ['trigger result cites a different source event', (subject: MutableSubject) => {
      subject.session.events[13]!.sourceEventSeqs = [11]
    }],
    ['noncanonical empty tools', (subject: MutableSubject) => {
      requestHeader(subject).data.header.tools = []
    }],
    ['noncanonical empty system', (subject: MutableSubject) => {
      requestHeader(subject).data.header.system = ''
    }],
  ] as const)('abstains on %s', (_label, mutate) => {
    const subject = mutableSubject()
    mutate(subject)
    rebindReplayDigests(subject)

    expect(projectSubject(subject)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('does not invoke hostile getters and never throws for hostile input', () => {
    const getter = vi.fn(() => fixtureSubject().session)
    const hostile = Object.defineProperty({
      schemaVersion: 1,
      kind: 'durable-interaction-episode-subject-v1',
      transcript: fixtureSubject().transcript,
    }, 'session', {
      enumerable: true,
      get: getter,
    })

    expect(projectInteractionEpisodeTriggerRequestControlV1(
      hostile as unknown as DurableInteractionEpisodeSubjectV1,
    )).toEqual({ status: 'abstained', reason: 'subject-mismatch' })
    expect(getter).not.toHaveBeenCalled()

    const proxy = new Proxy(fixtureSubject(), {
      ownKeys() {
        throw new Error('hostile proxy')
      },
    })
    expect(() => projectInteractionEpisodeTriggerRequestControlV1(proxy))
      .not.toThrow()
    expect(projectInteractionEpisodeTriggerRequestControlV1(proxy)).toEqual({
      status: 'abstained',
      reason: 'subject-mismatch',
    })
  })

  it('keeps the projection out of the package root', () => {
    expect(publicApi).not.toHaveProperty('projectInteractionEpisodeTriggerRequestControlV1')
  })
})

function projectedFact(subject: DurableInteractionEpisodeSubjectV1 | MutableSubject) {
  const result = projectSubject(subject)
  if (result.status !== 'projected') throw new Error('fixture did not project')
  return result.fact
}

function fixtureSubject(): DurableInteractionEpisodeSubjectV1 {
  const events = Array.from({ length: 23 }, (_, seq) => fixtureEvent(seq))
  const human = {
    id: 'human-message',
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'Find a reusable release audit method.' }],
  }
  events[0] = {
    type: 'agent/inbox/spliced',
    seq: 0,
    time: 1_000,
    data: { target: 'next-turn', start: 0, inserted: [human] },
  }
  events[1] = {
    type: 'turn/start',
    seq: 1,
    time: 1_001,
    data: { turn: 1 },
  }
  events[2] = {
    type: 'agent/inbox/spliced',
    seq: 2,
    time: 1_002,
    data: {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [],
    },
  }
  events[3] = {
    type: 'step/start',
    seq: 3,
    time: 1_003,
    data: { turn: 1, step: 1 },
  }
  events[4] = {
    type: 'user/message',
    seq: 4,
    time: 1_004,
    data: human,
    surfaceOp: 'append',
  }
  events[5] = {
    type: 'request/header',
    seq: 5,
    time: 1_005,
    data: {
      header: {
        config: {
          provider: 'fixture',
          model: 'fixture-model',
          reasoningEffort: 'high',
          temperature: 0.2,
          maxTokens: 4_096,
          stop: ['END', 'STOP'],
        },
        adapterDefaults: { maxTokens: true },
        system: 'private system control',
        tools: [
          {
            name: 'ordered-tool',
            description: 'First tool.',
            parameters: { type: 'object', properties: { value: { type: 'string' } } },
          },
          {
            name: 'second-tool',
            description: 'Second tool.',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
      reason: 'initial',
    },
  }
  events[6] = {
    type: 'request/context',
    seq: 6,
    time: 1_006,
    data: {
      provider: 'fixture',
      model: 'fixture-model',
      contextWindow: 32_768,
    },
  }
  events[7] = {
    type: 'assistant/chunk',
    seq: 7,
    time: 1_007,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'tool-call' },
    },
  }
  events[8] = {
    type: 'assistant/chunk',
    seq: 8,
    time: 1_008,
    data: {
      turn: 1,
      step: 1,
      chunk: {
        type: 'tool-call-delta',
        index: 0,
        id: 'gap-call',
        name: 'report_capability_gap',
        argumentsDelta: '{"name":"release-audit"}',
      },
    },
  }
  events[9] = {
    type: 'assistant/chunk',
    seq: 9,
    time: 1_009,
    data: {
      turn: 1,
      step: 1,
      chunk: {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: 'gap-call',
          name: 'report_capability_gap',
          arguments: '{"name":"release-audit"}',
        },
      },
    },
  }
  events[10] = {
    type: 'assistant/chunk',
    seq: 10,
    time: 1_010,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'finish', reason: { kind: 'tool-calls' } },
    },
  }
  events[11] = {
    type: 'assistant/message',
    seq: 11,
    time: 1_011,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'trigger-assistant',
        role: 'assistant',
        source: {
          kind: 'model',
          provider: 'fixture',
          model: 'fixture-model',
        },
        content: [{
          type: 'tool-call',
          id: 'gap-call',
          name: 'report_capability_gap',
          arguments: '{"name":"release-audit"}',
        }],
      },
    },
    sourceEventSeqs: [7, 8, 9, 10],
    surfaceOp: 'append',
  }
  events[12] = {
    type: 'tool/call',
    seq: 12,
    time: 1_012,
    data: {
      turn: 1,
      step: 1,
      callId: 'gap-call',
      name: 'report_capability_gap',
      arguments: '{"name":"release-audit"}',
    },
  }
  events[13] = {
    type: 'tool/result',
    seq: 13,
    time: 1_013,
    data: {
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
    },
    sourceEventSeqs: [12],
    surfaceOp: 'append',
  }
  events[14] = {
    type: 'step/end',
    seq: 14,
    time: 1_014,
    data: { turn: 1, step: 1 },
  }
  events[15] = {
    type: 'step/start',
    seq: 15,
    time: 1_015,
    data: { turn: 1, step: 2 },
  }
  events[16] = {
    type: 'assistant/chunk',
    seq: 16,
    time: 1_016,
    data: {
      turn: 1,
      step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    },
  }
  events[17] = {
    type: 'assistant/chunk',
    seq: 17,
    time: 1_017,
    data: {
      turn: 1,
      step: 2,
      chunk: { type: 'text-delta', index: 0, text: 'The gap was recorded.' },
    },
  }
  events[18] = {
    type: 'assistant/chunk',
    seq: 18,
    time: 1_018,
    data: {
      turn: 1,
      step: 2,
      chunk: {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'The gap was recorded.' },
      },
    },
  }
  events[19] = {
    type: 'assistant/chunk',
    seq: 19,
    time: 1_019,
    data: {
      turn: 1,
      step: 2,
      chunk: { type: 'finish', reason: { kind: 'stop' } },
    },
  }
  events[20] = {
    type: 'assistant/message',
    seq: 20,
    time: 1_020,
    data: {
      turn: 1,
      step: 2,
      message: {
        id: 'terminal-assistant',
        role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
        content: [{ type: 'text', text: 'The gap was recorded.' }],
      },
    },
    sourceEventSeqs: [16, 17, 18, 19],
    surfaceOp: 'append',
  }
  events[21] = {
    type: 'step/end',
    seq: 21,
    time: 1_021,
    data: { turn: 1, step: 2 },
  }
  events[22] = {
    type: 'turn/end',
    seq: 22,
    time: 1_022,
    data: { turn: 1, reason: { kind: 'completed' } },
  }
  const subject = {
    schemaVersion: 1,
    kind: 'durable-interaction-episode-subject-v1',
    session: {
      header: {
        version: 0,
        id: 'episode-session',
        createdAt: 1_000,
        cwd: '/private/workspace',
        isSeeded: false,
        agentPreset: 'default',
      },
      inheritedEventCount: 0,
      throughSeq: 22,
      events,
    },
    transcript: {
      session: {
        id: 'episode-session',
        formatVersion: 0,
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
        initiatingMessageSeq: 4,
        triggerCallSeq: 12,
        triggerResultSeq: 13,
        turnEndSeq: 22,
        completedAt: 1_022,
      },
      witness: {
        admissionStepStartSeq: 3,
        triggerRequestSeq: 11,
        assistantRequestRoutes: [
          { assistantMessageSeq: 11, headerSeq: 5, contextSeq: 6 },
          { assistantMessageSeq: 20, headerSeq: 5, contextSeq: 6 },
        ],
      },
      ingress: {
        messageId: 'human-message',
        source: 'user',
        digest: 'a'.repeat(64),
      },
      trigger: {
        kind: 'successful-gap-report',
        callId: 'gap-call',
        requestedSkill: 'release-audit',
      },
      replay: {
        availability: 'source-dependent',
        transcript: 'exact',
        prefixDigest: 'a'.repeat(64),
        turnDigest: 'b'.repeat(64),
      },
    },
  } as unknown as MutableSubject
  rebindReplayDigests(subject)
  return subject as unknown as DurableInteractionEpisodeSubjectV1
}

function fixtureEvent(seq: number): MutableEvent {
  return { type: 'fixture/event', seq, time: 1_000 + seq, data: {} }
}

type MutableEvent = {
  type: string
  seq: number
  time: number
  data: Record<string, any>
  sourceEventSeqs?: number[]
  surfaceOp?: string
}

type MutableSubject = {
  schemaVersion: number
  kind: string
  session: {
    header: Record<string, unknown>
    inheritedEventCount: number
    throughSeq: number
    events: MutableEvent[]
  }
  transcript: {
    session: {
      id: string
      formatVersion: number
      createdAt: number
      inheritedEventCount: number
      parentSessionId?: string
      agentPreset?: string
    }
    source: {
      triggerCallSeq: number
      triggerResultSeq: number
      turnEndSeq: number
      [key: string]: unknown
    }
    witness: {
      triggerRequestSeq: number
      assistantRequestRoutes: Array<{
        assistantMessageSeq: number
        headerSeq: number
        contextSeq: number
      }>
      [key: string]: unknown
    }
    replay: Record<string, unknown>
    trigger: Record<string, unknown>
    [key: string]: unknown
  }
}

function mutableSubject() {
  return structuredClone(fixtureSubject()) as unknown as MutableSubject
}

function seededSubject(): MutableSubject {
  const subject = mutableSubject()
  const offset = 3
  for (const event of subject.session.events) {
    event.seq += offset
    if (event.data.turn === 1) event.data.turn = 2
    if (event.sourceEventSeqs !== undefined) {
      event.sourceEventSeqs = event.sourceEventSeqs.map(seq => seq + offset)
    }
  }
  subject.session.events.unshift(
    {
      type: 'turn/start',
      seq: 0,
      time: 998,
      data: { turn: 1 },
    },
    {
      type: 'turn/end',
      seq: 1,
      time: 999,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
    {
      type: 'session/end-seed',
      seq: 2,
      time: 999,
      data: {},
    },
  )
  subject.session.header.parentSession = 'parent-session'
  subject.session.header.isSeeded = true
  subject.session.inheritedEventCount = 2
  subject.session.throughSeq += offset
  subject.transcript.session.parentSessionId = 'parent-session'
  subject.transcript.session.inheritedEventCount = 2
  subject.transcript.source.prefixThroughSeq = offset - 1
  subject.transcript.source.turn = 2
  for (const key of [
    'enqueueSeq',
    'turnStartSeq',
    'claimSeq',
    'initiatingMessageSeq',
    'triggerCallSeq',
    'triggerResultSeq',
    'turnEndSeq',
  ] as const) {
    subject.transcript.source[key] =
      (subject.transcript.source[key] as number) + offset
  }
  subject.transcript.witness.admissionStepStartSeq =
    (subject.transcript.witness.admissionStepStartSeq as number) + offset
  subject.transcript.witness.triggerRequestSeq += offset
  for (const route of subject.transcript.witness.assistantRequestRoutes) {
    route.assistantMessageSeq += offset
    route.headerSeq += offset
    route.contextSeq += offset
  }
  rebindReplayDigests(subject)
  return subject
}

function productionSubject(subject: MutableSubject): DurableInteractionEpisodeSubjectV1 {
  const throughSeq = subject.transcript.source.turnEndSeq
  const inheritedEventCount = subject.session.inheritedEventCount
  const seed = inheritedEventCount === 0
    ? undefined
    : structuredClone(subject.session.events.slice(0, inheritedEventCount))
  const session = Session.create(
    SessionId(subject.transcript.session.id),
    seed as unknown as SessionEvent[] | undefined,
    structuredClone(subject.session.header) as unknown as SessionHeader,
    SessionLogOffset(inheritedEventCount),
  )
  const nextExpectedSeq = session.snapshotEvents().length
  for (const event of subject.session.events.slice(nextExpectedSeq)) {
    appendFixtureEvent(session, event)
  }
  const transcript = proveInteractionEpisodeTranscript(session, throughSeq, {
    callId: String(subject.transcript.trigger.callId),
  })
  if (transcript.status !== 'proven') {
    throw new Error(`fixture is not production-reachable: ${transcript.reason}`)
  }
  return {
    schemaVersion: 1,
    kind: 'durable-interaction-episode-subject-v1',
    session: {
      header: session.header,
      inheritedEventCount: Number(session.inheritedEventCount),
      throughSeq,
      events: session.snapshotEvents(
        SessionLogOffset(0),
        SessionLogOffset(throughSeq + 1),
      ),
    },
    transcript: transcript.proof,
  }
}

function appendFixtureEvent(session: Session, event: MutableEvent): void {
  const append = session.append as unknown as (
    type: string,
    data: Record<string, unknown>,
    options?: { readonly surfaceOp: string; readonly sourceEventSeqs?: number[] },
  ) => SessionEvent
  const data = structuredClone(event.data)
  if (event.surfaceOp === undefined) {
    append.call(session, event.type, data)
    return
  }
  append.call(session, event.type, data, {
    surfaceOp: event.surfaceOp,
    ...(event.sourceEventSeqs === undefined
      ? {}
      : { sourceEventSeqs: [...event.sourceEventSeqs] }),
  })
}

function requestHeader(subject: MutableSubject) {
  return subject.session.events[5]! as MutableEvent & {
    data: {
      header: {
        config: Record<string, unknown>
        adapterDefaults: Record<string, true>
        system: string
        tools: Array<Record<string, unknown>>
      }
      reason: string
      startsSeries?: true
    }
  }
}

function requestContext(subject: MutableSubject) {
  return subject.session.events[6]! as MutableEvent & {
    data: { provider: string; model: string; contextWindow: number }
  }
}

function assistantSource(subject: MutableSubject) {
  return subject.session.events[11]!.data.message.source as {
    kind: string
    provider: string
    model: string
    replayState?: unknown
  }
}

function projectSubject(
  subject: DurableInteractionEpisodeSubjectV1 | MutableSubject,
) {
  return projectInteractionEpisodeTriggerRequestControlV1(
    subject as unknown as DurableInteractionEpisodeSubjectV1,
  )
}

function rebindReplayDigests(subject: MutableSubject): void {
  const enqueueSeq = subject.transcript.source.enqueueSeq as number
  const turnEndSeq = subject.transcript.source.turnEndSeq
  const identity = {
    id: subject.transcript.session.id,
    formatVersion: subject.transcript.session.formatVersion,
    createdAt: subject.transcript.session.createdAt,
  }
  subject.transcript.replay.prefixDigest = testHashCanonical({
    domain: 'evoforge_interaction_episode_prefix',
    version: 1,
    session: {
      header: subject.session.header,
      inheritedEventCount: subject.session.inheritedEventCount,
    },
    throughSeq: enqueueSeq === 0 ? null : enqueueSeq - 1,
    events: subject.session.events.slice(0, enqueueSeq),
  })
  subject.transcript.replay.turnDigest = testHashCanonical({
    domain: 'evoforge_interaction_episode_turn',
    version: 1,
    session: identity,
    fromSeq: enqueueSeq,
    throughSeq: turnEndSeq,
    events: subject.session.events.slice(enqueueSeq, turnEndSeq + 1),
  })
}

function testHashCanonical(value: unknown): string {
  return createHash('sha256').update(testCanonicalJson(value)).digest('hex')
}

function testCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(testCanonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key =>
      `${JSON.stringify(key)}:${testCanonicalJson(record[key])}`).join(',')}}`
  }
  throw new TypeError('test fixture is not canonical JSON')
}
