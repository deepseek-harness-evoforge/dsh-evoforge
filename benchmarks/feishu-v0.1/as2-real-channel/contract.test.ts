import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertRealFeishuTerminalReport,
  hasExactNativeScheduleRoundTrip,
  REAL_FEISHU_APPROVAL,
  resolveRealFeishuAcceptance,
} from './contract.ts'

const appSecret = 'private-real-app-secret'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const runner = resolve(repositoryRoot, 'benchmarks/feishu-v0.1/as2-real-channel/run.ts')
const execution = resolve(repositoryRoot, 'benchmarks/feishu-v0.1/as2-real-channel/execute.ts')
const tsx = resolve(repositoryRoot, 'packages/dsh-feishu/node_modules/.bin/tsx')

describe('AS-2 real Feishu acceptance contract', () => {
  test('reads no Feishu identity or credential before explicit real-platform approval', () => {
    const reads: PropertyKey[] = []
    const environment = new Proxy<NodeJS.ProcessEnv>({
      DSH_FEISHU_REAL_CHANNEL_APPROVED: 'not-approved',
      DSH_FEISHU_APP_ID: 'cli_private_app',
      DSH_FEISHU_APP_SECRET: 'private-secret',
    }, {
      get(target, property, receiver) {
        reads.push(property)
        return Reflect.get(target, property, receiver)
      },
    })

    const resolved = resolveRealFeishuAcceptance(environment)

    assert.deepEqual(resolved, {
      status: 'not-run',
      exitCode: 2,
      report: {
        schemaVersion: 1,
        benchmarkId: 'as2-feishu-resident-pairing-epoch-4',
        status: 'not-run',
        reasons: ['real-feishu-effects-not-authorized'],
      },
    })
    assert.deepEqual(reads, ['DSH_FEISHU_REAL_CHANNEL_APPROVED'])
    assert.equal(REAL_FEISHU_APPROVAL, 'I_APPROVE_REAL_FEISHU_CHANNEL_EFFECTS')
  })

  test('requires credentials and isolated roots but discovers the route only after resident pairing', () => {
    const resolved = resolveRealFeishuAcceptance({
      DSH_FEISHU_REAL_CHANNEL_APPROVED: REAL_FEISHU_APPROVAL,
    })

    assert.equal(resolved.status, 'not-run')
    assert.equal(resolved.exitCode, 2)
    assert.deepEqual(resolved.report, {
      schemaVersion: 1,
      benchmarkId: 'as2-feishu-resident-pairing-epoch-4',
      status: 'not-run',
      reasons: [
        'missing:DSH_FEISHU_APP_ID',
        'missing:DSH_FEISHU_APP_SECRET',
        'missing:DSH_FEISHU_DSH_SOURCE_DIR',
        'missing:DSH_FEISHU_REAL_CHANNEL_RUN_ROOT',
      ],
    })
  })

  test('approves the Host pending request without reading a pairing code from stdin', () => {
    const source = readFileSync(execution, 'utf8')

    assert.match(source, /pendingPairings\(\)/u)
    assert.match(source, /approvePairingRequestForSession/u)
    assert.match(source, /healProfilesModuleFallback\(\{ installAnchor, profile, home: dshHome \}\)/u)
    assert.doesNotMatch(source, /healProfilesModuleFallback\(installAnchor\)/u)
    assert.doesNotMatch(source, /approvePairingForSession|createInterface|process\.stdin|Pairing code:/u)
  })

  test('rejects malformed App identity and overlapping run roots before dispatch', () => {
    const invalidIdentity = resolveRealFeishuAcceptance({ ...readyEnvironment(), DSH_FEISHU_APP_ID: 'not-an-app' })
    assert.equal(invalidIdentity.status, 'failed')
    assert.deepEqual(invalidIdentity.report.reasons, ['invalid:DSH_FEISHU_APP_ID'])

    const overlapping = resolveRealFeishuAcceptance({
      ...readyEnvironment(),
      DSH_FEISHU_REAL_CHANNEL_RUN_ROOT: '/private/tmp/deepseek-harness/as2',
    })
    assert.equal(overlapping.status, 'failed')
    assert.deepEqual(overlapping.report.reasons, ['invalid:acceptance-roots-overlap'])
  })

  test('returns private execution inputs and a secret-free App preflight without static route identity', () => {
    const resolved = resolveRealFeishuAcceptance(readyEnvironment())

    assert.equal(resolved.status, 'ready')
    if (resolved.status !== 'ready') throw new Error('expected ready Feishu acceptance')
    assert.equal(resolved.execution.appId, 'cli_real_app')
    assert.equal(resolved.execution.appSecret, appSecret)
    assert.equal(resolved.execution.interactionTimeoutMs, 300_000)
    assert.equal(resolved.report.status, 'ready')
    assert.match(resolved.report.appIdentityHash, /^[a-f0-9]{64}$/u)
    assert.equal(resolved.report.chatKind, 'direct')
    assert.equal('routeIdentityHash' in resolved.report, false)
    const publicReport = JSON.stringify(resolved.report)
    assert.doesNotMatch(publicReport, /cli_real_app/u)
    assert.doesNotMatch(publicReport, new RegExp(appSecret, 'u'))
  })

  test('rejects a non-canonical or excessive human interaction timeout', () => {
    for (const timeout of ['060000', '59999', '900001']) {
      const resolved = resolveRealFeishuAcceptance({
        ...readyEnvironment(),
        DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS: timeout,
      })
      assert.equal(resolved.status, 'failed')
      assert.deepEqual(resolved.report.reasons, ['invalid:DSH_FEISHU_REAL_CHANNEL_TIMEOUT_MS'])
    }
  })

  test('recognizes exactly one official Schedule create, dispatch, and plugin-sourced user message', () => {
    const official = [
      { type: 'schedule/change', data: { operation: 'create' } },
      { type: 'schedule/change', data: { operation: 'dispatch' } },
      { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'schedule' } } },
    ]
    assert.equal(hasExactNativeScheduleRoundTrip(official), true)
    assert.equal(hasExactNativeScheduleRoundTrip([
      ...official.slice(0, 2),
      { type: 'plugin:schedule', data: {} },
    ]), false)
    assert.equal(hasExactNativeScheduleRoundTrip([...official, official[2]!]), false)
  })

  test('rejects a retained terminal report that omits the native Schedule round trip gate', () => {
    const resolved = resolveRealFeishuAcceptance(readyEnvironment())
    assert.equal(resolved.status, 'ready')
    if (resolved.status !== 'ready') throw new Error('expected ready Feishu acceptance')
    const identity = {
      manifestHash: 'a'.repeat(64),
      evoforgeRevision: 'b'.repeat(40),
      dshRevision: 'c'.repeat(40),
      preflight: resolved.report,
    }
    const observations = {
      finalTarballsInstalled: true,
      profileDumped: true,
      officialTransportReady: true,
      exactInboundChallenge: true,
      replyDelivered: true,
      commandRoundTrip: true,
      approvalAllowedOnce: true,
      noticeDelivered: true,
      residentPairingGranted: true,
      postRestartRoundTrip: true,
      sessionRecoveredAfterRemoval: true,
      nativeHostBootedAfterRemoval: true,
    }

    assert.throws(() => assertRealFeishuTerminalReport({
      schemaVersion: 1,
      benchmarkId: 'as2-feishu-resident-pairing-epoch-4',
      status: 'passed',
      scope: 'real route including native Schedule',
      manifestHash: identity.manifestHash,
      revisions: {
        evoforge: identity.evoforgeRevision,
        deepseekHarness: identity.dshRevision,
      },
      chatKind: resolved.report.chatKind,
      appIdentityHash: resolved.report.appIdentityHash,
      routeIdentityHash: 'd'.repeat(64),
      stage: 'complete',
      observations,
      reasons: [],
    }, identity), /observations/u)

    assert.doesNotThrow(() => assertRealFeishuTerminalReport({
      schemaVersion: 1,
      benchmarkId: 'as2-feishu-resident-pairing-epoch-4',
      status: 'passed',
      scope: 'real route including native Schedule',
      manifestHash: identity.manifestHash,
      revisions: {
        evoforge: identity.evoforgeRevision,
        deepseekHarness: identity.dshRevision,
      },
      chatKind: resolved.report.chatKind,
      appIdentityHash: resolved.report.appIdentityHash,
      routeIdentityHash: 'd'.repeat(64),
      stage: 'complete',
      observations: { ...observations, nativeScheduleRoundTrip: true },
      reasons: [],
    }, identity))
  })

  test('exits 2 with one JSON not-run report before any real platform effect', () => {
    const result = spawnSync(tsx, [runner], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })

    assert.equal(result.status, 2)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      benchmarkId: 'as2-feishu-resident-pairing-epoch-4',
      status: 'not-run',
      reasons: ['real-feishu-effects-not-authorized'],
    })
  })

  test('redacts every exact Feishu identity and secret from a pre-dispatch runner failure', () => {
    const result = spawnSync(tsx, [runner], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH, ...readyEnvironment() },
      encoding: 'utf8',
    })

    assert.equal(result.status, 1)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout) as { status?: unknown }
    assert.equal(report.status, 'failed')
    for (const privateValue of ['cli_real_app', appSecret]) {
      assert.doesNotMatch(result.stdout, new RegExp(privateValue, 'u'))
    }
  })
})

function readyEnvironment(): NodeJS.ProcessEnv {
  return {
    DSH_FEISHU_REAL_CHANNEL_APPROVED: REAL_FEISHU_APPROVAL,
    DSH_FEISHU_APP_ID: 'cli_real_app',
    DSH_FEISHU_APP_SECRET: appSecret,
    DSH_FEISHU_DSH_SOURCE_DIR: '/private/tmp/deepseek-harness',
    DSH_FEISHU_REAL_CHANNEL_RUN_ROOT: '/private/tmp/evoforge-as2',
  }
}
