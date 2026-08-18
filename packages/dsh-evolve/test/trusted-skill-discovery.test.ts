import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import {
  TrustedSkillDiscovery,
  installTrustedSkillDiscoveryLoop,
  type DiscoveredSkillCandidate,
  type SkillDiscoveryStore,
} from '../src/trusted-skill-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('trusted whole-Skill discovery', () => {
  it('archives an exact Skill folder from an explicit local Git source without executing it', async () => {
    const repository = await gitRepository()
    const skillRoot = join(repository, 'skills', 'missing-release-skill')
    const executionMarker = join(repository, 'executed')
    await mkdir(join(skillRoot, 'scripts'), { recursive: true })
    await mkdir(join(skillRoot, 'references'), { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: missing-release-skill',
      'description: Publish a verified release.',
      '---',
      '',
      'Follow the release checks.',
      '',
    ].join('\n'))
    await writeFile(join(skillRoot, 'scripts', 'run.sh'), `#!/bin/sh\ntouch ${JSON.stringify(executionMarker)}\n`)
    await writeFile(join(skillRoot, 'references', 'checks.md'), 'Use the official release checklist.\n')
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-m', 'add trusted skill')
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([{
      id: 'local-curated',
      repository,
      skillsRoot: 'skills',
    }], store, { now: () => 1_786_896_100_000 })

    const result = await discovery.discover(gap())

    expect(result).toMatchObject({ status: 'candidate-found', candidateCount: 1 })
    expect(store.recordCandidate).toHaveBeenCalledOnce()
    const candidate = store.recordCandidate.mock.calls[0]?.[0]
    expect(candidate).toMatchObject({
      discoveredAt: 1_786_896_100_000,
      gapId: '5'.repeat(64),
      workspaceId: WORKSPACE_ID,
      requestedSkill: 'missing-release-skill',
      description: 'Publish a verified release.',
      source: {
        id: 'local-curated',
        kind: 'local-git',
        trust: 'explicit-deployer-config',
      },
      scope: 'workspace',
      version: {
        kind: 'git-tree',
        commit: expect.stringMatching(/^[a-f0-9]{40}$/),
        treeHash: expect.stringMatching(/^[a-f0-9]{40}$/),
      },
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      package: {
        path: 'skills/missing-release-skill',
        fileCount: 3,
        hasScripts: true,
        hasReferences: true,
      },
      permissions: {
        declared: false,
        executableContent: true,
        externalEffects: 'unknown',
      },
      safety: {
        status: 'quarantined',
        checks: [
          { name: 'git-object-integrity', status: 'passed' },
          { name: 'regular-files-only', status: 'passed' },
          { name: 'skill-identity', status: 'passed' },
          { name: 'effect-review', status: 'required' },
        ],
      },
      lifecycle: 'inactive',
      verification: 'unevaluated',
      execution: 'never',
    })
    expect(JSON.stringify(candidate)).not.toContain(repository)
    expect(JSON.stringify(candidate)).not.toContain('Follow the release checks')
    await expect(access(executionMarker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(store.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      gapId: '5'.repeat(64),
      status: 'candidate-found',
      candidateIds: [expect.stringMatching(/^[a-f0-9]{64}$/)],
      sources: [{ id: 'local-curated', status: 'candidate', revision: expect.stringMatching(/^[a-f0-9]{40}$/) }],
    }))
  })

  it('materializes the pinned whole-Skill candidate without following a newer source HEAD', async () => {
    const repository = await gitRepository()
    const skillRoot = join(repository, 'skills', 'missing-release-skill')
    await mkdir(join(skillRoot, 'scripts'), { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: missing-release-skill',
      'description: Publish the pinned release.',
      '---',
      '',
      'Pinned instructions.',
      '',
    ].join('\n'))
    await writeFile(join(skillRoot, 'scripts', 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-m', 'add pinned skill')
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([{
      id: 'local-curated',
      repository,
      skillsRoot: 'skills',
    }], store, { now: () => 1_786_896_100_000 })
    await discovery.discover(gap())
    const input = store.recordCandidate.mock.calls[0]?.[0]
    const id = discoveredCandidateId(input!)
    const candidate = { ...input, schemaVersion: 1 as const, id } as DiscoveredSkillCandidate

    await writeFile(join(skillRoot, 'SKILL.md'), 'new uncommitted source content\n')
    const materializationParent = await mkdtemp(join(tmpdir(), 'dsh-evolve-materialized-'))
    temporaryRoots.push(materializationParent)
    const materializedRoot = join(materializationParent, 'candidate')
    const resolved = await discovery.materialize(candidate, materializedRoot)

    expect(resolved).toEqual({
      candidateId: id,
      path: await realpath(materializedRoot),
      contentHash: input?.contentHash,
      treeHash: input?.version.treeHash,
      files: expect.arrayContaining([
        { path: 'SKILL.md', mode: '100644', size: expect.any(Number) },
        { path: 'scripts/run.sh', mode: '100755', size: expect.any(Number) },
      ]),
    })
    expect(await readFile(join(materializedRoot, 'SKILL.md'), 'utf8')).toContain('Pinned instructions.')
    expect((await stat(join(materializedRoot, 'scripts', 'run.sh'))).mode & 0o111).toBe(0)
  })

  it('refuses metadata drift and any materialization inside the trusted source repository', async () => {
    const repository = await gitRepository()
    const skillRoot = join(repository, 'skills', 'missing-release-skill')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: missing-release-skill',
      'description: Publish a verified release.',
      '---',
      '',
      'Follow the release checks.',
      '',
    ].join('\n'))
    await git(repository, 'add', '.')
    await git(repository, 'commit', '-m', 'add safe skill')
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([{
      id: 'local-curated', repository, skillsRoot: 'skills',
    }], store, { now: () => 1_786_896_100_000 })
    await discovery.discover(gap())
    const input = store.recordCandidate.mock.calls[0]![0]
    const candidate = {
      ...input,
      schemaVersion: 1 as const,
      id: discoveredCandidateId(input),
    } as DiscoveredSkillCandidate
    const outputParent = await mkdtemp(join(tmpdir(), 'dsh-evolve-materialized-'))
    temporaryRoots.push(outputParent)
    const driftedOutput = join(outputParent, 'drifted')

    await expect(discovery.materialize({
      ...candidate,
      package: { ...candidate.package, fileCount: candidate.package.fileCount + 1 },
    }, driftedOutput)).rejects.toThrow('package metadata does not match')
    await expect(access(driftedOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(discovery.materialize(candidate, join(repository, 'quarantine')))
      .rejects.toThrow('output and source repository must be separate')
  })

  it('abstains durably when no trusted source is configured', async () => {
    const store = fakeStore()
    const discovery = new TrustedSkillDiscovery([], store, { now: () => 1_786_896_100_000 })

    await expect(discovery.discover(gap())).resolves.toEqual({
      status: 'abstained',
      candidateCount: 0,
      reasons: ['no-trusted-sources'],
    })
    expect(store.recordCandidate).not.toHaveBeenCalled()
    expect(store.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      status: 'abstained',
      candidateIds: [],
      reasons: ['no-trusted-sources'],
      sources: [],
    }))
  })

  it('resumes durable gaps and accepts new observations without a timer', async () => {
    const ctx = new Context()
    const existing = gap()
    const next = { ...gap(), id: '7'.repeat(64), requestedSkill: 'another-missing-skill' }
    const discovery = { discover: vi.fn(async () => ({ status: 'abstained' as const, candidateCount: 0 })) }
    const loop = installTrustedSkillDiscoveryLoop(ctx, { list: () => [existing] }, discovery)

    await loop.flush()
    expect(discovery.discover).toHaveBeenCalledWith(existing)
    loop.observe(next)
    await loop.flush()
    expect(discovery.discover).toHaveBeenCalledWith(next)
    expect(discovery.discover).toHaveBeenCalledTimes(2)

    await loop.dispose()
    await ctx.fiber.dispose()
  })
})

function fakeStore() {
  return {
    recordCandidate: vi.fn<SkillDiscoveryStore['recordCandidate']>(async input => ({
      created: true,
      candidate: { ...input, schemaVersion: 1, id: discoveredCandidateId(input) } as never,
    })),
    recordAttempt: vi.fn<SkillDiscoveryStore['recordAttempt']>(async input => ({
      created: true,
      attempt: { ...input, schemaVersion: 1, id: 'd'.repeat(64) } as never,
    })),
    listCandidates: vi.fn(() => []),
    listAttempts: vi.fn(() => []),
    close: vi.fn(),
  }
}

function discoveredCandidateId(input: Parameters<SkillDiscoveryStore['recordCandidate']>[0]): string {
  return createHash('sha256').update(JSON.stringify([
    input.workspaceId,
    input.gapId,
    input.source.id,
    input.version.commit,
    input.version.treeHash,
    input.contentHash,
  ])).digest('hex')
}

function gap(): CapabilityGap {
  return {
    schemaVersion: 1,
    id: '5'.repeat(64),
    observedAt: 1_786_896_000_000,
    workspaceId: WORKSPACE_ID,
    sessionId: 'session-1',
    requestedSkill: 'missing-release-skill',
    catalogHash: '6'.repeat(64),
    catalogSize: 3,
    goal: {
      id: 'goal-1',
      revision: 3,
      objective: 'Publish a verified native DSH plugin.',
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

async function gitRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-trusted-discovery-'))
  temporaryRoots.push(root)
  await git(root, 'init')
  await git(root, 'config', 'user.email', 'test@example.com')
  await git(root, 'config', 'user.name', 'EvoForge Test')
  return root
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile('git', ['-C', repository, ...args])
}
