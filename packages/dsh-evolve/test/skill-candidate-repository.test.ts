import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillCandidateRepository,
  existingSkillCandidateId,
  skillCandidateId,
  type ExistingSkillCandidateProposal,
  type ExistingSkillCandidateInput,
  type ExperienceSkillCandidateInput,
  type SkillCandidateStore,
} from '../src/skill-candidate-repository.ts'
import { assembleSealedSkillBundleArchive } from '../src/skill-bundle-archive.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('internal experience Skill Candidate repository', () => {
  it('quarantines and materializes only a content-addressed whole-Skill from one internal Opportunity', async () => {
    const recordCandidate = vi.fn(async (input: ExperienceSkillCandidateInput) => ({
      created: true,
      candidate: {
        schemaVersion: 2 as const,
        id: skillCandidateId(input),
        ...input,
      },
    }))
    const store = { recordCandidate } as Pick<SkillCandidateStore, 'recordCandidate'>
    const repository = new SkillCandidateRepository(store)
    const skillMd = [
      '---',
      'name: release-proof',
      'description: Reuse a verified release proof learned from repeated DSH Goals.',
      'license: MIT',
      '---',
      '',
      'Follow the [release proof](references/release-proof.md).',
      '',
    ].join('\n')
    const reference = '# Release proof\n\nRequire independent evidence before future-Session promotion.\n'

    const recorded = await repository.quarantine({
      createdAt: 1_787_100_000_000,
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      policyId: 'workspace-experience-author',
      opportunityId: '1'.repeat(64),
      gapIds: ['2'.repeat(64), '3'.repeat(64)],
      goalCount: 2,
      modelIdentity: 'private-provider-route',
      evaluationEvidenceId: '9'.repeat(64),
      inputDigest: '4'.repeat(64),
      files: [
        { path: 'SKILL.md', content: skillMd },
        { path: 'references/release-proof.md', content: reference },
      ],
    })

    expect(recordCandidate).toHaveBeenCalledOnce()
    const persisted = recordCandidate.mock.calls[0]![0]
    expect(persisted).toMatchObject({
      skillName: 'release-proof',
      opportunity: {
        kind: 'internal-experience-v1',
        id: '1'.repeat(64),
        gapIds: ['2'.repeat(64), '3'.repeat(64)],
        goalCount: 2,
      },
      authorship: {
        kind: 'bounded-model-authoring-v1',
        policyId: 'workspace-experience-author',
        modelIdentityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        evaluationEvidenceId: '9'.repeat(64),
        inputDigest: '4'.repeat(64),
      },
      version: {
        kind: 'experience-authored-bundle-v1',
        artifactDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        treeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
      safety: { status: 'quarantined' },
    })
    expect(JSON.stringify(persisted)).not.toMatch(/agent-skills|external-skill|local-git|research|source|match/iu)
    expect(JSON.stringify(recorded.candidate)).not.toContain('private-provider-route')

    const parent = await mkdtemp(join(tmpdir(), 'dsh-evolve-internal-candidate-'))
    temporaryRoots.push(parent)
    const output = join(await realpath(parent), 'candidate')
    await expect(repository.materialize(recorded.candidate, output)).resolves.toMatchObject({
      candidateId: recorded.candidate.id,
      path: output,
      files: [
        { path: 'references/release-proof.md', mode: '100644' },
        { path: 'SKILL.md', mode: '100644' },
      ],
    })
    await expect(readFile(join(output, 'SKILL.md'), 'utf8')).resolves.toBe(skillMd)
    expect((await stat(join(output, 'SKILL.md'))).mode & 0o777).toBe(0o600)
  })

  it('rejects a proposal that is not supported by two distinct Goal-linked gaps', async () => {
    const repository = new SkillCandidateRepository({ recordCandidate: vi.fn() })
    await expect(repository.quarantine({
      createdAt: 1,
      workspaceId: WORKSPACE_ID,
      skillName: 'release-proof',
      policyId: 'workspace-experience-author',
      opportunityId: '1'.repeat(64),
      gapIds: ['2'.repeat(64)],
      goalCount: 1,
      modelIdentity: 'private-provider-route',
      evaluationEvidenceId: '9'.repeat(64),
      inputDigest: '4'.repeat(64),
      files: [
        {
          path: 'SKILL.md',
          content: '---\nname: release-proof\ndescription: Reuse a release proof.\n---\n\n[Proof](references/proof.md)\n',
        },
        { path: 'references/proof.md', content: '# Proof\n' },
      ],
    })).rejects.toThrow('at least two distinct Goal-linked gaps')
  })
})

describe('existing Skill improvement Candidate repository', () => {
  it('inherits the complete sealed baseline while quarantining bounded instruction changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-candidate-'))
    temporaryRoots.push(root)
    const exactRoot = await realpath(root)
    const baselineBundle = await assembleSealedSkillBundleArchive([
      {
        path: 'SKILL.md',
        mode: '100644',
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
        mode: '100644',
        content: Buffer.from('# Guide\n\nCheck the release.\n'),
      },
      {
        path: 'assets/proof.png',
        mode: '100644',
        content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
      },
    ])
    const recordExistingCandidate = vi.fn(async (input: ExistingSkillCandidateInput) => ({
      created: true,
      candidate: {
        schemaVersion: 1 as const,
        id: existingSkillCandidateId(input),
        ...input,
      },
    }))
    const onExistingCandidate = vi.fn()
    const repository = new SkillCandidateRepository(
      { recordCandidate: vi.fn(), recordExistingCandidate },
      undefined,
      [{ workspaceId: WORKSPACE_ID, root: join(exactRoot, 'vault') }],
      onExistingCandidate,
    )

    const proposal = {
      createdAt: 1_787_100_000_000,
      policyId: 'workspace-experience-author',
      modelIdentity: 'private-provider-route',
      claim: 'Require independent evidence and preserve the existing proof asset.',
      opportunity: {
        schemaVersion: 1,
        id: '1'.repeat(64),
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        invocationContentHash: '2'.repeat(64),
        signalCount: 4,
        goalCount: 4,
        firstObservedAt: 1,
        lastObservedAt: 4,
        feedbackSignalIds: ['3'.repeat(64), '4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
        goalIds: ['goal-1', 'goal-2', 'goal-3', 'goal-4'],
        evidence: {
          kind: 'internal-exact-skill-corrections-v1',
          association: 'exact-durable-skill-invocation-content',
          eligibilityBasis: 'two-or-more-distinct-goals-same-invocation-content',
          referencesTruncated: false,
          causalClaim: 'none',
        },
        status: 'waiting-for-baseline-bundle',
        releaseAuthority: 'none',
      },
      qualification: {
        schemaVersion: 1,
        kind: 'existing-skill-baseline-qualification-v1',
        id: '7'.repeat(64),
        opportunityId: '1'.repeat(64),
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        invocationContentHash: '2'.repeat(64),
        baseline: {
          id: '8'.repeat(64),
          provider: 'native-test-provider',
          source: '/sealed/provider/release-proof/SKILL.md',
          definitionDigest: '9'.repeat(64),
          artifactDigest: baselineBundle.artifactDigest,
          treeHash: baselineBundle.treeHash,
          fileCount: baselineBundle.files.length,
          totalBytes: baselineBundle.totalBytes,
        },
        evidence: {
          kind: 'exact-correction-invocation-baselines-v1',
          feedbackSignalIds: ['3'.repeat(64), '4'.repeat(64), '5'.repeat(64), '6'.repeat(64)],
          goalIds: ['goal-1', 'goal-2', 'goal-3', 'goal-4'],
          invocationCount: 4,
          goalCount: 4,
        },
        status: 'eligible-for-existing-skill-authoring',
        releaseAuthority: 'none',
      },
      baseline: {
        reference: {
          schemaVersion: 1,
          kind: 'installed-skill-invocation-baseline-v1',
          workspaceId: WORKSPACE_ID,
          sessionId: 'session-1',
          invocationSeq: 2,
          route: 'model-tool',
          skillName: 'release-proof',
          invocationContentHash: '2'.repeat(64),
          baselineId: '8'.repeat(64),
        },
        manifest: {
          schemaVersion: 1,
          kind: 'installed-skill-baseline-v1',
          id: '8'.repeat(64),
          workspaceId: WORKSPACE_ID,
          skillName: 'release-proof',
          invocationContentHash: '2'.repeat(64),
          provider: 'native-test-provider',
          source: '/sealed/provider/release-proof/SKILL.md',
          definitionDigest: '9'.repeat(64),
          createdAt: 1,
          bundle: {
            format: 'tar.gz',
            artifactDigest: baselineBundle.artifactDigest,
            treeHash: baselineBundle.treeHash,
            fileCount: baselineBundle.files.length,
            totalBytes: baselineBundle.totalBytes,
            hasExecutableFiles: false,
          },
          releaseAuthority: 'none',
        },
        files: baselineBundle.files,
      },
      evidence: {
        id: 'a'.repeat(64),
        workspaceId: WORKSPACE_ID,
        opportunityId: '1'.repeat(64),
        qualificationId: '7'.repeat(64),
        baselineId: '8'.repeat(64),
        skillName: 'release-proof',
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
            correction: 'Do not trust the author as the final reviewer.',
          },
        ],
        authoringGoalCount: 2,
        admissionGoalCount: 1,
        holdoutGoalCount: 1,
        retentionGoalCount: 0,
        authoringInputDigest: 'b'.repeat(64),
        proposerCanReadProtectedSamples: false,
        releaseAuthority: 'none',
      },
      changes: [
        {
          path: 'SKILL.md',
          content: [
            '---',
            'name: release-proof',
            'description: Verify a release with independent evidence.',
            'license: MIT',
            '---',
            '',
            'Follow [the guide](references/guide.md).',
            '',
          ].join('\n'),
        },
        {
          path: 'references/guide.md',
          content: '# Guide\n\nRequire independent evidence before declaring success.\n',
        },
      ],
    } satisfies ExistingSkillCandidateProposal
    const recorded = await repository.quarantineExisting(proposal)
    expect(onExistingCandidate).toHaveBeenCalledWith(recorded.candidate)

    await expect(repository.quarantineExisting({
      ...proposal,
      changes: [{
        path: 'SKILL.md',
        content: [
          '---',
          'name: release-proof',
          'description: Verify a release with independent evidence.',
          'license: MIT',
          'allowed-tools: Bash',
          '---',
          '',
          'Follow [the guide](references/guide.md).',
          '',
        ].join('\n'),
      }],
    })).rejects.toThrow('permission declarations')

    await expect(repository.quarantineExisting({
      ...proposal,
      changes: [{
        path: 'SKILL.md',
        content: [
          '---',
          'name: release-proof',
          'description: Verify a release with independent evidence.',
          'license: Apache-2.0',
          '---',
          '',
          'Follow [the guide](references/guide.md).',
          '',
        ].join('\n'),
      }],
    })).rejects.toThrow('license declaration')

    expect(recordExistingCandidate).toHaveBeenCalledOnce()
    expect(recorded.candidate).toMatchObject({
      skillName: 'release-proof',
      opportunity: { kind: 'internal-existing-skill-correction-v1', id: '1'.repeat(64) },
      baseline: { qualificationId: '7'.repeat(64), id: '8'.repeat(64) },
      authorship: {
        kind: 'protected-correction-authoring-v1',
        evaluationEvidenceId: 'a'.repeat(64),
        inputDigest: 'b'.repeat(64),
      },
      diff: {
        kind: 'bounded-instruction-tree-diff-v1',
        changedPaths: ['references/guide.md', 'SKILL.md'],
        preservedFileCount: 1,
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
      releaseAuthority: 'none',
    })

    const output = join(exactRoot, 'materialized')
    const materialized = await repository.materializeExisting(recorded.candidate, output)
    expect(materialized.files).toEqual([
      { path: 'assets/proof.png', mode: '100644', size: 6 },
      { path: 'references/guide.md', mode: '100644', size: 64 },
      { path: 'SKILL.md', mode: '100644', size: 140 },
    ])
    await expect(readFile(join(output, 'assets/proof.png'))).resolves.toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
    )
  })
})
