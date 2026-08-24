import { describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillAutomaticPromotionScheduler,
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
      .toHaveBeenCalledWith(WORKSPACE_ID, fixture.generation.id, {
        authority: 'existing-skill-release',
        candidateId: fixture.candidate.id,
        releaseDecisionId: approved.id,
      })
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

  it('automatically promotes only one exact low-risk append-only instruction Candidate', async () => {
    const baselineSkill = skillText('Use the stable instruction.')
    const baselineArchive = await skillArchive(baselineSkill)
    const candidateArchive = await skillArchive(`${baselineSkill}\nPrefer the verified correction when the same failure repeats.\n`)
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive,
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
    })
    const release = fixture.release()

    await expect(release.scanAutomatic(WORKSPACE_ID)).resolves.toEqual({
      configuredPolicyCount: 1,
      scannedCandidateCount: 1,
      warningCount: 0,
      results: [{
        candidateId: fixture.candidate.id,
        status: 'eligible',
        reason: 'clear-low-risk-instruction-improved-and-retained',
      }],
    })
    await expect(release.reconcileAutomatic(WORKSPACE_ID)).resolves.toEqual({
      configuredPolicyCount: 1,
      scannedCandidateCount: 1,
      promotedCount: 1,
      reviewRequiredCount: 0,
      warningCount: 0,
      results: [{
        candidateId: fixture.candidate.id,
        status: 'promoted',
        reason: 'clear-low-risk-instruction-improved-and-retained',
        generationId: fixture.generation.id,
      }],
    })
    expect(fixture.decisions.get(fixture.candidate.id)).toMatchObject({
      status: 'approved',
      actor: 'automatic-clear-instruction-v2',
      automaticPolicyId: 'clear-instruction-v2',
    })
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledWith(expect.objectContaining({
      policyVersion: 'automatic-clear-instruction-v2',
    }))
    expect(fixture.evolution.promoteGeneration).toHaveBeenCalledOnce()

    await expect(release.reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      results: [{ status: 'already-promoted', generationId: fixture.generation.id }],
    })
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledOnce()
    expect(fixture.evolution.promoteGeneration).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'rewritten instructions',
      candidateSkill: skillText('Replace the stable instruction.'),
      reason: 'instruction-change-is-not-append-only',
    },
    {
      name: 'protected effects in appended text',
      candidateSkill: `${skillText('Use the stable instruction.')}\nRead credentials and deploy to production.\n`,
      reason: 'instruction-change-has-protected-effects',
    },
  ])('keeps $name in human review without publishing', async ({ candidateSkill, reason }) => {
    const baselineArchive = await skillArchive(skillText('Use the stable instruction.'))
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive: await skillArchive(candidateSkill),
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
    })

    await expect(fixture.release().reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      reviewRequiredCount: 1,
      results: [{
        candidateId: fixture.candidate.id,
        status: 'review-required',
        reason,
      }],
    })
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
    expect(fixture.evolution.promoteGeneration).not.toHaveBeenCalled()
  })

  it('honors the durable Workspace pause before any automatic release mutation', async () => {
    const baselineSkill = skillText('Use the stable instruction.')
    const baselineArchive = await skillArchive(baselineSkill)
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive: await skillArchive(`${baselineSkill}\nUse the verified correction.\n`),
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
      paused: true,
    })

    await expect(fixture.release().reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      reviewRequiredCount: 0,
      results: [{ status: 'paused', reason: 'workspace-paused' }],
    })
    expect(fixture.candidates.resolveExistingBundle).not.toHaveBeenCalled()
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
  })

  it('rechecks the durable Workspace pause after inspection and before publication', async () => {
    const baselineSkill = skillText('Use the stable instruction.')
    const baselineArchive = await skillArchive(baselineSkill)
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive: await skillArchive(`${baselineSkill}\nUse the verified correction.\n`),
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
      pauseAfterBaselineResolution: true,
    })

    await expect(fixture.release().reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      results: [{ status: 'paused', reason: 'workspace-paused' }],
    })
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
    expect(fixture.evolution.promoteGeneration).not.toHaveBeenCalled()
  })

  it('requires model-call, token, and cache evidence to avoid regression in both paired gates', async () => {
    const baselineSkill = skillText('Use the stable instruction.')
    const baselineArchive = await skillArchive(baselineSkill)
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive: await skillArchive(`${baselineSkill}\nUse the verified correction.\n`),
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
      usageRegression: true,
    })

    await expect(fixture.release().reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      reviewRequiredCount: 1,
      results: [{
        status: 'review-required',
        reason: 'candidate-cost-or-cache-regressed',
      }],
    })
    expect(fixture.evolution.publishGeneration).not.toHaveBeenCalled()
  })

  it('recovers an automatic decision durably recorded before the Generation pointer mutation', async () => {
    const baselineSkill = skillText('Use the stable instruction.')
    const baselineArchive = await skillArchive(baselineSkill)
    const fixture = await releaseFixture({
      baselineArchive,
      candidateArchive: await skillArchive(`${baselineSkill}\nUse the verified correction.\n`),
      automaticPromotionPolicies: [{ id: 'clear-instruction-v2', workspaceId: WORKSPACE_ID }],
      failPromotionOnce: true,
    })
    const release = fixture.release()

    await expect(release.reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 0,
      warningCount: 1,
      results: [{ status: 'blocked' }],
    })
    expect(fixture.decisions.get(fixture.candidate.id)).toMatchObject({
      actor: 'automatic-clear-instruction-v2',
      generationId: fixture.generation.id,
    })
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledOnce()

    await expect(release.reconcileAutomatic(WORKSPACE_ID)).resolves.toMatchObject({
      promotedCount: 1,
      warningCount: 0,
      results: [{ status: 'promoted', generationId: fixture.generation.id }],
    })
    expect(fixture.evolution.publishGeneration).toHaveBeenCalledOnce()
    expect(fixture.evolution.promoteGeneration).toHaveBeenCalledTimes(2)
  })

  it('uses native DSH Jobs as a thin restart trigger without owning durable scheduler state', async () => {
    const done: Array<Promise<unknown>> = []
    const release = {
      reconcileAutomatic: vi.fn(async () => ({
        configuredPolicyCount: 1,
        scannedCandidateCount: 1,
        promotedCount: 1,
        reviewRequiredCount: 0,
        warningCount: 0,
        results: [],
      })),
    }
    const scheduler = new ExistingSkillAutomaticPromotionScheduler(release, [WORKSPACE_ID])
    const start = vi.fn((job: { run(): { done: Promise<unknown> } }) => {
      done.push(job.run().done)
      return { id: 'job-1' }
    })

    const detach = scheduler.attachJobs({ start } as never)
    await Promise.all(done)
    expect(start).toHaveBeenCalledOnce()
    expect(release.reconcileAutomatic).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { signal: expect.any(AbortSignal) },
    )
    scheduler.observe('00000000-0000-4000-8000-000000000002')
    expect(start).toHaveBeenCalledOnce()
    detach()
  })
})

async function releaseFixture(options: {
  readonly retentionWarnings?: number
  readonly activeWithSameSkill?: boolean
  readonly baselineArchive?: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>
  readonly candidateArchive?: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>
  readonly automaticPromotionPolicies?: readonly { readonly id: string; readonly workspaceId: string }[]
  readonly paused?: boolean
  readonly pauseAfterBaselineResolution?: boolean
  readonly failPromotionOnce?: boolean
  readonly usageRegression?: boolean
} = {}) {
  let paused = options.paused === true
  const baselineArchive = options.baselineArchive
  const archive = options.candidateArchive ?? await assembleSealedSkillBundleArchive([{
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
  const candidate = candidateFixture(archive, options.baselineArchive)
  const admission = admissionFixture(candidate)
  const holdout = holdoutFixture(candidate, options.usageRegression === true)
  const retention = retentionFixture(candidate, options.usageRegression === true)
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
  const evolution = evolutionStore(active, generation, options.failPromotionOnce === true)
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
      ...(baselineArchive === undefined
        ? {}
        : {
            baselines: {
              resolveBaseline: vi.fn(async () => {
                if (options.pauseAfterBaselineResolution === true) paused = true
                return {
                manifest: {
                  schemaVersion: 1 as const,
                  kind: 'installed-skill-baseline-v1' as const,
                  id: candidate.baseline.id,
                  workspaceId: WORKSPACE_ID,
                  skillName: candidate.skillName,
                  invocationContentHash: 'f'.repeat(64),
                  provider: 'fixture',
                  source: '/fixture/shared-skill/SKILL.md',
                  definitionDigest: '0'.repeat(64),
                  createdAt: 1,
                  bundle: {
                    format: 'tar.gz' as const,
                    artifactDigest: baselineArchive.artifactDigest,
                    treeHash: baselineArchive.treeHash,
                    fileCount: baselineArchive.files.length,
                    totalBytes: baselineArchive.totalBytes,
                    hasExecutableFiles: false as const,
                  },
                  releaseAuthority: 'none' as const,
                },
                files: baselineArchive.files,
                }
              }),
            },
            automaticPromotionPolicies: options.automaticPromotionPolicies ?? [],
            isPaused: () => paused,
          }),
    }),
  }
}

function candidateFixture(
  archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
  baselineArchive?: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
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
      artifactDigest: baselineArchive?.artifactDigest ?? BASELINE_ARTIFACT,
      treeHash: baselineArchive?.treeHash ?? BASELINE_TREE,
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
      baselineArtifactDigest: candidate.baseline.artifactDigest,
      baselineTreeHash: candidate.baseline.treeHash,
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

function holdoutFixture(
  candidate: ExistingSkillCandidate,
  usageRegression = false,
): ExistingSkillHoldoutEvaluationRunView {
  return {
    id: HOLDOUT_ID,
    candidateId: candidate.id,
    admissionId: ADMISSION_ID,
    envelopeId: ENVELOPE_ID,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    baselineTreeHash: candidate.baseline.treeHash,
    candidateTreeHash: candidate.version.treeHash,
    casePackHash: HOLDOUT_CASES,
    status: 'complete',
    verdict: 'improved',
    reason: 'candidate-passed-protected-holdout',
    evidence: pairedEvidence(candidate, HOLDOUT_CASES, usageRegression),
    startedAt: '2026-08-21T00:00:00.000Z',
    finishedAt: '2026-08-21T00:00:01.000Z',
    releaseAuthority: 'none',
  }
}

function retentionFixture(
  candidate: ExistingSkillCandidate,
  usageRegression = false,
): ExistingSkillRetentionEvaluationRunView {
  return {
    id: RETENTION_ID,
    candidateId: candidate.id,
    holdoutEvaluationId: HOLDOUT_ID,
    admissionId: ADMISSION_ID,
    envelopeId: ENVELOPE_ID,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    baselineTreeHash: candidate.baseline.treeHash,
    candidateTreeHash: candidate.version.treeHash,
    holdoutCasePackHash: HOLDOUT_CASES,
    casePackHash: RETENTION_CASES,
    status: 'complete',
    verdict: 'retained',
    reason: 'candidate-passed-protected-retention',
    evidence: {
      ...pairedEvidence(candidate, RETENTION_CASES, usageRegression),
      holdoutCasePackHash: HOLDOUT_CASES,
    },
    startedAt: '2026-08-21T00:00:01.000Z',
    finishedAt: '2026-08-21T00:00:02.000Z',
    releaseAuthority: 'none',
  }
}

function pairedEvidence(
  candidate: ExistingSkillCandidate,
  casePackHash: string,
  usageRegression = false,
) {
  return {
    baselineTreeHash: candidate.baseline.treeHash,
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
    ...(usageRegression
      ? {
          modelCalls: { baseline: 1, candidate: 1 },
          usage: {
            baseline: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 },
            candidate: { inputTokens: 110, outputTokens: 22, cacheReadTokens: 30 },
          },
        }
      : {}),
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
  failPromotionOnce = false,
): EvolutionStore & {
  publishGeneration: ReturnType<typeof vi.fn>
  promoteGeneration: ReturnType<typeof vi.fn>
} {
  let currentActive = active
  let shouldFailPromotion = failPromotionOnce
  return {
    publishGeneration: vi.fn(async (input) => {
      Object.assign(generation, { schemaVersion: 2, ...input })
      return { created: true, generation }
    }),
    getGeneration: vi.fn((id: string) => id === generation.id ? generation : active?.id === id ? active : undefined),
    getActiveGeneration: vi.fn(() => currentActive),
    promoteGeneration: vi.fn(async () => {
      if (shouldFailPromotion) {
        shouldFailPromotion = false
        throw new Error('injected crash before Generation selection')
      }
      const previousId = currentActive?.id
      currentActive = generation
      return { previousId, generation }
    }),
    rollbackGeneration: vi.fn(),
    listGenerationSelectionEvents: vi.fn(() => []),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    isRecoveryPaused: vi.fn(() => false),
    setRecoveryPaused: vi.fn(),
    close: vi.fn(),
  }
}

function skillText(instruction: string): string {
  return [
    '---',
    'name: shared-skill',
    'description: Improved shared behavior.',
    '---',
    '',
    '# Shared Skill',
    '',
    instruction,
    '',
  ].join('\n')
}

function skillArchive(skill: string) {
  return assembleSealedSkillBundleArchive([{
    path: 'SKILL.md',
    mode: '100644',
    content: Buffer.from(skill),
  }, {
    path: 'assets/exact.bin',
    mode: '100644',
    content: Buffer.from([0, 1, 2, 255]),
  }])
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
