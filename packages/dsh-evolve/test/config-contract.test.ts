import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'
import {
  compileInteractionGenerationEvidencePolicies,
  INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS,
  INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES,
  INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
} from '../src/interaction-generation-evidence.ts'
import {
  compileInteractionRoutingEvidencePolicies,
  INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS,
  INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES,
  INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
} from '../src/interaction-routing-evidence.ts'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

describe('dsh-evolve public configuration', () => {
  it('exposes only Workspace policy and internal content-addressed runtime roots', () => {
    const keys = Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict).sort()

    expect(keys).toEqual([
      'automaticPromotionPolicies',
      'cacheRoot',
      'candidateEvaluationPolicies',
      'interactionEvidencePolicies',
      'interactionRoutingEvidencePolicies',
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

    const interaction = configArrayObject('interactionEvidencePolicies')
    expect(Object.keys(interaction.dict).sort()).toEqual(['retention', 'workspaceId'])
    expect(Object.keys(interaction.dict.retention!.dict!).sort())
      .toEqual(['generationMaxRecords'])
    expect(Config({}).interactionEvidencePolicies).toEqual([])

    const routing = configArrayObject('interactionRoutingEvidencePolicies')
    expect(Object.keys(routing.dict).sort()).toEqual(['retention', 'workspaceId'])
    expect(Object.keys(routing.dict.retention!.dict!).sort())
      .toEqual(['routingMaxRecords'])
    expect(Config({}).interactionRoutingEvidencePolicies).toEqual([])
  })

  it('keeps Routing retention independently bounded and default-deny', () => {
    expect(Config({
      interactionRoutingEvidencePolicies: [{
        workspaceId: WORKSPACE_ID,
        retention: { routingMaxRecords: INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE },
      }],
    }).interactionRoutingEvidencePolicies).toEqual([{
      workspaceId: WORKSPACE_ID,
      retention: { routingMaxRecords: INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE },
    }])

    for (const workspaceId of [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
      '11111111-1111-6111-8111-111111111111',
      'not-a-workspace',
    ]) {
      expect(() => Config({
        interactionRoutingEvidencePolicies: [{
          workspaceId,
          retention: { routingMaxRecords: 1 },
        }],
      })).toThrow()
    }
    for (const routingMaxRecords of [0, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => Config({
        interactionRoutingEvidencePolicies: [{
          workspaceId: WORKSPACE_ID,
          retention: { routingMaxRecords },
        }],
      })).toThrow()
    }
    expect(() => Config({
      interactionRoutingEvidencePolicies: Array.from(
        { length: INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES + 1 },
        (_, index) => ({
          workspaceId: workspaceId(index),
          retention: { routingMaxRecords: 1 },
        }),
      ),
    })).toThrow()

    expect(() => compileInteractionRoutingEvidencePolicies([
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 1 } },
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
    ])).toThrow(/duplicate/u)

    const each = INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE
    const count = Math.floor(INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS / each) + 1
    expect(() => compileInteractionRoutingEvidencePolicies(Array.from(
      { length: count },
      (_, index) => ({
        workspaceId: workspaceId(index),
        retention: { routingMaxRecords: each },
      }),
    ))).toThrow(/aggregate/u)
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
    const duplicateGeneration = [
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 1 } },
      { workspaceId: WORKSPACE_ID, retention: { generationMaxRecords: 2 } },
    ]
    expect(() => Config({ interactionEvidencePolicies: duplicateGeneration }))
      .toThrow(/duplicate/u)
    expect(() => compileInteractionGenerationEvidencePolicies(duplicateGeneration))
      .toThrow(/duplicate/u)

    const each = INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE
    const count = Math.floor(INTERACTION_GENERATION_EVIDENCE_MAX_AGGREGATE_RECORDS / each) + 1
    const aggregateGeneration = Array.from(
      { length: count },
      (_, index) => ({
        workspaceId: workspaceId(index),
        retention: { generationMaxRecords: each },
      }),
    )
    expect(() => Config({ interactionEvidencePolicies: aggregateGeneration }))
      .toThrow(/aggregate/u)
    expect(() => compileInteractionGenerationEvidencePolicies(aggregateGeneration))
      .toThrow(/aggregate/u)

    const duplicateRouting = [
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 1 } },
      { workspaceId: WORKSPACE_ID, retention: { routingMaxRecords: 2 } },
    ]
    expect(() => Config({ interactionRoutingEvidencePolicies: duplicateRouting }))
      .toThrow(/duplicate/u)
    expect(() => compileInteractionRoutingEvidencePolicies(duplicateRouting))
      .toThrow(/duplicate/u)

    const routingEach = INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE
    const routingCount = Math.floor(
      INTERACTION_ROUTING_EVIDENCE_MAX_AGGREGATE_RECORDS / routingEach,
    ) + 1
    const aggregateRouting = Array.from(
      { length: routingCount },
      (_, index) => ({
        workspaceId: workspaceId(index),
        retention: { routingMaxRecords: routingEach },
      }),
    )
    expect(() => Config({ interactionRoutingEvidencePolicies: aggregateRouting }))
      .toThrow(/aggregate/u)
    expect(() => compileInteractionRoutingEvidencePolicies(aggregateRouting))
      .toThrow(/aggregate/u)
  })
})

function workspaceId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
}

function configArrayObject(
  key: 'interactionEvidencePolicies' | 'interactionRoutingEvidencePolicies',
): { dict: Record<string, { dict?: Record<string, unknown> }> } {
  const root = Config as unknown as { dict: Record<string, ConfigSchemaNode> }
  let schema = root.dict[key]!
  if (schema.type === 'transform') schema = schema.inner!
  if (schema.type !== 'array' || schema.inner?.dict === undefined) {
    throw new Error(`Config.${key} is not an array of objects`)
  }
  return schema.inner as { dict: Record<string, { dict?: Record<string, unknown> }> }
}

interface ConfigSchemaNode {
  readonly type: string
  readonly inner?: ConfigSchemaNode
  readonly dict?: Record<string, ConfigSchemaNode>
}
