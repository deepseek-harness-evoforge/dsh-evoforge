import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runShadow } from '../src/shadow.ts'

const suiteRoot = resolve(import.meta.dirname, '../../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const skillDir = join(suiteRoot, 'skills', 'build-dsh-plugin')
const casePackDir = join(suiteRoot, 'examples', 'case-packs', 'cache-safe-status')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('cache-safe-status assembled Shadow', () => {
  it('evaluates an exact inactive Candidate while keeping host status outside model context', async () => {
    const { candidateDir, outputDir, originalSkill } = await exactCandidate(
      'A Client UI must read an authoritative host projection and must not mirror changing status into model context.',
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
    try {
      const result = await runShadow({
        casePackDir,
        exactCandidate: {
          claim: 'Clarify that Client UI reads the host projection',
          skillDir: candidateDir,
        },
        outputDir,
        skillDir,
      })

      expect(result.status).toBe('complete')
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        calibration: [
          { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
          { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
        ],
        cases: [{
          id: 'cache-safe-status',
          baseline: 'pass',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'plugin-typecheck', passed: true },
            { name: 'real-loader-boot', passed: true },
            { name: 'host-status-projection', passed: true },
            { name: 'status-update-keeps-composition-stable', passed: true },
            { name: 'status-absent-from-model-surface', passed: true },
            { name: 'dispose-removes-host-service', passed: true },
            { name: 'removal-restores-native-composition', passed: true },
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

async function exactCandidate(instruction: string) {
  const candidateDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-cache-safe-candidate-'))
  const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-cache-safe-output-'))
  await rm(outputDir, { recursive: true })
  temporaryRoots.push(candidateDir, outputDir)
  await cp(skillDir, candidateDir, { recursive: true })
  const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
  await writeFile(join(candidateDir, 'SKILL.md'), `${originalSkill.trimEnd()}\n\n${instruction}\n`)
  return { candidateDir, outputDir, originalSkill }
}
