import { describe, expect, it } from 'vitest'
import {
  createDiscoveredSkillLineage,
  parseDiscoveredSkillLineage,
} from '../src/discovered-skill-lineage.ts'
import type { DiscoveredSkillAdmissionResult } from '../src/discovered-skill-admission.ts'
import type { DiscoveredSkillCandidate } from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('discovered Skill lineage', () => {
  it('shrinks an exact revised research Candidate and its admission into public identity-only lineage', () => {
    const lineage = createDiscoveredSkillLineage(researchRevisionCandidate(), qualifiedAdmission())

    expect(lineage).toEqual({
      kind: 'discovered-skill-lineage-v1',
      candidateId: 'a'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'missing-release-skill',
      versionKind: 'slow-loop-research-revision-v3',
      source: {
        id: 'missing-release-author',
        kind: 'slow-loop-author',
        trust: 'bounded-host-authoring',
      },
      contentHash: '5'.repeat(64),
      candidateTreeHash: '7'.repeat(64),
      admissionId: '6'.repeat(64),
      admissionTargetId: 'missing-release-admission',
      research: {
        researchDigest: 'f'.repeat(64),
        parentCandidateId: '1'.repeat(64),
        parentTreeHash: '4'.repeat(64),
        revisionHoldoutResultId: '8'.repeat(64),
        researchHoldoutResultId: '9'.repeat(64),
      },
      releaseAuthority: 'none',
    })
    expect(Object.isFrozen(lineage)).toBe(true)
    expect(Object.isFrozen(lineage.source)).toBe(true)
    expect(Object.isFrozen(lineage.research)).toBe(true)
    expect(JSON.stringify(lineage)).not.toMatch(/modelIdentity|inputDigest|artifactDigest|provider|attribution|path|SKILL\.md/u)
  })

  it('rejects extra private fields and incomplete revision ancestry when reading durable state', () => {
    const lineage = createDiscoveredSkillLineage(researchRevisionCandidate(), qualifiedAdmission())

    expect(() => parseDiscoveredSkillLineage({
      ...lineage,
      providerRoute: 'private-provider',
    })).toThrow('invalid discovered Skill lineage')
    expect(() => parseDiscoveredSkillLineage({
      ...lineage,
      research: {
        ...lineage.research,
        parentCandidateId: undefined,
      },
    })).toThrow('invalid discovered Skill lineage')
  })
})

function researchRevisionCandidate(): DiscoveredSkillCandidate {
  return {
    schemaVersion: 1,
    id: 'a'.repeat(64),
    discoveredAt: 1_786_896_100_000,
    gapId: '2'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    description: 'Candidate.',
    demand: {
      kind: 'cross-goal-cluster-v1',
      clusterId: 'b'.repeat(64),
      gapIds: ['2'.repeat(64), 'c'.repeat(64)],
      goalCount: 2,
    },
    source: {
      id: 'missing-release-author',
      kind: 'slow-loop-author',
      trust: 'bounded-host-authoring',
    },
    scope: 'workspace',
    version: {
      kind: 'slow-loop-research-revision-v3',
      revision: 1,
      modelIdentityHash: 'd'.repeat(64),
      inputDigest: 'e'.repeat(64),
      researchDigest: 'f'.repeat(64),
      parentCandidateId: '1'.repeat(64),
      parentTreeHash: '4'.repeat(64),
      holdoutResultId: '8'.repeat(64),
      artifactDigest: '5'.repeat(64),
      treeHash: '7'.repeat(64),
    },
    distribution: { kind: 'archive', format: 'tar.gz' },
    contentHash: '5'.repeat(64),
    package: {
      path: 'missing-release-skill',
      fileCount: 1,
      totalBytes: 80,
      hasScripts: false,
      hasReferences: true,
    },
    permissions: { declared: false, executableContent: false, externalEffects: 'unknown' },
    safety: { status: 'quarantined', checks: [] },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
}

function qualifiedAdmission(): DiscoveredSkillAdmissionResult {
  return {
    schemaVersion: 1,
    id: '6'.repeat(64),
    candidateId: 'a'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'missing-release-skill',
    status: 'qualified-for-shadow',
    reasons: ['candidate-improves-deterministic-admission'],
    targetId: 'missing-release-admission',
    researchHoldoutResultId: '9'.repeat(64),
    releaseAuthority: 'none',
    evidence: {
      baseline: 'fail',
      candidate: 'pass',
      calibrationPassed: true,
      candidateExecuted: false,
      evaluatorClass: 'deterministic-filesystem',
      trialCount: 4,
      baselineTreeHash: '0'.repeat(64),
      candidateTreeHash: '7'.repeat(64),
    },
  }
}
