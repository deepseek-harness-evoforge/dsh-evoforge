import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AutoPromotionPolicy } from '../src/auto-promotion.js'
import { GitSkillSource } from '../src/git-skill-source.js'
import { hashTree } from '../src/hash.js'
import type { EvolutionStore } from '../src/generation-store.js'
import type { ReviewCandidate } from '../src/review-inbox.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'
import type { RetentionEvidenceGate } from '../src/retention-evidence-index.js'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { recursive: true, force: true })
  }))
})

describe('automatic clear-instruction promotion policy', () => {
  it('accepts only a small append-only clear win on an explicitly allowed Skill', async () => {
    const fixture = await policyFixture()

    await expect(fixture.policy.evaluate(fixture.candidate)).resolves.toMatchObject({
      eligible: true,
      policyVersion: 'auto-clear-instruction-v1',
      reasons: ['sealed clear win; append-only instruction change has no protected-effect terms'],
    })
  })

  it('routes edits, protected actions, unstable composition, and ambiguous evidence to review', async () => {
    const fixture = await policyFixture()
    const cases: Array<[string, ReviewCandidate]> = [
      ['not append-only', mutate(fixture.candidate, candidate => {
        candidate.proposal.files[0]!.content = candidate.proposal.files[0]!.content.replace('Baseline', 'Changed')
      })],
      ['protected-effect term', mutate(fixture.candidate, candidate => {
        candidate.proposal.files[0]!.content += '\nDeploy to production automatically.\n'
      })],
      ['composition is not explicitly stable', mutate(fixture.candidate, candidate => {
        candidate.compositionStable = false
      })],
      ['recommendation is not a clear win', mutate(fixture.candidate, candidate => {
        candidate.recommendation = 'review'
      })],
      ['append is too large', mutate(fixture.candidate, candidate => {
        candidate.proposal.files[0]!.content += 'x'.repeat(2_049)
      })],
      ['another file changes', mutate(fixture.candidate, candidate => {
        candidate.changedFiles = ['SKILL.md', 'notes.md']
        candidate.proposal.files.push({ path: 'notes.md', content: 'note' })
      })],
      ['Trial count is too small', mutate(fixture.candidate, candidate => {
        candidate.cost.trialCount = 3
      })],
      ['evidence has an unknown limitation', mutate(fixture.candidate, candidate => {
        candidate.limitations = ['subjective model preference']
      })],
    ]

    for (const [reason, candidate] of cases) {
      const result = await fixture.policy.evaluate(candidate)
      expect(result.eligible, reason).toBe(false)
      expect(result.reasons.length, reason).toBeGreaterThan(0)
    }
  })

  it('requires retained evidence when the opt-in gate is configured', async () => {
    const fixture = await policyFixture()
    const gate: RetentionEvidenceGate = {
      evaluate: async () => ({
        status: 'missing' as const,
        matchedReports: 0,
        reasons: ['no exact Retention evidence is available'],
        warnings: [],
      }),
    }
    const policy = new AutoPromotionPolicy(
      fixture.source,
      fixture.store,
      ['stable-skill'],
      gate,
    )

    await expect(policy.evaluate(fixture.candidate)).resolves.toMatchObject({
      eligible: false,
      reasons: expect.arrayContaining(['no exact Retention evidence is available']),
    })
    gate.evaluate = async () => ({
      status: 'retained' as const,
      matchedReports: 1,
      reasons: ['one exact prior Case Pack retained the Candidate capability'],
      warnings: [],
    })
    await expect(policy.evaluate(fixture.candidate)).resolves.toMatchObject({ eligible: true })
  })
})

async function policyFixture(): Promise<{
  candidate: ReviewCandidate
  policy: AutoPromotionPolicy
  source: GitSkillSource
  store: EvolutionStore
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-auto-policy-'))
  temporaryRoots.push(root)
  const repository = join(root, 'source')
  const skillDir = join(repository, 'skills', 'stable-skill')
  await mkdir(skillDir, { recursive: true })
  const baseline = [
    '---',
    'name: stable-skill',
    'description: Stable test Skill.',
    '---',
    '',
    'Baseline instructions.',
    '',
  ].join('\n')
  await writeFile(join(skillDir, 'SKILL.md'), baseline)
  await git(repository, 'init', '--quiet')
  await git(repository, 'add', 'skills/stable-skill/SKILL.md')
  await git(repository, '-c', 'user.name=EvoForge Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '-m', 'baseline')
  const proposal = `${baseline}Verify the exact result before reporting completion.\n`
  const source = new GitSkillSource(join(root, 'cache'), [{
    name: 'stable-skill',
    repository,
    path: 'skills/stable-skill',
  }])
  const store = { getActiveGeneration: () => undefined } as unknown as EvolutionStore
  const candidate: ReviewCandidate = {
    workspaceId: WORKSPACE_ID,
    id: '1'.repeat(64),
    runId: '2'.repeat(64),
    status: 'pending',
    outputDir: join(root, 'run'),
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'Verify exact result',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: '3'.repeat(64),
    baseTreeHash: await hashTree(skillDir),
    proposalHash: '4'.repeat(64),
    proposal: { claim: 'Verify exact result', files: [{ path: 'SKILL.md', content: proposal }] },
    cases: [{ id: 'held-out', baseline: 'fail', candidate: 'pass', passedChecks: 3, totalChecks: 3 }],
    cost: { inputTokens: 100, outputTokens: 30, trialCount: 4 },
    reasons: ['candidate passed sealed final-test while baseline failed'],
    limitations: ['P0A.3 uses a keyless scripted model through one real assembled DSH path on macOS'],
    evaluatorVersion: 'fixture-v1',
    compositionFingerprint: '5'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: '6'.repeat(64),
  }
  return { candidate, policy: new AutoPromotionPolicy(source, store, ['stable-skill']), source, store }
}

function mutate(candidate: ReviewCandidate, update: (copy: ReviewCandidate) => void): ReviewCandidate {
  const copy = structuredClone(candidate)
  update(copy)
  return copy
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile('git', ['-C', repository, ...args])
}

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory()) await makeWritable(join(path, entry.name))
  }
}
