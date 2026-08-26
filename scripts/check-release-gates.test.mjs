import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readReleaseGateManifest,
  requiredReleaseBlockers,
  validateReleaseGateManifest,
} from './check-release-gates.mjs'

test('release gate manifest is structurally valid and points at existing evidence', async () => {
  const manifest = await readReleaseGateManifest()
  assert.deepEqual(validateReleaseGateManifest(manifest), [])
  assert.ok(manifest.gates.length >= 6)
  assert.ok(requiredReleaseBlockers(manifest).some(gate => gate.id === 'real-feishu-as2'))
})

test('tag-required incomplete gates remain blockers', () => {
  const manifest = {
    schemaVersion: 1,
    releaseLine: 'test',
    requiredStatus: 'passed',
    gates: [{
      id: 'real-provider',
      title: 'provider',
      requiredForTag: true,
      status: 'not-run',
      evidence: ['docs/status.zh.md'],
      blocker: 'not authorized',
    }],
  }
  assert.deepEqual(validateReleaseGateManifest(manifest, process.cwd()), [])
  assert.deepEqual(requiredReleaseBlockers(manifest), [{
    id: 'real-provider',
    title: 'provider',
    status: 'not-run',
    blocker: 'not authorized',
  }])
})

test('incomplete gates require an explicit blocker explanation', () => {
  const errors = validateReleaseGateManifest({
    schemaVersion: 1,
    releaseLine: 'test',
    requiredStatus: 'passed',
    gates: [{
      id: 'missing-explanation',
      title: 'missing explanation',
      requiredForTag: true,
      status: 'partial',
      evidence: ['docs/status.zh.md'],
    }],
  }, process.cwd())
  assert.ok(errors.some(error => error.includes('blocker is required')))
})
