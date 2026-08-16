import { execFile as execFileCallback } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidatePublisher } from '../src/candidate-publisher.js'
import { GitSkillSource } from '../src/git-skill-source.js'
import { sha256, hashTree } from '../src/hash.js'
import type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
} from '../src/generation-store.js'
import type { ReviewCandidate } from '../src/review-inbox.js'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (path) => {
    await makeWritable(path)
    await rm(path, { recursive: true, force: true })
  }))
})

describe('approved Candidate publisher', () => {
  it('previews the sealed Candidate against the exact Git baseline without publishing or moving user state', async () => {
    const fixture = await createFixture()
    const store = fakeStore()
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }])
    const publisher = new CandidatePublisher(store, source)

    const preview = await publisher.preview(fixture.candidate)

    expect(preview).toMatchObject({
      truncated: false,
      impact: {
        version: 'lexical-protected-effects-v1',
        scope: 'append-only-skill',
        indicators: [],
      },
    })
    expect(preview.patch).toBe([
      'diff --git a/SKILL.md b/SKILL.md',
      'index 689cbb5..9b95a64 100644',
      '--- a/SKILL.md',
      '+++ b/SKILL.md',
      '@@ -4,3 +4,4 @@ description: Stable fixture.',
      ' ---',
      ' ',
      ' # Stable Skill',
      '+Verify the real browser flow.',
      '',
    ].join('\n'))
    expect(preview.patch).not.toContain(fixture.root)
    expect(preview.shownBytes).toBe(Buffer.byteLength(preview.patch))
    expect(preview.totalBytes).toBe(preview.shownBytes)
    expect(store.publishGeneration).not.toHaveBeenCalled()
    expect(await git(fixture.repository, 'rev-parse', 'HEAD')).toBe(fixture.baseCommit)
    expect(await git(fixture.repository, 'status', '--porcelain')).toBe('')
    await expect(git(
      fixture.repository,
      'rev-parse',
      `refs/evoforge/generations/${fixture.candidate.id}`,
    )).rejects.toThrow()
  })

  it('bounds a large UTF-8 diff while reporting exact byte coverage', async () => {
    const fixture = await createFixture()
    const store = fakeStore()
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }])
    const proposed = `${fixture.baseline}\u001b[31m${'改'.repeat(8_000)}\n`
    const candidateTree = join(fixture.root, 'large-candidate')
    await cp(join(fixture.repository, 'skills', 'stable-skill'), candidateTree, { recursive: true })
    await writeFile(join(candidateTree, 'SKILL.md'), proposed)
    const proposal = {
      claim: 'Add a large verified instruction',
      files: [{ path: 'SKILL.md', content: proposed }],
    }
    const candidate = {
      ...fixture.candidate,
      claim: proposal.claim,
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      candidateTreeHash: await hashTree(candidateTree),
    }

    const preview = await new CandidatePublisher(store, source).preview(candidate)

    expect(preview.truncated).toBe(true)
    expect(preview.totalBytes).toBeGreaterThan(preview.shownBytes)
    expect(preview.shownBytes).toBeLessThanOrEqual(16 * 1024)
    expect(preview.shownBytes).toBeGreaterThan(15 * 1024)
    expect(Buffer.byteLength(preview.patch)).toBe(preview.shownBytes)
    expect(preview.patch).toContain('+\\x1b[31m改改改')
    expect(preview.patch).not.toContain('\u001b')
    expect(preview.patch).not.toContain('\uFFFD')
    expect(store.publishGeneration).not.toHaveBeenCalled()
  })

  it('escapes terminal controls in an otherwise untruncated diff', async () => {
    const fixture = await createFixture()
    const store = fakeStore()
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }])
    const proposed = `${fixture.baseline}\u001b[31mspoof\u202erender\n`
    const candidateTree = join(fixture.root, 'control-candidate')
    await cp(join(fixture.repository, 'skills', 'stable-skill'), candidateTree, { recursive: true })
    await writeFile(join(candidateTree, 'SKILL.md'), proposed)
    const proposal = {
      claim: 'Render controls safely',
      files: [{ path: 'SKILL.md', content: proposed }],
    }
    const candidate = {
      ...fixture.candidate,
      claim: proposal.claim,
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      candidateTreeHash: await hashTree(candidateTree),
    }

    const preview = await new CandidatePublisher(store, source).preview(candidate)

    expect(preview.truncated).toBe(false)
    expect(preview.patch).toContain('+\\x1b[31mspoof\\u202erender')
    expect(preview.patch).not.toContain('\u001b')
    expect(preview.patch).not.toContain('\u202e')
    expect(preview.shownBytes).toBe(Buffer.byteLength(preview.patch))
  })

  it('writes an immutable Git ref and inactive Generation without moving the user branch or worktree', async () => {
    const fixture = await createFixture()
    const store = fakeStore()
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }])
    const publisher = new CandidatePublisher(store, source)

    const first = await publisher.publish(fixture.candidate)
    const second = await publisher.publish(fixture.candidate)

    expect(second).toEqual(first)
    expect(store.publishGeneration).toHaveBeenCalledTimes(2)
    expect(await git(fixture.repository, 'rev-parse', 'HEAD')).toBe(fixture.baseCommit)
    expect(await git(fixture.repository, 'status', '--porcelain')).toBe('')
    expect(await git(
      fixture.repository,
      'show',
      `${first.artifacts[0]!.gitCommit}:skills/stable-skill/SKILL.md`,
    )).toContain('Verify the real browser flow.')
    expect(await git(
      fixture.repository,
      'rev-parse',
      `refs/evoforge/generations/${fixture.candidate.id}`,
    )).toBe(first.artifacts[0]!.gitCommit)
    expect(first).toMatchObject({
      evaluatorVersion: 'fixture-v1',
      policyVersion: 'human-review-v1',
      compositionFingerprint: fixture.candidate.compositionFingerprint,
      artifacts: [{ kind: 'skill', name: 'stable-skill' }],
    })
    expect(first).not.toHaveProperty('parentId')
    await expect(source.providerFor(first)).resolves.toBeDefined()
  })

  it('publishes a direct child of the active Generation and preserves unrelated artifacts', async () => {
    const fixture = await createFixture()
    const active = generation({
      id: '9'.repeat(64),
      artifacts: [
        {
          kind: 'skill',
          name: 'stable-skill',
          gitCommit: fixture.baseCommit,
          treeHash: fixture.baseGitTree,
        },
        {
          kind: 'skill',
          name: 'other-skill',
          gitCommit: fixture.baseCommit,
          treeHash: fixture.otherGitTree,
        },
      ],
    })
    const store = fakeStore(active)
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }, {
      name: 'other-skill',
      repository: fixture.repository,
      path: 'skills/other-skill',
    }])

    const published = await new CandidatePublisher(store, source).publish(fixture.candidate)

    expect(published.parentId).toBe(active.id)
    expect(published.artifacts[1]).toEqual(active.artifacts[1])
  })

  it('fails closed before writing Git objects when reviewed baseline evidence is stale', async () => {
    const fixture = await createFixture()
    const store = fakeStore()
    const source = new GitSkillSource(join(fixture.root, 'cache'), [{
      name: 'stable-skill',
      repository: fixture.repository,
      path: 'skills/stable-skill',
    }])
    const publisher = new CandidatePublisher(store, source)
    const stale = {
      ...fixture.candidate,
      baseTreeHash: '0'.repeat(64),
    }

    await expect(publisher.preview(stale))
      .rejects.toThrow('reviewed baseline does not match the exact Git Skill tree')
    await expect(publisher.publish(stale))
      .rejects.toThrow('reviewed baseline does not match the exact Git Skill tree')
    expect(store.publishGeneration).not.toHaveBeenCalled()
    await expect(git(
      fixture.repository,
      'rev-parse',
      `refs/evoforge/generations/${fixture.candidate.id}`,
    )).rejects.toThrow()
  })
})

async function createFixture(): Promise<{
  root: string
  repository: string
  baseCommit: string
  baseGitTree: string
  otherGitTree: string
  baseline: string
  candidate: ReviewCandidate
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-publisher-'))
  temporaryRoots.push(root)
  const repository = join(root, 'source')
  const skillDir = join(repository, 'skills', 'stable-skill')
  const otherDir = join(repository, 'skills', 'other-skill')
  await mkdir(skillDir, { recursive: true })
  await mkdir(otherDir, { recursive: true })
  const baseline = [
    '---',
    'name: stable-skill',
    'description: Stable fixture.',
    '---',
    '',
    '# Stable Skill',
    '',
  ].join('\n')
  const proposed = `${baseline}Verify the real browser flow.\n`
  await writeFile(join(skillDir, 'SKILL.md'), baseline)
  await writeFile(join(otherDir, 'SKILL.md'), [
    '---', 'name: other-skill', 'description: Other fixture.', '---', '', '# Other', '',
  ].join('\n'))
  await execFile('git', ['init', '-q', repository])
  await git(repository, 'config', 'user.name', 'Fixture')
  await git(repository, 'config', 'user.email', 'fixture@example.invalid')
  await git(repository, 'add', '.')
  await git(repository, 'commit', '-qm', 'base')
  const baseCommit = await git(repository, 'rev-parse', 'HEAD')
  const baseGitTree = await git(repository, 'rev-parse', 'HEAD:skills/stable-skill')
  const otherGitTree = await git(repository, 'rev-parse', 'HEAD:skills/other-skill')
  const candidateDir = join(root, 'candidate-tree')
  await cp(skillDir, candidateDir, { recursive: true })
  await writeFile(join(candidateDir, 'SKILL.md'), proposed)
  const proposal = {
    claim: 'Require exact browser verification',
    files: [{ path: 'SKILL.md', content: proposed }],
  }
  const reviewId = 'a'.repeat(64)
  const compositionFingerprint = 'c'.repeat(64)
  const candidate: ReviewCandidate = {
    id: reviewId,
    runId: 'b'.repeat(64),
    status: 'pending',
    outputDir: join(root, 'run'),
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: proposal.claim,
    changedFiles: ['SKILL.md'],
    candidateTreeHash: await hashTree(candidateDir),
    baseTreeHash: await hashTree(skillDir),
    proposalHash: sha256(JSON.stringify(proposal)),
    proposal,
    cases: [{ id: 'held-out', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 100, outputTokens: 30, trialCount: 4 },
    reasons: ['held-out pass'],
    limitations: ['fixture'],
    evaluatorVersion: 'fixture-v1',
    compositionFingerprint,
    compositionStable: false,
    startedAt: '2026-08-16T00:00:00.000Z',
    evidenceHash: 'd'.repeat(64),
  }
  return { root, repository, baseCommit, baseGitTree, otherGitTree, baseline, candidate }
}

function fakeStore(active?: CapabilityGeneration): EvolutionStore & {
  publishGeneration: ReturnType<typeof vi.fn>
} {
  const publishGeneration = vi.fn(async (input: GenerationInput) => {
    const value = generation({
      ...input,
      id: sha256(JSON.stringify({ schemaVersion: 1, ...input })),
    })
    return { created: true, generation: value }
  })
  return {
    publishGeneration,
    getGeneration: vi.fn(),
    getActiveGeneration: vi.fn(() => active),
    promoteGeneration: vi.fn(),
    rollbackGeneration: vi.fn(),
    pinSession: vi.fn(),
    fallbackSessionToNative: vi.fn(),
    getSessionGeneration: vi.fn(),
    close: vi.fn(),
  } as unknown as EvolutionStore & { publishGeneration: ReturnType<typeof vi.fn> }
}

function generation(input: Partial<CapabilityGeneration> & Pick<CapabilityGeneration, 'id'>): CapabilityGeneration {
  return {
    schemaVersion: 1,
    createdAt: 1_723_456_789_000,
    artifacts: [],
    evaluatorVersion: 'fixture-v1',
    policyVersion: 'fixture-policy',
    compositionFingerprint: 'f'.repeat(64),
    ...input,
  }
}

async function git(repository: string, ...args: string[]): Promise<string> {
  return (await execFile('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  })).stdout.trim()
}

async function makeWritable(root: string): Promise<void> {
  await chmod(root, 0o755).catch(() => undefined)
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await makeWritable(path)
    else await chmod(path, 0o644).catch(() => undefined)
  }
}
