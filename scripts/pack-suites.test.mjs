import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const exec = promisify(execFile)
const script = join(dirname(fileURLToPath(import.meta.url)), 'pack-suites.mjs')

test('pack:suite help presents product choices before internal compatibility entries', async () => {
  const result = await exec(process.execPath, [script, '--help'], { encoding: 'utf8' })
  assert.match(result.stdout, /User-facing suites: core, channels, delivery, continuity/u)
  assert.match(result.stdout, /Optional add-on: attention/u)
  assert.match(result.stdout, /Compatibility\/advanced: evolution, control, gateway/u)
  assert.match(result.stdout, /Maintainer-only: full/u)
  assert.ok(result.stdout.indexOf('User-facing suites:') < result.stdout.indexOf('Maintainer-only:'))
})
