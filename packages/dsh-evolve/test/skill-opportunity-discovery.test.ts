import { describe, expect, it } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../src/skill-opportunity-discovery.ts'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'

describe('experience-driven Skill opportunity discovery', () => {
  it('discovers a reusable Skill opportunity from repeated demand across distinct Goals', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100),
      gap('2', 'goal-b', 'release-dsh-plugin', 200),
    ]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps })

    expect(discovery.discover(WORKSPACE)).toEqual([{
      schemaVersion: 1,
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceId: WORKSPACE,
      skillName: 'release-dsh-plugin',
      gapIds: ['1'.repeat(64), '2'.repeat(64)],
      goalIds: ['goal-a', 'goal-b'],
      gapCount: 2,
      goalCount: 2,
      firstObservedAt: 100,
      lastObservedAt: 200,
      evidence: 'repeated-goal-capability-gap',
      status: 'eligible-for-authoring',
      releaseAuthority: 'none',
    }])
  })

  it('abstains when evidence is only one Goal, retries, or has no active Goal', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100),
      gap('2', 'goal-a', 'release-dsh-plugin', 200, 2),
      { ...gap('3', 'goal-b', 'another-capability', 300), goal: undefined },
    ]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps })

    expect(discovery.discover(WORKSPACE)).toEqual([])
  })

  it('does not merge evidence across Workspaces or accept a caller-selected Skill path', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100),
      gap('2', 'goal-b', 'release-dsh-plugin', 200, 1, '22222222-2222-4222-8222-222222222222'),
    ]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery({ list: workspaceId =>
      gaps.filter(value => workspaceId === undefined || value.workspaceId === workspaceId) })

    expect(discovery.discover(WORKSPACE)).toEqual([])
    expect(Object.keys(ExperienceDrivenSkillOpportunityDiscovery.prototype)).not.toContain('discoverBySkill')
  })
})

function gap(
  marker: string,
  goalId: string,
  requestedSkill: string,
  observedAt: number,
  revision = 1,
  workspaceId = WORKSPACE,
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
      objective: 'Deliver and verify a native DSH plugin capability.',
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
