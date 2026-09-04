import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashTree } from '../src/hash.ts'
import { InternalSkillRetention } from '../src/internal-skill-retention.ts'
import { saveShadowRunState } from '../src/shadow-run-state.ts'
import type { QualifiedSkillCandidateShadowInput } from '../src/skill-candidate-admission.ts'
import type { PairedTrialResult } from '../src/trial.ts'
import {
  experienceSkillCandidate,
  internalSkillCandidateLineage,
  qualifiedSkillCandidateAdmission,
} from './skill-candidate-fixture.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('internal Skill Candidate retention', () => {
  it('persists one exact retained verdict and reuses it without another sealed Trial', async () => {
    const fixture = await retentionFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      true,
    ))
    const retention = new InternalSkillRetention(fixture.admission, { runTrial })

    const first = await retention.evaluate(fixture.candidate, fixture.admissionResult, fixture.shadow)
    const second = await retention.evaluate(fixture.candidate, fixture.admissionResult, fixture.shadow)

    expect(first).toMatchObject({
      schemaVersion: 1,
      status: 'retained',
      candidateId: fixture.candidate.id,
      workspaceId: WORKSPACE_ID,
      skillName: fixture.candidate.skillName,
      releaseAuthority: 'none',
      evidence: {
        baseline: 'pass',
        candidate: 'pass',
        calibrationPassed: true,
        compositionStable: true,
        proposerCalls: 0,
        trialCount: 4,
      },
    })
    expect(second).toEqual(first)
    expect(runTrial).toHaveBeenCalledOnce()
    await expect(readFile(first.reportPath!, 'utf8')).resolves.toContain('"status": "retained"')
  })

  it('scans its exact durable run root without exposing report paths and fails visible on tamper', async () => {
    const fixture = await retentionFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      true,
    ))
    const retention = new InternalSkillRetention(fixture.admission, {
      runTrial,
      runRoots: [{ workspaceId: WORKSPACE_ID, path: fixture.source.retentionRunRoot! }],
    })
    const result = await retention.evaluate(fixture.candidate, fixture.admissionResult, fixture.shadow)

    await expect(retention.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredRootCount: 1,
      warningCount: 0,
      runs: [expect.objectContaining({
        id: result.id,
        candidateId: fixture.candidate.id,
        workspaceId: WORKSPACE_ID,
        skillName: fixture.candidate.skillName,
        shadowRunId: fixture.shadowRunId,
        status: 'retained',
        reason: 'candidate-retained-prior-case',
        releaseAuthority: 'none',
        evidence: expect.objectContaining({
          baseline: 'pass',
          candidate: 'pass',
          proposerCalls: 0,
          trialCount: 4,
        }),
      })],
    })
    expect(JSON.stringify(await retention.scan(WORKSPACE_ID))).not.toContain(result.reportPath)

    const original = JSON.parse(await readFile(result.reportPath!, 'utf8')) as Record<string, unknown>
    const durable = structuredClone(original)
    durable.status = 'regressed'
    await writeFile(result.reportPath!, `${JSON.stringify(durable, null, 2)}\n`)
    await expect(retention.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredRootCount: 1,
      warningCount: 1,
      runs: [],
    })

    const invalidUsage = structuredClone(original)
    const evidence = invalidUsage.evidence as Record<string, unknown>
    const usage = evidence.usage as Record<string, Record<string, unknown>>
    usage.baseline!.inputTokens = 'private-token-shape'
    await writeFile(result.reportPath!, `${JSON.stringify(invalidUsage, null, 2)}\n`)
    await expect(retention.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredRootCount: 1,
      warningCount: 1,
      runs: [],
    })

    await writeFile(result.reportPath!, `${JSON.stringify(original, null, 2)}\n`)
    const movedResult = join(fixture.source.retentionRunRoot!, 'moved-result.json')
    await rename(result.reportPath!, movedResult)
    await symlink(movedResult, result.reportPath!)
    await expect(retention.scan(WORKSPACE_ID)).resolves.toEqual({
      configuredRootCount: 1,
      warningCount: 1,
      runs: [],
    })
  })

  it('refuses a Shadow whose Candidate lineage differs before invoking the Trial boundary', async () => {
    const fixture = await retentionFixture()
    const report = JSON.parse(await readFile(fixture.shadow.reportPath, 'utf8')) as Record<string, unknown>
    const originalLineage = structuredClone(report.lineage)
    report.lineage = {
      ...(report.lineage as Record<string, unknown>),
      candidateId: 'f'.repeat(64),
    }
    await writeFile(fixture.shadow.reportPath, `${JSON.stringify(report, null, 2)}\n`)
    const runTrial = vi.fn()
    const retention = new InternalSkillRetention(fixture.admission, { runTrial })

    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).rejects.toThrow('Shadow report does not match the exact internal Candidate lineage')

    report.lineage = originalLineage
    ;(report.candidate as Record<string, unknown>).parentTreeHash = '0'.repeat(64)
    await writeFile(fixture.shadow.reportPath, `${JSON.stringify(report, null, 2)}\n`)
    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).rejects.toThrow('Shadow report does not match its durable exact inputs')
    expect(runTrial).not.toHaveBeenCalled()
  })

  it('does not reuse a durable verdict whose status was detached from its reason and evidence', async () => {
    const fixture = await retentionFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      true,
    ))
    const retention = new InternalSkillRetention(fixture.admission, { runTrial })
    const result = await retention.evaluate(fixture.candidate, fixture.admissionResult, fixture.shadow)
    const original = JSON.parse(await readFile(result.reportPath!, 'utf8')) as Record<string, unknown>
    const tampered = structuredClone(original)
    tampered.status = 'regressed'
    await writeFile(result.reportPath!, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).rejects.toThrow('retention durable result has an invalid verdict binding')

    const detachedEvidence = structuredClone(original)
    ;(detachedEvidence.evidence as Record<string, unknown>).candidateTreeHash = '0'.repeat(64)
    await writeFile(result.reportPath!, `${JSON.stringify(detachedEvidence, null, 2)}\n`)
    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).rejects.toThrow('retention durable result does not match its exact run identity')

    await writeFile(result.reportPath!, `${JSON.stringify(original, null, 2)}\n`)
    const preparedPath = join(result.reportPath!, '..', 'prepared.json')
    const prepared = JSON.parse(await readFile(preparedPath, 'utf8')) as Record<string, unknown>
    prepared.shadowRunId = '0'.repeat(64)
    await writeFile(preparedPath, `${JSON.stringify(prepared, null, 2)}\n`)
    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).rejects.toThrow('retention durable run identity does not match its exact inputs')
    expect(runTrial).toHaveBeenCalledOnce()
  })

  it('records regression when the exact Candidate fails a prior case that the baseline passes', async () => {
    const fixture = await retentionFixture()
    const runTrial = vi.fn(async (): Promise<PairedTrialResult> => paired(
      fixture.baselineTreeHash,
      fixture.candidateTreeHash,
      false,
    ))
    const retention = new InternalSkillRetention(fixture.admission, { runTrial })

    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).resolves.toMatchObject({
      status: 'regressed',
      reason: 'candidate-regressed-prior-case',
      releaseAuthority: 'none',
      evidence: { baseline: 'pass', candidate: 'fail', proposerCalls: 0 },
    })
  })

  it('abstains without a Trial when the exact Envelope is v4 and has no fifth-Goal partition', async () => {
    const fixture = await retentionFixture()
    const {
      retentionCasePackDir: _retentionCasePackDir,
      retentionCasePackHash: _retentionCasePackHash,
      retentionRunRoot: _retentionRunRoot,
      ...v4Source
    } = fixture.source
    const runTrial = vi.fn()
    const retention = new InternalSkillRetention({
      qualifiedShadowInput: async () => v4Source,
    } as never, { runTrial })

    await expect(retention.evaluate(
      fixture.candidate,
      fixture.admissionResult,
      fixture.shadow,
    )).resolves.toMatchObject({
      status: 'abstained',
      reason: 'no-independent-retention-case',
      releaseAuthority: 'none',
    })
    expect(runTrial).not.toHaveBeenCalled()
  })
})

async function retentionFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-internal-retention-')))
  roots.push(root)
  const baselineDir = join(root, 'baseline')
  const admissionCasePackDir = join(root, 'admission')
  const admissionRunRoot = join(root, 'admission-runs')
  const candidateDir = join(root, 'candidate')
  const holdoutCasePackDir = join(root, 'holdout')
  const shadowRunRoot = join(root, 'shadow-runs')
  const retentionCasePackDir = join(root, 'retention')
  const retentionRunRoot = join(root, 'retention-runs')
  await Promise.all([
    baselineDir,
    admissionCasePackDir,
    admissionRunRoot,
    candidateDir,
    holdoutCasePackDir,
    shadowRunRoot,
    retentionCasePackDir,
    retentionRunRoot,
  ].map(path => mkdir(path)))
  const candidate = experienceSkillCandidate({
    skillName: 'release-proof',
    description: 'Preserve prior successful behavior with the exact internal Candidate.',
  })
  await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'internal-capability-absent-subject-v1',
    workspaceId: WORKSPACE_ID,
    opportunityId: candidate.opportunity.id,
    skillName: candidate.skillName,
  }, null, 2)}\n`)
  await writeFile(join(candidateDir, 'SKILL.md'), [
    '---',
    `name: ${candidate.skillName}`,
    'description: Preserve a release proof.',
    '---',
    '',
    'Use the verified release proof.',
    '',
  ].join('\n'))
  await writeFile(join(admissionCasePackDir, 'manifest.json'), '{"partition":"admission"}\n')
  await writeCasePack(holdoutCasePackDir, 'candidate-holdout', 'holdout-v1')
  await writeCasePack(retentionCasePackDir, 'prior-success-retention', 'retention-v1')
  const baselineTreeHash = await hashTree(baselineDir)
  const candidateTreeHash = await hashTree(candidateDir)
  const admissionResult = qualifiedSkillCandidateAdmission({
    ...candidate,
    version: { ...candidate.version, treeHash: candidateTreeHash },
  })
  const exactCandidate = { ...candidate, version: { ...candidate.version, treeHash: candidateTreeHash } }
  const lineage = internalSkillCandidateLineage({
    candidateId: exactCandidate.id,
    skillName: exactCandidate.skillName,
    opportunityId: exactCandidate.opportunity.id,
    evaluationEvidenceId: exactCandidate.authorship.evaluationEvidenceId,
    policyId: exactCandidate.authorship.policyId,
    versionKind: exactCandidate.version.kind,
    contentHash: exactCandidate.contentHash,
    candidateTreeHash,
    admissionId: admissionResult.id,
    evaluationEnvelopeId: admissionResult.envelopeId!,
  })
  const holdoutCasePackHash = await hashTree(holdoutCasePackDir)
  const retentionCasePackHash = await hashTree(retentionCasePackDir)
  const source: QualifiedSkillCandidateShadowInput = {
    evaluationEnvelopeId: admissionResult.envelopeId!,
    baselineKind: 'capability-absent',
    baselineSkillName: exactCandidate.skillName,
    baselineDir,
    candidateDir,
    admissionCasePackDir,
    admissionCasePackHash: await hashTree(admissionCasePackDir),
    admissionRunRoot,
    holdoutCasePackDir,
    holdoutCasePackHash,
    shadowRunRoot,
    retentionCasePackDir,
    retentionCasePackHash,
    retentionRunRoot,
    lineage,
  }
  const shadowRunDir = join(shadowRunRoot, 'a'.repeat(64))
  await mkdir(shadowRunDir)
  const reportPath = join(shadowRunDir, 'report.json')
  const shadowRunId = 'b'.repeat(64)
  await saveShadowRunState(shadowRunDir, {
    schemaVersion: 1,
    runId: shadowRunId,
    phase: 'complete',
    startedAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:01:00.000Z',
    identity: {
      workspaceId: WORKSPACE_ID,
      baseTreeHash: baselineTreeHash,
      casePackHash: holdoutCasePackHash,
      dshRevision: 'd'.repeat(40),
      evaluatorVersion: 'holdout-v1',
      modelConfigHash: 'c'.repeat(64),
      modelRoute: 'pinned-internal-candidate-v1',
      skillName: exactCandidate.skillName,
      baselineKind: 'capability-absent',
      skillCandidateLineage: lineage,
    },
    resumeInputs: {
      skillDir: baselineDir,
      casePackDir: holdoutCasePackDir,
      baselineKind: 'capability-absent',
      baselineSkillName: exactCandidate.skillName,
      candidateSkillDir: candidateDir,
    },
    proposal: { claim: exactCandidate.description, files: [] },
    proposalHash: 'e'.repeat(64),
    modelUsage: { inputTokens: 0, outputTokens: 0 },
    outcome: {
      kind: 'complete',
      reportPath,
      summary: 'promote: exact Candidate passed sealed holdout',
    },
  })
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 1,
    run: { id: shadowRunId, status: 'complete' },
    subject: {
      skillName: exactCandidate.skillName,
      baselineKind: 'capability-absent',
      baseTreeHash: baselineTreeHash,
      finalTreeHash: baselineTreeHash,
      unchanged: true,
    },
    epoch: {
      dshRevision: 'd'.repeat(40),
      evaluatorVersion: 'holdout-v1',
      casePackHash: holdoutCasePackHash,
      casePackFinalHash: holdoutCasePackHash,
      casePackUnchanged: true,
    },
    candidate: {
      treeHash: candidateTreeHash,
      parentTreeHash: baselineTreeHash,
      parentKind: 'capability-absent',
    },
    cases: [{ baseline: 'fail', candidate: 'pass' }],
    composition: { stable: true },
    trial: { backend: 'darwin-seatbelt', enforcement: 'full', count: 4 },
    lineage,
    decision: { recommendation: 'promote' },
  }, null, 2)}\n`)
  return {
    admission: { qualifiedShadowInput: vi.fn(async () => source) },
    admissionResult,
    baselineTreeHash,
    candidate: exactCandidate,
    candidateTreeHash,
    source,
    shadow: {
      status: 'complete' as const,
      reportPath,
      summary: 'promote: exact Candidate passed sealed holdout',
    },
    shadowRunId,
  }
}

async function writeCasePack(path: string, id: string, evaluatorVersion: string): Promise<void> {
  await writeFile(join(path, 'evaluator.mjs'), 'process.stdout.write("{}")\n')
  await mkdir(join(path, 'evidence'))
  await mkdir(join(path, 'known-bad'))
  await mkdir(join(path, 'known-correction'))
  await writeFile(join(path, 'evidence', 'rationale.md'), 'Internal test rationale.\n')
  await writeFile(join(path, 'known-bad', 'SKILL.md'), 'bad\n')
  await writeFile(join(path, 'known-correction', 'SKILL.md'), 'good\n')
  await writeFile(join(path, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id,
    workspaceId: WORKSPACE_ID,
    epoch: { dshRevision: 'd'.repeat(40), evaluatorVersion },
    budget: { candidateLimit: 1, trialLimit: 4, inputTokenLimit: 100, outputTokenLimit: 100 },
    evidence: { rationale: 'evidence/rationale.md' },
    trial: {
      evaluator: 'evaluator.mjs',
      timeoutMs: 1_000,
      outputLimitBytes: 4_096,
      dshAssembled: true,
      capabilityAbsentBaseline: true,
    },
    calibration: { knownBad: 'known-bad', knownCorrection: 'known-correction' },
  }, null, 2)}\n`)
}

function paired(
  baselineTreeHash: string,
  candidateTreeHash: string,
  candidatePassed: boolean,
): PairedTrialResult {
  return {
    backend: 'darwin-seatbelt',
    count: 4,
    assembled: true,
    calibration: [
      { id: 'known-bad', expected: 'fail', actual: 'fail', passed: true },
      { id: 'known-correction', expected: 'pass', actual: 'pass', passed: true },
    ],
    baseline: {
      passed: true,
      checks: [{ name: 'prior-case', passed: true }],
      treeHash: baselineTreeHash,
      composition: { fingerprint: 'f'.repeat(64), modelCalls: 1, usage: { inputTokens: 10 } },
    },
    candidate: {
      passed: candidatePassed,
      checks: [{ name: 'prior-case', passed: candidatePassed }],
      treeHash: candidateTreeHash,
      composition: { fingerprint: 'f'.repeat(64), modelCalls: 1, usage: { inputTokens: 10 } },
    },
  }
}
