import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FeedbackShadowLauncher,
  type FeedbackShadowTargetConfig,
} from '../src/feedback-shadow-launcher.ts'
import { saveShadowRunState } from '../src/shadow-run-state.ts'
import { hashTree } from '../src/hash.ts'
import { WORKSPACE_ID, runRoot as ownedRunRoot } from './workspace-fixture.ts'

const signalId = '1'.repeat(64)
const draftId = '2'.repeat(64)
const generationId = '3'.repeat(64)
const artifact = {
  kind: 'skill' as const,
  name: 'build-dsh-plugin',
  gitCommit: '4'.repeat(40),
  treeHash: '5'.repeat(40),
}
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('FeedbackShadowLauncher', () => {
  it('submits one explicit target-bound paid Shadow as an unowned native Job', async () => {
    const fixture = await setup()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const runner = vi.fn(async (invocation) => {
      await pending
      return { status: 'complete' as const, reportPath: join(invocation.outputDir, 'report.json'), summary: 'promote' }
    })
    const jobs = fakeJobs()
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner,
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)

    const first = await launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)
    const duplicate = await launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)

    expect(first).toMatchObject({
      schemaVersion: 1,
      action: 'start-shadow',
      workspaceId: WORKSPACE_ID,
      targetId: fixture.target.id,
      skillName: artifact.name,
      runStatus: 'scheduled',
      jobId: 'evolution-1',
    })
    expect(first.launchId).toMatch(/^[a-f0-9]{64}$/)
    expect(duplicate).toEqual(first)
    expect(jobs.starts).toHaveLength(1)
    expect(jobs.starts[0]).not.toHaveProperty('owner')
    expect(runner).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      skillDir: fixture.skillDir,
      casePackDir: await realpath(fixture.casePackDir),
      feedbackDraftPath: fixture.draftPath,
      feedbackLaunchMode: 'human',
      outputDir: join(await realpath(fixture.runRoot), first.launchId),
      resume: false,
    }))
    expect(fixture.drafts.create).toHaveBeenCalledWith(WORKSPACE_ID, signalId)
    expect(fixture.source.resolveArtifact).toHaveBeenCalledWith(artifact.name, artifact)
    await expect(launcher.automaticInflightStatus(
      WORKSPACE_ID,
      artifact.name,
      '9'.repeat(64),
    )).resolves.toBe('busy')

    release()
    await jobs.hooks[0]!.done
  })

  it('refuses a Shadow target that disagrees with the durably attributed Skill', async () => {
    const fixture = await setup()
    const attributed = await fixture.drafts.create()
    fixture.drafts.create.mockReset()
    fixture.drafts.create.mockResolvedValue({
      ...attributed,
      draft: {
        ...attributed.draft,
        target: { ...attributed.draft.target, name: 'different-skill' },
      },
    })
    const jobs = fakeJobs()
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner: vi.fn(),
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)

    await expect(launcher.launch(WORKSPACE_ID, signalId, fixture.target.id))
      .rejects.toThrow('durably attributed feedback Skill does not match the authorized Shadow target')
    expect(fixture.source.resolveArtifact).not.toHaveBeenCalled()
    expect(jobs.starts).toEqual([])
  })

  it('reuses terminal durable evidence without starting or paying twice', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const runner = vi.fn(async (invocation) => {
      await mkdir(invocation.outputDir)
      const now = '2026-08-16T00:00:00.000Z'
      await saveShadowRunState(invocation.outputDir, {
        schemaVersion: 1,
        runId: invocation.outputDir.split('/').at(-1)!,
        phase: 'complete',
        startedAt: now,
        updatedAt: now,
        identity: {
          workspaceId: WORKSPACE_ID,
          baseTreeHash: artifact.treeHash,
          casePackHash: '6'.repeat(64),
          dshRevision: '7'.repeat(40),
          evaluatorVersion: 'fixture-v1',
          modelConfigHash: '8'.repeat(64),
          modelRoute: 'fixture',
          skillName: artifact.name,
          feedbackDraftId: draftId,
        },
        outcome: {
          kind: 'complete',
          reportPath: join(invocation.outputDir, 'report.json'),
          summary: 'promote',
        },
      })
      return { status: 'complete' as const, reportPath: join(invocation.outputDir, 'report.json'), summary: 'promote' }
    })
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner,
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)

    const first = await launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)
    await jobs.hooks[0]!.done
    const second = await launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)

    expect(second).toEqual({
      schemaVersion: 1,
      action: 'start-shadow',
      workspaceId: WORKSPACE_ID,
      launchId: first.launchId,
      targetId: fixture.target.id,
      skillName: artifact.name,
      runStatus: 'complete',
    })
    expect(jobs.starts).toHaveLength(1)
    expect(runner).toHaveBeenCalledOnce()
    await expect(launcher.scan()).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ launchId: first.launchId, targetId: fixture.target.id, phase: 'complete' }],
    })
  })

  it('finds every nonterminal same-Skill run before another automatic attempt', async () => {
    const fixture = await setup()
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner: vi.fn(),
      modelIdentity: () => 'fixed-route-v1',
    })
    const runId = 'a'.repeat(64)
    const runDir = join(fixture.runRoot, runId)
    await mkdir(runDir)
    const state = {
      schemaVersion: 1 as const,
      runId,
      phase: 'prepared' as const,
      startedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash: artifact.treeHash,
        casePackHash: '6'.repeat(64),
        dshRevision: '7'.repeat(40),
        evaluatorVersion: 'fixture-v1',
        modelConfigHash: '8'.repeat(64),
        modelRoute: 'fixture',
        skillName: artifact.name,
        feedbackDraftId: draftId,
      },
      feedbackSignalId: signalId,
    }
    await saveShadowRunState(runDir, state)

    await expect(launcher.automaticInflightStatus(WORKSPACE_ID, artifact.name, '9'.repeat(64)))
      .resolves.toBe('busy')
    await expect(launcher.automaticInflightStatus(WORKSPACE_ID, artifact.name, signalId))
      .resolves.toBe('clear')
    expect((await launcher.scan()).runs[0]).not.toHaveProperty('feedbackSignalId')
    await expect(launcher.automaticInflightStatus(WORKSPACE_ID, 'unconfigured-skill', signalId))
      .resolves.toBe('clear')

    await saveShadowRunState(runDir, {
      ...state,
      phase: 'candidate-ready',
      updatedAt: '2026-08-17T00:00:30.000Z',
    })
    await expect(launcher.automaticInflightStatus(WORKSPACE_ID, artifact.name, signalId))
      .resolves.toBe('busy')

    await saveShadowRunState(runDir, {
      ...state,
      phase: 'incomplete',
      updatedAt: '2026-08-17T00:01:00.000Z',
      outcome: {
        kind: 'incomplete',
        reportPath: join(runDir, 'report.json'),
        reason: 'terminal fixture failure',
      },
    })
    await expect(launcher.automaticInflightStatus(WORKSPACE_ID, artifact.name, '9'.repeat(64)))
      .resolves.toBe('clear')
  })

  it('fails closed when a target is outside the configured supervisor roots or runtime seams are absent', async () => {
    const fixture = await setup()
    expect(() => new FeedbackShadowLauncher({
      targets: [{ ...fixture.target, runRoot: join(fixture.root, 'other-runs') }],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner: vi.fn(),
    })).toThrow('must use one configured supervisor run root')

    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => undefined,
      source: fixture.source,
      runner: vi.fn(),
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(fakeJobs().registry)
    await expect(launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)).rejects.toThrow('private Feedback Case Draft')
  })

  it('does not overwrite an orphaned launch directory without a durable journal', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner: vi.fn(async () => ({
        status: 'incomplete' as const,
        reportPath: join(fixture.runRoot, 'missing-report.json'),
        reason: 'fixture intentionally omitted a journal',
      })),
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)

    const first = await launcher.launch(WORKSPACE_ID, signalId, fixture.target.id)
    await jobs.hooks[0]!.done
    await mkdir(join(fixture.runRoot, first.launchId), { recursive: true })

    await expect(launcher.launch(WORKSPACE_ID, signalId, fixture.target.id))
      .rejects.toThrow('exists without a durable journal')
    expect(jobs.starts).toHaveLength(1)
  })

  it('launches an exact qualified Case Pack only through a predeclared monitored run target', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const runner = vi.fn(async (invocation) => {
      await mkdir(invocation.outputDir)
      const now = '2026-08-17T00:00:00.000Z'
      await saveShadowRunState(invocation.outputDir, {
        schemaVersion: 1,
        runId: invocation.outputDir.split('/').at(-1)!,
        phase: 'complete',
        startedAt: now,
        updatedAt: now,
        identity: {
          workspaceId: WORKSPACE_ID,
          baseTreeHash: artifact.treeHash,
          casePackHash: '6'.repeat(64),
          dshRevision: '7'.repeat(40),
          evaluatorVersion: 'qualified-fixture-v1',
          modelConfigHash: '8'.repeat(64),
          modelRoute: 'fixture',
          skillName: artifact.name,
          feedbackDraftId: draftId,
        },
        outcome: {
          kind: 'complete',
          reportPath: join(invocation.outputDir, 'report.json'),
          summary: 'review',
        },
      })
      return {
        status: 'complete' as const,
        reportPath: join(invocation.outputDir, 'report.json'),
        summary: 'review',
      }
    })
    const launcher = new FeedbackShadowLauncher({
      targets: [],
      monitoredTargets: [{
        id: fixture.target.id,
        workspaceId: WORKSPACE_ID,
        skill: fixture.target.skill,
        runRoot: fixture.target.runRoot,
      }],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner,
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)

    const exactTarget = { ...fixture.target, casePackHash: await hashTree(fixture.casePackDir) }
    const launched = await launcher.launchExact(signalId, exactTarget)
    const duplicate = await launcher.launchExact(signalId, exactTarget)
    expect(duplicate).toEqual(launched)
    expect(jobs.starts).toHaveLength(1)
    await jobs.hooks[0]!.done
    const terminal = await launcher.launchExact(signalId, exactTarget)

    expect(launched).toMatchObject({
      action: 'start-shadow',
      targetId: fixture.target.id,
      runStatus: 'scheduled',
    })
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      casePackDir: await realpath(fixture.casePackDir),
      outputDir: join(await realpath(fixture.runRoot), launched.launchId),
    }))
    expect(terminal).toMatchObject({ runStatus: 'complete' })
    expect(terminal).not.toHaveProperty('jobId')
    expect(runner).toHaveBeenCalledOnce()
    await expect(launcher.scan()).resolves.toMatchObject({
      warningCount: 0,
      runs: [{ launchId: launched.launchId, targetId: fixture.target.id }],
    })
    await expect(launcher.launchExact(signalId, {
      ...exactTarget,
      runRoot: join(fixture.root, 'unconfigured-run-root'),
    })).rejects.toThrow('does not match its configured run root')
    await expect(launcher.launchExact(signalId, {
      ...exactTarget,
      casePackHash: 'invalid',
    })).rejects.toThrow('hash must be a full 64-character id')
    await expect(launcher.launchExact(signalId, {
      ...exactTarget,
      casePackHash: 'f'.repeat(64),
    })).rejects.toThrow('does not match its qualified hash')
    expect(runner).toHaveBeenCalledOnce()
  })

  it('never restarts an automatic exact launch whose paid proposal outcome is uncertain', async () => {
    const fixture = await setup()
    const jobs = fakeJobs()
    const runner = vi.fn(async (invocation) => {
      await mkdir(invocation.outputDir)
      const now = '2026-08-17T00:00:00.000Z'
      await saveShadowRunState(invocation.outputDir, {
        schemaVersion: 1,
        runId: invocation.outputDir.split('/').at(-1)!,
        phase: 'proposal-pending',
        startedAt: now,
        updatedAt: now,
        identity: {
          workspaceId: WORKSPACE_ID,
          baseTreeHash: artifact.treeHash,
          casePackHash: await hashTree(fixture.casePackDir),
          dshRevision: '7'.repeat(40),
          evaluatorVersion: 'automatic-fixture-v1',
          modelConfigHash: '8'.repeat(64),
          modelRoute: 'fixture',
          skillName: artifact.name,
          feedbackDraftId: draftId,
        },
        proposalEffect: { id: '9'.repeat(64), requestedAt: now },
      })
      throw new Error('simulated lost paid proposal response')
    })
    const launcher = new FeedbackShadowLauncher({
      targets: [fixture.target],
      supervisorRunRoots: [ownedRunRoot(WORKSPACE_ID, fixture.runRoot)],
      drafts: () => fixture.drafts,
      source: fixture.source,
      runner,
      modelIdentity: () => 'fixed-route-v1',
    })
    launcher.attachJobs(jobs.registry)
    const exactTarget = { ...fixture.target, casePackHash: await hashTree(fixture.casePackDir) }

    const first = await launcher.launchAutomaticExact(signalId, exactTarget)
    await jobs.hooks[0]!.done
    const uncertain = await launcher.launchAutomaticExact(signalId, exactTarget)

    expect(uncertain).toEqual({
      schemaVersion: 1,
      action: 'start-shadow',
      workspaceId: WORKSPACE_ID,
      launchId: first.launchId,
      targetId: fixture.target.id,
      skillName: artifact.name,
      runStatus: 'proposal-pending',
    })
    expect(jobs.starts).toHaveLength(1)
    expect(runner).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      feedbackLaunchMode: 'automatic',
    }))
  })
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-feedback-shadow-'))
  temporaryRoots.push(root)
  const runRoot = join(root, 'runs')
  const casePackDir = join(root, 'case-pack')
  const skillDir = join(root, 'skill')
  const draftPath = join(root, 'draft.json')
  await Promise.all([mkdir(runRoot), mkdir(casePackDir), mkdir(skillDir)])
  const target: FeedbackShadowTargetConfig = {
    id: 'plugin-delivery',
    workspaceId: WORKSPACE_ID,
    skill: artifact.name,
    casePackDir,
    runRoot,
  }
  const drafts = {
    create: vi.fn(async () => ({
      created: true,
      path: draftPath,
      draft: {
        schemaVersion: 2 as const,
        id: draftId,
        status: 'draft' as const,
        source: {
          workspaceId: WORKSPACE_ID,
          signalId,
          sessionId: 'session-1',
          messageId: 'message-1',
          feedbackVersion: '00000000-0000-4000-8000-000000000001',
          generationId,
          assistantSeq: 10,
          turn: 1,
          prefixHash: '9'.repeat(64),
        },
        target: { kind: 'skill' as const, name: artifact.name, artifact, contentHash: 'a'.repeat(64) },
        sample: { userText: 'private', correction: 'private' },
        limitations: ['private'],
      },
    })),
  }
  const source = {
    resolveArtifact: vi.fn(async () => ({ artifact, repository: root, path: 'skill', resourceBase: skillDir })),
  }
  return { root, runRoot, casePackDir, skillDir, draftPath, target, drafts, source }
}

function fakeJobs() {
  const starts: JobStart[] = []
  const hooks: JobHooks[] = []
  return {
    starts,
    hooks,
    registry: {
      start(spec: JobStart) {
        starts.push(spec)
        hooks.push(spec.run())
        return `evolution-${starts.length}`
      },
    } as never,
  }
}
