import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'
import {
  compileInteractionGenerationEvidencePolicies,
  INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS,
  INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES,
  INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
} from '../src/interaction-generation-evidence.ts'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('dsh-evolve public configuration', () => {
  it('exposes only Workspace policy and internal content-addressed runtime roots', () => {
    const keys = Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict).sort()

    expect(keys).toEqual([
      'automaticPromotionPolicies',
      'cacheRoot',
      'candidateEvaluationPolicies',
      'interactionEvidencePolicies',
      'selfDiscoveryPolicies',
      'supervisor',
    ])

    const rendered = Config.toString()
    expect(rendered).not.toMatch(
      /repository|sources|shadowTargets|evaluatorTargets|automaticFeedbackTargets|automaticEvaluatorTargets|autoPromote|feedbackDraftRoot/u,
    )
    expect(rendered).toContain('automaticPromotionPolicies')
    const automatic = (Config as unknown as {
      dict: { automaticPromotionPolicies: { inner: { dict: Record<string, unknown> } } }
    }).dict.automaticPromotionPolicies
    expect(Object.keys(automatic.inner.dict).sort()).toEqual(['id', 'workspaceId'])

    const interaction = (Config as unknown as {
      dict: {
        interactionEvidencePolicies: {
          inner: { dict: Record<string, { dict?: Record<string, unknown> }> }
        }
      }
    }).dict.interactionEvidencePolicies
    expect(Object.keys(interaction.inner.dict).sort()).toEqual(['retention', 'workspaceId'])
    expect(Object.keys(interaction.inner.dict.retention!.dict!).sort())
      .toEqual(['generationMaxRecords'])
    expect(Config({}).interactionEvidencePolicies).toEqual([])
  })

  it('accepts only bounded canonical native Workspace retention policies', () => {
    expect(Config({
      interactionEvidencePolicies: [{
        workspaceId: WORKSPACE_ID,
        retention: { generationMaxRecords: INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE },
      }],
    }).interactionEvidencePolicies).toEqual([{
      workspaceId: WORKSPACE_ID,
      retention: { generationMaxRecords: INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE },
    }])

    for (const workspaceId of [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
      '11111111-1111-6111-8111-111111111111',
      'not-a-workspace',
    ]) {
      expect(() => Config({
        interactionEvidencePolicies: [{
          workspaceId,
          retention: { generationMaxRecords: 1 },
        }],
      })).toThrow()
    }
    for (const generationMaxRecords of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => Config({
        interactionEvidencePolicies: [{
          workspaceId: WORKSPACE_ID,
          retention: { generationMaxRecords },
        }],
      })).toThrow()
    }
    expect(() => Config({
      interactionEvidencePolicies: Array.from(
        { length: INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES + 1 },
        (_, index) => ({
          workspaceId: workspaceId(index),
          retention: { generationMaxRecords: 1 },
        }),
      ),
    })).toThrow()
  })

  it('rejects duplicate Workspace policies and an aggregate over the safety cap', () => {
    expect(() => compileInteractionGenerationEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 1 } },
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 2 } },
    ])).toThrow(/duplicate/u)

    const each = INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE
    const count = Math.floor(INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS / each) + 1
    expect(() => compileInteractionGenerationEvidencePolicies(Array.from(
      { length: count },
      (_, index) => ({
        workspaceId: workspaceId(index),
        retention: { generationMaxRecords: each },
      }),
    ))).toThrow(/aggregate/u)
  })
})

function workspaceId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
}
