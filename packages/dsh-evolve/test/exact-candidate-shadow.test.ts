import { access, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runShadow } from '../src/shadow.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('exact Candidate Shadow gates', () => {
  it('requires an assembled DSH Case Pack before creating a run', async () => {
    const fixture = await createFixture(false)

    await expect(runShadow({
      casePackDir: fixture.casePackDir,
      exactCandidate: { claim: 'Pinned discovery Candidate', skillDir: fixture.candidateDir },
      outputDir: fixture.outputDir,
      skillDir: fixture.baselineDir,
    })).rejects.toThrow('exact Candidate Shadow requires an assembled DSH Trial')
    await expect(access(fixture.outputDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a Candidate deletion that the existing Generation publisher cannot reproduce', async () => {
    const fixture = await createFixture(true)
    await rm(join(fixture.candidateDir, 'SKILL.md'))

    await expect(runShadow({
      casePackDir: fixture.casePackDir,
      exactCandidate: { claim: 'Pinned discovery Candidate', skillDir: fixture.candidateDir },
      outputDir: fixture.outputDir,
      skillDir: fixture.baselineDir,
    })).rejects.toThrow("exact Candidate removes baseline file 'SKILL.md'; deletion is not publishable")
    await expect(access(fixture.outputDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function createFixture(assembled: boolean): Promise<{
  baselineDir: string
  candidateDir: string
  casePackDir: string
  outputDir: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-exact-shadow-gate-'))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const candidateDir = join(root, 'candidate')
  const casePackDir = join(root, 'case-pack')
  const outputDir = join(root, 'run')
  await mkdir(baselineDir)
  await mkdir(casePackDir)
  await writeFile(join(baselineDir, 'SKILL.md'), [
    '---',
    'name: exact-shadow-test',
    'description: Baseline.',
    '---',
    '',
  ].join('\n'))
  await cp(baselineDir, candidateDir, { recursive: true })
  await writeFile(join(candidateDir, 'SKILL.md'), [
    '---',
    'name: exact-shadow-test',
    'description: Candidate.',
    '---',
    '',
  ].join('\n'))
  await writeFile(join(casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'exact-shadow-gate',
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: 'gate-v1' },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: assembled,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
  return { baselineDir, candidateDir, casePackDir, outputDir }
}
