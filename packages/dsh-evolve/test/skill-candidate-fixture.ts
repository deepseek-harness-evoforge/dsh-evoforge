import type { SkillCandidateAdmissionResult } from '../src/skill-candidate-admission.ts'
import type { SkillCandidateLineage } from '../src/skill-candidate-lineage.ts'
import type { ExperienceSkillCandidate } from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

export function experienceSkillCandidate(
  overrides: Partial<ExperienceSkillCandidate> = {},
): ExperienceSkillCandidate {
  const base: ExperienceSkillCandidate = {
    schemaVersion: 2,
    id: '1'.repeat(64),
    createdAt: 1,
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    description: 'Reuse a release proof learned from DSH experience.',
    opportunity: {
      kind: 'internal-experience-v1',
      id: '2'.repeat(64),
      gapIds: ['3'.repeat(64), '4'.repeat(64)],
      goalCount: 2,
    },
    authorship: {
      kind: 'bounded-model-authoring-v1',
      policyId: 'workspace-experience-author',
      modelIdentityHash: '5'.repeat(64),
      evaluationEvidenceId: '9'.repeat(64),
      inputDigest: '6'.repeat(64),
    },
    scope: 'workspace',
    version: {
      kind: 'experience-authored-bundle-v1',
      artifactDigest: '7'.repeat(64),
      treeHash: '8'.repeat(64),
    },
    contentHash: '7'.repeat(64),
    package: {
      path: 'release-proof',
      fileCount: 2,
      totalBytes: 100,
      hasScripts: false,
      hasReferences: true,
    },
    permissions: {
      declared: false,
      executableContent: false,
      externalEffects: 'unknown',
    },
    license: { status: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'regular-files-only', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: { kind: 'canonical-text-bundle', format: 'tar.gz', contentBase64: 'YQ==' },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
  return { ...base, ...overrides }
}

export function qualifiedSkillCandidateAdmission(
  candidate = experienceSkillCandidate(),
): SkillCandidateAdmissionResult {
  return {
    schemaVersion: 2,
    id: '9'.repeat(64),
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    status: 'qualified-for-shadow',
    reasons: ['candidate-improves-deterministic-admission'],
    envelopeId: 'e'.repeat(64),
    releaseAuthority: 'none',
    evidence: {
      baseline: 'fail',
      candidate: 'pass',
      calibrationPassed: true,
      candidateExecuted: false,
      evaluatorClass: 'deterministic-filesystem',
      trialCount: 4,
      baselineTreeHash: 'a'.repeat(64),
      candidateTreeHash: candidate.version.treeHash,
    },
  }
}

export function internalSkillCandidateLineage(
  overrides: Partial<SkillCandidateLineage> = {},
): SkillCandidateLineage {
  const candidate = experienceSkillCandidate()
  return {
    kind: 'internal-skill-candidate-lineage-v3',
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
    policyId: candidate.authorship.policyId,
    versionKind: candidate.version.kind,
    contentHash: candidate.contentHash,
    candidateTreeHash: candidate.version.treeHash,
    admissionId: '9'.repeat(64),
    evaluationEnvelopeId: 'e'.repeat(64),
    releaseAuthority: 'none',
    ...overrides,
  }
}
