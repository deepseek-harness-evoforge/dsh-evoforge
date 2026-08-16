import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_TIMEOUT_MS = 15 * 60_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024
const MAX_CHECKS = 16

export interface DeliveryCheck {
  readonly name: string
  readonly argv: readonly string[]
}

export interface VerifyDeliveryOptions {
  readonly worktree: string
  readonly baseRef: string
  readonly checks: readonly DeliveryCheck[]
  readonly timeoutMs?: number
  readonly outputLimitBytes?: number
}

export interface CapturedOutput {
  readonly text: string
  readonly bytes: number
  readonly truncated: boolean
  readonly sha256: string
}

export interface DeliveryCheckEvidence {
  readonly name: string
  readonly argv: readonly string[]
  readonly status: 'passed' | 'failed' | 'unknown'
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: CapturedOutput
  readonly stderr: CapturedOutput
}

export interface DeliveryRepositoryEvidence {
  readonly worktree: string
  readonly branch: string | null
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly headCommit: string | null
  readonly ahead: number | null
  readonly clean: boolean | null
  readonly linkedWorktree: boolean | null
}

export interface DeliveryReport {
  readonly schemaVersion: 1
  readonly status: 'passed' | 'failed' | 'unknown'
  readonly reason: string
  readonly artifact: {
    readonly kind: 'git-commit'
    readonly commit: string
    readonly branch: string
  } | null
  readonly repository: DeliveryRepositoryEvidence
  readonly checks: readonly DeliveryCheckEvidence[]
}

interface ProcessEvidence {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: CapturedOutput
  readonly stderr: CapturedOutput
  readonly timedOut: boolean
  readonly spawnError?: string
}

/**
 * Verify objective evidence for a software-delivery Goal without mutating Git.
 * Only explicit argv checks execute, never through a shell, and they receive a
 * minimal parent environment rooted in a temporary HOME.
 */
export async function verifyDelivery(options: VerifyDeliveryOptions): Promise<DeliveryReport> {
  validateOptions(options)
  const requestedWorktree = resolve(options.worktree)
  const repository: MutableRepositoryEvidence = {
    worktree: requestedWorktree,
    branch: null,
    baseRef: options.baseRef,
    baseCommit: null,
    headCommit: null,
    ahead: null,
    clean: null,
    linkedWorktree: null,
  }
  const checks: DeliveryCheckEvidence[] = []
  const isolatedHome = await mkdtemp(join(tmpdir(), 'dsh-delivery-home-'))
  const env = safeEnvironment(isolatedHome)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const outputLimitBytes = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES

  try {
    let worktree: string
    try {
      worktree = await realpath(requestedWorktree)
      if (!(await stat(worktree)).isDirectory()) return report('failed', 'worktree-not-directory', repository, checks)
      repository.worktree = worktree
    } catch {
      return report('failed', 'worktree-not-found', repository, checks)
    }

    const topLevel = await git(worktree, ['rev-parse', '--show-toplevel'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(topLevel)) return report('failed', 'not-a-git-worktree', repository, checks)
    const resolvedTopLevel = await realpath(topLevel.stdout.text.trim())
    if (resolvedTopLevel !== worktree) return report('failed', 'worktree-root-required', repository, checks)

    const gitDirResult = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'], env, timeoutMs, outputLimitBytes)
    const commonDirResult = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(gitDirResult) || !succeeded(commonDirResult)) {
      return report('unknown', 'git-metadata-unavailable', repository, checks)
    }
    const gitDir = resolve(worktree, gitDirResult.stdout.text.trim())
    const commonDir = resolve(worktree, commonDirResult.stdout.text.trim())
    repository.linkedWorktree = gitDir !== commonDir
    if (!repository.linkedWorktree) return report('failed', 'linked-worktree-required', repository, checks)

    const branch = await git(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(branch)) return report('failed', 'named-branch-required', repository, checks)
    repository.branch = branch.stdout.text.trim()

    const base = await git(worktree, ['rev-parse', '--verify', `${options.baseRef}^{commit}`], env, timeoutMs, outputLimitBytes)
    if (!succeeded(base)) return report('failed', 'base-ref-not-found', repository, checks)
    repository.baseCommit = base.stdout.text.trim()
    const head = await git(worktree, ['rev-parse', '--verify', 'HEAD^{commit}'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(head)) return report('unknown', 'head-unavailable', repository, checks)
    repository.headCommit = head.stdout.text.trim()

    const ancestor = await git(
      worktree,
      ['merge-base', '--is-ancestor', repository.baseCommit, repository.headCommit],
      env,
      timeoutMs,
      outputLimitBytes,
    )
    if (ancestor.exitCode === 1 && !ancestor.timedOut && ancestor.spawnError === undefined) {
      return report('failed', 'base-not-ancestor', repository, checks)
    }
    if (!succeeded(ancestor)) return report('unknown', 'ancestry-check-unavailable', repository, checks)

    const ahead = await git(
      worktree,
      ['rev-list', '--count', `${repository.baseCommit}..${repository.headCommit}`],
      env,
      timeoutMs,
      outputLimitBytes,
    )
    if (!succeeded(ahead)) return report('unknown', 'commit-count-unavailable', repository, checks)
    repository.ahead = Number.parseInt(ahead.stdout.text.trim(), 10)
    if (!Number.isSafeInteger(repository.ahead)) return report('unknown', 'invalid-commit-count', repository, checks)
    if (repository.ahead < 1) return report('failed', 'committed-change-required', repository, checks)

    const status = await git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(status)) return report('unknown', 'worktree-status-unavailable', repository, checks)
    repository.clean = status.stdout.bytes === 0
    if (!repository.clean) return report('failed', 'worktree-not-clean', repository, checks)

    for (const check of options.checks) {
      const result = await runProcess(check.argv[0]!, check.argv.slice(1), worktree, env, timeoutMs, outputLimitBytes)
      const evidence: DeliveryCheckEvidence = {
        name: check.name,
        argv: [...check.argv],
        status: result.timedOut || result.spawnError !== undefined || result.signal !== null
          ? 'unknown'
          : result.exitCode === 0 ? 'passed' : 'failed',
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      }
      checks.push(evidence)
      if (evidence.status === 'unknown') return report('unknown', `check-inconclusive:${check.name}`, repository, checks)
      if (evidence.status === 'failed') return report('failed', `check-failed:${check.name}`, repository, checks)
    }

    const finalHead = await git(worktree, ['rev-parse', '--verify', 'HEAD^{commit}'], env, timeoutMs, outputLimitBytes)
    const finalBase = await git(worktree, ['rev-parse', '--verify', `${options.baseRef}^{commit}`], env, timeoutMs, outputLimitBytes)
    const finalStatus = await git(worktree, ['status', '--porcelain=v1', '--untracked-files=all'], env, timeoutMs, outputLimitBytes)
    if (!succeeded(finalHead) || !succeeded(finalBase) || !succeeded(finalStatus)) {
      return report('unknown', 'post-check-git-state-unavailable', repository, checks)
    }
    if (
      finalHead.stdout.text.trim() !== repository.headCommit
      || finalBase.stdout.text.trim() !== repository.baseCommit
      || finalStatus.stdout.bytes !== 0
    ) {
      return report('failed', 'repository-changed-during-checks', repository, checks)
    }
    return report('passed', 'verified', repository, checks)
  } finally {
    await rm(isolatedHome, { force: true, recursive: true })
  }
}

type MutableRepositoryEvidence = {
  -readonly [Key in keyof DeliveryRepositoryEvidence]: DeliveryRepositoryEvidence[Key]
}

function report(
  status: DeliveryReport['status'],
  reason: string,
  repository: DeliveryRepositoryEvidence,
  checks: readonly DeliveryCheckEvidence[],
): DeliveryReport {
  const artifact = repository.headCommit === null || repository.branch === null
    ? null
    : { kind: 'git-commit' as const, commit: repository.headCommit, branch: repository.branch }
  return { schemaVersion: 1, status, reason, artifact, repository: { ...repository }, checks: [...checks] }
}

function validateOptions(options: VerifyDeliveryOptions): void {
  if (typeof options.worktree !== 'string' || options.worktree.trim() === '') throw new Error('worktree is required')
  if (typeof options.baseRef !== 'string' || options.baseRef.trim() === '') throw new Error('baseRef is required')
  if (!Array.isArray(options.checks) || options.checks.length < 1 || options.checks.length > MAX_CHECKS) {
    throw new Error(`checks must contain between 1 and ${MAX_CHECKS} entries`)
  }
  for (const [index, candidate] of options.checks.entries()) {
    const value: unknown = candidate
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`check ${index + 1} must be an object`)
    }
    const check = value as { name?: unknown; argv?: unknown }
    if (typeof check.name !== 'string' || check.name.trim() === '') throw new Error('every check requires a name')
    if (!Array.isArray(check.argv) || check.argv.length < 1 || check.argv.some((value: unknown) => typeof value !== 'string' || value === '')) {
      throw new Error(`check ${check.name} requires a non-empty string argv`)
    }
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000)) {
    throw new Error('timeoutMs must be an integer of at least 1000')
  }
  if (
    options.outputLimitBytes !== undefined
    && (!Number.isSafeInteger(options.outputLimitBytes) || options.outputLimitBytes < 1 || options.outputLimitBytes > 1024 * 1024)
  ) {
    throw new Error('outputLimitBytes must be an integer between 1 and 1048576')
  }
}

function safeEnvironment(isolatedHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, '.config'),
    XDG_CACHE_HOME: join(isolatedHome, '.cache'),
    CI: '1',
    NO_COLOR: '1',
  }
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'ComSpec', 'PATHEXT']) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

async function git(
  worktree: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  outputLimitBytes: number,
): Promise<ProcessEvidence> {
  return runProcess(
    'git',
    ['-C', worktree, ...args],
    worktree,
    env,
    timeoutMs,
    Math.max(DEFAULT_OUTPUT_LIMIT_BYTES, outputLimitBytes),
  )
}

function succeeded(result: ProcessEvidence): boolean {
  return result.exitCode === 0 && result.signal === null && !result.timedOut && result.spawnError === undefined
}

async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  outputLimitBytes: number,
): Promise<ProcessEvidence> {
  return new Promise((resolveProcess) => {
    const stdout = new OutputCapture(outputLimitBytes)
    const stderr = new OutputCapture(outputLimitBytes)
    let timedOut = false
    let spawnError: string | undefined
    let settled = false
    const ownsProcessGroup = process.platform !== 'win32'
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: ownsProcessGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', (error) => { spawnError = error.message })
    let forceKill: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      timedOut = true
      terminate(child.pid, ownsProcessGroup, child.kill.bind(child), 'SIGTERM')
      forceKill = setTimeout(
        () => terminate(child.pid, ownsProcessGroup, child.kill.bind(child), 'SIGKILL'),
        1_000,
      )
      forceKill.unref()
    }, timeoutMs)
    timer.unref()
    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceKill !== undefined) clearTimeout(forceKill)
      resolveProcess({
        exitCode,
        signal,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        timedOut,
        ...(spawnError === undefined ? {} : { spawnError }),
      })
    })
  })
}

function terminate(
  pid: number | undefined,
  ownsProcessGroup: boolean,
  killChild: (signal?: NodeJS.Signals | number) => boolean,
  signal: NodeJS.Signals,
): void {
  if (ownsProcessGroup && pid !== undefined) {
    try {
      process.kill(-pid, signal)
      return
    } catch {
      // The child may have exited between the timer and signal; fall back to
      // the ChildProcess handle so the close event still settles the result.
    }
  }
  killChild(signal)
}

class OutputCapture {
  private readonly hash = createHash('sha256')
  private readonly chunks: Buffer[] = []
  private storedBytes = 0
  private totalBytes = 0

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.hash.update(chunk)
    this.totalBytes += chunk.length
    const remaining = this.limit - this.storedBytes
    if (remaining > 0) {
      const stored = chunk.subarray(0, remaining)
      this.chunks.push(stored)
      this.storedBytes += stored.length
    }
  }

  finish(): CapturedOutput {
    return {
      text: Buffer.concat(this.chunks, this.storedBytes).toString('utf8'),
      bytes: this.totalBytes,
      truncated: this.totalBytes > this.storedBytes,
      sha256: this.hash.digest('hex'),
    }
  }
}
