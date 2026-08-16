import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { AutomaticRetentionCancelled } from './automatic-retention.ts'
import { evaluateRetention, type RetentionOptions, type RetentionResult } from './retention.ts'

/** Observe one deployment-authorized automatic Retention Trial through native DSH Jobs. */
export function createAutomaticRetentionJobRunner(
  jobs: JobRegistry,
  run: (options: RetentionOptions) => Promise<RetentionResult> = evaluateRetention,
): (options: RetentionOptions) => Promise<RetentionResult> {
  return input => new Promise<RetentionResult>((resolve, reject) => {
    jobs.start({
      kind: 'evolution',
      label: 'verify prior capability retention',
      outputLimitBytes: 512,
      run: () => {
        const controller = new AbortController()
        const relayOwnerAbort = () => {
          controller.abort(input.signal?.reason ?? new Error('automatic Retention stopped'))
        }
        input.signal?.addEventListener('abort', relayOwnerAbort, { once: true })
        if (input.signal?.aborted) relayOwnerAbort()
        const task = run({ ...input, signal: controller.signal })
        void task.then(resolve, reject)
        const done = task.then(result => ({
          status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
          detail: controller.signal.aborted
            ? errorDetail(controller.signal.reason)
            : `retention ${result.status}`,
          ...controller.signal.aborted ? {} : { output: `retention=${result.status}` },
        }), (error: unknown) => ({
          status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
          detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
        })).finally(() => {
          input.signal?.removeEventListener('abort', relayOwnerAbort)
        })
        return {
          cancel: (reason?: string) => controller.abort(new AutomaticRetentionCancelled(
            reason ?? 'automatic Retention cancelled',
          )),
          done,
        }
      },
    })
  })
}

function errorDetail(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replaceAll(/[\r\n]+/g, ' ').slice(0, 256) || 'unknown error'
}
