import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const fixture = join(packageRoot, 'test', 'fixtures', 'crash-resume.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'darwin')('Goal continuity process crash', () => {
  it('continues one durable active Goal after SIGKILL without exceeding its native round cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-goal-continuity-sigkill-'))
    temporaryRoots.push(root)
    const persistenceRoot = join(root, 'sessions')
    const seed = spawn(process.execPath, [
      '--import', 'tsx/esm', fixture, 'seed', persistenceRoot, dshSourceDir,
    ], {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForReady(seed)
    const terminationPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      seed.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })
    expect(seed.kill('SIGKILL')).toBe(true)
    const termination = await terminationPromise
    expect(termination).toEqual({ code: null, signal: 'SIGKILL' })

    const resumed = await execFile(process.execPath, [
      '--import', 'tsx/esm', fixture, 'resume', persistenceRoot, dshSourceDir,
    ], { cwd: packageRoot, encoding: 'utf8', timeout: 15_000 })
    const result = JSON.parse(resumed.stdout.trim()) as {
      requests: number
      goal: { phase: string; activation: string; roundsStarted: number; maxGoalRounds: number }
    }
    expect(result).toEqual({
      requests: 1,
      goal: expect.objectContaining({
        phase: 'blocked',
        activation: 'disarmed',
        roundsStarted: 1,
        maxGoalRounds: 1,
      }),
    })
  }, 30_000)
})

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
      finish(() => rejectReady(
        new Error(`seed process exited before ready: code=${code} signal=${signal}: ${stderr}`),
      ))
    }
    const timeout = setTimeout(() => {
      finish(() => rejectReady(new Error(`seed process did not become ready: ${stderr}`)))
    }, 10_000)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (!stdout.includes('READY\n')) return
      finish(resolveReady)
    })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.once('exit', onExit)
  })
}
