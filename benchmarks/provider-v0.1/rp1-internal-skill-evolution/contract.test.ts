import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  PAID_PROVIDER_APPROVAL,
  resolveRealProviderAcceptance,
} from './contract.ts'

const proposerSecret = 'proposer-secret-value'
const governanceSecret = 'governance-secret-value'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const runner = resolve(
  repositoryRoot,
  'benchmarks/provider-v0.1/rp1-internal-skill-evolution/run.ts',
)
const tsx = resolve(repositoryRoot, 'packages/dsh-evolve/node_modules/.bin/tsx')

describe('RP-1 real-provider acceptance contract', () => {
  test('does not inspect or dispatch provider configuration before explicit paid-operation approval', () => {
    const resolved = resolveRealProviderAcceptance({
      DSH_EVOLVE_MODEL_API_KEY: proposerSecret,
      DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY: governanceSecret,
    })

    assert.deepEqual(resolved, {
      status: 'not-run',
      exitCode: 2,
      report: {
        schemaVersion: 1,
        benchmarkId: 'rp1-internal-skill-evolution-epoch-1',
        status: 'not-run',
        reasons: ['paid-provider-execution-not-authorized'],
      },
    })
    assert.doesNotMatch(JSON.stringify(resolved), new RegExp(proposerSecret, 'u'))
    assert.doesNotMatch(JSON.stringify(resolved), new RegExp(governanceSecret, 'u'))
  })

  test('reports every missing non-secret and secret reference without inventing a real run', () => {
    const resolved = resolveRealProviderAcceptance({
      DSH_EVOLVE_REAL_PROVIDER_APPROVED: PAID_PROVIDER_APPROVAL,
    })

    assert.equal(resolved.status, 'not-run')
    assert.equal(resolved.exitCode, 2)
    assert.deepEqual(resolved.report, {
      schemaVersion: 1,
      benchmarkId: 'rp1-internal-skill-evolution-epoch-1',
      status: 'not-run',
      reasons: [
        'missing:DSH_EVOLVE_MODEL_PROVIDER_ID',
        'missing:DSH_EVOLVE_MODEL_BASE_URL',
        'missing:DSH_EVOLVE_MODEL_NAME',
        'missing:DSH_EVOLVE_MODEL_API_KEY',
        'missing:DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID',
        'missing:DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL',
        'missing:DSH_EVOLVE_GOVERNANCE_MODEL_NAME',
        'missing:DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY',
        'missing:DSH_EVOLVE_DSH_SOURCE_DIR',
        'missing:DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT',
      ],
    })
  })

  for (const scenario of [
    {
      name: 'declared provider identity',
      patch: { DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID: 'provider-a' },
      reason: 'providers-not-independent:declared-identity',
    },
    {
      name: 'provider authority',
      patch: { DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL: 'https://api.proposer.example/v2' },
      reason: 'providers-not-independent:authority',
    },
    {
      name: 'credential',
      patch: { DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY: proposerSecret },
      reason: 'providers-not-independent:credential',
    },
  ] as const) {
    test(`fails before dispatch when the two sides share ${scenario.name}`, () => {
      const resolved = resolveRealProviderAcceptance({
        ...readyEnvironment(),
        ...scenario.patch,
      })

      assert.equal(resolved.status, 'failed')
      assert.equal(resolved.exitCode, 1)
      assert.deepEqual(resolved.report.reasons, [scenario.reason])
      assert.doesNotMatch(JSON.stringify(resolved.report), new RegExp(proposerSecret, 'u'))
      assert.doesNotMatch(JSON.stringify(resolved.report), new RegExp(governanceSecret, 'u'))
    })
  }

  test('rejects localhost and plaintext endpoints because they cannot prove an external real Provider', () => {
    const resolved = resolveRealProviderAcceptance({
      ...readyEnvironment(),
      DSH_EVOLVE_MODEL_BASE_URL: 'http://127.0.0.1:8080/v1',
    })

    assert.equal(resolved.status, 'failed')
    assert.equal(resolved.exitCode, 1)
    assert.deepEqual(resolved.report.reasons, ['invalid:DSH_EVOLVE_MODEL_BASE_URL'])
  })

  test('returns one private execution config and one secret-free preflight report for independent providers', () => {
    const resolved = resolveRealProviderAcceptance(readyEnvironment())

    assert.equal(resolved.status, 'ready')
    if (resolved.status !== 'ready') throw new Error('expected a ready provider configuration')
    assert.equal(resolved.exitCode, undefined)
    assert.equal(resolved.report.schemaVersion, 1)
    assert.equal(resolved.report.benchmarkId, 'rp1-internal-skill-evolution-epoch-1')
    assert.equal(resolved.report.status, 'ready')
    assert.equal(resolved.report.proposer.providerId, 'provider-a')
    assert.equal(resolved.report.proposer.model, 'author-model')
    assert.equal(resolved.report.governance.providerId, 'provider-b')
    assert.equal(resolved.report.governance.model, 'judge-model')
    assert.equal(resolved.execution.proposer.apiKey, proposerSecret)
    assert.equal(resolved.execution.governance.apiKey, governanceSecret)
    assert.doesNotMatch(JSON.stringify(resolved.report), new RegExp(proposerSecret, 'u'))
    assert.doesNotMatch(JSON.stringify(resolved.report), new RegExp(governanceSecret, 'u'))
  })

  test('exits 2 with exactly one JSON not-run report when the paid benchmark is not authorized', () => {
    const result = spawnSync(tsx, [runner], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })

    assert.equal(result.status, 2)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      benchmarkId: 'rp1-internal-skill-evolution-epoch-1',
      status: 'not-run',
      reasons: ['paid-provider-execution-not-authorized'],
    })
  })
})

function readyEnvironment(): NodeJS.ProcessEnv {
  return {
    DSH_EVOLVE_REAL_PROVIDER_APPROVED: PAID_PROVIDER_APPROVAL,
    DSH_EVOLVE_MODEL_PROVIDER_ID: 'provider-a',
    DSH_EVOLVE_MODEL_BASE_URL: 'https://api.proposer.example/v1',
    DSH_EVOLVE_MODEL_NAME: 'author-model',
    DSH_EVOLVE_MODEL_API_KEY: proposerSecret,
    DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID: 'provider-b',
    DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL: 'https://api.governance.example/v1',
    DSH_EVOLVE_GOVERNANCE_MODEL_NAME: 'judge-model',
    DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY: governanceSecret,
    DSH_EVOLVE_DSH_SOURCE_DIR: '/private/tmp/deepseek-harness',
    DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT: '/private/tmp/evoforge-rp1',
  }
}
