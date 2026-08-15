import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const FINAL_TEST_SENTINEL = 'case-pack-only-final-test-sentinel'
const source = await readFile(join(process.argv[2], 'SKILL.md'), 'utf8')
const passed = source.includes('verify the real flow in a controlled browser')

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  passed,
  checks: [{ name: 'real-browser-e2e', passed }],
  sentinelLength: FINAL_TEST_SENTINEL.length,
}))
