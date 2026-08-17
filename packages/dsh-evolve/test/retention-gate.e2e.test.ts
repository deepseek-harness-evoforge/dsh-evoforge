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
})

describe.skipIf(process.platform !== 'darwin')('exact Candidate retention gate', () => {
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
      candidate: { treeHash: candidateTreeHash, parentTreeHash: baseTreeHash },
      decision: { recommendation: 'promote' },
    }, null, 2))
    await writeFile(join(sourceRun, 'run-state.json'), JSON.stringify({
      schemaVersion: 1,
      runId,
      phase: 'complete',
      startedAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
      identity: {
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

async function writePriorCasePack(casePackDir: string, correction: string, delayMs = 0): Promise<void> {
  await Promise.all([
    mkdir(join(casePackDir, 'calibration', 'known-bad'), { recursive: true }),
    mkdir(join(casePackDir, 'calibration', 'known-correction'), { recursive: true }),
    mkdir(join(casePackDir, 'final-test'), { recursive: true }),
  ])
  await writeFile(join(casePackDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'owned-path-retention',
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
