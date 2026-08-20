import { describe, expect, it } from 'vitest'
import {
  FutureSessionRollback,
  type FutureSessionRollbackModules,
} from '../src/future-session-rollback.ts'
import type { CounterfactualCanaryScan } from '../src/counterfactual-canary.ts'
import type { CapabilityGeneration } from '../src/generation-store.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const ACTIVE_ID = 'a'.repeat(64)
const PARENT_ID = 'b'.repeat(64)
const CANARY_ID = 'c'.repeat(64)

describe('Future-Session Rollback', () => {
  it('revalidates one exact rollback-eligible Canary and atomically expects its active Generation', async () => {
    const fixture = rollbackFixture()
    const rollback = new FutureSessionRollback(fixture.modules)

    await expect(rollback.rollback(WORKSPACE_ID, { canaryId: CANARY_ID })).resolves.toEqual({
      previousId: ACTIVE_ID,
      generation: fixture.parent,
      authority: 'counterfactual-canary',
      canaryId: CANARY_ID,
    })
    expect(fixture.rolledBack).toEqual([{ workspaceId: WORKSPACE_ID, expectedActiveId: ACTIVE_ID }])
  })

  it('keeps explicit human recovery available without Canary governance', async () => {
    const fixture = rollbackFixture()
    const rollback = new FutureSessionRollback({ store: fixture.modules.store })

    await expect(rollback.rollback(WORKSPACE_ID)).resolves.toEqual({
      previousId: ACTIVE_ID,
      generation: fixture.parent,
      authority: 'explicit-human',
    })
    expect(fixture.rolledBack).toEqual([{ workspaceId: WORKSPACE_ID, expectedActiveId: ACTIVE_ID }])
  })

  it('fails closed when Canary authority is requested without Canary governance', async () => {
    const fixture = rollbackFixture()
    const rollback = new FutureSessionRollback({ store: fixture.modules.store })

    await expect(rollback.rollback(WORKSPACE_ID, { canaryId: CANARY_ID }))
      .rejects.toThrow('future-Session rollback blocked: canary-governance-unavailable')
    expect(fixture.rolledBack).toEqual([])
  })

  it('rejects an active Generation projected from another Workspace', async () => {
    const fixture = rollbackFixture()
    const otherWorkspace = '22222222-2222-4222-8222-222222222222'
    const rollback = new FutureSessionRollback({
      store: {
        ...fixture.modules.store,
        getActiveGeneration: () => ({ ...fixture.active, workspaceId: otherWorkspace }),
      },
    })

    await expect(rollback.rollback(WORKSPACE_ID))
      .rejects.toThrow('future-Session rollback blocked: active-generation-workspace-mismatch')
    expect(fixture.rolledBack).toEqual([])
  })
})

function rollbackFixture() {
  const parent = generation(PARENT_ID)
  const active = generation(ACTIVE_ID, PARENT_ID)
  const rolledBack: Array<{ workspaceId: string; expectedActiveId: string }> = []
  const modules: FutureSessionRollbackModules = {
    store: {
      getActiveGeneration: () => active,
      getGeneration: id => id === PARENT_ID ? parent : id === ACTIVE_ID ? active : undefined,
      rollbackGeneration: async (workspaceId, expectedActiveId) => {
        rolledBack.push({ workspaceId, expectedActiveId })
        return { previousId: expectedActiveId, generation: parent }
      },
    },
    canary: {
      scan: async () => canaryScan(),
    },
  }
  return { active, modules, parent, rolledBack }
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
      name: 'release-proof',
      gitCommit: 'd'.repeat(40),
      treeHash: 'e'.repeat(64),
    }],
    evaluatorVersion: 'holdout-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function canaryScan(): CounterfactualCanaryScan {
  return {
    configuredRootCount: 1,
    warningCount: 0,
    runs: [{
      schemaVersion: 1,
      kind: 'internal-counterfactual-canary-result-v1',
      id: CANARY_ID,
      workspaceId: WORKSPACE_ID,
      generationId: ACTIVE_ID,
      outcomeId: '1'.repeat(64),
      candidateId: '2'.repeat(64),
      skillName: 'release-proof',
      reviewId: '3'.repeat(64),
      retentionId: '4'.repeat(64),
      admissionId: '5'.repeat(64),
      evaluationEnvelopeId: '6'.repeat(64),
      status: 'rollback-eligible',
      reason: 'candidate-regressed-sealed-canary',
      startedAt: '2026-08-21T00:00:00.000Z',
      finishedAt: '2026-08-21T00:01:00.000Z',
      evidence: {
        retentionCasePackHash: '7'.repeat(64),
        baselineTreeHash: '8'.repeat(64),
        candidateTreeHash: '9'.repeat(64),
        baseline: 'pass',
        candidate: 'fail',
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
