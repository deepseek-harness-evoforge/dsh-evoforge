import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runShadow } from '../src/shadow.ts'
import { hashTree } from '../src/hash.ts'
import type { DiscoveredSkillLineage } from '../src/discovered-skill-lineage.ts'
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

  it('binds exact discovery lineage into run identity, report, and resume identity', async () => {
    const fixture = await createFixture(true)
    const lineage = discoveredLineage(await hashTree(fixture.candidateDir))

    const result = await runShadow({
      casePackDir: fixture.casePackDir,
      exactCandidate: { claim: 'Pinned discovery Candidate', lineage, skillDir: fixture.candidateDir },
      outputDir: fixture.outputDir,
      skillDir: fixture.baselineDir,
    })

    expect(result.status).toBe('incomplete')
    const state = JSON.parse(await readFile(join(fixture.outputDir, 'run-state.json'), 'utf8'))
    const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
    expect(state.identity.discoveredSkillLineage).toEqual(lineage)
    expect(report.lineage).toEqual(lineage)
    expect(state.runId).toMatch(/^[a-f0-9]{64}$/u)
    await expect(runShadow({
      casePackDir: fixture.casePackDir,
      exactCandidate: {
        claim: 'Pinned discovery Candidate',
        lineage: { ...lineage, admissionId: '9'.repeat(64) },
        skillDir: fixture.candidateDir,
      },
      outputDir: fixture.outputDir,
      resume: true,
      skillDir: fixture.baselineDir,
    })).rejects.toThrow('Shadow resume inputs do not match the durable run identity')
  })

  it('refuses lineage for a different exact Candidate tree before creating a run', async () => {
    const fixture = await createFixture(true)

    await expect(runShadow({
      casePackDir: fixture.casePackDir,
      exactCandidate: {
        claim: 'Pinned discovery Candidate',
        lineage: discoveredLineage('9'.repeat(64)),
        skillDir: fixture.candidateDir,
      },
      outputDir: fixture.outputDir,
      skillDir: fixture.baselineDir,
    })).rejects.toThrow('discovered Skill lineage does not match the exact Shadow inputs')
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

function discoveredLineage(candidateTreeHash: string): DiscoveredSkillLineage {
  return {
    kind: 'discovered-skill-lineage-v1',
    candidateId: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'exact-shadow-test',
    versionKind: 'git-tree',
    source: { id: 'local-curated', kind: 'local-git', trust: 'explicit-deployer-config' },
    contentHash: '2'.repeat(64),
    candidateTreeHash,
    admissionId: '3'.repeat(64),
    admissionTargetId: 'exact-shadow-admission',
    releaseAuthority: 'none',
  }
}
