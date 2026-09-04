import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const cases = [
  {
    id: 'ev1',
    manifest: 'benchmarks/hermes-v0.1/ev1-control-plane/manifest-alpha5-hermes-current-epoch4.json',
    result: 'benchmarks/hermes-v0.1/ev1-control-plane/result-alpha5-hermes-current-epoch4.json',
    script: 'benchmark:hermes:ev1:alpha5:current',
    aggregateScript: 'benchmark:hermes:ev1:alpha5:current',
  },
  {
    id: 'sd1',
    manifest: 'benchmarks/hermes-v0.1/sd1-completion-control/manifest-current.json',
    result: 'benchmarks/hermes-v0.1/sd1-completion-control/result-current.json',
    script: 'benchmark:hermes:sd1:current',
    aggregateScript: 'benchmark:hermes:sd1:current',
  },
  {
    id: 'lc1',
    manifest: 'benchmarks/hermes-v0.1/lc1-crash-recovery/manifest-current.json',
    result: 'benchmarks/hermes-v0.1/lc1-crash-recovery/result-current.json',
    script: 'benchmark:hermes:lc1:current',
    aggregateScript: 'benchmark:hermes:lc1:current',
  },
  {
    id: 'as1',
    manifest: 'benchmarks/hermes-v0.1/as1-telegram-approval/manifest-current.json',
    result: 'benchmarks/hermes-v0.1/as1-telegram-approval/result-current.json',
    script: 'benchmark:hermes:as1:current',
    aggregateScript: 'benchmark:hermes:as1:current',
  },
]

test('current Hermes benchmark fixtures are revision-matched and exposed by package scripts', async () => {
  const revisions = new Set()
  for (const entry of cases) {
    const manifest = JSON.parse(await readFile(new URL(`../${entry.manifest}`, import.meta.url), 'utf8'))
    const result = JSON.parse(await readFile(new URL(`../${entry.result}`, import.meta.url), 'utf8'))
    assert.equal(result.benchmarkId, manifest.id, `${entry.id} result must match its manifest`)
    assert.deepEqual(result.revisions, manifest.revisions, `${entry.id} result revisions must be frozen`)
    revisions.add(`${manifest.revisions.deepseekHarness}:${manifest.revisions.hermesAgent}`)
    assert.equal(typeof packageJson.scripts[entry.script], 'string', `${entry.script} must remain callable`)
  }
  assert.equal(revisions.size, 1, 'all current slices must compare the same DSH and Hermes revisions')
})

test('aggregate current Hermes command includes all four slices', () => {
  const command = packageJson.scripts['benchmark:hermes:current']
  assert.equal(typeof command, 'string')
  for (const entry of cases) assert.match(command, new RegExp(entry.aggregateScript))
})
