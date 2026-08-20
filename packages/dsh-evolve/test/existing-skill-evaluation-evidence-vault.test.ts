import { Context } from '@deepseek-ai/cordis'
import type { MessageFeedbackListResult } from '@deepseek-ai/dsh-message-feedback'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExistingSkillBaselineQualification } from '../src/existing-skill-baseline-qualification.ts'
import { ExistingSkillEvaluationEvidenceVault } from '../src/existing-skill-evaluation-evidence-vault.ts'
import type { FeedbackSignal } from '../src/feedback-signal-monitor.ts'
import { InstalledSkillBaselineVault } from '../src/installed-skill-baseline.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from '../src/skill-opportunity-discovery.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Existing Skill Evaluation Evidence Vault', () => {
  it('seals exact corrections into authoring/admission/holdout before existing-Skill authoring', async () => {
    const fixture = await evidenceFixture()

    await expect(fixture.vault.readiness(fixture.opportunity)).resolves.toMatchObject({
      status: 'ready-to-seal',
      qualificationId: fixture.qualificationId,
      baselineId: fixture.baselineId,
      authoringGoalCount: 2,
      admissionGoalCount: 1,
      holdoutGoalCount: 1,
      retentionGoalCount: 0,
      proposerCanReadProtectedSamples: false,
      releaseAuthority: 'none',
    })
    const prepared = await fixture.vault.prepare(fixture.opportunity)
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared))

    expect(prepared).toMatchObject({
      status: 'ready',
      evidence: {
        id: expect.stringMatching(/^[a-f0-9]{64}$/u),
        opportunityId: fixture.opportunity.id,
        qualificationId: fixture.qualificationId,
        baselineId: fixture.baselineId,
        skillName: 'release-proof',
        authoringGoalCount: 2,
        admissionGoalCount: 1,
        holdoutGoalCount: 1,
        retentionGoalCount: 0,
        proposerCanReadProtectedSamples: false,
        releaseAuthority: 'none',
      },
    })
    expect(prepared.evidence.authoringCases).toHaveLength(2)

    const governed = await fixture.vault.readForGovernance(
      WORKSPACE_ID,
      fixture.opportunity.id,
      fixture.qualificationId,
      prepared.evidence.id,
    )
    expect(governed.samples.map(sample => sample.role).sort()).toEqual([
      'admission',
      'authoring',
      'authoring',
      'holdout',
    ])
    expect(new Set(governed.samples.map(sample => sample.goal.id)).size).toBe(4)
    const protectedNotes = governed.samples
      .filter(sample => sample.role !== 'authoring')
      .map(sample => sample.correction.note)
    const authoringJson = JSON.stringify(prepared.evidence)
    expect(protectedNotes.every(note => !authoringJson.includes(note))).toBe(true)
    expect(prepared.evidence.authoringCases.map(value => value.correction).sort())
      .toEqual(governed.samples
        .filter(sample => sample.role === 'authoring')
        .map(sample => sample.correction.note)
        .sort())
    await expect(fixture.vault.readiness(fixture.opportunity)).resolves.toMatchObject({
      status: 'sealed',
      evidenceId: prepared.evidence.id,
    })

    await fixture.ctx.fiber.dispose()
  })

  it('waits for four distinct Goals without reading correction bodies', async () => {
    const fixture = await evidenceFixture(2)

    await expect(fixture.vault.prepare(fixture.opportunity)).resolves.toEqual({
      status: 'abstained',
      reason: 'fewer-than-four-independent-goals',
      observedGoalCount: 2,
      requiredGoalCount: 4,
      releaseAuthority: 'none',
    })
    expect(fixture.messageFeedbackReads.count).toBe(0)

    await fixture.ctx.fiber.dispose()
  })

  it('fails closed when the current correction no longer matches its reference signal', async () => {
    const fixture = await evidenceFixture()
    const [first] = fixture.feedbackItems.get('session-1') ?? []
    if (first === undefined) throw new Error('fixture feedback missing')
    fixture.feedbackItems.set('session-1', [{ ...first, version: 'f'.repeat(64) as never }])

    await expect(fixture.vault.prepare(fixture.opportunity)).resolves.toEqual({
      status: 'abstained',
      reason: 'correction-evidence-drift',
      observedGoalCount: 4,
      requiredGoalCount: 4,
      releaseAuthority: 'none',
    })

    await fixture.ctx.fiber.dispose()
  })

  it('reserves a fifth distinct correction exclusively for retention governance', async () => {
    const fixture = await evidenceFixture(5)

    const prepared = await fixture.vault.prepare(fixture.opportunity)
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared))
    expect(prepared.evidence.retentionGoalCount).toBe(1)
    const governed = await fixture.vault.readForGovernance(
      WORKSPACE_ID,
      fixture.opportunity.id,
      fixture.qualificationId,
      prepared.evidence.id,
    )
    const retention = governed.samples.filter(sample => sample.role === 'retention')
    expect(retention).toHaveLength(1)
    expect(JSON.stringify(prepared.evidence)).not.toContain(retention[0]!.correction.note)

    await fixture.ctx.fiber.dispose()
  })

  it('rejects modified protected evidence before governance can consume it', async () => {
    const fixture = await evidenceFixture()
    const prepared = await fixture.vault.prepare(fixture.opportunity)
    if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared))
    const manifest = await fixture.vault.readForGovernance(
      WORKSPACE_ID,
      fixture.opportunity.id,
      fixture.qualificationId,
      prepared.evidence.id,
    )
    await writeFile(join(
      fixture.governanceRoot,
      'existing-skill-evidence',
      fixture.opportunity.id,
      fixture.qualificationId,
      prepared.evidence.id,
      'manifest.json',
    ), `${JSON.stringify({
      ...manifest,
      samples: manifest.samples.map((sample, index) => index === 0
        ? { ...sample, correction: { ...sample.correction, note: 'tampered correction' } }
        : sample),
    }, null, 2)}\n`)

    await expect(fixture.vault.readForGovernance(
      WORKSPACE_ID,
      fixture.opportunity.id,
      fixture.qualificationId,
      prepared.evidence.id,
    )).rejects.toThrow('existing-Skill evidence content identity mismatch')
    await expect(fixture.vault.readiness(fixture.opportunity)).resolves.toMatchObject({
      status: 'invalid',
      reason: 'sealed-evidence-invalid',
    })

    await fixture.ctx.fiber.dispose()
  })

  it('preserves an incomplete crash target as invalid instead of overwriting it', async () => {
    const fixture = await evidenceFixture()
    const ready = await fixture.vault.readiness(fixture.opportunity)
    if (ready.status !== 'ready-to-seal') throw new Error(JSON.stringify(ready))
    await mkdir(join(
      fixture.governanceRoot,
      'existing-skill-evidence',
      fixture.opportunity.id,
      fixture.qualificationId,
      ready.evidenceId,
    ), { recursive: true })

    await expect(fixture.vault.readiness(fixture.opportunity)).resolves.toMatchObject({
      status: 'invalid',
      reason: 'sealed-evidence-invalid',
    })
    await expect(fixture.vault.prepare(fixture.opportunity)).rejects.toMatchObject({ code: 'ENOENT' })

    await fixture.ctx.fiber.dispose()
  })
})

async function evidenceFixture(goalCount = 4) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-existing-evidence-')))
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
  const baselines = new InstalledSkillBaselineVault(
    [{ workspaceId: WORKSPACE_ID, governanceRoot: join(root, 'governance') }],
    ctx.skills,
    { now: () => 1_787_356_800_000 },
  )

  const signals: FeedbackSignal[] = []
  const sessions = new Map<string, SessionEvent[]>()
  const items = new Map<string, Extract<MessageFeedbackListResult, { ok: true }>['value']['items']>()
  let baselineId = ''
  for (const [index, marker] of Array.from({ length: goalCount }, (_, value) => String(value + 1)).entries()) {
    const sessionId = `session-${marker}`
    const goalId = `goal-${marker}`
    const sealed = await baselines.capture({
      workspaceId: WORKSPACE_ID,
      sessionId,
      invocationSeq: 3,
      route: 'model-tool',
      skillName: 'release-proof',
      invocationContent,
    })
    if (sealed.status !== 'sealed') throw new Error('fixture baseline was not sealed')
    baselineId ||= sealed.baseline.id
    expect(sealed.baseline.id).toBe(baselineId)
    const signal = correction(marker, sessionId, goalId, (index + 1) * 100, sealed.baseline.invocationContentHash)
    signals.push(signal)
    sessions.set(sessionId, sessionEvents(marker, goalId, invocationContent[0].text))
    items.set(sessionId, [{
      messageId: signal.messageId as never,
      rating: 'negative',
      note: `Correction ${marker}: preserve proof before release.`,
      version: signal.feedbackVersion as never,
      createdAt: signal.sourceUpdatedAt - 1,
      updatedAt: signal.sourceUpdatedAt,
    }])
  }

  const feedback = { list: () => [...signals] }
  const opportunities = new ExperienceDrivenSkillOpportunityDiscovery({ list: () => [] }, { feedback })
  const [opportunity] = opportunities.discoverImprovements(WORKSPACE_ID)
  if (opportunity === undefined) throw new Error('fixture opportunity was not discovered')
  const qualification = new ExistingSkillBaselineQualification(opportunities, feedback, baselines)
  const qualified = await qualification.qualify(opportunity)
  if (qualified.status !== 'qualified') throw new Error('fixture baseline was not qualified')

  const messageFeedbackReads = { count: 0 }
  const messageFeedback = {
    async list(request: { readonly sessionId: string }): Promise<MessageFeedbackListResult> {
      messageFeedbackReads.count += 1
      const found = items.get(String(request.sessionId))
      return found === undefined
        ? { ok: false, error: { code: 'session-not-found', sessionId: request.sessionId as never } }
        : { ok: true, value: { items: found } }
    },
  }
  const persistence: Pick<SessionPersistence, 'inspect'> = {
    async inspect(sessionId) {
      const found = sessions.get(String(sessionId))
      if (found === undefined) throw new Error('fixture Session not found')
      return {
        meta: { version: 0, id: SessionId(String(sessionId)), createdAt: 1, cwd: '/private/project' },
        events: found,
      }
    },
  }
  const vault = new ExistingSkillEvaluationEvidenceVault(
    [{
      id: 'workspace-governance',
      workspaceId: WORKSPACE_ID,
      governanceRoot: join(root, 'governance'),
      runRoot: join(root, 'runs'),
    }],
    qualification,
    feedback,
    messageFeedback,
    persistence,
  )
  return {
    ctx,
    opportunity,
    qualificationId: qualified.qualification.id,
    baselineId,
    governanceRoot: join(root, 'governance'),
    feedbackItems: items,
    messageFeedbackReads,
    vault,
  }
}

function correction(
  marker: string,
  sessionId: string,
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
      route: 'model-tool',
      invocationSeq: 3,
      invocationContentHash,
      assistantSeq: 5,
      turn: 1,
      goal: { id: goalId, revision: 1 },
    },
  }
}

function sessionEvents(marker: string, goalId: string, invocationText: string): SessionEvent[] {
  return [
    event('goal/change', 0, {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      goal: {
        id: goalId,
        revision: 1,
        objective: `Release Goal ${marker} with durable proof.`,
        phase: 'active',
        maxGoalRounds: 8,
      },
      roundsStarted: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
    event('turn/start', 1, { turn: 1 }),
    event('user/message', 2, {
      id: `user-${marker}`,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: `Release request ${marker}.` }],
    }),
    event('tool/call', 3, {
      turn: 1,
      step: 1,
      callId: `call-${marker}`,
      name: 'skill',
      arguments: '{"name":"release-proof"}',
    }),
    {
      ...event('tool/result', 4, {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          source: { type: 'tool-result', callId: `call-${marker}` },
          content: [{
            type: 'tool-result',
            toolCallId: `call-${marker}`,
            content: [{ type: 'text', text: invocationText }],
            isError: false,
          }],
        },
      }),
      sourceEventSeqs: [3],
    },
    event('assistant/message', 5, {
      turn: 1,
      step: 2,
      message: {
        id: `message-${marker}`,
        role: 'assistant',
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        content: [{ type: 'text', text: `Released ${marker}.` }],
      },
    }),
  ] as SessionEvent[]
}

function event(type: string, seq: number, data: unknown): Record<string, unknown> {
  return { type, seq, time: seq + 1, data }
}
