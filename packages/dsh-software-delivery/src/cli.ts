#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { verifyDelivery, type DeliveryCheck } from './verify-delivery.js'

interface ConfigFile {
  readonly schemaVersion: 1
  readonly baseRef: string
  readonly checks: readonly DeliveryCheck[]
  readonly timeoutMs?: number
  readonly outputLimitBytes?: number
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: dsh-delivery verify --worktree <absolute-path> --config <config.json>\n')
    return 0
  }
  if (argv[0] !== 'verify') throw new Error('expected the verify command')
  const worktree = option(argv, '--worktree')
  const configPath = option(argv, '--config')
  const config = parseConfig(JSON.parse(await readFile(configPath, 'utf8')))
  const result = await verifyDelivery({
    worktree,
    baseRef: config.baseRef,
    checks: config.checks,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.outputLimitBytes === undefined ? {} : { outputLimitBytes: config.outputLimitBytes }),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result.status === 'passed' ? 0 : result.status === 'failed' ? 1 : 2
}

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index === -1 ? undefined : argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required`)
  return value
}

function parseConfig(input: unknown): ConfigFile {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('config must be an object')
  const value = input as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'baseRef', 'checks', 'timeoutMs', 'outputLimitBytes'])
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown !== undefined) throw new Error(`unknown config field: ${unknown}`)
  if (value.schemaVersion !== 1) throw new Error('config schemaVersion must be 1')
  return value as unknown as ConfigFile
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`dsh-delivery: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}
