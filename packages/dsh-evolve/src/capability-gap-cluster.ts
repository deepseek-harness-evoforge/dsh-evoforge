import { createHash } from 'node:crypto'
import type { CapabilityGap } from './capability-gap-store.ts'
import type { DiscoveredSkillCandidate } from './trusted-skill-discovery.ts'

const DEFAULT_MAX_CLUSTERS = 20

export interface CapabilityGapCluster {
  readonly id: string
  readonly workspaceId: string
  readonly canonicalSkill: string
  readonly resolvedSkill?: string
  readonly requestedSkills: readonly string[]
  readonly gapIds: readonly string[]
  readonly gapCount: number
  readonly goalCount: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly evidence: 'repeated-skill-demand' | 'shared-resolved-candidate'
  readonly status: 'evidence-only'
  readonly releaseAuthority: 'none'
}

interface ResolvedCandidate {
  readonly identity: string
  readonly skill: string
}

interface ClusterMember {
  readonly gap: CapabilityGap & { readonly goal: NonNullable<CapabilityGap['goal']> }
  readonly resolved?: ResolvedCandidate
}

/**
 * Derive recurring demand from durable Gap evidence without fuzzy-merging unmet requests.
 * Different requested names converge only after discovery independently resolves them to
 * one quarantined Skill identity. Conflicting candidates exclude that Gap fail closed.
 */
export function clusterCapabilityGaps(
  gaps: readonly CapabilityGap[],
  candidates: readonly Pick<
    DiscoveredSkillCandidate,
    'gapId' | 'workspaceId' | 'requestedSkill' | 'source' | 'version' | 'contentHash'
  >[],
  options: { readonly maxClusters?: number } = {},
): CapabilityGapCluster[] {
  const maxClusters = options.maxClusters ?? DEFAULT_MAX_CLUSTERS
  if (!Number.isInteger(maxClusters) || maxClusters < 1) {
    throw new Error('Capability Gap maxClusters must be a positive integer')
  }

  const candidatesByGap = new Map<string, Map<string, ResolvedCandidate>>()
  for (const candidate of candidates) {
    const key = `${candidate.workspaceId}\0${candidate.gapId}`
    const identities = candidatesByGap.get(key) ?? new Map<string, ResolvedCandidate>()
    const identity = candidateIdentity(candidate)
    identities.set(identity, { identity, skill: candidate.requestedSkill })
    candidatesByGap.set(key, identities)
  }

  const uniqueGaps = new Map<string, CapabilityGap>()
  for (const gap of gaps) if (!uniqueGaps.has(gap.id)) uniqueGaps.set(gap.id, gap)
  const members: ClusterMember[] = []
  for (const gap of uniqueGaps.values()) {
    if (gap.goal === undefined) continue
    const resolvedCandidates = candidatesByGap.get(`${gap.workspaceId}\0${gap.id}`)
    if (resolvedCandidates !== undefined && resolvedCandidates.size > 1) continue
    const resolved = resolvedCandidates === undefined ? undefined : [...resolvedCandidates.values()][0]
    members.push({
      gap: gap as ClusterMember['gap'],
      ...(resolved === undefined ? {} : { resolved }),
    })
  }

  const clusters: CapabilityGapCluster[] = []
  const assigned = new Set<string>()
  const requestedGroups = groupMembers(members, member =>
    `${member.gap.workspaceId}\0${member.gap.requestedSkill}`)
  for (const requestedMembers of requestedGroups.values()) {
    const goals = new Set(requestedMembers.map(member => member.gap.goal.id))
    if (goals.size < 2) continue
    for (const member of requestedMembers) assigned.add(member.gap.id)
    clusters.push(buildCluster(
      requestedMembers,
      'requested-skill',
      requestedMembers[0]!.gap.requestedSkill,
      requestedMembers[0]!.gap.requestedSkill,
    ))
  }

  const resolvedGroups = groupMembers(
    members.filter(member => !assigned.has(member.gap.id) && member.resolved !== undefined),
    member => `${member.gap.workspaceId}\0${member.resolved!.identity}`,
  )
  for (const resolvedMembers of resolvedGroups.values()) {
    const goals = new Set(resolvedMembers.map(member => member.gap.goal.id))
    if (goals.size < 2) continue
    const resolved = resolvedMembers[0]!.resolved!
    clusters.push(buildCluster(
      resolvedMembers,
      'resolved-candidate',
      resolved.skill,
      resolved.identity,
    ))
  }
  return clusters.sort((left, right) =>
    right.goalCount - left.goalCount
    || right.gapCount - left.gapCount
    || right.lastObservedAt - left.lastObservedAt
    || left.canonicalSkill.localeCompare(right.canonicalSkill)
    || left.workspaceId.localeCompare(right.workspaceId)).slice(0, maxClusters)
}

function groupMembers(
  members: readonly ClusterMember[],
  keyOf: (member: ClusterMember) => string,
): Map<string, ClusterMember[]> {
  const groups = new Map<string, ClusterMember[]>()
  for (const member of members) {
    const key = keyOf(member)
    const values = groups.get(key) ?? []
    values.push(member)
    groups.set(key, values)
  }
  return groups
}

function buildCluster(
  members: readonly ClusterMember[],
  basis: 'requested-skill' | 'resolved-candidate',
  canonicalSkill: string,
  basisIdentity: string,
): CapabilityGapCluster {
  const sorted = [...members].sort((left, right) =>
    left.gap.observedAt - right.gap.observedAt || left.gap.id.localeCompare(right.gap.id))
  const workspaceId = sorted[0]!.gap.workspaceId
  const requestedSkills = [...new Set(sorted.map(member => member.gap.requestedSkill))].sort()
  return Object.freeze({
    id: clusterId(workspaceId, basis, basisIdentity),
    workspaceId,
    canonicalSkill,
    ...(basis === 'resolved-candidate' ? { resolvedSkill: canonicalSkill } : {}),
    requestedSkills: Object.freeze(requestedSkills),
    gapIds: Object.freeze(sorted.map(member => member.gap.id).sort()),
    gapCount: sorted.length,
    goalCount: new Set(sorted.map(member => member.gap.goal.id)).size,
    firstObservedAt: sorted[0]!.gap.observedAt,
    lastObservedAt: sorted.at(-1)!.gap.observedAt,
    evidence: basis === 'resolved-candidate'
      ? 'shared-resolved-candidate'
      : 'repeated-skill-demand',
    status: 'evidence-only',
    releaseAuthority: 'none',
  })
}

function candidateIdentity(candidate: Pick<
  DiscoveredSkillCandidate,
  'requestedSkill' | 'source' | 'version' | 'contentHash'
>): string {
  const versionIdentity = candidate.version.kind === 'git-tree'
    ? [candidate.version.commit, candidate.version.treeHash]
    : candidate.version.kind === 'agent-skills-index-v0.2'
      ? [
        candidate.version.indexDigest,
        candidate.version.artifactDigest,
        candidate.version.treeHash,
      ]
      : candidate.version.kind === 'slow-loop-research-bundle-v2'
        ? [
            candidate.version.modelIdentityHash,
            candidate.version.inputDigest,
            candidate.version.researchDigest,
            candidate.version.artifactDigest,
            candidate.version.treeHash,
          ]
        : candidate.version.kind === 'slow-loop-research-revision-v3'
          ? [
              String(candidate.version.revision),
              candidate.version.modelIdentityHash,
              candidate.version.inputDigest,
              candidate.version.researchDigest,
              candidate.version.parentCandidateId,
              candidate.version.parentTreeHash,
              candidate.version.holdoutResultId,
              candidate.version.artifactDigest,
              candidate.version.treeHash,
            ]
      : [
          candidate.version.modelIdentityHash,
          candidate.version.inputDigest,
          candidate.version.artifactDigest,
          candidate.version.treeHash,
        ]
  return JSON.stringify([
    candidate.requestedSkill,
    candidate.source.id,
    candidate.source.kind,
    candidate.version.kind,
    ...versionIdentity,
    candidate.contentHash,
  ])
}

function clusterId(
  workspaceId: string,
  basis: 'requested-skill' | 'resolved-candidate',
  basisIdentity: string,
): string {
  return createHash('sha256').update(JSON.stringify([
    'evoforge-capability-gap-cluster-v1',
    workspaceId,
    basis,
    basisIdentity,
  ])).digest('hex')
}
