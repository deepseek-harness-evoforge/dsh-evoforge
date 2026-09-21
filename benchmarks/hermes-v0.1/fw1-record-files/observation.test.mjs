import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectFileOperations } from './observation.mjs'

function events({ partial = false, earlyRead = false, missingWrite = false } = {}) {
  const operations = [
    ['read_file', { path: '/case/in.json' }, { content: partial ? '1|[\n' : '1|[\n2|  3\n3|]', total_lines: 3 }],
    ['write_file', { path: '/case/result.json', content: '{"n":3}\n' }, { verified: true }],
    ['read_file', { path: '/case/result.json' }, { content: '1|{"n":3}', total_lines: 1 }],
  ]
  if (earlyRead) [operations[1], operations[2]] = [operations[2], operations[1]]
  return operations.filter(x => !missingWrite || x[0] !== 'write_file').flatMap(([tool, args, result], i) => [
    { kind: 'tool-start', tool, args, callId: String(i) },
    { kind: 'tool-result', tool, args, result: JSON.stringify(result), callId: String(i) },
  ])
}
const inspect = (e) => inspectFileOperations(e, { cwd: '/case', root: '/case',
  inputs: [{ path: 'in.json', content: '[\n  3\n]\n' }], output: '{"n":3}\n' })

test('requires complete actual reads and write-before-readback evidence', () => {
  assert.equal(inspect(events()).complete, true)
  for (const settings of [{ partial: true }, { earlyRead: true }, { missingWrite: true }]) {
    assert.equal(inspect(events(settings)).complete, false)
  }
  assert.equal(inspect(events().filter(e => e.kind !== 'tool-start')).complete, false)
  assert.equal(inspect([...events(), { kind: 'denied' }]).complete, false)
  const forged = events()
  forged.at(-1).result = JSON.stringify({ content: '1|{"n":4}', total_lines: 1 })
  assert.equal(inspect(forged).complete, false)
})
