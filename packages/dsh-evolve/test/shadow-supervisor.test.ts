import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ShadowRecoveryCancelled,
  ShadowSupervisor,
  type ShadowResumeInvocation,
} from '../src/shadow-supervisor.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('Shadow supervisor', () => {
  it('resumes only durable no-network phases and never follows symlinked runs', async () => {
    const runRoot = await createRunRoot()
    const phases = [
      'prepared',
      'proposal-pending',
      'candidate-ready',
      'trial-running',
      'complete',
      'incomplete',
    ] as const
    for (const phase of phases) await writeRun(runRoot, phase, phase)
    await writeRun(runRoot, 'missing-inputs', 'candidate-ready', false)
    const outside = await createRunRoot()
    await writeRun(outside, 'outside', 'candidate-ready')
    await import('node:fs/promises').then(({ symlink }) =>
      symlink(join(outside, 'outside'), join(runRoot, 'linked-run')),
    )

    const invocations: ShadowResumeInvocation[] = []
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      runner: async invocation => {
        invocations.push(invocation)
        return { status: 'complete', reportPath: 'report.json', summary: 'done' }
      },
    })

    await supervisor.scanOnce()

    const exactRunRoot = await realpath(runRoot)
    expect(invocations.map(invocation => invocation.outputDir).sort()).toEqual([
      join(exactRunRoot, 'candidate-ready'),
      join(exactRunRoot, 'trial-running'),
    ])
    expect(invocations.every(invocation => invocation.resume)).toBe(true)
  })

  it('coalesces overlapping scans and aborts active recovery on stop', async () => {
    const runRoot = await createRunRoot()
    await writeRun(runRoot, 'candidate-ready', 'candidate-ready')
    let release!: () => void
    const entered = new Promise<void>(resolve => { release = resolve })
    const runner = vi.fn(async ({ signal }: ShadowResumeInvocation) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
        release()
      })
      throw signal.reason
    })
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      runner,
    })

    const first = supervisor.scanOnce()
    await entered
    const second = supervisor.scanOnce()
    expect(second).toBe(first)
    await supervisor.stop()
    await expect(first).resolves.toBeUndefined()
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('keeps scanning after an unreadable or failed run and does not retry it in the same pass', async () => {
    const runRoot = await createRunRoot()
    await mkdir(join(runRoot, 'broken'))
    await writeFile(join(runRoot, 'broken', 'run-state.json'), '{')
    await writeRun(runRoot, 'first', 'candidate-ready')
    await writeRun(runRoot, 'second', 'candidate-ready')
    const errors: string[] = []
    const calls: string[] = []
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      onError: (error, outputDir) => errors.push(`${outputDir}:${String(error)}`),
      runner: async (invocation) => {
        calls.push(invocation.outputDir)
        if (invocation.outputDir.endsWith('/first')) throw new Error('disk unavailable')
        return { status: 'complete', reportPath: 'report.json', summary: 'done' }
      },
    })

    await supervisor.scanOnce()

    const exactRunRoot = await realpath(runRoot)
    expect(calls.sort()).toEqual([join(exactRunRoot, 'first'), join(exactRunRoot, 'second')])
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toContain('run-state.json')
    expect(errors.join('\n')).toContain('disk unavailable')
  })

  it('does not duplicate a completed recovery across 250 repeated scans', async () => {
    const runRoot = await createRunRoot()
    await writeRun(runRoot, 'candidate-ready', 'candidate-ready')
    let calls = 0
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      runner: async (invocation) => {
        calls += 1
        const source = JSON.parse(await import('node:fs/promises').then(({ readFile }) =>
          readFile(join(invocation.outputDir, 'run-state.json'), 'utf8')))
        await writeFile(join(invocation.outputDir, 'run-state.json'), `${JSON.stringify({
          ...source,
          phase: 'complete',
          outcome: { kind: 'complete', reportPath: 'report.json', summary: 'done' },
        })}\n`)
        return { status: 'complete', reportPath: 'report.json', summary: 'done' }
      },
    })

    await supervisor.scanOnce()
    for (let index = 0; index < 249; index += 1) await supervisor.scanOnce()
    await supervisor.stop()

    expect(calls).toBe(1)
  })

  it('does not restart a natively cancelled Job until the resident DSH process restarts', async () => {
    const runRoot = await createRunRoot()
    await writeRun(runRoot, 'candidate-ready', 'candidate-ready')
    const runner = vi.fn(async () => {
      throw new ShadowRecoveryCancelled('operator stop')
    })
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      runner,
    })

    await supervisor.scanOnce()
    await supervisor.scanOnce()

    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('starts durably paused and resumes discovery only after an explicit wake', async () => {
    const runRoot = await createRunRoot()
    await writeRun(runRoot, 'candidate-ready', 'candidate-ready')
    const runner = vi.fn(async () => ({
      status: 'complete' as const,
      reportPath: 'report.json',
      summary: 'done',
    }))
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      paused: true,
      runner,
    })

    supervisor.start()
    await supervisor.scanOnce()
    expect(runner).not.toHaveBeenCalled()

    supervisor.resume()
    await supervisor.scanOnce()
    expect(runner).toHaveBeenCalledTimes(1)
    await supervisor.stop()
  })

  it('pauses an active recovery without suppressing its durable run after resume', async () => {
    const runRoot = await createRunRoot()
    await writeRun(runRoot, 'candidate-ready', 'candidate-ready')
    let entered!: () => void
    const firstEntered = new Promise<void>(resolve => { entered = resolve })
    let calls = 0
    const supervisor = new ShadowSupervisor({
      runRoots: [runRoot],
      scanIntervalMs: 10_000,
      runner: async ({ signal }) => {
        calls += 1
        if (calls > 1) return { status: 'complete', reportPath: 'report.json', summary: 'done' }
        entered()
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        throw signal.reason
      },
    })

    const active = supervisor.scanOnce()
    await firstEntered
    await supervisor.pause()
    await active
    await supervisor.scanOnce()
    expect(calls).toBe(1)

    supervisor.resume()
    await supervisor.scanOnce()
    expect(calls).toBe(2)
    await supervisor.stop()
  })
})

async function createRunRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolve-supervisor-'))
  temporaryRoots.push(root)
  return root
}

async function writeRun(
  runRoot: string,
  name: string,
  phase: 'prepared' | 'proposal-pending' | 'candidate-ready' | 'trial-running' | 'complete' | 'incomplete',
  withInputs = true,
): Promise<void> {
  const outputDir = join(runRoot, name)
  await mkdir(outputDir)
  const state = {
    schemaVersion: 1,
    runId: 'a'.repeat(64),
    phase,
    startedAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    identity: {
      baseTreeHash: 'b'.repeat(64),
      casePackHash: 'c'.repeat(64),
      dshRevision: 'fixture',
      evaluatorVersion: 'fixture',
      modelConfigHash: 'd'.repeat(64),
      modelRoute: 'fixture',
      skillName: 'fixture',
    },
    ...(withInputs ? {
      resumeInputs: {
        skillDir: join(runRoot, 'skill'),
        casePackDir: join(runRoot, 'case-pack'),
      },
    } : {}),
  }
  await writeFile(join(outputDir, 'run-state.json'), `${JSON.stringify(state)}\n`)
}
