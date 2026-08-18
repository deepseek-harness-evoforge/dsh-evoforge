import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomaticEvolutionBudgetTarget } from '../src/automatic-evolution-budget.ts'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
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
  AuthoredSkillBundleCandidateInput,
  DiscoveredSkillCandidate,
} from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('experience-driven slow-loop Skill authoring', () => {
  it('derives the Skill from internal Goal experience and authors without external research', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
    const effects: string[] = []
    const quarantineExperienceAuthoredBundle = vi.fn(async (input: AuthoredSkillBundleCandidateInput) => {
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
      gaps: { list: () => gaps },
      opportunities: new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps }),
      candidates: {
        listCandidates: () => [],
        quarantineExperienceAuthoredBundle,
      },
      budget: {
        reserve: vi.fn(async target => {
          effects.push('budget')
          return allowedReservation(target)
        }),
      },
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
      goalEvidence: [
        expect.objectContaining({ id: 'goal-a', objective: 'Goal goal-a needs missing-release-skill' }),
        expect.objectContaining({ id: 'goal-b', objective: 'Goal goal-b needs missing-release-skill' }),
      ],
      signal: expect.any(AbortSignal),
    }))
    expect(authorModel.mock.calls[0]![0]).not.toHaveProperty('research')
    const authored = quarantineExperienceAuthoredBundle.mock.calls[0]![0]
    expect(authored).toMatchObject({
      workspaceId: WORKSPACE_ID,
      requestedSkill: 'missing-release-skill',
      sourceId: 'workspace-self-discovery',
      clusterId: expect.stringMatching(/^[a-f0-9]{64}$/),
      gapIds: ['1'.repeat(64), '2'.repeat(64)],
      goalCount: 2,
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
      policyVersion: 'experience-driven-whole-skill-author-v3',
      skillName: 'missing-release-skill',
    })
  })

  it('abstains for same-Goal retries and starts when a second distinct Goal supplies evidence', async () => {
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
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 1, warnings: [] })
    await jobs.hooks[0]!.done
    expect(authorModel).toHaveBeenCalledOnce()
  })

  it('suppresses an opportunity when that internally discovered Skill already has a candidate', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
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
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
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
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
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
    const gaps = [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)]
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

  it('bounds complete opportunity evidence before budget reservation', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const reserve = vi.fn()
    const gaps = Array.from({ length: 900 }, (_, index) => ({
      ...gap('1', `goal-${index}`, index),
      id: (index + 1).toString(16).padStart(64, '0'),
    }))
    const service = serviceFor(fixture.policy, gaps, jobs, { reserve })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toMatchObject({
      scheduled: 0,
      warnings: [expect.stringContaining('evidence exceeds its input budget')],
    })
    expect(reserve).not.toHaveBeenCalled()
    expect(jobs.starts).toHaveLength(0)
  })

  it('accepts only one path-isolated policy per Workspace and never asks for a Skill name', () => {
    const build = (policies: SkillOpportunityAuthoringPolicyConfig[]) => () => new SlowLoopSkillAuthoring({
      policies,
      gaps: { list: () => [] },
      opportunities: { discover: () => [] },
      candidates: {
        listCandidates: () => [],
        quarantineExperienceAuthoredBundle: vi.fn(),
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
    )).toThrow('must not overlap discovery or governance roots')
    expect(policy).not.toHaveProperty('skill')
  })
})

async function setup(): Promise<{ policy: SkillOpportunityAuthoringPolicyConfig }> {
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
  }
}

function serviceFor(
  policy: SkillOpportunityAuthoringPolicyConfig,
  gaps: CapabilityGap[],
  jobs: ReturnType<typeof fakeJobs>,
  options: {
    candidates?: DiscoveredSkillCandidate[]
    authorModel?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['authorModel']
    quarantine?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['candidates']['quarantineExperienceAuthoredBundle']
    reserve?: ConstructorParameters<typeof SlowLoopSkillAuthoring>[0]['budget']['reserve']
  } = {},
): SlowLoopSkillAuthoring {
  const service = new SlowLoopSkillAuthoring({
    policies: [policy],
    gaps: { list: () => gaps },
    opportunities: new ExperienceDrivenSkillOpportunityDiscovery({ list: () => gaps }),
    candidates: {
      listCandidates: () => options.candidates ?? [],
      quarantineExperienceAuthoredBundle: options.quarantine ?? (async input => ({
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

function generatedCandidate(input: AuthoredSkillBundleCandidateInput): DiscoveredSkillCandidate {
  return {
    schemaVersion: 1,
    id: '9'.repeat(64),
    discoveredAt: input.discoveredAt,
    gapId: input.gapIds[0]!,
    workspaceId: input.workspaceId,
    requestedSkill: input.requestedSkill,
    description: 'Handle repeated release capability gaps.',
    demand: {
      kind: 'cross-goal-cluster-v1',
      clusterId: input.clusterId,
      gapIds: [...input.gapIds],
      goalCount: input.goalCount,
    },
    source: { id: input.sourceId, kind: 'slow-loop-author', trust: 'bounded-host-authoring' },
    scope: 'workspace',
    version: {
      kind: 'slow-loop-author-bundle-v1',
      modelIdentityHash: '5'.repeat(64),
      inputDigest: input.inputDigest,
      artifactDigest: '7'.repeat(64),
      treeHash: '6'.repeat(64),
    },
    distribution: { kind: 'archive', format: 'tar.gz' },
    contentHash: '7'.repeat(64),
    package: {
      path: input.requestedSkill,
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
    artifact: { kind: 'archive', format: 'tar.gz', contentBase64: 'AA==' },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
}

function existingCandidate(gaps: CapabilityGap[]): DiscoveredSkillCandidate {
  return generatedCandidate({
    discoveredAt: 30,
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    sourceId: 'workspace-self-discovery',
    clusterId: '4'.repeat(64),
    gapIds: gaps.map(value => value.id),
    goalCount: 2,
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
