import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobDoneListener, JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CounterfactualCanary,
  CounterfactualCanaryScheduler,
  type CounterfactualCanaryModules,
} from '../src/counterfactual-canary.ts'
import type { DeliveryOutcome } from '../src/delivery-outcome-monitor.ts'
import type { CapabilityGeneration } from '../src/generation-store.ts'
import { hashTree } from '../src/hash.ts'
import type { InternalSkillRetentionRunView } from '../src/internal-skill-retention.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'
import type { QualifiedSkillCandidateShadowInput } from '../src/skill-candidate-admission.ts'
import type { PairedTrialResult } from '../src/trial.ts'
import {
  experienceSkillCandidate,
  internalSkillCandidateLineage,
  qualifiedSkillCandidateAdmission,
} from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []
const GENERATION_ID = 'b'.repeat(64)
const OUTCOME_ID = 'c'.repeat(64)
const REVIEW_ID = 'd'.repeat(64)
const RETENTION_ID = 'f'.repeat(64)

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Counterfactual Canary', () => {
  it('turns an exact failed active-Generation Outcome into rollback eligibility without moving the pointer', async () => {
    const fixture = await canaryFixture()
    const getActiveGeneration = vi.fn(() => fixture.generation)
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      false,
    ))
    const canary = createCanary(fixture, { getActiveGeneration, runTrial })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        generationId: GENERATION_ID,
        outcomeId: OUTCOME_ID,
        candidateId: fixture.candidate.id,
        status: 'rollback-eligible',
        reason: 'candidate-regressed-sealed-canary',
        releaseAuthority: 'none',
        evidence: {
          baseline: 'pass',
          candidate: 'fail',
          calibrationPassed: true,
          compositionStable: true,
          proposerCalls: 0,
          trialCount: 4,
          activePointerStable: true,
        },
      },
    })
    expect(runTrial).toHaveBeenCalledOnce()
    expect(getActiveGeneration).toHaveBeenCalledTimes(2)
    expect(getActiveGeneration.mock.results.every(result => result.value?.id === GENERATION_ID)).toBe(true)
  })

  it('keeps an exact Candidate that still passes and rejects a tampered durable verdict', async () => {
    const fixture = await canaryFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      true,
    ))
    const canary = createCanary(fixture, { runTrial })

    const reconciled = await canary.reconcile(WORKSPACE_ID)
    expect(reconciled).toMatchObject({
      status: 'completed',
      run: {
        status: 'keep',
        reason: 'candidate-retained-sealed-canary',
        releaseAuthority: 'none',
      },
    })
    if (reconciled.status !== 'completed') throw new Error('expected a completed canary')
    await expect(canary.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredRootCount: 1,
      warningCount: 0,
      runs: [{ id: reconciled.run.id, status: 'keep' }],
    })
    expect(JSON.stringify(await canary.scan(WORKSPACE_ID))).not.toContain(fixture.canaryRunRoot)

    const resultPath = join(fixture.canaryRunRoot, reconciled.run.id, 'result.json')
    const tampered = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    tampered.status = 'rollback-eligible'
    tampered.reason = 'candidate-regressed-sealed-canary'
    await writeFile(resultPath, `${JSON.stringify(tampered, null, 2)}\n`)
    await expect(canary.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredRootCount: 1,
      warningCount: 1,
      runs: [],
    })
    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toEqual({
      status: 'blocked',
      reason: 'canary-evidence-invalid',
      generationId: GENERATION_ID,
      outcomeId: OUTCOME_ID,
    })
    expect(runTrial).toHaveBeenCalledOnce()
  })

  it('keeps an input-mutation verdict readable without rebinding it to drifted content', async () => {
    const fixture = await canaryFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => {
      await writeFile(join(fixture.source.retentionCasePackDir!, 'drift.txt'), 'changed during trial\n')
      return paired(fixture.baselineTreeHash, fixture.candidateTreeHash, true)
    })
    const canary = createCanary(fixture, { runTrial })

    const reconciled = await canary.reconcile(WORKSPACE_ID)
    expect(reconciled).toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'canary-input-mutated',
        evidence: {
          retentionCasePackHash: fixture.source.retentionCasePackHash,
          inputIntegrityStable: false,
        },
      },
    })
    await expect(canary.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ status: 'review', reason: 'canary-input-mutated' }],
    })
  })

  it('does not blindly retry an interrupted dispatched Trial', async () => {
    const fixture = await canaryFixture()
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const interruptedTrial = vi.fn(async (input: Parameters<typeof import('../src/trial.ts').runPairedTrial>[0]) => {
      entered()
      return await new Promise<PairedTrialResult>((_resolve, reject) => {
        input.signal!.addEventListener('abort', () => reject(input.signal!.reason), { once: true })
      })
    })
    const first = createCanary(fixture, { runTrial: interruptedTrial })
    const running = first.reconcile(WORKSPACE_ID, { signal: controller.signal })
    await started
    controller.abort(new Error('simulated Host interruption'))
    await expect(running).rejects.toThrow('simulated Host interruption')

    const retryTrial = vi.fn()
    const recovered = createCanary(fixture, { runTrial: retryTrial })
    await expect(recovered.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'canary-trial-outcome-uncertain',
        releaseAuthority: 'none',
      },
    })
    expect(interruptedTrial).toHaveBeenCalledOnce()
    expect(retryTrial).not.toHaveBeenCalled()
  })

  it('downgrades to review when the active pointer changes during the Trial', async () => {
    const fixture = await canaryFixture()
    const getActiveGeneration = vi.fn()
      .mockReturnValueOnce(fixture.generation)
      .mockReturnValueOnce(undefined)
    const canary = createCanary(fixture, {
      getActiveGeneration,
      runTrial: vi.fn(async () => {
        await writeFile(join(fixture.source.retentionCasePackDir!, 'pointer-drift.txt'), 'also changed\n')
        return paired(
          fixture.baselineTreeHash,
          fixture.candidateTreeHash,
          false,
        )
      }),
    })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: {
        status: 'review',
        reason: 'active-generation-changed',
        evidence: { activePointerStable: false },
        releaseAuthority: 'none',
      },
    })
    await expect(canary.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ status: 'review', reason: 'active-generation-changed' }],
    })
  })

  it('waits on its durable daily budget before dispatching a paid assembled Trial', async () => {
    const fixture = await canaryFixture()
    const runTrial = vi.fn()
    const canary = createCanary(fixture, {
      runTrial,
      modules: {
        budget: { reserve: vi.fn(async () => ({
          allowed: false,
          newlyReserved: false,
          retryAt: 1_787_356_800_000,
          snapshot: {
            targetId: 'counterfactual-canary',
            workspaceId: WORKSPACE_ID,
            skillName: fixture.candidate.skillName,
            utcDay: '2026-08-21',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        })) },
      },
    })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toEqual({
      status: 'waiting',
      reason: 'canary-budget-exhausted',
      retryAt: 1_787_356_800_000,
      outcomeId: OUTCOME_ID,
      generationId: GENERATION_ID,
    })
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('does not spend again while exact rollback eligibility awaits Host action', async () => {
    const fixture = await canaryFixture()
    const laterOutcome: DeliveryOutcome = {
      ...fixture.outcome,
      id: '5'.repeat(64),
      observedAt: fixture.outcome.observedAt + 1,
      callId: 'complete-delivery-2',
    }
    const runTrial = vi.fn(async () => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      false,
    ))
    const canary = createCanary(fixture, {
      runTrial,
      modules: { outcomes: { list: vi.fn(() => [fixture.outcome, laterOutcome]) } },
    })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: { status: 'rollback-eligible' },
    })
    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toEqual({
      status: 'idle',
      reason: 'rollback-already-eligible',
    })
    expect(runTrial).toHaveBeenCalledOnce()
  })

  it('continuously evaluates a later failed Outcome after an earlier Candidate keep', async () => {
    const fixture = await canaryFixture()
    const laterOutcome: DeliveryOutcome = {
      ...fixture.outcome,
      id: '5'.repeat(64),
      observedAt: fixture.outcome.observedAt + 1,
      callId: 'complete-delivery-2',
    }
    const runTrial = vi.fn(async () => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      true,
    ))
    const canary = createCanary(fixture, {
      runTrial,
      modules: { outcomes: { list: vi.fn(() => [fixture.outcome, laterOutcome]) } },
    })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: { outcomeId: fixture.outcome.id, status: 'keep' },
    })
    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toMatchObject({
      status: 'completed',
      run: { outcomeId: laterOutcome.id, status: 'keep' },
    })
    expect(runTrial).toHaveBeenCalledTimes(2)
  })

  it('blocks an active Generation whose internal Candidate delta is ambiguous', async () => {
    const fixture = await canaryFixture()
    const ambiguous: CapabilityGeneration = {
      ...fixture.generation,
      artifacts: [
        ...fixture.generation.artifacts,
        { ...fixture.generation.artifacts[0]!, name: 'another-skill' },
      ],
    }
    const runTrial = vi.fn()
    const canary = createCanary(fixture, {
      runTrial,
      modules: {
        store: {
          getActiveGeneration: vi.fn(() => ambiguous),
          getGeneration: vi.fn(() => undefined),
        },
      },
    })

    await expect(canary.reconcile(WORKSPACE_ID)).resolves.toEqual({
      status: 'blocked',
      reason: 'canary-evidence-invalid',
      generationId: GENERATION_ID,
      outcomeId: OUTCOME_ID,
    })
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('runs reconciliation only through one native DSH evolution Job', async () => {
    const reconcile = vi.fn(async () => ({
      status: 'idle' as const,
      reason: 'no-failed-active-outcome' as const,
    }))
    const scheduler = new CounterfactualCanaryScheduler({ reconcile }, [WORKSPACE_ID])
    const jobs = fakeJobs()

    const detach = scheduler.attachJobs(jobs.registry)
    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'counterfactual active-Candidate canary',
      outputLimitBytes: 2_048,
    })
    await jobs.hooks[0]!.done
    expect(reconcile).toHaveBeenCalledWith(WORKSPACE_ID, { signal: expect.any(AbortSignal) })
    detach()
  })
})

function createCanary(
  fixture: Awaited<ReturnType<typeof canaryFixture>>,
  options: {
    getActiveGeneration?: (workspaceId: string) => CapabilityGeneration | undefined
    runTrial: (input: Parameters<typeof import('../src/trial.ts').runPairedTrial>[0]) => Promise<PairedTrialResult>
    modules?: Partial<CounterfactualCanaryModules>
  },
): CounterfactualCanary {
  const modules: CounterfactualCanaryModules = {
    store: {
      getActiveGeneration: options.getActiveGeneration ?? vi.fn(() => fixture.generation),
      getGeneration: vi.fn(() => undefined),
    },
    outcomes: { list: vi.fn(() => [fixture.outcome]) },
    promotion: { eligibility: vi.fn(async () => ({
      status: 'eligible' as const,
      reason: 'exact-retention-retained' as const,
      generationId: GENERATION_ID,
      reviewId: REVIEW_ID,
      retentionId: RETENTION_ID,
    })) },
    review: { get: vi.fn(async () => fixture.review) },
    retention: { scan: vi.fn(async () => ({
      configuredRootCount: 1,
      warningCount: 0,
      runs: [fixture.retention],
    })) },
    candidates: { listCandidates: vi.fn(() => [fixture.candidate]) },
    admissions: {
      scan: vi.fn(async () => ({
        configuredPolicyCount: 1,
        warningCount: 0,
        results: [fixture.admissionResult],
      })),
      qualifiedShadowInput: vi.fn(async () => fixture.source),
    },
    budget: { reserve: vi.fn(async () => ({
      allowed: true,
      newlyReserved: true,
      snapshot: {
        targetId: 'counterfactual-canary',
        workspaceId: WORKSPACE_ID,
        skillName: fixture.candidate.skillName,
        utcDay: '2026-08-21',
        used: 1,
        limit: 1,
        remaining: 0,
      },
    })) },
    ...options.modules,
  }
  return new CounterfactualCanary(modules, {
    policies: [{
      id: 'counterfactual-canary',
      workspaceId: WORKSPACE_ID,
      runRoot: fixture.canaryRunRoot,
      maxAttemptsPerUtcDay: 1,
    }],
    runTrial: options.runTrial,
  })
}

async function canaryFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-canary-')))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const candidateDir = join(root, 'candidate')
  const admissionCasePackDir = join(root, 'admission-case')
  const admissionRunRoot = join(root, 'admission-runs')
  const holdoutCasePackDir = join(root, 'holdout-case')
  const shadowRunRoot = join(root, 'shadow-runs')
  const retentionCasePackDir = join(root, 'retention-case')
  const retentionRunRoot = join(root, 'retention-runs')
  const canaryRunRoot = join(root, 'canary-runs')
  await Promise.all([
    baselineDir,
    candidateDir,
    admissionCasePackDir,
    admissionRunRoot,
    holdoutCasePackDir,
    shadowRunRoot,
    retentionCasePackDir,
    retentionRunRoot,
    canaryRunRoot,
  ].map(path => mkdir(path)))
  await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'internal-capability-absent-subject-v1',
    workspaceId: WORKSPACE_ID,
    opportunityId: '2'.repeat(64),
    skillName: 'release-proof',
  }, null, 2)}\n`)
  await writeFile(join(candidateDir, 'SKILL.md'), '---\nname: release-proof\ndescription: proof\n---\n')
  await writeFile(join(admissionCasePackDir, 'manifest.json'), '{}\n')
  await writeFile(join(holdoutCasePackDir, 'manifest.json'), '{}\n')
  await writeCasePack(retentionCasePackDir)

  const baselineTreeHash = await hashTree(baselineDir)
  const candidateTreeHash = await hashTree(candidateDir)
  const candidate = experienceSkillCandidate({
    version: {
      kind: 'experience-authored-bundle-v1',
      artifactDigest: '7'.repeat(64),
      treeHash: candidateTreeHash,
    },
  })
  const admissionResult = qualifiedSkillCandidateAdmission(candidate)
  const lineage = internalSkillCandidateLineage({
    candidateId: candidate.id,
    candidateTreeHash,
    admissionId: admissionResult.id,
    evaluationEnvelopeId: admissionResult.envelopeId!,
  })
  const retentionCasePackHash = await hashTree(retentionCasePackDir)
  const source: QualifiedSkillCandidateShadowInput = {
    evaluationEnvelopeId: admissionResult.envelopeId!,
    baselineKind: 'capability-absent',
    baselineSkillName: candidate.skillName,
    baselineDir,
    candidateDir,
    admissionCasePackDir,
    admissionCasePackHash: await hashTree(admissionCasePackDir),
    admissionRunRoot,
    holdoutCasePackDir,
    holdoutCasePackHash: await hashTree(holdoutCasePackDir),
    shadowRunRoot,
    retentionCasePackDir,
    retentionCasePackHash,
    retentionRunRoot,
    lineage,
  }
  const generation: CapabilityGeneration = {
    schemaVersion: 2,
    id: GENERATION_ID,
    workspaceId: WORKSPACE_ID,
    createdAt: 1_787_270_400_000,
    artifacts: [{
      kind: 'skill-bundle',
      name: candidate.skillName,
      artifactDigest: lineage.contentHash,
      treeHash: candidateTreeHash,
      contentBase64: candidate.artifact.contentBase64,
      lineage,
    }],
    evaluatorVersion: 'holdout-v1',
    policyVersion: 'human-review-v1',
    compositionFingerprint: '6'.repeat(64),
  }
  const outcome: DeliveryOutcome = {
    schemaVersion: 2,
    id: OUTCOME_ID,
    observedAt: 1_787_270_500_000,
    workspaceId: WORKSPACE_ID,
    sessionId: 'future-session-1',
    callId: 'complete-delivery-1',
    generationId: GENERATION_ID,
    goal: { id: 'goal-1', revision: 2, phase: 'failed' },
    status: 'failed',
    reason: 'verified delivery failed',
  }
  const review = {
    id: REVIEW_ID,
    workspaceId: WORKSPACE_ID,
    runId: 'a'.repeat(64),
    status: 'approved',
    outputDir: shadowRunRoot,
    skillName: candidate.skillName,
    recommendation: 'promote',
    claim: candidate.description,
    changedFiles: ['SKILL.md'],
    candidateTreeHash,
    baseTreeHash: baselineTreeHash,
    baselineKind: 'capability-absent',
    proposalHash: '1'.repeat(64),
    proposal: { claim: candidate.description, files: [{ path: 'SKILL.md', content: 'proof\n' }] },
    cases: [{ id: 'holdout', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 10, outputTokens: 5, trialCount: 4 },
    reasons: ['held-out improvement'],
    limitations: ['bounded evidence'],
    evaluatorVersion: 'holdout-v1',
    compositionFingerprint: generation.compositionFingerprint,
    compositionStable: true,
    startedAt: '2026-08-21T00:00:00.000Z',
    lineage,
    evidenceHash: '2'.repeat(64),
    decisionActor: 'human',
    decisionNote: 'approved',
    generationId: GENERATION_ID,
  } satisfies ReviewCandidate
  const retention: InternalSkillRetentionRunView = {
    id: RETENTION_ID,
    candidateId: candidate.id,
    workspaceId: WORKSPACE_ID,
    skillName: candidate.skillName,
    admissionId: admissionResult.id,
    evaluationEnvelopeId: admissionResult.envelopeId!,
    shadowRunId: review.runId,
    baselineTreeHash,
    candidateTreeHash,
    status: 'retained',
    reason: 'candidate-retained-prior-case',
    evidence: {
      retentionCasePackHash,
      baselineTreeHash,
      candidateTreeHash,
      baseline: 'pass',
      candidate: 'pass',
      calibrationPassed: true,
      compositionStable: true,
      proposerCalls: 0,
      trialCount: 4,
    },
    releaseAuthority: 'none',
  }
  return {
    admissionResult,
    baselineTreeHash,
    candidate,
    candidateTreeHash,
    canaryRunRoot,
    generation,
    outcome,
    retention,
    review,
    source,
  }
}

async function writeCasePack(path: string): Promise<void> {
  await writeFile(join(path, 'evaluator.mjs'), 'process.stdout.write("{}")\n')
  await mkdir(join(path, 'known-bad'))
  await mkdir(join(path, 'known-correction'))
  await writeFile(join(path, 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(path, 'known-correction', 'SKILL.md'), 'good\n')
  await writeFile(join(path, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'retention-v1',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'e'.repeat(40), evaluatorVersion: 'retention-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 100, outputTokenLimit: 100 },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: true,
      capabilityAbsentBaseline: true,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
}

function paired(
  baselineTreeHash: string,
  candidateTreeHash: string,
  candidatePassed: boolean,
): PairedTrialResult {
  return {
    backend: 'darwin-seatbelt',
    count: 4,
    assembled: true,
    calibration: [
      { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
      { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
    ],
    baseline: {
      passed: true,
      checks: [{ name: 'prior-case', passed: true }],
      treeHash: baselineTreeHash,
      composition: { fingerprint: '6'.repeat(64), modelCalls: 1, usage: { inputTokens: 10 } },
    },
    candidate: {
      passed: candidatePassed,
      checks: [{ name: 'prior-case', passed: candidatePassed }],
      treeHash: candidateTreeHash,
      composition: { fingerprint: '6'.repeat(64), modelCalls: 1, usage: { inputTokens: 10 } },
    },
  }
}

function fakeJobs() {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  const listeners: JobDoneListener[] = []
  return {
    starts,
    hooks,
    registry: {
      start(spec: JobStart) {
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${starts.length}`
      },
      onJobDone(listener: JobDoneListener) {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
    } as never,
  }
}
