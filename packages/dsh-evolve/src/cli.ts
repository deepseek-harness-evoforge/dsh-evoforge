#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { runShadow } from './shadow.js'

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
    const [command, skillDir, ...extraPositionals] = parsed.positionals
    if (command !== 'shadow' || !skillDir || extraPositionals.length > 0) {
      throw new Error('usage: dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>')
    }
    const casePackDir = parsed.values['case-pack']
    const outputDir = parsed.values.output
    if (!casePackDir || !outputDir) {
      throw new Error('--case-pack and --output are required')
    }
    const result = await runShadow({ casePackDir, outputDir, skillDir })
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
