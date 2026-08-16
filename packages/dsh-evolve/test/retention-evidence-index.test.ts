import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RetentionEvidenceIndex } from '../src/retention-evidence-index.ts'
import type { ReviewCandidate } from '../src/review-inbox.ts'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('retention evidence index', () => {
  it('requires a bounded unique absolute root list', () => {
    expect(() => new RetentionEvidenceIndex([])).toThrow('requires 1-20 roots')
    expect(() => new RetentionEvidenceIndex(['relative']))
      .toThrow('retention evidence roots must be absolute')
    expect(() => new RetentionEvidenceIndex(['/tmp/same', '/tmp/same']))
      .toThrow('retention evidence roots must be unique')
    expect(() => new RetentionEvidenceIndex(
      Array.from({ length: 21 }, (_, index) => `/tmp/root-${index}`),
    )).toThrow('at most 20')
  })

  it('accepts exact retained evidence and exposes no host path', async () => {
    const root = await createRoot()
    await writeEvidence(root, 'retained', fixtureCandidate())
    const result = await new RetentionEvidenceIndex([root]).evaluate(fixtureCandidate())

    expect(result).toEqual({
      status: 'retained',
      matchedReports: 1,
      reasons: ['one exact prior Case Pack retained the Candidate capability'],
      warnings: [],
    })
    expect(JSON.stringify(result)).not.toContain(root)
  })

  it('lets exact regression dominate retained evidence', async () => {
    const root = await createRoot()
    const candidate = fixtureCandidate()
    await writeEvidence(root, 'retained', candidate, 'a'.repeat(64), 'retained-run')
    await writeEvidence(root, 'regressed', candidate, 'b'.repeat(64), 'regressed-run')

    await expect(new RetentionEvidenceIndex([root]).evaluate(candidate)).resolves.toEqual({
      status: 'regressed',
      matchedReports: 2,
      reasons: ['an exact prior Case Pack proves baseline pass / Candidate fail'],
      warnings: [],
    })
  })

  it('fails closed when one content-derived run id has conflicting exact outcomes', async () => {
    const root = await createRoot()
    const candidate = fixtureCandidate()
    await writeEvidence(root, 'retained', candidate, 'c'.repeat(64), 'first')
    await writeEvidence(root, 'regressed', candidate, 'c'.repeat(64), 'second')

    await expect(new RetentionEvidenceIndex([root]).evaluate(candidate)).resolves.toMatchObject({
      status: 'incomplete',
      matchedReports: 1,
      reasons: ['conflicting exact Retention evidence is available'],
      warnings: ['duplicate Retention run id has conflicting exact evidence'],
    })
  })

  it('fails closed for only incomplete evidence, missing evidence, and malformed or symlinked reports', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const candidate = fixtureCandidate()
    await writeEvidence(root, 'incomplete', candidate)
    const malformed = join(root, 'malformed')
    await mkdir(malformed)
    await writeFile(join(malformed, 'retention-report.json'), '{}\n')
    await mkdir(join(root, 'interrupted-without-report'))
    const outsideRun = await writeEvidence(outside, 'retained', candidate)
    const linked = join(root, 'linked')
    await mkdir(linked)
    await symlink(join(outsideRun, 'retention-report.json'), join(linked, 'retention-report.json'))

    const incomplete = await new RetentionEvidenceIndex([root]).evaluate(candidate)
    expect(incomplete).toMatchObject({
      status: 'incomplete',
      matchedReports: 1,
      reasons: ['only incomplete exact Retention evidence is available'],
    })
    expect(incomplete.warnings).toHaveLength(2)
    expect(JSON.stringify(incomplete)).not.toContain(root)

    const empty = await createRoot()
    await expect(new RetentionEvidenceIndex([empty]).evaluate(candidate)).resolves.toEqual({
      status: 'missing',
      matchedReports: 0,
      reasons: ['no exact Retention evidence is available'],
      warnings: [],
    })
  })

  it('does not match a report whose exact source or content-derived run id was tampered', async () => {
    const root = await createRoot()
    const candidate = fixtureCandidate()
    await writeEvidence(root, 'retained', { ...candidate, runId: '9'.repeat(64) }, 'c'.repeat(64), 'wrong-source')
    const run = await writeEvidence(root, 'retained', candidate, 'd'.repeat(64), 'wrong-id')
    const reportPath = join(run, 'retention-report.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    report.run.id = '0'.repeat(64)
    await writeFile(reportPath, `${JSON.stringify(report)}\n`)

    const result = await new RetentionEvidenceIndex([root]).evaluate(candidate)
    expect(result.status).toBe('missing')
    expect(result.matchedReports).toBe(0)
    expect(result.warnings).toHaveLength(1)
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-retention-index-'))
  temporaryRoots.push(root)
  return root
}

async function writeEvidence(
  root: string,
  outcome: 'retained' | 'regressed' | 'incomplete',
  candidate: ReviewCandidate,
  casePackHash = '8'.repeat(64),
  name: string = outcome,
): Promise<string> {
  const runDir = join(root, name)
  await mkdir(runDir)
  const epoch = { dshRevision: '7'.repeat(40), evaluatorVersion: 'prior-v1' }
  const runId = sha256(JSON.stringify({
    sourceRunId: candidate.runId,
    candidateTreeHash: candidate.candidateTreeHash,
    casePackHash,
    ...epoch,
  }))
  const candidatePassed = outcome === 'retained'
  const complete = outcome !== 'incomplete'
  const report = {
    schemaVersion: 1,
    run: { id: runId, status: complete ? 'complete' : 'incomplete' },
    source: {
      shadowRunId: candidate.runId,
      primaryCasePackHash: '6'.repeat(64),
      primaryCasePackFinalHash: '6'.repeat(64),
      primaryCasePackUnchanged: true,
      recommendation: candidate.recommendation,
    },
    subject: {
      skillName: candidate.skillName,
      baseTreeHash: candidate.baseTreeHash,
      candidateTreeHash: candidate.candidateTreeHash,
      finalTreeHash: candidate.baseTreeHash,
      unchanged: true,
    },
    casePack: { id: 'prior-capability', hash: casePackHash, finalHash: casePackHash, unchanged: true },
    epoch,
    model: { proposerCalls: 0 },
    calibration: [
      { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
      { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
    ],
    comparison: {
      baseline: { passed: true, checks: [{ name: 'prior', passed: true }], treeHash: candidate.baseTreeHash },
      candidate: {
        passed: candidatePassed,
        checks: [{ name: 'prior', passed: candidatePassed }],
        treeHash: candidate.candidateTreeHash,
      },
      compositionStable: true,
    },
    trial: { backend: 'darwin-seatbelt', count: 4, assembled: false },
    decision: { outcome, reason: 'fixture' },
  }
  await writeFile(join(runDir, 'retention-report.json'), `${JSON.stringify(report)}\n`)
  return runDir
}

function fixtureCandidate(): ReviewCandidate {
  return {
    id: '1'.repeat(64),
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
