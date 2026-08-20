import { createHash } from 'node:crypto'
import type { FeedbackSignal, FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type {
  InstalledSkillBaselineManifest,
  InstalledSkillBaselineVault,
  ResolvedInstalledSkillBaseline,
} from './installed-skill-baseline.ts'
import type {
  ExperienceDrivenSkillOpportunityDiscovery,
  SkillImprovementOpportunity,
} from './skill-opportunity-discovery.ts'

const MAX_INVOCATIONS_PER_QUALIFICATION = 100

export interface ExistingSkillBaselineQualificationEvidence {
  readonly kind: 'exact-correction-invocation-baselines-v1'
  readonly feedbackSignalIds: readonly string[]
  readonly goalIds: readonly string[]
  readonly invocationCount: number
  readonly goalCount: number
}

export interface ExistingSkillBaselineQualificationManifest {
  readonly schemaVersion: 1
  readonly kind: 'existing-skill-baseline-qualification-v1'
  readonly id: string
  readonly opportunityId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly invocationContentHash: string
  readonly baseline: {
    readonly id: string
    readonly provider: string
    readonly source: string
    readonly definitionDigest: string
    readonly artifactDigest: string
    readonly treeHash: string
    readonly fileCount: number
    readonly totalBytes: number
  }
  readonly evidence: ExistingSkillBaselineQualificationEvidence
  readonly status: 'eligible-for-existing-skill-authoring'
  readonly releaseAuthority: 'none'
}

export type ExistingSkillBaselineQualificationResult =
  | {
      readonly status: 'qualified'
      readonly qualification: ExistingSkillBaselineQualificationManifest
      readonly baseline: ResolvedInstalledSkillBaseline
    }
  | {
      readonly status: 'waiting'
      readonly reason: 'invocation-baseline-missing' | 'evidence-over-limit'
      readonly observedInvocationCount: number
      readonly releaseAuthority: 'none'
    }
  | {
      readonly status: 'invalid'
      readonly reason:
        | 'opportunity-evidence-drift'
        | 'invocation-baseline-corrupt'
        | 'invocation-baseline-mismatch'
        | 'baseline-bundle-conflict'
      readonly releaseAuthority: 'none'
    }

/**
 * Join one current correction-derived investigation to the exact immutable
 * installed Bundle used by every attributed invocation. No Candidate is
 * exposed until this Host-owned qualification succeeds.
 */
export class ExistingSkillBaselineQualification {
  private readonly opportunities: Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discoverImprovements'>
  private readonly feedback: Pick<FeedbackSignalStore, 'list'>
  private readonly baselines: Pick<InstalledSkillBaselineVault, 'resolveInvocation'>

  constructor(
    opportunities: Pick<ExperienceDrivenSkillOpportunityDiscovery, 'discoverImprovements'>,
    feedback: Pick<FeedbackSignalStore, 'list'>,
    baselines: Pick<InstalledSkillBaselineVault, 'resolveInvocation'>,
  ) {
    this.opportunities = opportunities
    this.feedback = feedback
    this.baselines = baselines
  }

  async qualify(
    opportunity: SkillImprovementOpportunity,
  ): Promise<ExistingSkillBaselineQualificationResult> {
    const current = this.opportunities.discoverImprovements(opportunity.workspaceId)
      .find(candidate => candidate.id === opportunity.id)
    if (current === undefined || canonicalJson(current) !== canonicalJson(opportunity)) {
      return invalid('opportunity-evidence-drift')
    }

    const signals = exactSignals(this.feedback.list(opportunity.workspaceId), opportunity)
    if (!matchesOpportunitySnapshot(signals, opportunity)) {
      return invalid('opportunity-evidence-drift')
    }
    if (signals.length > MAX_INVOCATIONS_PER_QUALIFICATION) {
      return waiting('evidence-over-limit', signals.length)
    }

    const resolved: ResolvedInstalledSkillBaseline[] = []
    for (const signal of signals) {
      const attribution = signal.attribution
      if (attribution === undefined) return invalid('opportunity-evidence-drift')
      let baseline: ResolvedInstalledSkillBaseline | undefined
      try {
        baseline = await this.baselines.resolveInvocation(
          signal.workspaceId,
          signal.sessionId,
          attribution.invocationSeq,
        )
      } catch {
        return invalid('invocation-baseline-corrupt')
      }
      if (baseline === undefined) {
        return waiting('invocation-baseline-missing', signals.length)
      }
      if (!matchesInvocation(baseline, signal, opportunity)) {
        return invalid('invocation-baseline-mismatch')
      }
      resolved.push(baseline)
    }

    const first = resolved[0]
    if (first === undefined) return invalid('opportunity-evidence-drift')
    if (resolved.some(candidate => candidate.manifest.id !== first.manifest.id)) {
      return invalid('baseline-bundle-conflict')
    }
    const evidence: ExistingSkillBaselineQualificationEvidence = Object.freeze({
      kind: 'exact-correction-invocation-baselines-v1',
      feedbackSignalIds: Object.freeze(signals.map(signal => signal.id)),
      goalIds: Object.freeze([...new Set(signals.map(signal => signal.attribution!.goal.id))].sort()),
      invocationCount: signals.length,
      goalCount: opportunity.goalCount,
    })
    const baseline = projectBaseline(first.manifest)
    const identity = Object.freeze({
      schemaVersion: 1,
      kind: 'existing-skill-baseline-qualification-v1',
      opportunity: current,
      baseline,
      evidence,
    })
    const qualification: ExistingSkillBaselineQualificationManifest = Object.freeze({
      schemaVersion: 1,
      kind: 'existing-skill-baseline-qualification-v1',
      id: sha256(canonicalJson(identity)),
      opportunityId: opportunity.id,
      workspaceId: opportunity.workspaceId,
      skillName: opportunity.skillName,
      invocationContentHash: opportunity.invocationContentHash,
      baseline,
      evidence,
      status: 'eligible-for-existing-skill-authoring',
      releaseAuthority: 'none',
    })
    return Object.freeze({ status: 'qualified', qualification, baseline: first })
  }
}

type ExactImprovementSignal = FeedbackSignal & {
  readonly attribution: NonNullable<FeedbackSignal['attribution']> & {
    readonly invocationContentHash: string
  }
}

function exactSignals(
  values: readonly FeedbackSignal[],
  opportunity: SkillImprovementOpportunity,
): ExactImprovementSignal[] {
  return [...new Map(values.map(value => [value.id, value])).values()]
    .filter((signal): signal is ExactImprovementSignal =>
      signal.workspaceId === opportunity.workspaceId
      && signal.attribution?.kind === 'exact-skill-invocation-v1'
      && signal.attribution.skillName === opportunity.skillName
      && signal.attribution.invocationContentHash === opportunity.invocationContentHash)
    .sort((left, right) => left.sourceUpdatedAt - right.sourceUpdatedAt
      || left.id.localeCompare(right.id))
}

function matchesOpportunitySnapshot(
  signals: readonly ExactImprovementSignal[],
  opportunity: SkillImprovementOpportunity,
): boolean {
  if (signals.length !== opportunity.signalCount || signals.length < 2) return false
  const goalIds = [...new Set(signals.map(signal => signal.attribution.goal.id))].sort()
  const referencedSignals = signals.slice(-opportunity.feedbackSignalIds.length).map(signal => signal.id)
  const referencedGoals = goalIds.slice(-opportunity.goalIds.length)
  return goalIds.length === opportunity.goalCount
    && signals[0]!.sourceUpdatedAt === opportunity.firstObservedAt
    && signals.at(-1)!.sourceUpdatedAt === opportunity.lastObservedAt
    && canonicalJson(referencedSignals) === canonicalJson(opportunity.feedbackSignalIds)
    && canonicalJson(referencedGoals) === canonicalJson(opportunity.goalIds)
    && opportunity.evidence.referencesTruncated === (
      signals.length > opportunity.feedbackSignalIds.length
      || goalIds.length > opportunity.goalIds.length
    )
}

function matchesInvocation(
  baseline: ResolvedInstalledSkillBaseline,
  signal: ExactImprovementSignal,
  opportunity: SkillImprovementOpportunity,
): boolean {
  const attribution = signal.attribution
  return baseline.reference.workspaceId === signal.workspaceId
    && baseline.reference.sessionId === signal.sessionId
    && baseline.reference.invocationSeq === attribution.invocationSeq
    && baseline.reference.route === attribution.route
    && baseline.reference.skillName === opportunity.skillName
    && baseline.reference.invocationContentHash === opportunity.invocationContentHash
    && baseline.manifest.workspaceId === opportunity.workspaceId
    && baseline.manifest.skillName === opportunity.skillName
    && baseline.manifest.invocationContentHash === opportunity.invocationContentHash
}

function projectBaseline(
  manifest: InstalledSkillBaselineManifest,
): ExistingSkillBaselineQualificationManifest['baseline'] {
  return Object.freeze({
    id: manifest.id,
    provider: manifest.provider,
    source: manifest.source,
    definitionDigest: manifest.definitionDigest,
    artifactDigest: manifest.bundle.artifactDigest,
    treeHash: manifest.bundle.treeHash,
    fileCount: manifest.bundle.fileCount,
    totalBytes: manifest.bundle.totalBytes,
  })
}

function waiting(
  reason: Extract<ExistingSkillBaselineQualificationResult, { status: 'waiting' }>['reason'],
  observedInvocationCount: number,
): ExistingSkillBaselineQualificationResult {
  return Object.freeze({ status: 'waiting', reason, observedInvocationCount, releaseAuthority: 'none' })
}

function invalid(
  reason: Extract<ExistingSkillBaselineQualificationResult, { status: 'invalid' }>['reason'],
): ExistingSkillBaselineQualificationResult {
  return Object.freeze({ status: 'invalid', reason, releaseAuthority: 'none' })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}
