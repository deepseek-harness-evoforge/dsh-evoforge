import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashTree } from '../src/hash.ts'
import {
  SkillEvaluationEnvelopeResolver,
  type SkillCandidateEvaluationPolicyConfig,
} from '../src/skill-evaluation-envelope.ts'
import type { SkillOpportunity } from '../src/skill-opportunity-discovery.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('internal Skill Evaluation Envelope', () => {
  it('resolves governance inputs from the Candidate internal Opportunity without a configured Skill target', async () => {
    const fixture = await envelopeFixture()
    const candidate = experienceSkillCandidate()
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )

    const resolved = await resolver.resolve(candidate)

    expect(resolved).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      policyId: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      gapIds: candidate.opportunity.gapIds,
      baselineKind: 'capability-absent',
      baselineSkillName: candidate.skillName,
      baselineDir: fixture.baselineDir,
      baselineHash: fixture.manifest.baseline.descriptorTreeHash,
      admissionCasePackDir: fixture.admissionCasePackDir,
      admissionCasePackHash: fixture.manifest.admissionCasePackHash,
      holdoutCasePackDir: fixture.holdoutCasePackDir,
      holdoutCasePackHash: fixture.manifest.holdoutCasePackHash,
      admissionRunRoot: join(fixture.policy.runRoot, 'admission'),
      shadowRunRoot: join(fixture.policy.runRoot, 'shadow'),
    })
    expect(Object.keys(fixture.policy)).toEqual(['id', 'workspaceId', 'governanceRoot', 'runRoot'])
  })

  it('abstains when the Candidate direction is not a current internal Opportunity', async () => {
    const fixture = await envelopeFixture()
    const candidate = experienceSkillCandidate()
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )

    await expect(resolver.resolve({ ...candidate, skillName: 'operator-selected-skill' }))
      .resolves.toBeUndefined()
  })

  it('fails closed when governance-owned envelope content drifts after sealing', async () => {
    const fixture = await envelopeFixture()
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )
    const subjectPath = join(fixture.baselineDir, 'subject.json')
    await writeFile(subjectPath, `${await readFile(subjectPath, 'utf8')}\n`)

    await expect(resolver.resolve(experienceSkillCandidate()))
      .rejects.toThrow('Skill Evaluation Envelope content identity mismatch')
  })

  it('rejects a placeholder Skill in a capability-absent baseline', async () => {
    const fixture = await envelopeFixture()
    await writeFile(join(fixture.baselineDir, 'SKILL.md'), 'placeholder\n')
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )

    await expect(resolver.resolve(experienceSkillCandidate()))
      .rejects.toThrow('capability-absent baseline must contain only subject.json')
  })

  it('fails closed when admission and holdout are not independent', async () => {
    const casePack = '{"same-case-pack":true}\n'
    const fixture = await envelopeFixture({
      admissionContent: casePack,
      holdoutContent: casePack,
    })
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )

    await expect(resolver.resolve(experienceSkillCandidate()))
      .rejects.toThrow('Skill Evaluation Envelope requires an independent holdout Case Pack')
  })

  it('rejects a manifest symlink even when it resolves inside the governance root', async () => {
    const fixture = await envelopeFixture()
    const envelopeRoot = join(
      fixture.policy.governanceRoot,
      'envelopes',
      experienceSkillCandidate().opportunity.id,
    )
    const manifestPath = join(envelopeRoot, 'manifest.json')
    const targetPath = join(envelopeRoot, 'manifest-target.json')
    await writeFile(targetPath, `${JSON.stringify(fixture.manifest)}\n`)
    await unlink(manifestPath)
    await symlink(targetPath, manifestPath)
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
    )

    await expect(resolver.resolve(experienceSkillCandidate()))
      .rejects.toThrow('Skill Evaluation Envelope manifest must be an exact real file')
  })
})

async function envelopeFixture(options: {
  readonly admissionContent?: string
  readonly holdoutContent?: string
} = {}): Promise<{
  readonly policy: SkillCandidateEvaluationPolicyConfig
  readonly baselineDir: string
  readonly admissionCasePackDir: string
  readonly holdoutCasePackDir: string
  readonly manifest: {
    readonly baseline: { readonly descriptorTreeHash: string }
    readonly admissionCasePackHash: string
    readonly holdoutCasePackHash: string
  }
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-envelope-')))
  roots.push(root)
  const governanceRoot = join(root, 'governance')
  const runRoot = join(root, 'runs')
  const envelopeRoot = join(governanceRoot, 'envelopes', '2'.repeat(64))
  const baselineDir = join(envelopeRoot, 'baseline')
  const admissionCasePackDir = join(envelopeRoot, 'admission')
  const holdoutCasePackDir = join(envelopeRoot, 'holdout')
  await Promise.all([
    baselineDir,
    admissionCasePackDir,
    holdoutCasePackDir,
    runRoot,
  ].map(path => mkdir(path, { recursive: true })))
  await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'internal-capability-absent-subject-v1',
    workspaceId: WORKSPACE_ID,
    opportunityId: '2'.repeat(64),
    skillName: 'release-proof',
  }, null, 2)}\n`)
  await writeFile(
    join(admissionCasePackDir, 'manifest.json'),
    options.admissionContent ?? '{"admission":true}\n',
  )
  await writeFile(
    join(holdoutCasePackDir, 'manifest.json'),
    options.holdoutContent ?? '{"holdout":true}\n',
  )
  const manifest = {
    schemaVersion: 2 as const,
    kind: 'internal-skill-evaluation-envelope-v2' as const,
    workspaceId: WORKSPACE_ID,
    opportunity: {
      id: '2'.repeat(64),
      skillName: 'release-proof',
      gapIds: ['3'.repeat(64), '4'.repeat(64)],
      goalCount: 2,
    },
    baseline: {
      kind: 'capability-absent' as const,
      descriptorTreeHash: await hashTree(baselineDir),
    },
    admissionCasePackHash: await hashTree(admissionCasePackDir),
    holdoutCasePackHash: await hashTree(holdoutCasePackDir),
  }
  await writeFile(join(envelopeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    policy: { id: 'workspace-governance', workspaceId: WORKSPACE_ID, governanceRoot, runRoot },
    baselineDir,
    admissionCasePackDir,
    holdoutCasePackDir,
    manifest,
  }
}

function opportunity(): SkillOpportunity {
  return {
    schemaVersion: 2,
    id: '2'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    gapIds: ['3'.repeat(64), '4'.repeat(64)],
    goalIds: ['goal-a', 'goal-b'],
    gapCount: 2,
    goalCount: 2,
    firstObservedAt: 1,
    lastObservedAt: 2,
    evidence: {
      kind: 'internal-experience-v2',
      eligibilityBasis: 'two-or-more-distinct-goals',
      correctionSignals: {
        association: 'same-session-single-skill-gap',
        count: 0,
        ids: [],
        referencesTruncated: false,
      },
      deliveryOutcomes: {
        association: 'same-goal-single-skill-gap',
        total: 0,
        passed: 0,
        failed: 0,
        unknown: 0,
        ids: [],
        referencesTruncated: false,
      },
      causalClaim: 'none',
    },
    status: 'eligible-for-authoring',
    releaseAuthority: 'none',
  }
}
