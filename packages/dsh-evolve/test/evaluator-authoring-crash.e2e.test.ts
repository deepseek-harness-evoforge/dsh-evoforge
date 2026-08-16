import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const driverPath = join(packageRoot, 'test', 'fixtures', 'evaluator-authoring-crash-driver.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Evaluator authoring crash recovery', () => {
  it('does not repeat a paid author request after SIGKILL leaves a durable pending outcome', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-evaluator-crash-'))
    temporaryRoots.push(root)
    const skillDir = join(root, 'skill')
    await mkdir(skillDir)
    await writeFile(join(skillDir, 'SKILL.md'), [
      '---',
      'name: build-dsh-plugin',
      'description: fixture',
      '---',
      '',
      'Original behavior.',
      '',
    ].join('\n'))

    let requests = 0
    let idempotencyKey: string | undefined
    const server = createServer((request) => {
      requests += 1
      idempotencyKey = request.headers['idempotency-key'] as string | undefined
      // Deliberately never answer: SIGKILL lands after the external service has
      // observed the paid request but before the host can observe its outcome.
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('author server did not bind')
    const env = {
      ...process.env,
      DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      DSH_EVOLVE_MODEL_NAME: 'uncertain-evaluator-author',
      DSH_EVOLVE_MODEL_API_KEY: 'must-not-enter-durable-state',
    }
    const args = ['--import', 'tsx', driverPath, root]
    const first = spawn(process.execPath, args, {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitFor(async () => (await readPhase(root)) === 'authoring-pending' && requests === 1)
      first.kill('SIGKILL')
      await waitForClose(first)

      const second = spawn(process.execPath, args, {
        cwd: packageRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const output = await collect(second)
      expect(output.code).toBe(0)
      expect(output.stderr).toBe('')
      expect(JSON.parse(output.stdout.trim())).toMatchObject({
        action: 'author-evaluator',
        draftStatus: 'uncertain',
      })
      expect(requests).toBe(1)
      expect(idempotencyKey).toMatch(/^[a-f0-9]{64}$/)

      const statePath = await findStatePath(root)
      const stateSource = await readFile(statePath, 'utf8')
      expect(stateSource).not.toContain('must-not-enter-durable-state')
      expect(JSON.parse(stateSource)).toMatchObject({
        schemaVersion: 1,
        phase: 'authoring-pending',
        cost: { modelCalls: 1, inputTokens: 0, outputTokens: 0 },
      })
    } finally {
      first.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  }, 20_000)
})

async function readPhase(root: string): Promise<unknown> {
  try {
    const launches = await readdir(join(root, 'owned', 'runs'))
    if (launches.length === 0) return undefined
    if (launches.length !== 1) {
      throw new Error(`expected one evaluator launch, got ${launches.length}`)
    }
    return JSON.parse(await readFile(join(root, 'owned', 'runs', launches[0]!, 'run-state.json'), 'utf8')).phase
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

async function findStatePath(root: string): Promise<string> {
  const launches = await readdir(join(root, 'owned', 'runs'))
  if (launches.length !== 1) throw new Error(`expected one evaluator launch, got ${launches.length}`)
  return join(root, 'owned', 'runs', launches[0]!, 'run-state.json')
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 20))
  }
  throw new Error('timed out waiting for durable evaluator authoring checkpoint')
}

function waitForClose(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    child.once('close', () => resolveClose())
    child.once('error', rejectClose)
  })
}

function collect(child: ReturnType<typeof spawn>): Promise<{
  code: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolveCollect, rejectCollect) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr?.on('data', chunk => stderr.push(chunk))
    child.once('error', rejectCollect)
    child.once('close', code => resolveCollect({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}
