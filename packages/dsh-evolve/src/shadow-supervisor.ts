import { readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { loadShadowRunState } from './shadow-run-state.ts'
import { runShadow } from './shadow.ts'

export interface ShadowResumeInvocation {
  casePackDir: string
  outputDir: string
  resume: true
  signal: AbortSignal
  skillDir: string
  feedbackDraftPath?: string
}

export interface ShadowSupervisorOptions {
  runRoots: Array<{ readonly workspaceId: string; readonly path: string }>
  scanIntervalMs: number
  pausedWorkspaces?: readonly string[]
  afterScan?: (signal: AbortSignal, workspaceId: string) => Promise<void>
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
  private activeWorkspaceId: string | undefined
  private readonly pausedWorkspaces: Set<string>
  private readonly suppressedRuns = new Set<string>()
  private readonly reportedErrors = new Map<string, string>()

  constructor(options: ShadowSupervisorOptions) {
    if (!Number.isSafeInteger(options.scanIntervalMs) || options.scanIntervalMs <= 0) {
      throw new Error('Shadow supervisor scan interval must be a positive integer')
    }
    if (options.runRoots.some(root => !isWorkspaceId(root.workspaceId) || !isAbsolute(root.path))) {
      throw new Error('Shadow supervisor run roots require a native Workspace id and absolute path')
    }
    if (new Set(options.runRoots.map(root => resolve(root.path))).size !== options.runRoots.length) {
      throw new Error('Shadow supervisor run roots must be uniquely owned')
    }
    this.options = options
    this.pausedWorkspaces = new Set(options.pausedWorkspaces ?? [])
  }

  start(): void {
    if (this.stopped || this.timer !== undefined || this.scanPromise !== undefined) return
    this.schedule(0)
  }

  scanOnce(): Promise<void> {
    if (this.scanPromise !== undefined) return this.scanPromise
    if (this.stopped) return Promise.resolve()
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

  async pause(workspaceId: string): Promise<void> {
    if (this.stopped) return
    this.pausedWorkspaces.add(workspaceId)
    if (this.activeWorkspaceId === workspaceId) {
      this.activeAbort?.abort(new ShadowRecoveryPaused('resident evolution recovery paused'))
      await this.scanPromise
    }
  }

  resume(workspaceId: string): void {
    if (this.stopped || !this.pausedWorkspaces.delete(workspaceId)) return
    this.start()
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.scanOnce().finally(() => {
        if (!this.stopped) this.schedule(this.options.scanIntervalMs)
      })
    }, delay)
    this.timer.unref?.()
  }

  private async scanAll(): Promise<void> {
    for (const requestedRoot of this.options.runRoots) {
      if (this.stopped) return
      if (this.pausedWorkspaces.has(requestedRoot.workspaceId)) continue
      let root: string
      let entries
      try {
        root = await realpath(requestedRoot.path)
        entries = await readdir(root, { withFileTypes: true })
        entries.sort((left, right) => left.name.localeCompare(right.name))
        this.reportedErrors.delete(requestedRoot.path)
      } catch (error) {
        this.report(error, requestedRoot.path)
        continue
      }
      for (const entry of entries) {
        if (this.stopped) return
        if (this.pausedWorkspaces.has(requestedRoot.workspaceId)) break
        if (!entry.isDirectory()) continue
        const outputDir = join(root, entry.name)
        if (this.suppressedRuns.has(outputDir)) continue
        let state
        try {
          state = await loadShadowRunState(outputDir)
          if (state.identity.workspaceId !== requestedRoot.workspaceId) {
            throw new Error('Shadow run Workspace does not match its configured run root owner')
          }
        } catch (error) {
          if (!isMissingRunState(error)) this.report(error, outputDir)
          continue
        }
        if (state.phase !== 'candidate-ready' && state.phase !== 'trial-running') continue
        if (state.resumeInputs === undefined) continue
        const controller = new AbortController()
        this.activeAbort = controller
        this.activeWorkspaceId = requestedRoot.workspaceId
        try {
          await (this.options.runner ?? runShadow)({
            ...(state.resumeInputs.baselineKind === undefined
              ? {}
              : {
                  baselineKind: state.resumeInputs.baselineKind,
                  baselineSkillName: state.resumeInputs.baselineSkillName!,
                }),
            casePackDir: state.resumeInputs.casePackDir,
            ...(state.resumeInputs.candidateSkillDir === undefined
              ? {}
              : {
                  exactCandidate: {
                    claim: state.proposal?.claim ?? 'resume pinned exact Candidate',
                    ...(state.identity.skillCandidateLineage === undefined
                      ? {}
                      : { lineage: state.identity.skillCandidateLineage }),
                    skillDir: state.resumeInputs.candidateSkillDir,
                  },
                }),
            ...(state.resumeInputs.feedbackDraftPath === undefined
              ? {}
              : { feedbackDraftPath: state.resumeInputs.feedbackDraftPath }),
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
          if (this.activeWorkspaceId === requestedRoot.workspaceId) this.activeWorkspaceId = undefined
        }
      }
    }
  }

  private async scanCycle(): Promise<void> {
    await this.scanAll()
    if (this.stopped || this.options.afterScan === undefined) return
    const workspaces = [...new Set(this.options.runRoots.map(root => root.workspaceId))]
    for (const workspaceId of workspaces) {
      if (this.stopped || this.pausedWorkspaces.has(workspaceId)) continue
      const controller = new AbortController()
      this.activeAbort = controller
      this.activeWorkspaceId = workspaceId
      try {
        await this.options.afterScan(controller.signal, workspaceId)
        this.reportedErrors.delete(`automatic-promotion:${workspaceId}`)
      } catch (error) {
        if (!controller.signal.aborted) this.report(error, `automatic-promotion:${workspaceId}`)
      } finally {
        if (this.activeAbort === controller) this.activeAbort = undefined
        if (this.activeWorkspaceId === workspaceId) this.activeWorkspaceId = undefined
      }
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

function isWorkspaceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}
