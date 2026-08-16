import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { hashTree } from './hash.js'
import { runSealedDarwinTrial } from './sealed-trial-darwin.js'

interface TrialDefinition {
  evaluator: string
  timeoutMs: number
  outputLimitBytes: number
  dshAssembled?: boolean
  dshProfileInstall?: boolean
}

interface CalibrationDefinition {
  knownBad: string
  knownCorrection: string
}

interface Proposal {
  files: Array<{ path: string; content: string }>
}

interface EvaluatorCheck {
  name: string
  passed: boolean
}

interface EvaluatorOutcome {
  passed: boolean
  checks: EvaluatorCheck[]
  treeHash: string
  composition?: EvaluatorComposition
}

interface EvaluatorComposition {
  fingerprint: string
  modelCalls: number
  usage: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }
}

interface DshSource {
  dir: string
  readOnlyRoots: string[]
  packageManager?: HostExecutable
}

interface HostExecutable {
  executable: string
  readOnlyRoots: string[]
}

export interface PairedTrialResult {
  backend: 'darwin-seatbelt'
  count: 4
  assembled: boolean
  calibration: Array<{
    id: 'known-bad' | 'known-correction'
    expected: 'fail' | 'pass'
    actual: 'fail' | 'pass'
    passed: boolean
  }>
  baseline: EvaluatorOutcome
  candidate: EvaluatorOutcome
}

export async function runPairedTrial(options: {
  calibration: CalibrationDefinition
  casePackDir: string
  dshRevision: string
  outputDir: string
  proposal: Proposal
  skillDir: string
  trial: TrialDefinition
  trialLimit: number
}): Promise<PairedTrialResult> {
  const requiredTrialCount = 4
  if (options.trialLimit < requiredTrialCount) {
    throw new Error(`case pack trial budget is ${options.trialLimit}; paired calibration requires ${requiredTrialCount}`)
  }
  if (process.platform !== 'darwin') {
    throw new Error(`sealed Trial executor is unavailable on ${process.platform}`)
  }

  const evaluatorPath = await resolveCasePackEntry(
    options.casePackDir,
    options.trial.evaluator,
  )
  const knownBadDir = await resolveCasePackEntry(
    options.casePackDir,
    options.calibration.knownBad,
  )
  const knownCorrectionDir = await resolveCasePackEntry(
    options.casePackDir,
    options.calibration.knownCorrection,
  )
  const dshSource = options.trial.dshAssembled
    ? await resolveDshSource(options.dshRevision, options.trial.dshProfileInstall ?? false)
    : undefined

  const trialOptions = {
    ...dshSource === undefined ? {} : { dshSource },
    evaluatorPath,
    outputDir: options.outputDir,
    trial: options.trial,
  }
  const knownBad = await evaluateTree({ ...trialOptions, sourceDir: knownBadDir })
  const knownCorrection = await evaluateTree({
    ...trialOptions,
    sourceDir: knownCorrectionDir,
  })
  const baseline = await evaluateTree({ ...trialOptions, sourceDir: options.skillDir })
  const candidate = await evaluateTree({
    ...trialOptions,
    proposal: options.proposal,
    sourceDir: options.skillDir,
  })

  return {
    backend: 'darwin-seatbelt',
    count: requiredTrialCount,
    assembled: options.trial.dshAssembled ?? false,
    calibration: [
      calibrationResult('known-bad', 'fail', knownBad.passed),
      calibrationResult('known-correction', 'pass', knownCorrection.passed),
    ],
    baseline,
    candidate,
  }
}

function calibrationResult(
  id: 'known-bad' | 'known-correction',
  expected: 'fail' | 'pass',
  passed: boolean,
): PairedTrialResult['calibration'][number] {
  const actual = passed ? 'pass' : 'fail'
  return { id, expected, actual, passed: actual === expected }
}

async function evaluateTree(options: {
  dshSource?: DshSource
  evaluatorPath: string
  outputDir: string
  proposal?: Proposal
  sourceDir: string
  trial: TrialDefinition
}): Promise<EvaluatorOutcome> {
  const trialRoot = await mkdtemp(join(options.outputDir, '.trial-'))
  try {
    const candidateDir = join(trialRoot, 'candidate')
    await cp(options.sourceDir, candidateDir, { recursive: true })
    if (options.proposal) await applyProposal(candidateDir, options.proposal)
    const treeHash = await hashTree(candidateDir)
    const evaluatorCopy = join(trialRoot, 'evaluator.mjs')
    await writeFile(evaluatorCopy, await readFile(options.evaluatorPath))
    let packageManagerCommand: string | undefined
    if (options.dshSource?.packageManager !== undefined) {
      const toolsDir = join(trialRoot, '.host-tools')
      await mkdir(toolsDir)
      packageManagerCommand = join(toolsDir, 'pnpm')
      await symlink(options.dshSource.packageManager.executable, packageManagerCommand)
    }
    const execution = await runSealedDarwinTrial({
      argv: [
        process.execPath,
        evaluatorCopy,
        candidateDir,
        ...options.dshSource === undefined
          ? []
          : [options.dshSource.dir, ...packageManagerCommand === undefined ? [] : [packageManagerCommand]],
      ],
      ...options.dshSource === undefined
        ? {}
        : {
            allowProcessFork: true,
            allowedExecutables: [
              '/bin/bash',
              ...options.dshSource.packageManager === undefined
                ? []
                : [options.dshSource.packageManager.executable, '/usr/bin/env'],
            ],
            readOnlyRoots: options.dshSource.readOnlyRoots,
          },
      outputLimitBytes: options.trial.outputLimitBytes,
      timeoutMs: options.trial.timeoutMs,
      workspace: trialRoot,
    })
    if (execution.timedOut) throw new Error('Trial evaluator exceeded its wall-clock budget')
    if (execution.outputTruncated) throw new Error('Trial evaluator exceeded its output budget')
    if (execution.exitCode !== 0) {
      const detail = execution.stderr.trim()
      throw new Error(`Trial evaluator exited with ${execution.exitCode}${detail ? `: ${detail}` : ''}`)
    }
    const outcome = parseEvaluatorOutcome(execution.stdout)
    if (options.dshSource !== undefined && outcome.composition === undefined) {
      throw new Error('assembled Trial evaluator returned no composition evidence')
    }
    return { ...outcome, treeHash }
  } finally {
    await rm(trialRoot, { force: true, recursive: true })
  }
}

async function applyProposal(candidateDir: string, proposal: Proposal): Promise<void> {
  const candidateRoot = await realpath(candidateDir)
  for (const file of proposal.files) {
    const target = resolve(candidateRoot, file.path)
    const parent = dirname(target)
    await mkdir(parent, { recursive: true })
    assertInside(candidateRoot, await realpath(parent), 'Candidate file parent')
    try {
      const targetStats = await lstat(target)
      if (targetStats.isSymbolicLink()) {
        throw new Error(`Candidate file cannot replace a symlink: ${file.path}`)
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
    await writeFile(target, file.content)
  }
}

async function resolveCasePackEntry(casePackDir: string, entry: string): Promise<string> {
  if (!isOwnedRelativePath(entry)) throw new Error(`case pack entry is not owned: ${entry}`)
  const path = await realpath(resolve(casePackDir, entry))
  assertInside(casePackDir, path, 'Case pack entry')
  return path
}

function assertInside(root: string, path: string, label: string): void {
  const fromRoot = relative(root, path)
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))) return
  throw new Error(`${label} escapes its root`)
}

function isOwnedRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || isAbsolute(path)) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function parseEvaluatorOutcome(source: string): Pick<EvaluatorOutcome, 'passed' | 'checks' | 'composition'> {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Trial evaluator output is not valid JSON')
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.passed !== 'boolean'
    || !Array.isArray(value.checks)) {
    throw new Error('Trial evaluator output has an invalid shape')
  }
  for (const check of value.checks) {
    if (!isRecord(check) || typeof check.name !== 'string' || typeof check.passed !== 'boolean') {
      throw new Error('Trial evaluator check has an invalid shape')
    }
  }
  const checks = value.checks as EvaluatorCheck[]
  if (checks.length === 0) throw new Error('Trial evaluator returned no checks')
  if (value.passed !== checks.every((check) => check.passed)) {
    throw new Error('Trial evaluator aggregate contradicts its checks')
  }
  const composition = value.composition === undefined
    ? undefined
    : parseEvaluatorComposition(value.composition)
  return {
    passed: value.passed,
    checks,
    ...composition === undefined ? {} : { composition },
  }
}

function parseEvaluatorComposition(value: unknown): EvaluatorComposition {
  if (!isRecord(value)
    || typeof value.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !Number.isSafeInteger(value.modelCalls)
    || (value.modelCalls as number) < 0
    || !isRecord(value.usage)) {
    throw new Error('Trial evaluator composition evidence has an invalid shape')
  }
  const usage: EvaluatorComposition['usage'] = {}
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
    const amount = value.usage[key]
    if (amount === undefined) continue
    if (!Number.isSafeInteger(amount) || (amount as number) < 0) {
      throw new Error('Trial evaluator composition usage has an invalid shape')
    }
    usage[key] = amount as number
  }
  return {
    fingerprint: value.fingerprint,
    modelCalls: value.modelCalls as number,
    usage,
  }
}

const execFileAsync = promisify(execFile)

async function resolveDshSource(expectedRevision: string, profileInstall: boolean): Promise<DshSource> {
  const configured = process.env.DSH_EVOLVE_DSH_SOURCE_DIR
  if (configured === undefined || configured.trim() === '') {
    throw new Error('assembled Trial requires DSH_EVOLVE_DSH_SOURCE_DIR')
  }
  const sourceDir = await realpath(resolve(configured))
  const packageJson = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8')) as unknown
  if (!isRecord(packageJson) || packageJson.name !== '@deepseek-ai/dsh-root') {
    throw new Error('DSH_EVOLVE_DSH_SOURCE_DIR is not a DeepSeek Harness checkout')
  }
  const result = await execFileAsync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    timeout: 5_000,
  })
  const actualRevision = result.stdout.trim()
  if (actualRevision !== expectedRevision) {
    throw new Error(`DSH source revision ${actualRevision} does not match case pack ${expectedRevision}`)
  }
  const readOnlyRoots = await Promise.all(
    ['apps', 'examples', 'packages', 'node_modules', 'vendor']
      .map(async path => await realpath(join(sourceDir, path))),
  )
  await realpath(join(sourceDir, 'packages', 'boot', 'app-boot', 'lib', 'index.js'))
  if (!profileInstall) {
    return { dir: sourceDir, readOnlyRoots }
  }
  readOnlyRoots.push(await realpath(join(sourceDir, 'native')))
  const pnpm = await resolvePnpmExecutable()
  return {
    dir: sourceDir,
    readOnlyRoots: [...new Set([...readOnlyRoots, ...pnpm.readOnlyRoots])],
    packageManager: pnpm,
  }
}

async function resolveHostExecutable(name: string): Promise<{
  commandPath: string
  executable: string
  packageRoot?: string
  readOnlyRoots: string[]
}> {
  const hostPath = process.env.PATH
  if (hostPath === undefined) throw new Error(`assembled Trial cannot locate ${name}: host PATH is unset`)
  for (const directory of hostPath.split(':')) {
    if (directory === '') continue
    const commandPath = resolve(directory, name)
    try {
      await access(commandPath, constants.X_OK)
      const executable = await realpath(commandPath)
      const packageRoot = await findPackageRoot(executable)
      const roots = await Promise.all(
        [dirname(commandPath), dirname(executable), packageRoot]
          .filter((path): path is string => path !== undefined)
          .map(async path => await realpath(path)),
      )
      return {
        commandPath,
        executable,
        ...packageRoot === undefined ? {} : { packageRoot },
        readOnlyRoots: [...new Set(roots)],
      }
    } catch (error) {
      if (isMissingPathError(error) || (isRecord(error) && error.code === 'EACCES')) continue
      throw error
    }
  }
  throw new Error(`assembled Trial cannot locate executable ${name} on host PATH`)
}

async function resolvePnpmExecutable(): Promise<HostExecutable> {
  const located = await resolveHostExecutable('pnpm')
  const rootManifest = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as unknown
  const packageManager = isRecord(rootManifest) ? rootManifest.packageManager : undefined
  const expectedVersion = typeof packageManager === 'string'
    ? /^pnpm@(?<version>\d+\.\d+\.\d+(?:-.+)?)$/.exec(packageManager)?.groups?.version
    : undefined
  if (expectedVersion === undefined) {
    throw new Error('assembled Trial requires an exact pnpm packageManager version')
  }
  const packageRoots = [
    located.packageRoot,
    process.env.PNPM_HOME === undefined ? undefined : resolve(process.env.PNPM_HOME, '..', 'pnpm'),
    ...[
      process.env.COREPACK_HOME,
      join(homedir(), '.cache', 'node', 'corepack'),
      join(homedir(), 'Library', 'Caches', 'node', 'corepack'),
    ].filter((path): path is string => path !== undefined && path !== '')
      .map(home => join(home, 'v1', 'pnpm', expectedVersion)),
  ].filter((path): path is string => path !== undefined)
  for (const packageRoot of packageRoots) {
    const resolved = await resolvePnpmPackage(packageRoot, expectedVersion)
    if (resolved !== undefined) return resolved
  }
  throw new Error(`assembled Trial cannot find installed pnpm ${expectedVersion} without network access`)
}

async function resolvePnpmPackage(
  packageRoot: string,
  expectedVersion: string,
): Promise<HostExecutable | undefined> {
  try {
    const root = await realpath(packageRoot)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as unknown
    if (!isRecord(manifest) || manifest.name !== 'pnpm' || manifest.version !== expectedVersion) return undefined
    const bin = isRecord(manifest.bin) ? manifest.bin.pnpm : undefined
    if (typeof bin !== 'string') return undefined
    const executable = await realpath(resolve(root, bin))
    await access(executable, constants.X_OK)
    return { executable, readOnlyRoots: [root] }
  } catch (error) {
    if (isMissingPathError(error) || (isRecord(error) && error.code === 'EACCES')) return undefined
    throw error
  }
}

async function findPackageRoot(executable: string): Promise<string | undefined> {
  let directory = dirname(executable)
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown
      if (isRecord(manifest) && typeof manifest.name === 'string') return directory
    } catch (error) {
      if (!isMissingPathError(error) && !(error instanceof SyntaxError)) throw error
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
