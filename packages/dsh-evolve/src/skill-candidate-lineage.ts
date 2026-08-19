import type { SkillCandidateAdmissionResult } from './skill-candidate-admission.ts'
import type { ExperienceSkillCandidate } from './skill-candidate-repository.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type SkillCandidateVersionKind = 'experience-authored-bundle-v1'

/** Durable identity of one internally discovered, independently admitted Candidate. */
export interface SkillCandidateLineage {
  readonly kind: 'internal-skill-candidate-lineage-v1'
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly policyId: string
  readonly versionKind: SkillCandidateVersionKind
  readonly contentHash: string
  readonly candidateTreeHash: string
  readonly admissionId: string
  readonly admissionTargetId: string
  readonly releaseAuthority: 'none'
}

export function createSkillCandidateLineage(
  candidate: ExperienceSkillCandidate,
  admission: SkillCandidateAdmissionResult,
): SkillCandidateLineage {
  if (admission.status !== 'qualified-for-shadow'
    || admission.candidateId !== candidate.id
    || admission.workspaceId !== candidate.workspaceId
    || admission.skillName !== candidate.skillName
    || admission.targetId === undefined
    || admission.evidence === undefined
    || admission.evidence.candidate !== 'pass'
    || admission.evidence.candidateTreeHash !== candidate.version.treeHash) {
    throw new Error('qualified admission cannot produce exact internal Skill Candidate lineage')
  }
  return parseSkillCandidateLineage({
    kind: 'internal-skill-candidate-lineage-v1',
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    policyId: candidate.authorship.policyId,
    versionKind: candidate.version.kind,
    contentHash: candidate.contentHash,
    candidateTreeHash: admission.evidence.candidateTreeHash,
    admissionId: admission.id,
    admissionTargetId: admission.targetId,
    releaseAuthority: 'none',
  })
}

/** Strict reader for untrusted durable journal/report JSON. */
export function parseSkillCandidateLineage(value: unknown): SkillCandidateLineage {
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== [
      'admissionId',
      'admissionTargetId',
      'candidateId',
      'candidateTreeHash',
      'contentHash',
      'kind',
      'opportunityId',
      'policyId',
      'releaseAuthority',
      'skillName',
      'versionKind',
      'workspaceId',
    ].join(',')
    || value.kind !== 'internal-skill-candidate-lineage-v1'
    || !contentId(value.candidateId)
    || typeof value.workspaceId !== 'string'
    || !WORKSPACE_ID.test(value.workspaceId)
    || typeof value.skillName !== 'string'
    || !PUBLIC_ID.test(value.skillName)
    || !contentId(value.opportunityId)
    || typeof value.policyId !== 'string'
    || !PUBLIC_ID.test(value.policyId)
    || value.versionKind !== 'experience-authored-bundle-v1'
    || !contentId(value.contentHash)
    || !contentId(value.candidateTreeHash)
    || !contentId(value.admissionId)
    || typeof value.admissionTargetId !== 'string'
    || !PUBLIC_ID.test(value.admissionTargetId)
    || value.releaseAuthority !== 'none') {
    throw new Error('invalid internal Skill Candidate lineage')
  }
  return Object.freeze({
    kind: value.kind,
    candidateId: value.candidateId,
    workspaceId: value.workspaceId,
    skillName: value.skillName,
    opportunityId: value.opportunityId,
    policyId: value.policyId,
    versionKind: value.versionKind,
    contentHash: value.contentHash,
    candidateTreeHash: value.candidateTreeHash,
    admissionId: value.admissionId,
    admissionTargetId: value.admissionTargetId,
    releaseAuthority: value.releaseAuthority,
  })
}

function contentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
