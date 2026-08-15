import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { hashTree } from './hash.js'
import { runSealedDarwinTrial } from './sealed-trial-darwin.js'

interface TrialDefinition {
  evaluator: string
  timeoutMs: number
  outputLimitBytes: number
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
}

export interface PairedTrialResult {
  backend: 'darwin-seatbelt'
  count: 4
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

  const trialOptions = {
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
    const execution = await runSealedDarwinTrial({
      argv: [process.execPath, evaluatorCopy, candidateDir],
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

function parseEvaluatorOutcome(source: string): Pick<EvaluatorOutcome, 'passed' | 'checks'> {
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
  return {
    passed: value.passed,
    checks,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
