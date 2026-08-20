import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomaticEvolutionBudgetReservation } from '../src/automatic-evolution-budget.ts'
import {
  ExistingSkillCounterfactualCanary,
  ExistingSkillCounterfactualCanaryScheduler,
  type ExistingSkillCanaryReplay,
} from '../src/existing-skill-counterfactual-canary.ts'
import type { ExistingSkillCandidateLineage } from '../src/existing-skill-candidate-lineage.ts'
import type { CapabilityGeneration } from '../src/generation-store.ts'
import { hashTree } from '../src/hash.ts'
import type { ExistingSkillCandidate } from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []
const CANDIDATE_ID = '1'.repeat(64)
const GENERATION_ID = '2'.repeat(64)
const OUTCOME_ID = '3'.repeat(64)
const ADMISSION_ID = '4'.repeat(64)
const ENVELOPE_ID = '5'.repeat(64)
const HOLDOUT_ID = '6'.repeat(64)
const HOLDOUT_CASES = '7'.repeat(64)
const RETENTION_ID = '8'.repeat(64)
const RETENTION_CASES = '9'.repeat(64)
const BASELINE_TREE = 'a'.repeat(64)
const CANDIDATE_TREE = 'b'.repeat(64)
const DSH_REVISION = 'c'.repeat(40)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Existing Skill Counterfactual Canary', () => {
  it('replays the exact retained pair after a failed active Outcome and emits no mutation authority', async () => {
    const fixture = await canaryFixture(false, true)
    const canary = fixture.canary()

    const reconciled = await canary.reconcile(WORKSPACE_ID)

    expect(fixture.prepareCanaryReplay).toHaveBeenCalledOnce()
    expect(fixture.runTrial).toHaveBeenCalledWith(expect.objectContaining({
      baselineKind: 'skill-tree',
      dshRevision: DSH_REVISION,
      trialLimit: 4,
    }))
    expect(reconciled).toMatchObject({
      status: 'completed',
      run: {
        workspaceId: WORKSPACE_ID,
        generationId: GENERATION_ID,
        outcomeId: OUTCOME_ID,
        candidateId: CANDIDATE_ID,
        retentionEvaluationId: RETENTION_ID,
        status: 'keep',
        reason: 'candidate-still-passes-sealed-canary',
        evidence: {
          baseline: 'fail',
          candidate: 'pass',
          activePointerStable: true,
          inputIntegrityStable: true,
          proposerCalls: 0,
          trialCount: 4,
        },
        releaseAuthority: 'none',
      },
    })
    await expect(canary.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{ status: 'keep', releaseAuthority: 'none' }],
    })
  })

  it('makes rollback only eligible when the sealed baseline recovers and the Candidate fails', async () => {
    const fixture = await canaryFixture(true, false)

    await expect(fixture.canary().reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'rollback-eligible',
        reason: 'candidate-regressed-baseline-recovers',
        evidence: { baseline: 'pass', candidate: 'fail' },
        releaseAuthority: 'none',
      },
    })
  })

  it('requires review instead of suggesting rollback when both baseline and Candidate fail', async () => {
    const fixture = await canaryFixture(false, false)

    await expect(fixture.canary().reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'failed-outcome-not-isolated',
        evidence: { baseline: 'fail', candidate: 'fail' },
        releaseAuthority: 'none',
      },
    })
  })

  it('withholds rollback eligibility when the active pointer changes during the replay', async () => {
    const fixture = await canaryFixture(true, false, { activeChangesDuringTrial: true })

    await expect(fixture.canary().reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'active-generation-changed',
        evidence: { activePointerStable: false },
        releaseAuthority: 'none',
      },
    })
  })

  it('rejects a tampered durable rollback classification instead of projecting it', async () => {
    const fixture = await canaryFixture(false, true)
    const canary = fixture.canary()
    await canary.reconcile(WORKSPACE_ID)
    const runsRoot = join(fixture.root, 'runs', 'existing-skill-canary', 'runs')
    const [runId] = await readdir(runsRoot)
    const resultPath = join(runsRoot, runId!, 'result.json')
    const tampered = JSON.parse(await readFile(resultPath, 'utf8')) as { status: string; reason: string }
    tampered.status = 'rollback-eligible'
    tampered.reason = 'candidate-regressed-baseline-recovers'
    await writeFile(resultPath, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(canary.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 1,
      runs: [],
    })
  })

  it('abstains before any paid replay when the active Generation is not one exact existing-Skill release', async () => {
    const fixture = await canaryFixture(false, true, { activeRelease: false })

    await expect(fixture.canary().reconcile(WORKSPACE_ID)).resolves.toEqual({
      status: 'idle',
      reason: 'no-active-existing-skill-release',
    })
    expect(fixture.prepareCanaryReplay).not.toHaveBeenCalled()
    expect(fixture.runTrial).not.toHaveBeenCalled()
    expect(fixture.reserve).not.toHaveBeenCalled()
  })

  it('does not repeat a paid Trial whose result was not durably observed before restart', async () => {
    const fixture = await canaryFixture(false, true)
    const controller = new AbortController()
    const firstTrial = vi.fn((input: ExistingSkillCanaryReplay['trial']) =>
      new Promise<never>((_resolve, reject) => {
        input.signal!.addEventListener('abort', () => reject(input.signal!.reason), { once: true })
      }))
    const pending = fixture.canary(firstTrial).reconcile(WORKSPACE_ID, { signal: controller.signal })
    await vi.waitFor(() => expect(firstTrial).toHaveBeenCalledOnce())
    controller.abort(new Error('Host stopped after paid existing-Skill Canary dispatch'))
    await expect(pending).rejects.toThrow('Host stopped after paid existing-Skill Canary dispatch')

    const repeatedTrial = vi.fn()
    await expect(fixture.canary(repeatedTrial).reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'canary-trial-outcome-uncertain',
        releaseAuthority: 'none',
      },
    })
    expect(repeatedTrial).not.toHaveBeenCalled()
  })

  it('runs observed work only through native DSH Jobs', async () => {
    const reconcile = vi.fn(async () => ({ status: 'idle' as const, reason: 'no-failed-active-outcome' as const }))
    const scheduler = new ExistingSkillCounterfactualCanaryScheduler({ reconcile }, [WORKSPACE_ID])
    const starts: Array<{ kind: string; label: string; run(): { done: Promise<unknown> } }> = []
    const registry = {
      start(spec: typeof starts[number]) {
        starts.push(spec)
        spec.run()
        return 'job-1'
      },
    }

    scheduler.observe(WORKSPACE_ID)
    expect(starts).toHaveLength(0)
    const detach = scheduler.attachJobs(registry as never)

    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledWith(WORKSPACE_ID, expect.anything()))
    expect(starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'existing Skill failed-Outcome Canary',
    })
    detach()
  })
})

async function canaryFixture(
  baselinePassed: boolean,
  candidatePassed: boolean,
  options: { activeRelease?: boolean; activeChangesDuringTrial?: boolean } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-skill-canary-')))
  roots.push(root)
  const baselineDir = join(root, 'sealed', 'baseline')
  const candidateDir = join(root, 'sealed', 'candidate')
  const holdoutCasePackDir = join(root, 'governance', 'holdout')
  const casePackDir = join(root, 'governance', 'retention')
  await Promise.all([baselineDir, candidateDir, holdoutCasePackDir, casePackDir].map(path => mkdir(path, { recursive: true })))
  await Promise.all([
    writeFile(join(baselineDir, 'SKILL.md'), 'baseline\n'),
    writeFile(join(candidateDir, 'SKILL.md'), 'candidate\n'),
    writeFile(join(holdoutCasePackDir, 'case.txt'), 'holdout\n'),
    writeFile(join(casePackDir, 'case.txt'), 'retention\n'),
  ])
  const [baselineTreeHash, candidateTreeHash, holdoutCasePackHash, retentionCasePackHash] =
    await Promise.all([
      hashTree(baselineDir),
      hashTree(candidateDir),
      hashTree(holdoutCasePackDir),
      hashTree(casePackDir),
    ] as const)
  const candidate = candidateFixture(baselineTreeHash, candidateTreeHash)
  const lineage = lineageFixture(candidate, baselineTreeHash, candidateTreeHash, holdoutCasePackHash, retentionCasePackHash)
  const generation = generationFixture(lineage, candidateTreeHash)
  const replay: ExistingSkillCanaryReplay = {
    candidateId: candidate.id,
    retentionEvaluationId: RETENTION_ID,
    holdoutEvaluationId: HOLDOUT_ID,
    admissionId: ADMISSION_ID,
    envelopeId: ENVELOPE_ID,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    baselineTreeHash,
    candidateTreeHash,
    holdoutCasePackHash,
    retentionCasePackHash,
    dshRevision: DSH_REVISION,
    baselineDir,
    candidateDir,
    holdoutCasePackDir,
    casePackDir,
    trial: {
      baselineKind: 'skill-tree',
      calibration: { knownBad: 'bad', knownCorrection: 'good' },
      casePackDir,
      dshRevision: DSH_REVISION,
      outputDir: root,
      candidateSkillDir: candidateDir,
      skillDir: baselineDir,
      trial: { evaluator: 'evaluator.mjs', timeoutMs: 1_000, outputLimitBytes: 1_024, dshAssembled: true },
      trialLimit: 4,
    },
    releaseAuthority: 'none',
  }
  const prepareCanaryReplay = vi.fn(async (_candidate, _retentionId, outputDir: string) => ({
    ...replay,
    trial: { ...replay.trial, outputDir },
  }))
  const runTrial = vi.fn(async (input: ExistingSkillCanaryReplay['trial']) => pairedTrial(
    input,
    baselinePassed,
    candidatePassed,
  ))
  const reserve = vi.fn(async (): Promise<AutomaticEvolutionBudgetReservation> => ({
    allowed: true,
    newlyReserved: true,
    snapshot: {
      targetId: 'existing-skill-canary',
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      utcDay: '2026-08-21',
      used: 1,
      limit: 1,
      remaining: 0,
    },
  }))
  const release = {
    scan: vi.fn(async () => options.activeRelease === false ? [] : [{
      status: 'approved' as const,
      reason: 'exact-existing-skill-evidence-retained' as const,
      candidateId: CANDIDATE_ID,
      admissionId: ADMISSION_ID,
      holdoutEvaluationId: HOLDOUT_ID,
      retentionEvaluationId: RETENTION_ID,
      generationId: GENERATION_ID,
    }]),
    eligibility: vi.fn(async () => ({
      status: 'approved' as const,
      reason: 'exact-existing-skill-evidence-retained' as const,
      candidateId: CANDIDATE_ID,
      admissionId: ADMISSION_ID,
      holdoutEvaluationId: HOLDOUT_ID,
      retentionEvaluationId: RETENTION_ID,
      generationId: GENERATION_ID,
    })),
  }
  let activeReads = 0
  return {
    root,
    prepareCanaryReplay,
    reserve,
    runTrial,
    canary: (trial = runTrial) => new ExistingSkillCounterfactualCanary({
      store: {
        getActiveGeneration: () => {
          activeReads += 1
          return options.activeChangesDuringTrial === true && activeReads > 1
            ? { ...generation, id: 'f'.repeat(64), parentId: generation.id }
            : generation
        },
        getGeneration: id => id === generation.id ? generation : undefined,
      },
      outcomes: { list: () => [failedOutcome()] },
      releases: release,
      candidates: { listExistingCandidates: () => [candidate] },
      retention: {
        scan: async () => ({ configuredPolicyCount: 1, warningCount: 0, results: [{
          id: RETENTION_ID,
          candidateId: CANDIDATE_ID,
          holdoutEvaluationId: HOLDOUT_ID,
          admissionId: ADMISSION_ID,
          envelopeId: ENVELOPE_ID,
          workspaceId: WORKSPACE_ID,
          skillName: candidate.skillName,
          baselineTreeHash,
          candidateTreeHash,
          holdoutCasePackHash,
          casePackHash: retentionCasePackHash,
          status: 'complete',
          verdict: 'retained',
          reason: 'candidate-passed-protected-retention',
          evidence: {
            holdoutCasePackHash,
            baselineTreeHash,
            candidateTreeHash,
            casePackHash: retentionCasePackHash,
            baseline: 'fail' as const,
            candidate: 'pass' as const,
            calibrationPassed: true,
            assembled: true,
            compositionStable: true,
            inputIntegrityStable: true,
            proposerCalls: 0 as const,
            trialCount: 4 as const,
          },
          releaseAuthority: 'none',
        }] }),
        prepareCanaryReplay,
      },
      budget: { reserve },
    }, {
      policies: [{
        id: 'existing-skill-canary',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
        dshRevision: DSH_REVISION,
        maxAttemptsPerUtcDay: 1,
      }],
      runTrial: trial,
    }),
  }
}

function candidateFixture(baselineTreeHash: string, candidateTreeHash: string): ExistingSkillCandidate {
  return {
    id: CANDIDATE_ID,
    schemaVersion: 1,
    kind: 'existing-skill-improvement-candidate-v1',
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    opportunity: { id: 'd'.repeat(64), kind: 'internal-existing-skill-correction-v1', signalCount: 5, goalCount: 5 },
    baseline: {
      id: 'e'.repeat(64),
      qualificationId: 'f'.repeat(64),
      artifactDigest: '0'.repeat(64),
      treeHash: baselineTreeHash,
    },
    authorship: {
      kind: 'protected-correction-authoring-v1',
      policyId: 'existing-author',
      modelIdentityHash: '1'.repeat(64),
      evaluationEvidenceId: '2'.repeat(64),
      inputDigest: '3'.repeat(64),
      holdoutEnvelopeId: ENVELOPE_ID,
      claim: 'Improve release verification.',
    },
    version: {
      kind: 'existing-skill-improvement-bundle-v1',
      parentBaselineId: 'e'.repeat(64),
      artifactDigest: '4'.repeat(64),
      treeHash: candidateTreeHash,
    },
    contentHash: '4'.repeat(64),
    releaseAuthority: 'none',
  } as ExistingSkillCandidate
}

function lineageFixture(
  candidate: ExistingSkillCandidate,
  baselineTreeHash: string,
  candidateTreeHash: string,
  holdoutCasePackHash: string,
  retentionCasePackHash: string,
): ExistingSkillCandidateLineage {
  return {
    kind: 'existing-skill-candidate-lineage-v1',
    candidateId: candidate.id,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    opportunityId: candidate.opportunity.id,
    qualificationId: candidate.baseline.qualificationId,
    baselineId: candidate.baseline.id,
    baselineArtifactDigest: candidate.baseline.artifactDigest,
    baselineTreeHash,
    evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
    policyId: candidate.authorship.policyId,
    versionKind: 'existing-skill-improvement-bundle-v1',
    contentHash: candidate.contentHash,
    candidateTreeHash,
    admissionId: ADMISSION_ID,
    evaluationEnvelopeId: ENVELOPE_ID,
    holdoutEvaluationId: HOLDOUT_ID,
    holdoutCasePackHash,
    retentionEvaluationId: RETENTION_ID,
    retentionCasePackHash,
    releaseAuthority: 'none',
  }
}

function generationFixture(
  lineage: ExistingSkillCandidateLineage,
  candidateTreeHash: string,
): CapabilityGeneration {
  return {
    id: GENERATION_ID,
    schemaVersion: 2,
    workspaceId: WORKSPACE_ID,
    createdAt: 1,
    artifacts: [{
      kind: 'skill-bundle',
      name: lineage.skillName,
      artifactDigest: lineage.contentHash,
      treeHash: candidateTreeHash,
      contentBase64: 'H4sI',
      lineage,
    }],
    evaluatorVersion: 'existing-skill-paired-v1',
    policyVersion: 'human-review-existing-skill-v1',
    compositionFingerprint: '5'.repeat(64),
  }
}

function failedOutcome() {
  return {
    id: OUTCOME_ID,
    schemaVersion: 2 as const,
    observedAt: 1,
    workspaceId: WORKSPACE_ID,
    sessionId: 'session-1',
    callId: 'call-1',
    generationId: GENERATION_ID,
    goal: { id: 'goal-1', revision: 1, phase: 'active' },
    status: 'failed' as const,
    reason: 'real workflow failed after the released Skill was selected',
  }
}

async function pairedTrial(
  input: ExistingSkillCanaryReplay['trial'],
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
      composition: { fingerprint: '6'.repeat(64), modelCalls: 1, usage: { inputTokens: 100 } },
    },
    candidate: {
      passed: candidatePassed,
      checks: [{ name: 'protected-case', passed: candidatePassed }],
      treeHash: await hashTree(input.candidateSkillDir),
      composition: { fingerprint: '6'.repeat(64), modelCalls: 1, usage: { inputTokens: 90 } },
    },
  }
}
