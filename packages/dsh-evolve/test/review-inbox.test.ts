import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ReviewInbox as NativeReviewInbox,
  type AutomaticReviewExpiryPolicy,
} from '../src/review-inbox.js'
import { WORKSPACE_ID } from './workspace-fixture.ts'

interface FixtureReviewOptions {
  automaticReviewExpiry?: Array<Omit<AutomaticReviewExpiryPolicy, 'workspaceId'>>
  now?: () => number
}

class ReviewInbox extends NativeReviewInbox {
  constructor(runRoots: string[], options: FixtureReviewOptions = {}) {
    super(runRoots.map(path => ({ workspaceId: WORKSPACE_ID, path })), {
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.automaticReviewExpiry === undefined
        ? {}
        : {
            automaticReviewExpiry: options.automaticReviewExpiry.map(policy => ({
              ...policy,
              workspaceId: WORKSPACE_ID,
            })),
          }),
    })
  }
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Shadow review inbox', () => {
  it('lists only complete promote/review Candidates with compact evidence', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'promote-run', 'promote')
    await writeCandidateRun(root, 'review-run', 'review')
    await writeCandidateRun(root, 'reject-run', 'reject')
    await writeCandidateRun(root, 'incomplete-run', 'promote', 'incomplete')
    const outside = await createRoot()
    await writeCandidateRun(outside, 'outside-run', 'promote')
    await symlink(join(outside, 'outside-run'), join(root, 'linked-run'))

    const scan = await new ReviewInbox([root]).scan()

    expect(scan.warnings).toEqual([])
    expect(scan.candidates).toHaveLength(2)
    expect(scan.candidates.map(candidate => candidate.recommendation).sort())
      .toEqual(['promote', 'review'])
    expect(scan.candidates[0]).toMatchObject({
      status: 'pending',
      claim: 'Add exact browser verification',
      changedFiles: ['SKILL.md'],
      cases: [{ id: 'held-out-browser', baseline: 'fail', candidate: 'pass', passedChecks: 2, totalChecks: 2 }],
      cost: { inputTokens: 120, outputTokens: 32, trialCount: 4 },
      limitations: ['one deterministic final-test'],
    })
    expect(scan.candidates[0]?.id).toMatch(/^[a-f0-9]{64}$/)
  })

  it('isolates a malformed run and reports one bounded warning', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'valid', 'promote')
    const broken = join(root, 'broken')
    await mkdir(broken)
    await writeFile(join(broken, 'run-state.json'), '{')

    const scan = await new ReviewInbox([root]).scan()

    expect(scan.candidates).toHaveLength(1)
    expect(scan.warnings).toHaveLength(1)
    expect(scan.warnings[0]).toMatch(/broken: Shadow resume requires a readable run-state\.json/)
  })

  it('refuses to follow a run-state symlink outside the owned run directory', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const outsideRun = await writeCandidateRun(outside, 'outside', 'promote')
    const linkedRun = join(root, 'linked')
    await mkdir(linkedRun)
    await symlink(join(outsideRun, 'run-state.json'), join(linkedRun, 'run-state.json'))

    const scan = await new ReviewInbox([root]).scan()

    expect(scan.candidates).toEqual([])
    expect(scan.warnings).toEqual([
      'linked: run-state.json must be a regular owned file',
    ])
  })

  it('persists a rejection beside the owned run and removes it from pending review', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])
    const candidate = (await inbox.scan()).candidates[0]
    if (candidate === undefined) throw new Error('candidate missing')

    const rejected = await inbox.reject(candidate.id, 'too narrow for the shared Skill')

    expect(rejected).toMatchObject({
      id: candidate.id,
      status: 'rejected',
      decisionNote: 'too narrow for the shared Skill',
    })
    const durable = JSON.parse(await readFile(join(root, 'candidate', 'review-state.json'), 'utf8'))
    expect(durable).toMatchObject({
      schemaVersion: 2,
      workspaceId: WORKSPACE_ID,
      reviewId: candidate.id,
      status: 'rejected',
      decisionNote: 'too narrow for the shared Skill',
    })
    await expect(inbox.reject(candidate.id, 'replace the audit note')).resolves.toMatchObject({
      status: 'rejected',
      decisionNote: 'too narrow for the shared Skill',
    })
    expect((await new ReviewInbox([root]).scan()).candidates).toEqual([])
    expect((await new ReviewInbox([root]).scanAll()).candidates).toEqual([
      expect.objectContaining({ status: 'rejected', decisionActor: 'human' }),
    ])
  })

  it('projects actionable Candidate state as a fail-closed automatic inflight gate', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])

    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '1'.repeat(64)))
      .resolves.toBe('busy')
    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'unrelated-skill', '1'.repeat(64)))
      .resolves.toBe('clear')

    const candidate = (await inbox.scan()).candidates[0]!
    await inbox.reject(candidate.id, 'resolved before another automatic attempt')
    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '2'.repeat(64)))
      .resolves.toBe('clear')

    const broken = join(root, 'broken')
    await mkdir(broken)
    await writeFile(join(broken, 'run-state.json'), '{')
    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '2'.repeat(64)))
      .resolves.toBe('unknown')
  })

  it('durably expires only a stale ambiguous Candidate from automatic feedback', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'review', 'complete', {
      feedbackLaunchMode: 'automatic',
      updatedAt: '2026-08-16T00:00:00.000Z',
    })
    const inbox = new ReviewInbox([root], {
      automaticReviewExpiry: [{
        skillName: 'stable-skill',
        maxPendingReviewMs: 7 * 24 * 60 * 60 * 1_000,
      }],
      now: () => Date.parse('2026-08-23T00:00:00.000Z'),
    })

    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '2'.repeat(64)))
      .resolves.toBe('clear')
    expect((await inbox.scan()).candidates).toEqual([])
    expect((await inbox.scanAll()).candidates).toEqual([
      expect.objectContaining({
        status: 'rejected',
        decisionActor: 'auto-review-expiry-v1',
        decisionNote: 'automatic ambiguous review expired after 168 hours',
      }),
    ])
    expect(JSON.parse(await readFile(join(root, 'candidate', 'review-state.json'), 'utf8')))
      .toMatchObject({
        status: 'rejected',
        actor: 'auto-review-expiry-v1',
        decisionNote: 'automatic ambiguous review expired after 168 hours',
      })
    const restarted = new ReviewInbox([root], {
      automaticReviewExpiry: [{
        skillName: 'stable-skill',
        maxPendingReviewMs: 7 * 24 * 60 * 60 * 1_000,
      }],
      now: () => Date.parse('2026-08-24T00:00:00.000Z'),
    })
    await expect(restarted.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '3'.repeat(64)))
      .resolves.toBe('clear')
    expect((await restarted.scanAll()).candidates).toEqual([
      expect.objectContaining({ decisionActor: 'auto-review-expiry-v1' }),
    ])
  })

  it('projects the exact automatic review window without pretending that a timer disposes it', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'review', 'complete', {
      feedbackLaunchMode: 'automatic',
      updatedAt: '2026-08-16T00:00:00.000Z',
    })
    const policy = [{
      skillName: 'stable-skill',
      maxPendingReviewMs: 7 * 24 * 60 * 60 * 1_000,
    }]

    expect((await new ReviewInbox([root], {
      automaticReviewExpiry: policy,
      now: () => Date.parse('2026-08-22T00:00:00.000Z'),
    }).scan()).candidates).toEqual([
      expect.objectContaining({
        status: 'pending',
        automaticReviewExpiry: {
          eligibleAt: '2026-08-23T00:00:00.000Z',
          eligible: false,
          trigger: 'next-same-skill-automatic-signal',
        },
      }),
    ])

    expect((await new ReviewInbox([root], {
      automaticReviewExpiry: policy,
      now: () => Date.parse('2026-08-24T00:00:00.000Z'),
    }).scan()).candidates).toEqual([
      expect.objectContaining({
        status: 'pending',
        automaticReviewExpiry: {
          eligibleAt: '2026-08-23T00:00:00.000Z',
          eligible: true,
          trigger: 'next-same-skill-automatic-signal',
        },
      }),
    ])
  })

  it('never expires recent, promotable, or human-launched review work', async () => {
    for (const fixture of [
      { name: 'recent-auto-review', recommendation: 'review' as const, mode: 'automatic' as const,
        updatedAt: '2026-08-22T23:59:59.999Z' },
      { name: 'old-auto-promote', recommendation: 'promote' as const, mode: 'automatic' as const,
        updatedAt: '2026-08-01T00:00:00.000Z' },
      { name: 'old-human-review', recommendation: 'review' as const, mode: 'human' as const,
        updatedAt: '2026-08-01T00:00:00.000Z' },
    ]) {
      const root = await createRoot()
      await writeCandidateRun(root, fixture.name, fixture.recommendation, 'complete', {
        feedbackLaunchMode: fixture.mode,
        updatedAt: fixture.updatedAt,
      })
      const inbox = new ReviewInbox([root], {
        automaticReviewExpiry: [{
          skillName: 'stable-skill',
          maxPendingReviewMs: 7 * 24 * 60 * 60 * 1_000,
        }],
        now: () => Date.parse('2026-08-23T00:00:00.000Z'),
      })

      await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '2'.repeat(64)))
        .resolves.toBe('busy')
      const candidate = (await inbox.scanAll()).candidates[0]
      expect(candidate).toMatchObject({ status: 'pending' })
      if (fixture.name === 'recent-auto-review') {
        expect(candidate?.automaticReviewExpiry).toMatchObject({ eligible: false })
      } else {
        expect(candidate?.automaticReviewExpiry).toBeUndefined()
      }
    }
  })

  it('fails closed instead of expiring an invalid launch provenance', async () => {
    const root = await createRoot()
    const runDir = await writeCandidateRun(root, 'candidate', 'review', 'complete', {
      feedbackLaunchMode: 'automatic',
      updatedAt: '2026-08-01T00:00:00.000Z',
    })
    const state = JSON.parse(await readFile(join(runDir, 'run-state.json'), 'utf8'))
    state.feedbackLaunchMode = 'forged'
    await writeFile(join(runDir, 'run-state.json'), `${JSON.stringify(state)}\n`)
    const inbox = new ReviewInbox([root], {
      automaticReviewExpiry: [{
        skillName: 'stable-skill',
        maxPendingReviewMs: 7 * 24 * 60 * 60 * 1_000,
      }],
      now: () => Date.parse('2026-08-23T00:00:00.000Z'),
    })

    await expect(inbox.automaticInflightStatus(WORKSPACE_ID, 'stable-skill', '2'.repeat(64)))
      .resolves.toBe('unknown')
    await expect(readFile(join(runDir, 'review-state.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('publishes before durably approving and returns the inactive Generation id', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])
    const candidate = (await inbox.scan()).candidates[0]
    if (candidate === undefined) throw new Error('candidate missing')
    const calls: string[] = []

    const approved = await inbox.approve(candidate.id, 'evidence is sufficient', async (value) => {
      calls.push(value.id)
      return { id: '9'.repeat(64) }
    })

    expect(calls).toEqual([candidate.id])
    expect(approved).toMatchObject({
      status: 'approved',
      generationId: '9'.repeat(64),
      decisionNote: 'evidence is sufficient',
    })
    expect(JSON.parse(await readFile(join(root, 'candidate', 'review-state.json'), 'utf8')))
      .toMatchObject({ status: 'approved', actor: 'human', generationId: '9'.repeat(64) })
    await expect(inbox.reject(candidate.id, 'change the terminal decision'))
      .rejects.toThrow('approved Candidate cannot be rejected')
  })

  it('keeps an automatic approval visible until future-session activation is durable', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])
    const candidate = (await inbox.scan()).candidates[0]
    if (candidate === undefined) throw new Error('candidate missing')
    const generationId = '8'.repeat(64)

    const approved = await inbox.approve(
      candidate.id,
      'automatic clear win',
      async () => ({ id: generationId }),
      { actor: 'auto-clear-instruction-v1' },
    )
    expect(approved).toMatchObject({
      status: 'approved',
      decisionActor: 'auto-clear-instruction-v1',
      generationId,
    })
    expect((await inbox.scan()).candidates).toEqual([
      expect.objectContaining({ id: candidate.id, status: 'approved' }),
    ])

    await inbox.markAutomaticActivated(candidate.id, generationId)

    expect((await inbox.scan()).candidates).toEqual([])
    expect((await inbox.scanAll()).candidates).toEqual([
      expect.objectContaining({
        id: candidate.id,
        activatedAt: expect.any(String),
      }),
    ])
  })

  it('serializes competing automatic approval and human rejection into one terminal decision', async () => {
    const root = await createRoot()
    await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])
    const candidate = (await inbox.scan()).candidates[0]
    if (candidate === undefined) throw new Error('candidate missing')
    let release!: () => void
    const publishing = new Promise<void>(resolve => { release = resolve })
    const approving = inbox.approve(
      candidate.id,
      'automatic clear win',
      async () => {
        await publishing
        return { id: '7'.repeat(64) }
      },
      { actor: 'auto-clear-instruction-v1' },
    )
    const rejecting = inbox.reject(candidate.id, 'human raced with policy')

    release()

    await expect(approving).resolves.toMatchObject({ decisionActor: 'auto-clear-instruction-v1' })
    await expect(rejecting).rejects.toThrow('approved Candidate cannot be rejected')
    expect((await inbox.scanAll()).candidates).toEqual([
      expect.objectContaining({ decisionActor: 'auto-clear-instruction-v1' }),
    ])
  })

  it('requires a full unambiguous review id and refuses a changed report after disposition', async () => {
    const root = await createRoot()
    const runDir = await writeCandidateRun(root, 'candidate', 'promote')
    const inbox = new ReviewInbox([root])
    const candidate = (await inbox.scan()).candidates[0]
    if (candidate === undefined) throw new Error('candidate missing')

    await expect(inbox.reject(candidate.id.slice(0, 16), 'no')).rejects.toThrow('full 64-character review id')
    await inbox.reject(candidate.id, 'no')
    const report = JSON.parse(await readFile(join(runDir, 'report.json'), 'utf8'))
    report.decision.limitations = ['tampered after review']
    await writeFile(join(runDir, 'report.json'), `${JSON.stringify(report)}\n`)

    const rescanned = await new ReviewInbox([root]).scan()
    expect(rescanned.warnings.join('\n')).toContain('review-state.json does not match its Candidate evidence')
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-review-'))
  temporaryRoots.push(root)
  return root
}

async function writeCandidateRun(
  root: string,
  name: string,
  recommendation: 'promote' | 'review' | 'reject',
  phase: 'complete' | 'incomplete' = 'complete',
  options: {
    feedbackLaunchMode?: 'human' | 'automatic'
    updatedAt?: string
  } = {},
): Promise<string> {
  const runDir = join(root, name)
  await mkdir(runDir)
  const runId = name.padEnd(64, '0').slice(0, 64).replaceAll(/[^a-f0-9]/g, 'a')
  const proposal = {
    claim: 'Add exact browser verification',
    files: [{ path: 'SKILL.md', content: 'candidate body\n' }],
  }
  const proposalHash = createHash('sha256').update(JSON.stringify(proposal)).digest('hex')
  const reportPath = join(runDir, 'report.json')
  const state = {
    schemaVersion: 1,
    runId,
    phase,
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: options.updatedAt ?? '2026-08-16T00:01:00.000Z',
    identity: {
      workspaceId: WORKSPACE_ID,
      baseTreeHash: 'a'.repeat(64),
      casePackHash: 'b'.repeat(64),
      dshRevision: 'fixture',
      evaluatorVersion: 'fixture-v1',
      modelConfigHash: 'c'.repeat(64),
      modelRoute: 'fixture-model',
      skillName: 'stable-skill',
    },
    resumeInputs: { skillDir: join(root, 'skill'), casePackDir: join(root, 'case-pack') },
    ...(options.feedbackLaunchMode === undefined
      ? {}
      : {
          feedbackLaunchMode: options.feedbackLaunchMode,
          feedbackSignalId: '1'.repeat(64),
        }),
    proposal,
    proposalHash,
    modelUsage: { inputTokens: 120, outputTokens: 32 },
    ...(phase === 'complete' ? {
      outcome: { kind: 'complete', reportPath, summary: `${recommendation}: fixture` },
    } : {
      outcome: { kind: 'incomplete', reportPath, reason: 'fixture incomplete' },
    }),
  }
  const report = {
    schemaVersion: 1,
    run: { id: runId, status: phase },
    subject: { skillName: 'stable-skill', baseTreeHash: 'a'.repeat(64), unchanged: true },
    candidate: {
      id: 'candidate-id',
      treeHash: 'e'.repeat(64),
      parentTreeHash: 'a'.repeat(64),
      claim: 'Add exact browser verification',
      changedFiles: ['SKILL.md'],
    },
    epoch: { evaluatorVersion: 'fixture-v1' },
    budget: { inputTokens: 120, outputTokens: 32 },
    trial: { count: 4 },
    cases: [{
      id: 'held-out-browser',
      baseline: 'fail',
      candidate: 'pass',
      checks: [{ name: 'browser', passed: true }, { name: 'composition', passed: true }],
    }],
    composition: { candidateFingerprint: 'f'.repeat(64) },
    decision: {
      recommendation,
      reasons: ['candidate passed the final-test'],
      limitations: ['one deterministic final-test'],
    },
  }
  await writeFile(join(runDir, 'run-state.json'), `${JSON.stringify(state)}\n`)
  await writeFile(reportPath, `${JSON.stringify(report)}\n`)
  return runDir
}
