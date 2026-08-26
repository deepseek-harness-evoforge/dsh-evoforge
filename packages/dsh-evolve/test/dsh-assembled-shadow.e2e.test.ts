import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashTree } from '../src/hash.ts'
import { ReviewInbox } from '../src/review-inbox.ts'
import { runShadow } from '../src/shadow.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const suiteRoot = resolve(import.meta.dirname, '../../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const skillDir = join(suiteRoot, 'examples', 'skills', 'browser-e2e-baseline')
const casePackRoot = process.env.DSH_EVOLVE_CASE_PACK_ROOT
  ?? join(suiteRoot, 'examples', 'case-packs')
const casePackDir = join(casePackRoot, 'browser-e2e-guidance-assembled')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe.skipIf(process.platform !== 'darwin')('DSH assembled Shadow', () => {
  it('evaluates one exact discovered Candidate without a proposer and exposes existing review evidence', async () => {
    const runRoot = await mkdtemp(join(tmpdir(), 'dsh-evolve-exact-shadow-runs-'))
    const candidateDir = await mkdtemp(join(tmpdir(), 'dsh-evolve-exact-shadow-candidate-'))
    temporaryRoots.push(runRoot, candidateDir)
    await cp(skillDir, candidateDir, { recursive: true })
    const originalSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    const correctedSkill = `${originalSkill.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.\n`
    await writeFile(join(candidateDir, 'SKILL.md'), correctedSkill)
    const candidateTreeHash = await hashTree(candidateDir)
    const outputDir = join(runRoot, 'exact-discovered-candidate')
    const previousBaseUrl = process.env.DSH_EVOLVE_MODEL_BASE_URL
    const previousModel = process.env.DSH_EVOLVE_MODEL_NAME
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    delete process.env.DSH_EVOLVE_MODEL_BASE_URL
    delete process.env.DSH_EVOLVE_MODEL_NAME
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = dshSourceDir

    try {
      const result = await runShadow({
        casePackDir,
        exactCandidate: {
          claim: 'Adopt the pinned discovered browser-verification guidance',
          skillDir: candidateDir,
        },
        outputDir,
        skillDir,
      })

      expect(result.status).toBe('complete')
      const report = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'))
      expect(report).toMatchObject({
        candidate: {
          treeHash: candidateTreeHash,
          changedFiles: ['SKILL.md'],
        },
        decision: {
          recommendation: 'promote',
          limitations: ['Exact Candidate without internal lineage requires human provenance review'],
        },
        trial: { backend: 'darwin-seatbelt', enforcement: 'full', count: 4 },
      })
      const review = await new ReviewInbox([{ workspaceId: WORKSPACE_ID, path: runRoot }]).scan()
      expect(review.warnings).toEqual([])
      expect(review.candidates).toHaveLength(1)
      expect(review.candidates[0]).toMatchObject({
        status: 'pending',
        skillName: 'browser-e2e-baseline',
        candidateTreeHash,
        proposal: {
          claim: 'Adopt the pinned discovered browser-verification guidance',
          files: [{ path: 'SKILL.md', content: correctedSkill }],
        },
      })
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
    } finally {
      if (previousBaseUrl === undefined) delete process.env.DSH_EVOLVE_MODEL_BASE_URL
      else process.env.DSH_EVOLVE_MODEL_BASE_URL = previousBaseUrl
      if (previousModel === undefined) delete process.env.DSH_EVOLVE_MODEL_NAME
      else process.env.DSH_EVOLVE_MODEL_NAME = previousModel
      if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
    }
  }, 100_000)

})
