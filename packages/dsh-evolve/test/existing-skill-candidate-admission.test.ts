import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillCandidateAdmission,
  ExistingSkillCandidateAdmissionScheduler,
} from '../src/existing-skill-candidate-admission.ts'
import {
  existingSkillCandidateId,
  type ExistingSkillCandidate,
  type ExistingSkillCandidateInput,
} from '../src/skill-candidate-repository.ts'
import {
  assembleSealedSkillBundleArchive,
  type SkillBundleArchiveFile,
} from '../src/skill-bundle-archive.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Existing Skill Candidate Admission', () => {
  it('durably admits only the exact baseline/Candidate pair bound to protected admission evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-existing-skill-admission-'))
    temporaryRoots.push(root)
    const exactRoot = await realpath(root)
    const baselineFiles = skillFiles('Verify the release.', 'Check the release.')
    const candidateFiles = skillFiles(
      'Verify the release with independent evidence.',
      'Require independent evidence before declaring success.',
    )
    const baselineArchive = await assembleSealedSkillBundleArchive(baselineFiles)
    const candidateArchive = await assembleSealedSkillBundleArchive(candidateFiles)
    const candidate = existingCandidate(baselineArchive, candidateArchive)
    const admissionSample = {
      role: 'admission' as const,
      goal: { id: 'goal-admission', revision: 1, objective: 'Verify an independent release.' },
      request: {
        text: 'Prepare the release proof.',
        representation: 'durable-user-text-v1' as const,
        omittedNonText: false,
      },
      correction: { note: 'Do not let the author be the final reviewer.', sourceUpdatedAt: 3 },
      source: {
        feedbackSignalId: '3'.repeat(64),
        sessionId: 'session-admission',
        messageId: 'message-admission',
        feedbackVersion: '0198f4b4-b664-7000-8000-000000000003',
        assistantSeq: 5,
        invocationSeq: 4,
        route: 'model-tool' as const,
      },
    }
    const resolveBaseline = vi.fn(async () => ({
      manifest: {
        schemaVersion: 1 as const,
        kind: 'installed-skill-baseline-v1' as const,
        id: candidate.baseline.id,
        workspaceId: WORKSPACE_ID,
        skillName: candidate.skillName,
        invocationContentHash: '2'.repeat(64),
        provider: 'native-test-provider',
        source: '/sealed/provider/release-proof/SKILL.md',
        definitionDigest: '9'.repeat(64),
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
    }))
    const readForGovernance = vi.fn(async () => ({
      schemaVersion: 1 as const,
      kind: 'existing-skill-evaluation-evidence-v1' as const,
      id: candidate.authorship.evaluationEvidenceId,
      workspaceId: WORKSPACE_ID,
      opportunity: {
        id: candidate.opportunity.id,
        skillName: candidate.skillName,
        invocationContentHash: '2'.repeat(64),
        signalCount: 4,
        goalCount: 4,
        firstObservedAt: 1,
        lastObservedAt: 4,
      },
      qualification: { id: candidate.baseline.qualificationId, baselineId: candidate.baseline.id },
      selection: { selectedGoalCount: 4, omittedGoalCount: 0 },
      samples: [
        evidenceSample('authoring', '1'),
        evidenceSample('authoring', '2'),
        admissionSample,
        evidenceSample('holdout', '4'),
      ],
      authoringInputDigest: candidate.authorship.inputDigest,
      releaseAuthority: 'none' as const,
    }))
    const materializeExisting = vi.fn(async (
      value: ExistingSkillCandidate,
      outputDir: string,
    ) => {
      for (const file of candidateFiles) {
        const target = join(outputDir, ...file.path.split('/'))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.content, { mode: 0o600 })
      }
      return {
        candidateId: value.id,
        path: outputDir,
        contentHash: candidateArchive.artifactDigest,
        treeHash: candidateArchive.treeHash,
        files: candidateFiles.map(file => ({
          path: file.path,
          mode: '100644' as const,
          size: file.content.byteLength,
        })),
      }
    })
    const admission = new ExistingSkillCandidateAdmission({
      policies: [{
        id: 'workspace-evaluation',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(exactRoot, 'governance'),
        runRoot: join(exactRoot, 'runs'),
        dshRevision: 'a'.repeat(40),
        maxAttemptsPerUtcDay: 1,
      }],
      baselines: { resolveBaseline },
      candidates: { materializeExisting },
      evidence: { readForGovernance },
    })

    const result = await admission.evaluate(candidate)

    expect(result).toMatchObject({
      schemaVersion: 1,
      candidateId: candidate.id,
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      status: 'qualified-for-holdout',
      reasons: ['exact-paired-subjects-admitted'],
      evidence: {
        baselineId: candidate.baseline.id,
        baselineTreeHash: baselineArchive.treeHash,
        candidateTreeHash: candidateArchive.treeHash,
        evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
        protectedAdmissionSampleCount: 1,
        changedFileCount: 2,
        preservedFileCount: 1,
        candidateExecuted: false,
        evaluatorClass: 'host-structural',
      },
      releaseAuthority: 'none',
    })
    expect(resolveBaseline).toHaveBeenCalledWith(WORKSPACE_ID, candidate.baseline.id)
    expect(readForGovernance).toHaveBeenCalledWith(
      WORKSPACE_ID,
      candidate.opportunity.id,
      candidate.baseline.qualificationId,
      candidate.authorship.evaluationEvidenceId,
    )
    expect(materializeExisting).toHaveBeenCalledOnce()
    await expect(admission.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      results: [{ id: result.id, status: 'qualified-for-holdout' }],
    })
    await expect(admission.evaluate(candidate)).resolves.toEqual(result)
    expect(materializeExisting).toHaveBeenCalledOnce()

    const driftedEvidenceAdmission = new ExistingSkillCandidateAdmission({
      policies: [{
        id: 'workspace-evidence-drift',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(exactRoot, 'governance-drift'),
        runRoot: join(exactRoot, 'runs-drift'),
      }],
      baselines: { resolveBaseline },
      candidates: { materializeExisting },
      evidence: {
        readForGovernance: async () => ({
          ...await readForGovernance(),
          authoringInputDigest: 'c'.repeat(64),
        }),
      },
    })
    await expect(driftedEvidenceAdmission.evaluate(candidate)).resolves.toMatchObject({
      status: 'protected',
      reasons: ['protected-evidence-binding-mismatch'],
      releaseAuthority: 'none',
    })
    expect(materializeExisting).toHaveBeenCalledOnce()

    const undeclared = {
      ...candidate,
      diff: { ...candidate.diff, changedPaths: ['SKILL.md'] },
    } as ExistingSkillCandidate
    const undeclaredDiffAdmission = new ExistingSkillCandidateAdmission({
      policies: [{
        id: 'workspace-diff-drift',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(exactRoot, 'governance-diff'),
        runRoot: join(exactRoot, 'runs-diff'),
      }],
      baselines: { resolveBaseline },
      candidates: { materializeExisting },
      evidence: { readForGovernance },
    })
    await expect(undeclaredDiffAdmission.evaluate(undeclared)).resolves.toMatchObject({
      status: 'protected',
      reasons: ['undeclared-tree-difference'],
      releaseAuthority: 'none',
    })

    let baselineReady = false
    const recoveredAdmission = new ExistingSkillCandidateAdmission({
      policies: [{
        id: 'workspace-recovered',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(exactRoot, 'governance-recovered'),
        runRoot: join(exactRoot, 'runs-recovered'),
      }],
      baselines: {
        resolveBaseline: async () => {
          if (!baselineReady) throw new Error('baseline service is starting')
          return await resolveBaseline()
        },
      },
      candidates: { materializeExisting },
      evidence: { readForGovernance },
    })
    await expect(recoveredAdmission.evaluate(candidate)).resolves.toMatchObject({
      status: 'incomplete',
      reasons: ['baseline-unavailable'],
    })
    baselineReady = true
    await expect(recoveredAdmission.evaluate(candidate)).resolves.toMatchObject({
      status: 'qualified-for-holdout',
      reasons: ['exact-paired-subjects-admitted'],
    })
  })

  it('uses native Jobs to resume durable existing-Skill Candidates', async () => {
    const baseline = await assembleSealedSkillBundleArchive(
      skillFiles('Verify the release.', 'Check the release.'),
    )
    const improved = await assembleSealedSkillBundleArchive(skillFiles(
      'Verify the release with independent evidence.',
      'Require independent evidence before declaring success.',
    ))
    const candidate = existingCandidate(baseline, improved)
    const evaluate = vi.fn(async (value: ExistingSkillCandidate) => ({
      schemaVersion: 1 as const,
      id: 'f'.repeat(64),
      candidateId: value.id,
      workspaceId: value.workspaceId,
      skillName: value.skillName,
      status: 'incomplete' as const,
      reasons: ['evaluation-failed' as const],
      releaseAuthority: 'none' as const,
    }))
    const scheduler = new ExistingSkillCandidateAdmissionScheduler(
      { matches: () => true, evaluate },
      { listExistingCandidates: () => [candidate] },
    )
    const jobs = fakeJobs()

    const detach = scheduler.attachJobs(jobs.registry)

    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'existing Skill paired admission: release-proof',
    })
    await jobs.hooks[0]!.done
    expect(evaluate).toHaveBeenCalledWith(candidate, { signal: expect.any(AbortSignal) })
    detach()
  })
})

function skillFiles(description: string, guide: string): SkillBundleArchiveFile[] {
  return [
    {
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from([
        '---',
        'name: release-proof',
        `description: ${description}`,
        'license: MIT',
        '---',
        '',
        'Follow [the guide](references/guide.md).',
        '',
      ].join('\n')),
    },
    {
      path: 'references/guide.md',
      mode: '100644',
      content: Buffer.from(`# Guide\n\n${guide}\n`),
    },
    {
      path: 'assets/proof.png',
      mode: '100644',
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    },
  ]
}

function existingCandidate(
  baseline: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
  candidate: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): ExistingSkillCandidate {
  const input: ExistingSkillCandidateInput = {
    kind: 'existing-skill-improvement-candidate-v1',
    createdAt: 1_787_100_000_000,
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    description: 'Verify the release with independent evidence.',
    opportunity: {
      kind: 'internal-existing-skill-correction-v1',
      id: '1'.repeat(64),
      signalCount: 4,
      goalCount: 4,
    },
    baseline: {
      qualificationId: '7'.repeat(64),
      id: '8'.repeat(64),
      artifactDigest: baseline.artifactDigest,
      treeHash: baseline.treeHash,
    },
    authorship: {
      kind: 'protected-correction-authoring-v1',
      policyId: 'workspace-experience-author',
      modelIdentityHash: '9'.repeat(64),
      evaluationEvidenceId: 'a'.repeat(64),
      inputDigest: 'b'.repeat(64),
      claim: 'Require independent evidence.',
    },
    scope: 'workspace',
    version: {
      kind: 'existing-skill-improvement-bundle-v1',
      parentBaselineId: '8'.repeat(64),
      artifactDigest: candidate.artifactDigest,
      treeHash: candidate.treeHash,
    },
    contentHash: candidate.artifactDigest,
    diff: {
      kind: 'bounded-instruction-tree-diff-v1',
      changedPaths: ['references/guide.md', 'SKILL.md'],
      addedPaths: [],
      preservedFileCount: 1,
      preservedBinaryFileCount: 1,
    },
    package: {
      path: 'release-proof',
      fileCount: candidate.files.length,
      totalBytes: candidate.totalBytes,
      hasExecutableFiles: false,
    },
    permissions: {
      declared: false,
      executableContentChanged: false,
      externalEffects: 'unchanged-or-unknown',
    },
    license: { status: 'declared', value: 'MIT' },
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
      digest: candidate.artifactDigest,
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
    releaseAuthority: 'none',
  }
  return { schemaVersion: 1, id: existingSkillCandidateId(input), ...input }
}

function evidenceSample(role: 'authoring' | 'holdout', suffix: string) {
  return {
    role,
    goal: { id: `goal-${suffix}`, revision: 1, objective: `Objective ${suffix}` },
    request: {
      text: `Request ${suffix}`,
      representation: 'durable-user-text-v1' as const,
      omittedNonText: false,
    },
    correction: { note: `Correction ${suffix}`, sourceUpdatedAt: Number(suffix) },
    source: {
      feedbackSignalId: suffix.repeat(64),
      sessionId: `session-${suffix}`,
      messageId: `message-${suffix}`,
      feedbackVersion: `0198f4b4-b664-7000-8000-00000000000${suffix}`,
      assistantSeq: 5,
      invocationSeq: 4,
      route: 'model-tool' as const,
    },
  }
}

function fakeJobs() {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  return {
    starts,
    hooks,
    registry: {
      start(spec: JobStart) {
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${starts.length}`
      },
    } as never,
  }
}
