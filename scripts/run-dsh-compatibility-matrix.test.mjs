import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUPPORTED_DSH_TARGETS,
  assertSupportedDshTarget,
} from './run-dsh-compatibility-matrix.mjs'

test('pins the native-file and awaited Agent creation cohort', () => {
  assert.deepEqual(SUPPORTED_DSH_TARGETS, {
    '0d1f50007f9bca3f52b06e1c3074fa14d5fb0720': '0.1.6-alpha.1',
  })
  assert.throws(() => assertSupportedDshTarget({
    revision: 'db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5', version: '0.1.2-alpha.5', dirty: '',
  }), /unsupported DSH revision/u)
})

test('admits only the current audited DSH revision/version pair', () => {
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

test('rejects a version mismatch and any source-tree changes', () => {
  const [revision, version] = Object.entries(SUPPORTED_DSH_TARGETS)[0]
  assert.throws(
    () => assertSupportedDshTarget({ revision, version: '0.1.1-rc.2', dirty: '' }),
    /must report version/u,
  )
  assert.throws(
    () => assertSupportedDshTarget({ revision, version, dirty: ' M packages/core/tools/src/index.ts' }),
    /working tree changes/u,
  )
  assert.throws(
    () => assertSupportedDshTarget({ revision, version, dirty: '?? local-debug.log' }),
    /working tree changes/u,
  )
})
