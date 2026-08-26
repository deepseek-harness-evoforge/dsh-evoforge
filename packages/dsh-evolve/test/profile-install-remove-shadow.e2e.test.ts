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
const casePackDir = join(casePackRoot, 'profile-install-remove')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('profile-install-remove assembled Shadow', () => {
  it('evaluates an exact inactive Candidate through real install, boot, and removal', async () => {
    const candidateDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-profile-candidate-'))
    const outputDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-profile-output-'))
    await rm(outputDir, { recursive: true })
    temporaryRoots.push(candidateDir, outputDir)
    await cp(skillDir, candidateDir, { recursive: true })
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    await writeFile(
      join(candidateDir, 'SKILL.md'),
      `${originalSkill.trimEnd()}\n\nProfile acceptance should compare dumps before install, after activation, and after removal.\n`,
    )
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir
    try {
      const result = await runShadow({
        casePackDir,
        exactCandidate: { claim: 'Clarify profile dump checkpoints', skillDir: candidateDir },
        outputDir,
        skillDir,
      })

      expect(result.status).toBe('complete')
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        cases: [{
          id: 'profile-install-remove',
          baseline: 'pass',
          candidate: 'pass',
          checks: expect.arrayContaining([
            { name: 'plugin-parse', passed: true },
            { name: 'real-dsh-plugin-add', passed: true },
            { name: 'bundle-selected-on-install', passed: true },
            { name: 'dump-config-has-exact-row', passed: true },
            { name: 'installed-profile-boots', passed: true },
            { name: 'real-dsh-plugin-remove', passed: true },
            { name: 'profile-manifest-restored', passed: true },
            { name: 'native-dump-restored', passed: true },
            { name: 'native-profile-boots', passed: true },
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
  }, 150_000)
})
