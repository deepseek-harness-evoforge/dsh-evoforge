import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReleaseTag } from './check-release-tag-version.mjs'

test('release tag must match the single package version', () => {
  assert.deepEqual(validateReleaseTag('dsh-v0.1.0-alpha.1', [
    '0.1.0-alpha.1',
    '0.1.0-alpha.1',
  ]), [])
})

test('tag/package mismatch and mixed package versions are rejected', () => {
  const errors = validateReleaseTag('dsh-v0.1.0-alpha.1', [
    '0.1.0-alpha.1',
    '0.1.0-alpha.2',
  ])
  assert.ok(errors.some(error => error.includes('share one version')))

  assert.ok(validateReleaseTag('dsh-v0.1.0-alpha.2', [
    '0.1.0-alpha.1',
  ]).some(error => error.includes('does not match')))
})

test('non-EvoForge tags are rejected', () => {
  assert.ok(validateReleaseTag('v0.1.0', ['0.1.0']).some(error => error.includes('invalid EvoForge release tag')))
})
