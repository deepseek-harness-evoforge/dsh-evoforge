import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '../src/hash.ts'
import {
  assertResearchSkillHoldoutCoverage,
  assertResearchSkillHoldoutRootSeparation,
  ResearchSkillHoldout,
  ResearchSkillHoldoutScheduler,
  type ResearchSkillHoldoutEvaluatorInput,
  type ResearchSkillHoldoutEvaluatorResult,
  type ResearchSkillHoldoutTargetConfig,
} from '../src/research-skill-holdout.ts'
import type { SkillResearchEvidence } from '../src/skill-research.ts'
import type {
  DiscoveredSkillCandidate,
  MaterializedSkillCandidate,
} from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('independent research holdout', () => {
  it('consumes withheld anchors against one exact materialized bundle with no release authority', async () => {
    const fixture = await setup()
    const effects: string[] = []
    const evaluator = vi.fn(async (input: ResearchSkillHoldoutEvaluatorInput) => {
      effects.push('evaluator')
      return {
        findings: input.verification.map(anchor => ({
          anchorDigest: anchor.contentDigest,
          assessment: 'satisfied' as const,
          attribution: 'The workflow explicitly handles the independently observed failure mode.',
        })),
        usage: { inputTokens: 211, outputTokens: 37 },
      }
    })
    const holdout = new ResearchSkillHoldout({
      targets: [fixture.target],
      evidence: {
        verificationFor: vi.fn(async () => {
          effects.push('evidence')
          return { researchDigest: RESEARCH_DIGEST, verification: [verificationAnchor()] }
        }),
      },
      candidates: {
        materialize: vi.fn(async (input, path) => {
          effects.push('materialize')
          return materialize(input, path)
        }),
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
      evaluator,
      evaluatorIdentity: () => 'independent/provider-model',
      now: () => 1_787_000_000_000,
    })

    const result = await holdout.evaluate(candidate())

    expect(effects).toEqual(['materialize', 'evidence', 'budget', 'evaluator'])
    expect(result).toMatchObject({
      status: 'pass',
      reason: 'all-verification-anchors-satisfied',
      candidateId: candidate().id,
      targetId: fixture.target.id,
      researchDigest: RESEARCH_DIGEST,
      candidateTreeHash: TREE_HASH,
      evaluatorIdentityHash: sha256('independent/provider-model'),
      cost: { modelCalls: 1, inputTokens: 211, outputTokens: 37 },
      findings: [{
        anchorDigest: ANCHOR_DIGEST,
        assessment: 'satisfied',
      }],
      releaseAuthority: 'none',
    })
    expect(evaluator).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: candidate().id,
      candidateTreeHash: TREE_HASH,
      researchDigest: RESEARCH_DIGEST,
      files: [
        expect.objectContaining({ path: 'SKILL.md', content: expect.stringContaining('missing-release-skill') }),
        expect.objectContaining({ path: 'references/workflow.md', content: expect.stringContaining('rollback') }),
      ],
      verification: [{
        contentDigest: ANCHOR_DIGEST,
        excerpt: 'Independent evidence says rollback must be explicit.',
        truncated: false,
      }],
    }))
    expect(JSON.stringify(evaluator.mock.calls)).not.toContain('verify.example')
    expect(JSON.stringify(evaluator.mock.calls)).not.toContain('knowledge')

    await expect(holdout.evaluate(candidate())).resolves.toEqual(result)
    expect(evaluator).toHaveBeenCalledOnce()
    const persisted = JSON.parse(await readFile(
      join(fixture.target.runRoot, 'runs', result.id, 'result.json'),
      'utf8',
    ))
    expect(persisted).toEqual(result)
    await expect(holdout.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredTargetCount: 1,
      warningCount: 0,
      results: [result],
    })

    const revised = revisedCandidate()
    expect(holdout.matches(revised)).toBe(true)
    await expect(holdout.evaluate(revised)).resolves.toMatchObject({
      status: 'pass',
      candidateId: revised.id,
      candidateTreeHash: revised.version.treeHash,
      researchDigest: RESEARCH_DIGEST,
      releaseAuthority: 'none',
    })
    expect(evaluator).toHaveBeenCalledTimes(2)
  })

  it('refuses an evaluator that can match the Candidate author identity before budget or model use', async () => {
    const fixture = await setup()
    const evaluator = vi.fn()
    const reserve = vi.fn()
    const sameIdentity = 'author/provider-model'
    const holdout = new ResearchSkillHoldout({
      targets: [fixture.target],
      evidence: { verificationFor: vi.fn() },
      candidates: { materialize: vi.fn() },
      budget: { reserve },
      evaluator,
      evaluatorIdentity: () => sameIdentity,
    })

    await expect(holdout.evaluate(candidate({ modelIdentityHash: sha256(sameIdentity) })))
      .resolves.toMatchObject({
        status: 'incomplete',
        reason: 'evaluator-not-independent',
        cost: { modelCalls: 0 },
        releaseAuthority: 'none',
      })
    expect(reserve).not.toHaveBeenCalled()
    expect(evaluator).not.toHaveBeenCalled()
  })

  it.each([
    ['violated', 'fail', 'verification-anchor-failed'],
    ['unresolved', 'inconclusive', 'verification-anchor-unresolved'],
  ] as const)('derives %s findings as %s without trusting a model-level verdict', async (
    assessment,
    status,
    reason,
  ) => {
    const fixture = await setup()
    const holdout = service(fixture.target, async () => ({
      findings: [{ anchorDigest: ANCHOR_DIGEST, assessment, attribution: 'Bounded attribution.' }],
      usage: { inputTokens: 10, outputTokens: 5 },
    }))

    await expect(holdout.evaluate(candidate())).resolves.toMatchObject({ status, reason })
  })

  it('fails closed on duplicate, unknown, or omitted verification anchor findings', async () => {
    const fixture = await setup()
    const holdout = service(fixture.target, async () => ({
      findings: [
        { anchorDigest: ANCHOR_DIGEST, assessment: 'satisfied', attribution: 'First.' },
        { anchorDigest: ANCHOR_DIGEST, assessment: 'satisfied', attribution: 'Duplicate.' },
      ],
      usage: { inputTokens: 10, outputTokens: 5 },
    }))

    await expect(holdout.evaluate(candidate())).resolves.toMatchObject({
      status: 'incomplete',
      reason: 'invalid-evaluator-response',
      cost: { modelCalls: 1 },
    })
  })

  it('defers before the evaluator when its daily budget is exhausted and resumes only after retryAt', async () => {
    const fixture = await setup()
    const evaluator = vi.fn(async () => ({
      findings: [{ anchorDigest: ANCHOR_DIGEST, assessment: 'satisfied' as const, attribution: 'Covered.' }],
      usage: { inputTokens: 8, outputTokens: 3 },
    }))
    let now = 1_787_000_000_000
    const reserve = vi.fn()
      .mockResolvedValueOnce({
        allowed: false,
        newlyReserved: false,
        retryAt: now + 1_000,
        snapshot: {
          targetId: fixture.target.id,
          workspaceId: WORKSPACE_ID,
          skillName: fixture.target.skill,
          utcDay: '2026-08-18',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      })
      .mockResolvedValueOnce({
        allowed: true,
        newlyReserved: true,
        snapshot: {
          targetId: fixture.target.id,
          workspaceId: WORKSPACE_ID,
          skillName: fixture.target.skill,
          utcDay: '2026-08-19',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      })
    const holdout = new ResearchSkillHoldout({
      targets: [fixture.target],
      evidence: {
        verificationFor: async () => ({
          researchDigest: RESEARCH_DIGEST,
          verification: [verificationAnchor()],
        }),
      },
      candidates: { materialize },
      budget: { reserve },
      evaluator,
      evaluatorIdentity: () => 'independent/provider-model',
      now: () => now,
    })

    await expect(holdout.evaluate(candidate())).resolves.toMatchObject({
      status: 'budget-deferred',
      retryAt: now + 1_000,
      cost: { modelCalls: 0 },
    })
    await expect(holdout.evaluate(candidate())).resolves.toMatchObject({ status: 'budget-deferred' })
    expect(reserve).toHaveBeenCalledOnce()
    expect(evaluator).not.toHaveBeenCalled()

    now += 1_001
    await expect(holdout.evaluate(candidate())).resolves.toMatchObject({ status: 'pass' })
    expect(reserve).toHaveBeenCalledTimes(2)
    expect(evaluator).toHaveBeenCalledOnce()
  })

  it('records an unobserved paid-call outcome as uncertain and never retries it blindly', async () => {
    const fixture = await setup()
    const evaluator = vi.fn(async () => { throw new Error('connection reset') })
    const holdout = service(fixture.target, evaluator)

    const uncertain = await holdout.evaluate(candidate())
    expect(uncertain).toMatchObject({
      status: 'uncertain',
      reason: 'paid-evaluation-outcome-uncertain',
      cost: { modelCalls: 1 },
    })
    await expect(holdout.evaluate(candidate())).resolves.toEqual(uncertain)
    expect(evaluator).toHaveBeenCalledOnce()
  })

  it('revalidates one durable failed original Holdout as bounded revision input', async () => {
    const fixture = await setup()
    const holdout = service(fixture.target, async () => ({
      findings: [{
        anchorDigest: ANCHOR_DIGEST,
        assessment: 'violated',
        attribution: 'The parent workflow omits an explicit rollback checkpoint.',
      }],
      usage: { inputTokens: 10, outputTokens: 5 },
    }))
    const parent = candidate()
    const failed = await holdout.evaluate(parent)

    await expect(holdout.revisionInput(parent, failed)).resolves.toEqual({
      holdoutResultId: failed.id,
      researchDigest: RESEARCH_DIGEST,
      parentCandidateId: parent.id,
      parentTreeHash: TREE_HASH,
      findings: [{
        anchorDigest: ANCHOR_DIGEST,
        assessment: 'violated',
        attribution: 'The parent workflow omits an explicit rollback checkpoint.',
      }],
    })
    await expect(holdout.revisionInput(revisedCandidate(), failed))
      .rejects.toThrow('one original research-grounded Candidate')
    await expect(holdout.revisionInput(parent, { ...failed, id: '0'.repeat(64) }))
      .rejects.toThrow('exact durable Holdout result')
  })

  it('rejects executable Candidate metadata before materialization and refuses overlapping roots', async () => {
    const fixture = await setup()
    const materializeCandidate = vi.fn()
    const holdout = new ResearchSkillHoldout({
      targets: [fixture.target],
      evidence: { verificationFor: vi.fn() },
      candidates: { materialize: materializeCandidate },
      budget: { reserve: vi.fn() },
      evaluator: vi.fn(),
      evaluatorIdentity: () => 'independent/provider-model',
    })

    await expect(holdout.evaluate(candidate({ executableContent: true }))).resolves.toMatchObject({
      status: 'incomplete',
      reason: 'local-validation-failed',
      cost: { modelCalls: 0 },
    })
    expect(materializeCandidate).not.toHaveBeenCalled()
    expect(() => assertResearchSkillHoldoutRootSeparation(
      [fixture.target],
      [join(fixture.target.runRoot, 'governance')],
    )).toThrow('must not overlap')
    expect(() => assertResearchSkillHoldoutCoverage(
      [],
      [{ workspaceId: WORKSPACE_ID, skill: fixture.target.skill }],
      [{ workspaceId: WORKSPACE_ID, skill: fixture.target.skill }],
    )).toThrow('must gate every authored Candidate')
    expect(() => assertResearchSkillHoldoutCoverage(
      [fixture.target],
      [{ workspaceId: WORKSPACE_ID, skill: fixture.target.skill }],
      [{ workspaceId: WORKSPACE_ID, skill: fixture.target.skill }],
    )).not.toThrow()
  })

  it('forwards only a durable pass to deterministic admission through native Jobs', async () => {
    const jobs = fakeJobs()
    const pass = result('pass')
    const fail = result('fail')
    const evaluate = vi.fn()
      .mockResolvedValueOnce(pass)
      .mockResolvedValueOnce(fail)
    const onPass = vi.fn()
    const scheduler = new ResearchSkillHoldoutScheduler(
      { matches: () => true, evaluate },
      { listCandidates: () => [candidate(), candidate({ id: '2'.repeat(64) })] },
      { onPass },
    )

    scheduler.attachJobs(jobs.registry)
    expect(jobs.starts).toHaveLength(1)
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({ status: 'completed', detail: 'pass' })
    expect(onPass).toHaveBeenCalledWith(candidate(), pass)

    await vi.waitFor(() => expect(jobs.starts).toHaveLength(2))
    await expect(jobs.hooks[1]!.done).resolves.toMatchObject({ status: 'completed', detail: 'fail' })
    expect(onPass).toHaveBeenCalledOnce()
  })
})

const RESEARCH_DIGEST = 'a'.repeat(64)
const ANCHOR_DIGEST = 'b'.repeat(64)
const TREE_HASH = 'c'.repeat(64)
const SKILL_TEXT = '---\nname: missing-release-skill\ndescription: Candidate.\n---\n\nUse [workflow](references/workflow.md).\n'
const WORKFLOW_TEXT = '# Workflow\n\nUse an explicit rollback step.\n'

async function setup(): Promise<{ target: ResearchSkillHoldoutTargetConfig }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-research-holdout-'))
  roots.push(root)
  const runRoot = join(await realpath(root), 'holdout')
  await mkdir(runRoot)
  return {
    target: {
      id: 'missing-release-holdout',
      workspaceId: WORKSPACE_ID,
      skill: 'missing-release-skill',
      runRoot,
      maxAttemptsPerUtcDay: 1,
    },
  }
}

function service(
  target: ResearchSkillHoldoutTargetConfig,
  evaluator: (input: ResearchSkillHoldoutEvaluatorInput) => Promise<ResearchSkillHoldoutEvaluatorResult>,
): ResearchSkillHoldout {
  return new ResearchSkillHoldout({
    targets: [target],
    evidence: {
      verificationFor: async () => ({
        researchDigest: RESEARCH_DIGEST,
        verification: [verificationAnchor()],
      }),
    },
    candidates: { materialize },
    budget: {
      reserve: async targetConfig => ({
        allowed: true,
        newlyReserved: true,
        snapshot: {
          targetId: targetConfig.id,
          workspaceId: targetConfig.workspaceId,
          skillName: targetConfig.skill,
          utcDay: '2026-08-18',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      }),
    },
    evaluator,
    evaluatorIdentity: () => 'independent/provider-model',
    now: () => 1_787_000_000_000,
  })
}

async function materialize(
  input: DiscoveredSkillCandidate,
  path: string,
): Promise<MaterializedSkillCandidate> {
  await mkdir(path)
  await mkdir(join(path, 'references'))
  await writeFile(join(path, 'SKILL.md'), SKILL_TEXT)
  await writeFile(join(path, 'references', 'workflow.md'), WORKFLOW_TEXT)
  return {
    candidateId: input.id,
    path,
    contentHash: input.contentHash,
    treeHash: TREE_HASH,
    files: [
      { path: 'SKILL.md', mode: '100644', size: Buffer.byteLength(SKILL_TEXT) },
      { path: 'references/workflow.md', mode: '100644', size: Buffer.byteLength(WORKFLOW_TEXT) },
    ],
  }
}

function verificationAnchor(): SkillResearchEvidence {
  return {
    role: 'verification',
    track: 'holdout',
    queryHash: 'd'.repeat(64),
    requestedUrl: 'https://verify.example/skill',
    finalUrl: 'https://verify.example/skill',
    statusCode: 200,
    excerpt: 'Independent evidence says rollback must be explicit.',
    contentDigest: ANCHOR_DIGEST,
    truncated: false,
  }
}

function candidate(overrides: {
  id?: string
  modelIdentityHash?: string
  executableContent?: boolean
} = {}): DiscoveredSkillCandidate {
  return {
    schemaVersion: 1,
    id: overrides.id ?? '1'.repeat(64),
    discoveredAt: 1_786_896_100_000,
    gapId: '2'.repeat(64),
    workspaceId: WORKSPACE_ID,
    requestedSkill: 'missing-release-skill',
    description: 'Candidate.',
    demand: {
      kind: 'cross-goal-cluster-v1',
      clusterId: '3'.repeat(64),
      gapIds: ['2'.repeat(64), '4'.repeat(64)],
      goalCount: 2,
    },
    source: { id: 'missing-release-skill-author', kind: 'slow-loop-author', trust: 'bounded-host-authoring' },
    scope: 'workspace',
    version: {
      kind: 'slow-loop-research-bundle-v2',
      modelIdentityHash: overrides.modelIdentityHash ?? sha256('author/provider-model'),
      inputDigest: '5'.repeat(64),
      researchDigest: RESEARCH_DIGEST,
      artifactDigest: '6'.repeat(64),
      treeHash: TREE_HASH,
    },
    distribution: { kind: 'archive', format: 'tar.gz' },
    contentHash: '6'.repeat(64),
    package: {
      path: 'missing-release-skill',
      fileCount: 2,
      totalBytes: Buffer.byteLength(SKILL_TEXT) + Buffer.byteLength(WORKFLOW_TEXT),
      hasScripts: overrides.executableContent ?? false,
      hasReferences: true,
    },
    permissions: {
      declared: false,
      executableContent: overrides.executableContent ?? false,
      externalEffects: 'unknown',
    },
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

function revisedCandidate(): DiscoveredSkillCandidate {
  const parent = candidate()
  return {
    ...parent,
    id: '9'.repeat(64),
    version: {
      kind: 'slow-loop-research-revision-v3',
      revision: 1,
      modelIdentityHash: sha256('revision/provider-model'),
      inputDigest: '0'.repeat(64),
      researchDigest: RESEARCH_DIGEST,
      parentCandidateId: parent.id,
      parentTreeHash: 'f'.repeat(64),
      holdoutResultId: '8'.repeat(64),
      artifactDigest: parent.contentHash,
      treeHash: TREE_HASH,
    },
  }
}

function result(status: 'pass' | 'fail') {
  return {
    schemaVersion: 1 as const,
    id: '7'.repeat(64),
    candidateId: candidate().id,
    workspaceId: WORKSPACE_ID,
    skillName: 'missing-release-skill',
    targetId: 'missing-release-holdout',
    status,
    reason: status === 'pass'
      ? 'all-verification-anchors-satisfied' as const
      : 'verification-anchor-failed' as const,
    researchDigest: RESEARCH_DIGEST,
    candidateTreeHash: TREE_HASH,
    evaluatorIdentityHash: '8'.repeat(64),
    cost: { modelCalls: 1 as const, inputTokens: 1, outputTokens: 1 },
    findings: [{
      anchorDigest: ANCHOR_DIGEST,
      assessment: status === 'pass' ? 'satisfied' as const : 'violated' as const,
      attribution: 'Bounded.',
    }],
    releaseAuthority: 'none' as const,
  }
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
