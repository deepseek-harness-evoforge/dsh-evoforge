import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashTree } from '../src/hash.ts'
import { SkillCandidateAdmission } from '../src/skill-candidate-admission.ts'
import { SkillCandidateShadowLauncher } from '../src/skill-candidate-shadow.ts'
import { SkillEvaluationEnvelopeResolver } from '../src/skill-evaluation-envelope.ts'
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
  it('hands one governance-owned Envelope from admission to assembled holdout without a configured Skill', async () => {
    const fixture = await flowFixture()
    const candidate = await candidateFixture()
    const opportunity = internalOpportunity()
    const envelopes = new SkillEvaluationEnvelopeResolver(
      [{
        id: 'workspace-governance',
        workspaceId: WORKSPACE_ID,
        governanceRoot: fixture.governanceRoot,
        runRoot: fixture.runRoot,
      }],
      { discover: () => [opportunity] },
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
          kind: 'internal-skill-candidate-lineage-v2',
          opportunityId: opportunity.id,
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
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-flow-')))
  roots.push(root)
  const governanceRoot = join(root, 'governance')
  const runRoot = join(root, 'runs')
  const envelopeRoot = join(governanceRoot, 'envelopes', '2'.repeat(64))
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
    schemaVersion: 2,
    kind: 'internal-skill-evaluation-envelope-v2',
    workspaceId: WORKSPACE_ID,
    opportunity: {
      id: '2'.repeat(64),
      skillName: 'release-proof',
      gapIds: ['3'.repeat(64), '4'.repeat(64)],
      goalCount: 2,
    },
    baseline: {
      kind: 'capability-absent',
      descriptorTreeHash: await hashTree(baselineDir),
    },
    admissionCasePackHash: await hashTree(admissionDir),
    holdoutCasePackHash: await hashTree(holdoutDir),
  }, null, 2)}\n`)
  return { governanceRoot, runRoot, baselineDir, holdoutDir }
}

async function writeCasePack(path: string, id: string, assembled: boolean): Promise<void> {
  await writeFile(join(path, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id,
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'a'.repeat(40), evaluatorVersion: `${id}-v1` },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 1, outputTokenLimit: 1 },
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

async function candidateFixture(): Promise<ExperienceSkillCandidate> {
  const source = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluation-candidate-')))
  roots.push(source)
  await writeFile(join(source, 'SKILL.md'), CANDIDATE_SKILL)
  return experienceSkillCandidate({
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
