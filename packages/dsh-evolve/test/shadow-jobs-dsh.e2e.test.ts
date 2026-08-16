import { Context } from '@deepseek-ai/cordis'
import { JobId, type JobRegistry } from '@deepseek-ai/dsh-jobs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createShadowJobRunner } from '../src/shadow-job-runner.js'
import { createCanaryJobRunner } from '../src/counterfactual-canary-job.js'
import type { CanaryComparisonRunner } from '../src/counterfactual-canary.js'

const dshSourceDir = process.env.DSH_EVOLVE_DSH_SOURCE_DIR

describe.skipIf(dshSourceDir === undefined)('pinned DSH Jobs integration', () => {
  it('appears as one native background Job and settles through the real registry', async () => {
    const source = resolve(dshSourceDir!)
    const { default: LocalJobRegistry } = await import(pathToFileURL(
      join(source, 'packages', 'jobs', 'jobs-local', 'lib', 'index.js'),
    ).href)
    const ctx = new Context()
    await ctx.plugin(LocalJobRegistry)
    const jobs = ctx.get('jobs') as JobRegistry | undefined
    expect(jobs).toBeDefined()
    if (jobs === undefined) throw new Error('pinned DSH Jobs service did not load')
    jobs.attachController('test')
    const runner = createShadowJobRunner(jobs, async () => ({
      status: 'complete',
      reportPath: '/private/run/report.json',
      summary: 'review: stable baseline',
    }))

    try {
      await expect(runner({
        casePackDir: '/private/case-pack',
        outputDir: '/private/run',
        resume: true,
        signal: new AbortController().signal,
        skillDir: '/private/skill',
      })).resolves.toMatchObject({ status: 'complete' })
      await expect(jobs.wait(JobId('evolution-1'), 1_000)).resolves.toMatchObject({
        id: 'evolution-1',
        kind: 'evolution',
        status: 'completed',
        detail: 'complete',
      })
      expect(jobs.read(JobId('evolution-1')).text).toBe('review: stable baseline')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('exposes a sealed counterfactual retest through the same native Job registry', async () => {
    const source = resolve(dshSourceDir!)
    const { default: LocalJobRegistry } = await import(pathToFileURL(
      join(source, 'packages', 'jobs', 'jobs-local', 'lib', 'index.js'),
    ).href)
    const ctx = new Context()
    await ctx.plugin(LocalJobRegistry)
    const jobs = ctx.get('jobs') as JobRegistry | undefined
    if (jobs === undefined) throw new Error('pinned DSH Jobs service did not load')
    jobs.attachController('test')
    const runner = createCanaryJobRunner(jobs, async () => ({
      calibrationPassed: true,
      parentPassed: true,
      candidatePassed: false,
      report: {},
    }))
    const input = {
      candidate: { outputDir: '/private/run' },
      generation: {},
      outcome: {},
      signal: new AbortController().signal,
    } as Parameters<CanaryComparisonRunner>[0]

    try {
      await expect(runner(input)).resolves.toMatchObject({ candidatePassed: false })
      await expect(jobs.wait(JobId('evolution-1'), 1_000)).resolves.toMatchObject({
        id: 'evolution-1',
        kind: 'evolution',
        status: 'completed',
        detail: 'candidate failed',
      })
      expect(jobs.read(JobId('evolution-1')).text)
        .toBe('calibration=pass parent=pass candidate=fail')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
