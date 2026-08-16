import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { CanaryComparison, CanaryComparisonRunner } from './counterfactual-canary.ts'

/** Adapt one sealed counterfactual comparison to DSH's process-local Job lifecycle. */
export function createCanaryJobRunner(
  jobs: JobRegistry,
  compare: CanaryComparisonRunner,
): CanaryComparisonRunner {
  return input => new Promise<CanaryComparison>((resolve, reject) => {
    jobs.start({
      kind: 'evolution',
      label: 'retest failed Delivery Outcome',
      outputLimitBytes: 512,
      run: () => {
        const controller = new AbortController()
        const relayOwnerAbort = () => {
          controller.abort(input.signal.reason ?? new Error('counterfactual canary stopped'))
        }
        input.signal.addEventListener('abort', relayOwnerAbort, { once: true })
        if (input.signal.aborted) relayOwnerAbort()
        const task = compare({ ...input, signal: controller.signal })
        void task.then(resolve, reject)
        const done = task.then(comparison => ({
          status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
          detail: controller.signal.aborted
            ? errorDetail(controller.signal.reason)
            : `candidate ${comparison.candidatePassed ? 'passed' : 'failed'}`,
          ...controller.signal.aborted ? {} : {
              output: comparisonSummary(comparison),
            },
        }), (error: unknown) => ({
          status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
          detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
        })).finally(() => {
          input.signal.removeEventListener('abort', relayOwnerAbort)
        })
        return {
          cancel: (reason?: string) => controller.abort(new Error(reason ?? 'canary cancelled')),
          done,
        }
      },
    })
  })
}

function comparisonSummary(comparison: CanaryComparison): string {
  return [
    `calibration=${comparison.calibrationPassed ? 'pass' : 'fail'}`,
    `parent=${comparison.parentPassed ? 'pass' : 'fail'}`,
    `candidate=${comparison.candidatePassed ? 'pass' : 'fail'}`,
  ].join(' ')
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}
