import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requireDshPreflight } from './check-dsh-preflight.mjs'

test('requires an explicit DSH source for the full check', () => {
  assert.throws(
    () => requireDshPreflight({}),
    /DSH_EVOLVE_DSH_SOURCE_DIR is required/u,
  )
})
