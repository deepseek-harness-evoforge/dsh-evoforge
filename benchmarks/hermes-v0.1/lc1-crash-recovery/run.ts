import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const continuityRoot = join(suiteRoot, 'packages', 'dsh-goal-continuity')
const dshRoot = resolve(process.env.DSH_EVOLVE_DSH_SOURCE_DIR ?? resolve(suiteRoot, '../deepseek-harness'))
const hermesRoot = resolve(process.env.EVOFORGE_HERMES_SOURCE_DIR ?? resolve(suiteRoot, '../hermes-agent'))
const manifest = JSON.parse(await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8'))
const expectedResult = JSON.parse(await readFile(join(benchmarkRoot, 'result.json'), 'utf8'))
const temporaryRoot = await mkdtemp(join(tmpdir(), 'evoforge-hermes-lc1-'))

try {
  if (process.platform !== 'darwin') {
    throw new Error('LC-1 epoch 1 is frozen to macOS process and persistence semantics')
  }
  await assertRevision(dshRoot, manifest.revisions.deepseekHarness)
  await assertRevision(hermesRoot, manifest.revisions.hermesAgent)

  const evoforge = await runEvoforgeCrash(join(temporaryRoot, 'dsh-sessions'))
  const hermesHome = join(temporaryRoot, 'hermes-home')
  await mkdir(hermesHome)
  const hermesProcess = await execFile('python3', [
    join(benchmarkRoot, 'hermes-kanban-crash.py'),
    hermesRoot,
  ], {
    cwd: hermesRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      HERMES_DISABLE_TELEMETRY: '1',
      HERMES_KANBAN_CRASH_GRACE_SECONDS: '0',
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
    comparisonBoundary: {
      comparableOutcomes: manifest.comparison.comparableOutcomes,
      nonComparableOutcomes: manifest.comparison.nonComparableOutcomes,
    },
    outcome: {
      evoforge: {
        processSignal: evoforge.termination.signal,
        recoveryActions: evoforge.requests,
        authoritativeStateAfterRecovery: evoforge.goal.phase,
        roundsStarted: evoforge.goal.roundsStarted,
        maxGoalRounds: evoforge.goal.maxGoalRounds,
      },
      hermes: {
        processSignal: hermes.processSignal,
        recoveryActions: hermes.secondRunId > hermes.firstRunId ? 1 : 0,
        stateAfterStorageReopen: hermes.statusAfterReopen,
        stateAfterStaleOwnerAttempt: hermes.statusAfterStaleAttempt,
        authoritativeStateAfterRecovery: hermes.finalStatus,
        crashDetections: hermes.firstCrashDetections,
        repeatedCrashDetections: hermes.secondCrashDetections,
        staleOwnerMutationAccepted: hermes.staleOwnerMutationAccepted,
        successorCompletionAccepted: hermes.completionAccepted,
        duplicateCompletionAccepted: hermes.duplicateCompletionAccepted,
        completedEvents: hermes.completedEvents,
        runOutcomes: hermes.runOutcomes,
      },
    },
    primaryMetric: {
      name: 'lost authoritative work units after one local SIGKILL',
      lowerIsBetter: true,
      evoforge: evoforge.goal === undefined ? 1 : 0,
      hermes: hermes.finalStatus == null ? 1 : 0,
    },
    secondaryMetrics: {
      duplicateRecoveryActions: {
        lowerIsBetter: true,
        evoforge: Math.max(0, evoforge.requests - 1),
        hermes: Math.max(0, hermes.completedEvents - 1),
      },
    },
    hardGates: {
      evoforge: {
        actualSigkill: evoforge.termination.signal === 'SIGKILL',
        exactlyOneRecoveryAction: evoforge.requests === 1,
        nativeRoundBoundHeld: evoforge.goal.phase === 'blocked'
          && evoforge.goal.roundsStarted === 1
          && evoforge.goal.maxGoalRounds === 1,
      },
      hermes: {
        actualSigkill: hermes.processSignal === 'SIGKILL',
        canonicalTaskRecovered: hermes.statusAfterReopen === 'ready',
        crashDetectedOnce: hermes.firstCrashDetections === 1
          && hermes.secondCrashDetections === 0,
        staleOwnerRejected: hermes.staleOwnerMutationAccepted === false
          && hermes.statusAfterStaleAttempt === 'running',
        successorCompletedOnce: hermes.completionAccepted === true
          && hermes.duplicateCompletionAccepted === false
          && hermes.completedEvents === 1,
        runHistoryExact: JSON.stringify(hermes.runOutcomes) === JSON.stringify(['crashed', 'completed']),
      },
    },
    verdict: 'tie on bounded local durable-work recovery; no superiority, high-availability, recovery-latency, or external exactly-once claim',
  }
  assertResult(result)
  if (JSON.stringify(result) !== JSON.stringify(expectedResult)) {
    throw new Error('paired result drifted from the frozen epoch; create a new epoch instead of rewriting evidence')
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function runEvoforgeCrash(persistenceRoot: string): Promise<any> {
  const fixture = join(continuityRoot, 'test', 'fixtures', 'crash-resume.ts')
  const seed = spawn(process.execPath, [
    '--import', 'tsx/esm', fixture, 'seed', persistenceRoot, dshRoot,
  ], {
    cwd: continuityRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForReady(seed)
    const terminationPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      seed.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })
    if (!seed.kill('SIGKILL')) throw new Error('failed to SIGKILL the EvoForge seed process')
    const termination = await terminationPromise
    const resumed = await execFile(process.execPath, [
      '--import', 'tsx/esm', fixture, 'resume', persistenceRoot, dshRoot,
    ], { cwd: continuityRoot, encoding: 'utf8', timeout: 15_000 })
    return { termination, ...JSON.parse(resumed.stdout.trim()) }
  } finally {
    if (seed.exitCode === null && seed.signalCode === null) seed.kill('SIGKILL')
  }
}

async function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolveReady, rejectReady) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('exit', onExit)
      action()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => rejectReady(new Error(
        `EvoForge seed exited before ready: code=${code} signal=${signal}: ${stderr}`,
      )))
    }
    const timeout = setTimeout(() => {
      finish(() => rejectReady(new Error(`EvoForge seed did not become ready: ${stderr}`)))
    }, 10_000)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.includes('READY\n')) finish(resolveReady)
    })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.once('exit', onExit)
  })
}

function assertResult(result: any): void {
  if (!Object.values(result.hardGates.evoforge).every(Boolean)) {
    throw new Error(`EvoForge hard gate failed: ${JSON.stringify(result.hardGates.evoforge)}`)
  }
  if (!Object.values(result.hardGates.hermes).every(Boolean)) {
    throw new Error(`Hermes hard gate failed: ${JSON.stringify(result.hardGates.hermes)}`)
  }
  if (result.primaryMetric.evoforge !== 0 || result.primaryMetric.hermes !== 0) {
    throw new Error(`crash recovery non-inferiority failed: ${JSON.stringify(result.primaryMetric)}`)
  }
  if (result.secondaryMetrics.duplicateRecoveryActions.evoforge !== 0
    || result.secondaryMetrics.duplicateRecoveryActions.hermes !== 0) {
    throw new Error(`duplicate recovery action detected: ${JSON.stringify(result.secondaryMetrics)}`)
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
