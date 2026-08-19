import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobDoneListener, JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillCandidateShadowLauncher,
  SkillCandidateShadowScheduler,
} from '../src/skill-candidate-shadow.ts'
import { hashTree } from '../src/hash.ts'
import type { SkillCandidateAdmissionResult } from '../src/skill-candidate-admission.ts'
import type { ExperienceSkillCandidate } from '../src/skill-candidate-repository.ts'
import type { SkillCandidateLineage } from '../src/skill-candidate-lineage.ts'
import {
  experienceSkillCandidate,
  internalSkillCandidateLineage,
  qualifiedSkillCandidateAdmission,
} from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('qualified Skill Candidate Shadow handoff', () => {
  it('launches only the exact qualified Candidate through its independent assembled holdout', async () => {
    const fixture = await shadowFixture()
    const admission = {
      qualifiedShadowInput: vi.fn(async () => ({
        evaluationEnvelopeId: qualified().envelopeId!,
        baselineDir: await realpath(fixture.baselineDir),
        candidateDir: await realpath(fixture.candidateDir),
        admissionCasePackDir: await realpath(fixture.admissionCasePackDir),
        admissionCasePackHash: await hashTree(fixture.admissionCasePackDir),
        admissionRunRoot: await realpath(fixture.admissionRunRoot),
        holdoutCasePackDir: await realpath(fixture.shadowCasePackDir),
        holdoutCasePackHash: fixture.target.casePackHash,
        shadowRunRoot: await realpath(fixture.shadowRunRoot),
        lineage: lineage(),
      })),
    }
    const runShadow = vi.fn(async () => ({
      status: 'complete' as const,
      reportPath: join(fixture.shadowRunRoot, 'report.json'),
      summary: 'promote: exact Candidate passed assembled holdout',
    }))
    const launcher = new SkillCandidateShadowLauncher(admission, { runShadow })

    expect(launcher.matches(candidate(), qualified())).toBe(true)
    await expect(launcher.launch(candidate(), qualified())).resolves.toMatchObject({ status: 'complete' })
    expect(runShadow).toHaveBeenCalledWith(expect.objectContaining({
      casePackDir: await realpath(fixture.shadowCasePackDir),
      expectedCasePackHash: fixture.target.casePackHash,
      exactCandidate: {
        claim: candidate().description,
        lineage: lineage(),
        skillDir: await realpath(fixture.candidateDir),
      },
      outputDir: expect.stringMatching(new RegExp(`^${await realpath(fixture.shadowRunRoot)}/[a-f0-9]{64}$`, 'u')),
      skillDir: await realpath(fixture.baselineDir),
    }))
  })

  it('uses DSH Jobs, ignores non-qualified results, and retries a rejected start on job settlement', async () => {
    const launch = vi.fn(async () => ({
      status: 'complete' as const,
      reportPath: '/owned/report.json',
      summary: 'complete',
    }))
    const launcher = { matches: vi.fn(() => true), launch }
    const scheduler = new SkillCandidateShadowScheduler(launcher)
    const jobs = fakeJobs(true)
    scheduler.attachJobs(jobs.registry)

    scheduler.observe(candidate(), { ...qualified(), status: 'review' })
    expect(jobs.starts).toHaveLength(0)

    scheduler.observe(candidate(), qualified())
    expect(jobs.startAttempts).toBe(1)
    expect(jobs.starts).toHaveLength(0)
    jobs.settle()
    expect(jobs.starts).toHaveLength(1)
    await jobs.hooks[0]!.done
    expect(launch).toHaveBeenCalledOnce()
  })
})

async function shadowFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-candidate-shadow-'))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const admissionCasePackDir = join(root, 'admission-case')
  const admissionRunRoot = join(root, 'admission-runs')
  const candidateDir = join(admissionRunRoot, 'qualified-admission', 'candidate')
  const shadowCasePackDir = join(root, 'shadow-case')
  const shadowRunRoot = join(root, 'shadow-runs')
  await Promise.all([
    baselineDir,
    admissionCasePackDir,
    admissionRunRoot,
    shadowCasePackDir,
    shadowRunRoot,
  ].map(path => mkdir(path)))
  await mkdir(candidateDir, { recursive: true })
  await writeFile(join(baselineDir, 'SKILL.md'), 'baseline\n')
  await writeFile(join(candidateDir, 'SKILL.md'), 'candidate\n')
  await writeFile(join(admissionCasePackDir, 'manifest.json'), '{"admission":true}\n')
  await writeFile(join(shadowCasePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'internal-candidate-holdout',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: 'holdout-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: true,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
  const target = {
    id: 'internal-candidate-holdout',
    workspaceId: WORKSPACE_ID,
    skill: 'missing-release-skill',
    casePackDir: shadowCasePackDir,
    casePackHash: await hashTree(shadowCasePackDir),
    runRoot: shadowRunRoot,
  }
  return {
    root,
    baselineDir,
    candidateDir,
    admissionCasePackDir,
    admissionRunRoot,
    shadowCasePackDir,
    shadowRunRoot,
    target,
  }
}

function candidate(): ExperienceSkillCandidate {
  return experienceSkillCandidate({
    skillName: 'missing-release-skill',
    description: 'Adopt the pinned Skill Candidate package',
    package: { path: 'missing-release-skill', fileCount: 2, totalBytes: 10, hasScripts: false, hasReferences: true },
  })
}

function qualified(): SkillCandidateAdmissionResult {
  return qualifiedSkillCandidateAdmission(candidate()) satisfies SkillCandidateAdmissionResult
}

function lineage(): SkillCandidateLineage {
  return internalSkillCandidateLineage({
    candidateId: candidate().id,
    skillName: candidate().skillName,
    opportunityId: candidate().opportunity.id,
    policyId: candidate().authorship.policyId,
    versionKind: candidate().version.kind,
    contentHash: candidate().contentHash,
    candidateTreeHash: qualified().evidence!.candidateTreeHash,
    admissionId: qualified().id,
    evaluationEnvelopeId: qualified().envelopeId!,
  })
}

function fakeJobs(rejectFirst: boolean) {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  const listeners: JobDoneListener[] = []
  let attempts = 0
  return {
    starts,
    hooks,
    get startAttempts() { return attempts },
    settle() { for (const listener of listeners) void listener({} as never, undefined) },
    registry: {
      start(spec: JobStart) {
        attempts += 1
        if (rejectFirst && attempts === 1) throw new Error('capacity unavailable')
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${attempts}`
      },
      onJobDone(listener: JobDoneListener) {
        listeners.push(listener)
        return () => undefined
      },
    } as never,
  }
}
