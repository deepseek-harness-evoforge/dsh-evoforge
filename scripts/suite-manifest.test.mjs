import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHANNEL_ADAPTER_IDS,
  COMPATIBILITY_SUITE_IDS,
  DEFAULT_SUITE_ID,
  OPTIONAL_SUITE_IDS,
  PACKAGE_NAMES,
  PUBLIC_SUITE_IDS,
  SUITES,
  getSuiteAudience,
  getSuitePackages,
  validateSuiteManifest,
} from './suite-manifest.mjs'

test('capability suite manifest is complete and has no duplicate package rows', () => {
  assert.deepEqual(validateSuiteManifest(), [])
  assert.equal(new Set(PACKAGE_NAMES).size, PACKAGE_NAMES.length)
  assert.deepEqual(new Set(SUITES.full.packages), new Set(PACKAGE_NAMES))
})

test('user-facing suites keep independent runtime boundaries explicit', () => {
  assert.deepEqual(PUBLIC_SUITE_IDS, ['product', 'delivery', 'continuity'])
  assert.equal(DEFAULT_SUITE_ID, 'product')
  assert.deepEqual(SUITES.product.packages, [
    'dsh-evolve',
    'dsh-doctor',
    'dsh-control-center',
    'dsh-evolve-web',
    'dsh-gateway',
    'dsh-feishu',
    'dsh-telegram',
  ])
  assert.deepEqual(SUITES.core.packages, [
    'dsh-evolve',
    'dsh-doctor',
    'dsh-control-center',
    'dsh-evolve-web',
  ])
  assert.equal(getSuiteAudience('product'), 'default')
  assert.equal(getSuiteAudience('core'), 'compatibility')
  assert.deepEqual(OPTIONAL_SUITE_IDS, ['attention'])
  assert.equal(getSuiteAudience('attention'), 'optional')
  assert.deepEqual(COMPATIBILITY_SUITE_IDS, ['core', 'channels', 'evolution', 'control', 'gateway'])
  assert.equal(getSuiteAudience('full'), 'maintainer')
  assert.deepEqual(CHANNEL_ADAPTER_IDS, ['feishu', 'telegram'])
  assert.deepEqual(getSuitePackages('channels'), SUITES.channels.packages)
  assert.deepEqual(getSuitePackages('channels', 'feishu'), ['dsh-control-center', 'dsh-gateway', 'dsh-feishu'])
  assert.deepEqual(getSuitePackages('channels', 'telegram'), ['dsh-control-center', 'dsh-gateway', 'dsh-telegram'])
  assert.throws(() => getSuitePackages('core', 'feishu'), /only valid with --suite channels/u)
  assert.throws(() => getSuitePackages('channels', 'slack'), /Unknown channel/u)
  assert.deepEqual(SUITES.evolution.packages, ['dsh-evolve', 'dsh-doctor'])
  assert.deepEqual(SUITES.control.packages, ['dsh-control-center', 'dsh-evolve-web'])
  assert.deepEqual(SUITES.channels.packages, ['dsh-control-center', 'dsh-gateway', 'dsh-feishu', 'dsh-telegram'])
  assert.ok(!SUITES.channels.packages.includes('dsh-evolve-attention'))
  assert.ok(SUITES.channels.packages.includes('dsh-control-center'))
  assert.deepEqual(SUITES.delivery.packages, ['dsh-software-delivery'])
  assert.ok(SUITES.continuity.packages.includes('dsh-resident'))
})
