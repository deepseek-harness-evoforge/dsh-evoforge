import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateRetention } from '../src/retention.ts'
import { hashTree, sha256 } from '../src/hash.ts'
import { runShadow } from '../src/shadow.ts'
import { assembleSkillBundleArchive } from '../src/skill-bundle-archive.ts'
import { WORKSPACE_ID } from './workspace-fixture.ts'

const suiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const packageRoot = resolve(suiteRoot, 'packages', 'dsh-evolve')
const cliPath = join(packageRoot, 'test', 'fixtures', 'shadow-driver.ts')
const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('retention source integrity', () => {
  it('rejects proposal/hash mismatch and path escape before creating output or running a Trial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-retention-integrity-'))
    temporaryRoots.push(root)
    const sourceRun = join(root, 'source-run')
    const skillDir = join(root, 'skill')
    const primaryCasePack = join(root, 'primary-case-pack')
    const priorCasePack = join(root, 'prior-case-pack')
    const outputDir = join(root, 'output')
    await Promise.all([
      mkdir(sourceRun),
      mkdir(skillDir),
      mkdir(primaryCasePack),
      mkdir(priorCasePack),
    ])
    const exactSourceRun = await realpath(sourceRun)
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify({
      schemaVersion: 1,
      runId: '1'.repeat(64),
      phase: 'complete',
      startedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash: '2'.repeat(64),
        casePackHash: '3'.repeat(64),
        dshRevision: '4'.repeat(40),
        evaluatorVersion: 'fixture-v1',
        modelConfigHash: '5'.repeat(64),
        modelRoute: 'fixture',
        skillName: 'fixture-skill',
      },
      resumeInputs: { skillDir, casePackDir: primaryCasePack },
      proposal: { claim: 'tampered', files: [{ path: 'SKILL.md', content: 'tampered' }] },
      proposalHash: '6'.repeat(64),
      modelUsage: { inputTokens: 1, outputTokens: 1 },
      outcome: {
        kind: 'complete',
        reportPath: join(exactSourceRun, 'report.json'),
        summary: 'promote: fixture',
      },
    }, null, 2))

    await expect(evaluateRetention({
      casePackDir: priorCasePack,
      outputDir,
      sourceRunDir: sourceRun,
    })).rejects.toThrow('proposal does not match its durable hash')
    await expect(access(outputDir)).rejects.toMatchObject({ code: 'ENOENT' })

    const unsafeProposal = {
      claim: 'escape the owned tree',
      files: [{ path: '../../escaped.txt', content: 'must not be written' }],
    }
    const state = JSON.parse(await readFile(join(sourceRun, 'run-state.json'), 'utf8'))
    state.proposal = unsafeProposal
    state.proposalHash = sha256(JSON.stringify(unsafeProposal))
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify(state, null, 2))
    const unsafeOutput = join(root, 'unsafe-output')
    await expect(evaluateRetention({
      casePackDir: priorCasePack,
      outputDir: unsafeOutput,
      sourceRunDir: sourceRun,
    })).rejects.toThrow('proposal has an invalid shape')
    await expect(access(unsafeOutput)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(root, 'escaped.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a contaminated capability-absent subject and a mutated exact Candidate before Trial', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-absent-retention-integrity-')))
    temporaryRoots.push(root)
    const sourceRun = join(root, 'source-run')
    const baselineDir = join(root, 'absent-subject')
    const candidateDir = join(root, 'candidate')
    const primaryCasePack = join(root, 'primary-case-pack')
    const priorCasePack = join(root, 'prior-case-pack')
    await Promise.all([
      mkdir(sourceRun),
      mkdir(baselineDir),
      mkdir(candidateDir),
      mkdir(primaryCasePack),
      mkdir(priorCasePack),
    ])
    const skillName = 'internally-discovered-skill'
    const skill = [
      '---',
      `name: ${skillName}`,
      'description: Internal evidence fixture.',
      '---',
      '',
      '# Internal evidence fixture',
      '',
    ].join('\n')
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      workspaceId: WORKSPACE_ID,
      opportunityId: '2'.repeat(64),
      skillName,
    })}\n`)
    await writeFile(join(baselineDir, 'SKILL.md'), 'contamination')
    await writeFile(join(candidateDir, 'SKILL.md'), skill)
    const proposal = { claim: 'internal Candidate', files: [{ path: 'SKILL.md', content: skill }] }
    const candidateTreeHash = await hashTree(candidateDir)
    const lineage = {
      kind: 'internal-skill-candidate-lineage-v3',
      candidateId: '1'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName,
      opportunityId: '2'.repeat(64),
      evaluationEvidenceId: '6'.repeat(64),
      policyId: 'internal-skill-author',
      versionKind: 'experience-authored-bundle-v1',
      contentHash: '3'.repeat(64),
      candidateTreeHash,
      admissionId: '4'.repeat(64),
      evaluationEnvelopeId: '5'.repeat(64),
      releaseAuthority: 'none',
    }
    const runId = '6'.repeat(64)
    const reportPath = join(sourceRun, 'report.json')
    const state = {
      schemaVersion: 1,
      runId,
      phase: 'complete',
      startedAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:01:00.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash: await hashTree(baselineDir),
        baselineKind: 'capability-absent',
        casePackHash: await hashTree(primaryCasePack),
        dshRevision: '7'.repeat(40),
        evaluatorVersion: 'integrity-v1',
        modelConfigHash: '8'.repeat(64),
        modelRoute: 'fixture',
        skillName,
        skillCandidateLineage: lineage,
      },
      resumeInputs: {
        skillDir: baselineDir,
        casePackDir: primaryCasePack,
        baselineKind: 'capability-absent',
        baselineSkillName: skillName,
        candidateSkillDir: candidateDir,
      },
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      modelUsage: { inputTokens: 0, outputTokens: 0 },
      outcome: { kind: 'complete', reportPath, summary: 'promote: fixture' },
    }
    const report = {
      schemaVersion: 1,
      run: { id: runId, status: 'complete' },
      subject: {
        skillName,
        baselineKind: 'capability-absent',
        baseTreeHash: state.identity.baseTreeHash,
        unchanged: true,
      },
      candidate: {
        treeHash: candidateTreeHash,
        parentTreeHash: state.identity.baseTreeHash,
        parentKind: 'capability-absent',
      },
      lineage,
      decision: { recommendation: 'promote' },
    }
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify(state, null, 2))
    await writeFile(reportPath, JSON.stringify(report, null, 2))

    const contaminatedOutput = join(root, 'contaminated-output')
    await expect(evaluateRetention({
      casePackDir: priorCasePack,
      outputDir: contaminatedOutput,
      sourceRunDir: sourceRun,
    })).rejects.toThrow('capability-absent baseline must contain only subject.json')
    await expect(access(contaminatedOutput)).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(join(baselineDir, 'SKILL.md'))
    state.identity.baseTreeHash = await hashTree(baselineDir)
    report.subject.baseTreeHash = state.identity.baseTreeHash
    report.candidate.parentTreeHash = state.identity.baseTreeHash
    await writeFile(join(candidateDir, 'unexpected.md'), 'mutated after the source Shadow')
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify(state, null, 2))
    await writeFile(reportPath, JSON.stringify(report, null, 2))
    const mutatedOutput = join(root, 'mutated-output')
    await expect(evaluateRetention({
      casePackDir: priorCasePack,
      outputDir: mutatedOutput,
      sourceRunDir: sourceRun,
    })).rejects.toThrow('exact Candidate changed after the source Shadow')
    await expect(access(mutatedOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe.skipIf(process.platform !== 'darwin')('exact Candidate retention gate', () => {
  it('retains a new Skill only when an exact capability-absent parent and Candidate both pass a real DSH prior case', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-absent-retention-')))
    temporaryRoots.push(root)
    const baselineDir = join(root, 'absent-subject')
    const candidateDir = join(root, 'candidate')
    const sourceRun = join(root, 'source-shadow')
    const retentionRun = join(root, 'retention')
    const primaryCasePack = join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance-assembled')
    const priorCasePack = join(root, 'prior-case-pack')
    await Promise.all([
      mkdir(baselineDir),
      mkdir(join(candidateDir, 'references'), { recursive: true }),
      writeAbsentRetentionCasePack(primaryCasePack, priorCasePack),
    ])
    await writeFile(join(baselineDir, 'subject.json'), `${JSON.stringify({
      schemaVersion: 1,
      kind: 'internal-capability-absent-subject-v1',
      workspaceId: WORKSPACE_ID,
      opportunityId: '2'.repeat(64),
      skillName: 'browser-e2e-baseline',
    })}\n`)
    const skill = [
      '---',
      'name: browser-e2e-baseline',
      'description: Develop a DSH plugin from a user request.',
      '---',
      '',
      '# Develop a DSH Plugin',
      '',
      'For Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.',
      'Follow the [verification contract](references/verification.md).',
      '',
    ].join('\n')
    await writeFile(join(candidateDir, 'SKILL.md'), skill)
    await writeFile(
      join(candidateDir, 'references', 'verification.md'),
      '# Verification\n\nPreserve unrelated native DSH behavior.\n',
    )
    const bundle = await assembleSkillBundleArchive([
      { path: 'SKILL.md', content: skill },
      {
        path: 'references/verification.md',
        content: '# Verification\n\nPreserve unrelated native DSH behavior.\n',
      },
    ])
    const lineage = {
      kind: 'internal-skill-candidate-lineage-v3' as const,
      candidateId: '1'.repeat(64),
      workspaceId: WORKSPACE_ID,
      skillName: 'browser-e2e-baseline',
      opportunityId: '2'.repeat(64),
      evaluationEvidenceId: '6'.repeat(64),
      policyId: 'browser-skill-author',
      versionKind: 'experience-authored-bundle-v1' as const,
      contentHash: bundle.artifactDigest,
      candidateTreeHash: bundle.treeHash,
      admissionId: '3'.repeat(64),
      evaluationEnvelopeId: '4'.repeat(64),
      releaseAuthority: 'none' as const,
    }
    const previousDshSource = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
    process.env.DSH_EVOLVE_DSH_SOURCE_DIR = resolve(suiteRoot, '../deepseek-harness')
    try {
      const source = await runShadow({
        baselineKind: 'capability-absent',
        baselineSkillName: 'browser-e2e-baseline',
        casePackDir: primaryCasePack,
        exactCandidate: {
          claim: 'Add the missing browser verification Skill',
          lineage,
          skillDir: candidateDir,
        },
        outputDir: sourceRun,
        skillDir: baselineDir,
      })
      expect(source.status, JSON.stringify(source)).toBe('complete')

      const retained = await evaluateRetention({
        casePackDir: priorCasePack,
        outputDir: retentionRun,
        sourceRunDir: sourceRun,
      })

      const report = JSON.parse(await readFile(join(retentionRun, 'retention-report.json'), 'utf8'))
      expect(retained, JSON.stringify({ retained, report })).toMatchObject({ status: 'retained' })
      expect(report).toMatchObject({
        subject: {
          skillName: 'browser-e2e-baseline',
          baselineKind: 'capability-absent',
          unchanged: true,
          candidateUnchanged: true,
        },
        comparison: {
          baseline: { passed: true },
          candidate: { passed: true },
          compositionStable: true,
        },
        trial: { assembled: true, count: 4 },
        model: { proposerCalls: 0 },
        decision: { outcome: 'retained' },
      })
      await expect(readFile(join(baselineDir, 'SKILL.md'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' })
      expect(await hashTree(candidateDir)).toBe(report.subject.candidateTreeHash)
    } finally {
      if (previousDshSource === undefined) delete process.env.DSH_EVOLVE_DSH_SOURCE_DIR
      else process.env.DSH_EVOLVE_DSH_SOURCE_DIR = previousDshSource
    }
  }, 100_000)

  it('proves a new-case win regressed a previously passing capability with zero additional proposer calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-retention-'))
    temporaryRoots.push(root)
    const skillDir = join(root, 'skill')
    const primaryCasePack = join(root, 'primary-case-pack')
    const priorCasePack = join(root, 'prior-case-pack')
    const sourceRun = join(root, 'source-shadow-run')
    const retentionRun = join(root, 'retention-run')
    await mkdir(skillDir)
    await cp(join(suiteRoot, 'examples', 'case-packs', 'browser-e2e-guidance'), primaryCasePack, { recursive: true })
    const baseline = [
      '---',
      'name: browser-e2e-baseline',
      'description: Develop a DSH plugin from a user request.',
      '---',
      '',
      '# Develop a DSH Plugin',
      '',
      'Only edit files owned by the target plugin.',
      '',
    ].join('\n')
    const regressingCandidate = baseline.replace(
      'Only edit files owned by the target plugin.',
      'For Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.',
    )
    const preservingCandidate = baseline.replace(
      'Only edit files owned by the target plugin.',
      'Only edit files owned by the target plugin.\nFor Web or GUI work, verify the real flow in a controlled browser, refresh once, and inspect the visible failure path.',
    )
    await writeFile(join(skillDir, 'SKILL.md'), baseline)
    await writePriorCasePack(priorCasePack, baseline)

    let proposerCalls = 0
    const server = createServer((_request, response) => {
      proposerCalls += 1
      const candidate = proposerCalls === 1 ? regressingCandidate : preservingCandidate
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          claim: 'Add the missing real-browser rule but accidentally remove the owned-path rule',
          files: [{ path: 'SKILL.md', content: candidate }],
        }) } }],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      }))
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('retention proposer fixture did not bind')
    const previousBase = process.env.DSH_EVOLVE_MODEL_BASE_URL
    const previousModel = process.env.DSH_EVOLVE_MODEL_NAME
    process.env.DSH_EVOLVE_MODEL_BASE_URL = `http://127.0.0.1:${address.port}/v1`
    process.env.DSH_EVOLVE_MODEL_NAME = 'retention-fixture-model'

    try {
      const primary = await runShadow({
        casePackDir: primaryCasePack,
        outputDir: sourceRun,
        skillDir,
      })
      expect(primary.status).toBe('complete')
      expect(primary.status === 'complete' ? primary.summary : '').toContain('promote')
      expect(proposerCalls).toBe(1)

      const wrongHashOutput = join(root, 'wrong-target-hash')
      await expect(evaluateRetention({
        casePackDir: priorCasePack,
        expectedCasePackHash: '0'.repeat(64),
        outputDir: wrongHashOutput,
        sourceRunDir: sourceRun,
      })).rejects.toThrow('retention Case Pack does not match its configured exact hash')
      await expect(access(wrongHashOutput)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(proposerCalls).toBe(1)

      const retained = await evaluateRetention({
        casePackDir: priorCasePack,
        outputDir: retentionRun,
        sourceRunDir: sourceRun,
      })

      expect(retained).toMatchObject({
        status: 'regressed',
        reason: 'Candidate failed a prior Case Pack that the baseline passed',
      })
      expect(proposerCalls).toBe(1)

      const retainedSourceRun = join(root, 'retained-source-shadow-run')
      const retainedRun = join(root, 'retained-run')
      const secondPrimary = await runShadow({
        casePackDir: primaryCasePack,
        outputDir: retainedSourceRun,
        skillDir,
      })
      expect(secondPrimary.status).toBe('complete')
      expect(proposerCalls).toBe(2)
      const passing = await evaluateRetention({
        casePackDir: priorCasePack,
        outputDir: retainedRun,
        sourceRunDir: retainedSourceRun,
      })
      expect(passing).toMatchObject({ status: 'retained' })
      expect(proposerCalls).toBe(2)
      const passingReport = JSON.parse(await readFile(join(retainedRun, 'retention-report.json'), 'utf8'))
      expect(passingReport).toMatchObject({
        comparison: {
          baseline: { passed: true },
          candidate: { passed: true },
          compositionStable: true,
        },
        decision: { outcome: 'retained' },
        model: { proposerCalls: 0 },
      })
      const retainedCliOutput = join(root, 'retained-cli-run')
      const retainedCli = await execFileAsync(process.execPath, [
        '--import', 'tsx', cliPath, 'retain',
        '--run', retainedSourceRun,
        '--case-pack', priorCasePack,
        '--output', retainedCliOutput,
      ], { cwd: packageRoot })
      expect(retainedCli.stderr).toBe('')
      expect(retainedCli.stdout).toMatch(/^retained: baseline and exact Candidate passed owned-path-retention; report: .+\/retention-report\.json\n$/)
      expect(proposerCalls).toBe(2)
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(baseline)
      const report = JSON.parse(await readFile(join(retentionRun, 'retention-report.json'), 'utf8'))
      expect(report).toMatchObject({
        schemaVersion: 1,
        run: { status: 'complete' },
        source: {
          shadowRunId: expect.stringMatching(/^[a-f0-9]{64}$/),
          primaryCasePackUnchanged: true,
        },
        subject: {
          skillName: 'browser-e2e-baseline',
          unchanged: true,
        },
        casePack: {
          id: 'owned-path-retention',
          unchanged: true,
        },
        comparison: {
          baseline: { passed: true },
          candidate: { passed: false },
        },
        model: { proposerCalls: 0 },
        decision: { outcome: 'regressed' },
      })
      expect(report.subject.candidateTreeHash).toMatch(/^[a-f0-9]{64}$/)
      expect(report.trial.count).toBe(4)

      const cliOutput = join(root, 'retention-cli-run')
      let cliFailure: unknown
      try {
        await execFileAsync(process.execPath, [
          '--import', 'tsx', cliPath, 'retain',
          '--run', sourceRun,
          '--case-pack', priorCasePack,
          '--output', cliOutput,
        ], { cwd: packageRoot })
      } catch (error) {
        cliFailure = error
      }
      expect(cliFailure).toMatchObject({
        code: 3,
        stdout: '',
        stderr: expect.stringMatching(/^regressed: Candidate failed a prior Case Pack that the baseline passed; report: .+\/retention-report\.json\n$/),
      })
      expect(proposerCalls).toBe(2)
    } finally {
      if (previousBase === undefined) delete process.env.DSH_EVOLVE_MODEL_BASE_URL
      else process.env.DSH_EVOLVE_MODEL_BASE_URL = previousBase
      if (previousModel === undefined) delete process.env.DSH_EVOLVE_MODEL_NAME
      else process.env.DSH_EVOLVE_MODEL_NAME = previousModel
      await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()))
    }
  }, 30_000)

  it('does not restart or advance a sealed retention Trial after the CLI is SIGKILLed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-retention-crash-'))
    temporaryRoots.push(root)
    const skillDir = join(root, 'skill')
    const candidateDir = join(root, 'candidate')
    const primaryCasePack = join(root, 'primary-case-pack')
    const priorCasePack = join(root, 'prior-case-pack')
    const sourceRun = join(root, 'source-run')
    const outputDir = join(root, 'retention-run')
    await Promise.all([
      mkdir(skillDir),
      mkdir(candidateDir),
      mkdir(primaryCasePack),
      mkdir(sourceRun),
    ])
    const baseline = [
      '---',
      'name: retention-crash-skill',
      'description: fixture',
      '---',
      '',
      'Only edit files owned by the target plugin.',
      '',
    ].join('\n')
    const candidate = `${baseline.trimEnd()}\n\nRetain the prior rule.\n`
    await writeFile(join(skillDir, 'SKILL.md'), baseline)
    await writeFile(join(candidateDir, 'SKILL.md'), candidate)
    await writeFile(join(primaryCasePack, 'manifest.json'), '{"primary":true}\n')
    await writePriorCasePack(priorCasePack, baseline, 2_000)
    const proposal = {
      claim: 'Retain the prior rule',
      files: [{ path: 'SKILL.md', content: candidate }],
    }
    const baseTreeHash = await hashTree(skillDir)
    const candidateTreeHash = await hashTree(candidateDir)
    const primaryCasePackHash = await hashTree(primaryCasePack)
    const exactSourceRun = await realpath(sourceRun)
    const runId = '7'.repeat(64)
    await writeFile(join(sourceRun, 'report.json'), JSON.stringify({
      schemaVersion: 1,
      run: { id: runId, status: 'complete' },
      subject: { skillName: 'retention-crash-skill', baseTreeHash, unchanged: true },
      candidate: { treeHash: candidateTreeHash, parentTreeHash: baseTreeHash, parentKind: 'skill-tree' },
      decision: { recommendation: 'promote' },
    }, null, 2))
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify({
      schemaVersion: 1,
      runId,
      phase: 'complete',
      startedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
      identity: {
        workspaceId: WORKSPACE_ID,
        baseTreeHash,
        casePackHash: primaryCasePackHash,
        dshRevision: '8'.repeat(40),
        evaluatorVersion: 'primary-v1',
        modelConfigHash: '9'.repeat(64),
        modelRoute: 'fixture',
        skillName: 'retention-crash-skill',
      },
      resumeInputs: {
        skillDir: await realpath(skillDir),
        casePackDir: await realpath(primaryCasePack),
      },
      proposal,
      proposalHash: sha256(JSON.stringify(proposal)),
      modelUsage: { inputTokens: 1, outputTokens: 1 },
      outcome: {
        kind: 'complete',
        reportPath: join(exactSourceRun, 'report.json'),
        summary: 'promote: fixture',
      },
    }, null, 2))

    const child = spawn(process.execPath, [
      '--import', 'tsx', cliPath, 'retain',
      '--run', sourceRun,
      '--case-pack', priorCasePack,
      '--output', outputDir,
    ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await waitFor(async () => {
        try {
          return (await readdir(outputDir)).some(name => name.startsWith('.trial-'))
        } catch (error) {
          if ((error as { code?: unknown }).code === 'ENOENT') return false
          throw error
        }
      })
      child.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) => {
        child.once('close', () => resolveClose())
        child.once('error', rejectClose)
      })
      await new Promise(resolveWait => setTimeout(resolveWait, 2_500))

      const trialDirs = (await readdir(outputDir)).filter(name => name.startsWith('.trial-'))
      expect(trialDirs).toHaveLength(1)
      await expect(access(join(outputDir, 'retention-report.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toBe(baseline)
    } finally {
      child.kill('SIGKILL')
    }
  }, 15_000)
})

async function writeAbsentRetentionCasePack(
  primaryCasePack: string,
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir)
  await cp(join(primaryCasePack, 'calibration'), join(outputDir, 'calibration'), { recursive: true })
  const source = await readFile(join(primaryCasePack, 'final-test', 'evaluator.mjs'), 'utf8')
  const neutral = source.replace(
    "[driver, config, `/${targetSkillName}`, 'verify', 'the', 'real', 'GUI', 'flow']",
    "[driver, config, 'continue', 'the', 'generic', 'DSH', 'workflow']",
  )
  const checksStart = neutral.indexOf('const checks = [')
  const checksEnd = neutral.indexOf('\n\nprocess.stdout.write', checksStart)
  if (checksStart < 0 || checksEnd < 0) throw new Error('assembled evaluator fixture shape changed')
  const evaluator = `${neutral.slice(0, checksStart)}${[
    'const checks = [',
    "  { name: 'real-loader-agent-turn', passed: result?.type === 'result' },",
    "  { name: 'generic-turn-does-not-invoke-target', passed: invocation === undefined },",
    "  { name: 'real-tool-round-trip', passed: toolRoundTrip },",
    "  { name: 'guidance-or-absent-parent', passed: !skillPresent || skillSource.includes('verify the real flow in a controlled browser') },",
    "  { name: 'skill-body-outside-request-prefix', passed: !skillPresent || !serializedHeaders.includes(skillSource.trim()) },",
    ']',
  ].join('\n')}${neutral.slice(checksEnd)}`
  await mkdir(join(outputDir, 'final-test'))
  await writeFile(join(outputDir, 'final-test', 'evaluator.mjs'), evaluator)
  const manifest = JSON.parse(await readFile(join(primaryCasePack, 'manifest.json'), 'utf8'))
  manifest.id = 'capability-absent-negative-transfer-retention'
  manifest.epoch.evaluatorVersion = 'capability-absent-retention-v1'
  delete manifest.search
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function writePriorCasePack(casePackDir: string, correction: string, delayMs = 0): Promise<void> {
  await Promise.all([
    mkdir(join(casePackDir, 'calibration', 'known-bad'), { recursive: true }),
    mkdir(join(casePackDir, 'calibration', 'known-correction'), { recursive: true }),
    mkdir(join(casePackDir, 'final-test'), { recursive: true }),
  ])
  await writeFile(join(casePackDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'owned-path-retention',
    workspaceId: WORKSPACE_ID,
    epoch: {
      dshRevision: '47f943859bef60e4160492346772ded9b24f765a',
      evaluatorVersion: 'owned-path-retention-v1',
    },
    budget: {
      candidateLimit: 1,
      trialLimit: 4,
      inputTokenLimit: 1_000,
      outputTokenLimit: 100,
    },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 5_000,
      outputLimitBytes: 65_536,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }, null, 2))
  await writeFile(join(casePackDir, 'calibration', 'known-bad', 'SKILL.md'), correction.replace(
    'Only edit files owned by the target plugin.',
    'Editing rules are optional.',
  ))
  await writeFile(join(casePackDir, 'calibration', 'known-correction', 'SKILL.md'), correction)
  await writeFile(join(casePackDir, 'final-test', 'evaluator.mjs'), [
    "import { readFile } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    ...delayMs === 0
      ? []
      : [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs})`],
    "const source = await readFile(join(process.argv[2], 'SKILL.md'), 'utf8')",
    "const passed = source.includes('Only edit files owned by the target plugin.')",
    "process.stdout.write(JSON.stringify({ schemaVersion: 1, passed, checks: [{ name: 'owned-path-rule-retained', passed }] }))",
    '',
  ].join('\n'))
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 20))
  }
  throw new Error('timed out waiting for retention Trial start')
}
