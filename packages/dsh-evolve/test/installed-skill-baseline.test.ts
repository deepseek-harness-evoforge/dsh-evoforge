import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InstalledSkillBaselineVault } from '../src/installed-skill-baseline.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Installed Skill Baseline Vault', () => {
  it('seals the complete exact directory Bundle behind one durable Skill invocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-installed-baseline-'))
    temporaryRoots.push(root)
    const skillRoot = join(root, 'skills', 'release-proof')
    const governanceRoot = join(root, 'governance')
    await mkdir(join(skillRoot, 'references'), { recursive: true })
    const skillMd = [
      '---',
      'name: release-proof',
      'description: Verify a DSH release.',
      '---',
      '',
      '# Release proof',
      '',
      'Use the [verification contract](references/verification.md).',
      '',
    ].join('\n')
    await writeFile(join(skillRoot, 'SKILL.md'), skillMd)
    await writeFile(
      join(skillRoot, 'references', 'verification.md'),
      '# Verification\n\nRequire clean-profile install and removal.\n',
    )
    await writeFile(join(skillRoot, 'asset.bin'), Buffer.from([0, 1, 2, 255]))

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({
      name: 'release-proof',
      description: 'Verify a DSH release.',
      source: 'project-dsh',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: skillRoot },
      path: join(skillRoot, 'SKILL.md'),
      content: [
        '# Release proof',
        '',
        'Use the [verification contract](references/verification.md).',
        '',
      ].join('\n'),
    })
    const definition = await ctx.skills.get('release-proof')
    if (definition === undefined) throw new Error('fixture Skill did not load')
    const invocationContent = [{ type: 'text' as const, text: renderSkillContent(definition) }]
    const vault = new InstalledSkillBaselineVault(
      [{ workspaceId: WORKSPACE_ID, governanceRoot }],
      ctx.skills,
      { now: () => 1_787_356_800_000 },
    )

    const captured = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-existing-skill',
      invocationSeq: 17,
      route: 'model-tool',
      skillName: 'release-proof',
      invocationContent,
    })

    expect(captured).toMatchObject({
      status: 'sealed',
      baseline: {
        schemaVersion: 1,
        kind: 'installed-skill-baseline-v1',
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        provider: 'filesystem',
        source: 'project-dsh',
        createdAt: 1_787_356_800_000,
        bundle: { fileCount: 3, hasExecutableFiles: false },
        releaseAuthority: 'none',
      },
    })
    if (captured.status !== 'sealed') throw new Error('fixture baseline was not sealed')
    expect(captured.baseline.id).toMatch(/^[a-f0-9]{64}$/u)
    expect(captured.baseline.invocationContentHash).toMatch(/^[a-f0-9]{64}$/u)

    await expect(vault.resolveInvocation(
      WORKSPACE_ID,
      'session-existing-skill',
      17,
    )).resolves.toMatchObject({
      manifest: { id: captured.baseline.id },
      files: [
        { path: 'asset.bin' },
        { path: 'references/verification.md' },
        { path: 'SKILL.md' },
      ],
    })
    await expect(vault.resolveBaseline(
      WORKSPACE_ID,
      captured.baseline.id,
    )).resolves.toMatchObject({
      manifest: { id: captured.baseline.id },
      files: [
        { path: 'asset.bin' },
        { path: 'references/verification.md' },
        { path: 'SKILL.md' },
      ],
    })

    await writeFile(
      join(governanceRoot, 'installed-skill-baselines', 'bundles', captured.baseline.id, 'bundle.tar.gz'),
      'tampered',
    )
    await expect(vault.resolveInvocation(WORKSPACE_ID, 'session-existing-skill', 17))
      .rejects.toThrow(/archive digest/u)

    await ctx.fiber.dispose()
  })

  it('abstains instead of guessing a flat Markdown file is a complete package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-flat-baseline-'))
    temporaryRoots.push(root)
    const skillPath = join(root, 'flat-skill.md')
    await writeFile(skillPath, '# Flat Skill\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({
      name: 'flat-skill',
      description: 'A flat Skill without an independent package boundary.',
      source: 'project-dsh',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: root },
      path: skillPath,
      content: '# Flat Skill\n',
    })
    const definition = await ctx.skills.get('flat-skill')
    if (definition === undefined) throw new Error('fixture Skill did not load')
    const vault = new InstalledSkillBaselineVault(
      [{ workspaceId: WORKSPACE_ID, governanceRoot: join(root, 'governance') }],
      ctx.skills,
    )

    await expect(vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-flat-skill',
      invocationSeq: 1,
      route: 'user-explicit',
      skillName: 'flat-skill',
      invocationContent: [{ type: 'text', text: renderSkillContent(definition) }],
    })).resolves.toEqual({
      status: 'abstained',
      reason: 'flat-skill-no-package-boundary',
    })
    await ctx.fiber.dispose()
  })

  it('abstains when an installed directory package contains a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-linked-baseline-'))
    temporaryRoots.push(root)
    const skillRoot = join(root, 'linked-skill')
    await mkdir(skillRoot)
    await writeFile(join(skillRoot, 'SKILL.md'), '# Linked Skill\n')
    await writeFile(join(root, 'outside.md'), '# Outside\n')
    await symlink(join(root, 'outside.md'), join(skillRoot, 'reference.md'))
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    ctx.skills.register({
      name: 'linked-skill',
      description: 'A Skill with an unsafe linked resource.',
      source: 'project-dsh',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: skillRoot },
      path: join(skillRoot, 'SKILL.md'),
      content: '# Linked Skill\n',
    })
    const definition = await ctx.skills.get('linked-skill')
    if (definition === undefined) throw new Error('fixture Skill did not load')
    const vault = new InstalledSkillBaselineVault(
      [{ workspaceId: WORKSPACE_ID, governanceRoot: join(root, 'governance') }],
      ctx.skills,
    )

    await expect(vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-linked-skill',
      invocationSeq: 2,
      route: 'model-tool',
      skillName: 'linked-skill',
      invocationContent: [{ type: 'text', text: renderSkillContent(definition) }],
    })).resolves.toEqual({ status: 'abstained', reason: 'unsafe-bundle' })
    await ctx.fiber.dispose()
  })
})
