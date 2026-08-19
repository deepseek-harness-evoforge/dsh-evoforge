import { createHash } from 'node:crypto'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'
import type { DeliveryOutcome, DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { FeedbackSignal, FeedbackSignalStore } from './feedback-signal-monitor.ts'

const DEFAULT_MAX_OPPORTUNITIES = 20
const MAX_EVIDENCE_REFERENCES = 100

export interface SkillOpportunityEvidence {
  readonly kind: 'internal-experience-v3'
  readonly eligibilityBasis: 'two-or-more-distinct-goals'
  readonly correctionSignals: {
    readonly association: 'exact-durable-skill-invocation'
    readonly count: number
    readonly goalCount: number
    readonly ids: readonly string[]
    readonly referencesTruncated: boolean
  }
  readonly deliveryOutcomes: {
    readonly association: 'same-goal-single-skill-gap'
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly unknown: number
    readonly ids: readonly string[]
    readonly referencesTruncated: boolean
  }
  /** Exact invocation association still does not prove that the Skill caused the result. */
  readonly causalClaim: 'none'
}

export interface SkillOpportunity {
  readonly schemaVersion: 3
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly gapIds: readonly string[]
  readonly goalIds: readonly string[]
  readonly gapCount: number
  readonly goalCount: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly evidence: SkillOpportunityEvidence
  readonly status: 'eligible-for-authoring'
  readonly releaseAuthority: 'none'
}

/** Existing installed Skill repeatedly corrected against one exact model-visible version. */
export interface SkillImprovementOpportunity {
  readonly schemaVersion: 1
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly invocationContentHash: string
  readonly feedbackSignalIds: readonly string[]
  readonly goalIds: readonly string[]
  readonly signalCount: number
  readonly goalCount: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly evidence: {
    readonly kind: 'internal-exact-skill-corrections-v1'
    readonly association: 'exact-durable-skill-invocation-content'
    readonly eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content'
    readonly referencesTruncated: boolean
    /** Exact invocation association still does not prove that the Skill caused the result. */
    readonly causalClaim: 'none'
  }
  /** Candidate authoring must wait for an exact complete installed-bundle baseline. */
  readonly status: 'waiting-for-baseline-bundle'
  readonly releaseAuthority: 'none'
}

/**
 * Derive reusable Skill opportunities only from durable DSH experience.
 * Callers may scope by Workspace, but cannot provide a Skill name, path,
 * source, Agent, or workflow choice.
 */
export class ExperienceDrivenSkillOpportunityDiscovery {
  private readonly gaps: Pick<CapabilityGapStore, 'list'>
  private readonly options: {
    readonly maxOpportunities?: number
    readonly feedback?: Pick<FeedbackSignalStore, 'list'>
    readonly outcomes?: Pick<DeliveryOutcomeStore, 'list'>
  }

  constructor(
    gaps: Pick<CapabilityGapStore, 'list'>,
    options: {
      readonly maxOpportunities?: number
      readonly feedback?: Pick<FeedbackSignalStore, 'list'>
      readonly outcomes?: Pick<DeliveryOutcomeStore, 'list'>
    } = {},
  ) {
    this.gaps = gaps
    this.options = options
  }

  discover(workspaceId?: string): SkillOpportunity[] {
    const maxOpportunities = this.options.maxOpportunities ?? DEFAULT_MAX_OPPORTUNITIES
    if (!Number.isInteger(maxOpportunities) || maxOpportunities < 1) {
      throw new Error('Skill opportunity maxOpportunities must be a positive integer')
    }

    const uniqueGaps = new Map<string, CapabilityGap>()
    for (const gap of this.gaps.list(workspaceId)) {
      if (!uniqueGaps.has(gap.id)) uniqueGaps.set(gap.id, gap)
    }

    const goalLinkedGaps = [...uniqueGaps.values()].filter(
      (gap): gap is CapabilityGap & { readonly goal: NonNullable<CapabilityGap['goal']> } =>
        gap.goal !== undefined,
    )
    const groups = new Map<string, typeof goalLinkedGaps>()
    for (const withGoal of goalLinkedGaps) {
      const gap = withGoal
      const key = `${gap.workspaceId}\0${gap.requestedSkill}`
      const values = groups.get(key) ?? []
      values.push(withGoal)
      groups.set(key, values)
    }

    const attribution = buildAttributionIndex([...uniqueGaps.values()])
    const feedback = this.options.feedback?.list(workspaceId) ?? []
    const outcomes = this.options.outcomes?.list(workspaceId) ?? []
    const opportunities: SkillOpportunity[] = []
    for (const values of groups.values()) {
      const goalIds = [...new Set(values.map(gap => gap.goal.id))].sort()
      if (goalIds.length < 2) continue
      const sorted = [...values].sort((left, right) =>
        left.observedAt - right.observedAt || left.id.localeCompare(right.id))
      const first = sorted[0]!
      opportunities.push(Object.freeze({
        schemaVersion: 3,
        id: opportunityId(first.workspaceId, first.requestedSkill),
        workspaceId: first.workspaceId,
        skillName: first.requestedSkill,
        gapIds: Object.freeze(sorted.map(gap => gap.id).sort()),
        goalIds: Object.freeze(goalIds),
        gapCount: sorted.length,
        goalCount: goalIds.length,
        firstObservedAt: first.observedAt,
        lastObservedAt: sorted.at(-1)!.observedAt,
        evidence: opportunityEvidence(first.workspaceId, first.requestedSkill, attribution, feedback, outcomes),
        status: 'eligible-for-authoring',
        releaseAuthority: 'none',
      }))
    }

    return opportunities.sort((left, right) =>
      right.goalCount - left.goalCount
      || right.gapCount - left.gapCount
      || right.lastObservedAt - left.lastObservedAt
      || left.skillName.localeCompare(right.skillName)
      || left.workspaceId.localeCompare(right.workspaceId)).slice(0, maxOpportunities)
  }

  /**
   * Discover investigation-only opportunities for an existing Skill version.
   * Name-only, same-Goal, duplicate, and legacy no-content-hash feedback abstains.
   */
  discoverImprovements(workspaceId?: string): SkillImprovementOpportunity[] {
    const maxOpportunities = this.options.maxOpportunities ?? DEFAULT_MAX_OPPORTUNITIES
    if (!Number.isInteger(maxOpportunities) || maxOpportunities < 1) {
      throw new Error('Skill opportunity maxOpportunities must be a positive integer')
    }
    const exact = uniqueById(this.options.feedback?.list(workspaceId) ?? [])
      .filter(isExactContentCorrection)
      .filter(signal => workspaceId === undefined || signal.workspaceId === workspaceId)
    const groups = new Map<string, typeof exact>()
    for (const signal of exact) {
      const key = improvementKey(
        signal.workspaceId,
        signal.attribution.skillName,
        signal.attribution.invocationContentHash,
      )
      const values = groups.get(key) ?? []
      values.push(signal)
      groups.set(key, values)
    }

    const opportunities: SkillImprovementOpportunity[] = []
    for (const values of groups.values()) {
      const sorted = [...values].sort((left, right) =>
        left.sourceUpdatedAt - right.sourceUpdatedAt || left.id.localeCompare(right.id))
      const first = sorted[0]!
      const attribution = first.attribution
      const allGoalIds = [...new Set(sorted.map(signal => signal.attribution.goal.id))].sort()
      if (allGoalIds.length < 2) continue
      const signalIds = referenceIds(sorted)
      const goalIds = Object.freeze(allGoalIds.slice(-MAX_EVIDENCE_REFERENCES))
      opportunities.push(Object.freeze({
        schemaVersion: 1,
        id: improvementOpportunityId(
          first.workspaceId,
          attribution.skillName,
          attribution.invocationContentHash,
        ),
        workspaceId: first.workspaceId,
        skillName: attribution.skillName,
        invocationContentHash: attribution.invocationContentHash,
        feedbackSignalIds: signalIds,
        goalIds,
        signalCount: sorted.length,
        goalCount: allGoalIds.length,
        firstObservedAt: first.sourceUpdatedAt,
        lastObservedAt: sorted.at(-1)!.sourceUpdatedAt,
        evidence: Object.freeze({
          kind: 'internal-exact-skill-corrections-v1',
          association: 'exact-durable-skill-invocation-content',
          eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content',
          referencesTruncated: sorted.length > signalIds.length || allGoalIds.length > goalIds.length,
          causalClaim: 'none',
        }),
        status: 'waiting-for-baseline-bundle',
        releaseAuthority: 'none',
      }))
    }
    return opportunities.sort((left, right) =>
      right.goalCount - left.goalCount
      || right.signalCount - left.signalCount
      || right.lastObservedAt - left.lastObservedAt
      || left.skillName.localeCompare(right.skillName)
      || left.invocationContentHash.localeCompare(right.invocationContentHash)
      || left.workspaceId.localeCompare(right.workspaceId)).slice(0, maxOpportunities)
  }
}

type ExactContentCorrection = FeedbackSignal & {
  readonly attribution: NonNullable<FeedbackSignal['attribution']> & {
    readonly invocationContentHash: string
  }
}

function isExactContentCorrection(signal: FeedbackSignal): signal is ExactContentCorrection {
  return signal.attribution?.kind === 'exact-skill-invocation-v1'
    && typeof signal.attribution.invocationContentHash === 'string'
    && /^[a-f0-9]{64}$/u.test(signal.attribution.invocationContentHash)
}

interface AttributionIndex {
  readonly goalSkills: ReadonlyMap<string, ReadonlySet<string>>
  readonly goalSkillGaps: ReadonlyMap<string, readonly GoalGapRef[]>
}

interface GoalGapRef {
  readonly revision: number
  readonly observedAt: number
}

function buildAttributionIndex(
  gaps: readonly CapabilityGap[],
): AttributionIndex {
  const goalSkills = new Map<string, Set<string>>()
  const goalSkillGaps = new Map<string, GoalGapRef[]>()
  for (const gap of gaps) {
    if (gap.goal !== undefined) {
      addSkill(
        goalSkills,
        goalKey(gap.workspaceId, gap.goal.id),
        gap.requestedSkill,
      )
      const key = goalSkillKey(gap.workspaceId, gap.goal.id, gap.requestedSkill)
      const refs = goalSkillGaps.get(key) ?? []
      refs.push({ revision: gap.goal.revision, observedAt: gap.observedAt })
      goalSkillGaps.set(key, refs)
    }
  }
  return { goalSkills, goalSkillGaps }
}

function opportunityEvidence(
  workspaceId: string,
  skillName: string,
  attribution: AttributionIndex,
  feedback: readonly FeedbackSignal[],
  outcomes: readonly DeliveryOutcome[],
): SkillOpportunityEvidence {
  const exactFeedback = uniqueById(feedback.filter((signal) => {
    if (signal.workspaceId !== workspaceId) return false
    return signal.attribution?.kind === 'exact-skill-invocation-v1'
      && signal.attribution.skillName === skillName
  })).sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt || left.id.localeCompare(right.id))

  const exactOutcomes = uniqueById(outcomes.filter((outcome) => {
    if (outcome.workspaceId !== workspaceId) return false
    const skills = attribution.goalSkills.get(goalKey(workspaceId, outcome.goal.id))
    const gaps = attribution.goalSkillGaps.get(goalSkillKey(workspaceId, outcome.goal.id, skillName))
    return skills?.size === 1
      && skills.has(skillName)
      && gaps?.some(gap => outcome.observedAt >= gap.observedAt
        && outcome.goal.revision >= gap.revision) === true
  })).sort((left, right) => left.observedAt - right.observedAt || left.id.localeCompare(right.id))

  const correctionIds = referenceIds(exactFeedback)
  const correctionGoalCount = new Set(exactFeedback.map(signal => signal.attribution!.goal.id)).size
  const outcomeIds = referenceIds(exactOutcomes)
  const counts = { passed: 0, failed: 0, unknown: 0 }
  for (const outcome of exactOutcomes) counts[outcome.status] += 1
  return Object.freeze({
    kind: 'internal-experience-v3',
    eligibilityBasis: 'two-or-more-distinct-goals',
    correctionSignals: Object.freeze({
      association: 'exact-durable-skill-invocation',
      count: exactFeedback.length,
      goalCount: correctionGoalCount,
      ids: correctionIds,
      referencesTruncated: exactFeedback.length > correctionIds.length,
    }),
    deliveryOutcomes: Object.freeze({
      association: 'same-goal-single-skill-gap',
      total: exactOutcomes.length,
      ...counts,
      ids: outcomeIds,
      referencesTruncated: exactOutcomes.length > outcomeIds.length,
    }),
    causalClaim: 'none',
  })
}

function uniqueById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map(value => [value.id, value])).values()]
}

function referenceIds(values: ReadonlyArray<{ readonly id: string }>): readonly string[] {
  return Object.freeze(values.slice(-MAX_EVIDENCE_REFERENCES).map(value => value.id))
}

function addSkill(target: Map<string, Set<string>>, key: string, skill: string): void {
  const skills = target.get(key) ?? new Set<string>()
  skills.add(skill)
  target.set(key, skills)
}

function goalKey(workspaceId: string, goalId: string): string {
  return `${workspaceId}\0${goalId}`
}

function goalSkillKey(
  workspaceId: string,
  goalId: string,
  skillName: string,
): string {
  return `${goalKey(workspaceId, goalId)}\0${skillName}`
}

function opportunityId(workspaceId: string, skillName: string): string {
  return createHash('sha256').update(JSON.stringify([
    'evoforge-skill-opportunity-v1',
    workspaceId,
    skillName,
  ])).digest('hex')
}

function improvementKey(workspaceId: string, skillName: string, contentHash: string): string {
  return `${workspaceId}\0${skillName}\0${contentHash}`
}

function improvementOpportunityId(
  workspaceId: string,
  skillName: string,
  contentHash: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    'evoforge-skill-improvement-opportunity-v1',
    workspaceId,
    skillName,
    contentHash,
  ])).digest('hex')
}
