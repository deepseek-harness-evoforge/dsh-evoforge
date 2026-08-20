import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobRegistry, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillCandidateAuthoring,
  type ExistingSkillAuthorInput,
} from '../src/existing-skill-candidate-authoring.ts'
import type { ExistingSkillHoldoutGovernanceSubject } from '../src/existing-skill-holdout-governance.ts'
import {
  existingSkillCandidateId,
  SkillCandidateRepository,
  type ExistingSkillCandidate,
  type ExistingSkillCandidateInput,
} from '../src/skill-candidate-repository.ts'
import { assembleSealedSkillBundleArchive } from '../src/skill-bundle-archive.ts'
import type { SkillImprovementOpportunity } from '../src/skill-opportunity-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('protected existing Skill Candidate authoring', () => {
  it('autonomously turns sealed internal corrections into one whole-tree quarantined Candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-author-'))
    temporaryRoots.push(root)
    const exactRoot = await realpath(root)
    const runRoot = join(exactRoot, 'authoring')
    await mkdir(runRoot, { mode: 0o700 })
    const opportunity = improvementOpportunity()
    const baselineBundle = await assembleSealedSkillBundleArchive([
      {
        path: 'SKILL.md',
        mode: '100644',
        content: Buffer.from('---\nname: release-proof\ndescription: Verify a release.\n---\n\nUse the guide.\n'),
      },
      {
        path: 'references/guide.md',
        mode: '100644',
        content: Buffer.from('# Guide\n\nCheck the release.\n'),
      },
      {
        path: 'assets/proof.png',
        mode: '100644',
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
      },
    ])
    const qualification = qualificationFor(opportunity, baselineBundle)
    const evidence = {
      id: 'a'.repeat(64),
      workspaceId: WORKSPACE_ID,
      opportunityId: opportunity.id,
      qualificationId: qualification.qualification.id,
      baselineId: qualification.baseline.manifest.id,
      skillName: opportunity.skillName,
      authoringCases: [
        {
          goal: { id: 'goal-1', revision: 1, objective: 'Ship a verified release.' },
          request: 'Prepare the release proof.',
          requestHasOmittedContent: false,
          correction: 'Require independent evidence.',
        },
        {
          goal: { id: 'goal-2', revision: 1, objective: 'Audit a verified release.' },
          request: 'Audit the release proof.',
          requestHasOmittedContent: false,
          correction: 'Do not let the author act as final reviewer.',
        },
      ],
      authoringGoalCount: 2,
      admissionGoalCount: 1,
      holdoutGoalCount: 1,
      retentionGoalCount: 0,
      authoringInputDigest: 'b'.repeat(64),
      proposerCanReadProtectedSamples: false as const,
      releaseAuthority: 'none' as const,
    }
    const stored: ExistingSkillCandidate[] = []
    const repository = new SkillCandidateRepository({
      recordCandidate: vi.fn(),
      recordExistingCandidate: async (input: ExistingSkillCandidateInput) => {
        const candidate = {
          schemaVersion: 1 as const,
          id: existingSkillCandidateId(input),
          ...input,
        }
        stored.push(candidate)
        return { created: true, candidate }
      },
    }, undefined, [{ workspaceId: WORKSPACE_ID, root: join(exactRoot, 'candidate-vault') }])
    const callOrder: string[] = []
    const holdoutGovernance = {
      ensure: vi.fn(async (_subject: ExistingSkillHoldoutGovernanceSubject) => {
        callOrder.push('holdout')
        return {
          status: 'ready' as const,
          envelope: {
            id: 'd'.repeat(64),
            workspaceId: WORKSPACE_ID,
            skillName: opportunity.skillName,
            opportunityId: opportunity.id,
            qualificationId: qualification.qualification.id,
            baselineId: qualification.baseline.manifest.id,
            evaluationEvidenceId: evidence.id,
            casePackDir: join(exactRoot, 'governance', 'holdout'),
            casePackHash: 'e'.repeat(64),
            dshRevision: 'f'.repeat(40),
            releaseAuthority: 'none' as const,
          },
        }
      }),
    }
    const authorModel = vi.fn(async (_input: ExistingSkillAuthorInput) => {
      callOrder.push('candidate')
      return {
        claim: 'Require independent evidence without changing bundled resources.',
        changes: [{
          path: 'SKILL.md',
          content: [
            '---',
            'name: release-proof',
            'description: Verify a release with independent evidence.',
            '---',
            '',
            'Use the guide and require an independent reviewer.',
            '',
          ].join('\n'),
        }],
        usage: { inputTokens: 300, outputTokens: 80 },
      }
    })
    const jobs = fakeJobs()
    const authoring = new ExistingSkillCandidateAuthoring({
      policies: [{
        id: 'workspace-self-discovery',
        workspaceId: WORKSPACE_ID,
        runRoot,
        maxAttemptsPerUtcDay: 1,
      }],
      opportunities: { discoverImprovements: () => [opportunity] },
      qualification: { qualify: async () => qualification },
      evaluationEvidence: { prepare: async () => ({ status: 'ready', evidence }) },
      holdoutGovernance,
      candidates: {
        listExistingCandidates: () => stored,
        quarantineExisting: input => repository.quarantineExisting(input),
      },
      budget: { reserve: async target => allowedReservation(target) },
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
      now: () => 1_787_100_000_000,
    })
    authoring.attachJobs(jobs.registry)

    await expect(authoring.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'candidate-ready',
      output: expect.stringMatching(/^quarantined: [a-f0-9]{64}$/),
    })

    expect(authorModel).toHaveBeenCalledOnce()
    expect(callOrder).toEqual(['holdout', 'candidate'])
    expect(holdoutGovernance.ensure).toHaveBeenCalledOnce()
    expect(holdoutGovernance.ensure.mock.calls[0]![0]).toMatchObject({
      opportunity,
      qualification: qualification.qualification,
      baseline: qualification.baseline,
      evidence,
      proposerModelIdentityHash: createHash('sha256')
        .update('provider/model@contract-v1')
        .digest('hex'),
    })
    const input = authorModel.mock.calls[0]![0]
    expect(input).toMatchObject({
      targetId: 'workspace-self-discovery',
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      opportunityId: opportunity.id,
      qualificationId: qualification.qualification.id,
      evaluationEvidenceId: evidence.id,
      baseline: {
        id: qualification.baseline.manifest.id,
        treeHash: baselineBundle.treeHash,
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'SKILL.md', representation: 'utf8', content: expect.stringContaining('Verify a release.') }),
          expect.objectContaining({ path: 'assets/proof.png', representation: 'binary', size: 6 }),
        ]),
      },
      authoringCases: evidence.authoringCases,
      signal: expect.any(AbortSignal),
    })
    expect(JSON.stringify(input)).not.toMatch(/admission|holdout|retention|sessionId|messageId/u)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      skillName: 'release-proof',
      baseline: { id: qualification.baseline.manifest.id },
      diff: { changedPaths: ['SKILL.md'], preservedFileCount: 2, preservedBinaryFileCount: 1 },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
      releaseAuthority: 'none',
    })
    await expect(authoring.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{
        targetId: 'workspace-self-discovery',
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        opportunityId: opportunity.id,
        qualificationId: qualification.qualification.id,
        evaluationEvidenceId: evidence.id,
        baselineId: qualification.baseline.manifest.id,
        phase: 'candidate-ready',
        modelCalls: 1,
        inputTokens: 300,
        outputTokens: 80,
        candidateId: stored[0]!.id,
        releaseAuthority: 'none',
      }],
    })
  })

  it('persists an unobserved paid dispatch and refuses a blind retry after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-author-restart-'))
    temporaryRoots.push(root)
    const runRoot = join(await realpath(root), 'authoring')
    await mkdir(runRoot, { mode: 0o700 })
    const opportunity = improvementOpportunity()
    const bundle = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from('---\nname: release-proof\ndescription: Verify a release.\n---\n\nCheck it.\n'),
    }])
    const qualification = qualificationFor(opportunity, bundle)
    const evidence = authoringEvidence(opportunity, qualification)
    const build = (authorModel: (input: ExistingSkillAuthorInput) => Promise<never>) =>
      new ExistingSkillCandidateAuthoring({
        policies: [{
          id: 'workspace-self-discovery',
          workspaceId: WORKSPACE_ID,
          runRoot,
          maxAttemptsPerUtcDay: 1,
        }],
        opportunities: { discoverImprovements: () => [opportunity] },
        qualification: { qualify: async () => qualification },
        evaluationEvidence: { prepare: async () => ({ status: 'ready', evidence }) },
        holdoutGovernance: {
          ensure: vi.fn(async () => ({
            status: 'ready' as const,
            envelope: {
              id: 'd'.repeat(64),
              workspaceId: WORKSPACE_ID,
              skillName: opportunity.skillName,
              opportunityId: opportunity.id,
              qualificationId: qualification.qualification.id,
              baselineId: qualification.baseline.manifest.id,
              evaluationEvidenceId: evidence.id,
              casePackDir: join(runRoot, 'holdout'),
              casePackHash: 'e'.repeat(64),
              dshRevision: 'f'.repeat(40),
              releaseAuthority: 'none' as const,
            },
          })),
        },
        candidates: { listExistingCandidates: () => [], quarantineExisting: vi.fn() },
        budget: { reserve: async target => allowedReservation(target) },
        authorModel,
        modelIdentity: () => 'provider/model@contract-v1',
        now: () => 1_787_100_000_000,
      })

    const firstJobs = fakeJobs()
    const firstModel = vi.fn(async () => { throw new Error('connection reset before response') })
    const first = build(firstModel)
    first.attachJobs(firstJobs.registry)
    await expect(first.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await expect(firstJobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('uncertain'),
    })

    const retryJobs = fakeJobs()
    const retryModel = vi.fn(async () => { throw new Error('must not run') })
    const restarted = build(retryModel)
    restarted.attachJobs(retryJobs.registry)
    await expect(restarted.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(retryJobs.hooks).toHaveLength(0)
    expect(retryModel).not.toHaveBeenCalled()
    await expect(restarted.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{ phase: 'uncertain', modelCalls: 1, releaseAuthority: 'none' }],
    })
  })

  it('does not reserve proposer budget when independent holdout governance is deferred', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-holdout-deferred-')))
    temporaryRoots.push(root)
    const runRoot = join(root, 'authoring')
    await mkdir(runRoot, { mode: 0o700 })
    const opportunity = improvementOpportunity()
    const bundle = await assembleSealedSkillBundleArchive([{
      path: 'SKILL.md',
      mode: '100644',
      content: Buffer.from('---\nname: release-proof\ndescription: Verify a release.\n---\n\nCheck it.\n'),
    }])
    const qualification = qualificationFor(opportunity, bundle)
    const evidence = authoringEvidence(opportunity, qualification)
    const retryAt = 1_787_356_800_000
    const proposerBudget = { reserve: vi.fn() }
    const authorModel = vi.fn()
    const jobs = fakeJobs()
    const authoring = new ExistingSkillCandidateAuthoring({
      policies: [{
        id: 'workspace-self-discovery',
        workspaceId: WORKSPACE_ID,
        runRoot,
        maxAttemptsPerUtcDay: 1,
      }],
      opportunities: { discoverImprovements: () => [opportunity] },
      qualification: { qualify: async () => qualification },
      evaluationEvidence: { prepare: async () => ({ status: 'ready', evidence }) },
      holdoutGovernance: {
        ensure: vi.fn(async () => ({
          status: 'budget-deferred' as const,
          retryAt,
          releaseAuthority: 'none' as const,
        })),
      },
      candidates: { listExistingCandidates: () => [], quarantineExisting: vi.fn() },
      budget: proposerBudget,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
      now: () => 1_787_100_000_000,
    })
    authoring.attachJobs(jobs.registry)

    await expect(authoring.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'holdout-deferred',
    })
    expect(proposerBudget.reserve).not.toHaveBeenCalled()
    expect(authorModel).not.toHaveBeenCalled()
    await expect(authoring.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{ phase: 'holdout-deferred', modelCalls: 0, retryAt }],
    })
  })
})

function improvementOpportunity(): SkillImprovementOpportunity {
  return {
    schemaVersion: 1,
    id: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    invocationContentHash: '2'.repeat(64),
    feedbackSignalIds: ['3'.repeat(64), '4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
    goalIds: ['goal-1', 'goal-2', 'goal-3', 'goal-4'],
    signalCount: 4,
    goalCount: 4,
    firstObservedAt: 1,
    lastObservedAt: 4,
    evidence: {
      kind: 'internal-exact-skill-corrections-v1',
      association: 'exact-durable-skill-invocation-content',
      eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content',
      referencesTruncated: false,
      causalClaim: 'none',
    },
    status: 'waiting-for-baseline-bundle',
    releaseAuthority: 'none',
  }
}

function qualificationFor(
  opportunity: SkillImprovementOpportunity,
  bundle: Awaited<ReturnType<typeof assembleSealedSkillBundleArchive>>,
) {
  const manifest = {
    schemaVersion: 1 as const,
    kind: 'installed-skill-baseline-v1' as const,
    id: '8'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: opportunity.skillName,
    invocationContentHash: opportunity.invocationContentHash,
    provider: 'native-test-provider',
    source: '/sealed/provider/release-proof/SKILL.md',
    definitionDigest: '9'.repeat(64),
    createdAt: 1,
    bundle: {
      format: 'tar.gz' as const,
      artifactDigest: bundle.artifactDigest,
      treeHash: bundle.treeHash,
      fileCount: bundle.files.length,
      totalBytes: bundle.totalBytes,
      hasExecutableFiles: false as const,
    },
    releaseAuthority: 'none' as const,
  }
  return {
    status: 'qualified' as const,
    qualification: {
      schemaVersion: 1 as const,
      kind: 'existing-skill-baseline-qualification-v1' as const,
      id: '7'.repeat(64),
      opportunityId: opportunity.id,
      workspaceId: WORKSPACE_ID,
      skillName: opportunity.skillName,
      invocationContentHash: opportunity.invocationContentHash,
      baseline: {
        id: manifest.id,
        provider: manifest.provider,
        source: manifest.source,
        definitionDigest: manifest.definitionDigest,
        artifactDigest: bundle.artifactDigest,
        treeHash: bundle.treeHash,
        fileCount: bundle.files.length,
        totalBytes: bundle.totalBytes,
      },
      evidence: {
        kind: 'exact-correction-invocation-baselines-v1' as const,
        feedbackSignalIds: opportunity.feedbackSignalIds,
        goalIds: opportunity.goalIds,
        invocationCount: opportunity.signalCount,
        goalCount: opportunity.goalCount,
      },
      status: 'eligible-for-existing-skill-authoring' as const,
      releaseAuthority: 'none' as const,
    },
    baseline: {
      reference: {
        schemaVersion: 1 as const,
        kind: 'installed-skill-invocation-baseline-v1' as const,
        workspaceId: WORKSPACE_ID,
        sessionId: 'session-1',
        invocationSeq: 2,
        route: 'model-tool' as const,
        skillName: opportunity.skillName,
        invocationContentHash: opportunity.invocationContentHash,
        baselineId: manifest.id,
      },
      manifest,
      files: bundle.files,
    },
  }
}

function authoringEvidence(
  opportunity: SkillImprovementOpportunity,
  qualification: ReturnType<typeof qualificationFor>,
) {
  return {
    id: 'a'.repeat(64),
    workspaceId: WORKSPACE_ID,
    opportunityId: opportunity.id,
    qualificationId: qualification.qualification.id,
    baselineId: qualification.baseline.manifest.id,
    skillName: opportunity.skillName,
    authoringCases: [
      {
        goal: { id: 'goal-1', revision: 1, objective: 'Ship a verified release.' },
        request: 'Prepare the release proof.',
        requestHasOmittedContent: false,
        correction: 'Require independent evidence.',
      },
      {
        goal: { id: 'goal-2', revision: 1, objective: 'Audit a verified release.' },
        request: 'Audit the release proof.',
        requestHasOmittedContent: false,
        correction: 'Do not let the author act as final reviewer.',
      },
    ],
    authoringGoalCount: 2,
    admissionGoalCount: 1,
    holdoutGoalCount: 1,
    retentionGoalCount: 0,
    authoringInputDigest: 'b'.repeat(64),
    proposerCanReadProtectedSamples: false as const,
    releaseAuthority: 'none' as const,
  }
}

function fakeJobs(): {
  registry: Pick<JobRegistry, 'start'>
  hooks: JobHooks[]
} {
  const hooks: JobHooks[] = []
  return {
    hooks,
    registry: {
      start(input: JobStart) {
        hooks.push(input.run())
        return `job-${hooks.length}`
      },
    } as never,
  }
}

function allowedReservation(target: {
  id: string
  workspaceId: string
  skill: string
  maxAttemptsPerUtcDay: number
}) {
  return {
    allowed: true,
    newlyReserved: true,
    snapshot: {
      targetId: target.id,
      workspaceId: target.workspaceId,
      skillName: target.skill,
      utcDay: '2026-08-21',
      used: 1,
      limit: target.maxAttemptsPerUtcDay,
      remaining: target.maxAttemptsPerUtcDay - 1,
    },
  }
}
