import { spawn } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export interface SealedDarwinTrialOptions {
  argv: [string, ...string[]]
  /** Permit the trusted evaluator to create child processes. Disabled by default. */
  allowProcessFork?: boolean
  /** Additional absolute executables available to a trusted assembled evaluator. */
  allowedExecutables?: readonly string[]
  outputLimitBytes: number
  /** Host runtime trees mounted read-only for trusted framework assembly. */
  readOnlyRoots?: readonly string[]
  /** Cancellation owned by the resident DSH plugin lifecycle. */
  signal?: AbortSignal
  timeoutMs: number
  workspace: string
}

export interface SealedDarwinTrialResult {
  backend: 'darwin-seatbelt'
  enforcement: 'full'
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
  timedOut: boolean
  outputTruncated: boolean
}

/**
 * Run one command in a deny-by-default macOS Seatbelt profile.
 *
 * The child receives only a purpose-built environment. It can read and write
 * its canonical workspace, execute only its entrypoint, and use the minimal
 * system resources imported by Apple's system profile. Network access and
 * other filesystem/process capabilities remain denied.
 */
export async function runSealedDarwinTrial(
  options: SealedDarwinTrialOptions,
): Promise<SealedDarwinTrialResult> {
  if (process.platform !== 'darwin') {
    throw new Error('the darwin Seatbelt Trial backend is unavailable on this platform')
  }
  if (!isAbsolute(options.argv[0])) {
    throw new Error('Trial executable must be an absolute path')
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('Trial timeout must be a positive integer')
  }
  if (!Number.isSafeInteger(options.outputLimitBytes) || options.outputLimitBytes <= 0) {
    throw new Error('Trial output limit must be a positive integer')
  }

  const requestedWorkspace = resolve(options.workspace)
  const workspace = await realpath(requestedWorkspace)
  const executable = await realpath(options.argv[0])
  const allowedExecutables = await Promise.all(
    (options.allowedExecutables ?? []).map(async (path) => {
      if (!isAbsolute(path)) throw new Error('Trial allowed executables must use absolute paths')
      return await realpath(path)
    }),
  )
  const readOnlyRoots = await Promise.all(
    (options.readOnlyRoots ?? []).map(async (path) => {
      if (!isAbsolute(path)) throw new Error('Trial read-only roots must use absolute paths')
      return await realpath(path)
    }),
  )
  const argv: [string, ...string[]] = [
    executable,
    ...options.argv.slice(1).map((argument) => canonicalizeWorkspaceArgument(
      argument,
      requestedWorkspace,
      workspace,
    )),
  ]
  const temporaryDirectory = join(workspace, '.trial-tmp')
  await mkdir(temporaryDirectory, { recursive: true })

  const profile = buildSeatbeltProfile({
    allowProcessFork: options.allowProcessFork ?? false,
    executables: [...new Set([executable, ...allowedExecutables])],
    readOnlyRoots: [...new Set(readOnlyRoots)],
    workspace,
  })
  return await runSandboxedProcess({
    argv,
    outputLimitBytes: options.outputLimitBytes,
    profile,
    ...options.signal === undefined ? {} : { signal: options.signal },
    temporaryDirectory,
    timeoutMs: options.timeoutMs,
    workspace,
  })
}

function canonicalizeWorkspaceArgument(
  argument: string,
  requestedWorkspace: string,
  canonicalWorkspace: string,
): string {
  if (!isAbsolute(argument)) return argument
  const workspaceRelativePath = relative(requestedWorkspace, argument)
  if (workspaceRelativePath === ''
    || (!workspaceRelativePath.startsWith('..') && !isAbsolute(workspaceRelativePath))) {
    return resolve(canonicalWorkspace, workspaceRelativePath)
  }
  return argument
}

function buildSeatbeltProfile(input: {
  allowProcessFork: boolean
  executables: readonly string[]
  readOnlyRoots: readonly string[]
  workspace: string
}): string {
  const readableRoots = [input.workspace, ...input.readOnlyRoots]
  const readableAncestors = [...new Set(readableRoots.flatMap(pathAncestors))]
    .map((path) => `(literal ${seatbeltString(path)})`)
    .join(' ')
  const readableSubpaths = readableRoots
    .map((path) => `(subpath ${seatbeltString(path)})`)
    .join(' ')
  const executableLiterals = input.executables
    .map((path) => `(literal ${seatbeltString(path)})`)
    .join(' ')
  return [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    ...(input.allowProcessFork ? ['(allow process-fork)'] : []),
    `(allow process-exec ${executableLiterals})`,
    `(allow file-test-existence file-read-metadata ${readableAncestors} ${readableSubpaths})`,
    `(allow file-read* file-map-executable ${executableLiterals} ${readableSubpaths})`,
    `(allow file-write* (subpath ${seatbeltString(input.workspace)}))`,
  ].join('\n')
}

function pathAncestors(path: string): string[] {
  const ancestors: string[] = []
  let current = dirname(path)
  while (current !== '/') {
    ancestors.unshift(current)
    current = dirname(current)
  }
  return ancestors
}

function seatbeltString(value: string): string {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error('Seatbelt paths cannot contain NUL or newline characters')
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

async function runSandboxedProcess(input: {
  argv: [string, ...string[]]
  outputLimitBytes: number
  profile: string
  signal?: AbortSignal
  temporaryDirectory: string
  timeoutMs: number
  workspace: string
}): Promise<SealedDarwinTrialResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/sandbox-exec',
      ['-p', input.profile, '--', ...input.argv],
      {
        cwd: input.workspace,
        detached: true,
        env: {
          HOME: input.workspace,
          LANG: 'C',
          LC_ALL: 'C',
          TMPDIR: input.temporaryDirectory,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let capturedBytes = 0
    let outputTruncated = false
    let timedOut = false
    let settled = false
    let aborted: unknown

    const terminate = (): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
    }
    const capture = (destination: Buffer[], chunk: Buffer): void => {
      const remaining = input.outputLimitBytes - capturedBytes
      if (remaining <= 0) return
      if (chunk.byteLength > remaining) {
        destination.push(chunk.subarray(0, remaining))
        capturedBytes += remaining
        outputTruncated = true
        terminate()
        return
      }
      destination.push(chunk)
      capturedBytes += chunk.byteLength
    }
    const abort = (): void => {
      aborted = input.signal?.reason ?? new Error('Trial aborted')
      terminate()
    }

    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk))
    const timeout = setTimeout(() => {
      timedOut = true
      terminate()
    }, input.timeoutMs)
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) abort()

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abort)
      reject(aborted ?? error)
    })
    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abort)
      if (aborted !== undefined) {
        reject(aborted)
        return
      }
      resolve({
        backend: 'darwin-seatbelt',
        enforcement: 'full',
        exitCode,
        signal,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
        timedOut,
        outputTruncated,
      })
    })
  })
}
