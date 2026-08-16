import type { JobHooks, JobStart } from '@deepseek-ai/dsh-jobs'
import { JobId, type JobRegistry } from '@deepseek-ai/dsh-jobs'
import { describe, expect, it, vi } from 'vitest'
import { createCanaryJobRunner } from '../src/counterfactual-canary-job.js'
import type { CanaryComparisonRunner } from '../src/counterfactual-canary.js'

describe('DSH Jobs Adapter for counterfactual canaries', () => {
  it('reports one bounded native Job without leaking run paths', async () => {
    const jobs = new CapturingJobs()
    const runner = createCanaryJobRunner(jobs as unknown as JobRegistry, async () => ({
      calibrationPassed: true,
      parentPassed: true,
      candidatePassed: false,
      report: { privatePath: '/private/run' },
    }))

    await expect(runner(invocation())).resolves.toMatchObject({ candidatePassed: false })
    expect(jobs.spec).toMatchObject({
      kind: 'evolution',
      label: 'retest failed Delivery Outcome',
      outputLimitBytes: 512,
    })
    expect(jobs.spec?.label).not.toContain('/private')
    await expect(jobs.hooks?.done).resolves.toEqual({
      status: 'completed',
      detail: 'candidate failed',
      output: 'calibration=pass parent=pass candidate=fail',
    })
  })

  it('relays native Job cancellation into the sealed Trial', async () => {
    const jobs = new CapturingJobs()
    const entered = vi.fn()
    const runner = createCanaryJobRunner(jobs as unknown as JobRegistry, async ({ signal }) => {
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
})

function invocation(): Parameters<CanaryComparisonRunner>[0] {
  return {
    candidate: { outputDir: '/private/run' } as Parameters<CanaryComparisonRunner>[0]['candidate'],
    generation: {} as Parameters<CanaryComparisonRunner>[0]['generation'],
    outcome: {} as Parameters<CanaryComparisonRunner>[0]['outcome'],
    signal: new AbortController().signal,
  }
}

class CapturingJobs {
  spec: JobStart | undefined
  hooks: JobHooks | undefined

  start(spec: JobStart) {
    this.spec = spec
    this.hooks = spec.run()
    return JobId('evolution-canary-1')
  }

  attachController() {
    return () => undefined
  }
}
