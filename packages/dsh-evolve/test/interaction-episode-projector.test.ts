import type {} from '@deepseek-ai/dsh-agent'
import { GoalId } from '@deepseek-ai/dsh-goal'
import {
  type ContentBlock,
  freezeMessage,
  MessageId,
  type ReplayEnvelope,
  type TokenUsage,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proveInteractionEpisodeTranscript } from '../src/interaction-episode-projector.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Interaction Episode transcript proof', () => {
  it('proves one exact completed human turn without inventing environment evidence', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn()

    const result = proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result).toEqual({
      status: 'proven',
      proof: {
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
          completedAt: 2_000,
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
          digest: '82aaa117b7ee1d98e139140b9077b86b3d2de2d5a08880cf291583d7a85ef898',
        },
        trigger: {
          kind: 'successful-gap-report',
          callId: 'gap-call',
          requestedSkill: 'release-audit',
        },
        replay: {
          availability: 'source-dependent',
          transcript: 'exact',
          prefixDigest: '0a1451c3bcf8d019e071e83d1dc53b8a68c7f8b54ac9a5709caefcb8687b07a9',
          turnDigest: 'e6f1f27f788fea756dab1aeda780ca3cb60da7c7d3d10edae0717907995de1f2',
        },
      },
    })
    expect(result.status).toBe('proven')
    if (result.status !== 'proven') throw new Error('fixture should be proven')
    expect(Object.isFrozen(result.proof)).toBe(true)
    expect(Object.isFrozen(result.proof.session)).toBe(true)
    expect(Object.isFrozen(result.proof.witness.assistantRequestRoutes)).toBe(true)
    expect(Object.isFrozen(result.proof.witness.assistantRequestRoutes[0])).toBe(true)
  })

  it('rejects a reverse-mixed v3 embedded stream in a format-v0 Assistant message', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn()
    const events = structuredClone(session.snapshotEvents()) as unknown as Array<{
      type: string
      data: Record<string, unknown>
    }>
    const assistant = events.find(event => event.type === 'assistant/message')
    if (assistant === undefined) throw new Error('fixture Assistant message is missing')
    assistant.data.stream = []

    expect(proveInteractionEpisodeTranscript({
      header: session.header,
      inheritedEventCount: session.inheritedEventCount,
      snapshotEvents: () => events as unknown as readonly SessionEvent[],
    }, turnEndSeq, { callId: 'gap-call' })).toEqual({
      status: 'abstained',
      reason: 'transcript-not-proven',
    })
  })

  it('abstains when another direct human input interleaves before turn completion', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      interleavedHuman: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'human-ingress-not-proven',
    })
  })

  it('abstains when a second direct human message is admitted in the same turn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      secondAdmittedHuman: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when the claimed inbox payload differs despite reusing the human Message id', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacedClaimPayload: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when a wrong same-id enqueue is repaired only after its durable insertion', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      repairedWrongEnqueuePayload: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when one completed turn contains more than one Gap trigger', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      multipleGapTriggers: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'trigger-not-proven',
    })
  })

  it('abstains when a durable Tool call does not match the model output that requested it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      assistantRequestedSkill: 'different-audit',
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'trigger-not-proven',
    })
  })

  it.each([
    ['human ingress has the assistant role', 'ingress-role'],
    ['settled assistant has the user role', 'assistant-role'],
    ['settled assistant has a non-model source', 'assistant-source'],
    ['Tool result has the assistant role', 'result-role'],
    ['Tool result has a non-Tool source', 'result-source'],
    ['Tool result has an extra content block', 'result-extra-block'],
  ] as const)('abstains when %s', (_label, invalidMessageShape) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({ invalidMessageShape })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it.each([
    ['missing name', 'missing'],
    ['uppercase name', 'uppercase'],
    ['name longer than 128 characters', 'too-long'],
  ] as const)('abstains from pair-consistent Gap arguments with %s', (_label, invalidRequestedSkill) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({ invalidRequestedSkill })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('abstains when the authorizing assistant request predates human admission', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      assistantBeforeIngress: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'causal-order-invalid',
    })
  })

  it('abstains when model output starts before human admission', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      assistantChunkBeforeIngress: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it('abstains when another admitted message precedes the initiating human', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      pluginMessageBeforeInitiating: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when a settled assistant message does not cite its provider chunks', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      uncitedTriggerAssistant: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it.each([
    ['content', { mismatchedAssistantContent: true }],
    ['usage', { mismatchedAssistantUsage: true }],
    ['replay state', { mismatchedAssistantReplayState: true }],
  ] as const)('abstains when cited provider chunks diverge from assistant %s', (_label, options) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn(options)

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when an assistant cites only a semantically equivalent chunk subset', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      partialAssistantCitation: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a same-step retry changes the fixed system assembly', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      retryChangesSystem: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when model output has no preceding durable request header', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      omitRequestHeader: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when model output has no preceding durable request context', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      omitRequestContext: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when the model source diverges from its durable request route', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      mismatchedRequestRoute: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('accepts a changed request route after one fully failed model attempt', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      retryBeforeTrigger: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a same-step retry forges a resume header', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      resumeHeaderRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it.each([
    ['series', { seriesHeaderRetryWithoutReplacement: true }],
    ['change + startsSeries', { changeSeriesHeaderRetryWithoutReplacement: true }],
  ] as const)('abstains when a same-step retry forges an unprompted %s header', (_label, options) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn(options)

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('accepts a cited empty assistant response from a zero-chunk provider stream', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      emptyTerminalResponse: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a zero-chunk final retry changes the fixed system assembly', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      emptyFinalRetryChangesSystem: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a zero-chunk final retry ignores a surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      emptyFinalReplacementBeforeUnmarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('accepts settled model streams that rely on the assembler default finish', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      omitSettledFinishChunks: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when request context precedes its fresh request header', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      contextBeforeHeader: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when request metadata splits one successful model stream', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      requestMetadataDuringSuccess: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when request metadata splits one failed model stream', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      requestMetadataDuringFailedStream: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when request metadata trails the final failed attempt in a step', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      trailingFailedPriorRequestRoute: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('does not let a later series marker launder an earlier unmarked failed retry', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      failedRetryMarkerLaundering: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a retry ignores a committed surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementBeforeUnmarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('accepts the request-series marker required after a surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementBeforeMarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a marked retry sees content that replaced the initiating human input', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      divergentReplacementBeforeMarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when a transient divergent replacement is restored before a marked retry', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      transientDivergentReplacementBeforeMarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'human-ingress-not-proven' })
  })

  it('abstains when the next step ignores a committed surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementBeforeUnmarkedTerminalRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('accepts a next-step request-series marker after a surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementBeforeMarkedTerminalRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('carries a post-header replacement into the following request generation', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementAfterMarkedRetryHeader: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('carries an ambiguous pre-header replacement into the following request', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      replacementBeforeInitialHeader: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('reuses a prior-turn request generation when the surface is unchanged', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reusePriorTurnRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('continues after a valid prior max-token turn without discarding its request anchor', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorMaxTokensTurn: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a max-token prior step claims a completed turn ending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      completedPriorMaxTokensTurn: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when an all-error Tool step claims a completed prior turn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      completedPriorErrorToolStep: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('continues after a prior interrupted turn repaired before Tool dispatch', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorNotStartedRepair: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a not-started repair is not the complete interrupted-turn suffix', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      extendedNotStartedRepair: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'tool-pairing-invalid' })
  })

  it('abstains when a prior repair starts a later Tool after skipping an earlier one', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      nonPrefixNotStartedRepair: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'tool-pairing-invalid' })
  })

  it('abstains when a prior assistant diverges from its cited provider chunks', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      mismatchedPriorAssistantContent: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a prior assistant source diverges from its durable request route', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      mismatchedPriorAssistantRoute: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it.each([
    ['true', { interruptedPriorAssistant: true }],
    ['false', { falseInterruptedPriorAssistant: true }],
  ] as const)('abstains when a settled prior assistant carries interrupted=%s', (_label, options) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn(options)

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a prior assistant Tool request has no durable execution pair', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      unpairedPriorAssistantToolCall: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'tool-pairing-invalid' })
  })

  it.each([
    ['turn', 'turn', 'turn-structure-invalid'],
    ['step', 'step', 'turn-structure-invalid'],
    ['call id', 'id', 'tool-pairing-invalid'],
    ['name', 'name', 'tool-pairing-invalid'],
    ['arguments', 'arguments', 'tool-pairing-invalid'],
  ] as const)(
    'abstains when an ordinary prior Tool call changes its requested %s',
    (_label, priorToolRequestCallMismatch, reason) => {
      vi.spyOn(Date, 'now').mockReturnValue(2_000)
      const { session, turnEndSeq } = completedModelDeclaredGapTurn({
        priorToolRequestCallMismatch,
      })

      expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
        callId: 'gap-call',
      })).toEqual({ status: 'abstained', reason })
    },
  )

  it.each([
    ['turn', 'turn', 'turn-structure-invalid'],
    ['step', 'step', 'turn-structure-invalid'],
    ['source call id', 'source-call-id', 'turn-structure-invalid'],
    ['block type', 'block-type', 'turn-structure-invalid'],
    ['block Tool call id', 'block-call-id', 'turn-structure-invalid'],
  ] as const)(
    'abstains when an ordinary prior Tool result changes its linked %s',
    (_label, priorToolResultLinkMismatch, reason) => {
      vi.spyOn(Date, 'now').mockReturnValue(2_000)
      const { session, turnEndSeq } = completedModelDeclaredGapTurn({
        priorToolResultLinkMismatch,
      })

      expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
        callId: 'gap-call',
      })).toEqual({ status: 'abstained', reason })
    },
  )

  it('abstains when a prior step admits another message after its settled assistant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorMessageAfterAssistant: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a Tool continuation admits a message after its settled assistant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorToolContinuationMessageAfterAssistant: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a prior turn continues past a terminal assistant without a claim', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      extraPriorTerminalStep: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a prior first step starts without admitting any message', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorStepWithoutAdmission: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a later turn reuses a request after a surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reusePriorTurnRequest: true,
      replacementAfterPriorTurnRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('reuses a failed prior request generation when the surface is unchanged', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reuseFailedPriorTurnRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a failed-only prior retry changes the fixed system assembly', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      failedPriorRetryChangesSystem: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a failed-only prior retry ignores a surface replacement', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      failedPriorReplacementBeforeUnmarkedRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a failed-only prior step claims a completed turn ending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      completedFailedPriorTurn: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a failed-only prior step claims a blocked turn ending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      blockedFailedPriorTurn: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('tracks surface replacement after a prior request with no settled assistant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reuseFailedPriorTurnRequest: true,
      replacementAfterFailedPriorTurnRequest: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('does not launder a missing series marker through an intermediate assistant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorAssistantAfterUnmarkedFailedReplacement: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a prior request route is logged outside an open step', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      orphanPriorRequestRoute: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when request evidence trails a settled prior assistant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      trailingPriorRequestRoute: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it('abstains when a same-step retry rebuilds Tool schemas in a different key order', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      schemaOrderHeaderChangeRetry: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'request-not-proven' })
  })

  it.each([
    'first-resume',
    'second-initial',
    'unchanged-change',
    'changed-series',
    'starts-series-on-series',
    'duplicate-context',
    'invalid-context-window',
    'unknown-reason',
    'false-starts-series',
    'noncanonical-header',
    'empty-provider',
    'empty-reasoning-effort',
    'unknown-adapter-default',
    'missing-reasoning-default-source',
    'missing-max-tokens-default-source',
    'double-header-prelude',
    'double-context-prelude',
  ] as const)('abstains from an impossible request-state transition: %s', invalidRequestState => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({ invalidRequestState })

    const reason = invalidRequestState === 'empty-provider'
      ? 'turn-structure-invalid'
      : 'request-not-proven'
    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason })
  })

  it('abstains when the initiating inbox claim occurs inside an open step', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      claimAfterStepStart: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'causal-order-invalid',
    })
  })

  it('abstains when execution brackets claim a different owning turn', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      wrongExecutionTurn: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it('abstains when the Session turn counter is not monotonic from its root', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      nonMonotonicTurnNumber: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it('abstains when prefix execution events violate the root Session structure', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      strayPrefixStepEnd: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it('abstains when a non-concluding trigger has no later terminal assistant step', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      omitTerminalStep: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'turn-structure-invalid',
    })
  })

  it('abstains when execution continues after a terminal assistant without a next-step claim', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      extraTerminalStep: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('accepts a post-terminal step admitted by a durable plugin-context claim', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      queuedPluginContinuationAfterTerminal: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a claimed continuation starts without admitting any message', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      claimedPluginContinuationWithoutAdmission: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when the trigger precedes admission of the initiating message', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      lateInitiatingMessage: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'causal-order-invalid',
    })
  })

  it('proves an active native Goal as an optional durable annotation', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      activeGoalBeforeIngress: true,
    })

    const result = proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result.status === 'proven' ? result.proof.goal : result).toEqual({
      id: 'goal-release',
      revision: 1,
    })
  })

  it('reports only a raw Skill Tool error from its failed durable pair', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      nativeSkillMiss: true,
    })

    const result = proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result.status === 'proven' ? result.proof.trigger : result).toEqual({
      kind: 'skill-tool-error',
      callId: 'gap-call',
      requestedSkill: 'release-audit',
    })
  })

  it('abstains when a report result omits its explicit success flag', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      missingReportErrorFlag: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('abstains when a successful report carries contradictory error metadata', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      successfulReportErrorMetadata: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('abstains when a Tool result does not cite its exact durable call', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      wrongResultSourceSeq: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('abstains when a Tool result cites anything beyond its durable call', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      extraResultSourceSeq: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('accepts extra Tool arguments while binding their exact transcript bytes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      extraToolArguments: true,
    })

    const result = proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result.status === 'proven' ? result.proof.trigger : result).toEqual({
      kind: 'successful-gap-report',
      callId: 'gap-call',
      requestedSkill: 'release-audit',
    })
  })

  it('does not treat an in-flight next-turn followup as current-turn steering', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      pendingNextTurnFollowup: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('accepts next-step human input that is canceled before it can be claimed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      canceledNextStepHuman: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when pending Message ids collide across the durable inbox', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      duplicatePendingMessageIds: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'human-ingress-not-proven',
    })
  })

  it('abstains when turn completion leaves non-human next-step work pending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      pendingPluginNextStep: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('ignores a prior Tool result surface rewrite while retaining it in the digest', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      priorResultRewrite: true,
    })

    const result = proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })

    expect(result.status).toBe('proven')
    expect(result.status === 'proven' ? result.proof.replay.prefixDigest : result).toBe(
      'c77e48e2fcf9d08ffee085c24e7dab289e9b6cf022d831af38b5478db04ba721',
    )
    expect(result.status === 'proven' ? result.proof.replay.turnDigest : result).toBe(
      'f6448aa9a9aebe348b0a8e2deca6e0867069fe83b659e904cfdce780a2d80a48',
    )
  })

  it('hashes deeply nested valid Session metadata without escaping the result union', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      deepResultMeta: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains when a nested dispatch adds another Gap trigger', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      nestedGapDispatch: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when a nested non-Gap dispatch has no active run_code root', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      ghostNestedDispatch: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('accepts a reused run_code call id after its earlier dispatch root is fully closed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reusedPriorCodeRoot: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    }).status).toBe('proven')
  })

  it('abstains from a PTC-only Gap because Episode v1 selects direct Tool pairs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({ ptcOnlyGap: true })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'trigger-not-proven' })
  })

  it('abstains when a nested Gap settle has no matching start', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      unmatchedNestedGapSettle: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'turn-structure-invalid' })
  })

  it('abstains when durable Tool execution permutes the model request order', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      reorderedToolCalls: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'tool-pairing-invalid' })
  })

  it('abstains from every non-completed native turn ending', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    for (const turnReason of [
      { kind: 'blocked' as const },
      { kind: 'error' as const, error: { message: 'failed', code: 'UNKNOWN' } },
      { kind: 'max-tokens' as const },
      { kind: 'interrupted' as const },
      { kind: 'aborted' as const, reason: { kind: 'user' as const } },
    ]) {
      const { session, turnEndSeq } = completedModelDeclaredGapTurn({ turnReason })

      expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
        callId: 'gap-call',
      })).toEqual({ status: 'abstained', reason: 'turn-not-completed' })
    }
  })

  it('abstains from subagent Sessions and from a Goal mutation inside the source bracket', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const subagent = completedModelDeclaredGapTurn({ subagent: true })
    const goalMutation = completedModelDeclaredGapTurn({ goalMutationDuringTurn: true })

    expect(proveInteractionEpisodeTranscript(subagent.session, subagent.turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'subagent-session' })
    expect(proveInteractionEpisodeTranscript(goalMutation.session, goalMutation.turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'goal-mutated' })
  })

  it.each([
    ['origin only', { subagentOriginOnly: true }],
    ['delegation depth only', { subagentDepthOnly: true }],
  ] as const)('abstains from a Session carrying subagent %s', (_label, options) => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn(options)

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({ status: 'abstained', reason: 'subagent-session' })
  })

  it('abstains when pre-step rewrites hide another claimed human message', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      hiddenClaimedHuman: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'human-ingress-not-proven',
    })
  })

  it('abstains when a later pre-step rewrite hides claimed human steering', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const { session, turnEndSeq } = completedModelDeclaredGapTurn({
      hiddenLaterClaimedHuman: true,
    })

    expect(proveInteractionEpisodeTranscript(session, turnEndSeq, {
      callId: 'gap-call',
    })).toEqual({
      status: 'abstained',
      reason: 'human-ingress-not-proven',
    })
  })
})

function completedModelDeclaredGapTurn(
  options: {
    readonly interleavedHuman?: boolean
    readonly secondAdmittedHuman?: boolean
    readonly replacedClaimPayload?: boolean
    readonly repairedWrongEnqueuePayload?: boolean
    readonly multipleGapTriggers?: boolean
    readonly assistantRequestedSkill?: string
    readonly invalidRequestedSkill?: 'missing' | 'uppercase' | 'too-long'
    readonly invalidMessageShape?:
      | 'ingress-role'
      | 'assistant-role'
      | 'assistant-source'
      | 'result-role'
      | 'result-source'
      | 'result-extra-block'
    readonly lateInitiatingMessage?: boolean
    readonly activeGoalBeforeIngress?: boolean
    readonly nativeSkillMiss?: boolean
    readonly turnReason?:
      | { readonly kind: 'blocked' | 'max-tokens' | 'interrupted' }
      | { readonly kind: 'error'; readonly error: { readonly message: string; readonly code: string } }
      | { readonly kind: 'aborted'; readonly reason: { readonly kind: 'user' } }
    readonly subagent?: boolean
    readonly subagentOriginOnly?: boolean
    readonly subagentDepthOnly?: boolean
    readonly goalMutationDuringTurn?: boolean
    readonly hiddenClaimedHuman?: boolean
    readonly hiddenLaterClaimedHuman?: boolean
    readonly assistantBeforeIngress?: boolean
    readonly wrongExecutionTurn?: boolean
    readonly omitTerminalStep?: boolean
    readonly extraToolArguments?: boolean
    readonly pendingNextTurnFollowup?: boolean
    readonly claimAfterStepStart?: boolean
    readonly priorResultRewrite?: boolean
    readonly deepResultMeta?: boolean
    readonly nestedGapDispatch?: boolean
    readonly ghostNestedDispatch?: boolean
    readonly reusedPriorCodeRoot?: boolean
    readonly nonMonotonicTurnNumber?: boolean
    readonly canceledNextStepHuman?: boolean
    readonly pendingPluginNextStep?: boolean
    readonly reorderedToolCalls?: boolean
    readonly assistantChunkBeforeIngress?: boolean
    readonly pluginMessageBeforeInitiating?: boolean
    readonly unmatchedNestedGapSettle?: boolean
    readonly uncitedTriggerAssistant?: boolean
    readonly mismatchedAssistantContent?: boolean
    readonly mismatchedAssistantUsage?: boolean
    readonly mismatchedAssistantReplayState?: boolean
    readonly partialAssistantCitation?: boolean
    readonly strayPrefixStepEnd?: boolean
    readonly duplicatePendingMessageIds?: boolean
    readonly omitRequestHeader?: boolean
    readonly omitRequestContext?: boolean
    readonly mismatchedRequestRoute?: boolean
    readonly ptcOnlyGap?: boolean
    readonly retryBeforeTrigger?: boolean
    readonly resumeHeaderRetry?: boolean
    readonly seriesHeaderRetryWithoutReplacement?: boolean
    readonly changeSeriesHeaderRetryWithoutReplacement?: boolean
    readonly retryChangesSystem?: boolean
    readonly contextBeforeHeader?: boolean
    readonly requestMetadataDuringSuccess?: boolean
    readonly requestMetadataDuringFailedStream?: boolean
    readonly trailingFailedPriorRequestRoute?: boolean
    readonly failedRetryMarkerLaundering?: boolean
    readonly missingReportErrorFlag?: boolean
    readonly successfulReportErrorMetadata?: boolean
    readonly wrongResultSourceSeq?: boolean
    readonly extraResultSourceSeq?: boolean
    readonly emptyTerminalResponse?: boolean
    readonly emptyFinalRetryChangesSystem?: boolean
    readonly emptyFinalReplacementBeforeUnmarkedRetry?: boolean
    readonly omitSettledFinishChunks?: boolean
    readonly replacementBeforeUnmarkedRetry?: boolean
    readonly replacementBeforeMarkedRetry?: boolean
    readonly divergentReplacementBeforeMarkedRetry?: boolean
    readonly transientDivergentReplacementBeforeMarkedRetry?: boolean
    readonly replacementBeforeUnmarkedTerminalRequest?: boolean
    readonly replacementBeforeMarkedTerminalRequest?: boolean
    readonly replacementAfterMarkedRetryHeader?: boolean
    readonly replacementBeforeInitialHeader?: boolean
    readonly reusePriorTurnRequest?: boolean
    readonly priorMaxTokensTurn?: boolean
    readonly completedPriorMaxTokensTurn?: boolean
    readonly completedPriorErrorToolStep?: boolean
    readonly priorNotStartedRepair?: boolean
    readonly extendedNotStartedRepair?: boolean
    readonly nonPrefixNotStartedRepair?: boolean
    readonly mismatchedPriorAssistantContent?: boolean
    readonly mismatchedPriorAssistantRoute?: boolean
    readonly interruptedPriorAssistant?: boolean
    readonly falseInterruptedPriorAssistant?: boolean
    readonly unpairedPriorAssistantToolCall?: boolean
    readonly priorToolRequestCallMismatch?: 'turn' | 'step' | 'id' | 'name' | 'arguments'
    readonly priorToolResultLinkMismatch?:
      | 'turn'
      | 'step'
      | 'source-call-id'
      | 'block-type'
      | 'block-call-id'
    readonly priorMessageAfterAssistant?: boolean
    readonly priorToolContinuationMessageAfterAssistant?: boolean
    readonly extraPriorTerminalStep?: boolean
    readonly priorStepWithoutAdmission?: boolean
    readonly replacementAfterPriorTurnRequest?: boolean
    readonly reuseFailedPriorTurnRequest?: boolean
    readonly failedPriorRetryChangesSystem?: boolean
    readonly failedPriorReplacementBeforeUnmarkedRetry?: boolean
    readonly completedFailedPriorTurn?: boolean
    readonly blockedFailedPriorTurn?: boolean
    readonly replacementAfterFailedPriorTurnRequest?: boolean
    readonly priorAssistantAfterUnmarkedFailedReplacement?: boolean
    readonly orphanPriorRequestRoute?: boolean
    readonly trailingPriorRequestRoute?: boolean
    readonly extraTerminalStep?: boolean
    readonly queuedPluginContinuationAfterTerminal?: boolean
    readonly claimedPluginContinuationWithoutAdmission?: boolean
    readonly invalidRequestState?:
      | 'first-resume'
      | 'second-initial'
      | 'unchanged-change'
      | 'changed-series'
      | 'starts-series-on-series'
      | 'duplicate-context'
      | 'invalid-context-window'
      | 'unknown-reason'
      | 'false-starts-series'
      | 'noncanonical-header'
      | 'empty-provider'
      | 'empty-reasoning-effort'
      | 'unknown-adapter-default'
      | 'missing-reasoning-default-source'
      | 'missing-max-tokens-default-source'
      | 'double-header-prelude'
      | 'double-context-prelude'
    readonly schemaOrderHeaderChangeRetry?: boolean
  } = {},
): { session: Session; turnEndSeq: number } {
  const sessionId = SessionId('episode-session')
  const session = Session.create(sessionId, undefined, {
    version: 0,
    id: sessionId,
    createdAt: 1_000,
    cwd: '/private/workspace',
    isSeeded: false,
    agentPreset: 'default',
    ...(options.subagent === true || options.subagentOriginOnly === true
      ? { origin: 'subagent' as const }
      : {}),
    ...(options.subagent === true || options.subagentDepthOnly === true
      ? { delegationDepth: 1 }
      : {}),
  })
  const callId = ToolCallId('gap-call')
  const hasOrdinaryPriorToolPair = options.priorToolRequestCallMismatch !== undefined
    || options.priorToolResultLinkMismatch !== undefined
    || options.priorToolContinuationMessageAfterAssistant === true
  const hasPriorSettledRequest = options.reusePriorTurnRequest === true
    || options.replacementAfterPriorTurnRequest === true
    || options.trailingPriorRequestRoute === true
    || options.mismatchedPriorAssistantContent === true
    || options.mismatchedPriorAssistantRoute === true
    || options.interruptedPriorAssistant === true
    || options.falseInterruptedPriorAssistant === true
    || options.unpairedPriorAssistantToolCall === true
    || options.extraPriorTerminalStep === true
    || options.priorStepWithoutAdmission === true
    || options.priorMaxTokensTurn === true
    || options.completedPriorMaxTokensTurn === true
    || options.completedPriorErrorToolStep === true
    || options.priorNotStartedRepair === true
    || options.extendedNotStartedRepair === true
    || options.nonPrefixNotStartedRepair === true
    || hasOrdinaryPriorToolPair
    || options.priorMessageAfterAssistant === true
  const hasPriorFailedRequest = options.reuseFailedPriorTurnRequest === true
    || options.failedPriorRetryChangesSystem === true
    || options.failedPriorReplacementBeforeUnmarkedRetry === true
    || options.replacementAfterFailedPriorTurnRequest === true
    || options.priorAssistantAfterUnmarkedFailedReplacement === true
    || options.trailingFailedPriorRequestRoute === true
    || options.completedFailedPriorTurn === true
    || options.blockedFailedPriorTurn === true
  const hasOrphanPriorRequest = options.orphanPriorRequestRoute === true
  const reusesPriorRequest = hasPriorSettledRequest
    || hasPriorFailedRequest
    || hasOrphanPriorRequest
    || options.reusedPriorCodeRoot === true
    || options.priorResultRewrite === true
  const selectedTurn = options.nonMonotonicTurnNumber === true
    ? 99
    : options.priorAssistantAfterUnmarkedFailedReplacement === true
      ? 3
      : options.reusedPriorCodeRoot === true
        ? 3
      : options.priorResultRewrite === true || reusesPriorRequest ? 2 : 1
  const executionTurn = options.wrongExecutionTurn === true ? 99 : selectedTurn
  const invalidRequestedSkillArguments = options.invalidRequestedSkill === 'missing'
    ? '{}'
    : options.invalidRequestedSkill === 'uppercase'
      ? '{"name":"Release-Audit"}'
      : options.invalidRequestedSkill === 'too-long'
        ? JSON.stringify({ name: 'a'.repeat(129) })
        : undefined
  const assistantArguments = invalidRequestedSkillArguments ?? JSON.stringify({
    ...(options.ptcOnlyGap === true
      ? { code: 'await tools.report_capability_gap({ name: "release-audit" })' }
      : { name: options.assistantRequestedSkill ?? 'release-audit' }),
    ...(options.extraToolArguments === true ? { note: 'keep exact' } : {}),
  })
  const callArguments = invalidRequestedSkillArguments ?? JSON.stringify({
    ...(options.ptcOnlyGap === true
      ? { code: 'await tools.report_capability_gap({ name: "release-audit" })' }
      : { name: 'release-audit' }),
    ...(options.extraToolArguments === true ? { note: 'keep exact' } : {}),
  })
  if (options.strayPrefixStepEnd === true) {
    session.append('step/end', { turn: 1, step: 1 })
  }
  if (options.reusedPriorCodeRoot === true) {
    appendCompletedPriorCodeTurn(session, 1, true)
    appendCompletedPriorCodeTurn(session, 2, false)
  }
  let priorResult: SessionEvent<'tool/result'> | undefined
  if (hasPriorFailedRequest) {
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const priorMessage = session.append('user/message', freezeMessage({
      id: MessageId('failed-prior-human-message'),
      role: 'user' as const,
      source: { kind: 'user' as const },
      content: [{ type: 'text' as const, text: 'Run the request that will fail.' }],
    }), { surfaceOp: 'append' })
    session.append('request/header', {
      header: {
        config: {
          provider: 'fixture',
          model: 'fixture-model',
        },
      },
      reason: 'initial',
    })
    session.append('request/context', {
      provider: 'fixture',
      model: 'fixture-model',
    })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'terminal provider failure', code: 'SERVER' },
        },
      },
    })
    if (options.failedPriorRetryChangesSystem === true) {
      session.append('request/header', {
        header: {
          config: { provider: 'fixture', model: 'fixture-model' },
          system: 'forged failed-retry system',
        },
        reason: 'change',
      })
    }
    if (options.failedPriorReplacementBeforeUnmarkedRetry === true) {
      session.append('user/message', priorMessage.data, {
        surfaceOp: {
          op: 'replace',
          start: priorMessage.seq,
          end: priorMessage.seq,
        },
        sourceEventSeqs: [priorMessage.seq],
      })
    }
    if (options.failedPriorRetryChangesSystem === true
      || options.failedPriorReplacementBeforeUnmarkedRetry === true) {
      session.append('assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'second terminal provider failure', code: 'SERVER' },
          },
        },
      })
    }
    if (options.trailingFailedPriorRequestRoute === true) {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model: 'trailing-failed-model',
          },
        },
        reason: 'change',
      })
      session.append('request/context', {
        provider: 'fixture',
        model: 'trailing-failed-model',
      })
    }
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', {
      turn: 1,
      reason: options.completedFailedPriorTurn === true
        ? { kind: 'completed' }
        : options.blockedFailedPriorTurn === true
          ? { kind: 'blocked' }
        : {
            kind: 'error',
            error: { message: 'terminal provider failure', code: 'SERVER' },
          },
    })
    if (options.replacementAfterFailedPriorTurnRequest === true
      || options.priorAssistantAfterUnmarkedFailedReplacement === true) {
      session.append('user/message', priorMessage.data, {
        surfaceOp: {
          op: 'replace',
          start: priorMessage.seq,
          end: priorMessage.seq,
        },
        sourceEventSeqs: [priorMessage.seq],
      })
    }
    if (options.priorAssistantAfterUnmarkedFailedReplacement === true) {
      session.append('turn/start', { turn: 2 })
      session.append('step/start', { turn: 2, step: 1 })
      session.append('user/message', freezeMessage({
        id: MessageId('intermediate-human-message'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Settle with stale request state.' }],
      }), { surfaceOp: 'append' })
      appendModelMessage(session, {
        turn: 2,
        step: 1,
        id: 'intermediate-assistant-message',
        content: [{ type: 'text', text: 'This request omitted its required marker.' }],
        citeChunks: true,
      })
      session.append('step/end', { turn: 2, step: 1 })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    }
  }
  if (hasOrphanPriorRequest) {
    session.append('turn/start', { turn: 1 })
    session.append('request/header', {
      header: {
        config: {
          provider: 'fixture',
          model: 'fixture-model',
        },
      },
      reason: 'initial',
    })
    session.append('request/context', {
      provider: 'fixture',
      model: 'fixture-model',
    })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
  if (hasPriorSettledRequest) {
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    const priorMessageData = freezeMessage({
      id: MessageId('prior-human-message'),
      role: 'user' as const,
      source: { kind: 'user' as const },
      content: [{ type: 'text' as const, text: 'Complete the previous request.' }],
    })
    const priorMessage = options.priorStepWithoutAdmission === true
      ? undefined
      : session.append('user/message', priorMessageData, { surfaceOp: 'append' })
    session.append('request/header', {
      header: {
        config: {
          provider: 'fixture',
          model: 'fixture-model',
        },
      },
      reason: 'initial',
    })
    session.append('request/context', {
      provider: 'fixture',
      model: 'fixture-model',
    })
    const ordinaryPriorCallId = ToolCallId('ordinary-prior-call')
    appendModelMessage(session, {
      turn: 1,
      step: 1,
      id: 'prior-assistant-message',
      content: hasOrdinaryPriorToolPair
        ? [{
            type: 'tool-call',
            id: ordinaryPriorCallId,
            name: 'read',
            arguments: '{"path":"README.md"}',
          }]
        : options.unpairedPriorAssistantToolCall === true
        ? [{
            type: 'tool-call',
            id: ToolCallId('unpaired-prior-call'),
            name: 'read',
            arguments: '{"path":"missing.md"}',
          }]
        : options.priorNotStartedRepair === true
            || options.extendedNotStartedRepair === true
            || options.nonPrefixNotStartedRepair === true
          ? [{
              type: 'tool-call',
              id: ToolCallId('not-started-prior-call'),
              name: 'read',
              arguments: '{"path":"README.md"}',
            }, ...(options.nonPrefixNotStartedRepair === true
              ? [{
                  type: 'tool-call' as const,
                  id: ToolCallId('later-started-prior-call'),
                  name: 'read',
                  arguments: '{"path":"later.md"}',
                }]
              : [])]
        : options.completedPriorErrorToolStep === true
          ? [{
              type: 'tool-call',
              id: ToolCallId('failed-prior-call'),
              name: 'read',
              arguments: '{"path":"missing.md"}',
            }]
        : options.mismatchedPriorAssistantContent === true
          ? [{ type: 'text', text: 'Provider-only prior response.' }]
          : [{ type: 'text', text: 'The previous request is complete.' }],
      ...(options.mismatchedPriorAssistantContent === true
        ? { messageContent: [{ type: 'text' as const, text: 'Forged prior response.' }] }
        : {}),
      ...(options.mismatchedPriorAssistantRoute === true
        ? { sourceModel: 'different-prior-model' }
        : {}),
      ...(options.interruptedPriorAssistant === true
        ? { messageInterrupted: true as const }
        : options.falseInterruptedPriorAssistant === true
          ? { messageInterrupted: false as const }
          : {}),
      maxTokensFinish: options.priorMaxTokensTurn === true
        || options.completedPriorMaxTokensTurn === true,
      citeChunks: true,
    })
    if (hasOrdinaryPriorToolPair) {
      const priorCallId = options.priorToolRequestCallMismatch === 'id'
        ? ToolCallId('different-ordinary-prior-call')
        : ordinaryPriorCallId
      const priorCall = session.append('tool/call', {
        turn: options.priorToolRequestCallMismatch === 'turn' ? 99 : 1,
        step: options.priorToolRequestCallMismatch === 'step' ? 99 : 1,
        callId: priorCallId,
        name: options.priorToolRequestCallMismatch === 'name' ? 'write' : 'read',
        arguments: options.priorToolRequestCallMismatch === 'arguments'
          ? '{"path":"different.md"}'
          : '{"path":"README.md"}',
      })
      const resultSourceCallId = options.priorToolResultLinkMismatch === 'source-call-id'
        ? ToolCallId('different-prior-result-source')
        : priorCallId
      const resultContent = options.priorToolResultLinkMismatch === 'block-type'
        ? [{
            type: 'text' as const,
            text: 'Not a Tool result block.',
            toolCallId: priorCallId,
          }]
        : [{
            type: 'tool-result' as const,
            toolCallId: options.priorToolResultLinkMismatch === 'block-call-id'
              ? ToolCallId('different-prior-result-block')
              : priorCallId,
            isError: false,
            content: [{ type: 'text' as const, text: 'README' }],
          }]
      session.append('tool/result', {
        turn: options.priorToolResultLinkMismatch === 'turn' ? 99 : priorCall.data.turn,
        step: options.priorToolResultLinkMismatch === 'step' ? 99 : priorCall.data.step,
        message: freezeMessage({
          id: MessageId('ordinary-prior-result'),
          role: 'user' as const,
          source: { kind: 'tool' as const, callId: resultSourceCallId },
          content: resultContent,
        } as never),
      }, { surfaceOp: 'append', sourceEventSeqs: [priorCall.seq] })
    }
    if (options.priorMessageAfterAssistant === true) {
      session.append('user/message', freezeMessage({
        id: MessageId('late-prior-plugin-message'),
        role: 'user' as const,
        source: { kind: 'plugin' as const, plugin: 'fixture' },
        content: [{ type: 'text' as const, text: 'Arrived after the settled assistant.' }],
      }), { surfaceOp: 'append' })
    }
    let laterStartedCall: SessionEvent<'tool/call'> | undefined
    if (options.nonPrefixNotStartedRepair === true) {
      laterStartedCall = session.append('tool/call', {
        turn: 1,
        step: 1,
        callId: ToolCallId('later-started-prior-call'),
        name: 'read',
        arguments: '{"path":"later.md"}',
      })
    }
    if (options.priorNotStartedRepair === true
      || options.extendedNotStartedRepair === true
      || options.nonPrefixNotStartedRepair === true) {
      const repairCallId = ToolCallId('not-started-prior-call')
      const repairSeq = Number(session.seq)
      session.append('tool/result', {
        turn: 1,
        step: 1,
        message: freezeMessage({
          id: MessageId(`interrupted-tool-result-${repairCallId}-${repairSeq}`),
          role: 'user' as const,
          source: { kind: 'tool' as const, callId: repairCallId },
          content: [{
            type: 'tool-result' as const,
            toolCallId: repairCallId,
            isError: true,
            content: [{
              type: 'text' as const,
              text: 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
            }],
          }],
        }),
        error: { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' },
      }, { surfaceOp: 'append' })
    }
    if (laterStartedCall !== undefined) {
      const laterCallId = ToolCallId('later-started-prior-call')
      session.append('tool/result', {
        turn: 1,
        step: 1,
        message: freezeMessage({
          id: MessageId('later-started-prior-result'),
          role: 'user' as const,
          source: { kind: 'tool' as const, callId: laterCallId },
          content: [{
            type: 'tool-result' as const,
            toolCallId: laterCallId,
            isError: false,
            content: [{ type: 'text' as const, text: 'later result' }],
          }],
        }),
      }, { surfaceOp: 'append', sourceEventSeqs: [laterStartedCall.seq] })
    }
    if (options.completedPriorErrorToolStep === true) {
      const failedCallId = ToolCallId('failed-prior-call')
      const failedCall = session.append('tool/call', {
        turn: 1,
        step: 1,
        callId: failedCallId,
        name: 'read',
        arguments: '{"path":"missing.md"}',
      })
      session.append('tool/result', {
        turn: 1,
        step: 1,
        message: freezeMessage({
          id: MessageId('failed-prior-result'),
          role: 'user' as const,
          source: { kind: 'tool' as const, callId: failedCallId },
          content: [{
            type: 'tool-result' as const,
            toolCallId: failedCallId,
            isError: true,
            content: [{ type: 'text' as const, text: 'Error: missing file' }],
          }],
        }),
        error: { name: 'Error', code: 'NOT_FOUND' },
      }, { surfaceOp: 'append', sourceEventSeqs: [failedCall.seq] })
    }
    if (options.trailingPriorRequestRoute === true) {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model: 'trailing-model',
          },
        },
        reason: 'change',
      })
      session.append('request/context', {
        provider: 'fixture',
        model: 'trailing-model',
      })
    }
    session.append('step/end', { turn: 1, step: 1 })
    if (options.priorToolContinuationMessageAfterAssistant === true) {
      session.append('step/start', { turn: 1, step: 2 })
      appendModelMessage(session, {
        turn: 1,
        step: 2,
        id: 'ordinary-prior-terminal-assistant',
        content: [{ type: 'text', text: 'The prior Tool continuation is complete.' }],
        citeChunks: true,
      })
      session.append('user/message', freezeMessage({
        id: MessageId('late-prior-continuation-message'),
        role: 'user' as const,
        source: { kind: 'plugin' as const, plugin: 'fixture' },
        content: [{ type: 'text' as const, text: 'Too late for this continuation.' }],
      }), { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 2 })
    }
    if (options.extendedNotStartedRepair === true) {
      session.append('step/start', { turn: 1, step: 2 })
      appendModelMessage(session, {
        turn: 1,
        step: 2,
        id: 'post-repair-prior-assistant',
        content: [{ type: 'text', text: 'This step must not follow a repair suffix.' }],
        citeChunks: true,
      })
      session.append('step/end', { turn: 1, step: 2 })
    }
    if (options.extraPriorTerminalStep === true) {
      session.append('step/start', { turn: 1, step: 2 })
      appendModelMessage(session, {
        turn: 1,
        step: 2,
        id: 'impossible-prior-extra-assistant',
        content: [{ type: 'text', text: 'This step had no continuation claim.' }],
        citeChunks: true,
      })
      session.append('step/end', { turn: 1, step: 2 })
    }
    session.append('turn/end', {
      turn: 1,
      reason: options.priorMaxTokensTurn === true
        ? { kind: 'max-tokens' }
        : options.priorNotStartedRepair === true
            || options.extendedNotStartedRepair === true
            || options.nonPrefixNotStartedRepair === true
          ? { kind: 'interrupted' }
        : { kind: 'completed' },
    })
    if (options.replacementAfterPriorTurnRequest === true) {
      if (priorMessage === undefined) throw new Error('prior replacement requires admission')
      session.append('user/message', priorMessage.data, {
        surfaceOp: {
          op: 'replace',
          start: priorMessage.seq,
          end: priorMessage.seq,
        },
        sourceEventSeqs: [priorMessage.seq],
      })
    }
  }
  if (options.priorResultRewrite === true) {
    const priorCallId = ToolCallId('prior-call')
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', freezeMessage({
      id: MessageId('prior-read-message'),
      role: 'user' as const,
      source: { kind: 'user' as const },
      content: [{ type: 'text' as const, text: 'Read the prior result.' }],
    }), { surfaceOp: 'append' })
    session.append('request/header', {
      header: {
        config: {
          provider: 'fixture',
          model: 'fixture-model',
        },
      },
      reason: 'initial',
    })
    session.append('request/context', {
      provider: 'fixture',
      model: 'fixture-model',
    })
    appendModelMessage(session, {
      turn: 1,
      step: 1,
      id: 'prior-read-assistant',
      content: [{
        type: 'tool-call',
        id: priorCallId,
        name: 'read',
        arguments: '{"path":"README.md"}',
      }],
      citeChunks: true,
    })
    const priorCall = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: priorCallId,
      name: 'read',
      arguments: '{"path":"README.md"}',
    })
    priorResult = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: freezeMessage({
        id: MessageId('prior-result'),
        role: 'user' as const,
        source: { kind: 'tool' as const, callId: priorCallId },
        content: [{
          type: 'tool-result' as const,
          toolCallId: priorCallId,
          isError: false,
          content: [{ type: 'text' as const, text: 'old result' }],
        }],
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [priorCall.seq] })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  }
  const message = freezeMessage({
    id: MessageId('human-message'),
    role: options.invalidMessageShape === 'ingress-role' ? 'assistant' : 'user',
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: 'Find a reusable release audit method.' }],
  } as never) as SessionEvent<'user/message'>['data']
  if (options.activeGoalBeforeIngress === true) {
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: GoalId('goal-release'),
        revision: 1,
        objective: 'Release one verified plugin.',
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 0,
      createdAt: 900,
      updatedAt: 900,
    })
  }
  if (options.hiddenClaimedHuman === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('hidden-steering-message'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Hidden by pre-step middleware.' }],
      })],
    })
  }
  if (options.duplicatePendingMessageIds === true) {
    const duplicate = freezeMessage({
      id: MessageId('duplicate-pending-message'),
      role: 'user' as const,
      source: { kind: 'plugin' as const, plugin: 'fixture' },
      content: [{ type: 'text' as const, text: 'Duplicate pending work.' }],
    })
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [duplicate],
    })
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [duplicate],
    })
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      removedCount: 1,
      inserted: [],
      outcome: 'canceled',
    })
  }
  const enqueuedMessage = options.repairedWrongEnqueuePayload === true
    ? freezeMessage({
        ...message,
        content: [{ type: 'text' as const, text: 'A wrong same-id enqueue.' }],
      })
    : message
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    inserted: [enqueuedMessage],
  })
  if (options.repairedWrongEnqueuePayload === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [message],
      outcome: 'canceled',
    })
  }
  if (options.replacedClaimPayload === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      removedCount: 1,
      inserted: [freezeMessage({
        ...message,
        content: [{ type: 'text' as const, text: 'A different same-id request.' }],
      })],
      outcome: 'canceled',
    })
  }
  session.append('turn/start', { turn: selectedTurn })
  if (options.hiddenClaimedHuman === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      removedCount: 1,
      inserted: [],
    })
  }
  if (options.claimAfterStepStart === true) {
    session.append('step/start', { turn: executionTurn, step: 1 })
  }
  session.append('agent/inbox/spliced', {
    target: 'next-turn',
    start: 0,
    removedCount: 1,
    inserted: [],
  })
  if (priorResult !== undefined) {
    session.append('tool/result', {
      ...priorResult.data,
      message: freezeMessage({
        ...priorResult.data.message,
        content: [{
          ...priorResult.data.message.content[0],
          content: [{ type: 'text' as const, text: 'old result (compacted)' }],
        }],
      }),
    }, {
      surfaceOp: { op: 'replace', start: priorResult.seq, end: priorResult.seq },
      sourceEventSeqs: [priorResult.seq],
    })
  }
  if (options.claimAfterStepStart !== true) {
    session.append('step/start', { turn: executionTurn, step: 1 })
  }
  if (options.pluginMessageBeforeInitiating === true) {
    session.append('user/message', freezeMessage({
      id: MessageId('preceding-plugin-message'),
      role: 'user' as const,
      source: { kind: 'plugin' as const, plugin: 'fixture' },
      content: [{ type: 'text' as const, text: 'A preceding admitted plugin message.' }],
    }), { surfaceOp: 'append' })
  }
  if (options.assistantChunkBeforeIngress === true) {
    session.append('assistant/chunk', {
      turn: executionTurn,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: 'premature' },
    })
  }
  let initiatingEvent: SessionEvent<'user/message'> | undefined
  const effectiveRouteModel = options.trailingPriorRequestRoute === true
    ? 'trailing-model'
    : options.trailingFailedPriorRequestRoute === true
      ? 'trailing-failed-model'
    : 'fixture-model'
  const appendTriggerAssistant = (): void => {
    const appendHeader = (
      model: string,
      reason: 'initial' | 'resume' | 'change' | 'series',
      headerOptions: {
        readonly tools?: SessionEvent<'request/header'>['data']['header']['tools']
        readonly startsSeries?: true
      } = {},
    ): void => {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model,
          },
          ...(headerOptions.tools === undefined ? {} : { tools: headerOptions.tools }),
        },
        reason,
        ...(headerOptions.startsSeries === true ? { startsSeries: true as const } : {}),
      })
    }
    const appendContext = (model: string): void => {
      session.append('request/context', {
        provider: 'fixture',
        model,
      })
    }
    const routeModel = options.mismatchedRequestRoute === true
      ? 'different-model'
      : effectiveRouteModel
    if (options.replacementBeforeInitialHeader === true) {
      if (initiatingEvent === undefined) throw new Error('initial replacement requires ingress')
      session.append('user/message', initiatingEvent.data, {
        surfaceOp: {
          op: 'replace',
          start: initiatingEvent.seq,
          end: initiatingEvent.seq,
        },
        sourceEventSeqs: [initiatingEvent.seq],
      })
    }
    const replacementRetry = options.replacementBeforeUnmarkedRetry === true
      || options.replacementBeforeMarkedRetry === true
      || options.replacementAfterMarkedRetryHeader === true
      || options.divergentReplacementBeforeMarkedRetry === true
      || options.transientDivergentReplacementBeforeMarkedRetry === true
    if (options.requestMetadataDuringFailedStream === true) {
      appendHeader(routeModel, 'initial')
      appendContext(routeModel)
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'usage',
          usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
        },
      })
      appendHeader('split-failed-model', 'change')
      appendContext('split-failed-model')
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'metadata split the failed stream', code: 'SERVER' },
          },
        },
      })
    } else if (options.failedRetryMarkerLaundering === true) {
      appendHeader(routeModel, 'initial')
      appendContext(routeModel)
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'first failed attempt', code: 'SERVER' },
          },
        },
      })
      if (initiatingEvent === undefined) throw new Error('laundering fixture requires ingress')
      session.append('user/message', initiatingEvent.data, {
        surfaceOp: {
          op: 'replace',
          start: initiatingEvent.seq,
          end: initiatingEvent.seq,
        },
        sourceEventSeqs: [initiatingEvent.seq],
      })
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'unmarked failed retry', code: 'SERVER' },
          },
        },
      })
      appendHeader(routeModel, 'series')
    } else if (replacementRetry) {
      appendHeader(routeModel, 'initial')
      appendContext(routeModel)
      if (initiatingEvent === undefined) throw new Error('replacement retry requires ingress')
      const divergentReplacement = options.divergentReplacementBeforeMarkedRetry === true
        || options.transientDivergentReplacementBeforeMarkedRetry === true
      const replacement = session.append('user/message', divergentReplacement
        ? freezeMessage({
            ...initiatingEvent.data,
            content: [{ type: 'text' as const, text: 'Follow a different request instead.' }],
          })
        : initiatingEvent.data, {
        surfaceOp: {
          op: 'replace',
          start: initiatingEvent.seq,
          end: initiatingEvent.seq,
        },
        sourceEventSeqs: [initiatingEvent.seq],
      })
      if (options.transientDivergentReplacementBeforeMarkedRetry === true) {
        session.append('user/message', initiatingEvent.data, {
          surfaceOp: {
            op: 'replace',
            start: replacement.seq,
            end: replacement.seq,
          },
          sourceEventSeqs: [replacement.seq],
        })
      }
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'retry after surface replacement', code: 'SERVER' },
          },
        },
      })
      if (options.replacementBeforeMarkedRetry === true
        || options.replacementAfterMarkedRetryHeader === true
        || options.divergentReplacementBeforeMarkedRetry === true
        || options.transientDivergentReplacementBeforeMarkedRetry === true) {
        appendHeader(routeModel, 'series')
      }
      if (options.replacementAfterMarkedRetryHeader === true) {
        session.append('user/message', initiatingEvent.data, {
          surfaceOp: {
            op: 'replace',
            start: replacement.seq,
            end: replacement.seq,
          },
          sourceEventSeqs: [replacement.seq],
        })
      }
    } else if (options.schemaOrderHeaderChangeRetry === true) {
      const schema = {
        name: 'report_capability_gap',
        description: 'Record one missing capability.',
        parameters: { type: 'object' },
      }
      const reorderedSchema = {
        description: 'Record one missing capability.',
        name: 'report_capability_gap',
        parameters: { type: 'object' },
      }
      appendHeader(routeModel, 'initial', { tools: [schema] })
      appendContext(routeModel)
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'retry with rebuilt tools', code: 'SERVER' },
          },
        },
      })
      appendHeader(routeModel, 'change', { tools: [reorderedSchema] })
    } else if (options.resumeHeaderRetry === true
      || options.seriesHeaderRetryWithoutReplacement === true
      || options.changeSeriesHeaderRetryWithoutReplacement === true
      || options.retryChangesSystem === true) {
      appendHeader(routeModel, 'initial')
      appendContext(routeModel)
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'retry with a forged marker', code: 'SERVER' },
          },
        },
      })
      if (options.retryChangesSystem === true) {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel },
            system: 'forged retry system',
          },
          reason: 'change',
        })
      } else if (options.changeSeriesHeaderRetryWithoutReplacement === true) {
        appendHeader('changed-model', 'change', { startsSeries: true })
        appendContext('changed-model')
      } else {
        appendHeader(
          routeModel,
          options.resumeHeaderRetry === true ? 'resume' : 'series',
        )
      }
    } else if (options.retryBeforeTrigger === true) {
      appendHeader('failed-model', 'initial')
      appendContext('failed-model')
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'retryable provider failure', code: 'SERVER' },
          },
        },
      })
      appendHeader(routeModel, 'change')
      appendContext(routeModel)
    } else if (options.contextBeforeHeader === true) {
      appendContext(routeModel)
      appendHeader(routeModel, 'initial')
    } else if (reusesPriorRequest) {
      // A continuing alpha.5 loop reuses unchanged durable route/context state.
      if (options.priorResultRewrite === true) appendHeader(routeModel, 'series')
    } else {
      if (options.invalidRequestState === 'double-header-prelude') {
        appendHeader(routeModel, 'initial')
        appendHeader('double-header-model', 'change')
        appendContext('double-header-model')
      } else if (options.invalidRequestState === 'double-context-prelude') {
        appendHeader(routeModel, 'initial')
        appendContext(routeModel)
        session.append('request/context', {
          provider: 'fixture',
          model: routeModel,
          contextWindow: 8_192,
        })
      } else if (options.invalidRequestState === 'unknown-reason') {
        session.append('request/header', {
          header: { config: { provider: 'fixture', model: routeModel } },
          reason: 'unknown',
        } as never)
      } else if (options.invalidRequestState === 'false-starts-series') {
        session.append('request/header', {
          header: { config: { provider: 'fixture', model: routeModel } },
          reason: 'initial',
          startsSeries: false,
        } as never)
      } else if (options.invalidRequestState === 'noncanonical-header') {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel },
            system: '',
          },
          reason: 'initial',
        })
      } else if (options.invalidRequestState === 'empty-provider') {
        session.append('request/header', {
          header: { config: { provider: '', model: routeModel } },
          reason: 'initial',
        })
      } else if (options.invalidRequestState === 'empty-reasoning-effort') {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel, reasoningEffort: '' },
          },
          reason: 'initial',
        } as never)
      } else if (options.invalidRequestState === 'unknown-adapter-default') {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel, reasoningEffort: 'high' },
            adapterDefaults: { reasoningEffort: true, unknown: true },
          },
          reason: 'initial',
        } as never)
      } else if (options.invalidRequestState === 'missing-reasoning-default-source') {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel },
            adapterDefaults: { reasoningEffort: true },
          },
          reason: 'initial',
        } as never)
      } else if (options.invalidRequestState === 'missing-max-tokens-default-source') {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: routeModel },
            adapterDefaults: { maxTokens: true },
          },
          reason: 'initial',
        } as never)
      } else if (options.omitRequestHeader !== true) {
        appendHeader(
          routeModel,
          options.invalidRequestState === 'first-resume' ? 'resume' : 'initial',
        )
      }
      if (options.omitRequestContext !== true
        && options.invalidRequestState !== 'double-header-prelude'
        && options.invalidRequestState !== 'double-context-prelude') {
        if (options.invalidRequestState === 'empty-provider') {
          session.append('request/context', { provider: '', model: routeModel })
        } else {
          appendContext(routeModel)
        }
      }
    }
    const toolBlocks: ContentBlock[] = [
      ...(options.reorderedToolCalls === true
        ? [{
            type: 'tool-call' as const,
            id: ToolCallId('ordinary-call'),
            name: 'read',
            arguments: '{"path":"README.md"}',
          }]
        : []),
      {
        type: 'tool-call' as const,
        id: callId,
        name: options.ptcOnlyGap === true
          ? 'run_code'
          : options.nativeSkillMiss === true ? 'skill' : 'report_capability_gap',
        arguments: assistantArguments,
      },
      ...(options.multipleGapTriggers === true
        ? [{
            type: 'tool-call' as const,
            id: ToolCallId('second-gap-call'),
            name: 'report_capability_gap',
            arguments: '{"name":"second-audit"}',
          }]
        : []),
    ]
    appendModelMessage(session, {
      turn: executionTurn,
      step: 1,
      id: 'assistant-message',
      content: options.mismatchedAssistantContent === true
        ? [{ type: 'text', text: 'Provider-only content.' }, ...toolBlocks]
        : toolBlocks,
      messageContent: toolBlocks,
      citeChunks: options.uncitedTriggerAssistant !== true,
      ...(options.mismatchedAssistantUsage === true
        ? {
            streamUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            messageUsage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
          }
        : {}),
      ...(options.mismatchedAssistantReplayState === true
        ? {
            streamReplayState: { response: { id: 'provider-response' } },
            messageReplayState: { response: { id: 'forged-response' } },
          }
        : {}),
      ...(options.requestMetadataDuringSuccess === true
        ? {
            afterFirstChunk: () => {
              appendHeader('mid-stream-model', 'change')
              appendContext('mid-stream-model')
            },
          }
        : {}),
      ...(options.partialAssistantCitation === true
        ? {
            streamUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            messageUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
            omitFirstDuplicateUsageFromCitation: true,
          }
        : {}),
      ...(options.changeSeriesHeaderRetryWithoutReplacement === true
        ? { sourceModel: 'changed-model' }
        : {}),
      ...(options.requestMetadataDuringFailedStream === true
        ? { sourceModel: 'split-failed-model' }
        : {}),
      ...(options.invalidRequestState === 'double-header-prelude'
        ? { sourceModel: 'double-header-model' }
        : {}),
      ...(options.invalidRequestState === 'empty-provider'
        ? { sourceProvider: '' }
        : {}),
      ...(options.invalidMessageShape === 'assistant-role'
        ? { messageRole: 'user' as const }
        : {}),
      ...(options.invalidMessageShape === 'assistant-source'
        ? { messageSourceKind: 'plugin' as const }
        : {}),
      omitFinishChunk: options.omitSettledFinishChunks,
    })
  }
  if (options.assistantBeforeIngress === true) appendTriggerAssistant()
  if (options.lateInitiatingMessage !== true) {
    initiatingEvent = session.append('user/message', message, { surfaceOp: 'append' })
  }
  if (options.secondAdmittedHuman === true) {
    session.append('user/message', freezeMessage({
      id: MessageId('second-human-message'),
      role: 'user' as const,
      source: { kind: 'user' as const },
      content: [{ type: 'text' as const, text: 'A second direct request in this turn.' }],
    }), { surfaceOp: 'append' })
  }
  if (options.assistantBeforeIngress !== true) appendTriggerAssistant()
  const call = session.append('tool/call', {
    turn: executionTurn,
    step: 1,
    callId,
    name: options.ptcOnlyGap === true
      ? 'run_code'
      : options.nativeSkillMiss === true ? 'skill' : 'report_capability_gap',
    arguments: callArguments,
  })
  if (options.ghostNestedDispatch === true) {
    const ghost = {
      rootCallId: ToolCallId('ghost-root'),
      parentCallId: ToolCallId('ghost-root'),
      subCallId: ToolCallId('ghost-root:code:0'),
      name: 'read',
      arguments: { path: 'README.md' },
    }
    session.append('tool/code-dispatch-start', ghost)
    session.append('tool/code-dispatch', {
      ...ghost,
      isError: false,
      content: [{ type: 'text', text: 'README' }],
    })
  }
  if (options.ptcOnlyGap === true) {
    const nestedData = {
      rootCallId: callId,
      parentCallId: callId,
      subCallId: ToolCallId('gap-call:code:0'),
      name: 'report_capability_gap',
      arguments: { name: 'release-audit' },
    }
    session.append('tool/code-dispatch-start', nestedData)
    session.append('tool/code-dispatch', {
      ...nestedData,
      isError: false,
      content: [{ type: 'text', text: 'gap recorded' }],
    })
  }
  let resultMeta: SessionEvent<'tool/result'>['data']['meta']
  if (options.deepResultMeta === true) {
    let nested: SessionEvent<'tool/result'>['data']['meta'] = { leaf: true }
    for (let depth = 0; depth < 12_000; depth++) nested = { child: nested }
    resultMeta = nested
  }
  const extraResultSource = options.extraResultSourceSeq === true
    ? session.append('agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        inserted: [],
      })
    : undefined
  session.append('tool/result', {
    turn: executionTurn,
    step: 1,
    message: freezeMessage({
      id: MessageId('gap-result'),
      role: options.invalidMessageShape === 'result-role' ? 'assistant' : 'user',
      source: options.invalidMessageShape === 'result-source'
        ? { kind: 'plugin' as const, plugin: 'fixture' }
        : { kind: 'tool' as const, callId },
      content: [{
        type: 'tool-result' as const,
        toolCallId: callId,
        ...(options.missingReportErrorFlag === true
          ? {}
          : { isError: options.nativeSkillMiss === true }),
        content: [{
          type: 'text' as const,
          text: options.nativeSkillMiss === true
            ? 'Error: skill "release-audit" is unknown or no longer available'
            : `Capability Gap ${'a'.repeat(64)} recorded for release-audit; discovery abstained because no native DSH Goal is active.`,
        }],
      } as never, ...(options.invalidMessageShape === 'result-extra-block'
        ? [{ type: 'text' as const, text: 'Impossible second Tool result block.' }]
        : [])],
    } as never),
    ...(options.nativeSkillMiss === true
      ? { error: { name: 'Error', code: 'UNKNOWN' } }
      : {}),
    ...(options.successfulReportErrorMetadata === true
      ? { error: { name: 'Error', code: 'CONTRADICTORY' } }
      : {}),
    ...(resultMeta === undefined ? {} : { meta: resultMeta }),
  }, {
    surfaceOp: 'append',
    sourceEventSeqs: options.extraResultSourceSeq === true
      ? [call.seq, extraResultSource!.seq]
      : [options.wrongResultSourceSeq === true
          ? session.snapshotEvents()[Number(call.seq) - 1]!.seq
          : call.seq],
  })
  if (options.nestedGapDispatch === true || options.unmatchedNestedGapSettle === true) {
    const nestedData = {
      rootCallId: callId,
      parentCallId: callId,
      subCallId: ToolCallId('gap-call:code:0'),
      name: 'report_capability_gap',
      arguments: { name: 'nested-audit' },
    }
    if (options.nestedGapDispatch === true) {
      session.append('tool/code-dispatch-start', nestedData)
    }
    session.append('tool/code-dispatch', {
      ...nestedData,
      isError: false,
      content: [{ type: 'text', text: 'nested gap recorded' }],
    })
  }
  if (options.reorderedToolCalls === true) {
    const ordinaryCallId = ToolCallId('ordinary-call')
    const ordinaryCall = session.append('tool/call', {
      turn: executionTurn,
      step: 1,
      callId: ordinaryCallId,
      name: 'read',
      arguments: '{"path":"README.md"}',
    })
    session.append('tool/result', {
      turn: executionTurn,
      step: 1,
      message: freezeMessage({
        id: MessageId('ordinary-result'),
        role: 'user' as const,
        source: { kind: 'tool' as const, callId: ordinaryCallId },
        content: [{
          type: 'tool-result' as const,
          toolCallId: ordinaryCallId,
          isError: false,
          content: [{ type: 'text' as const, text: 'README' }],
        }],
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [ordinaryCall.seq] })
  }
  if (options.multipleGapTriggers === true) {
    const secondCallId = ToolCallId('second-gap-call')
    const secondCall = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: secondCallId,
      name: 'report_capability_gap',
      arguments: '{"name":"second-audit"}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: freezeMessage({
        id: MessageId('second-gap-result'),
        role: 'user' as const,
        source: { kind: 'tool' as const, callId: secondCallId },
        content: [{
          type: 'tool-result' as const,
          toolCallId: secondCallId,
          isError: false,
          content: [{ type: 'text' as const, text: 'second gap recorded' }],
        }],
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [secondCall.seq] })
  }
  if (options.lateInitiatingMessage === true) {
    initiatingEvent = session.append('user/message', message, { surfaceOp: 'append' })
  }
  if (options.goalMutationDuringTurn === true) {
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: GoalId('goal-inside-turn'),
        revision: 1,
        objective: 'Mutated inside source bracket.',
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 0,
      createdAt: 1_500,
      updatedAt: 1_500,
    })
  }
  if (options.interleavedHuman === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('steering-message'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Change direction.' }],
      })],
    })
  }
  if (options.pendingNextTurnFollowup === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('future-followup'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Handle this in the next turn.' }],
      })],
    })
  }
  if (options.canceledNextStepHuman === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('canceled-steering'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Cancel this steer.' }],
      })],
    })
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      removedCount: 1,
      inserted: [],
      outcome: 'canceled',
    })
  }
  session.append('step/end', { turn: executionTurn, step: 1 })
  const replacementBeforeTerminalRequest = options.replacementBeforeUnmarkedTerminalRequest === true
    || options.replacementBeforeMarkedTerminalRequest === true
  if (replacementBeforeTerminalRequest) {
    if (initiatingEvent === undefined) throw new Error('terminal replacement requires ingress')
    session.append('user/message', initiatingEvent.data, {
      surfaceOp: {
        op: 'replace',
        start: initiatingEvent.seq,
        end: initiatingEvent.seq,
      },
      sourceEventSeqs: [initiatingEvent.seq],
    })
  }
  if (options.hiddenLaterClaimedHuman === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('later-hidden-steering'),
        role: 'user' as const,
        source: { kind: 'user' as const },
        content: [{ type: 'text' as const, text: 'Hidden before the later step.' }],
      })],
    })
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      removedCount: 1,
      inserted: [],
    })
  }
  if (options.omitTerminalStep !== true) {
    session.append('step/start', { turn: executionTurn, step: 2 })
    if (options.replacementBeforeMarkedTerminalRequest === true
      || options.replacementAfterMarkedRetryHeader === true) {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model: 'fixture-model',
          },
        },
        reason: 'series',
      })
    }
    if (options.invalidRequestState === 'second-initial'
      || options.invalidRequestState === 'unchanged-change'
      || options.invalidRequestState === 'starts-series-on-series') {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model: 'fixture-model',
          },
        },
        reason: options.invalidRequestState === 'second-initial'
          ? 'initial'
          : options.invalidRequestState === 'unchanged-change' ? 'change' : 'series',
        ...(options.invalidRequestState === 'starts-series-on-series'
          ? { startsSeries: true as const }
          : {}),
      })
    }
    const terminalRouteModel = options.invalidRequestState === 'changed-series'
      ? 'changed-terminal-model'
      : options.invalidRequestState === 'double-header-prelude'
        ? 'double-header-model'
      : options.changeSeriesHeaderRetryWithoutReplacement === true
        ? 'changed-model'
        : options.requestMetadataDuringFailedStream === true
          ? 'split-failed-model'
        : effectiveRouteModel
    if (options.invalidRequestState === 'changed-series') {
      session.append('request/header', {
        header: {
          config: {
            provider: 'fixture',
            model: terminalRouteModel,
          },
        },
        reason: 'series',
      })
      session.append('request/context', {
        provider: 'fixture',
        model: terminalRouteModel,
      })
    } else if (options.invalidRequestState === 'duplicate-context'
      || options.invalidRequestState === 'invalid-context-window') {
      session.append('request/context', {
        provider: 'fixture',
        model: 'fixture-model',
        ...(options.invalidRequestState === 'invalid-context-window'
          ? { contextWindow: 0 }
          : {}),
      })
    }
    const emptyFinalRetry = options.emptyFinalRetryChangesSystem === true
      || options.emptyFinalReplacementBeforeUnmarkedRetry === true
    if (emptyFinalRetry) {
      session.append('assistant/chunk', {
        turn: executionTurn,
        step: 2,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'retry before an empty response', code: 'SERVER' },
          },
        },
      })
      if (options.emptyFinalRetryChangesSystem === true) {
        session.append('request/header', {
          header: {
            config: { provider: 'fixture', model: terminalRouteModel },
            system: 'forged empty-retry system',
          },
          reason: 'change',
        })
      }
      if (options.emptyFinalReplacementBeforeUnmarkedRetry === true) {
        if (initiatingEvent === undefined) throw new Error('empty retry replacement requires ingress')
        session.append('user/message', initiatingEvent.data, {
          surfaceOp: {
            op: 'replace',
            start: initiatingEvent.seq,
            end: initiatingEvent.seq,
          },
          sourceEventSeqs: [initiatingEvent.seq],
        })
      }
    }
    appendModelMessage(session, {
      turn: executionTurn,
      step: 2,
      id: 'terminal-assistant-message',
      content: options.emptyTerminalResponse === true || emptyFinalRetry
        ? []
        : [{ type: 'text', text: 'The missing capability was recorded.' }],
      citeChunks: true,
      emitNoChunks: options.emptyTerminalResponse === true || emptyFinalRetry,
      sourceModel: terminalRouteModel,
      omitFinishChunk: options.omitSettledFinishChunks,
      ...(options.invalidRequestState === 'empty-provider'
        ? { sourceProvider: '' }
        : {}),
    })
    const continuationMessage = options.queuedPluginContinuationAfterTerminal === true
      || options.claimedPluginContinuationWithoutAdmission === true
      ? freezeMessage({
          id: MessageId('queued-plugin-continuation'),
          role: 'user' as const,
          source: { kind: 'plugin' as const, plugin: 'fixture' },
          content: [{ type: 'text' as const, text: 'Render the queued plugin context.' }],
        })
      : undefined
    if (continuationMessage !== undefined) {
      session.append('agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        inserted: [continuationMessage],
      })
    }
    session.append('step/end', { turn: executionTurn, step: 2 })
    if (options.extraTerminalStep === true || continuationMessage !== undefined) {
      if (continuationMessage !== undefined) {
        session.append('agent/inbox/spliced', {
          target: 'next-step',
          start: 0,
          removedCount: 1,
          inserted: [],
        })
      }
      session.append('step/start', { turn: executionTurn, step: 3 })
      if (continuationMessage !== undefined
        && options.claimedPluginContinuationWithoutAdmission !== true) {
        session.append('user/message', continuationMessage, { surfaceOp: 'append' })
      }
      appendModelMessage(session, {
        turn: executionTurn,
        step: 3,
        id: 'post-terminal-assistant-message',
        content: [{ type: 'text', text: 'The continuation is complete.' }],
        citeChunks: true,
        sourceModel: terminalRouteModel,
      })
      session.append('step/end', { turn: executionTurn, step: 3 })
    }
  }
  if (options.pendingPluginNextStep === true) {
    session.append('agent/inbox/spliced', {
      target: 'next-step',
      start: 0,
      inserted: [freezeMessage({
        id: MessageId('pending-plugin-context'),
        role: 'user' as const,
        source: { kind: 'plugin' as const, plugin: 'fixture' },
        content: [{ type: 'text' as const, text: 'Plugin context still pending.' }],
      })],
    })
  }
  const turnEnd = session.append('turn/end', {
    turn: selectedTurn,
    reason: options.turnReason ?? { kind: 'completed' },
  })
  return { session, turnEndSeq: Number(turnEnd.seq) }
}

function appendCompletedPriorCodeTurn(
  session: Session,
  turn: number,
  logRequest: boolean,
): void {
  const rootCallId = ToolCallId('reused-code-root')
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', freezeMessage({
    id: MessageId(`prior-code-human-${turn}`),
    role: 'user' as const,
    source: { kind: 'user' as const },
    content: [{ type: 'text' as const, text: `Run prior code turn ${turn}.` }],
  }), { surfaceOp: 'append' })
  if (logRequest) {
    session.append('request/header', {
      header: { config: { provider: 'fixture', model: 'fixture-model' } },
      reason: 'initial',
    })
    session.append('request/context', { provider: 'fixture', model: 'fixture-model' })
  }
  appendModelMessage(session, {
    turn,
    step: 1,
    id: `prior-code-assistant-${turn}`,
    content: [{
      type: 'tool-call',
      id: rootCallId,
      name: 'run_code',
      arguments: '{"code":"await tools.read({ path: \\"README.md\\" })"}',
    }],
    citeChunks: true,
  })
  const rootCall = session.append('tool/call', {
    turn,
    step: 1,
    callId: rootCallId,
    name: 'run_code',
    arguments: '{"code":"await tools.read({ path: \\"README.md\\" })"}',
  })
  const nested = {
    rootCallId,
    parentCallId: rootCallId,
    subCallId: ToolCallId(`${rootCallId}:code:1`),
    name: 'read',
    arguments: { path: 'README.md' },
  }
  session.append('tool/code-dispatch-start', nested)
  session.append('tool/code-dispatch', {
    ...nested,
    isError: false,
    content: [{ type: 'text', text: 'README' }],
  })
  session.append('tool/result', {
    turn,
    step: 1,
    message: freezeMessage({
      id: MessageId(`prior-code-result-${turn}`),
      role: 'user' as const,
      source: { kind: 'tool' as const, callId: rootCallId },
      content: [{
        type: 'tool-result' as const,
        toolCallId: rootCallId,
        isError: false,
        content: [{ type: 'text' as const, text: 'code completed' }],
      }],
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [rootCall.seq] })
  session.append('step/end', { turn, step: 1 })
  session.append('step/start', { turn, step: 2 })
  appendModelMessage(session, {
    turn,
    step: 2,
    id: `prior-code-terminal-${turn}`,
    content: [{ type: 'text', text: `Prior code turn ${turn} completed.` }],
    citeChunks: true,
  })
  session.append('step/end', { turn, step: 2 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function appendModelMessage(
  session: Session,
  input: {
    readonly turn: number
    readonly step: number
    readonly id: string
    readonly content: readonly ContentBlock[]
    readonly messageContent?: readonly ContentBlock[] | undefined
    readonly citeChunks: boolean
    readonly afterFirstChunk?: (() => void) | undefined
    readonly emitNoChunks?: boolean | undefined
    readonly streamUsage?: TokenUsage | undefined
    readonly messageUsage?: TokenUsage | undefined
    readonly streamReplayState?: ReplayEnvelope | undefined
    readonly messageReplayState?: unknown
    readonly sourceModel?: string | undefined
    readonly sourceProvider?: string | undefined
    readonly messageRole?: 'assistant' | 'user' | undefined
    readonly messageSourceKind?: 'model' | 'plugin' | undefined
    readonly messageInterrupted?: boolean | undefined
    readonly omitFinishChunk?: boolean | undefined
    readonly maxTokensFinish?: boolean | undefined
    readonly omitFirstDuplicateUsageFromCitation?: boolean | undefined
  },
): void {
  const sourceEventSeqs: SessionEvent<'assistant/chunk'>['seq'][] = []
  if (input.citeChunks && input.emitNoChunks !== true) {
    if (input.omitFirstDuplicateUsageFromCitation === true) {
      if (input.streamUsage === undefined) {
        throw new Error('duplicate usage fixture requires stream usage')
      }
      session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: { type: 'usage', usage: input.streamUsage },
      })
    }
    for (const [index, block] of input.content.entries()) {
      if (block.type !== 'text' && block.type !== 'tool-call') {
        throw new Error(`unsupported fixture block: ${block.type}`)
      }
      sourceEventSeqs.push(session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: { type: 'block-start', index, blockType: block.type },
      }).seq)
      if (index === 0) input.afterFirstChunk?.()
      sourceEventSeqs.push(session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: block.type === 'text'
          ? { type: 'text-delta', index, text: block.text }
          : {
              type: 'tool-call-delta',
              index,
              id: block.id,
              name: block.name,
              argumentsDelta: block.arguments,
            },
      }).seq)
      sourceEventSeqs.push(session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: { type: 'block-end', index, block },
      }).seq)
    }
    if (input.streamUsage !== undefined) {
      sourceEventSeqs.push(session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: { type: 'usage', usage: input.streamUsage },
      }).seq)
    }
    if (input.omitFinishChunk !== true) {
      sourceEventSeqs.push(session.append('assistant/chunk', {
        turn: input.turn,
        step: input.step,
        chunk: {
          type: 'finish',
          reason: input.maxTokensFinish === true
            ? { kind: 'max-tokens' }
            : input.content.some(block => block.type === 'tool-call')
              ? { kind: 'tool-calls' }
              : { kind: 'stop' },
          ...(input.streamReplayState === undefined
            ? {}
            : { replayState: input.streamReplayState }),
        },
      }).seq)
    }
  }
  session.append('assistant/message', {
    turn: input.turn,
    step: input.step,
    message: freezeMessage({
      id: MessageId(input.id),
      role: input.messageRole ?? 'assistant',
      source: input.messageSourceKind === 'plugin'
        ? { kind: 'plugin' as const, plugin: 'fixture' }
        : {
            kind: 'model' as const,
            provider: input.sourceProvider ?? 'fixture',
            model: input.sourceModel ?? 'fixture-model',
            ...(input.messageReplayState === undefined
              ? {}
              : { replayState: input.messageReplayState }),
          },
      content: [...(input.messageContent ?? input.content)],
    } as never),
    ...(input.messageUsage === undefined ? {} : { usage: input.messageUsage }),
    ...(input.messageInterrupted === undefined
      ? {}
      : { interrupted: input.messageInterrupted }),
  } as never, {
    surfaceOp: 'append',
    ...(input.citeChunks ? { sourceEventSeqs } : {}),
  })
}
