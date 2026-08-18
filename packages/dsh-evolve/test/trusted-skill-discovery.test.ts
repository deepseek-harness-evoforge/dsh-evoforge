import { execFile as execFileCallback } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CapabilityGap } from '../src/capability-gap-store.ts'
import {
  TrustedSkillDiscovery,
  installTrustedSkillDiscoveryLoop,
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
      candidate: { ...input, schemaVersion: 1, id: 'c'.repeat(64) } as never,
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
