import { describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillRelease,
  type ExistingSkillReleaseDecision,
  type ExistingSkillReleaseStore,
} from '../src/existing-skill-release.ts'
import type { ExistingSkillCandidateAdmissionResult } from '../src/existing-skill-candidate-admission.ts'
import type { ExistingSkillHoldoutEvaluationRunView } from '../src/existing-skill-holdout-evaluation.ts'
import type { ExistingSkillRetentionEvaluationRunView } from '../src/existing-skill-retention-evaluation.ts'
import type { CapabilityGeneration, EvolutionStore } from '../src/generation-store.ts'
import { assembleSealedSkillBundleArchive } from '../src/skill-bundle-archive.ts'
import {
  existingSkillCandidateId,
  type ExistingSkillCandidate,
  type ExistingSkillCandidateInput,
} from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const BASELINE_ARTIFACT = '1'.repeat(64)
const BASELINE_TREE = '2'.repeat(64)
const ADMISSION_ID = '3'.repeat(64)
const ENVELOPE_ID = '4'.repeat(64)
const HOLDOUT_ID = '5'.repeat(64)
const HOLDOUT_CASES = '6'.repeat(64)
const RETENTION_ID = '7'.repeat(64)
const RETENTION_CASES = '8'.repeat(64)

describe('Existing Skill Release', () => {
  it('publishes only an inactive exact Generation after explicit human approval, then promotes it separately', async () => {
    const fixture = await releaseFixture()
    const release = fixture.release()

    await expect(release.eligibility(WORKSPACE_ID, fixture.candidate.id)).resolves.toEqual({
      status: 'eligible',
      reason: 'exact-existing-skill-evidence-retained',
      candidateId: fixture.candidate.id,
      admissionId: ADMISSION_ID,
      holdoutEvaluationId: HOLDOUT_ID,
      retentionEvaluationId: RETENTION_ID,
    })
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()

    const approved = await release.approve(
      WORKSPACE_ID,
      fixture.candidate.id,
      'Reviewed the exact instruction-only diff and protected evidence.',
    )

    expect(approved).toMatchObject({
      status: 'approved',
      actor: 'human',
      candidateId: fixture.candidate.id,
      workspaceId: WORKSPACE_ID,
      skillName: 'shared-skill',
      admissionId: ADMISSION_ID,
      holdoutEvaluationId: HOLDOUT_ID,
      retentionEvaluationId: RETENTION_ID,
      decisionNote: 'Reviewed the exact instruction-only diff and protected evidence.',
    })
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledOnce()
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      createdAt: Date.parse('2026-08-21T00:00:02.000Z'),
      evaluatorVersion: 'existing-skill-paired-v1',
      policyVersion: 'human-review-existing-skill-v1',
      artifacts: [expect.objectContaining({
        kind: 'skill-bundle',
        name: 'shared-skill',
        artifactDigest: fixture.archive.artifactDigest,
        treeHash: fixture.archive.treeHash,
        contentBase64: fixture.archive.content.toString('base64'),
        lineage: expect.objectContaining({
          kind: 'existing-skill-candidate-lineage-v1',
          candidateId: fixture.candidate.id,
          baselineArtifactDigest: BASELINE_ARTIFACT,
          baselineTreeHash: BASELINE_TREE,
          admissionId: ADMISSION_ID,
          holdoutEvaluationId: HOLDOUT_ID,
          retentionEvaluationId: RETENTION_ID,
          releaseAuthority: 'none',
        }),
      })],
    }))
    expect(fixture.evolution.promoteGeneration).not.toHaveBeenCalled()

    await expect(release.promote(WORKSPACE_ID, fixture.candidate.id)).resolves.toEqual({
      previousId: undefined,
      generation: fixture.generation,
    })
    expect(fixture.evolution.promoteGeneration)
      .toHaveBeenCalledWith(WORKSPACE_ID, fixture.generation.id)
  })

  it('fails closed before publication when retained evidence has any authority warning', async () => {
    const fixture = await releaseFixture({ retentionWarnings: 1 })
    const release = fixture.release()

    await expect(release.eligibility(WORKSPACE_ID, fixture.candidate.id)).resolves.toEqual({
      status: 'blocked',
      reason: 'retention-evidence-invalid',
      candidateId: fixture.candidate.id,
    })
    await expect(release.approve(WORKSPACE_ID, fixture.candidate.id, 'Looks fine.'))
      .rejects.toThrow('existing Skill release blocked: retention-evidence-invalid')
    expect(fixture.candidates.resolveExistingBundle).not.toHaveBeenCalled()
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
  })

  it('keeps an explicit rejection terminal without publishing or requiring evaluation files later', async () => {
    const fixture = await releaseFixture()
    const release = fixture.release()

    await expect(release.reject(
      WORKSPACE_ID,
      fixture.candidate.id,
      'The bounded improvement is not desirable.',
    )).resolves.toMatchObject({
      status: 'rejected',
      actor: 'human',
      candidateId: fixture.candidate.id,
    })
    await expect(release.eligibility(WORKSPACE_ID, fixture.candidate.id)).resolves.toEqual({
      status: 'rejected',
      reason: 'human-rejected',
      candidateId: fixture.candidate.id,
    })
    await expect(release.approve(WORKSPACE_ID, fixture.candidate.id, 'Changed my mind.'))
      .rejects.toThrow('rejected existing Skill Candidate cannot be approved')
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
  })

  it('replaces only the exact active parent artifact and preserves unrelated evolved Skills', async () => {
    const fixture = await releaseFixture({ activeWithSameSkill: true })
    const release = fixture.release()

    await release.approve(WORKSPACE_ID, fixture.candidate.id, 'Exact parent reviewed.')

    expect(fixture.evolution.publishGeneration).toHaveBeenCalledWith(expect.objectContaining({
      parentId: fixture.active?.id,
      artifacts: [
        expect.objectContaining({ name: 'other-skill', treeHash: 'd'.repeat(64) }),
        expect.objectContaining({ name: 'shared-skill', treeHash: fixture.archive.treeHash }),
      ],
    }))
  })
})

async function releaseFixture(options: {
  readonly retentionWarnings?: number
  readonly activeWithSameSkill?: boolean
} = {}) {
  const archive = await assembleSealedSkillBundleArchive([{
    path: 'SKILL.md',
    mode: '100644',
    content: Buffer.from([
      '---',
      'name: shared-skill',
      'description: Improved shared behavior.',
      '---',
      '',
      '# Shared Skill',
      '',
      'Use the corrected instruction.',
      '',
    ].join('\n')),
  }, {
    path: 'assets/exact.bin',
    mode: '100644',
    content: Buffer.from([0, 1, 2, 255]),
  }])
  const candidate = candidateFixture(archive)
  const admission = admissionFixture(candidate)
  const holdout = holdoutFixture(candidate)
  const retention = retentionFixture(candidate)
  const active = options.activeWithSameSkill === true
    ? generationFixture('a', [{
        kind: 'skill-bundle',
        name: 'other-skill',
        artifactDigest: 'c'.repeat(64),
        treeHash: 'd'.repeat(64),
        contentBase64: 'eA==',
        lineage: missingSkillLineage('other-skill', 'c'.repeat(64), 'd'.repeat(64)),
      }, {
        kind: 'skill-bundle',
        name: 'shared-skill',
        artifactDigest: BASELINE_ARTIFACT,
        treeHash: BASELINE_TREE,
        contentBase64: 'eA==',
        lineage: missingSkillLineage('shared-skill', BASELINE_ARTIFACT, BASELINE_TREE),
      }])
    : undefined
  const generation = generationFixture('b', [])
  const decisions = decisionStore()
  const evolution = evolutionStore(active, generation)
  const candidates = {
    listExistingCandidates: vi.fn(() => [candidate]),
    resolveExistingBundle: vi.fn(async () => archive),
  }
  return {
    active,
    admission,
    archive,
    candidate,
    candidates,
    decisions,
    evolution,
    generation,
    release: () => new ExistingSkillRelease({
      candidates,
      admissions: { scan: async () => ({ configuredPolicyCount: 1, warningCount: 0, results: [admission] }) },
      holdouts: { scan: async () => ({ configuredPolicyCount: 1, warningCount: 0, results: [holdout] }) },
      retentions: { scan: async () => ({
        configuredPolicyCount: 1,
        warningCount: options.retentionWarnings ?? 0,
        results: [retention],
      }) },
      decisions,
      store: evolution,
      bundles: { providerFor: vi.fn(async () => ({
        name: 'verified',
        list: async () => [],
        get: async () => undefined,
      })) },
    }),
  }
}

function candidateFixture(
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): ExistingSkillCandidate {
  const input: ExistingSkillCandidateInput = {
    kind: 'existing-skill-improvement-candidate-v1',
    createdAt: 1_777_000_000_000,
    workspaceId: WORKSPACE_ID,
    skillName: 'shared-skill',
    description: 'Improved shared behavior.',
    opportunity: {
      kind: 'internal-existing-skill-correction-v1',
      id: '9'.repeat(64),
      signalCount: 5,
      goalCount: 5,
    },
    baseline: {
      qualificationId: 'a'.repeat(64),
      id: 'b'.repeat(64),
      artifactDigest: BASELINE_ARTIFACT,
      treeHash: BASELINE_TREE,
    },
    authorship: {
      kind: 'protected-correction-authoring-v1',
      policyId: 'existing-author',
      modelIdentityHash: 'c'.repeat(64),
      evaluationEvidenceId: 'd'.repeat(64),
      inputDigest: 'e'.repeat(64),
      holdoutEnvelopeId: ENVELOPE_ID,
      claim: 'Correct the repeated failure without changing effects.',
    },
    scope: 'workspace',
    version: {
      kind: 'existing-skill-improvement-bundle-v1',
      parentBaselineId: 'b'.repeat(64),
      artifactDigest: archive.artifactDigest,
      treeHash: archive.treeHash,
    },
    contentHash: archive.artifactDigest,
    diff: {
      kind: 'bounded-instruction-tree-diff-v1',
      changedPaths: ['SKILL.md'],
      addedPaths: [],
      preservedFileCount: 1,
      preservedBinaryFileCount: 1,
    },
    package: {
      path: 'shared-skill',
      fileCount: archive.files.length,
      totalBytes: archive.totalBytes,
      hasExecutableFiles: false,
    },
    permissions: {
      declared: false,
      executableContentChanged: false,
      externalEffects: 'unchanged-or-unknown',
    },
    license: { status: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'exact-baseline-binding', status: 'passed' },
        { name: 'whole-tree-inheritance', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'instruction-only-diff', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: {
      kind: 'sealed-complete-skill-bundle',
      format: 'tar.gz',
      digest: archive.artifactDigest,
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
    releaseAuthority: 'none',
  }
  return Object.freeze({ schemaVersion: 1, id: existingSkillCandidateId(input), ...input })
}

function admissionFixture(candidate: ExistingSkillCandidate): ExistingSkillCandidateAdmissionResult {
  return {
    schemaVersion: 1,
    id: ADMISSION_ID,
    candidateId: candidate.id,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    status: 'qualified-for-holdout',
    reasons: ['exact-paired-subjects-admitted'],
    evidence: {
      baselineId: candidate.baseline.id,
      baselineArtifactDigest: BASELINE_ARTIFACT,
      baselineTreeHash: BASELINE_TREE,
      candidateArtifactDigest: candidate.version.artifactDigest,
      candidateTreeHash: candidate.version.treeHash,
      evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      protectedAdmissionSampleHash: 'f'.repeat(64),
      protectedAdmissionSampleCount: 1,
      changedFileCount: 1,
      addedFileCount: 0,
      preservedFileCount: 1,
      preservedBinaryFileCount: 1,
      candidateExecuted: false,
      evaluatorClass: 'host-structural',
    },
    releaseAuthority: 'none',
  }
}

function holdoutFixture(candidate: ExistingSkillCandidate): ExistingSkillHoldoutEvaluationRunView {
  return {
    id: HOLDOUT_ID,
    candidateId: candidate.id,
    admissionId: ADMISSION_ID,
    envelopeId: ENVELOPE_ID,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    baselineTreeHash: BASELINE_TREE,
    candidateTreeHash: candidate.version.treeHash,
    casePackHash: HOLDOUT_CASES,
    status: 'complete',
    verdict: 'improved',
    reason: 'candidate-passed-protected-holdout',
    evidence: pairedEvidence(candidate, HOLDOUT_CASES),
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: '2026-08-21T00:00:01.000Z',
    releaseAuthority: 'none',
  }
}

function retentionFixture(candidate: ExistingSkillCandidate): ExistingSkillRetentionEvaluationRunView {
  return {
    id: RETENTION_ID,
    candidateId: candidate.id,
    holdoutEvaluationId: HOLDOUT_ID,
    admissionId: ADMISSION_ID,
    envelopeId: ENVELOPE_ID,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    baselineTreeHash: BASELINE_TREE,
    candidateTreeHash: candidate.version.treeHash,
    holdoutCasePackHash: HOLDOUT_CASES,
    casePackHash: RETENTION_CASES,
    status: 'complete',
    verdict: 'retained',
    reason: 'candidate-passed-protected-retention',
    evidence: {
      ...pairedEvidence(candidate, RETENTION_CASES),
      holdoutCasePackHash: HOLDOUT_CASES,
    },
    startedAt: '2026-08-21T00:00:01.000Z',
    finishedAt: '2026-08-21T00:00:02.000Z',
    releaseAuthority: 'none',
  }
}

function pairedEvidence(candidate: ExistingSkillCandidate, casePackHash: string) {
  return {
    baselineTreeHash: BASELINE_TREE,
    candidateTreeHash: candidate.version.treeHash,
    casePackHash,
    baseline: 'fail' as const,
    candidate: 'pass' as const,
    calibrationPassed: true,
    assembled: true,
    compositionStable: true,
    inputIntegrityStable: true,
    proposerCalls: 0 as const,
    trialCount: 4 as const,
  }
}

function decisionStore(): ExistingSkillReleaseStore {
  const decisions = new Map<string, ExistingSkillReleaseDecision>()
  return {
    get: candidateId => decisions.get(candidateId),
    list: workspaceId => [...decisions.values()].filter(value => value.workspaceId === workspaceId),
    record: async (decision) => {
      const prior = decisions.get(decision.candidateId)
      if (prior !== undefined) return { created: false, decision: prior }
      decisions.set(decision.candidateId, decision)
      return { created: true, decision }
    },
    close: async () => {},
  }
}

function evolutionStore(
  active: CapabilityGeneration | undefined,
  generation: CapabilityGeneration,
): EvolutionStore & {
  publishGeneration: ReturnType<typeof vi.fn>
  promoteGeneration: ReturnType<typeof vi.fn>
} {
  return {
    publishGeneration: vi.fn(async (input) => {
      Object.assign(generation, { schemaVersion: 2, ...input })
      return { created: true, generation }
    }),
    getGeneration: vi.fn((id: string) => id === generation.id ? generation : active?.id === id ? active : undefined),
    getActiveGeneration: vi.fn(() => active),
    promoteGeneration: vi.fn(async () => ({ previousId: active?.id, generation })),
    rollbackGeneration: vi.fn(),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
  }
}

function generationFixture(
  idCharacter: string,
  artifacts: CapabilityGeneration['artifacts'],
): CapabilityGeneration {
  return {
    id: idCharacter.repeat(64),
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    createdAt: 1,
    artifacts,
    evaluatorVersion: 'fixture-v1',
    policyVersion: 'fixture-v1',
    compositionFingerprint: 'f'.repeat(64),
  }
}

function missingSkillLineage(skillName: string, contentHash: string, treeHash: string) {
  return {
    kind: 'internal-skill-candidate-lineage-v3' as const,
    candidateId: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName,
    opportunityId: '2'.repeat(64),
    evaluationEvidenceId: '3'.repeat(64),
    policyId: 'fixture-author',
    versionKind: 'experience-authored-bundle-v1' as const,
    contentHash,
    candidateTreeHash: treeHash,
    admissionId: '4'.repeat(64),
    evaluationEnvelopeId: '5'.repeat(64),
    releaseAuthority: 'none' as const,
  }
}
