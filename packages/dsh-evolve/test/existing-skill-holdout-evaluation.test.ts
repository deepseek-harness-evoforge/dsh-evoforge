import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillHoldoutEvaluation,
  ExistingSkillHoldoutEvaluationScheduler,
  type ExistingSkillHoldoutTrialInput,
} from '../src/existing-skill-holdout-evaluation.ts'
import type { ExistingSkillCandidateAdmissionResult } from '../src/existing-skill-candidate-admission.ts'
import type { ExistingSkillCandidate } from '../src/skill-candidate-repository.ts'
import { assembleSealedSkillBundleArchive, type SkillBundleArchiveFile } from '../src/skill-bundle-archive.ts'
import { hashTree } from '../src/hash.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Existing Skill Holdout Evaluation', () => {
  it('runs one exact assembled skill-tree pair and durably records an improvement verdict', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-trial-')))
    roots.push(root)
    const baselineFiles: SkillBundleArchiveFile[] = [
      {
        path: 'SKILL.md',
        mode: '100644',
        content: Buffer.from('---\nname: release-proof\ndescription: Verify a release.\n---\n\nUse the guide.\n'),
      },
      {
        path: 'references/guide.md',
        mode: '100644',
        content: Buffer.from('# Guide\n\nCheck the release.\n'),
      },
      {
        path: 'assets/proof.png',
        mode: '100644',
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
      },
    ]
    const candidateFiles: SkillBundleArchiveFile[] = baselineFiles.map(file => ({
      ...file,
      content: file.path === 'SKILL.md'
        ? Buffer.from('---\nname: release-proof\ndescription: Verify independently.\n---\n\nUse the guide with an independent reviewer.\n')
        : Buffer.from(file.content),
    }))
    const [baselineArchive, candidateArchive] = await Promise.all([
      assembleSealedSkillBundleArchive(baselineFiles),
      assembleSealedSkillBundleArchive(candidateFiles),
    ])
    const candidate = existingCandidate(baselineArchive, candidateArchive)
    const admission = admitted(candidate, baselineArchive, candidateArchive)
    const casePackDir = join(root, 'governance', 'case-pack')
    await writeCasePack(casePackDir)
    const casePackHash = await hashTree(casePackDir)
    const envelope = {
      id: 'd'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      qualificationId: candidate.baseline.qualificationId,
      baselineId: candidate.baseline.id,
      baselineTreeHash: candidate.baseline.treeHash,
      evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      proposerModelIdentityHash: candidate.authorship.modelIdentityHash,
      casePackDir,
      casePackHash,
      dshRevision: 'a'.repeat(40),
      releaseAuthority: 'none' as const,
    }
    const runTrial = vi.fn(async (input: ExistingSkillHoldoutTrialInput) => {
      expect(input.baselineKind).toBe('skill-tree')
      expect(input.trial.dshAssembled).toBe(true)
      expect(input.trial.capabilityAbsentBaseline).toBeUndefined()
      expect(await readFile(join(input.skillDir, 'assets/proof.png'))).toEqual(baselineFiles[2]!.content)
      expect(await readFile(join(input.candidateSkillDir, 'assets/proof.png'))).toEqual(candidateFiles[2]!.content)
      return {
        backend: 'darwin-seatbelt' as const,
        count: 4 as const,
        assembled: true,
        calibration: [
          { id: 'known-bad' as const, expected: 'fail' as const, actual: 'fail' as const, passed: true },
          { id: 'known-correction' as const, expected: 'pass' as const, actual: 'pass' as const, passed: true },
        ],
        baseline: {
          passed: false,
          checks: [{ name: 'independent-proof', passed: false }],
          treeHash: await hashTree(input.skillDir),
          composition: {
            fingerprint: 'f'.repeat(64),
            modelCalls: 1,
            usage: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 40 },
          },
        },
        candidate: {
          passed: true,
          checks: [{ name: 'independent-proof', passed: true }],
          treeHash: await hashTree(input.candidateSkillDir),
          composition: {
            fingerprint: 'f'.repeat(64),
            modelCalls: 1,
            usage: { inputTokens: 110, outputTokens: 18, cacheReadTokens: 50 },
          },
        },
      }
    })
    const materializeExisting = vi.fn(async (_candidate: ExistingSkillCandidate, outputDir: string) => {
      await materialize(outputDir, candidateFiles)
      return {
        candidateId: candidate.id,
        path: outputDir,
        contentHash: candidate.contentHash,
        treeHash: candidate.version.treeHash,
        files: candidateFiles.map(file => ({
          path: file.path,
          mode: file.mode,
          size: file.content.byteLength,
        })),
      }
    })
    const evaluation = new ExistingSkillHoldoutEvaluation({
      policies: [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
        dshRevision: envelope.dshRevision,
        maxAttemptsPerUtcDay: 1,
      }],
      baselines: {
        resolveBaseline: vi.fn(async () => ({
          manifest: baselineManifest(baselineArchive),
          files: baselineArchive.files,
        })),
      },
      candidates: { materializeExisting },
      governance: { resolve: vi.fn(async () => envelope) },
      runTrial,
      now: () => 1_787_270_400_000,
    })

    const result = await evaluation.evaluate(candidate, admission)

    expect(result).toMatchObject({
      candidateId: candidate.id,
      admissionId: admission.id,
      envelopeId: envelope.id,
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      status: 'complete',
      verdict: 'improved',
      reason: 'candidate-passed-protected-holdout',
      evidence: {
        baselineTreeHash: baselineArchive.treeHash,
        candidateTreeHash: candidateArchive.treeHash,
        casePackHash,
        baseline: 'fail',
        candidate: 'pass',
        calibrationPassed: true,
        assembled: true,
        compositionStable: true,
        inputIntegrityStable: true,
        proposerCalls: 0,
        trialCount: 4,
        modelCalls: { baseline: 1, candidate: 1 },
        usage: {
          baseline: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 40 },
          candidate: { inputTokens: 110, outputTokens: 18, cacheReadTokens: 50 },
        },
      },
      releaseAuthority: 'none',
    })
    await expect(evaluation.evaluate(candidate, admission)).resolves.toEqual(result)
    expect(runTrial).toHaveBeenCalledOnce()
    expect(materializeExisting).toHaveBeenCalledOnce()
    await expect(evaluation.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      results: [{
        candidateId: candidate.id,
        status: 'complete',
        verdict: 'improved',
        releaseAuthority: 'none',
      }],
    })
  })

  it('does not blindly repeat a paid Trial left pending by interruption', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-resume-')))
    roots.push(root)
    const baselineFiles: SkillBundleArchiveFile[] = [{
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from('---\nname: release-proof\ndescription: Verify.\n---\n\nCheck once.\n'),
    }]
    const candidateFiles: SkillBundleArchiveFile[] = [{
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from('---\nname: release-proof\ndescription: Verify independently.\n---\n\nCheck twice.\n'),
    }]
    const [baselineArchive, candidateArchive] = await Promise.all([
      assembleSealedSkillBundleArchive(baselineFiles),
      assembleSealedSkillBundleArchive(candidateFiles),
    ])
    const candidate = existingCandidate(baselineArchive, candidateArchive)
    const admission = admitted(candidate, baselineArchive, candidateArchive)
    const casePackDir = join(root, 'governance', 'case-pack')
    await writeCasePack(casePackDir)
    const controller = new AbortController()
    const runTrial = vi.fn(async () => {
      controller.abort(new Error('simulated resident shutdown'))
      throw controller.signal.reason
    })
    const materializeExisting = vi.fn(async (_candidate: ExistingSkillCandidate, outputDir: string) => {
      await materialize(outputDir, candidateFiles)
      return {
        candidateId: candidate.id,
        path: outputDir,
        contentHash: candidate.contentHash,
        treeHash: candidate.version.treeHash,
        files: candidateFiles.map(file => ({
          path: file.path,
          mode: file.mode,
          size: file.content.byteLength,
        })),
      }
    })
    const evaluation = new ExistingSkillHoldoutEvaluation({
      policies: [{
        id: 'workspace-resume-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
        dshRevision: 'a'.repeat(40),
      }],
      baselines: {
        resolveBaseline: async () => ({
          manifest: baselineManifest(baselineArchive),
          files: baselineArchive.files,
        }),
      },
      candidates: { materializeExisting },
      governance: {
        resolve: async () => ({
          id: 'd'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: candidate.skillName,
          opportunityId: candidate.opportunity.id,
          qualificationId: candidate.baseline.qualificationId,
          baselineId: candidate.baseline.id,
          baselineTreeHash: candidate.baseline.treeHash,
          evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
          proposerModelIdentityHash: candidate.authorship.modelIdentityHash,
          casePackDir,
          casePackHash: await hashTree(casePackDir),
          dshRevision: 'a'.repeat(40),
          releaseAuthority: 'none',
        }),
      },
      runTrial,
    })

    await expect(evaluation.evaluate(candidate, admission, { signal: controller.signal }))
      .rejects.toThrow('simulated resident shutdown')
    await expect(evaluation.evaluate(candidate, admission)).resolves.toMatchObject({
      status: 'incomplete',
      verdict: 'none',
      reason: 'paired-trial-outcome-uncertain',
      releaseAuthority: 'none',
    })
    expect(runTrial).toHaveBeenCalledOnce()
    expect(materializeExisting).toHaveBeenCalledOnce()
  })

  it('rejects a Holdout Envelope not bound into the exact Candidate before Trial', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-binding-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const runTrial = vi.fn(async (input: ExistingSkillHoldoutTrialInput) => pairedTrial(input, false, true))
    const evaluation = fixtureEvaluation(fixture, runTrial)
    const mismatchedCandidate = {
      ...fixture.candidate,
      authorship: {
        ...fixture.candidate.authorship,
        holdoutEnvelopeId: 'e'.repeat(64),
      },
    } as ExistingSkillCandidate

    await expect(evaluation.evaluate(mismatchedCandidate, fixture.admission))
      .rejects.toThrow('does not bind the exact Candidate')
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('keeps a readable legacy Candidate without an Envelope binding out of Trial', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-legacy-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const runTrial = vi.fn(async (input: ExistingSkillHoldoutTrialInput) => pairedTrial(input, false, true))
    const evaluation = fixtureEvaluation(fixture, runTrial)
    const { holdoutEnvelopeId: _legacyMissing, ...legacyAuthorship } = fixture.candidate.authorship
    const legacyCandidate = {
      ...fixture.candidate,
      authorship: legacyAuthorship,
    } as ExistingSkillCandidate

    await expect(evaluation.evaluate(legacyCandidate, fixture.admission))
      .rejects.toThrow('has no pre-Candidate holdout Envelope binding')
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('protects the pair before Trial when the materialized Candidate drifts', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-drift-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const runTrial = vi.fn()
    const evaluation = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: {
        resolveBaseline: async () => ({
          manifest: baselineManifest(fixture.baseline),
          files: fixture.baseline.files,
        }),
      },
      candidates: {
        materializeExisting: async (_candidate, outputDir) => {
          await materialize(outputDir, fixture.baseline.files)
          return {
            candidateId: fixture.candidate.id,
            path: outputDir,
            contentHash: fixture.candidate.contentHash,
            treeHash: fixture.candidate.version.treeHash,
            files: fixture.baseline.files.map(file => ({
              path: file.path, mode: file.mode, size: file.content.byteLength,
            })),
          }
        },
      },
      governance: { resolve: async () => fixture.envelope },
      runTrial,
    })

    await expect(evaluation.evaluate(fixture.candidate, fixture.admission)).resolves.toMatchObject({
      status: 'protected',
      verdict: 'none',
      reason: 'evaluation-input-protected',
      releaseAuthority: 'none',
    })
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('rejects a durable verdict whose classification no longer matches its evidence', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-verdict-drift-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const evaluation = fixtureEvaluation(
      fixture,
      input => pairedTrial(input, false, true),
    )
    const result = await evaluation.evaluate(fixture.candidate, fixture.admission)
    const tampered = JSON.parse(await readFile(result.reportPath, 'utf8')) as Record<string, unknown>
    tampered.reason = 'candidate-regressed-protected-holdout'
    await writeFile(result.reportPath, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(evaluation.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 1,
      results: [],
    })
    await expect(evaluation.evaluate(fixture.candidate, fixture.admission))
      .rejects.toThrow('invalid classification')
  })

  it.each([
    { baselinePassed: true, candidatePassed: true, verdict: 'ambiguous', reason: 'baseline-already-passed-protected-holdout' },
    { baselinePassed: false, candidatePassed: false, verdict: 'not-improved', reason: 'candidate-did-not-fix-protected-holdout' },
    { baselinePassed: true, candidatePassed: false, verdict: 'regressed', reason: 'candidate-regressed-protected-holdout' },
  ] as const)('classifies the protected pair as $verdict', async ({
    baselinePassed,
    candidatePassed,
    verdict,
    reason,
  }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-verdict-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const evaluation = fixtureEvaluation(fixture, async input => pairedTrial(
      input,
      baselinePassed,
      candidatePassed,
    ))

    await expect(evaluation.evaluate(fixture.candidate, fixture.admission)).resolves.toMatchObject({
      status: 'complete',
      verdict,
      reason,
      releaseAuthority: 'none',
    })
  })

  it('fails closed when a Trial mutates an exact subject after dispatch', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-holdout-post-drift-')))
    roots.push(root)
    const fixture = await minimalHoldoutFixture(root)
    const evaluation = fixtureEvaluation(fixture, async input => {
      const result = await pairedTrial(input, false, true)
      await writeFile(join(input.candidateSkillDir, 'SKILL.md'), 'mutated by Trial\n')
      return result
    })

    await expect(evaluation.evaluate(fixture.candidate, fixture.admission)).resolves.toMatchObject({
      status: 'incomplete',
      verdict: 'none',
      reason: 'paired-trial-integrity-failed',
      evidence: { inputIntegrityStable: false },
      releaseAuthority: 'none',
    })
  })

  it('resumes qualified durable pairs only through native DSH Jobs', async () => {
    const baseline = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md', mode: '100644', content: Buffer.from('baseline\n'),
    }])
    const improved = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md', mode: '100644', content: Buffer.from('candidate\n'),
    }])
    const candidate = existingCandidate(baseline, improved)
    const admission = admitted(candidate, baseline, improved)
    let releaseEvaluation!: () => void
    const evaluationGate = new Promise<void>(resolve => { releaseEvaluation = resolve })
    const evaluate = vi.fn(async () => {
      await evaluationGate
      return {
        schemaVersion: 1 as const,
        kind: 'existing-skill-holdout-evaluation-result-v1' as const,
        id: 'e'.repeat(64),
        candidateId: candidate.id,
        admissionId: admission.id,
        envelopeId: 'd'.repeat(64),
        workspaceId: candidate.workspaceId,
        skillName: candidate.skillName,
        status: 'complete' as const,
        verdict: 'improved' as const,
        reason: 'candidate-passed-protected-holdout' as const,
        reportPath: '/private/existing-skill-holdout/result.json',
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        releaseAuthority: 'none' as const,
      }
    })
    const scheduler = new ExistingSkillHoldoutEvaluationScheduler(
      { matches: () => true, evaluate },
      { listExistingCandidates: () => [candidate] },
      { scan: async () => ({ configuredPolicyCount: 1, warningCount: 0, results: [admission] }) },
    )
    const jobs = fakeJobs()

    scheduler.observe(candidate, admission)
    expect(jobs.starts).toHaveLength(0)
    const detach = scheduler.attachJobs(jobs.registry)

    await vi.waitFor(() => expect(jobs.starts).toHaveLength(1))
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'existing Skill protected holdout: release-proof',
    })
    scheduler.observe(candidate, admission)
    expect(jobs.starts).toHaveLength(1)
    releaseEvaluation()
    await jobs.hooks[0]!.done
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(jobs.starts).toHaveLength(1)
    expect(evaluate).toHaveBeenCalledWith(candidate, admission, { signal: expect.any(AbortSignal) })
    detach()
  })

  it('keeps a readable legacy Candidate without an Envelope binding out of native Jobs', async () => {
    const baseline = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md', mode: '100644', content: Buffer.from('baseline\n'),
    }])
    const improved = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md', mode: '100644', content: Buffer.from('candidate\n'),
    }])
    const candidate = existingCandidate(baseline, improved)
    const { holdoutEnvelopeId: _legacyMissing, ...legacyAuthorship } = candidate.authorship
    const legacyCandidate = { ...candidate, authorship: legacyAuthorship } as ExistingSkillCandidate
    const admission = admitted(legacyCandidate, baseline, improved)
    const evaluate = vi.fn()
    const scheduler = new ExistingSkillHoldoutEvaluationScheduler(
      { matches: () => true, evaluate },
      { listExistingCandidates: () => [legacyCandidate] },
      { scan: async () => ({ configuredPolicyCount: 1, warningCount: 0, results: [admission] }) },
    )
    const jobs = fakeJobs()

    const detach = scheduler.attachJobs(jobs.registry)
    await scheduler.reconcile()

    expect(jobs.starts).toHaveLength(0)
    expect(evaluate).not.toHaveBeenCalled()
    detach()
  })
})

async function writeCasePack(root: string): Promise<void> {
  await mkdir(join(root, 'final-test'), { recursive: true })
  await mkdir(join(root, 'calibration', 'known-bad'), { recursive: true })
  await mkdir(join(root, 'calibration', 'known-correction'), { recursive: true })
  await writeFile(join(root, 'final-test', 'evaluator.mjs'), 'process.stdout.write("{}")\n')
  await writeFile(join(root, 'calibration', 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(root, 'calibration', 'known-correction', 'SKILL.md'), 'good\n')
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'existing-holdout-test',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: 'b'.repeat(64) },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 12_000, outputTokenLimit: 4_000 },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 30_000,
      outputLimitBytes: 256 * 1024,
      dshAssembled: true,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }, null, 2)}\n`)
}

async function materialize(root: string, files: readonly SkillBundleArchiveFile[]): Promise<void> {
  for (const file of files) {
    const path = join(root, ...file.path.split('/'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, file.content)
  }
}

function baselineManifest(archive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>) {
  return {
    schemaVersion: 1 as const,
    kind: 'installed-skill-baseline-v1' as const,
    id: '8'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    invocationContentHash: '2'.repeat(64),
    provider: 'native-test-provider',
    source: '/sealed/provider/release-proof/SKILL.md',
    definitionDigest: '9'.repeat(64),
    createdAt: 1,
    bundle: {
      format: 'tar.gz' as const,
      artifactDigest: archive.artifactDigest,
      treeHash: archive.treeHash,
      fileCount: archive.files.length,
      totalBytes: archive.totalBytes,
      hasExecutableFiles: false as const,
    },
    releaseAuthority: 'none' as const,
  }
}

function existingCandidate(
  baseline: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
  candidate: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): ExistingSkillCandidate {
  return {
    schemaVersion: 1,
    kind: 'existing-skill-improvement-candidate-v1',
    id: '0'.repeat(64),
    createdAt: 1,
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    description: 'Verify independently.',
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
      policyId: 'workspace-self-discovery',
      modelIdentityHash: 'c'.repeat(64),
      evaluationEvidenceId: 'a'.repeat(64),
      inputDigest: 'b'.repeat(64),
      holdoutEnvelopeId: 'd'.repeat(64),
      claim: 'Require an independent reviewer.',
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
      changedPaths: ['SKILL.md'],
      addedPaths: [],
      preservedFileCount: 2,
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
      digest: candidate.artifactDigest,
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
    releaseAuthority: 'none',
  }
}

function admitted(
  candidate: ExistingSkillCandidate,
  baseline: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
  candidateArchive: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
): ExistingSkillCandidateAdmissionResult {
  return {
    schemaVersion: 1,
    id: '6'.repeat(64),
    candidateId: candidate.id,
    workspaceId: candidate.workspaceId,
    skillName: candidate.skillName,
    status: 'qualified-for-holdout',
    reasons: ['exact-paired-subjects-admitted'],
    evidence: {
      baselineId: candidate.baseline.id,
      baselineArtifactDigest: baseline.artifactDigest,
      baselineTreeHash: baseline.treeHash,
      candidateArtifactDigest: candidateArchive.artifactDigest,
      candidateTreeHash: candidateArchive.treeHash,
      evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      protectedAdmissionSampleHash: '9'.repeat(64),
      protectedAdmissionSampleCount: 1,
      changedFileCount: 1,
      addedFileCount: 0,
      preservedFileCount: 2,
      preservedBinaryFileCount: 1,
      candidateExecuted: false,
      evaluatorClass: 'host-structural',
    },
    releaseAuthority: 'none',
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

async function minimalHoldoutFixture(root: string) {
  const baselineFiles: SkillBundleArchiveFile[] = [{
    path: 'SKILL.md', mode: '100644', content: Buffer.from('baseline\n'),
  }]
  const candidateFiles: SkillBundleArchiveFile[] = [{
    path: 'SKILL.md', mode: '100644', content: Buffer.from('candidate\n'),
  }]
  const [baseline, candidateArchive] = await Promise.all([
    assembleSealedSkillBundleArchive(baselineFiles),
    assembleSealedSkillBundleArchive(candidateFiles),
  ])
  const candidate = existingCandidate(baseline, candidateArchive)
  const admission = admitted(candidate, baseline, candidateArchive)
  const casePackDir = join(root, 'governance', 'case-pack')
  await writeCasePack(casePackDir)
  const policy = {
    id: 'workspace-drift-governance',
    workspaceId: WORKSPACE_ID,
    governanceRoot: join(root, 'governance'),
    runRoot: join(root, 'runs'),
    dshRevision: 'a'.repeat(40),
  }
  return {
    baseline,
    baselineFiles,
    candidateArchive,
    candidateFiles,
    candidate,
    admission,
    policy,
    envelope: {
      id: 'd'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      qualificationId: candidate.baseline.qualificationId,
      baselineId: candidate.baseline.id,
      baselineTreeHash: candidate.baseline.treeHash,
      evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
      proposerModelIdentityHash: candidate.authorship.modelIdentityHash,
      casePackDir,
      casePackHash: await hashTree(casePackDir),
      dshRevision: policy.dshRevision,
      releaseAuthority: 'none' as const,
    },
  }
}

function fixtureEvaluation(
  fixture: Awaited<ReturnType<typeof minimalHoldoutFixture>>,
  runTrial: (input: ExistingSkillHoldoutTrialInput) => Promise<Awaited<ReturnType<typeof pairedTrial>>>,
) {
  return new ExistingSkillHoldoutEvaluation({
    policies: [fixture.policy],
    baselines: {
      resolveBaseline: async () => ({
        manifest: baselineManifest(fixture.baseline),
        files: fixture.baseline.files,
      }),
    },
    candidates: {
      materializeExisting: async (_candidate, outputDir) => {
        await materialize(outputDir, fixture.candidateFiles)
        return {
          candidateId: fixture.candidate.id,
          path: outputDir,
          contentHash: fixture.candidate.contentHash,
          treeHash: fixture.candidate.version.treeHash,
          files: fixture.candidateFiles.map(file => ({
            path: file.path, mode: file.mode, size: file.content.byteLength,
          })),
        }
      },
    },
    governance: { resolve: async () => fixture.envelope },
    runTrial,
  })
}

async function pairedTrial(
  input: ExistingSkillHoldoutTrialInput,
  baselinePassed: boolean,
  candidatePassed: boolean,
) {
  return {
    backend: 'darwin-seatbelt' as const,
    count: 4 as const,
    assembled: true,
    calibration: [
      { id: 'known-bad' as const, expected: 'fail' as const, actual: 'fail' as const, passed: true },
      { id: 'known-correction' as const, expected: 'pass' as const, actual: 'pass' as const, passed: true },
    ],
    baseline: {
      passed: baselinePassed,
      checks: [{ name: 'protected-case', passed: baselinePassed }],
      treeHash: await hashTree(input.skillDir),
      composition: {
        fingerprint: 'f'.repeat(64),
        modelCalls: 1,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
      },
    },
    candidate: {
      passed: candidatePassed,
      checks: [{ name: 'protected-case', passed: candidatePassed }],
      treeHash: await hashTree(input.candidateSkillDir),
      composition: {
        fingerprint: 'f'.repeat(64),
        modelCalls: 1,
        usage: { inputTokens: 90, outputTokens: 18, cacheReadTokens: 40 },
      },
    },
  }
}
