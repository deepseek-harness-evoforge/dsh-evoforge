import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewInbox } from '../src/review-inbox.ts'
import { runShadow } from '../src/shadow.ts'
import { runPairedTrial } from '../src/trial.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const skillDir = join(suiteRoot, 'examples', 'skills', 'browser-e2e-baseline')
const casePackRoot = process.env.DSH_EVOLVE_CASE_PACK_ROOT
  ?? join(suiteRoot, 'examples', 'case-packs')
const casePackDir = join(casePackRoot, 'browser-e2e-guidance-assembled')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('capability-absent assembled baseline', () => {
  it('compares untouched DSH without the missing Skill against the exact Candidate package', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-absent-baseline-')))
    roots.push(root)
    const baselineDir = join(root, 'baseline-subject')
    const candidateDir = join(root, 'candidate')
    const outputDir = join(root, 'trial-output')
    await Promise.all([mkdir(baselineDir), mkdir(outputDir), cp(skillDir, candidateDir, { recursive: true })])
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      skillName: 'browser-e2e-baseline',
    })}\n`)
    const source = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
    await writeFile(
      join(candidateDir, 'SKILL.md'),
      `${source.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.\n`,
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
    const manifest = JSON.parse(await readFile(join(casePackDir, 'manifest.json'), 'utf8')) as {
      calibration: { knownBad: string; knownCorrection: string }
      epoch: { dshRevision: string }
      trial: { evaluator: string; timeoutMs: number; outputLimitBytes: number; dshAssembled: true }
    }

    try {
      const result = await runPairedTrial({
        baselineKind: 'capability-absent',
        baselineSkillName: 'browser-e2e-baseline',
        calibration: manifest.calibration,
        candidateSkillDir: candidateDir,
        casePackDir,
        dshRevision: manifest.epoch.dshRevision,
        outputDir,
        skillDir: baselineDir,
        trial: { ...manifest.trial, capabilityAbsentBaseline: true },
        trialLimit: 4,
      })

      expect(result.calibration.every(row => row.passed)).toBe(true)
      expect(result.baseline.passed).toBe(false)
      expect(result.candidate.passed).toBe(true)
      expect(result.baseline.composition?.fingerprint)
        .toBe(result.candidate.composition?.fingerprint)
      await expect(readFile(join(baselineDir, 'SKILL.md'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
    }
  }, 100_000)

  it('carries the absent baseline through an exact Candidate Shadow report', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-absent-shadow-')))
    roots.push(root)
    const baselineDir = join(root, 'baseline-subject')
    const candidateDir = join(root, 'candidate')
    const runRoot = join(root, 'runs')
    const outputDir = join(runRoot, 'shadow')
    await Promise.all([mkdir(baselineDir), mkdir(runRoot), cp(skillDir, candidateDir, { recursive: true })])
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      skillName: 'browser-e2e-baseline',
    })}\n`)
    const source = await readFile(join(candidateDir, 'SKILL.md'), 'utf8')
    await writeFile(
      join(candidateDir, 'SKILL.md'),
      `${source.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.\n`,
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir

    try {
      const result = await runShadow({
        baselineKind: 'capability-absent',
        baselineSkillName: 'browser-e2e-baseline',
        casePackDir,
        exactCandidate: { claim: 'Add the missing browser verification Skill', skillDir: candidateDir },
        outputDir,
        skillDir: baselineDir,
      })

      expect(result.status, JSON.stringify(result)).toBe('complete')
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        subject: { skillName: 'browser-e2e-baseline', baselineKind: 'capability-absent' },
        candidate: {
          parentKind: 'capability-absent',
          changedFiles: ['SKILL.md'],
        },
        cases: [{ baseline: 'fail', candidate: 'pass' }],
        composition: {
          stable: true,
          allowedDifference: ['skill.presence', 'skill.body'],
        },
        decision: { recommendation: 'promote' },
      })
      const review = await new ReviewInbox([{
        workspaceId: '11111111-1111-4111-8111-111111111111',
        path: runRoot,
      }]).scan()
      expect(review.warnings).toEqual([])
      expect(review.candidates).toHaveLength(1)
      expect(review.candidates[0]).toMatchObject({
        skillName: 'browser-e2e-baseline',
        baselineKind: 'capability-absent',
      })
    } finally {
      if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
    }
  }, 100_000)
})
