import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runShadow } from '../src/shadow.ts'

const suiteRoot = resolve(import.meta.dirname, '../../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const skillDir = join(suiteRoot, 'skills', 'build-dsh-plugin')
const casePackRoot = process.env.DSH_EVOLVE_CASE_PACK_ROOT
  ?? join(suiteRoot, 'examples', 'case-packs')
const casePackDir = join(casePackRoot, 'dispose-owned-watcher')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('dispose-owned-watcher assembled Shadow', () => {
  it('evaluates an exact inactive Candidate across real lifecycle transitions', async () => {
    const candidateDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-watcher-candidate-'))
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-watcher-output-'))
    await rm(outputDir, { recursive: true })
    temporaryRoots.push(candidateDir, outputDir)
    await cp(skillDir, candidateDir, { recursive: true })
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    await writeFile(
      join(candidateDir, 'SKILL.md'),
      `${originalSkill.trimEnd()}\n\nLifecycle probes should assert resource counts after restart, disable, re-enable, and root disposal.\n`,
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
    try {
      const result = await runShadow({
        casePackDir,
        exactCandidate: { claim: 'Clarify lifecycle probe checkpoints', skillDir: candidateDir },
        outputDir,
        skillDir,
      })

      expect(result.status).toBe('complete')
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        cases: [{
          id: 'dispose-owned-watcher',
          baseline: 'pass',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'plugin-typecheck', passed: true },
            { name: 'real-loader-boot', passed: true },
            { name: 'timer-and-watcher-observed', passed: true },
            { name: 'restart-has-one-resource-set', passed: true },
            { name: 'disable-removes-all-resources', passed: true },
            { name: 'reenable-has-one-resource-set', passed: true },
            { name: 'root-dispose-removes-all-resources', passed: true },
            { name: 'model-composition-stable', passed: true },
            { name: 'non-target-composition-stable', passed: true },
          ]),
        }],
        trial: { backend: 'darwin-seatbelt', count: 4 },
        decision: { recommendation: 'review' },
      })
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
    } finally {
      if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
    }
  }, 110_000)
})
