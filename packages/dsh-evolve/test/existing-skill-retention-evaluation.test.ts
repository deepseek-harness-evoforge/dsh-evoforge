import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExistingSkillCandidateAdmissionResult } from '../src/existing-skill-candidate-admission.ts'
import {
  ExistingSkillHoldoutEvaluation,
  type ExistingSkillHoldoutTrialInput,
} from '../src/existing-skill-holdout-evaluation.ts'
import {
  ExistingSkillRetentionEvaluation,
  ExistingSkillRetentionEvaluationScheduler,
  type ExistingSkillRetentionTrialInput,
} from '../src/existing-skill-retention-evaluation.ts'
import { hashTree } from '../src/hash.ts'
import {
  assembleSealedSkillBundleArchive,
  type SkillBundleArchiveFile,
} from '../src/skill-bundle-archive.ts'
import type { ExistingSkillCandidate } from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Existing Skill Retention Evaluation', () => {
  it('runs the exact pre-Candidate Retention pair after an improved Holdout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdoutTrial = vi.fn((input: ExistingSkillHoldoutTrialInput) => pairedTrial(input, false, true))
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: holdoutTrial,
      now: () => 1_000,
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retentionTrial = vi.fn((input: ExistingSkillRetentionTrialInput) => pairedTrial(input, false, true))
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: retentionTrial,
      now: () => 2_000,
    })

    const result = await retention.evaluate(fixture.candidate, holdoutResult)

    expect(holdoutTrial).toHaveBeenCalledOnce()
    expect(retentionTrial).toHaveBeenCalledOnce()
    expect(retentionTrial).toHaveBeenCalledWith(expect.objectContaining({
      baselineKind: 'skill-tree',
      casePackDir: await realpath(fixture.retentionCasePackDir),
      dshRevision: fixture.policy.dshRevision,
      trialLimit: 4,
    }))
    expect(retentionTrial.mock.calls[0]![0].casePackDir)
      .not.toBe(holdoutTrial.mock.calls[0]![0].casePackDir)
    expect(result).toMatchObject({
      candidateId: fixture.candidate.id,
      holdoutEvaluationId: holdoutResult.id,
      admissionId: fixture.admission.id,
      envelopeId: fixture.envelope.id,
      status: 'complete',
      verdict: 'retained',
      reason: 'candidate-passed-protected-retention',
      evidence: {
        baselineTreeHash: fixture.baseline.treeHash,
        candidateTreeHash: fixture.candidateArchive.treeHash,
        casePackHash: fixture.envelope.retentionCasePackHash,
        baseline: 'fail',
        candidate: 'pass',
        calibrationPassed: true,
        assembled: true,
        compositionStable: true,
        inputIntegrityStable: true,
        proposerCalls: 0,
        trialCount: 4,
      },
      releaseAuthority: 'none',
    })
    await expect(retention.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      results: [{
        id: result.id,
        candidateId: fixture.candidate.id,
        holdoutEvaluationId: holdoutResult.id,
        status: 'complete',
        verdict: 'retained',
        releaseAuthority: 'none',
      }],
    })
  })

  it('prepares the exact retained trees and sealed Case Pack for a later failed-Outcome Canary', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-canary-replay-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: input => pairedTrial(input, false, true),
    })
    const retained = await retention.evaluate(fixture.candidate, holdoutResult)
    const outputDir = join(root, 'canary-replay')

    const replay = await retention.prepareCanaryReplay(fixture.candidate, retained.id, outputDir)

    expect(replay).toMatchObject({
      candidateId: fixture.candidate.id,
      retentionEvaluationId: retained.id,
      holdoutEvaluationId: holdoutResult.id,
      admissionId: fixture.admission.id,
      envelopeId: fixture.envelope.id,
      workspaceId: WORKSPACE_ID,
      skillName: fixture.candidate.skillName,
      baselineTreeHash: fixture.baseline.treeHash,
      candidateTreeHash: fixture.candidateArchive.treeHash,
      holdoutCasePackHash: fixture.envelope.casePackHash,
      retentionCasePackHash: fixture.envelope.retentionCasePackHash,
      dshRevision: fixture.policy.dshRevision,
      releaseAuthority: 'none',
      trial: {
        baselineKind: 'skill-tree',
        casePackDir: await realpath(fixture.retentionCasePackDir),
        outputDir,
        trialLimit: 4,
      },
    })
    await expect(hashTree(replay.baselineDir)).resolves.toBe(fixture.baseline.treeHash)
    await expect(hashTree(replay.candidateDir)).resolves.toBe(fixture.candidateArchive.treeHash)
  })

  it('abstains without a fifth-Goal Retention partition and spends no Trial', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-no-retention-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const {
      retentionCasePackDir: _retentionDir,
      retentionCasePackHash: _retentionHash,
      ...holdoutOnlyEnvelope
    } = fixture.envelope
    const governance = { resolve: async () => holdoutOnlyEnvelope }
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const runTrial = vi.fn()
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance,
      holdouts: holdout,
      runTrial,
    })

    await expect(retention.evaluate(fixture.candidate, holdoutResult)).resolves.toMatchObject({
      candidateId: fixture.candidate.id,
      holdoutEvaluationId: holdoutResult.id,
      envelopeId: holdoutOnlyEnvelope.id,
      status: 'abstained',
      verdict: 'none',
      reason: 'no-independent-retention-case',
      releaseAuthority: 'none',
    })
    expect(runTrial).not.toHaveBeenCalled()
    await expect(retention.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      results: [],
    })
  })

  it.each([
    {
      baselinePassed: true,
      candidatePassed: true,
      verdict: 'ambiguous',
      reason: 'baseline-already-passed-protected-retention',
    },
    {
      baselinePassed: false,
      candidatePassed: false,
      verdict: 'not-retained',
      reason: 'candidate-did-not-retain-protected-case',
    },
    {
      baselinePassed: true,
      candidatePassed: false,
      verdict: 'regressed',
      reason: 'candidate-regressed-protected-retention',
    },
  ] as const)('classifies the independent Retention pair as $verdict', async ({
    baselinePassed,
    candidatePassed,
    verdict,
    reason,
  }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-verdict-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: input => pairedTrial(input, baselinePassed, candidatePassed),
    })

    await expect(retention.evaluate(fixture.candidate, holdoutResult)).resolves.toMatchObject({
      status: 'complete',
      verdict,
      reason,
      evidence: {
        baseline: baselinePassed ? 'pass' : 'fail',
        candidate: candidatePassed ? 'pass' : 'fail',
      },
      releaseAuthority: 'none',
    })
  })

  it('resumes improved Holdouts only through native DSH Jobs', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-jobs-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    let releaseTrial!: () => void
    const trialGate = new Promise<void>(resolve => { releaseTrial = resolve })
    const runTrial = vi.fn(async (input: ExistingSkillRetentionTrialInput) => {
      await trialGate
      return pairedTrial(input, false, true)
    })
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial,
    })
    const scheduler = new ExistingSkillRetentionEvaluationScheduler(
      retention,
      { listExistingCandidates: () => [fixture.candidate] },
      holdout,
    )
    const jobs = fakeJobs()

    scheduler.observe(fixture.candidate, holdoutResult)
    expect(jobs.starts).toHaveLength(0)
    const detach = scheduler.attachJobs(jobs.registry)

    await vi.waitFor(() => expect(jobs.starts).toHaveLength(1))
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'existing Skill protected Retention: release-proof',
    })
    scheduler.observe(fixture.candidate, holdoutResult)
    expect(jobs.starts).toHaveLength(1)
    releaseTrial()
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'complete:retained',
    })
    expect(runTrial).toHaveBeenCalledOnce()
    detach()
  })

  it('fails closed when any bound governance input drifts during Retention', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-drift-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: async input => {
        const result = await pairedTrial(input, false, true)
        await writeFile(
          join(fixture.envelope.casePackDir, 'final-test', 'evaluator.mjs'),
          'process.stdout.write("mutated")\n',
        )
        return result
      },
    })

    await expect(retention.evaluate(fixture.candidate, holdoutResult)).resolves.toMatchObject({
      status: 'incomplete',
      verdict: 'none',
      reason: 'paired-trial-integrity-failed',
      evidence: {
        inputIntegrityStable: false,
      },
      releaseAuthority: 'none',
    })
  })

  it('rejects malformed durable cost evidence instead of projecting it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-cost-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: input => pairedTrial(input, false, true),
    })
    const result = await retention.evaluate(fixture.candidate, holdoutResult)
    const tampered = JSON.parse(await readFile(result.reportPath!, 'utf8')) as {
      evidence: { modelCalls: { baseline: number } }
    }
    tampered.evidence.modelCalls.baseline = -1
    await writeFile(result.reportPath!, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(retention.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 1,
      results: [],
    })
    await expect(retention.evaluate(fixture.candidate, holdoutResult))
      .rejects.toThrow('invalid evidence')
  })

  it('rejects a retained verdict when a durable integrity gate is false', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-gate-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const retention = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: input => pairedTrial(input, false, true),
    })
    const result = await retention.evaluate(fixture.candidate, holdoutResult)
    const tampered = JSON.parse(await readFile(result.reportPath!, 'utf8')) as {
      evidence: { calibrationPassed: boolean }
    }
    tampered.evidence.calibrationPassed = false
    await writeFile(result.reportPath!, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(retention.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 1,
      results: [],
    })
    await expect(retention.evaluate(fixture.candidate, holdoutResult))
      .rejects.toThrow('invalid classification')
  })

  it('does not repeat an unobserved paid Retention Trial after restart', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-retention-restart-')))
    roots.push(root)
    const fixture = await evaluationFixture(root)
    const holdout = new ExistingSkillHoldoutEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      runTrial: input => pairedTrial(input, false, true),
    })
    const holdoutResult = await holdout.evaluate(fixture.candidate, fixture.admission)
    const controller = new AbortController()
    const firstTrial = vi.fn((input: ExistingSkillRetentionTrialInput) => new Promise<never>((_resolve, reject) => {
      input.signal!.addEventListener('abort', () => reject(input.signal!.reason), { once: true })
    }))
    const first = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: firstTrial,
    })
    const pending = first.evaluate(fixture.candidate, holdoutResult, { signal: controller.signal })
    await vi.waitFor(() => expect(firstTrial).toHaveBeenCalledOnce())
    controller.abort(new Error('host stopped after paid dispatch'))
    await expect(pending).rejects.toThrow('host stopped after paid dispatch')

    const repeatedTrial = vi.fn()
    const restarted = new ExistingSkillRetentionEvaluation({
      policies: [fixture.policy],
      baselines: fixture.baselines,
      candidates: fixture.candidates,
      governance: fixture.governance,
      holdouts: holdout,
      runTrial: repeatedTrial,
    })
    await expect(restarted.evaluate(fixture.candidate, holdoutResult)).resolves.toMatchObject({
      status: 'incomplete',
      verdict: 'none',
      reason: 'paired-trial-outcome-uncertain',
      releaseAuthority: 'none',
    })
    expect(repeatedTrial).not.toHaveBeenCalled()
  })
})

async function evaluationFixture(root: string) {
  const baselineFiles: SkillBundleArchiveFile[] = [{
    path: 'SKILL.md',
    mode: '100644',
    content: Buffer.from('---\nname: release-proof\ndescription: Verify a release.\n---\n\nUse the guide.\n'),
  }, {
    path: 'references/guide.md',
    mode: '100644',
    content: Buffer.from('# Guide\n\nCheck the release.\n'),
  }]
  const candidateFiles = baselineFiles.map(file => ({
    ...file,
    content: file.path === 'SKILL.md'
      ? Buffer.from('---\nname: release-proof\ndescription: Verify independently.\n---\n\nUse two checks.\n')
      : Buffer.from(file.content),
  }))
  const [baseline, candidateArchive] = await Promise.all([
    assembleSealedSkillBundleArchive(baselineFiles),
    assembleSealedSkillBundleArchive(candidateFiles),
  ])
  const candidate = existingCandidate(baseline, candidateArchive)
  const admission = admitted(candidate, baseline, candidateArchive)
  const holdoutCasePackDir = join(root, 'governance', 'holdout')
  const retentionCasePackDir = join(root, 'governance', 'retention')
  await Promise.all([
    writeCasePack(holdoutCasePackDir, 'holdout-evaluator'),
    writeCasePack(retentionCasePackDir, 'retention-evaluator'),
  ])
  const policy = {
    id: 'workspace-retention-governance',
    workspaceId: WORKSPACE_ID,
    governanceRoot: join(root, 'governance'),
    runRoot: join(root, 'runs'),
    dshRevision: 'a'.repeat(40),
  }
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
    casePackDir: holdoutCasePackDir,
    casePackHash: await hashTree(holdoutCasePackDir),
    retentionCasePackDir,
    retentionCasePackHash: await hashTree(retentionCasePackDir),
    dshRevision: policy.dshRevision,
    releaseAuthority: 'none' as const,
  }
  const baselines = {
    resolveBaseline: async () => ({ manifest: baselineManifest(baseline), files: baseline.files }),
  }
  const candidates = {
    materializeExisting: async (_candidate: ExistingSkillCandidate, outputDir: string) => {
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
    },
  }
  return {
    baseline,
    candidateArchive,
    candidate,
    admission,
    policy,
    envelope,
    retentionCasePackDir,
    baselines,
    candidates,
    governance: { resolve: async () => envelope },
  }
}

async function writeCasePack(root: string, evaluator: string): Promise<void> {
  await mkdir(join(root, 'final-test'), { recursive: true })
  await mkdir(join(root, 'evidence'), { recursive: true })
  await mkdir(join(root, 'calibration', 'known-bad'), { recursive: true })
  await mkdir(join(root, 'calibration', 'known-correction'), { recursive: true })
  await writeFile(join(root, 'final-test', 'evaluator.mjs'), `process.stdout.write("${evaluator}")\n`)
  await writeFile(join(root, 'evidence', 'rationale.md'), 'Internal test rationale.\n')
  await writeFile(join(root, 'calibration', 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(root, 'calibration', 'known-correction', 'SKILL.md'), 'good\n')
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: `existing-${evaluator}`,
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: 'b'.repeat(64) },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 12_000, outputTokenLimit: 4_000 },
    evidence: { rationale: 'evidence/rationale.md' },
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
      signalCount: 5,
      goalCount: 5,
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
      preservedFileCount: 1,
      preservedBinaryFileCount: 0,
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
      preservedFileCount: 1,
      preservedBinaryFileCount: 0,
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

async function pairedTrial(
  input: ExistingSkillHoldoutTrialInput | ExistingSkillRetentionTrialInput,
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
