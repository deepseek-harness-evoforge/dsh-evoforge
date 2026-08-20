import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { boundedModelProviderIdentity } from '../src/model-provider-identity.ts'
import { SkillEvaluationEnvelopeResolver } from '../src/skill-evaluation-envelope.ts'
import { SkillEvaluationEvidenceVault } from '../src/skill-evaluation-evidence-vault.ts'
import {
  SkillEvaluationGovernance,
  type SkillEvaluationCaseAuthorInput,
} from '../src/skill-evaluation-governance.ts'
import type { SkillOpportunity } from '../src/skill-opportunity-discovery.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('internal Skill Evaluation Governance', () => {
  it('rejects a governance author that has the same model identity as the Candidate proposer', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-governance-identity-')))
    roots.push(root)
    const modelIdentity = boundedModelProviderIdentity('https://provider.example.test/v1/', 'shared-model')
    const policy = {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const gaps = opportunityGaps()
    const opportunity = internalOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const sealed = await vault.prepare(opportunity)
    if (sealed.status !== 'ready') throw new Error('expected sealed evaluation evidence')
    const candidate = experienceSkillCandidate({
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: createHash('sha256').update(modelIdentity).digest('hex'),
        evaluationEvidenceId: sealed.evidence.id,
        inputDigest: sealed.evidence.authoringInputDigest,
      },
    })
    const budget = { reserve: vi.fn() }
    const authorModel = vi.fn()
    const governance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget,
      authorModel,
      modelIdentity: () => modelIdentity,
    })

    await expect(governance.ensure(candidate))
      .rejects.toThrow('Candidate proposer cannot author its evaluation governance')
    expect(budget.reserve).not.toHaveBeenCalled()
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('forms one calibrated Envelope from protected sealed Goals without exposing the Candidate', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-governance-')))
    roots.push(root)
    const governanceRoot = join(root, 'governance')
    const runRoot = join(root, 'runs')
    const policy = {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot,
      runRoot,
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const gaps = opportunityGaps()
    const opportunity = internalOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const sealed = await vault.prepare(opportunity)
    if (sealed.status !== 'ready') throw new Error('expected sealed evaluation evidence')
    const candidate = experienceSkillCandidate({
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: '5'.repeat(64),
        evaluationEvidenceId: sealed.evidence.id,
        inputDigest: sealed.evidence.authoringInputDigest,
      },
    })
    const authorModel = vi.fn(async (input: SkillEvaluationCaseAuthorInput) => ({
      knownCorrectionSkill: correctionSkill(input.skillName, input.role),
      evaluatorSource: `process.stdout.write(${JSON.stringify(JSON.stringify({
        schemaVersion: 1,
        passed: true,
        checks: [],
        composition: { fingerprint: 'f'.repeat(64), modelCalls: 0, usage: {} },
      }))})\n`,
      searchEvidence: `Independent ${input.role} evidence.`,
      usage: { inputTokens: 20, outputTokens: 10 },
    }))
    const calibrate = vi.fn(async () => ({
      status: 'calibrated' as const,
      reportPath: join(runRoot, 'calibration-report.json'),
      summary: 'known-bad failed and known-correction passed',
    }))
    const governance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget: {
        reserve: vi.fn(async () => ({
          allowed: true,
          newlyReserved: true,
          snapshot: {
            targetId: policy.id,
            workspaceId: WORKSPACE_ID,
            skillName: candidate.skillName,
            utcDay: '2026-08-19',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        })),
      },
      authorModel,
      calibrate,
      modelIdentity: () => 'independent-governance/model-v1',
      now: () => 1_787_100_000_000,
    })
    const resolver = new SkillEvaluationEnvelopeResolver(
      [policy],
      { discover: () => [opportunity] },
      vault,
      governance,
    )

    const resolved = await resolver.resolve(candidate)

    expect(resolved).toMatchObject({
      workspaceId: WORKSPACE_ID,
      skillName: candidate.skillName,
      opportunityId: opportunity.id,
      evaluationEvidenceId: sealed.evidence.id,
      baselineKind: 'capability-absent',
    })
    expect(authorModel).toHaveBeenCalledTimes(2)
    expect(authorModel.mock.calls.map(([input]) => input.role).sort()).toEqual(['admission', 'holdout'])
    const governed = await vault.readForGovernance(WORKSPACE_ID, opportunity.id, sealed.evidence.id)
    const protectedGoalIds = governed.samples
      .filter(sample => sample.role !== 'authoring')
      .map(sample => sample.goalId)
      .sort()
    const authoredGoalIds = authorModel.mock.calls
      .flatMap(([input]) => input.goalEvidence.map((goal: { id: string }) => goal.id))
      .sort()
    expect(authoredGoalIds).toEqual(protectedGoalIds)
    for (const [input] of authorModel.mock.calls) {
      expect(input).not.toHaveProperty('candidate')
      expect(input).not.toHaveProperty('candidateId')
      expect(input).not.toHaveProperty('candidateFiles')
      expect(input.goalEvidence).toHaveLength(1)
    }
    expect(calibrate).toHaveBeenCalledTimes(2)
    const envelopeRoot = join(governanceRoot, 'envelopes', opportunity.id, sealed.evidence.id)
    expect((await readdir(join(envelopeRoot, 'baseline'))).sort()).toEqual(['subject.json'])
    const manifest = JSON.parse(await readFile(join(envelopeRoot, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      schemaVersion: 4,
      kind: 'internal-skill-evaluation-envelope-v4',
      evaluationEvidenceId: sealed.evidence.id,
      governance: {
        modelIdentityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        admissionInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        holdoutInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{
        workspaceId: WORKSPACE_ID,
        skillName: candidate.skillName,
        opportunityId: opportunity.id,
        evaluationEvidenceId: sealed.evidence.id,
        phase: 'ready',
        modelCalls: 2,
        inputTokens: 40,
        outputTokens: 20,
        retentionIncluded: false,
        releaseAuthority: 'none',
      }],
    })
  })

  it('authors an independent assembled retention Case Pack when a fifth Goal is sealed', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-retention-governance-')))
    roots.push(root)
    const policy = {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const gaps = opportunityGaps(5)
    const opportunity = internalOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const sealed = await vault.prepare(opportunity)
    if (sealed.status !== 'ready') throw new Error('expected sealed retention evidence')
    const candidate = experienceSkillCandidate({
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: '5'.repeat(64),
        evaluationEvidenceId: sealed.evidence.id,
        inputDigest: sealed.evidence.authoringInputDigest,
      },
    })
    const authorModel = vi.fn(async (input: SkillEvaluationCaseAuthorInput) => ({
      knownCorrectionSkill: correctionSkill(input.skillName, input.role),
      evaluatorSource: `process.stdout.write(${JSON.stringify(JSON.stringify({
        schemaVersion: 1,
        passed: true,
        checks: [],
        composition: { fingerprint: 'f'.repeat(64), modelCalls: 0, usage: {} },
      }))})\n`,
      searchEvidence: `Independent ${input.role} evidence.`,
      usage: { inputTokens: 20, outputTokens: 10 },
    }))
    const governance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget: {
        reserve: vi.fn(async () => ({
          allowed: true,
          newlyReserved: true,
          snapshot: {
            targetId: policy.id,
            workspaceId: WORKSPACE_ID,
            skillName: candidate.skillName,
            utcDay: '2026-08-19',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        })),
      },
      authorModel,
      calibrate: vi.fn(async () => ({
        status: 'calibrated' as const,
        reportPath: join(root, 'calibration-report.json'),
        summary: 'calibrated',
      })),
      modelIdentity: () => 'independent-governance/model-v1',
      now: () => 1_787_100_000_000,
    })
    const resolver = new SkillEvaluationEnvelopeResolver(
      [policy],
      { discover: () => [opportunity] },
      vault,
      governance,
    )

    const resolved = await resolver.resolve(candidate)

    expect(authorModel.mock.calls.map(([input]) => input.role)).toEqual([
      'admission',
      'holdout',
      'retention',
    ])
    for (const [input] of authorModel.mock.calls) {
      expect(input).not.toHaveProperty('candidate')
      expect(input.goalEvidence).toHaveLength(1)
    }
    expect(resolved).toMatchObject({
      retentionCasePackDir: join(
        policy.governanceRoot,
        'envelopes',
        opportunity.id,
        sealed.evidence.id,
        'retention',
      ),
      retentionCasePackHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      retentionRunRoot: join(policy.runRoot, 'retention'),
    })
    const manifest = JSON.parse(await readFile(join(
      policy.governanceRoot,
      'envelopes',
      opportunity.id,
      sealed.evidence.id,
      'manifest.json',
    ), 'utf8'))
    expect(manifest).toMatchObject({
      schemaVersion: 5,
      kind: 'internal-skill-evaluation-envelope-v5',
      governance: { retentionInputDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      retentionCasePackHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const retentionManifest = JSON.parse(await readFile(join(
      resolved!.retentionCasePackDir!,
      'manifest.json',
    ), 'utf8'))
    expect(retentionManifest.trial).toMatchObject({
      dshAssembled: true,
      capabilityAbsentBaseline: true,
    })
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{
        phase: 'ready',
        modelCalls: 3,
        inputTokens: 60,
        outputTokens: 30,
        retentionIncluded: true,
      }],
    })
  })

  it('marks a dispatched evaluator request uncertain on restart and never retries it blindly', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-governance-crash-')))
    roots.push(root)
    const policy = {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const gaps = opportunityGaps()
    const opportunity = internalOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const sealed = await vault.prepare(opportunity)
    if (sealed.status !== 'ready') throw new Error('expected sealed evaluation evidence')
    const candidate = experienceSkillCandidate({
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: '5'.repeat(64),
        evaluationEvidenceId: sealed.evidence.id,
        inputDigest: sealed.evidence.authoringInputDigest,
      },
    })
    const budget = {
      reserve: vi.fn(async () => ({
        allowed: true,
        newlyReserved: true,
        snapshot: {
          targetId: policy.id,
          workspaceId: WORKSPACE_ID,
          skillName: candidate.skillName,
          utcDay: '2026-08-19',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      })),
    }
    const firstAuthor = vi.fn(async () => {
      throw new Error('connection reset after evaluator request dispatch')
    })
    const firstGovernance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget,
      authorModel: firstAuthor,
      modelIdentity: () => 'independent-governance/model-v1',
      now: () => 1_787_100_000_000,
    })
    const firstResolver = new SkillEvaluationEnvelopeResolver(
      [policy],
      { discover: () => [opportunity] },
      vault,
      firstGovernance,
    )

    await expect(firstResolver.resolve(candidate)).rejects.toThrow('connection reset')
    expect(firstAuthor).toHaveBeenCalledOnce()
    await expect(firstGovernance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{
        skillName: candidate.skillName,
        phase: 'uncertain',
        modelCalls: 1,
        failure: 'paid-authoring-uncertain',
        releaseAuthority: 'none',
      }],
    })

    const retryAuthor = vi.fn(async () => ({
      knownCorrectionSkill: correctionSkill(candidate.skillName, 'admission'),
      evaluatorSource: 'process.stdout.write("{}")\n',
      searchEvidence: 'must not run',
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
    const restarted = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget,
      authorModel: retryAuthor,
      modelIdentity: () => 'independent-governance/model-v1',
      now: () => 1_787_100_001_000,
    })
    const restartedResolver = new SkillEvaluationEnvelopeResolver(
      [policy],
      { discover: () => [opportunity] },
      vault,
      restarted,
    )

    await expect(restartedResolver.resolve(candidate))
      .rejects.toThrow('outcome is uncertain; refusing automatic retry')
    expect(retryAuthor).not.toHaveBeenCalled()
    expect(budget.reserve).toHaveBeenCalledOnce()
    await expect(restarted.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{
        skillName: candidate.skillName,
        phase: 'uncertain',
        modelCalls: 1,
        failure: 'paid-authoring-uncertain',
        releaseAuthority: 'none',
      }],
    })
  })

  it('retains a denied governance budget as an explainable retry state', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-governance-budget-')))
    roots.push(root)
    const policy = {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const gaps = opportunityGaps()
    const opportunity = internalOpportunity(gaps)
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const sealed = await vault.prepare(opportunity)
    if (sealed.status !== 'ready') throw new Error('expected sealed evaluation evidence')
    const candidate = experienceSkillCandidate({
      opportunity: {
        kind: 'internal-experience-v1',
        id: opportunity.id,
        gapIds: [...opportunity.gapIds],
        goalCount: opportunity.goalCount,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: '5'.repeat(64),
        evaluationEvidenceId: sealed.evidence.id,
        inputDigest: sealed.evidence.authoringInputDigest,
      },
    })
    const retryAt = 1_787_186_400_000
    const authorModel = vi.fn()
    const governance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget: {
        reserve: vi.fn(async () => ({
          allowed: false,
          newlyReserved: false,
          retryAt,
          snapshot: {
            targetId: policy.id,
            workspaceId: WORKSPACE_ID,
            skillName: candidate.skillName,
            utcDay: '2026-08-19',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        })),
      },
      authorModel,
      modelIdentity: () => 'independent-governance/model-v1',
      now: () => 1_787_100_000_000,
    })

    await expect(governance.ensure(candidate)).resolves.toEqual({
      status: 'budget-deferred',
      evaluationEvidenceId: sealed.evidence.id,
      retryAt,
    })
    expect(authorModel).not.toHaveBeenCalled()
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{
        phase: 'budget-deferred',
        modelCalls: 0,
        retryAt,
        releaseAuthority: 'none',
      }],
    })
  })
})

function correctionSkill(name: string, role: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: Independent ${role} correction.`,
    '---',
    '',
    `Apply the independently derived ${role} method.`,
    '',
  ].join('\n')
}

function opportunityGaps(count = 4): CapabilityGap[] {
  return ['a', 'b', 'c', 'd', 'e'].slice(0, count).map((seed, index) => ({
    schemaVersion: 1,
    id: String(index + 3).repeat(64),
    observedAt: index + 1,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${seed}`,
    requestedSkill: 'release-proof',
    catalogHash: 'a'.repeat(64),
    catalogSize: 1,
    goal: { id: `goal-${seed}`, revision: 1, objective: `Prove release workflow ${seed}` },
    status: 'confirmed',
    evidence: {
      kind: 'native-skill-miss',
      catalog: 'complete',
      routing: 'requested-skill-absent',
      providers: 'settled',
    },
  }))
}

function internalOpportunity(gaps: readonly CapabilityGap[]): SkillOpportunity {
  return {
    schemaVersion: 3,
    id: '2'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    gapIds: gaps.map(gap => gap.id),
    goalIds: gaps.map(gap => gap.goal!.id),
    gapCount: gaps.length,
    goalCount: gaps.length,
    firstObservedAt: 1,
    lastObservedAt: gaps.length,
    evidence: {
      kind: 'internal-experience-v3',
      eligibilityBasis: 'two-or-more-distinct-goals',
      correctionSignals: {
        association: 'exact-durable-skill-invocation', count: 0, goalCount: 0, ids: [], referencesTruncated: false,
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
