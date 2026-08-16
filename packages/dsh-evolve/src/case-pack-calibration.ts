import { mkdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { hashTree, sha256 } from './hash.ts'
import { writeDurableJson } from './shadow-run-state.ts'
import { parseCasePackManifest } from './shadow.ts'
import { runCalibrationTrial } from './trial.ts'

export interface CasePackCalibrationOptions {
  casePackDir: string
  outputDir: string
  signal?: AbortSignal
}

export type CasePackCalibrationResult =
  | { status: 'calibrated'; reportPath: string; summary: string }
  | { status: 'not-calibrated'; reportPath: string; reason: string }
  | { status: 'incomplete'; reportPath: string; reason: string }

/** Prove evaluator direction with two sealed fixtures and zero proposer calls. */
export async function calibrateCasePack(
  options: CasePackCalibrationOptions,
): Promise<CasePackCalibrationResult> {
  options.signal?.throwIfAborted()
  const casePackDir = await realpath(options.casePackDir)
  const requestedOutputDir = resolve(options.outputDir)
  const outputDir = resolve(await realpath(dirname(requestedOutputDir)), basename(requestedOutputDir))
  assertSeparateOutput(outputDir, casePackDir)
  const manifest = parseCasePackManifest(
    await readFile(resolve(casePackDir, 'manifest.json'), 'utf8'),
  )
  if (manifest.trial === undefined || manifest.calibration === undefined) {
    throw new Error('case pack calibration requires trial and calibration definitions')
  }
  if (manifest.budget.trialLimit < 4) {
    throw new Error(
      `case pack trial budget is ${manifest.budget.trialLimit}; a paired Shadow requires 4`,
    )
  }
  const casePackHash = await hashTree(casePackDir)
  const runId = sha256(JSON.stringify({
    casePackHash,
    dshRevision: manifest.epoch.dshRevision,
    evaluatorVersion: manifest.epoch.evaluatorVersion,
  }))
  const startedAt = new Date().toISOString()
  await mkdir(outputDir)
  const reportPath = resolve(outputDir, 'calibration-report.json')
  const reportBase = {
    schemaVersion: 1,
    run: { id: runId, startedAt },
    casePack: { id: manifest.id, hash: casePackHash },
    epoch: manifest.epoch,
    model: { calls: 0, inputTokens: 0, outputTokens: 0 },
  } as const

  let calibration
  try {
    calibration = await runCalibrationTrial({
      calibration: manifest.calibration,
      casePackDir,
      dshRevision: manifest.epoch.dshRevision,
      outputDir,
      ...options.signal === undefined ? {} : { signal: options.signal },
      trial: manifest.trial,
      trialLimit: manifest.budget.trialLimit,
    })
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason
    const reason = error instanceof Error ? error.message : String(error)
    await writeDurableJson(reportPath, {
      ...reportBase,
      run: { ...reportBase.run, status: 'incomplete', finishedAt: new Date().toISOString() },
      calibrated: false,
      calibration: [],
      reason,
    })
    return { status: 'incomplete', reportPath, reason }
  }

  const finalCasePackHash = await hashTree(casePackDir)
  if (finalCasePackHash !== casePackHash) {
    const reason = 'case pack changed during calibration'
    await writeDurableJson(reportPath, {
      ...reportBase,
      run: { ...reportBase.run, status: 'incomplete', finishedAt: new Date().toISOString() },
      casePack: { ...reportBase.casePack, finalHash: finalCasePackHash, unchanged: false },
      calibrated: false,
      calibration: calibration.calibration,
      trial: {
        backend: calibration.backend,
        count: calibration.count,
        assembled: calibration.assembled,
      },
      reason,
    })
    return { status: 'incomplete', reportPath, reason }
  }

  const failed = calibration.calibration.find(result => !result.passed)
  const calibrated = failed === undefined
  await writeDurableJson(reportPath, {
    ...reportBase,
    run: { ...reportBase.run, status: 'complete', finishedAt: new Date().toISOString() },
    casePack: { ...reportBase.casePack, finalHash: finalCasePackHash, unchanged: true },
    calibrated,
    calibration: calibration.calibration,
    trial: {
      backend: calibration.backend,
      count: calibration.count,
      assembled: calibration.assembled,
    },
  })
  if (failed !== undefined) {
    return {
      status: 'not-calibrated',
      reportPath,
      reason: `${failed.id} expected ${failed.expected} but got ${failed.actual}`,
    }
  }
  return {
    status: 'calibrated',
    reportPath,
    summary: `known-bad failed and known-correction passed; report: ${reportPath}`,
  }
}

function assertSeparateOutput(outputDir: string, casePackDir: string): void {
  const fromCasePack = relative(casePackDir, outputDir)
  const fromOutput = relative(outputDir, casePackDir)
  if (fromCasePack === '' || (!fromCasePack.startsWith('..') && !isAbsolute(fromCasePack))) {
    throw new Error('calibration output directory must be outside the case pack')
  }
  if (fromOutput === '' || (!fromOutput.startsWith('..') && !isAbsolute(fromOutput))) {
    throw new Error('calibration output directory must not contain the case pack')
  }
}
