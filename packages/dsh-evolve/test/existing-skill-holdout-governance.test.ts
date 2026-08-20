import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExistingSkillHoldoutGovernance,
  type ExistingSkillHoldoutAuthorInput,
} from '../src/existing-skill-holdout-governance.ts'
import { assembleSealedSkillBundleArchive } from '../src/skill-bundle-archive.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Existing Skill Holdout Governance', () => {
  it('seals an independent Retention Case Pack into the pre-Candidate Envelope when a fifth Goal exists', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-retention-governance-')))
    roots.push(root)
    const subject = await retentionSubject()
    const governed = governedEvidence(subject)
    const authorModel = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => validAuthorResult(input))
    const calibrate = vi.fn(async () => ({
      status: 'calibrated' as const,
      reportPath: join(root, 'calibration-report.json'),
      summary: 'known-bad failed and known-correction passed',
    }))
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governed) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate,
      modelIdentity: () => 'independent-existing-evaluation/model-v1',
      now: () => 1_787_270_400_000,
    })

    const result = await governance.ensure(subject)

    if (result.status !== 'ready') throw new Error('expected ready existing-Skill governance')
    expect(authorModel).toHaveBeenCalledTimes(2)
    expect(authorModel.mock.calls.map(call => call[0].role)).toEqual(['holdout', 'retention'])
    expect(authorModel.mock.calls[0]![0].protectedCase.goal.id).toBe('goal-holdout')
    expect(authorModel.mock.calls[1]![0].protectedCase.goal.id).toBe('goal-retention')
    expect(JSON.stringify(authorModel.mock.calls[0]![0])).not.toContain('Retention correction.')
    expect(JSON.stringify(authorModel.mock.calls[1]![0])).not.toContain('Do not let the author be the final reviewer.')
    expect(calibrate).toHaveBeenCalledTimes(2)
    expect(result.envelope).toMatchObject({
      retentionCasePackDir: expect.any(String),
      retentionCasePackHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      releaseAuthority: 'none',
    })
    expect(result.envelope.retentionCasePackHash).not.toBe(result.envelope.casePackHash)
    await expect(readFile(join(result.envelope.retentionCasePackDir!, 'manifest.json'), 'utf8'))
      .resolves.toContain('existing-retention-')
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ phase: 'ready', modelCalls: 2, retentionIncluded: true }],
    })
  })

  it('rejects a Retention evaluator that merely duplicates the Holdout evaluator', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-retention-duplicate-')))
    roots.push(root)
    const subject = await retentionSubject()
    const authorModel = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => ({
      ...validAuthorResult(input),
      evaluatorSource: 'process.stdout.write("{\\"schemaVersion\\":1,\\"passed\\":true}")\n',
    }))
    const calibrate = vi.fn()
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate,
      modelIdentity: () => 'independent-existing-evaluation/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(governance.ensure(subject)).rejects
      .toThrow('Retention evaluator duplicates Holdout')
    expect(authorModel).toHaveBeenCalledTimes(2)
    expect(calibrate).not.toHaveBeenCalled()
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{ phase: 'incomplete', modelCalls: 2, retentionIncluded: true }],
    })
  })

  it('authors one calibrated assembled skill-tree holdout without exposing any Candidate', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-governance-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const governed = governedEvidence(subject)
    const authorModel = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => ({
      knownCorrectionSkill: [
        '---',
        `name: ${input.skillName}`,
        'description: Verify a release with independent evidence.',
        'license: MIT',
        '---',
        '',
        'Require independent evidence before declaring success.',
        '',
      ].join('\n'),
      evaluatorSource: `process.stdout.write(${JSON.stringify(JSON.stringify({
        schemaVersion: 1,
        passed: true,
        checks: [{ name: 'independent-proof', passed: true }],
        composition: { fingerprint: 'f'.repeat(64), modelCalls: 1, usage: {} },
      }))})\n`,
      usage: { inputTokens: 40, outputTokens: 20 },
    }))
    const calibrate = vi.fn(async () => ({
      status: 'calibrated' as const,
      reportPath: join(root, 'calibration-report.json'),
      summary: 'known-bad failed and known-correction passed',
    }))
    const policy = {
      id: 'workspace-existing-holdout',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
      dshRevision: 'a'.repeat(40),
      maxAttemptsPerUtcDay: 1,
    }
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [policy],
      evidence: { readForGovernance: vi.fn(async () => governed) },
      budget: {
        reserve: vi.fn(async () => ({
          allowed: true,
          newlyReserved: true,
          snapshot: {
            targetId: policy.id,
            workspaceId: WORKSPACE_ID,
            skillName: subject.opportunity.skillName,
            utcDay: '2026-08-21',
            used: 1,
            limit: 1,
            remaining: 0,
          },
        })),
      },
      authorModel,
      calibrate,
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    const result = await governance.ensure(subject)

    expect(result).toMatchObject({
      status: 'ready',
      envelope: {
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        opportunityId: subject.opportunity.id,
        qualificationId: subject.qualification.id,
        baselineId: subject.baseline.manifest.id,
        evaluationEvidenceId: subject.evidence.id,
        dshRevision: policy.dshRevision,
        releaseAuthority: 'none',
      },
    })
    if (result.status !== 'ready') throw new Error('expected ready holdout governance')
    expect(authorModel).toHaveBeenCalledOnce()
    const input = authorModel.mock.calls[0]![0]
    expect(input).toMatchObject({
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      opportunityId: subject.opportunity.id,
      qualificationId: subject.qualification.id,
      baseline: {
        id: subject.baseline.manifest.id,
        treeHash: subject.baseline.manifest.bundle.treeHash,
      },
      protectedCase: {
        goal: { id: 'goal-holdout' },
        correction: 'Do not let the author be the final reviewer.',
      },
      role: 'holdout',
      dshRevision: policy.dshRevision,
    })
    expect(JSON.stringify(input)).not.toMatch(/candidate|changedPaths|claim/iu)
    expect(input.baseline.files.find(file => file.path === 'assets/proof.png')).toEqual({
      path: 'assets/proof.png',
      mode: '100644',
      size: 6,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      representation: 'binary',
    })
    expect(input.protectedCase.correction).toBe('Do not let the author be the final reviewer.')
    expect(governed.samples.filter(sample => sample.role !== 'holdout')
      .every(sample => !JSON.stringify(input).includes(sample.correction.note))).toBe(true)
    expect(calibrate).toHaveBeenCalledOnce()

    await expect(governance.resolve({
      envelopeId: result.envelope.id,
      workspaceId: WORKSPACE_ID,
      skillName: subject.opportunity.skillName,
      opportunityId: subject.opportunity.id,
      qualificationId: subject.qualification.id,
      baselineId: subject.baseline.manifest.id,
      baselineTreeHash: subject.baseline.manifest.bundle.treeHash,
      evaluationEvidenceId: subject.evidence.id,
      proposerModelIdentityHash: subject.proposerModelIdentityHash,
    })).resolves.toEqual(result.envelope)
    await expect(governance.resolve({
      envelopeId: 'f'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: subject.opportunity.skillName,
      opportunityId: subject.opportunity.id,
      qualificationId: subject.qualification.id,
      baselineId: subject.baseline.manifest.id,
      baselineTreeHash: subject.baseline.manifest.bundle.treeHash,
      evaluationEvidenceId: subject.evidence.id,
      proposerModelIdentityHash: subject.proposerModelIdentityHash,
    })).rejects.toThrow('does not match its Candidate binding')

    const manifest = JSON.parse(await readFile(join(result.envelope.casePackDir, 'manifest.json'), 'utf8'))
    expect(manifest.trial).toEqual({
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 30_000,
      outputLimitBytes: 256 * 1024,
      dshAssembled: true,
    })
    expect(manifest).not.toHaveProperty('trial.capabilityAbsentBaseline')
    expect((await readdir(join(result.envelope.casePackDir, 'calibration', 'known-bad'))).sort())
      .toEqual(['SKILL.md', 'assets', 'references'])
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      configuredPolicyCount: 1,
      warningCount: 0,
      runs: [{
        skillName: 'release-proof',
        phase: 'ready',
        modelCalls: 1,
        inputTokens: 40,
        outputTokens: 20,
        releaseAuthority: 'none',
      }],
    })
  })

  it('rejects the Candidate proposer model before budget reservation or authoring', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-identity-')))
    roots.push(root)
    const modelIdentity = 'shared-provider/model-v1'
    const subject = {
      ...await holdoutSubject(),
      proposerModelIdentityHash: createHash('sha256').update(modelIdentity).digest('hex'),
    }
    const budget = { reserve: vi.fn() }
    const authorModel = vi.fn()
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [{
        id: 'workspace-existing-holdout',
        workspaceId: WORKSPACE_ID,
        governanceRoot: join(root, 'governance'),
        runRoot: join(root, 'runs'),
        dshRevision: 'a'.repeat(40),
        maxAttemptsPerUtcDay: 1,
      }],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget,
      authorModel,
      calibrate: vi.fn(),
      modelIdentity: () => modelIdentity,
    })

    await expect(governance.ensure(subject))
      .rejects.toThrow('Candidate proposer cannot author its existing-Skill holdout')
    expect(budget.reserve).not.toHaveBeenCalled()
    expect(authorModel).not.toHaveBeenCalled()
  })

  it('durably defers before authoring when the independent holdout budget is exhausted', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-budget-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const retryAt = 1_787_356_800_000
    const budget = {
      reserve: vi.fn(async () => ({
        allowed: false,
        newlyReserved: false,
        retryAt,
        snapshot: {
          targetId: 'workspace-existing-holdout',
          workspaceId: WORKSPACE_ID,
          skillName: subject.opportunity.skillName,
          utcDay: '2026-08-21',
          used: 1,
          limit: 1,
          remaining: 0,
        },
      })),
    }
    const authorModel = vi.fn()
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget,
      authorModel,
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(governance.ensure(subject)).resolves.toEqual({
      status: 'budget-deferred',
      retryAt,
      releaseAuthority: 'none',
    })
    await expect(governance.ensure(subject)).resolves.toEqual({
      status: 'budget-deferred',
      retryAt,
      releaseAuthority: 'none',
    })
    expect(budget.reserve).toHaveBeenCalledOnce()
    expect(authorModel).not.toHaveBeenCalled()
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{ phase: 'budget-deferred', modelCalls: 0, retryAt }],
    })
  })

  it('fails closed on calibration and never retries the paid holdout author blindly', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-calibration-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const authorModel = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => validAuthorResult(input))
    const calibrate = vi.fn(async () => ({
      status: 'not-calibrated' as const,
      reportPath: join(root, 'calibration-report.json'),
      reason: 'known-bad unexpectedly passed',
    }))
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate,
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(governance.ensure(subject)).rejects.toThrow('calibration failed closed')
    await expect(governance.ensure(subject)).rejects.toThrow('known-bad unexpectedly passed')
    expect(authorModel).toHaveBeenCalledOnce()
    expect(calibrate).toHaveBeenCalledOnce()
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{ phase: 'incomplete', modelCalls: 1, failure: 'holdout-calibration-failed' }],
    })
  })

  it('marks an unobserved paid holdout response uncertain across restart', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-restart-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const firstAuthor = vi.fn(async () => { throw new Error('connection reset before response') })
    const build = (authorModel: typeof firstAuthor) => new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(build(firstAuthor).ensure(subject)).rejects.toThrow('connection reset before response')
    const retryAuthor = vi.fn(async () => { throw new Error('must not run') })
    const restarted = build(retryAuthor)
    await expect(restarted.ensure(subject)).rejects.toThrow('refusing automatic retry')
    expect(firstAuthor).toHaveBeenCalledOnce()
    expect(retryAuthor).not.toHaveBeenCalled()
    await expect(restarted.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{ phase: 'uncertain', modelCalls: 1, failure: 'paid-authoring-uncertain' }],
    })
  })

  it('migrates a legacy pending Holdout state to uncertain without retrying the paid call', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-legacy-pending-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const deferred = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: {
        reserve: vi.fn(async () => ({
          ...allowedGovernanceReservation(),
          allowed: false as const,
          newlyReserved: false,
          retryAt: 1_787_356_800_000,
        })),
      },
      authorModel: vi.fn(),
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })
    await deferred.ensure(subject)
    const runRoot = join(root, 'runs', 'existing-skill-holdout-authoring', 'release-proof', 'runs')
    const [runId] = await readdir(runRoot)
    const statePath = join(runRoot, runId!, 'state.json')
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>
    state.phase = 'authoring-pending'
    state.cost = { modelCalls: 1, inputTokens: 0, outputTokens: 0 }
    delete state.retryAt
    delete state.reason
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
    const retryAuthor = vi.fn()
    const restarted = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel: retryAuthor,
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(restarted.ensure(subject)).rejects.toThrow('refusing automatic retry')
    expect(retryAuthor).not.toHaveBeenCalled()
    await expect(restarted.scan(WORKSPACE_ID)).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ phase: 'uncertain', modelCalls: 1, retentionIncluded: false }],
    })
  })

  it('does not retry an unobserved paid Retention author response across restart', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-retention-restart-')))
    roots.push(root)
    const subject = await retentionSubject()
    const firstAuthor = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => {
      if (input.role === 'retention') throw new Error('connection reset before Retention response')
      return validAuthorResult(input)
    })
    const build = (authorModel: typeof firstAuthor) => new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-evaluation/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(build(firstAuthor).ensure(subject)).rejects
      .toThrow('connection reset before Retention response')
    const retryAuthor = vi.fn(async (input: ExistingSkillHoldoutAuthorInput) => validAuthorResult(input))
    const restarted = build(retryAuthor)
    await expect(restarted.ensure(subject)).rejects.toThrow('refusing automatic retry')
    expect(firstAuthor).toHaveBeenCalledTimes(2)
    expect(retryAuthor).not.toHaveBeenCalled()
    await expect(restarted.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{
        phase: 'uncertain',
        modelCalls: 2,
        retentionIncluded: true,
        failure: 'paid-authoring-uncertain',
      }],
    })
  })

  it('records an observed invalid author response as incomplete without retrying it', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-existing-holdout-invalid-')))
    roots.push(root)
    const subject = await holdoutSubject()
    const authorModel = vi.fn(async () => ({
      knownCorrectionSkill: 'not-a-complete-skill',
      evaluatorSource: 'process.stdout.write("{}")',
      usage: { inputTokens: 11, outputTokens: 7 },
    }))
    const governance = new ExistingSkillHoldoutGovernance({
      policies: [holdoutPolicy(root)],
      evidence: { readForGovernance: vi.fn(async () => governedEvidence(subject)) },
      budget: { reserve: vi.fn(async () => allowedGovernanceReservation()) },
      authorModel,
      calibrate: vi.fn(),
      modelIdentity: () => 'independent-existing-holdout/model-v1',
      now: () => 1_787_270_400_000,
    })

    await expect(governance.ensure(subject)).rejects.toThrow('has no frontmatter')
    await expect(governance.ensure(subject)).rejects.toThrow('governance incomplete')
    expect(authorModel).toHaveBeenCalledOnce()
    await expect(governance.scan(WORKSPACE_ID)).resolves.toMatchObject({
      runs: [{
        phase: 'incomplete',
        modelCalls: 1,
        inputTokens: 11,
        outputTokens: 7,
        failure: 'governance-incomplete',
      }],
    })
  })
})

function holdoutPolicy(root: string) {
  return {
    id: 'workspace-existing-holdout',
    workspaceId: WORKSPACE_ID,
    governanceRoot: join(root, 'governance'),
    runRoot: join(root, 'runs'),
    dshRevision: 'a'.repeat(40),
    maxAttemptsPerUtcDay: 1,
  }
}

function allowedGovernanceReservation() {
  return {
    allowed: true,
    newlyReserved: true,
    snapshot: {
      targetId: 'workspace-existing-holdout',
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      utcDay: '2026-08-21',
      used: 1,
      limit: 1,
      remaining: 0,
    },
  }
}

function validAuthorResult(input: ExistingSkillHoldoutAuthorInput) {
  return {
    knownCorrectionSkill: [
      '---',
      `name: ${input.skillName}`,
      'description: Verify a release with independent evidence.',
      'license: MIT',
      '---',
      '',
      'Require independent evidence before declaring success.',
      '',
    ].join('\n'),
    evaluatorSource: `process.stdout.write(${JSON.stringify(JSON.stringify({
      schemaVersion: 1,
      passed: true,
      checks: [{ name: `${input.role}-independent-proof`, passed: true }],
      composition: { fingerprint: 'f'.repeat(64), modelCalls: 1, usage: {} },
    }))})\n`,
    usage: { inputTokens: 40, outputTokens: 20 },
  }
}

async function retentionSubject() {
  const subject = await holdoutSubject()
  const feedbackSignalIds = [...subject.opportunity.feedbackSignalIds, 'd'.repeat(64)]
  const goalIds = [...subject.opportunity.goalIds, 'goal-retention']
  return {
    ...subject,
    opportunity: {
      ...subject.opportunity,
      signalCount: 5,
      goalCount: 5,
      lastObservedAt: 5,
      feedbackSignalIds,
      goalIds,
    },
    qualification: {
      ...subject.qualification,
      evidence: {
        ...subject.qualification.evidence,
        feedbackSignalIds,
        goalIds,
        invocationCount: 5,
        goalCount: 5,
      },
    },
    evidence: {
      ...subject.evidence,
      retentionGoalCount: 1,
    },
  }
}

async function holdoutSubject() {
  const files = [
    {
      path: 'SKILL.md',
      mode: '100644' as const,
      content: Buffer.from([
        '---',
        'name: release-proof',
        'description: Verify a release.',
        'license: MIT',
        '---',
        '',
        'Follow [the guide](references/guide.md).',
        '',
      ].join('\n')),
    },
    {
      path: 'references/guide.md',
      mode: '100644' as const,
      content: Buffer.from('# Guide\n\nCheck the release.\n'),
    },
    {
      path: 'assets/proof.png',
      mode: '100644' as const,
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    },
  ]
  const archive = await assembleSealedSkillBundleArchive(files)
  const opportunity = {
    schemaVersion: 1 as const,
    id: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    skillName: 'release-proof',
    invocationContentHash: '2'.repeat(64),
    signalCount: 4,
    goalCount: 4,
    firstObservedAt: 1,
    lastObservedAt: 4,
    feedbackSignalIds: ['3'.repeat(64), '4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
    goalIds: ['goal-1', 'goal-2', 'goal-admission', 'goal-holdout'],
    evidence: {
      kind: 'internal-exact-skill-corrections-v1' as const,
      association: 'exact-durable-skill-invocation-content' as const,
      eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content' as const,
      referencesTruncated: false,
      causalClaim: 'none' as const,
    },
    status: 'waiting-for-baseline-bundle' as const,
    releaseAuthority: 'none' as const,
  }
  const qualification = {
    schemaVersion: 1 as const,
    kind: 'existing-skill-baseline-qualification-v1' as const,
    id: '7'.repeat(64),
    opportunityId: opportunity.id,
    workspaceId: WORKSPACE_ID,
    skillName: opportunity.skillName,
    invocationContentHash: opportunity.invocationContentHash,
    baseline: {
      id: '8'.repeat(64),
      provider: 'native-test-provider',
      source: '/sealed/provider/release-proof/SKILL.md',
      definitionDigest: '9'.repeat(64),
      artifactDigest: archive.artifactDigest,
      treeHash: archive.treeHash,
      fileCount: archive.files.length,
      totalBytes: archive.totalBytes,
    },
    evidence: {
      kind: 'exact-correction-invocation-baselines-v1' as const,
      feedbackSignalIds: opportunity.feedbackSignalIds,
      goalIds: opportunity.goalIds,
      invocationCount: 4,
      goalCount: 4,
    },
    status: 'eligible-for-existing-skill-authoring' as const,
    releaseAuthority: 'none' as const,
  }
  return {
    opportunity,
    qualification,
    baseline: {
      manifest: {
        schemaVersion: 1 as const,
        kind: 'installed-skill-baseline-v1' as const,
        id: qualification.baseline.id,
        workspaceId: WORKSPACE_ID,
        skillName: opportunity.skillName,
        invocationContentHash: opportunity.invocationContentHash,
        provider: qualification.baseline.provider,
        source: qualification.baseline.source,
        definitionDigest: qualification.baseline.definitionDigest,
        createdAt: 1,
        bundle: {
          format: 'tar.gz' as const,
          artifactDigest: archive.artifactDigest,
          treeHash: archive.treeHash,
          fileCount: archive.files.length,
          totalBytes: archive.totalBytes,
          hasExecutableFiles: false as const,
        },
        releaseAuthority: 'none' as const,
      },
      files: archive.files,
    },
    evidence: {
      id: 'a'.repeat(64),
      workspaceId: WORKSPACE_ID,
      opportunityId: opportunity.id,
      qualificationId: qualification.id,
      baselineId: qualification.baseline.id,
      skillName: opportunity.skillName,
      authoringCases: [],
      authoringGoalCount: 2,
      admissionGoalCount: 1,
      holdoutGoalCount: 1,
      retentionGoalCount: 0,
      authoringInputDigest: 'b'.repeat(64),
      proposerCanReadProtectedSamples: false as const,
      releaseAuthority: 'none' as const,
    },
    proposerModelIdentityHash: 'c'.repeat(64),
  }
}

function governedEvidence(subject: Awaited<ReturnType<typeof holdoutSubject>>) {
  const sample = (role: 'authoring' | 'admission' | 'holdout' | 'retention', suffix: string, note: string) => ({
    role,
    goal: { id: `goal-${suffix}`, revision: 1, objective: `Objective ${suffix}` },
    request: {
      text: `Request ${suffix}`,
      representation: 'durable-user-text-v1' as const,
      omittedNonText: false,
    },
    correction: { note, sourceUpdatedAt: Number.parseInt(suffix, 10) || 4 },
    source: {
      feedbackSignalId: (suffix === 'admission'
        ? '3'
        : suffix === 'holdout'
          ? '4'
          : suffix === 'retention'
            ? 'd'
            : suffix).repeat(64),
      sessionId: `session-${suffix}`,
      messageId: `message-${suffix}`,
      feedbackVersion: suffix === 'retention'
        ? '0198f4b4-b664-7000-8000-000000000005'
        : suffix === 'holdout'
        ? '0198f4b4-b664-7000-8000-000000000004'
        : suffix === 'admission'
          ? '0198f4b4-b664-7000-8000-000000000003'
          : `0198f4b4-b664-7000-8000-00000000000${suffix}`,
      assistantSeq: 5,
      invocationSeq: 4,
      route: 'model-tool' as const,
    },
  })
  return {
    schemaVersion: 1 as const,
    kind: 'existing-skill-evaluation-evidence-v1' as const,
    id: subject.evidence.id,
    workspaceId: WORKSPACE_ID,
    opportunity: {
      id: subject.opportunity.id,
      skillName: subject.opportunity.skillName,
      invocationContentHash: subject.opportunity.invocationContentHash,
      signalCount: 4,
      goalCount: 4,
      firstObservedAt: 1,
      lastObservedAt: 4,
    },
    qualification: { id: subject.qualification.id, baselineId: subject.baseline.manifest.id },
    selection: { selectedGoalCount: subject.opportunity.goalCount, omittedGoalCount: 0 },
    samples: [
      sample('authoring', '1', 'Author correction 1.'),
      sample('authoring', '2', 'Author correction 2.'),
      sample('admission', 'admission', 'Admission correction.'),
      sample('holdout', 'holdout', 'Do not let the author be the final reviewer.'),
      ...(subject.evidence.retentionGoalCount === 0
        ? []
        : [sample('retention', 'retention', 'Retention correction.')]),
    ],
    authoringInputDigest: subject.evidence.authoringInputDigest,
    releaseAuthority: 'none' as const,
  }
}
