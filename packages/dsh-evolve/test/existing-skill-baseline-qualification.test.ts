import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExistingSkillBaselineQualification } from '../src/existing-skill-baseline-qualification.ts'
import type { FeedbackSignal } from '../src/feedback-signal-monitor.ts'
import { InstalledSkillBaselineVault } from '../src/installed-skill-baseline.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../src/skill-opportunity-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('existing Skill baseline qualification', () => {
  it('qualifies corrections from distinct Goals only when every exact invocation resolves to one Bundle', async () => {
    const { ctx, invocationContent, vault } = await fixture()
    const first = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-a',
      invocationSeq: 12,
      route: 'model-tool',
      skillName: 'release-proof',
      invocationContent,
    })
    const second = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-b',
      invocationSeq: 18,
      route: 'user-explicit',
      skillName: 'release-proof',
      invocationContent,
    })
    if (first.status !== 'sealed' || second.status !== 'sealed') {
      throw new Error('fixture baselines were not sealed')
    }
    expect(second.baseline.id).toBe(first.baseline.id)

    const signals = [
      correction('1', 'session-a', 12, 'model-tool', 'goal-a', 100, first.baseline.invocationContentHash),
      correction('2', 'session-b', 18, 'user-explicit', 'goal-b', 200, first.baseline.invocationContentHash),
    ]
    const { opportunity, qualification } = improvementFixture(signals, vault)

    await expect(qualification.qualify(opportunity)).resolves.toMatchObject({
      status: 'qualified',
      qualification: {
        schemaVersion: 1,
        kind: 'existing-skill-baseline-qualification-v1',
        id: expect.stringMatching(/^[a-f0-9]{64}$/u),
        opportunityId: opportunity.id,
        workspaceId: WORKSPACE_ID,
        skillName: 'release-proof',
        invocationContentHash: first.baseline.invocationContentHash,
        baseline: {
          id: first.baseline.id,
          provider: 'filesystem',
          source: 'project-dsh',
          artifactDigest: first.baseline.bundle.artifactDigest,
          treeHash: first.baseline.bundle.treeHash,
          fileCount: 2,
        },
        evidence: {
          kind: 'exact-correction-invocation-baselines-v1',
          feedbackSignalIds: ['1'.repeat(64), '2'.repeat(64)],
          goalIds: ['goal-a', 'goal-b'],
          invocationCount: 2,
          goalCount: 2,
        },
        status: 'eligible-for-existing-skill-authoring',
        releaseAuthority: 'none',
      },
      baseline: {
        manifest: { id: first.baseline.id },
        files: [{ path: 'references/checks.md' }, { path: 'SKILL.md' }],
      },
    })

    await ctx.fiber.dispose()
  })

  it('waits when any exact corrected invocation has no sealed baseline', async () => {
    const { ctx, invocationContent, vault } = await fixture()
    const first = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-a',
      invocationSeq: 12,
      route: 'model-tool',
      skillName: 'release-proof',
      invocationContent,
    })
    if (first.status !== 'sealed') throw new Error('fixture baseline was not sealed')
    const signals = [
      correction('1', 'session-a', 12, 'model-tool', 'goal-a', 100, first.baseline.invocationContentHash),
      correction('2', 'session-b', 18, 'user-explicit', 'goal-b', 200, first.baseline.invocationContentHash),
    ]
    const { opportunity, qualification } = improvementFixture(signals, vault)

    await expect(qualification.qualify(opportunity)).resolves.toEqual({
      status: 'waiting',
      reason: 'invocation-baseline-missing',
      observedInvocationCount: 2,
      releaseAuthority: 'none',
    })

    await ctx.fiber.dispose()
  })

  it('rejects equal rendered invocation content backed by conflicting Bundle trees', async () => {
    const { ctx, skillRoot, invocationContent, vault } = await fixture()
    const first = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-a',
      invocationSeq: 12,
      route: 'model-tool',
      skillName: 'release-proof',
      invocationContent,
    })
    await writeFile(
      join(skillRoot, 'references', 'checks.md'),
      '# Checks\n\nVerify install, reload, recovery, and removal.\n',
    )
    const second = await vault.capture({
      workspaceId: WORKSPACE_ID,
      sessionId: 'session-b',
      invocationSeq: 18,
      route: 'user-explicit',
      skillName: 'release-proof',
      invocationContent,
    })
    if (first.status !== 'sealed' || second.status !== 'sealed') {
      throw new Error('fixture baselines were not sealed')
    }
    expect(second.baseline.id).not.toBe(first.baseline.id)
    expect(second.baseline.invocationContentHash).toBe(first.baseline.invocationContentHash)
    const signals = [
      correction('1', 'session-a', 12, 'model-tool', 'goal-a', 100, first.baseline.invocationContentHash),
      correction('2', 'session-b', 18, 'user-explicit', 'goal-b', 200, first.baseline.invocationContentHash),
    ]
    const { opportunity, qualification } = improvementFixture(signals, vault)

    await expect(qualification.qualify(opportunity)).resolves.toEqual({
      status: 'invalid',
      reason: 'baseline-bundle-conflict',
      releaseAuthority: 'none',
    })

    await ctx.fiber.dispose()
  })
})

async function fixture(): Promise<{
  ctx: Context
  skillRoot: string
  invocationContent: readonly [{ readonly type: 'text'; readonly text: string }]
  vault: InstalledSkillBaselineVault
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-qualification-'))
  temporaryRoots.push(root)
  const skillRoot = join(root, 'skills', 'release-proof')
  await mkdir(join(skillRoot, 'references'), { recursive: true })
  await writeFile(join(skillRoot, 'SKILL.md'), '# Release proof\n\nUse references/checks.md.\n')
  await writeFile(join(skillRoot, 'references', 'checks.md'), '# Checks\n\nVerify install and removal.\n')

  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({
    name: 'release-proof',
    description: 'Verify a DSH release.',
    source: 'project-dsh',
    provider: 'filesystem',
    resourceBase: { kind: 'directory', path: skillRoot },
    path: join(skillRoot, 'SKILL.md'),
    content: '# Release proof\n\nUse references/checks.md.\n',
  })
  const definition = await ctx.skills.get('release-proof')
  if (definition === undefined) throw new Error('fixture Skill did not load')
  const invocationContent = [{ type: 'text' as const, text: renderSkillContent(definition) }] as const
  const vault = new InstalledSkillBaselineVault(
    [{ workspaceId: WORKSPACE_ID, governanceRoot: join(root, 'governance') }],
    ctx.skills,
    { now: () => 1_787_356_800_000 },
  )
  return { ctx, skillRoot, invocationContent, vault }
}

function improvementFixture(
  signals: readonly FeedbackSignal[],
  vault: InstalledSkillBaselineVault,
) {
  const feedback = { list: () => [...signals], get: (id: string) => signals.find(signal => signal.id === id) }
  const opportunities = new ExperienceDrivenSkillOpportunityDiscovery(
    { list: () => [] },
    { feedback },
  )
  const [opportunity] = opportunities.discoverImprovements(WORKSPACE_ID)
  if (opportunity === undefined) throw new Error('fixture opportunity was not discovered')
  return {
    opportunity,
    qualification: new ExistingSkillBaselineQualification(opportunities, feedback, vault),
  }
}

function correction(
  marker: string,
  sessionId: string,
  invocationSeq: number,
  route: 'model-tool' | 'user-explicit',
  goalId: string,
  sourceUpdatedAt: number,
  invocationContentHash: string,
): FeedbackSignal {
  return {
    schemaVersion: 2,
    id: marker.repeat(64),
    observedAt: sourceUpdatedAt,
    workspaceId: WORKSPACE_ID,
    sessionId,
    messageId: `message-${marker}`,
    feedbackVersion: `${marker.repeat(8)}-${marker.repeat(4)}-4${marker.repeat(3)}-8${marker.repeat(3)}-${marker.repeat(12)}`,
    sourceUpdatedAt,
    attribution: {
      kind: 'exact-skill-invocation-v1',
      skillName: 'release-proof',
      route,
      invocationSeq,
      invocationContentHash,
      assistantSeq: invocationSeq + 2,
      turn: 1,
      goal: { id: goalId, revision: 1 },
    },
  }
}
