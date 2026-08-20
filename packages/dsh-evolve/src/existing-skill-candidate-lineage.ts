import type { ExistingSkillCandidateAdmissionResult } from './existing-skill-candidate-admission.ts'
import type { ExistingSkillHoldoutEvaluationRunView } from './existing-skill-holdout-evaluation.ts'
import type { ExistingSkillRetentionEvaluationRunView } from './existing-skill-retention-evaluation.ts'
import type { ExistingSkillCandidate } from './skill-candidate-repository.ts'

const CONTENT_ID = /^[a-f0-9]{64}$/u
const PUBLIC_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** Exact immutable provenance for a released improvement of one installed Skill. */
export interface ExistingSkillCandidateLineage {
  readonly kind: 'existing-skill-candidate-lineage-v1'
  readonly candidateId: string
  readonly workspaceId: string
  readonly skillName: string
  readonly opportunityId: string
  readonly qualificationId: string
  readonly baselineId: string
  readonly baselineArtifactDigest: string
  readonly baselineTreeHash: string
  readonly evaluationEvidenceId: string
  readonly policyId: string
  readonly versionKind: 'existing-skill-improvement-bundle-v1'
  readonly contentHash: string
  readonly candidateTreeHash: string
  readonly admissionId: string
  readonly evaluationEnvelopeId: string
  readonly holdoutEvaluationId: string
  readonly holdoutCasePackHash: string
  readonly retentionEvaluationId: string
  readonly retentionCasePackHash: string
  readonly releaseAuthority: 'none'
}

export function createExistingSkillCandidateLineage(
  candidate: ExistingSkillCandidate,
  admission: ExistingSkillCandidateAdmissionResult,
  holdout: ExistingSkillHoldoutEvaluationRunView,
  retention: ExistingSkillRetentionEvaluationRunView,
): ExistingSkillCandidateLineage {
  const admissionEvidence = admission.evidence
  const holdoutEvidence = holdout.evidence
  const retentionEvidence = retention.evidence
  if (candidate.releaseAuthority !== 'none'
    || admission.status !== 'qualified-for-holdout'
    || admission.releaseAuthority !== 'none'
    || admission.reasons.length !== 1
    || admission.reasons[0] !== 'exact-paired-subjects-admitted'
    || admissionEvidence === undefined
    || admissionEvidence.baselineId !== candidate.baseline.id
    || admissionEvidence.baselineArtifactDigest !== candidate.baseline.artifactDigest
    || admissionEvidence.baselineTreeHash !== candidate.baseline.treeHash
    || admissionEvidence.candidateArtifactDigest !== candidate.version.artifactDigest
    || admissionEvidence.candidateTreeHash !== candidate.version.treeHash
    || admissionEvidence.evaluationEvidenceId !== candidate.authorship.evaluationEvidenceId
    || admissionEvidence.candidateExecuted !== false
    || admissionEvidence.evaluatorClass !== 'host-structural'
    || holdout.status !== 'complete'
    || holdout.verdict !== 'improved'
    || holdout.reason !== 'candidate-passed-protected-holdout'
    || holdout.releaseAuthority !== 'none'
    || holdoutEvidence === undefined
    || !isPassingEvidence(holdoutEvidence, candidate)
    || retention.status !== 'complete'
    || retention.verdict !== 'retained'
    || retention.reason !== 'candidate-passed-protected-retention'
    || retention.releaseAuthority !== 'none'
    || retentionEvidence === undefined
    || !isPassingEvidence(retentionEvidence, candidate)
    || retentionEvidence.holdoutCasePackHash !== holdout.casePackHash
    || retention.holdoutCasePackHash !== holdout.casePackHash
    || candidate.id !== admission.candidateId
    || candidate.id !== holdout.candidateId
    || candidate.id !== retention.candidateId
    || candidate.workspaceId !== admission.workspaceId
    || candidate.workspaceId !== holdout.workspaceId
    || candidate.workspaceId !== retention.workspaceId
    || candidate.skillName !== admission.skillName
    || candidate.skillName !== holdout.skillName
    || candidate.skillName !== retention.skillName
    || admission.id !== holdout.admissionId
    || admission.id !== retention.admissionId
    || holdout.id !== retention.holdoutEvaluationId
    || holdout.envelopeId !== candidate.authorship.holdoutEnvelopeId
    || retention.envelopeId !== candidate.authorship.holdoutEnvelopeId) {
    throw new Error('exact existing Skill evidence cannot produce release lineage')
  }
  return parseExistingSkillCandidateLineage({
    kind: 'existing-skill-candidate-lineage-v1',
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    baselineArtifactDigest: candidate.baseline.artifactDigest,
    baselineTreeHash: candidate.baseline.treeHash,
    evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
    policyId: candidate.authorship.policyId,
    versionKind: candidate.version.kind,
    contentHash: candidate.contentHash,
    candidateTreeHash: candidate.version.treeHash,
    admissionId: admission.id,
    evaluationEnvelopeId: holdout.envelopeId,
    holdoutEvaluationId: holdout.id,
    holdoutCasePackHash: holdout.casePackHash,
    retentionEvaluationId: retention.id,
    retentionCasePackHash: retention.casePackHash,
    releaseAuthority: 'none',
  })
}

/** Strict reader for Generation artifacts recovered from durable Storage. */
export function parseExistingSkillCandidateLineage(value: unknown): ExistingSkillCandidateLineage {
  const keys = [
    'admissionId',
    'baselineArtifactDigest',
    'baselineId',
    'baselineTreeHash',
    'candidateId',
    'candidateTreeHash',
    'contentHash',
    'evaluationEnvelopeId',
    'evaluationEvidenceId',
    'holdoutCasePackHash',
    'holdoutEvaluationId',
    'kind',
    'opportunityId',
    'policyId',
    'qualificationId',
    'releaseAuthority',
    'retentionCasePackHash',
    'retentionEvaluationId',
    'skillName',
    'versionKind',
    'workspaceId',
  ].sort().join(',')
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== keys
    || value.kind !== 'existing-skill-candidate-lineage-v1'
    || !contentId(value.candidateId)
    || typeof value.workspaceId !== 'string'
    || !WORKSPACE_ID.test(value.workspaceId)
    || typeof value.skillName !== 'string'
    || !PUBLIC_ID.test(value.skillName)
    || !contentId(value.opportunityId)
    || !contentId(value.qualificationId)
    || !contentId(value.baselineId)
    || !contentId(value.baselineArtifactDigest)
    || !contentId(value.baselineTreeHash)
    || !contentId(value.evaluationEvidenceId)
    || typeof value.policyId !== 'string'
    || !PUBLIC_ID.test(value.policyId)
    || value.versionKind !== 'existing-skill-improvement-bundle-v1'
    || !contentId(value.contentHash)
    || !contentId(value.candidateTreeHash)
    || !contentId(value.admissionId)
    || !contentId(value.evaluationEnvelopeId)
    || !contentId(value.holdoutEvaluationId)
    || !contentId(value.holdoutCasePackHash)
    || !contentId(value.retentionEvaluationId)
    || !contentId(value.retentionCasePackHash)
    || value.releaseAuthority !== 'none') {
    throw new Error('invalid existing Skill Candidate lineage')
  }
  return Object.freeze({ ...value }) as unknown as ExistingSkillCandidateLineage
}

function isPassingEvidence(
  evidence: {
    readonly baselineTreeHash: string
    readonly candidateTreeHash: string
    readonly baseline: string
    readonly candidate: string
    readonly calibrationPassed: boolean
    readonly assembled: boolean
    readonly compositionStable: boolean
    readonly inputIntegrityStable: boolean
    readonly proposerCalls: number
    readonly trialCount: number
  },
  candidate: ExistingSkillCandidate,
): boolean {
  return evidence.baselineTreeHash === candidate.baseline.treeHash
    && evidence.candidateTreeHash === candidate.version.treeHash
    && evidence.baseline === 'fail'
    && evidence.candidate === 'pass'
    && evidence.calibrationPassed === true
    && evidence.assembled === true
    && evidence.compositionStable === true
    && evidence.inputIntegrityStable === true
    && evidence.proposerCalls === 0
    && evidence.trialCount === 4
}

function contentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
