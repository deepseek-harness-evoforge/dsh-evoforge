import { describe, expect, it } from 'vitest'
import type { ExistingSkillCounterfactualCanaryScan } from '../src/existing-skill-counterfactual-canary.ts'
import {
  ExistingSkillFutureSessionRollback,
  type ExistingSkillFutureSessionRollbackModules,
} from '../src/existing-skill-future-session-rollback.ts'
import type { CapabilityGeneration } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const ACTIVE_ID = 'a'.repeat(64)
const PARENT_ID = 'b'.repeat(64)
const CANARY_ID = 'c'.repeat(64)

describe('Existing-Skill Future-Session Rollback', () => {
  it('revalidates one exact rollback-eligible Canary and atomically expects its active Generation', async () => {
    const fixture = rollbackFixture()
    const rollback = new ExistingSkillFutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, CANARY_ID)).resolves.toEqual({
      previousId: ACTIVE_ID,
      generation: fixture.parent,
      authority: 'existing-skill-counterfactual-canary',
      canaryId: CANARY_ID,
    })
    expect(fixture.rolledBack).toEqual([{
      workspaceId: WORKSPACE_ID,
      expectedActiveId: ACTIVE_ID,
      evidence: { authority: 'existing-skill-counterfactual-canary', canaryId: CANARY_ID },
    }])
  })

  it('fails closed when the durable verdict no longer proves isolated Candidate regression', async () => {
    const fixture = rollbackFixture({
      evidence: { baseline: 'fail', candidate: 'fail' },
    })
    const rollback = new ExistingSkillFutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, CANARY_ID))
      .rejects.toThrow('existing-Skill future-Session rollback blocked: canary-not-rollback-eligible')
    expect(fixture.rolledBack).toEqual([])
  })

  it('fails closed when Canary governance reports any invalid durable state', async () => {
    const fixture = rollbackFixture({ warningCount: 1 })
    const rollback = new ExistingSkillFutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, CANARY_ID))
      .rejects.toThrow('existing-Skill future-Session rollback blocked: canary-evidence-invalid')
    expect(fixture.rolledBack).toEqual([])
  })

  it('binds the requested Canary to the still-active Generation', async () => {
    const fixture = rollbackFixture({ generationId: 'd'.repeat(64) })
    const rollback = new ExistingSkillFutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, CANARY_ID))
      .rejects.toThrow('existing-Skill future-Session rollback blocked: canary-generation-mismatch')
    expect(fixture.rolledBack).toEqual([])
  })

  it('revalidates the approved release lineage before moving the pointer', async () => {
    const fixture = rollbackFixture({ releaseRetentionId: 'f'.repeat(64) })
    const rollback = new ExistingSkillFutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, CANARY_ID))
      .rejects.toThrow('existing-Skill future-Session rollback blocked: release-evidence-invalid')
    expect(fixture.rolledBack).toEqual([])
  })
})

function rollbackFixture(options: {
  warningCount?: number
  generationId?: string
  evidence?: { baseline: 'pass' | 'fail'; candidate: 'pass' | 'fail' }
  releaseRetentionId?: string
} = {}) {
  const parent = generation(PARENT_ID)
  const active = generation(ACTIVE_ID, PARENT_ID)
  const rolledBack: Array<{ workspaceId: string; expectedActiveId: string; evidence: unknown }> = []
  const modules: ExistingSkillFutureSessionRollbackModules = {
    store: {
      getActiveGeneration: () => active,
      getGeneration: id => id === PARENT_ID ? parent : id === ACTIVE_ID ? active : undefined,
      rollbackGeneration: async (workspaceId, expectedActiveId, evidence) => {
        rolledBack.push({ workspaceId, expectedActiveId, evidence })
        return { previousId: expectedActiveId, generation: parent }
      },
    },
    canary: {
      scan: async () => canaryScan(options),
    },
    releases: {
      eligibility: async () => ({
        status: 'approved',
        reason: 'exact-existing-skill-evidence-retained',
        candidateId: '2'.repeat(64),
        admissionId: '3'.repeat(64),
        holdoutEvaluationId: '4'.repeat(64),
        retentionEvaluationId: options.releaseRetentionId ?? '5'.repeat(64),
        generationId: ACTIVE_ID,
      }),
    },
  }
  return { modules, parent, rolledBack }
}

function generation(id: string, parentId?: string): CapabilityGeneration {
  return {
    schemaVersion: 2,
    id,
    workspaceId: WORKSPACE_ID,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: 1_787_270_400_000,
    artifacts: [{
      kind: 'skill',
      name: 'build-dsh-plugin',
      gitCommit: 'd'.repeat(40),
      treeHash: 'e'.repeat(64),
    }],
    evaluatorVersion: 'holdout-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function canaryScan(options: {
  warningCount?: number
  generationId?: string
  evidence?: { baseline: 'pass' | 'fail'; candidate: 'pass' | 'fail' }
}): ExistingSkillCounterfactualCanaryScan {
  const outcomes = options.evidence ?? { baseline: 'pass', candidate: 'fail' }
  return {
    configuredPolicyCount: 1,
    warningCount: options.warningCount ?? 0,
    runs: [{
      schemaVersion: 1,
      kind: 'existing-skill-counterfactual-canary-result-v1',
      id: CANARY_ID,
      policyId: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      generationId: options.generationId ?? ACTIVE_ID,
      outcomeId: '1'.repeat(64),
      candidateId: '2'.repeat(64),
      skillName: 'build-dsh-plugin',
      admissionId: '3'.repeat(64),
      holdoutEvaluationId: '4'.repeat(64),
      retentionEvaluationId: '5'.repeat(64),
      evaluationEnvelopeId: '6'.repeat(64),
      status: 'rollback-eligible',
      reason: 'candidate-regressed-baseline-recovers',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      evidence: {
        holdoutCasePackHash: '7'.repeat(64),
        retentionCasePackHash: '8'.repeat(64),
        baselineTreeHash: '9'.repeat(64),
        candidateTreeHash: '0'.repeat(64),
        baseline: outcomes.baseline,
        candidate: outcomes.candidate,
        calibrationPassed: true,
        assembled: true,
        compositionStable: true,
        inputIntegrityStable: true,
        activePointerStable: true,
        proposerCalls: 0,
        trialCount: 4,
      },
      releaseAuthority: 'none',
    }],
  }
}
