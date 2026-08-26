import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPATIBILITY_SUITE_IDS,
  DEFAULT_SUITE_ID,
  OPTIONAL_SUITE_IDS,
  PACKAGE_NAMES,
  PUBLIC_SUITE_IDS,
  SUITES,
  getSuiteAudience,
  validateSuiteManifest,
} from './suite-manifest.mjs'

test('capability suite manifest is complete and has no duplicate package rows', () => {
  assert.deepEqual(validateSuiteManifest(), [])
  assert.equal(new Set(PACKAGE_NAMES).size, PACKAGE_NAMES.length)
  assert.deepEqual(new Set(SUITES.full.packages), new Set(PACKAGE_NAMES))
})

test('user-facing suites keep independent runtime boundaries explicit', () => {
  assert.deepEqual(PUBLIC_SUITE_IDS, ['core', 'channels', 'delivery', 'continuity'])
  assert.equal(DEFAULT_SUITE_ID, 'core')
  assert.deepEqual(SUITES.core.packages, [
    'dsh-evolve',
    'dsh-doctor',
    'dsh-control-center',
    'dsh-evolve-web',
  ])
  assert.equal(getSuiteAudience('core'), 'default')
  assert.deepEqual(OPTIONAL_SUITE_IDS, ['attention'])
  assert.equal(getSuiteAudience('attention'), 'optional')
  assert.deepEqual(COMPATIBILITY_SUITE_IDS, ['evolution', 'control', 'gateway'])
  assert.equal(getSuiteAudience('full'), 'maintainer')
  assert.deepEqual(SUITES.evolution.packages, ['dsh-evolve', 'dsh-doctor'])
  assert.deepEqual(SUITES.control.packages, ['dsh-control-center', 'dsh-evolve-web'])
  assert.deepEqual(SUITES.channels.packages, ['dsh-gateway', 'dsh-feishu', 'dsh-telegram'])
  assert.ok(!SUITES.channels.packages.includes('dsh-evolve-attention'))
  assert.ok(!SUITES.channels.packages.includes('dsh-control-center'))
  assert.ok(SUITES.delivery.packages.includes('dsh-github-review'))
  assert.ok(SUITES.continuity.packages.includes('dsh-resident'))
})
