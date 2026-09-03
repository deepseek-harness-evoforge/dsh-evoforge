import { execFile as execFileCallback, spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const suiteRoot = resolve(packageRoot, '../..')
const rawDshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  ?? resolve(suiteRoot, '../deepseek-harness')
const driver = join(packageRoot, 'test', 'fixtures', 'delivery-outcome-process-crash.mjs')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('Delivery Outcome process crash recovery', () => {
  it('never repeats complete_delivery and only replays a pair that crossed Session durability', async () => {
    const beforeRoot = await createFixtureRoot('before-checkpoint')
    await expectCrash(beforeRoot, 'before-session-durable', 'BEFORE_SESSION_DURABLE')
    expect(await inspect(beforeRoot)).toEqual({
      effectCount: 1,
      outcomeCount: 0,
      sessionPresent: false,
    })

    const afterRoot = await createFixtureRoot('after-checkpoint')
    await expectCrash(afterRoot, 'after-session-durable', 'AFTER_SESSION_DURABLE')
    expect(await inspect(afterRoot)).toEqual({
      effectCount: 1,
      goalPhase: 'complete',
      modelRequests: 0,
      outcomeCount: 1,
      sessionPresent: true,
      toolCalls: 1,
      toolResults: 1,
    })
    expect((await readFile(join(afterRoot, 'external-effects.log'), 'utf8')).trim().split('\n'))
      .toEqual(['complete_delivery'])
  }, 60_000)
})

async function createFixtureRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-delivery-outcome-${label}-`))
  temporaryRoots.push(root)
  const repository = join(root, 'repository')
  const worktree = join(root, 'delivery-worktree')
  await git(root, 'init', '--initial-branch=main', repository)
  await git(repository, 'config', 'user.name', 'DSH Delivery Crash Test')
  await git(repository, 'config', 'user.email', 'delivery-crash@example.invalid')
  await writeFile(join(repository, 'README.md'), 'baseline\n')
  await git(repository, 'add', 'README.md')
  await git(repository, 'commit', '-m', 'baseline')
  await git(repository, 'worktree', 'add', '-b', 'feature/crash-proof', worktree)
  await writeFile(join(worktree, 'feature.txt'), 'verified before crash\n')
  await git(worktree, 'add', 'feature.txt')
  await git(worktree, 'commit', '-m', 'deliver crash proof')
  await writeFile(join(root, 'fixture.json'), JSON.stringify({
    worktree: await realpath(worktree),
    baseRef: 'main',
    effectPath: join(root, 'external-effects.log'),
  }))
  return root
}

async function expectCrash(root: string, mode: string, ready: string): Promise<void> {
  const dshSourceDir = await realpath(rawDshSourceDir)
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', driver, mode, root, dshSourceDir, suiteRoot,
  ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  await waitForReady(child, ready)
  const termination = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
    child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
  })
  expect(child.kill('SIGKILL')).toBe(true)
  expect(await termination).toEqual({ code: null, signal: 'SIGKILL' })
}

async function inspect(root: string): Promise<Record<string, unknown>> {
  const dshSourceDir = await realpath(rawDshSourceDir)
  const result = await execFile(process.execPath, [
    '--import', 'tsx/esm', driver, 'inspect', root, dshSourceDir, suiteRoot,
  ], { cwd: packageRoot, encoding: 'utf8', timeout: 20_000 })
  const line = result.stdout.trim().split('\n').reverse().find(value => value.startsWith('{'))
  if (line === undefined) throw new Error(`crash inspector produced no result: ${result.stdout}`)
  return JSON.parse(line) as Record<string, unknown>
}

async function waitForReady(child: ReturnType<typeof spawn>, ready: string): Promise<void> {
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
        `crash driver exited before ${ready}: code=${code} signal=${signal}\n${stdout}${stderr}`,
      )))
    }
    const timeout = setTimeout(() => {
      finish(() => rejectReady(new Error(`crash driver did not reach ${ready}:\n${stdout}${stderr}`)))
    }, 20_000)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      if (stdout.includes(`${ready}\n`)) finish(resolveReady)
    })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.once('exit', onExit)
  })
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim()
}
