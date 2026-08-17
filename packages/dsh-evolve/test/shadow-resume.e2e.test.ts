import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runShadow } from '../src/shadow.js'
import { ShadowSupervisor } from '../src/shadow-supervisor.js'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = join(packageRoot, 'test', 'fixtures', 'shadow-driver.ts')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('durable Shadow resume', () => {
  it('does not repeat a paid proposal whose outcome became uncertain after SIGKILL', async () => {
    const fixture = await createFixture()
    let requests = 0
    let idempotencyKey: string | undefined
    const server = createServer((request) => {
      requests += 1
      idempotencyKey = request.headers['idempotency-key'] as string | undefined
      // Leave the response unresolved so SIGKILL lands after the durable intent
      // and after the external service has observed the request.
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('proposal server did not bind')
    const env = {
      ...process.env,
      DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      DSH_EVOLVE_MODEL_NAME: 'uncertain-proposal-model',
      DSH_EVOLVE_MODEL_API_KEY: 'must-not-enter-run-state',
    }
    const args = shadowArgs(fixture)
    const first = spawn(process.execPath, args, {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitFor(async () => {
        const state = await readState(fixture.outputDir)
        return state?.phase === 'proposal-pending' && requests === 1
      })
      let concurrentFailure: unknown
      try {
        await execFile(process.execPath, [...args, '--resume'], {
          cwd: packageRoot,
          env,
          timeout: 5_000,
        })
      } catch (error) {
        concurrentFailure = error
      }
      expect(concurrentFailure).toMatchObject({
        code: 1,
        stdout: '',
      })
      expect((concurrentFailure as { stderr?: string }).stderr)
        .toMatch(/^error: Shadow run is already owned by live process \d+\n$/)
      expect(requests).toBe(1)

      first.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) => {
        first.once('close', () => resolveClose())
        first.once('error', rejectClose)
      })

      let failure: unknown
      try {
        await execFile(process.execPath, [...args, '--resume'], {
          cwd: packageRoot,
          env,
          timeout: 10_000,
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toMatchObject({
        code: 2,
        stdout: '',
        stderr: 'incomplete: proposal outcome is uncertain after interruption; refusing automatic retry\n',
      })
      expect(requests).toBe(1)
      expect(idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
      const stateSource = await readFile(join(fixture.outputDir, 'run-state.json'), 'utf8')
      expect(stateSource).not.toContain('must-not-enter-run-state')
      const state = JSON.parse(stateSource)
      expect(state).toMatchObject({
        schemaVersion: 1,
        phase: 'incomplete',
        outcome: {
          kind: 'incomplete',
          reason: 'proposal outcome is uncertain after interruption; refusing automatic retry',
        },
        resumeInputs: {
          skillDir: await realpath(fixture.skillDir),
          casePackDir: await realpath(fixture.casePackDir),
        },
      })
      expect(JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8')).run.id)
        .toBe(state.runId)
    } finally {
      first.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  }, 20_000)

  it.skipIf(process.platform !== 'darwin')('reuses the durable Candidate and reruns only the sealed Trial after SIGKILL', async () => {
    const fixture = await createTrialFixture()
    const originalSkill = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
    const correctedSkill = `${originalSkill.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser.\n`
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              claim: 'Require controlled browser verification',
              files: [{ path: 'SKILL.md', content: correctedSkill }],
            }),
          },
        }],
        usage: { prompt_tokens: 120, completion_tokens: 32 },
      }))
    })
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('proposal server did not bind')
    const env = {
      ...process.env,
      DSH_EVOLVE_MODEL_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      DSH_EVOLVE_MODEL_NAME: 'resumable-trial-model',
    }
    const args = shadowArgs(fixture)
    const first = spawn(process.execPath, args, {
      cwd: packageRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitFor(async () => (await readState(fixture.outputDir))?.phase === 'trial-running')
      first.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) => {
        first.once('close', () => resolveClose())
        first.once('error', rejectClose)
      })

      const previousBaseUrl = process.env.DSH_EVOLVE_MODEL_BASE_URL
      const previousModel = process.env.DSH_EVOLVE_MODEL_NAME
      process.env.DSH_EVOLVE_MODEL_BASE_URL = env.DSH_EVOLVE_MODEL_BASE_URL
      process.env.DSH_EVOLVE_MODEL_NAME = env.DSH_EVOLVE_MODEL_NAME
      try {
        const controller = new AbortController()
        const interrupted = runShadow({
          casePackDir: fixture.casePackDir,
          outputDir: fixture.outputDir,
          resume: true,
          signal: controller.signal,
          skillDir: fixture.skillDir,
        })
        setTimeout(() => controller.abort(new Error('resident DSH shutdown')), 100)
        await expect(interrupted).rejects.toThrow('resident DSH shutdown')
      } finally {
        if (previousBaseUrl === undefined) delete process.env.DSH_EVOLVE_MODEL_BASE_URL
        else process.env.DSH_EVOLVE_MODEL_BASE_URL = previousBaseUrl
        if (previousModel === undefined) delete process.env.DSH_EVOLVE_MODEL_NAME
        else process.env.DSH_EVOLVE_MODEL_NAME = previousModel
      }
      const interruptedState = await readState(fixture.outputDir)
      expect(interruptedState).toMatchObject({ phase: 'trial-running' })
      expect(interruptedState).not.toHaveProperty('outcome')

      const previousBaseUrlForSupervisor = process.env.DSH_EVOLVE_MODEL_BASE_URL
      const previousModelForSupervisor = process.env.DSH_EVOLVE_MODEL_NAME
      process.env.DSH_EVOLVE_MODEL_BASE_URL = env.DSH_EVOLVE_MODEL_BASE_URL
      process.env.DSH_EVOLVE_MODEL_NAME = env.DSH_EVOLVE_MODEL_NAME
      try {
        const errors: unknown[] = []
        const supervisor = new ShadowSupervisor({
          runRoots: [dirname(fixture.outputDir)],
          scanIntervalMs: 30_000,
          onError: error => errors.push(error),
        })
        await supervisor.scanOnce()
        expect(errors).toEqual([])
      } finally {
        if (previousBaseUrlForSupervisor === undefined) delete process.env.DSH_EVOLVE_MODEL_BASE_URL
        else process.env.DSH_EVOLVE_MODEL_BASE_URL = previousBaseUrlForSupervisor
        if (previousModelForSupervisor === undefined) delete process.env.DSH_EVOLVE_MODEL_NAME
        else process.env.DSH_EVOLVE_MODEL_NAME = previousModelForSupervisor
      }

      expect(requests).toBe(1)
      expect(await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')).toBe(originalSkill)
      const state = JSON.parse(await readFile(join(fixture.outputDir, 'run-state.json'), 'utf8'))
      expect(state).toMatchObject({
        schemaVersion: 1,
        phase: 'complete',
        outcome: { kind: 'complete' },
        modelUsage: { inputTokens: 120, outputTokens: 32 },
      })
      const report = JSON.parse(await readFile(join(fixture.outputDir, 'report.json'), 'utf8'))
      expect(report.run.id).toBe(state.runId)
      expect(report.run.startedAt).toBe(state.startedAt)
      expect(report.decision).toMatchObject({ recommendation: 'promote' })
    } finally {
      first.kill('SIGKILL')
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close(error => error ? rejectClose(error) : resolveClose()),
      )
    }
  }, 20_000)
})

interface Fixture {
  casePackDir: string
  outputDir: string
  skillDir: string
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-shadow-resume-'))
  temporaryRoots.push(root)
  const skillDir = join(root, 'skill')
  const casePackDir = join(root, 'case-pack')
  await mkdir(skillDir)
  await mkdir(casePackDir)
  await writeFile(join(skillDir, 'SKILL.md'), [
    '---',
    'name: resumable-skill',
    'description: Exercise durable Shadow recovery.',
    '---',
    '',
    '# Resumable Skill',
    '',
  ].join('\n'))
  await writeFile(join(casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'durable-shadow-resume',
    epoch: { dshRevision: 'fixture', evaluatorVersion: 'resume-v1' },
    budget: {
      candidateLimit: 1,
      trialLimit: 1,
      inputTokenLimit: 2_000,
      outputTokenLimit: 400,
    },
  }, null, 2)}\n`)
  return { casePackDir, outputDir: join(root, 'run'), skillDir }
}

async function createTrialFixture(): Promise<Fixture> {
  const fixture = await createFixture()
  const bad = join(fixture.casePackDir, 'calibration', 'known-bad')
  const correction = join(fixture.casePackDir, 'calibration', 'known-correction')
  const finalTest = join(fixture.casePackDir, 'final-test')
  await mkdir(bad, { recursive: true })
  await mkdir(correction, { recursive: true })
  await mkdir(finalTest, { recursive: true })
  const base = await readFile(join(fixture.skillDir, 'SKILL.md'), 'utf8')
  await writeFile(join(bad, 'SKILL.md'), base)
  await writeFile(
    join(correction, 'SKILL.md'),
    `${base.trimEnd()}\n\nFor Web or GUI work, verify the real flow in a controlled browser.\n`,
  )
  await writeFile(join(finalTest, 'evaluator.mjs'), [
    "import { readFile } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)',
    "const source = await readFile(join(process.argv[2], 'SKILL.md'), 'utf8')",
    "const passed = source.includes('verify the real flow in a controlled browser')",
    "process.stdout.write(JSON.stringify({ schemaVersion: 1, passed, checks: [{ name: 'browser', passed }] }))",
    '',
  ].join('\n'))
  await writeFile(join(fixture.casePackDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 'durable-trial-resume',
    epoch: { dshRevision: 'fixture', evaluatorVersion: 'resume-trial-v1' },
    budget: {
      candidateLimit: 1,
      trialLimit: 4,
      inputTokenLimit: 2_000,
      outputTokenLimit: 400,
    },
    trial: {
      evaluator: 'final-test/evaluator.mjs',
      timeoutMs: 2_000,
      outputLimitBytes: 16_384,
    },
    calibration: {
      knownBad: 'calibration/known-bad',
      knownCorrection: 'calibration/known-correction',
    },
  }, null, 2)}\n`)
  return fixture
}

function shadowArgs(fixture: Fixture): string[] {
  return [
    '--import', 'tsx', cliPath, 'shadow', fixture.skillDir,
    '--case-pack', fixture.casePackDir,
    '--output', fixture.outputDir,
  ]
}

async function readState(outputDir: string): Promise<{ phase?: unknown } | undefined> {
  try {
    return JSON.parse(await readFile(join(outputDir, 'run-state.json'), 'utf8'))
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
  throw new Error('timed out waiting for durable Shadow checkpoint')
}
