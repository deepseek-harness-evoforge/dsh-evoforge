import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomaticEvolutionBudgetTarget } from '../src/automatic-evolution-budget.ts'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { SkillEvaluationEvidenceVault } from '../src/skill-evaluation-evidence-vault.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../src/skill-opportunity-discovery.ts'
import {
  assertSlowLoopSkillAuthoringRootSeparation,
  SlowLoopSkillAuthoring,
} from '../src/slow-loop-skill-authoring.ts'
import type {
  SkillOpportunityAuthoringPolicyConfig,
  SlowLoopSkillAuthorInput,
} from '../src/slow-loop-skill-authoring.ts'
import type {
  SkillCandidateProposal,
  ExperienceSkillCandidate,
} from '../src/skill-candidate-repository.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('experience-driven slow-loop Skill authoring', () => {
  it('derives the Skill from internal Goal experience and authors without external research', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = [
      gap('1', 'goal-a', 10),
      gap('2', 'goal-b', 20),
      gap('3', 'goal-c', 30),
      gap('4', 'goal-d', 40),
    ]
    const effects: string[] = []
    const quarantine = vi.fn(async (input: SkillCandidateProposal) => {
      effects.push('quarantine')
      return { created: true, candidate: generatedCandidate(input) }
    })
    const authorModel = vi.fn(async (_input: SlowLoopSkillAuthorInput) => {
      effects.push('author')
      return {
        files: skillFiles('missing-release-skill'),
        usage: { inputTokens: 321, outputTokens: 123 },
      }
    })
    const service = new SlowLoopSkillAuthoring({
      policies: [fixture.policy],
      opportunities: new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps }),
      candidates: {
        listCandidates: () => [],
        quarantine,
      },
      budget: {
        reserve: vi.fn(async target => {
          effects.push('budget')
          return allowedReservation(target)
        }),
      },
      evaluationEvidence: new SkillEvaluationEvidenceVault(
        [fixture.evaluationPolicy],
        { list: () => gaps },
      ),
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
      now: () => 1_787_000_000_000,
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'slow-loop Skill authoring: missing-release-skill',
    })
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'candidate-ready',
    })

    expect(effects).toEqual(['budget', 'author', 'quarantine'])
    expect(authorModel).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'workspace-self-discovery',
      workspaceId: WORKSPACE_ID,
      skillName: 'missing-release-skill',
      evaluationEvidenceId: expect.stringMatching(/^[a-f0-9]{64}$/),
      goalEvidence: expect.arrayContaining([
        expect.objectContaining({ objective: expect.stringContaining('needs missing-release-skill') }),
      ]),
      signal: expect.any(AbortSignal),
    }))
    expect(authorModel.mock.calls[0]![0].goalEvidence).toHaveLength(2)
    expect(authorModel.mock.calls[0]![0]).not.toHaveProperty('research')
    const authored = quarantine.mock.calls[0]![0]
    expect(authored).toMatchObject({
      workspaceId: WORKSPACE_ID,
      skillName: 'missing-release-skill',
      policyId: 'workspace-self-discovery',
      opportunityId: expect.stringMatching(/^[a-f0-9]{64}$/),
      gapIds: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)],
      goalCount: 4,
      modelIdentity: 'provider/model@contract-v1',
      inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      files: expect.arrayContaining([...skillFiles('missing-release-skill')]),
    })
    expect(authored).not.toHaveProperty('researchDigest')

    const scan = await service.scan()
    expect(scan).toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{
        skillName: 'missing-release-skill',
        phase: 'candidate-ready',
        modelCalls: 1,
        inputTokens: 321,
        outputTokens: 123,
        candidateId: '9'.repeat(64),
        releaseAuthority: 'none',
      }],
    })
    expect(scan.runs[0]).not.toHaveProperty('researchDigest')
    const state = JSON.parse(await readFile(join(
      fixture.policy.runRoot,
      'skills',
      'missing-release-skill',
      'runs',
      scan.runs[0]!.id,
      'state.json',
    ), 'utf8'))
    expect(state.identity).toMatchObject({
      policyVersion: 'internal-experience-whole-skill-author-v2',
      skillName: 'missing-release-skill',
      evaluationEvidenceId: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('keeps a two-Goal Opportunity but waits for independent admission and holdout evidence', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = [gap('1', 'same-goal', 10), gap('2', 'same-goal', 20)]
    const authorModel = vi.fn(async () => ({
      files: skillFiles('missing-release-skill'),
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
    const service = serviceFor(fixture.policy, gaps, jobs, { authorModel })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    gaps[1] = gap('2', 'other-goal', 20)
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    gaps.push(gap('3', 'third-goal', 30), gap('4', 'fourth-goal', 40))
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await jobs.hooks[0]!.done
    expect(authorModel).toHaveBeenCalledOnce()
  })

  it('suppresses an opportunity when that internally Skill Candidate already has a candidate', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = fourGaps()
    const authorModel = vi.fn()
    const service = serviceFor(fixture.policy, gaps, jobs, {
      candidates: [existingCandidate(gaps)],
      authorModel,
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(jobs.starts).toHaveLength(0)
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('fails closed when daily budget is exhausted and never reaches the author model', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = fourGaps()
    const authorModel = vi.fn()
    const service = serviceFor(fixture.policy, gaps, jobs, {
      authorModel,
      reserve: async target => ({
        allowed: false,
        newlyReserved: false,
        retryAt: 1_787_097_600_000,
        snapshot: {
          targetId: target.id,
          workspaceId: target.workspaceId,
          skillName: target.skill,
          utcDay: '2026-08-18',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      }),
    })
    service.attachJobs(jobs.registry)

    await service.reconcile()
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'budget-deferred',
    })
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('marks an unobserved paid-call outcome uncertain and refuses blind restart retry', async () => {
    const fixture = await setup()
    const gaps = fourGaps()
    const firstJobs = fakeJobs()
    const firstAuthor = vi.fn(async () => { throw new Error('connection reset before response') })
    const first = serviceFor(fixture.policy, gaps, firstJobs, { authorModel: firstAuthor })
    first.attachJobs(firstJobs.registry)
    await first.reconcile()
    await expect(firstJobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('uncertain'),
    })

    const restartJobs = fakeJobs()
    const retryAuthor = vi.fn()
    const restarted = serviceFor(fixture.policy, gaps, restartJobs, { authorModel: retryAuthor })
    restarted.attachJobs(restartJobs.registry)
    await expect(restarted.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(restartJobs.starts).toHaveLength(0)
    expect(retryAuthor).not.toHaveBeenCalled()
  })

  it('does not quarantine a provider response that arrives after native Job cancellation', async () => {
    const fixture = await setup()
    const gaps = fourGaps()
    const jobs = fakeJobs()
    let resolveAuthor!: (value: {
      files: ReturnType<typeof skillFiles>
      usage: { inputTokens: number; outputTokens: number }
    }) => void
    const authorModel = vi.fn(() => new Promise<{
      files: ReturnType<typeof skillFiles>
      usage: { inputTokens: number; outputTokens: number }
    }>(resolve => { resolveAuthor = resolve }))
    const quarantine = vi.fn()
    const service = serviceFor(fixture.policy, gaps, jobs, {
      authorModel,
      quarantine,
    })
    service.attachJobs(jobs.registry)
    await service.reconcile()
    await vi.waitFor(() => expect(authorModel).toHaveBeenCalledOnce())

    jobs.hooks[0]!.cancel?.('operator cancelled in flight')
    resolveAuthor({ files: skillFiles('missing-release-skill'), usage: { inputTokens: 10, outputTokens: 5 } })

    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({ status: 'killed' })
    expect(quarantine).not.toHaveBeenCalled()
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'uncertain', modelCalls: 1, releaseAuthority: 'none' }],
    })
  })

  it('bounds complete opportunity evidence before the author request', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const reserve = vi.fn(async target => allowedReservation(target))
    const gaps = Array.from({ length: 900 }, (_, index) => ({
      ...gap('1', `goal-${index}`, index),
      id: (index + 1).toString(16).padStart(64, '0'),
    }))
    const service = serviceFor(fixture.policy, gaps, jobs, { reserve })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await jobs.hooks[0]!.done
    expect(reserve).toHaveBeenCalledOnce()
    expect(jobs.starts).toHaveLength(1)
  })

  it('accepts only one path-isolated policy per Workspace and never asks for a Skill name', () => {
    const build = (policies: SkillOpportunityAuthoringPolicyConfig[]) => () => new SlowLoopSkillAuthoring({
      policies,
      opportunities: { discover: () => [] },
      evaluationEvidence: new SkillEvaluationEvidenceVault([], { list: () => [] }),
      candidates: {
        listCandidates: () => [],
        quarantine: vi.fn(),
      },
      budget: { reserve: vi.fn() },
      authorModel: vi.fn(),
      modelIdentity: () => 'provider/model@contract-v1',
    })
    const policy: SkillOpportunityAuthoringPolicyConfig = {
      id: 'workspace-self-discovery',
      workspaceId: WORKSPACE_ID,
      runRoot: '/private/author-one',
      maxAttemptsPerUtcDay: 1,
    }
    expect(build([])).toThrow('requires 1-20 Workspace policies')
    expect(build([{ ...policy, runRoot: '/' }])).toThrow('run roots must not be filesystem roots')
    expect(build([policy, { ...policy, id: 'author-two', runRoot: '/private/author-two' }]))
      .toThrow('policy ids, Workspaces, and run roots must be unique')
    expect(() => assertSlowLoopSkillAuthoringRootSeparation(
      [policy],
      ['/private/author-one/governance'],
    )).toThrow('must not overlap Candidate or governance roots')
    expect(policy).not.toHaveProperty('skill')
  })
})

async function setup(): Promise<{
  policy: SkillOpportunityAuthoringPolicyConfig
  evaluationPolicy: {
    id: string
    workspaceId: string
    governanceRoot: string
    runRoot: string
  }
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-slow-author-'))
  temporaryRoots.push(root)
  const runRoot = join(await realpath(root), 'authoring')
  await mkdir(runRoot, { mode: 0o700 })
  return {
    policy: {
      id: 'workspace-self-discovery',
      workspaceId: WORKSPACE_ID,
      runRoot,
      maxAttemptsPerUtcDay: 1,
    },
    evaluationPolicy: {
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(await realpath(root), 'governance'),
      runRoot: join(await realpath(root), 'evaluation-runs'),
    },
  }
}

function serviceFor(
  policy: SkillOpportunityAuthoringPolicyConfig,
  gaps: CapabilityGap[],
  jobs: ReturnType<typeof fakeJobs>,
  options: {
    candidates?: ExperienceSkillCandidate[]
    authorModel?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['authorModel']
    quarantine?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['candidates']['quarantine']
    reserve?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['budget']['reserve']
  } = {},
): SlowLoopSkillAuthoring {
  const service = new SlowLoopSkillAuthoring({
    policies: [policy],
    opportunities: new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps }),
    evaluationEvidence: new SkillEvaluationEvidenceVault([{
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(dirname(policy.runRoot), 'governance'),
      runRoot: join(dirname(policy.runRoot), 'evaluation-runs'),
    }], { list: () => gaps }),
    candidates: {
      listCandidates: () => options.candidates ?? [],
      quarantine: options.quarantine ?? (async input => ({
        created: true,
        candidate: generatedCandidate(input),
      })),
    },
    budget: { reserve: options.reserve ?? (async target => allowedReservation(target)) },
    authorModel: options.authorModel ?? (async () => ({
      files: skillFiles('missing-release-skill'),
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
    modelIdentity: () => 'provider/model@contract-v1',
    now: () => 1_787_000_000_000,
  })
  if (jobs.starts.length > 0) throw new Error('fake Jobs must start empty')
  return service
}

function allowedReservation(target: AutomaticEvolutionBudgetTarget) {
  return {
    allowed: true as const,
    newlyReserved: true,
    snapshot: {
      targetId: target.id,
      workspaceId: target.workspaceId,
      skillName: target.skill,
      utcDay: '2026-08-18',
      used: 1,
      limit: 1,
      remaining: 0,
    },
  }
}

function gap(seed: string, goalId: string, observedAt: number): CapabilityGap {
  return {
    schemaVersion: 1,
    id: seed.repeat(64),
    observedAt,
    workspaceId: WORKSPACE_ID,
    sessionId: `session-${seed}`,
    requestedSkill: 'missing-release-skill',
    catalogHash: '8'.repeat(64),
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

function fourGaps(): CapabilityGap[] {
  return [
    gap('1', 'goal-a', 10),
    gap('2', 'goal-b', 20),
    gap('3', 'goal-c', 30),
    gap('4', 'goal-d', 40),
  ]
}

function skillFiles(name: string) {
  return [
    {
      path: 'SKILL.md',
      content: `---\nname: ${name}\ndescription: Handle repeated release capability gaps.\n---\n\nFollow the bounded evidence-driven workflow in [the reference](references/workflow.md).\n`,
    },
    {
      path: 'references/workflow.md',
      content: '# Workflow\n\nUse observed evidence and preserve release isolation.\n',
    },
  ] as const
}

function generatedCandidate(input: SkillCandidateProposal): ExperienceSkillCandidate {
  return {
    schemaVersion: 1,
    id: '9'.repeat(64),
    createdAt: input.createdAt,
    workspaceId: input.workspaceId,
    skillName: input.skillName,
    description: 'Handle repeated release capability gaps.',
    opportunity: {
      kind: 'internal-experience-v1',
      id: input.opportunityId,
      gapIds: [...input.gapIds],
      goalCount: input.goalCount,
    },
    authorship: {
      kind: 'bounded-model-authoring-v1',
      policyId: input.policyId,
      modelIdentityHash: '5'.repeat(64),
      inputDigest: input.inputDigest,
    },
    scope: 'workspace',
    version: {
      kind: 'experience-authored-bundle-v1',
      artifactDigest: '7'.repeat(64),
      treeHash: '6'.repeat(64),
    },
    contentHash: '7'.repeat(64),
    package: {
      path: input.skillName,
      fileCount: input.files.length,
      totalBytes: input.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0),
      hasScripts: false,
      hasReferences: true,
    },
    permissions: { declared: false, executableContent: false, externalEffects: 'unknown' },
    license: { status: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'regular-files-only', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: { kind: 'canonical-text-bundle', format: 'tar.gz', contentBase64: 'AA==' },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
}

function existingCandidate(gaps: CapabilityGap[]): ExperienceSkillCandidate {
  return generatedCandidate({
    createdAt: 30,
    workspaceId: WORKSPACE_ID,
    skillName: 'missing-release-skill',
    policyId: 'workspace-self-discovery',
    opportunityId: '4'.repeat(64),
    gapIds: gaps.map(value => value.id),
    goalCount: new Set(gaps.map(value => value.goal?.id)).size,
    modelIdentity: 'provider/model@contract-v1',
    inputDigest: '3'.repeat(64),
    files: skillFiles('missing-release-skill'),
  })
}

function fakeJobs() {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  return {
    starts,
    hooks,
    registry: {
      start(spec: JobStart) {
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${starts.length}`
      },
    } as never,
  }
}
