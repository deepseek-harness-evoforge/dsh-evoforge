import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { JobId, type JobRegistry } from '@deepseek-ai/dsh-jobs'
import { describe, expect, it, vi } from 'vitest'
import { createShadowJobRunner } from '../src/shadow-job-runner.js'
import { ShadowRecoveryPaused } from '../src/shadow-supervisor.js'

describe('DSH Jobs adapter for Shadow recovery', () => {
  it('reports one completed host job without putting the run path in its label', async () => {
    const jobs = new CapturingJobs()
    const runner = createShadowJobRunner(jobs as unknown as JobRegistry, async () => ({
      status: 'complete',
      reportPath: '/private/run/report.json',
      summary: 'promote: held-out case passed',
    }))

    const result = await runner(invocation())
    const outcome = await jobs.hooks?.done

    expect(result.status).toBe('complete')
    expect(jobs.spec).toMatchObject({
      kind: 'evolution',
      label: 'resume durable Shadow Trial',
      outputLimitBytes: 2_048,
    })
    expect(jobs.spec?.label).not.toContain('/private')
    expect(outcome).toEqual({
      status: 'completed',
      detail: 'complete',
      output: 'promote: held-out case passed',
    })
  })

  it('cancels the sealed work through the DSH Job and settles killed', async () => {
    const jobs = new CapturingJobs()
    const entered = vi.fn()
    const runner = createShadowJobRunner(jobs as unknown as JobRegistry, async ({ signal }) => {
      entered()
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      throw new Error('unreachable')
    })

    const running = runner(invocation())
    expect(entered).toHaveBeenCalledOnce()
    jobs.hooks?.cancel('operator stop')

    await expect(running).rejects.toThrow('operator stop')
    await expect(jobs.hooks?.done).resolves.toEqual({
      status: 'killed',
      detail: 'operator stop',
    })
  })

  it('contains a recovery failure as a failed Job while preserving the runner error', async () => {
    const jobs = new CapturingJobs()
    const runner = createShadowJobRunner(jobs as unknown as JobRegistry, async () => {
      throw new Error('disk unavailable')
    })

    await expect(runner(invocation())).rejects.toThrow('disk unavailable')
    await expect(jobs.hooks?.done).resolves.toEqual({
      status: 'failed',
      detail: 'disk unavailable',
    })
  })

  it('preserves a durable owner pause so the supervisor can rediscover the run', async () => {
    const jobs = new CapturingJobs()
    const owner = new AbortController()
    const runner = createShadowJobRunner(jobs as unknown as JobRegistry, async ({ signal }) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      throw new Error('unreachable')
    })

    const running = runner({ ...invocation(), signal: owner.signal })
    owner.abort(new ShadowRecoveryPaused('durable pause'))

    await expect(running).rejects.toBeInstanceOf(ShadowRecoveryPaused)
    await expect(jobs.hooks?.done).resolves.toMatchObject({
      status: 'killed',
      detail: 'durable pause',
    })
  })
})

function invocation() {
  return {
    casePackDir: '/private/case-pack',
    outputDir: '/private/run',
    resume: true as const,
    signal: new AbortController().signal,
    skillDir: '/private/skill',
    exactCandidate: {
      claim: 'resume exact internal Candidate',
      skillDir: '/private/candidate',
    },
  }
}

class CapturingJobs {
  spec: JobStart | undefined
  hooks: JobHooks | undefined

  start(spec: JobStart) {
    this.spec = spec
    this.hooks = spec.run()
    return JobId('evolution-1')
  }

  attachController() {
    return () => undefined
  }
}
