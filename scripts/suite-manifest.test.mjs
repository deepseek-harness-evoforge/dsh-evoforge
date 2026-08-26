import test from 'node:test'
import assert from 'node:assert/strict'
import { PACKAGE_NAMES, SUITES, validateSuiteManifest } from './suite-manifest.mjs'

test('capability suite manifest is complete and has no duplicate package rows', () => {
  assert.deepEqual(validateSuiteManifest(), [])
  assert.equal(new Set(PACKAGE_NAMES).size, PACKAGE_NAMES.length)
  assert.deepEqual(new Set(SUITES.full.packages), new Set(PACKAGE_NAMES))
})

test('user-facing suites keep independent runtime boundaries explicit', () => {
  assert.deepEqual(SUITES.evolution.packages, ['dsh-evolve', 'dsh-doctor'])
  assert.deepEqual(SUITES.control.packages, ['dsh-control-center', 'dsh-evolve-web'])
  assert.ok(SUITES.channels.packages.includes('dsh-gateway'))
  assert.ok(SUITES.delivery.packages.includes('dsh-github-review'))
  assert.ok(SUITES.continuity.packages.includes('dsh-resident'))
})
