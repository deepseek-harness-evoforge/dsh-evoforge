import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyBuildFailure } from './audit-dsh-latest.mjs'

test('classifies the known clean rc.1 root build defect', () => {
  assert.equal(
    classifyBuildFailure('ERROR [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]'),
    'blocked-upstream-root-types-entry',
  )
})

test('does not hide an unknown latest DSH build failure', () => {
  assert.equal(classifyBuildFailure('tsdown failed for a new reason'), 'unknown')
  assert.equal(classifyBuildFailure(''), 'unknown')
})
