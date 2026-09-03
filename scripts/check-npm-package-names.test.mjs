import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyRegistryResult, sameRepository } from './check-npm-package-names.mjs'

const repository = 'git+https://github.com/deepseek-harness-evoforge/dsh-evoforge.git'

test('classifies an unregistered npm name as available', () => {
  assert.deepEqual(classifyRegistryResult({ status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found' }, repository), {
    state: 'available',
  })
})

test('classifies a package owned by this repository as owned', () => {
  assert.deepEqual(classifyRegistryResult({
    status: 0,
    stdout: JSON.stringify({ version: '0.1.0', repository: { url: repository } }),
  }, repository), {
    state: 'owned',
    version: '0.1.0',
    repository,
  })
})

test('classifies a different repository as a collision', () => {
  assert.deepEqual(classifyRegistryResult({
    status: 0,
    stdout: JSON.stringify({ version: '9.9.9', repository: { url: 'git+https://example.com/other.git' } }),
  }, repository), {
    state: 'collision',
    version: '9.9.9',
    repository: 'git+https://example.com/other.git',
  })
})

test('fails closed on registry errors that are not a 404', () => {
  assert.deepEqual(classifyRegistryResult({ status: 1, stderr: 'npm error code ETIMEDOUT' }, repository), {
    state: 'unknown',
    reason: 'npm error code ETIMEDOUT',
  })
})

test('accepts equivalent GitHub repository URL forms without accepting another host', () => {
  assert.equal(sameRepository('https://github.com/deepseek-harness-evoforge/dsh-evoforge/', repository), true)
  assert.equal(sameRepository('git@github.com:deepseek-harness-evoforge/dsh-evoforge.git', repository), true)
  assert.equal(sameRepository('git+https://github.com/deepseek-harness-evoforge/other.git', repository), false)
  assert.equal(sameRepository('https://example.com/deepseek-harness-evoforge/dsh-evoforge.git', repository), false)
})

test('classifies a normalized URL for this repository as owned', () => {
  assert.deepEqual(classifyRegistryResult({
    status: 0,
    stdout: JSON.stringify({ version: '0.1.1', repository: { url: 'https://github.com/deepseek-harness-evoforge/dsh-evoforge/' } }),
  }, repository), {
    state: 'owned',
    version: '0.1.1',
    repository: 'https://github.com/deepseek-harness-evoforge/dsh-evoforge/',
  })
})
