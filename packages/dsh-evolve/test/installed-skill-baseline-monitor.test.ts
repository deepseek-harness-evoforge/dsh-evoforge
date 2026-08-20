import { Context } from '@deepseek-ai/cordis'
import { agentEvents, Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SkillRegistry, { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstalledSkillBaselineVault } from '../src/installed-skill-baseline.ts'
import { installInstalledSkillBaselineMonitor } from '../src/installed-skill-baseline-monitor.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('installed Skill baseline monitor', () => {
  it('seals only new native invocations and never reconstructs a historical baseline after resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-baseline-monitor-'))
    temporaryRoots.push(root)
    const skillRoot = join(root, 'skills', 'release-proof')
    const governanceRoot = join(root, 'governance')
    await mkdir(join(skillRoot, 'references'), { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), '# Release proof\n')
    await writeFile(join(skillRoot, 'references', 'checks.md'), '# Checks\n')

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => ({ id: WORKSPACE_ID })) },
    })
    ctx.skills.register({
      name: 'release-proof',
      description: 'Verify a DSH release.',
      source: 'project-dsh',
      provider: 'filesystem',
      resourceBase: { kind: 'directory', path: skillRoot },
      path: join(skillRoot, 'SKILL.md'),
      content: '# Release proof\n',
    })
    const definition = await ctx.skills.get('release-proof')
    if (definition === undefined) throw new Error('fixture Skill did not load')
    const invocationContent = [{ type: 'text' as const, text: renderSkillContent(definition) }]
    const vault = new InstalledSkillBaselineVault(
      [{ workspaceId: WORKSPACE_ID, governanceRoot }],
      ctx.skills,
    )
    const monitor = installInstalledSkillBaselineMonitor(ctx, vault)
    const agent = sessionAgent('session-monitored', [{
      type: 'user/message',
      seq: 0,
      time: 1,
      surfaceOp: 'append',
      data: {
        id: 'skill-injection',
        role: 'user',
        source: { kind: 'skill-invocation', name: 'release-proof', form: 'instructions' },
        content: invocationContent,
      },
    } as SessionEvent])
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })

    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    await monitor.flush()

    await expect(vault.resolveInvocation(WORKSPACE_ID, 'session-monitored', 0))
      .resolves.toBeUndefined()

    const current = agent.session.append('user/message', {
      id: MessageId('current-skill-injection'),
      role: 'user',
      source: { kind: 'skill-invocation', name: 'release-proof', form: 'instructions' },
      content: invocationContent,
    }, { surfaceOp: 'append' })
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 2, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    await monitor.flush()

    await expect(vault.resolveInvocation(WORKSPACE_ID, 'session-monitored', current.seq))
      .resolves.toMatchObject({
        reference: { route: 'user-explicit', skillName: 'release-proof' },
        manifest: { kind: 'installed-skill-baseline-v1', bundle: { fileCount: 2 } },
      })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })

  it('contains Workspace lookup failures so baseline evidence never blocks the Agent', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    Object.defineProperty(ctx, 'workspaceRegistry', {
      configurable: true,
      value: { resolveByPath: vi.fn(async () => { throw new Error('registry unavailable') }) },
    })
    const vault = new InstalledSkillBaselineVault([], ctx.skills)
    const monitor = installInstalledSkillBaselineMonitor(ctx, vault)
    const agent = sessionAgent('session-continues', [])

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )).resolves.toEqual({ kind: 'enter', messages: [] })

    await monitor.dispose()
    await ctx.fiber.dispose()
  })
})

function sessionAgent(id: string, events: SessionEvent[]): Agent {
  const sessionId = SessionId(id)
  const session = Session.create(sessionId, events, {
    version: 0,
    id: sessionId,
    createdAt: 1,
    cwd: '/repo',
  })
  return {
    ctx: new Context(),
    id: sessionId,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('not used') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}
