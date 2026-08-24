import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.js'

describe('dsh-evolve public configuration', () => {
  it('exposes only Workspace policy and internal content-addressed runtime roots', () => {
    const keys = Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict).sort()

    expect(keys).toEqual([
      'automaticPromotionPolicies',
      'cacheRoot',
      'candidateEvaluationPolicies',
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
  })
})
