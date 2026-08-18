import { createHash } from 'node:crypto'
import type { CapabilityGap, CapabilityGapStore } from './capability-gap-store.ts'

const DEFAULT_MAX_OPPORTUNITIES = 20

export interface SkillOpportunity {
  readonly schemaVersion: 1
  readonly id: string
  readonly workspaceId: string
  readonly skillName: string
  readonly gapIds: readonly string[]
  readonly goalIds: readonly string[]
  readonly gapCount: number
  readonly goalCount: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly evidence: 'repeated-goal-capability-gap'
  readonly status: 'eligible-for-authoring'
  readonly releaseAuthority: 'none'
}

/**
 * Derive reusable Skill opportunities only from durable DSH experience.
 * Callers may scope by Workspace, but cannot provide a Skill name, path,
 * source, Agent, or workflow choice.
 */
export class ExperienceDrivenSkillOpportunityDiscovery {
  private readonly gaps: Pick<CapabilityGapStore, 'list'>
  private readonly options: { readonly maxOpportunities?: number }

  constructor(
    gaps: Pick<CapabilityGapStore, 'list'>,
    options: { readonly maxOpportunities?: number } = {},
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
      if (gap.goal !== undefined && !uniqueGaps.has(gap.id)) uniqueGaps.set(gap.id, gap)
    }

    const groups = new Map<string, Array<CapabilityGap & { readonly goal: NonNullable<CapabilityGap['goal']> }>>()
    for (const gap of uniqueGaps.values()) {
      const withGoal = gap as CapabilityGap & { readonly goal: NonNullable<CapabilityGap['goal']> }
      const key = `${gap.workspaceId}\0${gap.requestedSkill}`
      const values = groups.get(key) ?? []
      values.push(withGoal)
      groups.set(key, values)
    }

    const opportunities: SkillOpportunity[] = []
    for (const values of groups.values()) {
      const goalIds = [...new Set(values.map(gap => gap.goal.id))].sort()
      if (goalIds.length < 2) continue
      const sorted = [...values].sort((left, right) =>
        left.observedAt - right.observedAt || left.id.localeCompare(right.id))
      const first = sorted[0]!
      opportunities.push(Object.freeze({
        schemaVersion: 1,
        id: opportunityId(first.workspaceId, first.requestedSkill),
        workspaceId: first.workspaceId,
        skillName: first.requestedSkill,
        gapIds: Object.freeze(sorted.map(gap => gap.id).sort()),
        goalIds: Object.freeze(goalIds),
        gapCount: sorted.length,
        goalCount: goalIds.length,
        firstObservedAt: first.observedAt,
        lastObservedAt: sorted.at(-1)!.observedAt,
        evidence: 'repeated-goal-capability-gap',
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
}

function opportunityId(workspaceId: string, skillName: string): string {
  return createHash('sha256').update(JSON.stringify([
    'evoforge-skill-opportunity-v1',
    workspaceId,
    skillName,
  ])).digest('hex')
}
