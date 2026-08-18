import { describe, expect, it } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { clusterCapabilityGaps } from '../src/capability-gap-cluster.ts'
import type { DiscoveredSkillCandidate } from '../src/trusted-skill-discovery.ts'

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111'
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222'

describe('Capability Gap cross-Goal clustering', () => {
  it('aggregates repeated exact demand only after two distinct Goals', () => {
    const gaps = [
      gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100),
      gap('2', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 110, 2),
      gap('3', WORKSPACE_A, 'publish-dsh-plugin', 'goal-b', 120),
    ]

    expect(clusterCapabilityGaps(gaps, [])).toEqual([{
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceId: WORKSPACE_A,
      canonicalSkill: 'publish-dsh-plugin',
      requestedSkills: ['publish-dsh-plugin'],
      gapIds: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)],
      gapCount: 3,
      goalCount: 2,
      firstObservedAt: 100,
      lastObservedAt: 120,
      evidence: 'repeated-skill-demand',
      status: 'evidence-only',
      releaseAuthority: 'none',
    }])
  })

  it('joins different Gap proposals only when both resolve to one quarantined Skill identity', () => {
    const gaps = [
      gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100),
      gap('2', WORKSPACE_A, 'release-extension', 'goal-b', 120),
    ]
    const candidates = [
      candidate('a', gaps[0]!, 'release-native-extension'),
      candidate('b', gaps[1]!, 'release-native-extension'),
    ]

    expect(clusterCapabilityGaps(gaps, candidates)).toEqual([expect.objectContaining({
      canonicalSkill: 'release-native-extension',
      resolvedSkill: 'release-native-extension',
      requestedSkills: ['publish-dsh-plugin', 'release-extension'],
      gapCount: 2,
      goalCount: 2,
      evidence: 'shared-resolved-candidate',
      status: 'evidence-only',
      releaseAuthority: 'none',
    })])
  })

  it('does not create a cross-Goal cluster from retries of one Goal', () => {
    const gaps = [
      gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100),
      gap('2', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 120, 2),
    ]

    expect(clusterCapabilityGaps(gaps, [])).toEqual([])
  })

  it('fails closed when one Gap has conflicting candidate identities', () => {
    const first = gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100)
    const second = gap('2', WORKSPACE_A, 'release-extension', 'goal-b', 120)
    const candidates = [
      candidate('a', first, 'release-native-extension'),
      candidate('b', first, 'publish-native-bundle'),
      candidate('c', second, 'release-native-extension'),
    ]

    expect(clusterCapabilityGaps([first, second], candidates)).toEqual([])
  })

  it('does not merge equal Skill names backed by different package identities', () => {
    const first = gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100)
    const second = gap('2', WORKSPACE_A, 'release-extension', 'goal-b', 120)
    const candidates = [
      candidate('a', first, 'release-native-extension', '6'),
      candidate('b', second, 'release-native-extension', '5'),
    ]

    expect(clusterCapabilityGaps([first, second], candidates)).toEqual([])
  })

  it('never merges evidence across Workspaces and orders stronger demand first', () => {
    const gaps = [
      gap('1', WORKSPACE_A, 'publish-dsh-plugin', 'goal-a', 100),
      gap('2', WORKSPACE_B, 'publish-dsh-plugin', 'goal-b', 110),
      gap('3', WORKSPACE_A, 'inspect-release', 'goal-c', 120),
      gap('4', WORKSPACE_A, 'inspect-release', 'goal-d', 130),
      gap('5', WORKSPACE_A, 'inspect-release', 'goal-e', 140),
      gap('6', WORKSPACE_A, 'publish-dsh-plugin', 'goal-f', 150),
    ]

    expect(clusterCapabilityGaps(gaps, []).map(cluster => ({
      workspaceId: cluster.workspaceId,
      canonicalSkill: cluster.canonicalSkill,
      goalCount: cluster.goalCount,
    }))).toEqual([
      { workspaceId: WORKSPACE_A, canonicalSkill: 'inspect-release', goalCount: 3 },
      { workspaceId: WORKSPACE_A, canonicalSkill: 'publish-dsh-plugin', goalCount: 2 },
    ])
    expect(clusterCapabilityGaps(gaps, [], { maxClusters: 1 })).toHaveLength(1)
    expect(() => clusterCapabilityGaps(gaps, [], { maxClusters: 0 }))
      .toThrow('Capability Gap maxClusters must be a positive integer')
  })
})

function gap(
  marker: string,
  workspaceId: string,
  requestedSkill: string,
  goalId: string,
  observedAt: number,
  revision = 1,
): CapabilityGap {
  return {
    schemaVersion: 1,
    id: marker.repeat(64),
    observedAt,
    workspaceId,
    sessionId: `session-${marker}`,
    requestedSkill,
    catalogHash: '9'.repeat(64),
    catalogSize: 4,
    goal: {
      id: goalId,
      revision,
      objective: 'Publish and verify a native DSH extension.',
    },
    status: 'confirmed',
    evidence: {
      kind: 'model-declared-skill-gap',
      catalog: 'complete',
      routing: 'model-declared-no-applicable-skill',
      providers: 'settled',
    },
  }
}

function candidate(
  marker: string,
  sourceGap: CapabilityGap,
  requestedSkill: string,
  contentMarker = '6',
): DiscoveredSkillCandidate {
  return {
    schemaVersion: 1,
    id: marker.repeat(64),
    discoveredAt: sourceGap.observedAt + 1,
    gapId: sourceGap.id,
    workspaceId: sourceGap.workspaceId,
    requestedSkill,
    description: 'Publish and verify a native extension release.',
    source: {
      id: 'local-curated',
      kind: 'local-git',
      trust: 'explicit-deployer-config',
    },
    scope: 'workspace',
    version: {
      kind: 'git-tree',
      commit: '8'.repeat(40),
      treeHash: '7'.repeat(40),
    },
    contentHash: contentMarker.repeat(64),
    package: {
      path: `skills/${requestedSkill}`,
      fileCount: 1,
      totalBytes: 320,
      hasScripts: false,
      hasReferences: false,
    },
    permissions: {
      declared: false,
      executableContent: false,
      externalEffects: 'unknown',
    },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'git-object-integrity', status: 'passed' },
        { name: 'regular-files-only', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
}
