#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { calibrateCasePack } from './case-pack-calibration.js'
import { runShadow } from './shadow.js'

const SHADOW_USAGE = 'usage: dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--feedback-draft <private-draft.json>] [--resume]'
const CALIBRATE_USAGE = 'usage: dsh-evolve calibrate --case-pack <case-pack-dir> --output <run-dir>'

async function main(): Promise<number> {
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        'case-pack': { type: 'string' },
        'feedback-draft': { type: 'string' },
        output: { type: 'string' },
        resume: { type: 'boolean', default: false },
      },
      strict: true,
    })
    const [command, ...positionals] = parsed.positionals
    const casePackDir = parsed.values['case-pack']
    const outputDir = parsed.values.output
    if (!casePackDir || !outputDir) {
      throw new Error('--case-pack and --output are required')
    }
    if (command === 'calibrate') {
      if (positionals.length > 0
        || parsed.values['feedback-draft'] !== undefined
        || parsed.values.resume) {
        throw new Error(CALIBRATE_USAGE)
      }
      const result = await calibrateCasePack({ casePackDir, outputDir })
      if (result.status === 'calibrated') {
        process.stdout.write(`calibrated: ${result.summary}\n`)
        return 0
      }
      process.stderr.write(
        `${result.status}: ${result.reason}; report: ${result.reportPath}\n`,
      )
      return 2
    }
    const [skillDir, ...extraPositionals] = positionals
    if (command !== 'shadow' || !skillDir || extraPositionals.length > 0) {
      throw new Error(SHADOW_USAGE)
    }
    const result = await runShadow({
      casePackDir,
      ...(parsed.values['feedback-draft'] === undefined
        ? {}
        : { feedbackDraftPath: parsed.values['feedback-draft'] }),
      outputDir,
      resume: parsed.values.resume,
      skillDir,
    })
    if (result.status === 'incomplete') {
      process.stderr.write(`incomplete: ${result.reason}\n`)
      return 2
    }
    process.stdout.write(`${result.summary}\n`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`error: ${message}\n`)
    return 1
  }
}

process.exitCode = await main()
