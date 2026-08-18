import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assembleAgentSkillTextArchive, type AgentSkillTextManifestFile } from '../src/agent-skill-archive.ts'
import { sha256 } from '../src/hash.ts'
import {
  assertResearchSkillRevisionRootSeparation,
  assertResearchSkillRevisionCoverage,
  ResearchSkillRevision,
  ResearchSkillRevisionScheduler,
  type ResearchSkillRevisionModelInput,
  type ResearchSkillRevisionTargetConfig,
} from '../src/research-skill-revision.ts'
import type { ResearchSkillHoldoutResult } from '../src/research-skill-holdout.ts'
import type {
  DiscoveredSkillCandidate,
  MaterializedSkillCandidate,
  RevisedSkillBundleCandidateInput,
} from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('one-shot research Skill revision', () => {
  it('revises one exact failed v2 whole-Skill with bounded findings and quarantines v3', async () => {
    const fixture = await setup()
    const effects: string[] = []
    const revisionInput = vi.fn(async () => {
      effects.push('holdout')
      return boundedFindings(fixture)
    })
    const materialize = vi.fn(async (candidate, outputDir) => {
      effects.push('materialize')
      return materializeParent(candidate, outputDir, fixture.originalFiles)
    })
    const quarantineRevisedBundle = vi.fn(async (input: RevisedSkillBundleCandidateInput) => {
      effects.push('quarantine')
      return { created: true, candidate: await revisedCandidate(fixture.parent, input) }
    })
    const reviser = vi.fn(async (_input: ResearchSkillRevisionModelInput) => {
      effects.push('reviser')
      return {
        files: revisedFiles(),
        usage: { inputTokens: 144, outputTokens: 55 },
      }
    })
    const service = new ResearchSkillRevision({
      targets: [fixture.target],
      holdout: { revisionInput },
      candidates: { materialize, quarantineRevisedBundle },
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
      reviser,
      modelIdentity: () => 'revision/provider-model',
      now: () => 1_787_000_000_000,
    })

    const result = await service.revise(fixture.parent, fixture.failed)

    expect(effects).toEqual(['holdout', 'materialize', 'budget', 'reviser', 'quarantine'])
    expect(result).toMatchObject({
      status: 'candidate-ready',
      reason: 'revised-candidate-ready',
      parentCandidateId: fixture.parent.id,
      parentTreeHash: fixture.parent.version.treeHash,
      holdoutResultId: fixture.failed.id,
      researchDigest: RESEARCH_DIGEST,
      reviserIdentityHash: sha256('revision/provider-model'),
      cost: { modelCalls: 1, inputTokens: 144, outputTokens: 55 },
      candidateId: '9'.repeat(64),
      releaseAuthority: 'none',
    })
    expect(reviser).toHaveBeenCalledWith(expect.objectContaining({
      parentCandidateId: fixture.parent.id,
      parentTreeHash: fixture.parent.version.treeHash,
      holdoutResultId: fixture.failed.id,
      researchDigest: RESEARCH_DIGEST,
      files: fixture.originalFiles,
      findings: boundedFindings(fixture).findings,
    }))
    const modelPayload = JSON.stringify(reviser.mock.calls)
    expect(modelPayload).not.toContain('Independent secret excerpt')
    expect(modelPayload).not.toContain('verify.example')
    expect(modelPayload).not.toContain('knowledge')
    expect(quarantineRevisedBundle).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: WORKSPACE_ID,
      requestedSkill: 'missing-release-skill',
      sourceId: 'missing-release-author',
      clusterId: fixture.parent.demand?.clusterId,
      gapIds: fixture.parent.demand?.gapIds,
      goalCount: 2,
      modelIdentity: 'revision/provider-model',
      inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      researchDigest: RESEARCH_DIGEST,
      parentCandidateId: fixture.parent.id,
      parentTreeHash: fixture.parent.version.treeHash,
      holdoutResultId: fixture.failed.id,
      files: expect.arrayContaining([...revisedFiles()]),
    }))

    await expect(service.revise(fixture.parent, fixture.failed)).resolves.toEqual(result)
    expect(reviser).toHaveBeenCalledOnce()
    await expect(service.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredTargetCount: 1,
      warningCount: 0,
      runs: [expect.objectContaining({
        status: 'candidate-ready',
        parentCandidateId: fixture.parent.id,
        holdoutResultId: fixture.failed.id,
        candidateId: '9'.repeat(64),
        releaseAuthority: 'none',
      })],
    })
    const runPath = join(fixture.target.runRoot, 'runs', result.id, 'result.json')
    expect((await stat(runPath)).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(await service.scan())).not.toContain('revision/provider-model')
  })

  it('owns only failed or inconclusive original v2 Candidates and never recursively revises v3', async () => {
    const fixture = await setup()
    const service = createService(fixture)
    expect(service.matches(fixture.parent, fixture.failed)).toBe(true)
    expect(service.matches(fixture.parent, { ...fixture.failed, status: 'pass', reason: 'all-verification-anchors-satisfied' }))
      .toBe(false)
    expect(service.matches(await revisedCandidate(fixture.parent, revisedInput(fixture)), fixture.failed)).toBe(false)
    await expect(service.revise(
      await revisedCandidate(fixture.parent, revisedInput(fixture)),
      fixture.failed,
    )).rejects.toThrow('one original failed research-grounded Candidate')
  })

  it('defers before the model when its separate daily revision budget is exhausted', async () => {
    const fixture = await setup()
    const reviser = vi.fn()
    const service = createService(fixture, {
      reviser,
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
    })

    await expect(service.revise(fixture.parent, fixture.failed)).resolves.toMatchObject({
      status: 'budget-deferred',
      reason: 'daily-revision-budget-exhausted',
      cost: { modelCalls: 0 },
      retryAt: 1_787_097_600_000,
    })
    expect(reviser).not.toHaveBeenCalled()
  })

  it('records an unobserved paid revision as uncertain and never retries blindly', async () => {
    const fixture = await setup()
    const reviser = vi.fn(async () => { throw new Error('connection reset') })
    const service = createService(fixture, { reviser })

    const uncertain = await service.revise(fixture.parent, fixture.failed)
    expect(uncertain).toMatchObject({
      status: 'uncertain',
      reason: 'paid-revision-outcome-uncertain',
      cost: { modelCalls: 1 },
    })
    await expect(service.revise(fixture.parent, fixture.failed)).resolves.toEqual(uncertain)
    expect(reviser).toHaveBeenCalledOnce()
  })

  it('fails closed on a no-op or malformed whole-Skill response and separates private roots', async () => {
    const fixture = await setup()
    const noOp = createService(fixture, {
      reviser: async () => ({ files: fixture.originalFiles, usage: { inputTokens: 1, outputTokens: 1 } }),
    })
    await expect(noOp.revise(fixture.parent, fixture.failed)).resolves.toMatchObject({
      status: 'incomplete',
      reason: 'invalid-reviser-response',
      cost: { modelCalls: 1 },
    })
    expect(() => assertResearchSkillRevisionRootSeparation(
      [fixture.target],
      [join(fixture.target.runRoot, 'holdout')],
    )).toThrow('must not overlap')
    expect(() => assertResearchSkillRevisionCoverage(
      [fixture.target],
      [{ workspaceId: WORKSPACE_ID, skill: fixture.target.skill }],
    )).not.toThrow()
    expect(() => assertResearchSkillRevisionCoverage([], [fixture.target]))
      .toThrow('exactly cover')
  })

  it('runs same-Skill revisions serially through native Jobs', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const revise = vi.fn(async (candidate: DiscoveredSkillCandidate) => ({
      schemaVersion: 1 as const,
      id: sha256(candidate.id),
      parentCandidateId: candidate.id,
      workspaceId: candidate.workspaceId,
      skillName: candidate.requestedSkill,
      targetId: fixture.target.id,
      status: 'candidate-ready' as const,
      reason: 'revised-candidate-ready' as const,
      holdoutResultId: fixture.failed.id,
      researchDigest: RESEARCH_DIGEST,
      parentTreeHash: fixture.parent.version.treeHash,
      inputDigest: '5'.repeat(64),
      reviserIdentityHash: '6'.repeat(64),
      createdAt: new Date(1_787_000_000_000).toISOString(),
      updatedAt: new Date(1_787_000_000_000).toISOString(),
      cost: { modelCalls: 1 as const, inputTokens: 1, outputTokens: 1 },
      candidateId: '9'.repeat(64),
      releaseAuthority: 'none' as const,
    }))
    const scheduler = new ResearchSkillRevisionScheduler({ matches: () => true, revise })
    scheduler.attachJobs(jobs.registry)
    const second = { ...fixture.parent, id: '2'.repeat(64) }

    expect(scheduler.observe(fixture.parent, fixture.failed)).toBe(true)
    expect(scheduler.observe(second, { ...fixture.failed, candidateId: second.id })).toBe(true)
    expect(jobs.starts).toHaveLength(1)
    await expect(jobs.hooks[0]!.done).resolves.toMatchObject({
      status: 'completed',
      detail: 'candidate-ready: revised-candidate-ready',
    })
    await vi.waitFor(() => expect(jobs.starts).toHaveLength(2))
    await jobs.hooks[1]!.done
    expect(revise).toHaveBeenCalledTimes(2)
  })
})

const RESEARCH_DIGEST = 'a'.repeat(64)
const ANCHOR_DIGEST = 'b'.repeat(64)
const ORIGINAL_SKILL = '---\nname: missing-release-skill\ndescription: Candidate.\n---\n\nUse [workflow](references/workflow.md).\n'
const ORIGINAL_REFERENCE = '# Workflow\n\nObserve the operation.\n'

interface Fixture {
  readonly target: ResearchSkillRevisionTargetConfig
  readonly parent: DiscoveredSkillCandidate & {
    readonly version: Extract<DiscoveredSkillCandidate['version'], { kind: 'slow-loop-research-bundle-v2' }>
  }
  readonly failed: ResearchSkillHoldoutResult
  readonly originalFiles: readonly AgentSkillTextManifestFile[]
}

async function setup(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-research-revision-'))
  roots.push(root)
  const runRoot = join(await realpath(root), 'revision')
  await mkdir(runRoot)
  const originalFiles = [
    { path: 'SKILL.md', content: ORIGINAL_SKILL },
    { path: 'references/workflow.md', content: ORIGINAL_REFERENCE },
  ] as const
  const assembled = await assembleAgentSkillTextArchive(originalFiles)
  const parent: Fixture['parent'] = {
    schemaVersion: 1,
    id: '1'.repeat(64),
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
    source: { id: 'missing-release-author', kind: 'slow-loop-author', trust: 'bounded-host-authoring' },
    scope: 'workspace',
    version: {
      kind: 'slow-loop-research-bundle-v2',
      modelIdentityHash: sha256('author/provider-model'),
      inputDigest: '5'.repeat(64),
      researchDigest: RESEARCH_DIGEST,
      artifactDigest: assembled.artifactDigest,
      treeHash: assembled.treeHash,
    },
    distribution: { kind: 'archive', format: 'tar.gz' },
    contentHash: assembled.artifactDigest,
    package: {
      path: 'missing-release-skill',
      fileCount: assembled.files.length,
      totalBytes: assembled.totalBytes,
      hasScripts: false,
      hasReferences: true,
    },
    permissions: { declared: false, executableContent: false, externalEffects: 'unknown' },
    safety: {
      status: 'quarantined',
      checks: [
        { name: 'artifact-digest-integrity', status: 'passed' },
        { name: 'regular-files-only', status: 'passed' },
        { name: 'skill-identity', status: 'passed' },
        { name: 'effect-review', status: 'required' },
      ],
    },
    artifact: { kind: 'archive', format: 'tar.gz', contentBase64: assembled.content.toString('base64') },
    lifecycle: 'inactive',
    verification: 'unevaluated',
    execution: 'never',
  }
  const failed: ResearchSkillHoldoutResult = {
    schemaVersion: 1,
    id: '7'.repeat(64),
    candidateId: parent.id,
    workspaceId: WORKSPACE_ID,
    skillName: parent.requestedSkill,
    targetId: 'missing-release-holdout',
    status: 'fail',
    reason: 'verification-anchor-failed',
    researchDigest: RESEARCH_DIGEST,
    candidateTreeHash: parent.version.treeHash,
    evaluatorIdentityHash: '8'.repeat(64),
    cost: { modelCalls: 1, inputTokens: 1, outputTokens: 1 },
    findings: [{
      anchorDigest: ANCHOR_DIGEST,
      assessment: 'violated',
      attribution: 'The parent workflow omits an explicit rollback checkpoint.',
    }],
    releaseAuthority: 'none',
  }
  return {
    target: {
      id: 'missing-release-revision',
      workspaceId: WORKSPACE_ID,
      skill: parent.requestedSkill,
      runRoot,
      maxAttemptsPerUtcDay: 1,
    },
    parent,
    failed,
    originalFiles,
  }
}

function boundedFindings(fixture: Fixture) {
  return {
    holdoutResultId: fixture.failed.id,
    researchDigest: RESEARCH_DIGEST,
    parentCandidateId: fixture.parent.id,
    parentTreeHash: fixture.parent.version.treeHash,
    findings: [{
      anchorDigest: ANCHOR_DIGEST,
      assessment: 'violated' as const,
      attribution: 'The parent workflow omits an explicit rollback checkpoint.',
    }],
  }
}

function revisedFiles(): readonly AgentSkillTextManifestFile[] {
  return [
    { path: 'SKILL.md', content: ORIGINAL_SKILL },
    { path: 'references/workflow.md', content: '# Workflow\n\nObserve, checkpoint, and roll back on failure.\n' },
  ]
}

function revisedInput(fixture: Fixture): RevisedSkillBundleCandidateInput {
  return {
    discoveredAt: 1_787_000_000_000,
    workspaceId: WORKSPACE_ID,
    requestedSkill: fixture.parent.requestedSkill,
    sourceId: fixture.parent.source.id,
    clusterId: fixture.parent.demand!.clusterId,
    gapIds: fixture.parent.demand!.gapIds,
    goalCount: fixture.parent.demand!.goalCount,
    modelIdentity: 'revision/provider-model',
    inputDigest: '0'.repeat(64),
    researchDigest: RESEARCH_DIGEST,
    parentCandidateId: fixture.parent.id,
    parentTreeHash: fixture.parent.version.treeHash,
    holdoutResultId: fixture.failed.id,
    files: revisedFiles(),
  }
}

async function revisedCandidate(
  parent: Fixture['parent'],
  input: RevisedSkillBundleCandidateInput,
): Promise<DiscoveredSkillCandidate> {
  const assembled = await assembleAgentSkillTextArchive(input.files)
  return {
    ...parent,
    id: '9'.repeat(64),
    discoveredAt: input.discoveredAt,
    version: {
      kind: 'slow-loop-research-revision-v3',
      revision: 1,
      modelIdentityHash: sha256(input.modelIdentity),
      inputDigest: input.inputDigest,
      researchDigest: input.researchDigest,
      parentCandidateId: input.parentCandidateId,
      parentTreeHash: input.parentTreeHash,
      holdoutResultId: input.holdoutResultId,
      artifactDigest: assembled.artifactDigest,
      treeHash: assembled.treeHash,
    },
    contentHash: assembled.artifactDigest,
    package: {
      path: parent.requestedSkill,
      fileCount: assembled.files.length,
      totalBytes: assembled.totalBytes,
      hasScripts: false,
      hasReferences: true,
    },
    artifact: { kind: 'archive', format: 'tar.gz', contentBase64: assembled.content.toString('base64') },
  }
}

async function materializeParent(
  candidate: DiscoveredSkillCandidate,
  outputDir: string,
  files: readonly AgentSkillTextManifestFile[],
): Promise<MaterializedSkillCandidate> {
  await mkdir(join(outputDir, 'references'), { recursive: true })
  for (const file of files) await writeFile(join(outputDir, file.path), file.content)
  return {
    candidateId: candidate.id,
    path: outputDir,
    contentHash: candidate.contentHash,
    treeHash: candidate.version.treeHash,
    files: files.map(file => ({ path: file.path, mode: '100644', size: Buffer.byteLength(file.content) })),
  }
}

function createService(
  fixture: Fixture,
  overrides: {
    reviser?: ConstructorParameters<typeof ResearchSkillRevision>[0]['reviser']
    reserve?: ConstructorParameters<typeof ResearchSkillRevision>[0]['budget']['reserve']
  } = {},
): ResearchSkillRevision {
  return new ResearchSkillRevision({
    targets: [fixture.target],
    holdout: { revisionInput: async () => boundedFindings(fixture) },
    candidates: {
      materialize: (candidate, outputDir) => materializeParent(candidate, outputDir, fixture.originalFiles),
      quarantineRevisedBundle: async input => ({ created: true, candidate: await revisedCandidate(fixture.parent, input) }),
    },
    budget: {
      reserve: overrides.reserve ?? (async target => ({
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
    reviser: overrides.reviser ?? (async () => ({
      files: revisedFiles(),
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
    modelIdentity: () => 'revision/provider-model',
    now: () => 1_787_000_000_000,
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
