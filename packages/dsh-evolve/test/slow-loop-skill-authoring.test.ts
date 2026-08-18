import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import { sha256 } from '../src/hash.ts'
import {
  assertSlowLoopSkillAuthoringRootSeparation,
  SlowLoopSkillAuthoring,
  type SlowLoopSkillAuthoringTargetConfig,
} from '../src/slow-loop-skill-authoring.ts'
import type {
  AuthoredSkillBundleCandidateInput,
  DiscoveredSkillCandidate,
} from '../src/trusted-skill-discovery.ts'
import type { SkillResearchCorpus } from '../src/skill-research.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('cross-Goal slow-loop Skill authoring', () => {
  it('spends bounded budget before one native Job authors an inactive quarantined Skill candidate', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const effects: string[] = []
    const quarantineAuthoredBundle = vi.fn(async (input: AuthoredSkillBundleCandidateInput) => {
      effects.push('quarantine')
      return { created: true, candidate: generatedCandidate(input) }
    })
    const research = vi.fn(async () => {
      effects.push('research')
      return researchCorpus()
    })
    const authorModel = vi.fn(async () => {
      effects.push('author')
      return {
        files: skillFiles('missing-release-skill'),
        usage: { inputTokens: 321, outputTokens: 123 },
      }
    })
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle,
      },
      budget: {
        reserve: vi.fn(async target => {
          effects.push('budget')
          return {
            allowed: true,
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
        }),
      },
      research,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
      now: () => 1_787_000_000_000,
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toMatchObject({ scheduled: 1, warnings: [] })
    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).toMatchObject({
      kind: 'evolution',
      label: 'slow-loop Skill authoring: missing-release-skill',
    })
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'candidate-ready',
    })

    expect(effects).toEqual(['budget', 'research', 'author', 'quarantine'])
    expect(authorModel).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'missing-release-skill-author',
      workspaceId: WORKSPACE_ID,
      skillName: 'missing-release-skill',
      goalEvidence: [
        expect.objectContaining({ id: 'goal-a', objective: 'Goal goal-a needs missing-release-skill' }),
        expect.objectContaining({ id: 'goal-b', objective: 'Goal goal-b needs missing-release-skill' }),
      ],
      research: {
        digest: researchCorpus().digest,
        knowledge: researchCorpus().knowledge,
      },
      signal: expect.any(AbortSignal),
    }))
    expect(JSON.stringify(authorModel.mock.calls)).not.toContain('verify.example')
    const authored = quarantineAuthoredBundle.mock.calls[0]![0]
    expect(authored).toMatchObject({
      workspaceId: WORKSPACE_ID,
      requestedSkill: 'missing-release-skill',
      sourceId: 'missing-release-skill-author',
      clusterId: expect.stringMatching(/^[a-f0-9]{64}$/),
      gapIds: ['1'.repeat(64), '2'.repeat(64)],
      goalCount: 2,
      modelIdentity: 'provider/model@contract-v1',
      inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      researchDigest: researchCorpus().digest,
      files: expect.arrayContaining([...skillFiles('missing-release-skill')]),
    })
    expect(authored).not.toHaveProperty('releaseAuthority')

    await expect(service.scan()).resolves.toMatchObject({
      configuredTargetCount: 1,
      warningCount: 0,
      runs: [{
        workspaceId: WORKSPACE_ID,
        skillName: 'missing-release-skill',
        phase: 'candidate-ready',
        modelCalls: 1,
        inputTokens: 321,
        outputTokens: 123,
        researchDigest: researchCorpus().digest,
        candidateId: '9'.repeat(64),
        releaseAuthority: 'none',
      }],
    })
    const run = (await service.scan()).runs[0]!
    const researchPath = join(fixture.target.runRoot, 'runs', run.id, 'research.json')
    expect(JSON.parse(await readFile(researchPath, 'utf8'))).toEqual(researchCorpus())
    expect((await stat(researchPath)).mode & 0o777).toBe(0o600)
  })

  it('requires distinct Goals and suppresses authoring when any cluster Gap already has a candidate', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const gaps = [gap('1', 'same-goal', 10), gap('2', 'same-goal', 20)]
    let candidates: DiscoveredSkillCandidate[] = []
    const authorModel = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => gaps },
      candidates: {
        listCandidates: () => candidates,
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: {
        reserve: vi.fn(async target => ({
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
        })),
      },
      research: successfulResearch,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    gaps[1] = gap('2', 'other-goal', 20)
    candidates = [existingCandidate(gaps[0]!)]
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(jobs.starts).toHaveLength(0)
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('waits until every member Gap was searched against the current configured sources', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const settled = new Set<string>(['1'.repeat(64)])
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: id => settled.has(id),
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: {
        reserve: vi.fn(async target => ({
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
        })),
      },
      research: successfulResearch,
      authorModel: vi.fn(),
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    settled.add('2'.repeat(64))
    await expect(service.reconcile()).resolves.toMatchObject({ scheduled: 1, warnings: [] })
    expect(jobs.starts).toHaveLength(1)
    await jobs.hooks[0]!.done
  })

  it('fails closed when daily budget is exhausted and never reaches the model', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const authorModel = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: {
        reserve: vi.fn(async target => ({
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
        })),
      },
      research: successfulResearch,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)

    await service.reconcile()
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'budget-deferred',
    })
    expect(authorModel).not.toHaveBeenCalled()
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'budget-deferred', modelCalls: 0, releaseAuthority: 'none' }],
    })
  })

  it('persists failed research without exposing holdout anchors or calling the author', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const authorModel = vi.fn()
    const quarantineAuthoredBundle = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle,
      },
      budget: {
        reserve: vi.fn(async target => ({
          allowed: true,
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
        })),
      },
      research: vi.fn(async () => { throw new Error('independent evidence unavailable') }),
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)

    await service.reconcile()
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('research incomplete'),
    })
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'incomplete', modelCalls: 0, releaseAuthority: 'none' }],
    })
    expect(authorModel).not.toHaveBeenCalled()
    expect(quarantineAuthoredBundle).not.toHaveBeenCalled()
  })

  it('marks an observed paid-call failure uncertain and refuses automatic retry after restart', async () => {
    const fixture = await setup()
    const firstJobs = fakeJobs()
    const firstAuthor = vi.fn(async () => { throw new Error('connection reset before response') })
    const options = {
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: { reserve: vi.fn(async (target: SlowLoopSkillAuthoringTargetConfig) => ({
        allowed: true,
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
      })) },
      research: successfulResearch,
      modelIdentity: () => 'provider/model@contract-v1',
    }
    const first = new SlowLoopSkillAuthoring({ ...options, authorModel: firstAuthor })
    first.attachJobs(firstJobs.registry)
    await first.reconcile()
    await expect(firstJobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('uncertain'),
    })

    const restartJobs = fakeJobs()
    const retryAuthor = vi.fn()
    const restarted = new SlowLoopSkillAuthoring({ ...options, authorModel: retryAuthor })
    restarted.attachJobs(restartJobs.registry)
    await expect(restarted.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(restartJobs.starts).toHaveLength(0)
    expect(retryAuthor).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(
      fixture.target.runRoot,
      'runs',
      (await restarted.scan()).runs[0]!.id,
      'state.json',
    ), 'utf8'))).toMatchObject({ phase: 'uncertain', cost: { modelCalls: 1 } })
  })

  it('persists native Job cancellation before the model and never reschedules that exact run', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const authorModel = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: {
        reserve: vi.fn(async target => ({
          allowed: true,
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
        })),
      },
      research: successfulResearch,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)
    await service.reconcile()
    jobs.hooks[0]!.cancel?.('operator cancelled')

    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({ status: 'killed' })
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'cancelled', modelCalls: 0, releaseAuthority: 'none' }],
    })
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(jobs.starts).toHaveLength(1)
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('cancels in-flight research as a zero-model run and never writes a Candidate', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    let resolveResearch!: (value: SkillResearchCorpus) => void
    const research = vi.fn(() => new Promise<SkillResearchCorpus>(resolve => {
      resolveResearch = resolve
    }))
    const authorModel = vi.fn()
    const quarantineAuthoredBundle = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle,
      },
      budget: {
        reserve: vi.fn(async target => ({
          allowed: true,
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
        })),
      },
      research,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)
    await service.reconcile()
    await vi.waitFor(() => expect(research).toHaveBeenCalledOnce())

    jobs.hooks[0]!.cancel?.('operator cancelled research')
    resolveResearch(researchCorpus())

    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({ status: 'killed' })
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'cancelled', modelCalls: 0, releaseAuthority: 'none' }],
    })
    expect(authorModel).not.toHaveBeenCalled()
    expect(quarantineAuthoredBundle).not.toHaveBeenCalled()
  })

  it('does not quarantine a late provider response after native Job cancellation', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    let resolveAuthor!: (value: {
      files: ReturnType<typeof skillFiles>
      usage: { inputTokens: number; outputTokens: number }
    }) => void
    const authorModel = vi.fn(() => new Promise<{
      files: ReturnType<typeof skillFiles>
      usage: { inputTokens: number; outputTokens: number }
    }>(resolve => {
      resolveAuthor = resolve
    }))
    const quarantineAuthoredBundle = vi.fn()
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => [gap('1', 'goal-a', 10), gap('2', 'goal-b', 20)] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle,
      },
      budget: {
        reserve: vi.fn(async target => ({
          allowed: true,
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
        })),
      },
      research: successfulResearch,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)
    await service.reconcile()
    await vi.waitFor(() => expect(authorModel).toHaveBeenCalledOnce())

    jobs.hooks[0]!.cancel?.('operator cancelled in flight')
    resolveAuthor({
      files: skillFiles('missing-release-skill'),
      usage: { inputTokens: 10, outputTokens: 5 },
    })

    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({ status: 'killed' })
    await expect(service.scan()).resolves.toMatchObject({
      runs: [{ phase: 'uncertain', modelCalls: 1, releaseAuthority: 'none' }],
    })
    expect(quarantineAuthoredBundle).not.toHaveBeenCalled()
    await expect(service.reconcile()).resolves.toEqual({ scheduled: 0, warnings: [] })
    expect(jobs.starts).toHaveLength(1)
  })

  it('bounds the complete cross-Goal model input before budget reservation', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const budget = { reserve: vi.fn() }
    const authorModel = vi.fn()
    const gaps = Array.from({ length: 900 }, (_, index) => ({
      ...gap('1', `goal-${index}`, index),
      id: (index + 1).toString(16).padStart(64, '0'),
    }))
    const service = new SlowLoopSkillAuthoring({
      targets: [fixture.target],
      gaps: { list: () => gaps },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget,
      research: successfulResearch,
      authorModel,
      modelIdentity: () => 'provider/model@contract-v1',
    })
    service.attachJobs(jobs.registry)

    await expect(service.reconcile()).resolves.toMatchObject({
      scheduled: 0,
      warnings: [expect.stringContaining('evidence exceeds its input budget')],
    })
    expect(jobs.starts).toHaveLength(0)
    expect(budget.reserve).not.toHaveBeenCalled()
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('rejects ambiguous targets and filesystem roots before Jobs composition', () => {
    const build = (targets: SlowLoopSkillAuthoringTargetConfig[]) => () => new SlowLoopSkillAuthoring({
      targets,
      gaps: { list: () => [] },
      candidates: {
        listCandidates: () => [],
        isDiscoverySettled: () => true,
        quarantineAuthoredBundle: vi.fn(),
      },
      budget: { reserve: vi.fn() },
      research: successfulResearch,
      authorModel: vi.fn(),
      modelIdentity: () => 'provider/model@contract-v1',
    })
    const target = {
      id: 'author-one',
      workspaceId: WORKSPACE_ID,
      skill: 'missing-release-skill',
      runRoot: '/private/author-one',
      maxAttemptsPerUtcDay: 1,
    }
    expect(build([])).toThrow('slow-loop Skill authoring requires 1-20 exact targets')
    expect(build([{ ...target, runRoot: '/' }])).toThrow('run roots must not be filesystem roots')
    expect(build([target, { ...target, id: 'author-two', runRoot: '/private/author-two' }]))
      .toThrow('exactly one target per Workspace and Skill')
    expect(() => assertSlowLoopSkillAuthoringRootSeparation(
      [target],
      ['/private/author-one/governance'],
    )).toThrow('must not overlap discovery or governance roots')
  })
})

async function setup(): Promise<{ target: SlowLoopSkillAuthoringTargetConfig }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-slow-author-'))
  temporaryRoots.push(root)
  const runRoot = join(await realpath(root), 'authoring')
  await mkdir(runRoot, { mode: 0o700 })
  return {
    target: {
      id: 'missing-release-skill-author',
      workspaceId: WORKSPACE_ID,
      skill: 'missing-release-skill',
      runRoot,
      maxAttemptsPerUtcDay: 1,
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
      kind: 'slow-loop-research-bundle-v2',
      modelIdentityHash: '5'.repeat(64),
      inputDigest: input.inputDigest,
      researchDigest: input.researchDigest,
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

function existingCandidate(sourceGap: CapabilityGap): DiscoveredSkillCandidate {
  return generatedCandidate({
    discoveredAt: 30,
    workspaceId: WORKSPACE_ID,
    requestedSkill: sourceGap.requestedSkill,
    sourceId: 'missing-release-skill-author',
    clusterId: '4'.repeat(64),
    gapIds: [sourceGap.id],
    goalCount: 1,
    modelIdentity: 'provider/model@contract-v1',
    inputDigest: '3'.repeat(64),
    researchDigest: researchCorpus().digest,
    files: skillFiles(sourceGap.requestedSkill),
  })
}

const successfulResearch = async (): Promise<SkillResearchCorpus> => researchCorpus()

function researchCorpus(): SkillResearchCorpus {
  const unsigned = {
    schemaVersion: 1,
    skillName: 'missing-release-skill',
    queryDigest: 'b'.repeat(64),
    knowledge: [
      researchEvidence('knowledge', 'official', 'https://docs.example/skill'),
      researchEvidence('knowledge', 'open-source', 'https://code.example/skill'),
    ],
    verification: [
      researchEvidence('verification', 'holdout', 'https://verify.example/skill'),
    ],
    truncated: false,
  } as const
  return { ...unsigned, digest: sha256(JSON.stringify(unsigned)) }
}

function researchEvidence(
  role: 'knowledge' | 'verification',
  track: 'official' | 'open-source' | 'holdout',
  url: string,
) {
  return {
    role,
    track,
    queryHash: 'c'.repeat(64),
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    excerpt: `Evidence from ${url}`,
    contentDigest: 'd'.repeat(64),
    truncated: false,
  } as const
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
