import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillCandidateAdmission,
  SkillCandidateAdmissionScheduler,
} from '../src/skill-candidate-admission.ts'
import { hashTree } from '../src/hash.ts'
import type { ExperienceSkillCandidate, MaterializedSkillCandidate } from '../src/skill-candidate-repository.ts'
import type { PairedTrialResult } from '../src/trial.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []
const SKILL_MD = '---\nname: release-proof\ndescription: Candidate.\n---\n\nUse proof.\n'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('internal Skill Candidate deterministic admission', () => {
  it('uses an Opportunity-bound Envelope reader instead of a configured Skill target', async () => {
    const fixture = await admissionFixture()
    const candidate = await candidateFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      false,
      true,
      fixture.target.baselineHash,
      candidate.version.treeHash,
    ))
    const materialize = materializer(candidate)
    const envelopes = {
      hasPolicy: vi.fn(() => true),
      resolve: vi.fn(async () => ({
        id: 'e'.repeat(64),
        policyId: 'workspace-governance',
        workspaceId: candidate.workspaceId,
        skillName: candidate.skillName,
        opportunityId: candidate.opportunity.id,
        evaluationEvidenceId: 'd'.repeat(64),
        gapIds: candidate.opportunity.gapIds,
        baselineKind: 'capability-absent' as const,
        baselineSkillName: candidate.skillName,
        baselineDir: fixture.target.baselineDir,
        baselineHash: fixture.target.baselineHash,
        admissionCasePackDir: fixture.target.casePackDir,
        admissionCasePackHash: fixture.target.casePackHash,
        holdoutCasePackDir: fixture.target.casePackDir,
        holdoutCasePackHash: 'f'.repeat(64),
        admissionRunRoot: fixture.target.runRoot,
        shadowRunRoot: join(fixture.target.runRoot, 'shadow'),
      })),
      policyViews: vi.fn(() => [{
        id: 'workspace-governance',
        workspaceId: candidate.workspaceId,
        admissionRunRoot: fixture.target.runRoot,
      }]),
    }
    const admission = new SkillCandidateAdmission(envelopes as never, { materialize }, { runTrial })

    await expect(admission.evaluate(candidate)).resolves.toMatchObject({
      status: 'qualified-for-shadow',
      envelopeId: 'e'.repeat(64),
    })
    expect(envelopes.resolve).toHaveBeenCalledWith(candidate)
  })

  it('qualifies a baseline-fail/candidate-pass package for later Shadow without release authority', async () => {
    const fixture = await admissionFixture()
    const candidate = await candidateFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      false,
      true,
      fixture.target.baselineHash,
      candidate.version.treeHash,
    ))
    const materialize = materializer(candidate)
    const admission = new SkillCandidateAdmission(
      evaluationEnvelopes(fixture, candidate),
      { materialize },
      { runTrial },
    )

    const result = await admission.evaluate(candidate)

    expect(result).toMatchObject({
      status: 'qualified-for-shadow',
      candidateId: candidate.id,
      envelopeId: 'e'.repeat(64),
      reasons: ['candidate-improves-deterministic-admission'],
      releaseAuthority: 'none',
      evidence: {
        baseline: 'fail',
        candidate: 'pass',
        calibrationPassed: true,
        candidateExecuted: false,
        evaluatorClass: 'deterministic-filesystem',
      },
    })
    expect(materialize).toHaveBeenCalledOnce()
    expect(runTrial).toHaveBeenCalledOnce()
    await expect(admission.evaluate(candidate)).resolves.toEqual(result)
    expect(materialize).toHaveBeenCalledOnce()
    await expect(admission.qualifiedShadowInput(candidate, result)).resolves.toMatchObject({
      retentionCasePackDir: await realpath(fixture.target.retentionCasePackDir),
      retentionCasePackHash: fixture.target.retentionCasePackHash,
      retentionRunRoot: await realpath(fixture.target.retentionRunRoot),
    })
    await expect(admission.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      results: [result],
    })
  })

  it('protects executable Candidates before materialization or evaluation', async () => {
    const fixture = await admissionFixture()
    const candidate = await candidateFixture({
      package: {
        path: 'release-proof',
        fileCount: 2,
        totalBytes: 100,
        hasScripts: true as never,
        hasReferences: true,
      },
      permissions: {
        declared: true,
        executableContent: true as never,
        externalEffects: 'unknown',
      },
    })
    const materialize = vi.fn()
    const runTrial = vi.fn()
    const admission = new SkillCandidateAdmission(
      evaluationEnvelopes(fixture, candidate),
      { materialize },
      { runTrial },
    )

    await expect(admission.evaluate(candidate)).resolves.toMatchObject({
      status: 'protected',
      reasons: ['candidate-has-executable-content'],
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('abstains when governance has no current Opportunity-bound Envelope', async () => {
    const admission = new SkillCandidateAdmission({
      hasPolicy: () => true,
      resolve: async () => undefined,
      policyViews: () => [],
    }, { materialize: vi.fn() }, { runTrial: vi.fn() })
    await expect(admission.evaluate(await candidateFixture())).resolves.toMatchObject({
      status: 'abstained',
      reasons: ['no-current-evaluation-envelope'],
      releaseAuthority: 'none',
    })
  })

  it('treats an uncreated admission run root as an empty queue, not invalid evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-empty-admission-'))
    roots.push(root)
    const admission = new SkillCandidateAdmission({
      hasPolicy: () => true,
      resolve: async () => undefined,
      policyViews: () => [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        admissionRunRoot: join(root, 'not-created'),
      }],
    }, { materialize: vi.fn() }, { runTrial: vi.fn() })

    await expect(admission.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredPolicyCount: 1,
      warningCount: 0,
      results: [],
    })
  })

  it('uses native Jobs as its only scheduler and resumes durable Candidates', async () => {
    const existing = await candidateFixture()
    const evaluate = vi.fn(async (candidate: ExperienceSkillCandidate) => ({
      schemaVersion: 2 as const,
      id: candidate.id,
      candidateId: candidate.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.skillName,
      status: 'abstained' as const,
      reasons: ['no-current-evaluation-envelope' as const],
      releaseAuthority: 'none' as const,
    }))
    const onResult = vi.fn()
    const scheduler = new SkillCandidateAdmissionScheduler(
      { evaluate, matches: () => true },
      { listCandidates: () => [existing] },
      { onResult },
    )
    const jobs = fakeJobs()

    const detach = scheduler.attachJobs(jobs.registry)
    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'deterministic Skill admission: release-proof',
    })
    await jobs.hooks[0]!.done
    expect(evaluate).toHaveBeenCalledWith(existing, { signal: expect.any(AbortSignal) })
    expect(onResult).toHaveBeenCalledWith(existing, expect.objectContaining({ candidateId: existing.id }))
    detach()
  })
})

async function admissionFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-admission-'))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const casePackDir = join(root, 'case-pack')
  const retentionCasePackDir = join(root, 'retention-case-pack')
  const runRoot = join(root, 'runs')
  const retentionRunRoot = join(root, 'retention-runs')
  await mkdir(baselineDir)
  await mkdir(casePackDir)
  await mkdir(retentionCasePackDir)
  await mkdir(runRoot)
  await mkdir(retentionRunRoot)
  await writeFile(join(baselineDir, 'subject.json'), '{"kind":"internal-capability-absent-subject-v1"}\n')
  await writeFile(join(casePackDir, 'evaluator.mjs'), 'process.stdout.write("{}")\n')
  await mkdir(join(casePackDir, 'evidence'))
  await mkdir(join(casePackDir, 'known-bad'))
  await mkdir(join(casePackDir, 'known-correction'))
  await writeFile(join(casePackDir, 'evidence', 'rationale.md'), 'Internal test rationale.\n')
  await writeFile(join(casePackDir, 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(casePackDir, 'known-correction', 'SKILL.md'), 'good\n')
  await writeFile(join(casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'release-proof-admission',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'dsh-revision', evaluatorVersion: 'admission-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
    evidence: { rationale: 'evidence/rationale.md' },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: false,
      capabilityAbsentBaseline: true,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  })}\n`)
  await writeFile(join(retentionCasePackDir, 'manifest.json'), '{"retention":true}\n')
  return {
    target: {
      id: 'release-proof-admission',
      workspaceId: WORKSPACE_ID,
      skill: 'release-proof',
      baselineDir,
      baselineHash: await hashTree(baselineDir),
      casePackDir,
      casePackHash: await hashTree(casePackDir),
      retentionCasePackDir,
      retentionCasePackHash: await hashTree(retentionCasePackDir),
      runRoot,
      retentionRunRoot,
    },
  }
}

function evaluationEnvelopes(
  fixture: Awaited<ReturnType<typeof admissionFixture>>,
  candidate: ExperienceSkillCandidate,
) {
  return {
    hasPolicy: () => true,
    resolve: vi.fn(async () => ({
      id: 'e'.repeat(64),
      policyId: 'workspace-governance',
      workspaceId: candidate.workspaceId,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      evaluationEvidenceId: 'd'.repeat(64),
      gapIds: candidate.opportunity.gapIds,
      baselineKind: 'capability-absent' as const,
      baselineSkillName: candidate.skillName,
      baselineDir: fixture.target.baselineDir,
      baselineHash: fixture.target.baselineHash,
      admissionCasePackDir: fixture.target.casePackDir,
      admissionCasePackHash: fixture.target.casePackHash,
      holdoutCasePackDir: fixture.target.casePackDir,
      holdoutCasePackHash: 'f'.repeat(64),
      retentionCasePackDir: fixture.target.retentionCasePackDir,
      retentionCasePackHash: fixture.target.retentionCasePackHash,
      admissionRunRoot: fixture.target.runRoot,
      shadowRunRoot: join(fixture.target.runRoot, 'shadow'),
      retentionRunRoot: fixture.target.retentionRunRoot,
    })),
    policyViews: () => [{
      id: 'workspace-governance',
      workspaceId: candidate.workspaceId,
      admissionRunRoot: fixture.target.runRoot,
    }],
  }
}

async function candidateFixture(
  overrides: Partial<ExperienceSkillCandidate> = {},
): Promise<ExperienceSkillCandidate> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-candidate-tree-'))
  roots.push(root)
  await writeFile(join(root, 'SKILL.md'), SKILL_MD)
  const treeHash = await hashTree(root)
  return experienceSkillCandidate({
    version: {
      kind: 'experience-authored-bundle-v1',
      artifactDigest: '7'.repeat(64),
      treeHash,
    },
    ...overrides,
  })
}

function materializer(candidate: ExperienceSkillCandidate) {
  return vi.fn(async (_candidate: ExperienceSkillCandidate, path: string): Promise<MaterializedSkillCandidate> => {
    await mkdir(path)
    await writeFile(join(path, 'SKILL.md'), SKILL_MD)
    return {
      candidateId: candidate.id,
      path,
      contentHash: candidate.contentHash,
      treeHash: candidate.version.treeHash,
      files: [{ path: 'SKILL.md', mode: '100644', size: Buffer.byteLength(SKILL_MD) }],
    }
  })
}

function paired(
  baseline: boolean,
  candidatePassed: boolean,
  baselineTreeHash = 'a'.repeat(64),
  candidateTreeHash = 'b'.repeat(64),
): PairedTrialResult {
  return {
    backend: 'darwin-seatbelt',
    count: 4,
    assembled: false,
    calibration: [
      { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
      { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
    ],
    baseline: { passed: baseline, checks: [], treeHash: baselineTreeHash },
    candidate: { passed: candidatePassed, checks: [], treeHash: candidateTreeHash },
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
