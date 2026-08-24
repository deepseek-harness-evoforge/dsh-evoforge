import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUPPORTED_DSH_TARGETS,
  assertSupportedDshTarget,
} from './run-dsh-compatibility-matrix.mjs'

test('admits only the two audited DSH revision/version pairs', () => {
  for (const [revision, version] of Object.entries(SUPPORTED_DSH_TARGETS)) {
    assert.deepEqual(
      assertSupportedDshTarget({ revision, version, dirty: '' }),
      { revision, version },
    )
  }
})

test('rejects an unreviewed revision', () => {
  assert.throws(
    () => assertSupportedDshTarget({ revision: 'f'.repeat(40), version: '0.1.1-rc.2', dirty: '' }),
    /unsupported DSH revision/u,
  )
})

test('rejects a version mismatch and tracked source changes', () => {
  const [revision, version] = Object.entries(SUPPORTED_DSH_TARGETS)[0]
  assert.throws(
    () => assertSupportedDshTarget({ revision, version: '0.1.1-rc.2', dirty: '' }),
    /must report version/u,
  )
  assert.throws(
    () => assertSupportedDshTarget({ revision, version, dirty: ' M packages/core/tools/src/index.ts' }),
    /tracked changes/u,
  )
})
