import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BENCHMARK_ID,
  PAID_PROVIDER_APPROVAL,
  resolveRealProviderAcceptance,
} from './contract-interaction-current-epoch-2.ts'
import {
  discoverModelDeclaredGapFixtureOpportunityBeforeProviderAccess,
  validateEpoch2ManifestSource,
} from './execute-interaction-current-epoch-2.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const runner = resolve(
  repositoryRoot,
  'benchmarks/provider-v0.1/rp1-internal-skill-evolution/run-interaction-current-epoch-2.ts',
)
const manifestSource = readFileSync(resolve(
  repositoryRoot,
  'benchmarks/provider-v0.1/rp1-internal-skill-evolution/manifest-interaction-current-epoch-2.json',
), 'utf8')
const expectedHardGates = [
  'five model-declared Gap fixtures yield exactly one internal Opportunity before provider dispatch',
  'explicit paid-operation approval exists before credentials are resolved',
  'proposer and governance use different declared providers, authorities, credentials, and production model identities',
  'the internally authored whole-Skill remains inactive, quarantined, unevaluated, and never executed before admission',
  'governance authors admission, holdout, and retention from pre-Candidate protected partitions',
  'deterministic admission qualifies the exact Candidate',
  'assembled holdout recommends promotion without composition drift',
  'independent assembled retention classifies the exact Candidate as retained',
] as const

describe('RP-1 model-declared Gap-fixture provider acceptance epoch 2', () => {
  test('accepts only the complete reviewed epoch-2 manifest', () => {
    const manifest = validateEpoch2ManifestSource(manifestSource)

    assert.deepEqual(manifest, JSON.parse(manifestSource))
    assert.equal(manifest.id, BENCHMARK_ID)
    assert.deepEqual(manifest.hardGates, expectedHardGates)
    assertManifestDriftRejected([
      ['schemaVersion', '"schemaVersion": 1', '"schemaVersion": 2'],
      ['id', `"id": "${BENCHMARK_ID}"`, `"id": "${BENCHMARK_ID}-drift"`],
      ['scope', 'real two-provider', 'real one-provider'],
      [
        'revisions.deepseekHarness',
        'db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5',
        'ab6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5',
      ],
      ['scenario.skillName', '"skillName": "recover-dsh-delivery"', '"skillName": "drift"'],
      ['scenario.goalCount', '"goalCount": 5', '"goalCount": 6'],
      [
        'scenario.source',
        '"source": "deterministic frozen Capability Gap fixtures',
        '"source": "mutable Capability Gap fixtures',
      ],
      [
        'scenario.partitions',
        '"partitions": ["authoring", "admission", "holdout", "retention"]',
        '"partitions": ["authoring", "admission", "retention", "holdout"]',
      ],
      ['budget.proposerCalls', '"proposerCalls": 1', '"proposerCalls": 2'],
      ['budget.governanceCalls', '"governanceCalls": 3', '"governanceCalls": 4'],
      ['budget.maxOutputTokensPerCall', '"maxOutputTokensPerCall": 6000', '"maxOutputTokensPerCall": 6001'],
      ['budget.trialCountPerSubject', '"trialCountPerSubject": 4', '"trialCountPerSubject": 5'],
      ...expectedHardGates.map((gate, index) => [
        `hardGates[${index}]`,
        JSON.stringify(gate),
        JSON.stringify(`${gate} drift`),
      ] as const),
      ['unknown top-level field', '  "scenario": {', '  "unexpected": true,\n  "scenario": {'],
      ['missing top-level field', '  "budget": {', '  "renamedBudget": {'],
    ])
  })

  test('discovers five qualified Gap fixtures and exactly one Opportunity without provider access', () => {
    const scenario = discoverModelDeclaredGapFixtureOpportunityBeforeProviderAccess()

    assert.equal(scenario.gaps.length, 5)
    assert.deepEqual(
      scenario.gaps.map(gap => gap.evidence),
      Array.from({ length: 5 }, () => ({
        kind: 'model-declared-skill-gap',
        catalog: 'complete',
        routing: 'model-declared-no-applicable-skill',
        providers: 'settled',
      })),
    )
    assert.deepEqual(
      scenario.gaps.map(gap => gap.authoringQualification?.kind),
      Array.from({ length: 5 }, () => 'completed-owned-gap-turn-v2'),
    )
    assert.equal(scenario.opportunities.length, 1)
    assert.equal(scenario.opportunities[0]?.workspaceId, scenario.workspaceId)
    assert.equal(scenario.opportunities[0]?.skillName, scenario.skillName)
    assert.equal(scenario.opportunities[0]?.goalCount, 5)
    assert.equal(scenario.opportunities[0]?.gapCount, 5)
    assert.deepEqual(
      scenario.opportunities[0]?.gapIds,
      scenario.gaps.map(gap => gap.id).sort(),
    )
  })

  test('returns NOT_RUN before approval', () => {
    assert.deepEqual(resolveRealProviderAcceptance({}), {
      status: 'not-run',
      exitCode: 2,
      report: {
        schemaVersion: 1,
        benchmarkId: BENCHMARK_ID,
        status: 'not-run',
        reasons: ['paid-provider-execution-not-authorized'],
      },
    })
  })

  test('blocks approved execution without reading provider configuration or private paths', () => {
    const accessed: string[] = []
    const environment: NodeJS.ProcessEnv = {
      DSH_EVOLVE_REAL_PROVIDER_APPROVED: PAID_PROVIDER_APPROVAL,
    }
    for (const name of privateConfigurationEnvironmentNames) {
      Object.defineProperty(environment, name, {
        enumerable: true,
        get() {
          accessed.push(name)
          throw new Error(`must not read ${name}`)
        },
      })
    }

    assert.deepEqual(resolveRealProviderAcceptance(environment), blockedResolution)
    assert.deepEqual(accessed, [])
  })

  test('runs the epoch-2 entry point keylessly as NOT_RUN', () => {
    const result = runEntryPoint({})

    assert.equal(result.status, 2)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'not-run',
      reasons: ['paid-provider-execution-not-authorized'],
    })
  })

  test('runs the approved epoch-2 entry point as blocked without provider configuration', () => {
    const result = runEntryPoint({
      DSH_EVOLVE_REAL_PROVIDER_APPROVED: PAID_PROVIDER_APPROVAL,
    })

    assert.equal(result.status, 1)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), blockedResolution.report)
  })

  test('publishes NOT_RUN through the root pnpm command without promising child exit 2', () => {
    const result = spawnSync('pnpm', ['--silent', 'benchmark:provider:rp1'], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })

    assert.equal(result.status, 1)
    assert.equal(result.stderr, '')
    assert.match(result.stdout, new RegExp(`${JSON.stringify(blockedResolution.report.benchmarkId)}[\\s\\S]*"status": "not-run"`, 'u'))
    assert.match(result.stdout, /paid-provider-execution-not-authorized/u)
    assert.match(result.stdout, /Command failed with exit code 2/u)
  })
})

const privateConfigurationEnvironmentNames = [
  'DSH_EVOLVE_MODEL_PROVIDER_ID',
  'DSH_EVOLVE_MODEL_BASE_URL',
  'DSH_EVOLVE_MODEL_NAME',
  'DSH_EVOLVE_MODEL_API_KEY',
  'DSH_EVOLVE_GOVERNANCE_MODEL_PROVIDER_ID',
  'DSH_EVOLVE_GOVERNANCE_MODEL_BASE_URL',
  'DSH_EVOLVE_GOVERNANCE_MODEL_NAME',
  'DSH_EVOLVE_GOVERNANCE_MODEL_API_KEY',
  'DSH_EVOLVE_DSH_SOURCE_DIR',
  'DSH_EVOLVE_REAL_PROVIDER_RUN_ROOT',
] as const

const blockedResolution = {
  status: 'failed',
  exitCode: 1,
  report: {
    schemaVersion: 1,
    benchmarkId: BENCHMARK_ID,
    status: 'failed',
    reasons: ['paid-provider-execution-blocked:runtime-attestation-incomplete'],
  },
} as const

type ManifestMutation = readonly [label: string, expected: string, replacement: string]

function assertManifestDriftRejected(mutations: readonly ManifestMutation[]): void {
  for (const [label, expected, replacement] of mutations) {
    const drifted = replaceExactlyOnce(manifestSource, expected, replacement, label)
    assert.throws(
      () => validateEpoch2ManifestSource(drifted),
      /epoch-2 manifest contract drift/u,
      `${label} drift must fail closed`,
    )
  }
}

function replaceExactlyOnce(source: string, expected: string, replacement: string, label: string): string {
  const first = source.indexOf(expected)
  assert.notEqual(first, -1, `${label} test fixture must exist`)
  assert.equal(source.indexOf(expected, first + expected.length), -1, `${label} test fixture must be unique`)
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`
}

function runEntryPoint(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', runner], {
    cwd: resolve(repositoryRoot, 'packages/dsh-evolve'),
    env: { PATH: process.env.PATH, ...environment },
    encoding: 'utf8',
  })
}
