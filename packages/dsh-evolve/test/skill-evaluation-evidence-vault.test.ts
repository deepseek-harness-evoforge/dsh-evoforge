import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import type { ExperienceSkillCandidate } from '../src/skill-candidate-repository.ts'
import { SkillEvaluationEvidenceVault } from '../src/skill-evaluation-evidence-vault.ts'
import type { SkillOpportunity } from '../src/skill-opportunity-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('Skill Evaluation Evidence Vault', () => {
  it('seals independent internal Goal samples before Candidate authoring without exposing holdout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-evidence-')))
    roots.push(root)
    const gaps = [
      gap('1', 'goal-a', 10),
      gap('2', 'goal-b', 20),
      gap('3', 'goal-c', 30),
      gap('4', 'goal-d', 40),
    ]
    const opportunity = skillOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
      }],
      { list: () => gaps },
    )

    await expect(vault.readiness(opportunity)).resolves.toEqual({
      status: 'ready-to-seal',
      evidenceId: expect.stringMatching(/^[a-f0-9]{64}$/),
      observedGoalCount: 4,
      authoringGoalCount: 2,
      admissionGoalCount: 1,
      holdoutGoalCount: 1,
      proposerCanReadProtectedSamples: false,
      releaseAuthority: 'none',
    })
    const prepared = await vault.prepare(opportunity)

    await expect(vault.readiness(opportunity)).resolves.toEqual({
      status: 'sealed',
      evidenceId: expect.stringMatching(/^[a-f0-9]{64}$/),
      observedGoalCount: 4,
      authoringGoalCount: 2,
      admissionGoalCount: 1,
      holdoutGoalCount: 1,
      proposerCanReadProtectedSamples: false,
      releaseAuthority: 'none',
    })
    expect(prepared).toMatchObject({
      status: 'ready',
      evidence: {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        opportunityId: opportunity.id,
        skillName: 'missing-release-skill',
        authoringGoalCount: 2,
        admissionGoalCount: 1,
        holdoutGoalCount: 1,
        authoringInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    if (prepared.status !== 'ready') throw new Error('expected ready evidence')
    expect(Object.keys(prepared.evidence).sort()).toEqual([
      'admissionGoalCount',
      'authoringGapIds',
      'authoringGoalCount',
      'authoringGoalEvidence',
      'authoringInputDigest',
      'holdoutGoalCount',
      'id',
      'opportunityId',
      'skillName',
      'workspaceId',
    ])
    expect(prepared.evidence.authoringGoalEvidence).toHaveLength(2)

    const governed = await vault.readForGovernance(
      WORKSPACE_ID,
      opportunity.id,
      prepared.evidence.id,
    )
    expect(governed.samples.map(sample => sample.role).sort()).toEqual([
      'admission',
      'authoring',
      'authoring',
      'holdout',
    ])
    const authoringGoals = new Set(governed.samples
      .filter(sample => sample.role === 'authoring')
      .map(sample => sample.goalId))
    const protectedGoals = governed.samples
      .filter(sample => sample.role !== 'authoring')
      .map(sample => sample.goalId)
    expect(protectedGoals.every(goalId => !authoringGoals.has(goalId))).toBe(true)
    expect(prepared.evidence.authoringGoalEvidence.map(goal => goal.id).sort())
      .toEqual([...authoringGoals].sort())

    const candidate: Pick<ExperienceSkillCandidate,
      'workspaceId' | 'skillName' | 'opportunity' | 'authorship'> = {
      workspaceId: WORKSPACE_ID,
      skillName: opportunity.skillName,
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: 'a'.repeat(64),
        evaluationEvidenceId: prepared.evidence.id,
        inputDigest: prepared.evidence.authoringInputDigest,
      },
    }
    await expect(vault.verifyCandidateBinding(candidate)).resolves.toBeUndefined()
    await expect(vault.verifyCandidateBinding({
      ...candidate,
      authorship: { ...candidate.authorship, evaluationEvidenceId: 'f'.repeat(64) },
    })).rejects.toThrow()
  })

  it('abstains without writing governance state when independent samples are insufficient', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-evidence-')))
    roots.push(root)
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
    const vault = new SkillEvaluationEvidenceVault(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
      }],
      { list: () => gaps },
    )

    await expect(vault.prepare(skillOpportunity(gaps))).resolves.toEqual({
      status: 'abstained',
      reason: 'fewer-than-four-independent-goals',
      observedGoalCount: 2,
      requiredGoalCount: 4,
    })
    await expect(vault.readiness(skillOpportunity(gaps))).resolves.toEqual({
      status: 'waiting',
      reason: 'fewer-than-four-independent-goals',
      observedGoalCount: 2,
      requiredGoalCount: 4,
      releaseAuthority: 'none',
    })
    await expect(realpath(join(root, 'governance'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when sealed governance evidence is modified before authoring or evaluation', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-evidence-')))
    roots.push(root)
    const gaps = [
      gap('1', 'goal-a', 10),
      gap('2', 'goal-b', 20),
      gap('3', 'goal-c', 30),
      gap('4', 'goal-d', 40),
    ]
    const opportunity = skillOpportunity(gaps)
    const governanceRoot = join(root, 'governance')
    const vault = new SkillEvaluationEvidenceVault(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot,
        runRoot: join(root, 'runs'),
      }],
      { list: () => gaps },
    )
    const prepared = await vault.prepare(opportunity)
    if (prepared.status !== 'ready') throw new Error('expected ready evidence')
    const manifest = await vault.readForGovernance(
      WORKSPACE_ID,
      opportunity.id,
      prepared.evidence.id,
    )
    await writeFile(join(
      governanceRoot,
      'evidence',
      opportunity.id,
      prepared.evidence.id,
      'manifest.json',
    ), `${JSON.stringify({
      ...manifest,
      samples: manifest.samples.map((sample, index) => index === 0
        ? { ...sample, objective: `${sample.objective} tampered` }
        : sample),
    }, null, 2)}\n`)

    await expect(vault.readForGovernance(
      WORKSPACE_ID,
      opportunity.id,
      prepared.evidence.id,
    )).rejects.toThrow('evaluation evidence content identity mismatch')
    await expect(vault.readiness(opportunity)).resolves.toEqual({
      status: 'invalid',
      reason: 'opportunity-evidence-invalid',
      observedGoalCount: 4,
      releaseAuthority: 'none',
    })
    await expect(vault.prepare(opportunity))
      .rejects.toThrow('evaluation evidence content identity mismatch')
  })

  it('rejects an oversized governance manifest before writing any evidence', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-evidence-')))
    roots.push(root)
    const gaps = Array.from({ length: 900 }, (_, index) => ({
      ...gap('1', `goal-${index.toString().padStart(4, '0')}-${'x'.repeat(300)}`, index),
      id: (index + 1).toString(16).padStart(64, '0'),
    }))
    const governanceRoot = join(root, 'governance')
    const vault = new SkillEvaluationEvidenceVault(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot,
        runRoot: join(root, 'runs'),
      }],
      { list: () => gaps },
    )

    await expect(vault.prepare(skillOpportunity(gaps)))
      .rejects.toThrow('evaluation evidence manifest exceeds its byte limit')
    await expect(realpath(governanceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function gap(id: string, goalId: string, observedAt: number): CapabilityGap {
  return {
    schemaVersion: 1,
    id: id.repeat(64),
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${goalId}`,
    requestedSkill: 'missing-release-skill',
    catalogHash: 'a'.repeat(64),
    catalogSize: 3,
    goal: {
      id: goalId,
      revision: 1,
      objective: `Goal ${goalId} needs missing-release-skill`,
    },
    status: 'confirmed',
    evidence: {
      kind: 'native-skill-miss',
      catalog: 'complete',
      routing: 'requested-skill-absent',
      providers: 'settled',
    },
  }
}

function skillOpportunity(gaps: readonly CapabilityGap[]): SkillOpportunity {
  return {
    schemaVersion: 3,
    id: 'f'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'missing-release-skill',
    gapIds: gaps.map(value => value.id),
    goalIds: gaps.map(value => value.goal!.id),
    gapCount: gaps.length,
    goalCount: gaps.length,
    firstObservedAt: 10,
    lastObservedAt: 40,
    evidence: {
      kind: 'internal-experience-v3',
      eligibilityBasis: 'two-or-more-distinct-goals',
      correctionSignals: {
        association: 'exact-durable-skill-invocation',
        count: 0,
        goalCount: 0,
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
