import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { hashTree } from '../src/hash.ts'
import { SkillCandidateAdmission } from '../src/skill-candidate-admission.ts'
import { SkillCandidateShadowLauncher } from '../src/skill-candidate-shadow.ts'
import { SkillEvaluationEnvelopeResolver } from '../src/skill-evaluation-envelope.ts'
import {
  SkillEvaluationEvidenceVault,
  skillEvaluationProtectedInputDigest,
} from '../src/skill-evaluation-evidence-vault.ts'
import {
  SkillEvaluationGovernance,
  type SkillEvaluationCaseAuthorInput,
} from '../src/skill-evaluation-governance.ts'
import type {
  ExperienceSkillCandidate,
  MaterializedSkillCandidate,
} from '../src/skill-candidate-repository.ts'
import type { SkillOpportunity } from '../src/skill-opportunity-discovery.ts'
import type { PairedTrialResult } from '../src/trial.ts'
import { experienceSkillCandidate } from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []
const CANDIDATE_SKILL = [
  '---',
  'name: release-proof',
  'description: Reusable proof learned from internal DSH Goals.',
  '---',
  '',
  'Require a clean install and durable evidence.',
  '',
].join('\n')

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Opportunity-bound internal Candidate evaluation flow', () => {
  it('qualifies governance-authored deterministic admission before assembled holdout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-governed-evaluation-flow-')))
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
    const opportunity = internalOpportunity()
    const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
    const prepared = await vault.prepare(opportunity)
    if (prepared.status !== 'ready') throw new Error('expected evaluation evidence')
    const candidate = await candidateFixture(
      prepared.evidence.id,
      prepared.evidence.authoringInputDigest,
      gaps,
    )
    const governance = new SkillEvaluationGovernance({
      policies: [policy],
      evidence: vault,
      budget: {
        reserve: async () => ({
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
        }),
      },
      authorModel: async (input: SkillEvaluationCaseAuthorInput) => ({
        knownCorrectionSkill: [
          '---',
          `name: ${input.skillName}`,
          `description: Independent ${input.role} correction.`,
          '---',
          '',
          'Require a clean install and durable evidence.',
          '',
        ].join('\n'),
        evaluatorSource: 'process.stdout.write("not used by the injected sealed executor")\n',
        evidenceRationale: `Protected ${input.role} DSH Goal evidence.`,
        usage: { inputTokens: 20, outputTokens: 10 },
      }),
      calibrate: async () => ({
        status: 'calibrated',
        reportPath: join(root, 'calibration-report.json'),
        summary: 'known-bad failed and known-correction passed',
      }),
      modelIdentity: () => 'independent-governance/model-v1',
    })
    const envelopes = new SkillEvaluationEnvelopeResolver(
      [policy],
      { discover: () => [opportunity] },
      vault,
      governance,
    )
    const runTrial = vi.fn(async (options): Promise<PairedTrialResult> => ({
      backend: 'darwin-seatbelt',
      count: 4,
      assembled: false,
      calibration: [
        { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
        { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
      ],
      baseline: { passed: false, checks: [], treeHash: await hashTree(options.skillDir) },
      candidate: { passed: true, checks: [], treeHash: candidate.version.treeHash },
    }))
    const admission = new SkillCandidateAdmission(
      envelopes,
      { materialize: materializer(candidate) },
      { runTrial },
    )

    const admitted = await admission.evaluate(candidate)

    expect(admitted).toMatchObject({
      status: 'qualified-for-shadow',
      reasons: ['candidate-improves-deterministic-admission'],
    })
    expect(runTrial).toHaveBeenCalledOnce()
    const envelope = await envelopes.resolve(candidate)
    if (envelope === undefined) throw new Error('expected evaluation Envelope')
    const admissionManifest = JSON.parse(await readFile(
      join(envelope.admissionCasePackDir, 'manifest.json'),
      'utf8',
    ))
    const holdoutManifest = JSON.parse(await readFile(
      join(envelope.holdoutCasePackDir, 'manifest.json'),
      'utf8',
    ))
    expect(admissionManifest.trial.dshAssembled).toBe(false)
    expect(holdoutManifest.trial.dshAssembled).toBe(true)
  })

  it('hands one governance-owned Envelope from admission to assembled holdout without a configured Skill', async () => {
    const fixture = await flowFixture()
    const candidate = fixture.candidate
    const opportunity = fixture.opportunity
    const envelopes = new SkillEvaluationEnvelopeResolver(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: fixture.governanceRoot,
        runRoot: fixture.runRoot,
      }],
      { discover: () => [opportunity] },
      fixture.vault,
    )
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => ({
      backend: 'darwin-seatbelt',
      count: 4,
      assembled: false,
      calibration: [
        { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
        { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
      ],
      baseline: { passed: false, checks: [], treeHash: await hashTree(fixture.baselineDir) },
      candidate: { passed: true, checks: [], treeHash: candidate.version.treeHash },
    }))
    const admission = new SkillCandidateAdmission(
      envelopes,
      { materialize: materializer(candidate) },
      { runTrial },
    )

    const admitted = await admission.evaluate(candidate)

    expect(admitted).toMatchObject({
      status: 'qualified-for-shadow',
      envelopeId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      releaseAuthority: 'none',
    })
    expect(runTrial).toHaveBeenCalledWith(expect.objectContaining({
      baselineKind: 'capability-absent',
      baselineSkillName: candidate.skillName,
      skillDir: fixture.baselineDir,
    }))
    const runShadow = vi.fn(async () => ({
      status: 'complete' as const,
      reportPath: join(fixture.runRoot, 'shadow-report.json'),
      summary: 'assembled holdout complete',
    }))
    const launcher = new SkillCandidateShadowLauncher(admission, { runShadow })

    await expect(launcher.launch(candidate, admitted)).resolves.toMatchObject({ status: 'complete' })
    expect(runShadow).toHaveBeenCalledWith(expect.objectContaining({
      casePackDir: fixture.holdoutDir,
      expectedCasePackHash: await hashTree(fixture.holdoutDir),
      exactCandidate: expect.objectContaining({
        lineage: expect.objectContaining({
          kind: 'internal-skill-candidate-lineage-v3',
          opportunityId: opportunity.id,
          evaluationEvidenceId: candidate.authorship.evaluationEvidenceId,
          evaluationEnvelopeId: admitted.envelopeId,
          releaseAuthority: 'none',
        }),
      }),
      skillDir: fixture.baselineDir,
      baselineKind: 'capability-absent',
      baselineSkillName: candidate.skillName,
    }))
    expect(Object.keys(envelopes.policyViews()[0]!)).toEqual([
      'id',
      'workspaceId',
      'admissionRunRoot',
    ])
  })
})

async function flowFixture(): Promise<{
  readonly governanceRoot: string
  readonly runRoot: string
  readonly baselineDir: string
  readonly holdoutDir: string
  readonly vault: SkillEvaluationEvidenceVault
  readonly opportunity: SkillOpportunity
  readonly candidate: ExperienceSkillCandidate
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-flow-')))
  roots.push(root)
  const governanceRoot = join(root, 'governance')
  const runRoot = join(root, 'runs')
  const policy = {
    id: 'workspace-governance',
    workspaceId: WORKSPACE_ID,
    governanceRoot,
    runRoot,
  }
  const gaps = opportunityGaps()
  const opportunity = internalOpportunity()
  const vault = new SkillEvaluationEvidenceVault([policy], { list: () => gaps })
  const prepared = await vault.prepare(opportunity)
  if (prepared.status !== 'ready') throw new Error('expected evaluation evidence')
  const governed = await vault.readForGovernance(
    WORKSPACE_ID,
    opportunity.id,
    prepared.evidence.id,
  )
  const candidate = await candidateFixture(
    prepared.evidence.id,
    prepared.evidence.authoringInputDigest,
    gaps,
  )
  const envelopeRoot = join(
    governanceRoot,
    'envelopes',
    '2'.repeat(64),
    prepared.evidence.id,
  )
  const baselineDir = join(envelopeRoot, 'baseline')
  const admissionDir = join(envelopeRoot, 'admission')
  const holdoutDir = join(envelopeRoot, 'holdout')
  await Promise.all([baselineDir, admissionDir, holdoutDir, runRoot]
    .map(path => mkdir(path, { recursive: true })))
  await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'internal-capability-absent-subject-v1',
    workspaceId: WORKSPACE_ID,
    opportunityId: '2'.repeat(64),
    skillName: 'release-proof',
  }, null, 2)}\n`)
  await writeCasePack(admissionDir, 'internal-admission', false)
  await writeCasePack(holdoutDir, 'internal-holdout', true)
  await writeFile(join(envelopeRoot, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 4,
    kind: 'internal-skill-evaluation-envelope-v4',
    workspaceId: WORKSPACE_ID,
    evaluationEvidenceId: prepared.evidence.id,
    opportunity: {
      id: '2'.repeat(64),
      skillName: 'release-proof',
      gapIds: gaps.map(gap => gap.id),
      goalCount: 4,
    },
    baseline: {
      kind: 'capability-absent',
      descriptorTreeHash: await hashTree(baselineDir),
    },
    governance: {
      modelIdentityHash: '6'.repeat(64),
      admissionInputDigest: skillEvaluationProtectedInputDigest(governed, 'admission'),
      holdoutInputDigest: skillEvaluationProtectedInputDigest(governed, 'holdout'),
    },
    admissionCasePackHash: await hashTree(admissionDir),
    holdoutCasePackHash: await hashTree(holdoutDir),
  }, null, 2)}\n`)
  return { governanceRoot, runRoot, baselineDir, holdoutDir, vault, opportunity, candidate }
}

async function writeCasePack(path: string, id: string, assembled: boolean): Promise<void> {
  await mkdir(join(path, 'evidence'), { recursive: true })
  await writeFile(join(path, 'evidence', 'rationale.md'), 'Internal test rationale.\n')
  await writeFile(join(path, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id,
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: `${id}-v1` },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
    evidence: { rationale: 'evidence/rationale.md' },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: assembled,
      capabilityAbsentBaseline: true,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
}

async function candidateFixture(
  evaluationEvidenceId: string,
  inputDigest: string,
  gaps: readonly CapabilityGap[],
): Promise<ExperienceSkillCandidate> {
  const source = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-candidate-')))
  roots.push(source)
  await writeFile(join(source, 'SKILL.md'), CANDIDATE_SKILL)
  return experienceSkillCandidate({
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
      evaluationEvidenceId,
      inputDigest,
    },
    version: {
      kind: 'experience-authored-bundle-v1',
      artifactDigest: '7'.repeat(64),
      treeHash: await hashTree(source),
    },
    package: {
      path: 'release-proof',
      fileCount: 1,
      totalBytes: Buffer.byteLength(CANDIDATE_SKILL),
      hasScripts: false,
      hasReferences: true,
    },
  })
}

function materializer(candidate: ExperienceSkillCandidate) {
  return async (
    _candidate: ExperienceSkillCandidate,
    path: string,
  ): Promise<MaterializedSkillCandidate> => {
    await mkdir(path)
    await writeFile(join(path, 'SKILL.md'), CANDIDATE_SKILL)
    return {
      candidateId: candidate.id,
      path,
      contentHash: candidate.contentHash,
      treeHash: candidate.version.treeHash,
      files: [{ path: 'SKILL.md', mode: '100644', size: Buffer.byteLength(CANDIDATE_SKILL) }],
    }
  }
}

function internalOpportunity(): SkillOpportunity {
  return {
    schemaVersion: 3,
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
