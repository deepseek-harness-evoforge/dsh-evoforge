import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DiscoveredSkillAdmission,
  DiscoveredSkillAdmissionScheduler,
  type DiscoveredSkillAdmissionTargetConfig,
} from '../src/discovered-skill-admission.ts'
import { hashTree } from '../src/hash.ts'
import type {
  DiscoveredSkillCandidate,
  MaterializedSkillCandidate,
} from '../src/trusted-skill-discovery.ts'
import { runPairedTrial, type PairedTrialResult } from '../src/trial.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('discovered whole-Skill deterministic admission', () => {
  it('qualifies a baseline-fail/candidate-pass package for later Shadow without release authority', async () => {
    const fixture = await admissionFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(false, true))
    const materialize = vi.fn(async (_candidate, path): Promise<MaterializedSkillCandidate> => {
      await mkdir(path)
      await writeFile(join(path, 'SKILL.md'), '---\nname: missing-release-skill\ndescription: Candidate.\n---\n')
      return {
        candidateId: candidate().id,
        path,
        contentHash: candidate().contentHash,
        treeHash: candidate().version.treeHash,
        files: [{ path: 'SKILL.md', mode: '100644', size: 80 }],
      }
    })
    const admission = new DiscoveredSkillAdmission([fixture.target], { materialize }, { runTrial })

    const result = await admission.evaluate(candidate())

    expect(result).toMatchObject({
      status: 'qualified-for-shadow',
      candidateId: candidate().id,
      targetId: 'missing-release-admission',
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
    expect(runTrial).toHaveBeenCalledWith(expect.objectContaining({
      candidateSkillDir: expect.stringContaining('/candidate'),
      skillDir: expect.stringContaining('/baseline'),
      casePackDir: expect.stringContaining('/case-pack'),
    }))
    await expect(admission.evaluate(candidate())).resolves.toEqual(result)
    expect(materialize).toHaveBeenCalledOnce()
    expect(runTrial).toHaveBeenCalledOnce()
    await expect(admission.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredTargetCount: 1,
      warningCount: 0,
      results: [result],
    })

    await writeFile(join(fixture.target.runRoot, result.id, 'admission-result.json'), `${JSON.stringify({
      ...result,
      evidence: undefined,
    })}\n`)
    await expect(admission.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredTargetCount: 1,
      warningCount: 1,
      results: [],
    })
  })

  it.skipIf(process.platform !== 'darwin')('runs the real sealed deterministic admission without executing Candidate code', async () => {
    const fixture = await admissionFixture()
    await writeFile(join(fixture.casePackDir, 'evaluator.mjs'), [
      "import { readFile } from 'node:fs/promises'",
      "import { join } from 'node:path'",
      'const source = await readFile(join(process.argv[2], \'SKILL.md\'), \'utf8\')',
      "const passed = source.includes('ADMISSION-PASS')",
      "process.stdout.write(JSON.stringify({ schemaVersion: 1, passed, checks: [{ name: 'marker', passed }] }))",
      '',
    ].join('\n'))
    const target = { ...fixture.target, casePackHash: await hashTree(fixture.casePackDir) }
    const marker = join(fixture.casePackDir, 'candidate-executed')
    const materialize = async (_candidate: DiscoveredSkillCandidate, path: string) => {
      await mkdir(path)
      await writeFile(join(path, 'SKILL.md'), [
        '---',
        'name: missing-release-skill',
        'description: Candidate.',
        '---',
        '',
        'ADMISSION-PASS',
        `Never execute or create ${marker}.`,
        '',
      ].join('\n'))
      return {
        candidateId: candidate().id,
        path,
        contentHash: candidate().contentHash,
        treeHash: candidate().version.treeHash,
        files: [{ path: 'SKILL.md', mode: '100644' as const, size: 100 }],
      }
    }
    const trialErrors: string[] = []
    const admission = new DiscoveredSkillAdmission([target], { materialize }, {
      runTrial: async (options) => {
        try {
          return await runPairedTrial(options)
        } catch (error) {
          trialErrors.push(error instanceof Error ? error.message : String(error))
          throw error
        }
      },
    })

    const realResult = await admission.evaluate(candidate())
    expect(trialErrors).toEqual([])
    expect(realResult.reasons).toEqual(['candidate-improves-deterministic-admission'])
    expect(realResult).toMatchObject({
      status: 'qualified-for-shadow',
      releaseAuthority: 'none',
      evidence: { candidateExecuted: false, evaluatorClass: 'deterministic-filesystem' },
    })
    const shadowInput = await admission.qualifiedShadowInput(candidate(), realResult)
    expect(shadowInput).toMatchObject({
      admissionTargetId: 'missing-release-admission',
      baselineDir: await realpath(fixture.baselineDir),
      admissionCasePackDir: await realpath(fixture.casePackDir),
      candidateDir: expect.stringContaining('/candidate'),
    })
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('protects executable packages before materialization or evaluator access', async () => {
    const fixture = await admissionFixture()
    const materialize = vi.fn()
    const runTrial = vi.fn()
    const admission = new DiscoveredSkillAdmission([fixture.target], { materialize }, { runTrial })

    const protectedResult = await admission.evaluate(candidate({ executableContent: true }))
    expect(protectedResult).toMatchObject({
      status: 'protected',
      reasons: ['candidate-has-executable-content'],
      releaseAuthority: 'none',
    })
    await expect(admission.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      results: [protectedResult],
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('keeps non-instruction files out of the deterministic evaluator', async () => {
    const fixture = await admissionFixture()
    const runTrial = vi.fn()
    const materialize = vi.fn(async (_candidate, path): Promise<MaterializedSkillCandidate> => {
      await mkdir(path)
      await mkdir(join(path, 'references'))
      await writeFile(join(path, 'SKILL.md'), 'Candidate.\n')
      await writeFile(join(path, 'references', 'helper.mjs'), 'throw new Error("must not execute")\n')
      return {
        candidateId: candidate().id,
        path,
        contentHash: candidate().contentHash,
        treeHash: candidate().version.treeHash,
        files: [
          { path: 'SKILL.md', mode: '100644', size: 11 },
          { path: 'references/helper.mjs', mode: '100644', size: 36 },
        ],
      }
    })
    const admission = new DiscoveredSkillAdmission([fixture.target], { materialize }, { runTrial })

    await expect(admission.evaluate(candidate())).resolves.toMatchObject({
      status: 'protected',
      reasons: ['candidate-is-not-instruction-only'],
      releaseAuthority: 'none',
    })
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('invalidates an otherwise successful Trial if a governance input changes during evaluation', async () => {
    const fixture = await admissionFixture()
    const materialize = vi.fn(async (_candidate, path): Promise<MaterializedSkillCandidate> => {
      await mkdir(path)
      await writeFile(join(path, 'SKILL.md'), 'Candidate.\n')
      return {
        candidateId: candidate().id,
        path,
        contentHash: candidate().contentHash,
        treeHash: candidate().version.treeHash,
        files: [{ path: 'SKILL.md', mode: '100644', size: 11 }],
      }
    })
    const runTrial = vi.fn(async () => {
      await writeFile(join(fixture.casePackDir, 'evaluator.mjs'), 'changed during Trial\n')
      return paired(false, true)
    })
    const admission = new DiscoveredSkillAdmission([fixture.target], { materialize }, { runTrial })

    await expect(admission.evaluate(candidate())).resolves.toMatchObject({
      status: 'incomplete',
      reasons: ['governance-input-mutated'],
      releaseAuthority: 'none',
    })
  })

  it('fails closed before Trial when governance inputs drift or request an assembled evaluator', async () => {
    const fixture = await admissionFixture()
    const materialize = vi.fn()
    const runTrial = vi.fn()
    const drifted = new DiscoveredSkillAdmission([{
      ...fixture.target,
      casePackHash: 'f'.repeat(64),
    }], { materialize }, { runTrial })

    await expect(drifted.evaluate(candidate())).resolves.toMatchObject({
      status: 'incomplete',
      reasons: ['case-pack-identity-mismatch'],
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(runTrial).not.toHaveBeenCalled()

    await writeManifest(fixture.casePackDir, true)
    const assembledTarget = {
      ...fixture.target,
      casePackHash: await hashTree(fixture.casePackDir),
    }
    const assembled = new DiscoveredSkillAdmission([assembledTarget], { materialize }, { runTrial })
    await expect(assembled.evaluate(candidate())).resolves.toMatchObject({
      status: 'incomplete',
      reasons: ['assembled-evaluator-not-governance-separated'],
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('refuses overlapping baseline and Case Pack governance roots', async () => {
    const fixture = await admissionFixture()
    const materialize = vi.fn()
    const runTrial = vi.fn()
    const sharedHash = await hashTree(fixture.casePackDir)
    const admission = new DiscoveredSkillAdmission([{
      ...fixture.target,
      baselineDir: fixture.casePackDir,
      baselineHash: sharedHash,
      casePackHash: sharedHash,
    }], { materialize }, { runTrial })

    await expect(admission.evaluate(candidate())).resolves.toMatchObject({
      status: 'incomplete',
      reasons: ['governance-roots-overlap'],
      releaseAuthority: 'none',
    })
    expect(materialize).not.toHaveBeenCalled()
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('abstains when no exact Workspace and Skill evaluation target exists', async () => {
    const admission = new DiscoveredSkillAdmission([], { materialize: vi.fn() }, { runTrial: vi.fn() })

    await expect(admission.evaluate(candidate())).resolves.toMatchObject({
      status: 'abstained',
      reasons: ['no-exact-evaluation-target'],
      releaseAuthority: 'none',
    })
  })

  it('uses native Jobs for restart candidates and newly discovered candidates without a timer', async () => {
    const existing = candidate()
    const next = { ...candidate(), id: '8'.repeat(64), gapId: '9'.repeat(64) }
    const evaluate = vi.fn(async (value: DiscoveredSkillCandidate) => ({
      schemaVersion: 1 as const,
      id: value.id,
      candidateId: value.id,
      workspaceId: value.workspaceId,
      skillName: value.requestedSkill,
      status: 'abstained' as const,
      reasons: ['no-exact-evaluation-target' as const],
      releaseAuthority: 'none' as const,
    }))
    const onResult = vi.fn()
    const scheduler = new DiscoveredSkillAdmissionScheduler(
      { evaluate, matches: () => true },
      { listCandidates: () => [existing] },
      { onResult },
    )
    const jobs = fakeJobs()

    const detach = scheduler.attachJobs(jobs.registry)
    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'deterministic Skill admission: missing-release-skill',
    })
    await jobs.hooks[0]!.done
    expect(evaluate).toHaveBeenCalledWith(existing, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(onResult).toHaveBeenCalledWith(existing, expect.objectContaining({ candidateId: existing.id }))

    scheduler.observe(next)
    expect(jobs.starts).toHaveLength(2)
    await jobs.hooks[1]!.done
    expect(evaluate).toHaveBeenCalledWith(next, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    detach()
  })

  it('does not start Jobs without an exact target and can retry after a synchronous Jobs rejection', async () => {
    const existing = candidate()
    const evaluate = vi.fn()
    const admission = {
      evaluate,
      matches: vi.fn(() => false),
    }
    const scheduler = new DiscoveredSkillAdmissionScheduler(
      admission,
      { listCandidates: () => [existing] },
    )
    const start = vi.fn()
      .mockImplementationOnce(() => { throw new Error('job capacity unavailable') })
      .mockImplementation((spec: JobStart) => {
        const hooks = spec.run()
        void hooks.done
        return 'evolution-1'
      })

    scheduler.attachJobs({ start } as never)
    expect(start).not.toHaveBeenCalled()
    expect(evaluate).not.toHaveBeenCalled()

    admission.matches.mockReturnValue(true)
    expect(() => scheduler.observe(existing)).not.toThrow()
    expect(start).toHaveBeenCalledOnce()
    expect(evaluate).not.toHaveBeenCalled()

    scheduler.observe(existing)
    expect(start).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledOnce())
  })
})

async function admissionFixture(): Promise<{
  baselineDir: string
  casePackDir: string
  target: DiscoveredSkillAdmissionTargetConfig
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-admission-'))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const casePackDir = join(root, 'case-pack')
  const runRoot = join(root, 'runs')
  await mkdir(baselineDir)
  await mkdir(casePackDir)
  await mkdir(runRoot)
  await writeFile(join(baselineDir, 'SKILL.md'), '---\nname: missing-release-skill\ndescription: Baseline.\n---\n')
  await writeFile(join(casePackDir, 'evaluator.mjs'), 'process.stdout.write("{}")\n')
  await mkdir(join(casePackDir, 'known-bad'))
  await mkdir(join(casePackDir, 'known-correction'))
  await writeFile(join(casePackDir, 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(casePackDir, 'known-correction', 'SKILL.md'), 'ADMISSION-PASS\n')
  await writeManifest(casePackDir, false)
  const target: DiscoveredSkillAdmissionTargetConfig = {
    id: 'missing-release-admission',
    workspaceId: WORKSPACE_ID,
    skill: 'missing-release-skill',
    baselineDir,
    baselineHash: await hashTree(baselineDir),
    casePackDir,
    casePackHash: await hashTree(casePackDir),
    runRoot,
  }
  return { baselineDir, casePackDir, target }
}

async function writeManifest(casePackDir: string, assembled: boolean): Promise<void> {
  await writeFile(join(casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'missing-release-admission',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'dsh-revision', evaluatorVersion: 'admission-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: assembled,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
}

function candidate(options: { executableContent?: boolean } = {}): DiscoveredSkillCandidate {
  return {
    schemaVersion: 1,
    id: '1'.repeat(64),
    discoveredAt: 1_786_896_100_000,
    gapId: '2'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    description: 'Candidate.',
    source: { id: 'local-curated', kind: 'local-git', trust: 'explicit-deployer-config' },
    scope: 'workspace',
    version: { kind: 'git-tree', commit: '3'.repeat(40), treeHash: '4'.repeat(40) },
    contentHash: '5'.repeat(64),
    package: {
      path: 'skills/missing-release-skill',
      fileCount: 1,
      totalBytes: 80,
      hasScripts: options.executableContent ?? false,
      hasReferences: false,
    },
    permissions: {
      declared: false,
      executableContent: options.executableContent ?? false,
      externalEffects: 'unknown',
    },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'git-object-integrity', status: 'passed' },
        { name: 'regular-files-only', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
}

function paired(baseline: boolean, candidatePassed: boolean): PairedTrialResult {
  return {
    backend: 'darwin-seatbelt',
    count: 4,
    assembled: false,
    calibration: [
      { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
      { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
    ],
    baseline: { passed: baseline, checks: [], treeHash: '6'.repeat(64) },
    candidate: { passed: candidatePassed, checks: [], treeHash: '7'.repeat(64) },
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
