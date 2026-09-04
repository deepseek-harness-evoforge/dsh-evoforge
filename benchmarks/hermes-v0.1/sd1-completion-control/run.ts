import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { verifyDelivery } from '../../../packages/dsh-software-delivery/src/verify-delivery.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const deliveryPackageRoot = join(suiteRoot, 'packages', 'dsh-software-delivery')
const dshRoot = resolve(process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness'))
const hermesRoot = resolve(process.env.EVOFORGE_HERMES_SOURCE_DIR ?? resolve(suiteRoot, '../hermes-agent'))
const manifestPath = resolve(suiteRoot, process.env.EVOFORGE_HERMES_SD1_MANIFEST ?? join(benchmarkRoot, 'manifest.json'))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const allowNewEpoch = process.env.EVOFORGE_HERMES_SD1_ALLOW_NEW_EPOCH === '1'
const expectedResultPath = process.env.EVOFORGE_HERMES_SD1_EXPECTED_RESULT
const expectedResult = expectedResultPath === undefined && !allowNewEpoch
  ? JSON.parse(await readFile(join(benchmarkRoot, 'result.json'), 'utf8'))
  : expectedResultPath === undefined ? undefined : JSON.parse(await readFile(resolve(suiteRoot, expectedResultPath), 'utf8'))
const temporaryRoot = await mkdtemp(join(tmpdir(), 'evoforge-hermes-sd1-'))

try {
  await assertRevision(dshRoot, manifest.revisions.deepseekHarness)
  await assertRevision(hermesRoot, manifest.revisions.hermesAgent)
  const fixture = await createFixture(temporaryRoot)
  const check = {
    name: 'quality',
    argv: [
      process.execPath,
      '-e',
      "const fs=require('node:fs');process.exit(fs.readFileSync('quality.txt','utf8').trim()==='pass'?0:4)",
    ],
  }
  const [passingReport, failingReport] = await Promise.all([
    verifyDelivery({ worktree: fixture.passingWorktree, baseRef: 'main', checks: [check] }),
    verifyDelivery({ worktree: fixture.failingWorktree, baseRef: 'main', checks: [check] }),
  ])
  const goalContract = await execFile('pnpm', [
    'exec',
    'vitest',
    'run',
    'test/complete-delivery.test.ts',
    '-t',
    'atomically verifies a real linked-worktree commit and completes the exact native Goal|returns objective failed evidence and leaves the native Goal active',
    '--maxWorkers',
    '1',
  ], { cwd: deliveryPackageRoot, timeout: 120_000 })
  if (!goalContract.stdout.includes('2 passed')) {
    throw new Error('native complete_delivery Goal contract did not execute both frozen cases')
  }

  const hermesInput = join(temporaryRoot, 'hermes-input.json')
  await writeFile(hermesInput, JSON.stringify({
    cases: [
      { id: 'passing', status: passingReport.status, exitCode: passingReport.checks[0]?.exitCode },
      { id: 'failing', status: failingReport.status, exitCode: failingReport.checks[0]?.exitCode },
    ],
  }))
  const hermesHome = join(temporaryRoot, 'hermes-home')
  await mkdir(hermesHome)
  const hermesProcess = await execFile('python3', [
    join(benchmarkRoot, 'hermes-kanban-completion.py'),
    hermesRoot,
    hermesInput,
  ], {
    cwd: hermesRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_DISABLE_TELEMETRY: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    timeout: 30_000,
  })
  const hermes = JSON.parse(hermesProcess.stdout.trim())
  const result = {
    schemaVersion: 1,
    benchmarkId: manifest.id,
    revisions: manifest.revisions,
    comparable: true,
    scope: manifest.scope,
    outcome: {
      passing: {
        evoforge: passingReport.status === 'passed' ? 'complete' : 'not-complete',
        hermes: hermes.cases.passing.taskStatus === 'done' ? 'complete' : 'not-complete',
      },
      failing: {
        observedCheckExitCode: failingReport.checks[0]?.exitCode,
        evoforge: failingReport.status === 'passed' ? 'complete' : 'active',
        hermes: hermes.cases.failing.taskStatus === 'done' ? 'complete' : 'active',
      },
    },
    primaryMetric: {
      name: 'failed-check tasks accepted as complete',
      lowerIsBetter: true,
      evoforge: failingReport.status === 'passed' ? 1 : 0,
      hermes: hermes.cases.failing.taskStatus === 'done' ? 1 : 0,
    },
    hardGates: {
      evoforge: {
        passingCheckCompletes: passingReport.status === 'passed',
        failingCheckRejected: failingReport.status === 'failed',
        failingReasonExact: failingReport.reason === 'check-failed:quality',
        nativeGoalContractPassed: true,
      },
      hermes: {
        passingCheckCompletes: hermes.cases.passing.taskStatus === 'done',
        failingCheckRejected: hermes.cases.failing.taskStatus !== 'done',
        goalJudgeAvailable: hermes.goalJudgeAvailable,
        failedExitRecordedButAccepted: hermes.cases.failing.recordedExitCode === 4
          && hermes.cases.failing.taskStatus === 'done',
      },
    },
    verdict: 'better for deterministic checked Goal completion control when Hermes auxiliary goal judge is unavailable; no claim about coding-model quality or remote delivery',
  }
  assertResult(result)
  if (expectedResult !== undefined && JSON.stringify(result) !== JSON.stringify(expectedResult)) {
    throw new Error('paired result drifted from the frozen epoch; create a new epoch instead of rewriting evidence')
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function createFixture(root: string) {
  const repository = join(root, 'repository')
  const passingWorktree = join(root, 'passing-worktree')
  const failingWorktree = join(root, 'failing-worktree')
  await git(root, 'init', '--initial-branch=main', repository)
  await git(repository, 'config', 'user.name', 'EvoForge Benchmark')
  await git(repository, 'config', 'user.email', 'benchmark@example.invalid')
  await writeFile(join(repository, 'quality.txt'), 'pass\n')
  await git(repository, 'add', 'quality.txt')
  await git(repository, 'commit', '-m', 'baseline')
  await git(repository, 'worktree', 'add', '-b', 'feature/passing', passingWorktree)
  await writeFile(join(passingWorktree, 'feature.txt'), 'passing delivery\n')
  await git(passingWorktree, 'add', 'feature.txt')
  await git(passingWorktree, 'commit', '-m', 'passing delivery')
  await git(repository, 'worktree', 'add', '-b', 'feature/failing', failingWorktree, 'main')
  await writeFile(join(failingWorktree, 'quality.txt'), 'fail\n')
  await git(failingWorktree, 'add', 'quality.txt')
  await git(failingWorktree, 'commit', '-m', 'failing delivery')
  return {
    passingWorktree: await realpath(passingWorktree),
    failingWorktree: await realpath(failingWorktree),
  }
}

function assertResult(result: any): void {
  if (result.outcome.passing.evoforge !== 'complete' || result.outcome.passing.hermes !== 'complete') {
    throw new Error(`passing completion non-inferiority failed: ${JSON.stringify(result.outcome.passing)}`)
  }
  if (!Object.values(result.hardGates.evoforge).every(Boolean)) {
    throw new Error(`EvoForge hard gate failed: ${JSON.stringify(result.hardGates.evoforge)}`)
  }
  if (result.primaryMetric.evoforge !== 0 || result.primaryMetric.hermes !== 1) {
    throw new Error(`primary metric did not match the frozen expectation: ${JSON.stringify(result.primaryMetric)}`)
  }
}

async function assertRevision(repository: string, expected: string): Promise<void> {
  const actual = await git(repository, 'rev-parse', 'HEAD')
  if (actual !== expected) throw new Error(`${repository} is ${actual}, expected ${expected}`)
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, timeout: 30_000 })
  return result.stdout.trim()
}
