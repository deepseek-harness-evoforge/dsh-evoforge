import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillCandidateRepository,
  skillCandidateId,
  type ExperienceSkillCandidateInput,
  type SkillCandidateStore,
} from '../src/skill-candidate-repository.ts'
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
        schemaVersion: 1 as const,
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
