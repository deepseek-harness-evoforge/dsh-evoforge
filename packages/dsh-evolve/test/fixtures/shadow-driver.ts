#!/usr/bin/env node
/** Test-only process driver for calibration exit-code coverage. It is not a product CLI. */
import { parseArgs } from 'node:util'
import { calibrateCasePack } from '../../src/case-pack-calibration.js'

const CALIBRATE_USAGE = 'usage: shadow-driver calibrate --case-pack <case-pack-dir> --output <run-dir>'

async function main(): Promise<number> {
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        'case-pack': { type: 'string' },
        output: { type: 'string' },
      },
      strict: true,
    })
    const [command, ...positionals] = parsed.positionals
    const casePackDir = parsed.values['case-pack']
    const outputDir = parsed.values.output
    if (!casePackDir || !outputDir) throw new Error('--case-pack and --output are required')
    if (command !== 'calibrate' || positionals.length > 0) throw new Error(CALIBRATE_USAGE)
    const result = await calibrateCasePack({ casePackDir, outputDir })
    if (result.status === 'calibrated') {
      process.stdout.write(`calibrated: ${result.summary}\n`)
      return 0
    }
    process.stderr.write(`${result.status}: ${result.reason}; report: ${result.reportPath}\n`)
    return 2
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`error: ${message}\n`)
    return 1
  }
}

process.exitCode = await main()
