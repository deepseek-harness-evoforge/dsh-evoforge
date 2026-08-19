import { describe, expect, it } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import type { DeliveryOutcome } from '../src/delivery-outcome-monitor.ts'
import type { FeedbackSignal } from '../src/feedback-signal-monitor.ts'
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
      schemaVersion: 3,
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceId: WORKSPACE,
      skillName: 'release-dsh-plugin',
      gapIds: ['1'.repeat(64), '2'.repeat(64)],
      goalIds: ['goal-a', 'goal-b'],
      gapCount: 2,
      goalCount: 2,
      firstObservedAt: 100,
      lastObservedAt: 200,
      evidence: {
        kind: 'internal-experience-v3',
        eligibilityBasis: 'two-or-more-distinct-goals',
        correctionSignals: {
          association: 'exact-durable-skill-invocation',
          count: 0,
          goalCount: 0,
          ids: [],
          referencesTruncated: false,
        },
        deliveryOutcomes: {
          association: 'same-goal-single-skill-gap',
          total: 0,
          passed: 0,
          failed: 0,
          unknown: 0,
          ids: [],
          referencesTruncated: false,
        },
        causalClaim: 'none',
      },
      status: 'eligible-for-authoring',
      releaseAuthority: 'none',
    }])
  })

  it('associates later outcomes across revisions only for one unambiguous Goal Skill', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100, 1, WORKSPACE, 'session-a'),
      gap('2', 'goal-b', 'release-dsh-plugin', 200, 2, WORKSPACE, 'session-b'),
      gap('3', 'goal-b', 'another-skill', 210, 2, WORKSPACE, 'session-b'),
    ]
    const feedback = [
      attributedSignal('4', 'session-a', 110, 'release-dsh-plugin', 'goal-a'),
      signal('5', 'session-a', 90),
      signal('6', 'session-b', 220),
    ]
    const outcomes = [
      outcome('7', 'goal-a', 1, 'failed', 120),
      outcome('8', 'goal-a', 2, 'passed', 130),
      outcome('9', 'goal-b', 2, 'passed', 230),
    ]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => gaps },
      { feedback: { list: () => feedback }, outcomes: { list: () => outcomes } },
    )

    const [opportunity] = discovery.discover(WORKSPACE)
    expect(opportunity?.evidence).toEqual({
      kind: 'internal-experience-v3',
      eligibilityBasis: 'two-or-more-distinct-goals',
      correctionSignals: {
        association: 'exact-durable-skill-invocation',
        count: 1,
        goalCount: 1,
        ids: ['4'.repeat(64)],
        referencesTruncated: false,
      },
      deliveryOutcomes: {
        association: 'same-goal-single-skill-gap',
        total: 2,
        passed: 1,
        failed: 1,
        unknown: 0,
        ids: ['7'.repeat(64), '8'.repeat(64)],
        referencesTruncated: false,
      },
      causalClaim: 'none',
    })
  })

  it('attributes corrections only through one exact durable Skill invocation and Goal', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100, 1, WORKSPACE, 'session-a'),
      gap('2', 'goal-b', 'release-dsh-plugin', 200, 1, WORKSPACE, 'session-b'),
    ]
    const weakSameSession = signal('3', 'session-a', 110)
    const exactInvocation = attributedSignal(
      '4',
      'session-c',
      310,
      'release-dsh-plugin',
      'goal-c',
    )
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => gaps },
      { feedback: { list: () => [weakSameSession, exactInvocation] } },
    )

    expect(discovery.discover(WORKSPACE)[0]?.evidence.correctionSignals).toEqual({
      association: 'exact-durable-skill-invocation',
      count: 1,
      goalCount: 1,
      ids: ['4'.repeat(64)],
      referencesTruncated: false,
    })
    expect(discovery.discover(WORKSPACE)[0]?.evidence).toMatchObject({
      causalClaim: 'none',
    })
  })

  it('rejects an outcome from a Goal revision older than its first matching gap', () => {
    const gaps = [
      gap('1', 'goal-a', 'release-dsh-plugin', 100, 2, WORKSPACE, 'session-a'),
      gap('2', 'goal-b', 'release-dsh-plugin', 200, 1, WORKSPACE, 'session-b'),
    ]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => gaps },
      { outcomes: { list: () => [
        outcome('3', 'goal-a', 1, 'failed', 120),
        outcome('4', 'goal-a', 2, 'passed', 130),
      ] } },
    )

    expect(discovery.discover(WORKSPACE)[0]?.evidence.deliveryOutcomes).toMatchObject({
      association: 'same-goal-single-skill-gap',
      total: 1,
      passed: 1,
      failed: 0,
      ids: ['4'.repeat(64)],
    })
  })

  it('never lets correction or outcome context replace the distinct-Goal eligibility rule', () => {
    const gaps = [gap('1', 'goal-a', 'release-dsh-plugin', 100, 1, WORKSPACE, 'session-a')]
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => gaps },
      {
        feedback: { list: () => [signal('2', 'session-a', 110)] },
        outcomes: { list: () => [outcome('3', 'goal-a', 1, 'failed', 120)] },
      },
    )

    expect(discovery.discover(WORKSPACE)).toEqual([])
  })

  it('ignores feedback without an exact invocation even when its Session has one Gap Skill', () => {
    const unrelated = { ...gap(
      '3',
      'goal-c',
      'another-skill',
      105,
      1,
      WORKSPACE,
      'session-a',
    ), goal: undefined }
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => [
        gap('1', 'goal-a', 'release-dsh-plugin', 100, 1, WORKSPACE, 'session-a'),
        gap('2', 'goal-b', 'release-dsh-plugin', 200, 1, WORKSPACE, 'session-b'),
        unrelated,
      ] },
      { feedback: { list: () => [signal('4', 'session-a', 110)] } },
    )

    expect(discovery.discover(WORKSPACE)[0]?.evidence.correctionSignals.count).toBe(0)
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

  it('discovers an existing-Skill investigation only from repeated exact-content corrections across Goals', () => {
    const contentHash = 'a'.repeat(64)
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => [] },
      { feedback: { list: () => [
        attributedSignal('1', 'session-a', 100, 'release-dsh-plugin', 'goal-a', contentHash),
        attributedSignal('2', 'session-b', 200, 'release-dsh-plugin', 'goal-b', contentHash),
      ] } },
    )

    expect(discovery.discoverImprovements(WORKSPACE)).toEqual([{
      schemaVersion: 1,
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceId: WORKSPACE,
      skillName: 'release-dsh-plugin',
      invocationContentHash: contentHash,
      feedbackSignalIds: ['1'.repeat(64), '2'.repeat(64)],
      goalIds: ['goal-a', 'goal-b'],
      signalCount: 2,
      goalCount: 2,
      firstObservedAt: 100,
      lastObservedAt: 200,
      evidence: {
        kind: 'internal-exact-skill-corrections-v1',
        association: 'exact-durable-skill-invocation-content',
        eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content',
        referencesTruncated: false,
        causalClaim: 'none',
      },
      status: 'waiting-for-baseline-bundle',
      releaseAuthority: 'none',
    }])
  })

  it('does not merge existing-Skill corrections across content versions or one Goal', () => {
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => [] },
      { feedback: { list: () => [
        attributedSignal('1', 'session-a', 100, 'release-dsh-plugin', 'goal-a', 'a'.repeat(64)),
        attributedSignal('2', 'session-b', 200, 'release-dsh-plugin', 'goal-b', 'b'.repeat(64)),
        attributedSignal('3', 'session-c', 300, 'release-dsh-plugin', 'goal-a', 'a'.repeat(64)),
      ] } },
    )

    expect(discovery.discoverImprovements(WORKSPACE)).toEqual([])
  })

  it('abstains from existing-Skill improvement when attribution is legacy or duplicated', () => {
    const exact = attributedSignal(
      '1',
      'session-a',
      100,
      'release-dsh-plugin',
      'goal-a',
      'a'.repeat(64),
    )
    const discovery = new ExperienceDrivenSkillOpportunityDiscovery(
      { list: () => [] },
      { feedback: { list: () => [
        exact,
        { ...exact },
        attributedSignal('2', 'session-b', 200, 'release-dsh-plugin', 'goal-b'),
      ] } },
    )

    expect(discovery.discoverImprovements(WORKSPACE)).toEqual([])
  })
})

function gap(
  marker: string,
  goalId: string,
  requestedSkill: string,
  observedAt: number,
  revision = 1,
  workspaceId = WORKSPACE,
  sessionId = `session-${marker}`,
): CapabilityGap {
  return {
    schemaVersion: 1,
    id: marker.repeat(64),
    observedAt,
    workspaceId,
    sessionId,
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

function signal(marker: string, sessionId: string, sourceUpdatedAt: number): FeedbackSignal {
  return {
    schemaVersion: 2,
    id: marker.repeat(64),
    observedAt: sourceUpdatedAt,
    workspaceId: WORKSPACE,
    sessionId,
    messageId: `message-${marker}`,
    feedbackVersion: `${marker.repeat(8)}-${marker.repeat(4)}-4${marker.repeat(3)}-8${marker.repeat(3)}-${marker.repeat(12)}`,
    sourceUpdatedAt,
  }
}

function attributedSignal(
  marker: string,
  sessionId: string,
  sourceUpdatedAt: number,
  skillName: string,
  goalId: string,
  invocationContentHash?: string,
): FeedbackSignal & {
  readonly attribution: {
    readonly kind: 'exact-skill-invocation-v1'
    readonly skillName: string
    readonly route: 'model-tool'
    readonly invocationSeq: number
    readonly invocationContentHash?: string
    readonly assistantSeq: number
    readonly turn: number
    readonly goal: { readonly id: string; readonly revision: number }
  }
} {
  return {
    ...signal(marker, sessionId, sourceUpdatedAt),
    attribution: {
      kind: 'exact-skill-invocation-v1',
      skillName,
      route: 'model-tool',
      invocationSeq: 12,
      ...(invocationContentHash === undefined ? {} : { invocationContentHash }),
      assistantSeq: 15,
      turn: 3,
      goal: { id: goalId, revision: 2 },
    },
  }
}

function outcome(
  marker: string,
  goalId: string,
  revision: number,
  status: DeliveryOutcome['status'],
  observedAt: number,
): DeliveryOutcome {
  return {
    schemaVersion: 2,
    id: marker.repeat(64),
    observedAt,
    workspaceId: WORKSPACE,
    sessionId: `delivery-session-${marker}`,
    callId: `call-${marker}`,
    goal: { id: goalId, revision, phase: status === 'passed' ? 'complete' : 'active' },
    status,
    reason: `${status} delivery outcome`,
  }
}
