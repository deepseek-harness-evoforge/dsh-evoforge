import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import {
  ShadowRecoveryCancelled,
  ShadowRecoveryPaused,
  type ShadowResumeInvocation,
} from './shadow-supervisor.ts'
import type { runShadow } from './shadow.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    evolution: 'evolution'
  }
}

type ShadowResult = Awaited<ReturnType<typeof runShadow>>
type ShadowRunner = (invocation: ShadowResumeInvocation) => Promise<ShadowResult>

/** Adapt one recoverable journal entry to DSH's process-local observability/cancel seam. */
export function createShadowJobRunner(
  jobs: JobRegistry,
  resume: ShadowRunner,
): ShadowRunner {
  return invocation => new Promise<ShadowResult>((resolve, reject) => {
    jobs.start({
      kind: 'evolution',
      label: 'resume durable Shadow Trial',
      outputLimitBytes: 2_048,
      run: () => {
        const controller = new AbortController()
        const relayOwnerAbort = () => {
          controller.abort(invocation.signal.reason ?? new Error('Shadow supervisor stopped'))
        }
        invocation.signal.addEventListener('abort', relayOwnerAbort, { once: true })
        if (invocation.signal.aborted) relayOwnerAbort()
        const task = resume({
          ...invocation,
          signal: controller.signal,
        })
        void task.then(resolve, (error: unknown) => {
          const reason = controller.signal.reason
          reject(controller.signal.aborted
            ? reason instanceof ShadowRecoveryPaused
              ? reason
              : new ShadowRecoveryCancelled(errorDetail(reason))
            : error)
        })
        const done = task.then((result) => ({
          status: controller.signal.aborted ? 'killed' as const : 'completed' as const,
          detail: controller.signal.aborted ? errorDetail(controller.signal.reason) : result.status,
          ...controller.signal.aborted ? {} : {
            output: boundedOutput(result.status === 'complete' ? result.summary : result.reason),
          },
        }), (error: unknown) => ({
          status: controller.signal.aborted ? 'killed' as const : 'failed' as const,
          detail: errorDetail(controller.signal.aborted ? controller.signal.reason : error),
        })).finally(() => {
          invocation.signal.removeEventListener('abort', relayOwnerAbort)
        })
        return {
          cancel: (reason?: string) => {
            controller.abort(new Error(reason ?? 'Shadow recovery cancelled'))
          },
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

function boundedOutput(text: string): string {
  const source = Buffer.from(text)
  if (source.byteLength <= 2_048) return text
  return `${source.subarray(0, 2_016).toString('utf8')}\n[output truncated]`
}
