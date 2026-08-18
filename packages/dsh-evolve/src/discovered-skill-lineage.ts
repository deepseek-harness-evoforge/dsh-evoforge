import type { DiscoveredSkillAdmissionResult } from './discovered-skill-admission.ts'
import type { DiscoveredSkillCandidate } from './trusted-skill-discovery.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type DiscoveredSkillVersionKind = DiscoveredSkillCandidate['version']['kind']

export type DiscoveredSkillSourceLineage =
  | { readonly id: string; readonly kind: 'local-git'; readonly trust: 'explicit-deployer-config' }
  | { readonly id: string; readonly kind: 'agent-skills-index'; readonly trust: 'explicit-deployer-config' }
  | { readonly id: string; readonly kind: 'slow-loop-author'; readonly trust: 'bounded-host-authoring' }

interface DiscoveredSkillLineageBase {
  readonly kind: 'discovered-skill-lineage-v1'
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly source: DiscoveredSkillSourceLineage
  readonly contentHash: string
  readonly candidateTreeHash: string
  readonly admissionId: string
  readonly admissionTargetId: string
  readonly releaseAuthority: 'none'
}

export type DiscoveredSkillLineage = DiscoveredSkillLineageBase & (
  | {
      readonly versionKind:
        | 'git-tree'
        | 'agent-skills-index-v0.2'
        | 'slow-loop-author-v1'
        | 'slow-loop-author-bundle-v1'
      readonly research?: never
    }
  | {
      readonly versionKind: 'slow-loop-research-bundle-v2'
      readonly research: {
        readonly researchDigest: string
        readonly researchHoldoutResultId: string
      }
    }
  | {
      readonly versionKind: 'slow-loop-research-revision-v3'
      readonly research: {
        readonly researchDigest: string
        readonly parentCandidateId: string
        readonly parentTreeHash: string
        readonly revisionHoldoutResultId: string
        readonly researchHoldoutResultId: string
      }
    }
)

/**
 * Build the bounded public identity that follows one exact discovery Candidate.
 * Skill bodies, host paths, source origins, author/evaluator identities and
 * research findings deliberately remain outside this durable lineage.
 */
export function createDiscoveredSkillLineage(
  candidate: DiscoveredSkillCandidate,
  admission: DiscoveredSkillAdmissionResult,
): DiscoveredSkillLineage {
  if (admission.status !== 'qualified-for-shadow'
    || admission.candidateId !== candidate.id
    || admission.workspaceId !== candidate.workspaceId
    || admission.skillName !== candidate.requestedSkill
    || admission.targetId === undefined
    || admission.evidence === undefined
    || admission.evidence.candidate !== 'pass') {
    throw new Error('qualified admission cannot produce exact discovered Skill lineage')
  }
  const base = {
    kind: 'discovered-skill-lineage-v1' as const,
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.requestedSkill,
    versionKind: candidate.version.kind,
    source: {
      id: candidate.source.id,
      kind: candidate.source.kind,
      trust: candidate.source.trust,
    },
    contentHash: candidate.contentHash,
    candidateTreeHash: admission.evidence.candidateTreeHash,
    admissionId: admission.id,
    admissionTargetId: admission.targetId,
    releaseAuthority: 'none' as const,
  }
  if (candidate.version.kind === 'slow-loop-research-bundle-v2') {
    if (admission.researchHoldoutResultId === undefined
      || admission.evidence.candidateTreeHash !== candidate.version.treeHash) {
      throw new Error('research Candidate lineage requires its exact passing Holdout tree')
    }
    return parseDiscoveredSkillLineage({
      ...base,
      research: {
        researchDigest: candidate.version.researchDigest,
        researchHoldoutResultId: admission.researchHoldoutResultId,
      },
    })
  }
  if (candidate.version.kind === 'slow-loop-research-revision-v3') {
    if (admission.researchHoldoutResultId === undefined
      || admission.researchHoldoutResultId === candidate.version.holdoutResultId
      || admission.evidence.candidateTreeHash !== candidate.version.treeHash) {
      throw new Error('research revision lineage requires distinct failed and passing Holdout trees')
    }
    return parseDiscoveredSkillLineage({
      ...base,
      research: {
        researchDigest: candidate.version.researchDigest,
        parentCandidateId: candidate.version.parentCandidateId,
        parentTreeHash: candidate.version.parentTreeHash,
        revisionHoldoutResultId: candidate.version.holdoutResultId,
        researchHoldoutResultId: admission.researchHoldoutResultId,
      },
    })
  }
  if (admission.researchHoldoutResultId !== undefined) {
    throw new Error('non-research Candidate lineage cannot carry a research Holdout result')
  }
  return parseDiscoveredSkillLineage(base)
}

/** Strict reader for untrusted durable journal/report JSON. */
export function parseDiscoveredSkillLineage(value: unknown): DiscoveredSkillLineage {
  try {
    if (!isRecord(value)) throw new Error()
    assertKeys(value, [
      'kind',
      'candidateId',
      'workspaceId',
      'skillName',
      'versionKind',
      'source',
      'contentHash',
      'candidateTreeHash',
      'admissionId',
      'admissionTargetId',
      'research',
      'releaseAuthority',
    ])
    if (value.kind !== 'discovered-skill-lineage-v1'
      || !contentId(value.candidateId)
      || typeof value.workspaceId !== 'string'
      || !WORKSPACE_ID.test(value.workspaceId)
      || typeof value.skillName !== 'string'
      || !PUBLIC_ID.test(value.skillName)
      || !VERSION_KINDS.has(String(value.versionKind))
      || !contentId(value.contentHash)
      || !contentId(value.candidateTreeHash)
      || !contentId(value.admissionId)
      || typeof value.admissionTargetId !== 'string'
      || !PUBLIC_ID.test(value.admissionTargetId)
      || value.releaseAuthority !== 'none') throw new Error()
    const source = parseSource(value.source)
    assertVersionSource(String(value.versionKind), source.kind)
    const versionKind = value.versionKind as DiscoveredSkillVersionKind
    let research: DiscoveredSkillLineage['research']
    if (versionKind === 'slow-loop-research-bundle-v2') {
      research = parseResearchBundle(value.research)
    } else if (versionKind === 'slow-loop-research-revision-v3') {
      const revisionResearch = parseResearchRevision(value.research)
      if (revisionResearch.revisionHoldoutResultId === revisionResearch.researchHoldoutResultId) throw new Error()
      research = revisionResearch
    } else if (value.research !== undefined) {
      throw new Error()
    }
    const parsed = {
      kind: 'discovered-skill-lineage-v1' as const,
      candidateId: value.candidateId as string,
      workspaceId: value.workspaceId,
      skillName: value.skillName,
      versionKind,
      source,
      contentHash: value.contentHash as string,
      candidateTreeHash: value.candidateTreeHash as string,
      admissionId: value.admissionId as string,
      admissionTargetId: value.admissionTargetId,
      ...(research === undefined ? {} : { research }),
      releaseAuthority: 'none' as const,
    }
    return Object.freeze(parsed) as DiscoveredSkillLineage
  } catch {
    throw new Error('invalid discovered Skill lineage')
  }
}

function parseSource(value: unknown): DiscoveredSkillSourceLineage {
  if (!isRecord(value)) throw new Error()
  assertKeys(value, ['id', 'kind', 'trust'])
  if (typeof value.id !== 'string' || !PUBLIC_ID.test(value.id)) throw new Error()
  if (value.kind === 'local-git' && value.trust === 'explicit-deployer-config') {
    return Object.freeze({ id: value.id, kind: value.kind, trust: value.trust })
  }
  if (value.kind === 'agent-skills-index' && value.trust === 'explicit-deployer-config') {
    return Object.freeze({ id: value.id, kind: value.kind, trust: value.trust })
  }
  if (value.kind === 'slow-loop-author' && value.trust === 'bounded-host-authoring') {
    return Object.freeze({ id: value.id, kind: value.kind, trust: value.trust })
  }
  throw new Error()
}

function parseResearchBundle(value: unknown): {
  readonly researchDigest: string
  readonly researchHoldoutResultId: string
} {
  if (!isRecord(value)) throw new Error()
  assertKeys(value, ['researchDigest', 'researchHoldoutResultId'])
  if (!contentId(value.researchDigest) || !contentId(value.researchHoldoutResultId)) throw new Error()
  return Object.freeze({
    researchDigest: value.researchDigest,
    researchHoldoutResultId: value.researchHoldoutResultId,
  })
}

function parseResearchRevision(value: unknown): {
  readonly researchDigest: string
  readonly parentCandidateId: string
  readonly parentTreeHash: string
  readonly revisionHoldoutResultId: string
  readonly researchHoldoutResultId: string
} {
  if (!isRecord(value)) throw new Error()
  assertKeys(value, [
    'researchDigest',
    'parentCandidateId',
    'parentTreeHash',
    'revisionHoldoutResultId',
    'researchHoldoutResultId',
  ])
  if (!contentId(value.researchDigest)
    || !contentId(value.parentCandidateId)
    || !contentId(value.parentTreeHash)
    || !contentId(value.revisionHoldoutResultId)
    || !contentId(value.researchHoldoutResultId)) throw new Error()
  return Object.freeze({
    researchDigest: value.researchDigest,
    parentCandidateId: value.parentCandidateId,
    parentTreeHash: value.parentTreeHash,
    revisionHoldoutResultId: value.revisionHoldoutResultId,
    researchHoldoutResultId: value.researchHoldoutResultId,
  })
}

function assertVersionSource(versionKind: string, sourceKind: DiscoveredSkillSourceLineage['kind']): void {
  const expected = versionKind === 'git-tree'
    ? 'local-git'
    : versionKind === 'agent-skills-index-v0.2'
      ? 'agent-skills-index'
      : 'slow-loop-author'
  if (sourceKind !== expected) throw new Error()
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const permitted = new Set(allowed)
  if (Object.keys(value).some(key => !permitted.has(key))) throw new Error()
}

function contentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VERSION_KINDS = new Set<string>([
  'git-tree',
  'agent-skills-index-v0.2',
  'slow-loop-author-v1',
  'slow-loop-author-bundle-v1',
  'slow-loop-research-bundle-v2',
  'slow-loop-research-revision-v3',
])
