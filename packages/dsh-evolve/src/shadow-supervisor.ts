import { readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { loadShadowRunState } from './shadow-run-state.ts'
import { runShadow } from './shadow.ts'

export interface ShadowResumeInvocation {
  casePackDir: string
  outputDir: string
  resume: true
  signal: AbortSignal
  skillDir: string
}

export interface ShadowSupervisorOptions {
  runRoots: string[]
  scanIntervalMs: number
  paused?: boolean
  afterScan?: (signal: AbortSignal) => Promise<void>
  runner?: (invocation: ShadowResumeInvocation) => ReturnType<typeof runShadow>
  onError?: (error: unknown, path: string) => void
}

/** A native Job cancellation stops automatic retries for this DSH process. */
export class ShadowRecoveryCancelled extends Error {
  override readonly name: string = 'ShadowRecoveryCancelled'
}

/** Durable operator pause is resumable and must not suppress the interrupted run. */
export class ShadowRecoveryPaused extends ShadowRecoveryCancelled {
  override readonly name: string = 'ShadowRecoveryPaused'
}

/**
 * A deliberately small continuity loop for already-durable, network-free Trial work.
 * It is owned by the DSH plugin lifecycle; it is not a second daemon or workflow engine.
 */
export class ShadowSupervisor {
  private readonly options: ShadowSupervisorOptions
  private scanPromise: Promise<void> | undefined
  private activeAbort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private paused: boolean
  private readonly suppressedRuns = new Set<string>()
  private readonly reportedErrors = new Map<string, string>()

  constructor(options: ShadowSupervisorOptions) {
    if (!Number.isSafeInteger(options.scanIntervalMs) || options.scanIntervalMs <= 0) {
      throw new Error('Shadow supervisor scan interval must be a positive integer')
    }
    this.options = options
    this.paused = options.paused ?? false
  }

  start(): void {
    if (this.stopped || this.paused || this.timer !== undefined || this.scanPromise !== undefined) return
    this.schedule(0)
  }

  scanOnce(): Promise<void> {
    if (this.scanPromise !== undefined) return this.scanPromise
    if (this.stopped || this.paused) return Promise.resolve()
    const scan = this.scanCycle()
    const wrapped = scan.finally(() => {
      if (this.scanPromise === wrapped) this.scanPromise = undefined
    })
    this.scanPromise = wrapped
    return wrapped
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activeAbort?.abort(new Error('Shadow supervisor stopped'))
    await this.scanPromise
  }

  async pause(): Promise<void> {
    if (this.stopped) return
    this.paused = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.activeAbort?.abort(new ShadowRecoveryPaused('resident evolution recovery paused'))
    await this.scanPromise
  }

  resume(): void {
    if (this.stopped || !this.paused) return
    this.paused = false
    this.start()
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.scanOnce().finally(() => {
        if (!this.stopped && !this.paused) this.schedule(this.options.scanIntervalMs)
      })
    }, delay)
    this.timer.unref?.()
  }

  private async scanAll(): Promise<void> {
    for (const requestedRoot of this.options.runRoots) {
      if (this.stopped || this.paused) return
      let root: string
      let entries
      try {
        root = await realpath(requestedRoot)
        entries = await readdir(root, { withFileTypes: true })
        entries.sort((left, right) => left.name.localeCompare(right.name))
        this.reportedErrors.delete(requestedRoot)
      } catch (error) {
        this.report(error, requestedRoot)
        continue
      }
      for (const entry of entries) {
        if (this.stopped || this.paused) return
        if (!entry.isDirectory()) continue
        const outputDir = join(root, entry.name)
        if (this.suppressedRuns.has(outputDir)) continue
        let state
        try {
          state = await loadShadowRunState(outputDir)
        } catch (error) {
          if (!isMissingRunState(error)) this.report(error, outputDir)
          continue
        }
        if (state.phase !== 'candidate-ready' && state.phase !== 'trial-running') continue
        if (state.resumeInputs === undefined) continue
        const controller = new AbortController()
        this.activeAbort = controller
        try {
          await (this.options.runner ?? runShadow)({
            casePackDir: state.resumeInputs.casePackDir,
            outputDir,
            resume: true,
            signal: controller.signal,
            skillDir: state.resumeInputs.skillDir,
          })
          this.reportedErrors.delete(outputDir)
        } catch (error) {
          if (error instanceof ShadowRecoveryPaused) {
            // The durable journal remains discoverable after an explicit resume.
          } else if (error instanceof ShadowRecoveryCancelled) {
            this.suppressedRuns.add(outputDir)
          } else if (!controller.signal.aborted) {
            this.report(error, outputDir)
          }
        } finally {
          if (this.activeAbort === controller) this.activeAbort = undefined
        }
      }
    }
  }

  private async scanCycle(): Promise<void> {
    await this.scanAll()
    if (this.stopped || this.paused || this.options.afterScan === undefined) return
    const controller = new AbortController()
    this.activeAbort = controller
    try {
      await this.options.afterScan(controller.signal)
      this.reportedErrors.delete('automatic-promotion')
    } catch (error) {
      if (!controller.signal.aborted) this.report(error, 'automatic-promotion')
    } finally {
      if (this.activeAbort === controller) this.activeAbort = undefined
    }
  }

  private report(error: unknown, path: string): void {
    const fingerprint = String(error)
    if (this.reportedErrors.get(path) === fingerprint) return
    this.reportedErrors.set(path, fingerprint)
    this.options.onError?.(error, path)
  }
}

function isMissingRunState(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const cause = error.cause
  return typeof cause === 'object'
    && cause !== null
    && 'code' in cause
    && cause.code === 'ENOENT'
}
