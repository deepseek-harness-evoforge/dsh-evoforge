import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AutomaticRetentionCancelled,
  AutomaticRetentionService,
  type AutomaticRetentionTargetConfig,
} from '../src/automatic-retention.ts'
import type { ReviewCandidate, ReviewInbox } from '../src/review-inbox.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('automatic Retention', () => {
  it('runs one exact configured prior Case Pack for an otherwise eligible Candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-retention-'))
    temporaryRoots.push(root)
    const casePackDir = join(root, 'prior-case-pack')
    const runRoot = join(root, 'retention-runs')
    await Promise.all([mkdir(casePackDir), mkdir(runRoot)])
    const candidate = fixtureCandidate()
    const runner = vi.fn(async () => ({
      status: 'retained' as const,
      reportPath: join(runRoot, 'report.json'),
      summary: 'retained',
    }))
    const service = new AutomaticRetentionService({
      evidence: { evaluate: async () => ({
        status: 'missing' as const,
        matchedReports: 0,
        reasons: ['no exact Retention evidence is available'],
        warnings: [],
      }) },
      inbox: {
        scanAll: async () => ({ candidates: [candidate], warnings: [] }),
      } as Pick<ReviewInbox, 'scanAll'>,
      preflight: {
        evaluate: async () => ({
          eligible: true,
          policyVersion: 'auto-clear-instruction-v1' as const,
          reasons: ['clear win'],
        }),
      },
      runner,
      targets: [target(casePackDir, runRoot)],
    })

    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [{
        candidateId: candidate.id,
        targetId: 'prior-capability',
        status: 'retained',
      }],
      warnings: [],
    })
    expect(runner).toHaveBeenCalledOnce()
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      casePackDir,
      expectedCasePackHash: '8'.repeat(64),
      sourceRunDir: candidate.outputDir,
      signal: expect.any(AbortSignal),
    }))
  })

  it('rejects more than one automatic prior Case Pack for the same Skill', () => {
    const duplicate = {
      ...target('/private/prior-two', '/private/retention-runs'),
      id: 'prior-capability-two',
    }
    expect(() => new AutomaticRetentionService({
      evidence: { evaluate: vi.fn() },
      inbox: { scanAll: vi.fn() } as Pick<ReviewInbox, 'scanAll'>,
      preflight: { evaluate: vi.fn() },
      runner: vi.fn(),
      targets: [target('/private/prior-one', '/private/retention-runs'), duplicate],
    })).toThrow('automatic Retention permits exactly one target per Workspace and Skill')
  })

  it('rejects an automatic target that is not bounded and exact', () => {
    const make = (targets: AutomaticRetentionTargetConfig[]) => () => new AutomaticRetentionService({
      evidence: { evaluate: vi.fn() },
      inbox: { scanAll: vi.fn() } as Pick<ReviewInbox, 'scanAll'>,
      preflight: { evaluate: vi.fn() },
      runner: vi.fn(),
      targets,
    })

    expect(make([])).toThrow('automatic Retention requires 1-20 targets')
    expect(make([{
      ...target('/private/prior', '/private/runs'),
      casePackHash: 'not-a-hash',
    }])).toThrow('automatic Retention Case Pack hashes must be exact')
    expect(make([target('relative/prior', '/private/runs')]))
      .toThrow('automatic Retention paths must be absolute')
    expect(make([{
      ...target('/private/prior', '/private/runs'),
      id: 'target id with spaces',
    }])).toThrow('automatic Retention target ids must be stable public ids')
  })

  it('does not retry a Candidate whose automatic Retention output was left uncertain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-retention-crash-'))
    temporaryRoots.push(root)
    const casePackDir = join(root, 'prior-case-pack')
    const runRoot = join(root, 'retention-runs')
    await Promise.all([mkdir(casePackDir), mkdir(runRoot)])
    const candidate = fixtureCandidate()
    const runner = vi.fn(async (input: { outputDir: string }) => {
      await mkdir(input.outputDir)
      throw new Error('simulated process loss after execution began')
    })
    const service = new AutomaticRetentionService({
      evidence: { evaluate: async () => ({
        status: 'missing' as const,
        matchedReports: 0,
        reasons: ['no exact Retention evidence is available'],
        warnings: [],
      }) },
      inbox: {
        scanAll: async () => ({ candidates: [candidate], warnings: [] }),
      } as Pick<ReviewInbox, 'scanAll'>,
      preflight: {
        evaluate: async () => ({
          eligible: true,
          policyVersion: 'auto-clear-instruction-v1' as const,
          reasons: ['clear win'],
        }),
      },
      runner,
      targets: [target(casePackDir, runRoot)],
    })

    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [],
      warnings: ['automatic Retention execution did not reach a terminal report'],
    })
    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [],
      warnings: ['automatic Retention has an existing non-terminal output; human review is required'],
    })
    expect(runner).toHaveBeenCalledOnce()
  })

  it('never spends on a Candidate already dispositioned by a human', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-retention-human-'))
    temporaryRoots.push(root)
    const casePackDir = join(root, 'prior-case-pack')
    const runRoot = join(root, 'retention-runs')
    await Promise.all([mkdir(casePackDir), mkdir(runRoot)])
    const candidate: ReviewCandidate = {
      ...fixtureCandidate(),
      status: 'approved',
      decisionActor: 'human',
      generationId: '9'.repeat(64),
    }
    const runner = vi.fn()
    const service = new AutomaticRetentionService({
      evidence: { evaluate: vi.fn(async () => ({
        status: 'missing' as const,
        matchedReports: 0,
        reasons: ['missing'],
        warnings: [],
      })) },
      inbox: {
        scanAll: async () => ({ candidates: [candidate], warnings: [] }),
      } as Pick<ReviewInbox, 'scanAll'>,
      preflight: { evaluate: vi.fn(async () => ({
        eligible: true,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['clear win'],
      })) },
      runner,
      targets: [target(casePackDir, runRoot)],
    })

    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [],
      warnings: [],
    })
    expect(runner).not.toHaveBeenCalled()
  })

  it('suppresses an operator-cancelled automatic Retention for the current process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-automatic-retention-cancel-'))
    temporaryRoots.push(root)
    const casePackDir = join(root, 'prior-case-pack')
    const runRoot = join(root, 'retention-runs')
    await Promise.all([mkdir(casePackDir), mkdir(runRoot)])
    const candidate = fixtureCandidate()
    const runner = vi.fn(async () => {
      throw new AutomaticRetentionCancelled('cancelled by operator')
    })
    const service = new AutomaticRetentionService({
      evidence: { evaluate: vi.fn(async () => ({
        status: 'missing' as const,
        matchedReports: 0,
        reasons: ['missing'],
        warnings: [],
      })) },
      inbox: {
        scanAll: async () => ({ candidates: [candidate], warnings: [] }),
      } as Pick<ReviewInbox, 'scanAll'>,
      preflight: { evaluate: vi.fn(async () => ({
        eligible: true,
        policyVersion: 'auto-clear-instruction-v1' as const,
        reasons: ['clear win'],
      })) },
      runner,
      targets: [target(casePackDir, runRoot)],
    })

    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [],
      warnings: ['automatic Retention was cancelled and is suppressed for this process'],
    })
    await expect(service.scanOnce(new AbortController().signal, WORKSPACE_ID)).resolves.toEqual({
      evaluated: [],
      warnings: [],
    })
    expect(runner).toHaveBeenCalledOnce()
  })
})

function target(casePackDir: string, runRoot: string): AutomaticRetentionTargetConfig {
  return {
    id: 'prior-capability',
    workspaceId: WORKSPACE_ID,
    skill: 'stable-skill',
    casePackDir,
    casePackHash: '8'.repeat(64),
    runRoot,
  }
}

function fixtureCandidate(): ReviewCandidate {
  return {
    id: '1'.repeat(64),
    workspaceId: WORKSPACE_ID,
    runId: '2'.repeat(64),
    status: 'pending',
    outputDir: '/private/shadow-run',
    skillName: 'stable-skill',
    recommendation: 'promote',
    claim: 'append verification step',
    changedFiles: ['SKILL.md'],
    candidateTreeHash: '3'.repeat(64),
    baseTreeHash: '4'.repeat(64),
    proposalHash: '5'.repeat(64),
    proposal: { claim: 'append verification step', files: [{ path: 'SKILL.md', content: 'body' }] },
    cases: [{ id: 'new-case', baseline: 'fail', candidate: 'pass', passedChecks: 1, totalChecks: 1 }],
    cost: { inputTokens: 10, outputTokens: 5, trialCount: 4 },
    reasons: ['clear win'],
    limitations: [],
    evaluatorVersion: 'fixture-v1',
    compositionFingerprint: '6'.repeat(64),
    compositionStable: true,
    startedAt: '2026-08-17T00:00:00.000Z',
    evidenceHash: '7'.repeat(64),
  }
}
