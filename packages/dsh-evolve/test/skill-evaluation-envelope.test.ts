import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { hashTree } from '../src/hash.ts'
import {
  SkillEvaluationEvidenceVault,
  skillEvaluationProtectedInputDigest,
} from '../src/skill-evaluation-evidence-vault.ts'
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
    const candidate = fixture.candidate
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    const resolved = await resolver.resolve(candidate)

    expect(resolved).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{64}$/u),
      policyId: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      opportunityId: candidate.opportunity.id,
      evaluationEvidenceId: fixture.manifest.evaluationEvidenceId,
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
    const candidate = fixture.candidate
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    await expect(resolver.resolve({ ...candidate, skillName: 'operator-selected-skill' }))
      .resolves.toBeUndefined()
  })

  it('fails closed when governance-owned envelope content drifts after sealing', async () => {
    const fixture = await envelopeFixture()
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )
    const subjectPath = join(fixture.baselineDir, 'subject.json')
    await writeFile(subjectPath, `${await readFile(subjectPath, 'utf8')}\n`)

    await expect(resolver.resolve(fixture.candidate))
      .rejects.toThrow('Skill Evaluation Envelope content identity mismatch')
  })

  it('rejects a placeholder Skill in a capability-absent baseline', async () => {
    const fixture = await envelopeFixture()
    await writeFile(join(fixture.baselineDir, 'SKILL.md'), 'placeholder\n')
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    await expect(resolver.resolve(fixture.candidate))
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
      fixture.vault,
    )

    await expect(resolver.resolve(fixture.candidate))
      .rejects.toThrow('Skill Evaluation Envelope requires an independent holdout Case Pack')
  })

  it('rejects a manifest symlink even when it resolves inside the governance root', async () => {
    const fixture = await envelopeFixture()
    const envelopeRoot = join(
      fixture.policy.governanceRoot,
      'envelopes',
      fixture.candidate.opportunity.id,
      fixture.candidate.authorship.evaluationEvidenceId,
    )
    const manifestPath = join(envelopeRoot, 'manifest.json')
    const targetPath = join(envelopeRoot, 'manifest-target.json')
    await writeFile(targetPath, `${JSON.stringify(fixture.manifest)}\n`)
    await unlink(manifestPath)
    await symlink(targetPath, manifestPath)
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    await expect(resolver.resolve(fixture.candidate))
      .rejects.toThrow('Skill Evaluation Envelope manifest must be an exact real file')
  })

  it('rejects a Candidate whose author input is not the sealed evaluation evidence subset', async () => {
    const fixture = await envelopeFixture()
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    await expect(resolver.resolve({
      ...fixture.candidate,
      authorship: { ...fixture.candidate.authorship, inputDigest: 'f'.repeat(64) },
    })).rejects.toThrow('Candidate authoring does not match its sealed evaluation evidence')
  })

  it('fails closed when an Envelope claims a different protected-sample author input', async () => {
    const fixture = await envelopeFixture()
    const envelopeRoot = join(
      fixture.policy.governanceRoot,
      'envelopes',
      fixture.candidate.opportunity.id,
      fixture.candidate.authorship.evaluationEvidenceId,
    )
    await writeFile(join(envelopeRoot, 'manifest.json'), `${JSON.stringify({
      ...fixture.manifest,
      governance: {
        ...fixture.manifest.governance,
        admissionInputDigest: 'f'.repeat(64),
      },
    }, null, 2)}\n`)
    const resolver = new SkillEvaluationEnvelopeResolver(
      [fixture.policy],
      { discover: () => [opportunity()] },
      fixture.vault,
    )

    await expect(resolver.resolve(fixture.candidate))
      .rejects.toThrow('Evaluation Envelope protected inputs do not match their evidence seal')
  })
})

async function envelopeFixture(options: {
  readonly admissionContent?: string
  readonly holdoutContent?: string
} = {}): Promise<{
  readonly policy: SkillCandidateEvaluationPolicyConfig
  readonly vault: SkillEvaluationEvidenceVault
  readonly candidate: ReturnType<typeof experienceSkillCandidate>
  readonly baselineDir: string
  readonly admissionCasePackDir: string
  readonly holdoutCasePackDir: string
  readonly manifest: {
    readonly evaluationEvidenceId: string
    readonly governance: {
      readonly modelIdentityHash: string
      readonly admissionInputDigest: string
      readonly holdoutInputDigest: string
    }
    readonly baseline: { readonly descriptorTreeHash: string }
    readonly admissionCasePackHash: string
    readonly holdoutCasePackHash: string
  }
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-envelope-')))
  roots.push(root)
  const governanceRoot = join(root, 'governance')
  const runRoot = join(root, 'runs')
  const policy = { id: 'workspace-governance', workspaceId: WORKSPACE_ID, governanceRoot, runRoot }
  const gaps = opportunityGaps()
  const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
  const prepared = await vault.prepare(opportunity())
  if (prepared.status !== 'ready') throw new Error('expected evaluation evidence')
  const governed = await vault.readForGovernance(
    WORKSPACE_ID,
    opportunity().id,
    prepared.evidence.id,
  )
  const candidate = experienceSkillCandidate({
    opportunity: {
      kind: 'internal-experience-v1',
      id: '2'.repeat(64),
      gapIds: gaps.map(gap => gap.id),
      goalCount: 4,
    },
    authorship: {
      kind: 'bounded-model-authoring-v1',
      policyId: 'workspace-experience-author',
      modelIdentityHash: '5'.repeat(64),
      evaluationEvidenceId: prepared.evidence.id,
      inputDigest: prepared.evidence.authoringInputDigest,
    },
  })
  const envelopeRoot = join(
    governanceRoot,
    'envelopes',
    '2'.repeat(64),
    prepared.evidence.id,
  )
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
    schemaVersion: 4 as const,
    kind: 'internal-skill-evaluation-envelope-v4' as const,
    workspaceId: WORKSPACE_ID,
    evaluationEvidenceId: prepared.evidence.id,
    opportunity: {
      id: '2'.repeat(64),
      skillName: 'release-proof',
      gapIds: gaps.map(gap => gap.id),
      goalCount: 4,
    },
    baseline: {
      kind: 'capability-absent' as const,
      descriptorTreeHash: await hashTree(baselineDir),
    },
    governance: {
      modelIdentityHash: '6'.repeat(64),
      admissionInputDigest: skillEvaluationProtectedInputDigest(governed, 'admission'),
      holdoutInputDigest: skillEvaluationProtectedInputDigest(governed, 'holdout'),
    },
    admissionCasePackHash: await hashTree(admissionCasePackDir),
    holdoutCasePackHash: await hashTree(holdoutCasePackDir),
  }
  await writeFile(join(envelopeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    policy,
    vault,
    candidate,
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
    gapIds: opportunityGaps().map(gap => gap.id),
    goalIds: ['goal-a', 'goal-b', 'goal-c', 'goal-d'],
    gapCount: 4,
    goalCount: 4,
    firstObservedAt: 1,
    lastObservedAt: 4,
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

function opportunityGaps(): CapabilityGap[] {
  return ['a', 'b', 'c', 'd'].map((seed, index) => ({
    schemaVersion: 1,
    id: String(index + 3).repeat(64),
    observedAt: index + 1,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${seed}`,
    requestedSkill: 'release-proof',
    catalogHash: 'a'.repeat(64),
    catalogSize: 1,
    goal: {
      id: `goal-${seed}`,
      revision: 1,
      objective: `Prove release workflow ${seed}`,
    },
    status: 'confirmed',
    evidence: {
      kind: 'native-skill-miss',
      catalog: 'complete',
      routing: 'requested-skill-absent',
      providers: 'settled',
    },
  }))
}
