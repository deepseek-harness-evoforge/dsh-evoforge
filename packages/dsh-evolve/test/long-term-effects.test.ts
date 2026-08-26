import { describe, expect, it } from 'vitest'
import {
  LongTermEffectsProjection,
  type LongTermFact,
} from '../src/long-term-effects.ts'
import type { GenerationSelectionEvent, EvolutionStore } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const generationA = 'a'.repeat(64)
const generationB = 'b'.repeat(64)
let factSequence = 0

function fact<T extends LongTermFact['kind']>(
  kind: T,
  fields: Record<string, unknown>,
): LongTermFact {
  return {
    schemaVersion: 1,
    id: `${kind}-${factSequence++}`,
    kind,
    workspaceId: WORKSPACE_ID,
    observedAt: 1_700_000_000_000,
    ...fields,
  } as LongTermFact
}

function selections(events: readonly GenerationSelectionEvent[]): Pick<EvolutionStore, 'listGenerationSelectionEvents'> {
  return { listGenerationSelectionEvents: () => events }
}

describe('long-term effects projection', () => {
  it('does not turn missing evidence into a success or failure claim', () => {
    const projection = new LongTermEffectsProjection(
      { list: () => [] },
      selections([]),
    )

    const summary = projection.summarize(WORKSPACE_ID)
    expect(summary.metrics.falsePromotion).toEqual({
      status: 'not-measured', observed: 0, denominator: 0, count: 0,
      reason: 'no-authoritative-facts',
    })
    expect(summary.metrics.forgetting.status).toBe('not-measured')
    expect(summary.metrics.negativeTransfer.status).toBe('not-measured')
    expect(summary.metrics.duplicateExternalEffect.status).toBe('not-measured')
    expect(summary.metrics.recovery.status).toBe('not-measured')
    expect(summary.evidence.causalClaim).toBe('none')
    expect(summary.evidence.releaseAuthority).toBe('none')
  })

  it('counts only explicit, exact facts and keeps unknown observations visible', () => {
    const facts: LongTermFact[] = [
      fact('promotion-review', {
        promotionEventId: 'promotion-1', generationId: generationB,
        verdict: 'false-promotion', evidenceId: 'review-1',
      }),
      fact('promotion-review', {
        promotionEventId: 'promotion-2', generationId: generationB,
        verdict: 'retained', evidenceId: 'review-2',
      }),
      fact('paired-comparison', {
        caseId: 'case-1', generationId: generationB, baselineGenerationId: generationA,
        comparisonKind: 'forgetting', priorCandidateStatus: 'passed',
        baselineStatus: 'unknown', candidateStatus: 'failed', exactPair: true,
        evidenceId: 'forget-1',
      }),
      fact('paired-comparison', {
        caseId: 'case-2', generationId: generationB, baselineGenerationId: generationA,
        comparisonKind: 'forgetting', priorCandidateStatus: 'passed',
        baselineStatus: 'unknown', candidateStatus: 'passed', exactPair: false,
        evidenceId: 'forget-2',
      }),
      fact('paired-comparison', {
        caseId: 'case-3', generationId: generationB, baselineGenerationId: generationA,
        comparisonKind: 'negative-transfer', priorCandidateStatus: 'unknown',
        baselineStatus: 'passed', candidateStatus: 'failed', exactPair: true,
        evidenceId: 'transfer-1',
      }),
      fact('external-effect', {
        id: 'effect-1',
        adapter: 'dsh-gateway', operationKeyHash: 'op-1', idempotencyKeyHash: 'key-1',
        result: 'applied', evidenceId: 'effect-1',
      }),
      fact('external-effect', {
        id: 'effect-2',
        adapter: 'dsh-feishu', operationKeyHash: 'op-1', idempotencyKeyHash: 'key-1',
        result: 'duplicate', duplicateOfFactId: 'effect-1', evidenceId: 'effect-2',
      }),
      fact('recovery', { trigger: 'crash', result: 'recovered', evidenceId: 'recovery-1' }),
      fact('recovery', { trigger: 'restart', result: 'unknown', evidenceId: 'recovery-2' }),
    ]
    const promotionEvents: GenerationSelectionEvent[] = [
      {
        schemaVersion: 1, id: 'promotion-1', workspaceId: WORKSPACE_ID, sequence: 1,
        kind: 'promotion', recordedAt: 1, previousGenerationId: generationA,
        activeGenerationId: generationB, evidence: { authority: 'direct-host' },
      },
      {
        schemaVersion: 1, id: 'promotion-2', workspaceId: WORKSPACE_ID, sequence: 2,
        kind: 'promotion', recordedAt: 2, previousGenerationId: generationA,
        activeGenerationId: generationB, evidence: { authority: 'direct-host' },
      },
    ]
    const projection = new LongTermEffectsProjection({ list: () => facts }, selections(promotionEvents))
    const summary = projection.summarize(WORKSPACE_ID)

    expect(summary.metrics.falsePromotion).toMatchObject({
      status: 'measured', observed: 2, denominator: 2, count: 1, rate: 0.5,
    })
    expect(summary.metrics.forgetting).toMatchObject({
      status: 'insufficient-sample', observed: 1, denominator: 2, count: 1, rate: 1,
    })
    expect(summary.metrics.negativeTransfer).toMatchObject({
      status: 'insufficient-sample', observed: 1, denominator: 1, count: 1, rate: 1,
    })
    expect(summary.metrics.duplicateExternalEffect).toMatchObject({
      status: 'measured', observed: 2, denominator: 2, count: 1, rate: 0.5,
    })
    expect(summary.metrics.recovery).toMatchObject({
      status: 'insufficient-sample', observed: 1, denominator: 2, count: 1, rate: 1,
    })
    expect(summary.sourceFacts.unknownFacts).toBe(4)
  })

  it('derives rollback rate from immutable selection events only', () => {
    const events: GenerationSelectionEvent[] = [
      {
        schemaVersion: 1, id: 'promotion-1', workspaceId: WORKSPACE_ID, sequence: 1,
        kind: 'promotion', recordedAt: 1, previousGenerationId: generationA,
        activeGenerationId: generationB, evidence: { authority: 'explicit-human' } as never,
      },
      {
        schemaVersion: 1, id: 'rollback-1', workspaceId: WORKSPACE_ID, sequence: 2,
        kind: 'rollback', recordedAt: 2, previousGenerationId: generationB,
        activeGenerationId: generationA, evidence: { authority: 'explicit-human' },
      },
      {
        schemaVersion: 1, id: 'promotion-2', workspaceId: WORKSPACE_ID, sequence: 3,
        kind: 'promotion', recordedAt: 3, previousGenerationId: generationA,
        activeGenerationId: generationB, evidence: { authority: 'direct-host' },
      },
    ]
    const summary = new LongTermEffectsProjection({ list: () => [] }, selections(events)).summarize(WORKSPACE_ID)
    expect(summary.metrics.rollback).toMatchObject({
      status: 'measured', observed: 3, denominator: 3, count: 1, rate: 1 / 3,
    })
  })
})
