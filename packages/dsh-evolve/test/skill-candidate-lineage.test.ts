import { describe, expect, it } from 'vitest'
import type { SkillCandidateAdmissionResult } from '../src/skill-candidate-admission.ts'
import {
  createSkillCandidateLineage,
  parseSkillCandidateLineage,
} from '../src/skill-candidate-lineage.ts'
import type { ExperienceSkillCandidate } from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

describe('internal Skill Candidate lineage', () => {
  it('keeps only the exact Opportunity, authoring policy, Candidate, and admission identities', () => {
    const candidate = fixtureCandidate()
    const admission = fixtureAdmission(candidate)
    const lineage = createSkillCandidateLineage(candidate, admission)

    expect(lineage).toEqual({
      kind: 'internal-skill-candidate-lineage-v2',
      candidateId: candidate.id,
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      opportunityId: candidate.opportunity.id,
      policyId: 'workspace-experience-author',
      versionKind: 'experience-authored-bundle-v1',
      contentHash: candidate.contentHash,
      candidateTreeHash: candidate.version.treeHash,
      admissionId: admission.id,
      evaluationEnvelopeId: 'e'.repeat(64),
      releaseAuthority: 'none',
    })
    expect(JSON.stringify(lineage)).not.toMatch(/source|index|research|external|git/iu)
    expect(parseSkillCandidateLineage(structuredClone(lineage))).toEqual(lineage)
  })

  it('rejects legacy external-source lineage shapes', () => {
    expect(() => parseSkillCandidateLineage({
      kind: 'discovered-skill-lineage-v1',
      candidateId: '1'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      versionKind: 'agent-skills-index-v0.2',
      source: { id: 'market', kind: 'agent-skills-index', trust: 'explicit-deployer-config' },
      contentHash: '2'.repeat(64),
      candidateTreeHash: '3'.repeat(64),
      admissionId: '4'.repeat(64),
      evaluationEnvelopeId: 'e'.repeat(64),
      releaseAuthority: 'none',
    })).toThrow('invalid internal Skill Candidate lineage')
  })
})

function fixtureCandidate(): ExperienceSkillCandidate {
  return {
    schemaVersion: 1,
    id: '1'.repeat(64),
    createdAt: 1,
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    description: 'Release proof.',
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
}

function fixtureAdmission(candidate: ExperienceSkillCandidate): SkillCandidateAdmissionResult {
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
