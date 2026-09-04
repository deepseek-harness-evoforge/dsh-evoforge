import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertRealTelegramTerminalReport,
  BENCHMARK_ID,
  emptyTelegramObservations,
  REAL_TELEGRAM_APPROVAL,
  resolveRealTelegramAcceptance,
} from './contract.ts'

const botToken = '123456789:abcdefghijklmnopqrstuvwxyzABCDE'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const runner = resolve(repositoryRoot, 'benchmarks/telegram-v0.1/as1-real-channel/run.ts')
const tsx = resolve(repositoryRoot, 'packages/dsh-telegram/node_modules/.bin/tsx')

describe('AS-1 real Telegram acceptance contract', () => {
  test('reads no Bot token or identity before explicit real-platform approval', () => {
    const reads: PropertyKey[] = []
    const environment = new Proxy<NodeJS.ProcessEnv>({
      DSH_TELEGRAM_REAL_CHANNEL_APPROVED: 'not-approved',
      DSH_TELEGRAM_BOT_TOKEN: botToken,
      DSH_TELEGRAM_ACCOUNT_ID: 'personal-bot',
    }, {
      get(target, property, receiver) {
        reads.push(property)
        return Reflect.get(target, property, receiver)
      },
    })

    const resolved = resolveRealTelegramAcceptance(environment)

    assert.deepEqual(resolved, {
      status: 'not-run',
      exitCode: 2,
      report: {
        schemaVersion: 1,
        benchmarkId: 'as1-telegram-resident-pairing-epoch-1',
        status: 'not-run',
        reasons: ['real-telegram-effects-not-authorized'],
      },
    })
    assert.deepEqual(reads, ['DSH_TELEGRAM_REAL_CHANNEL_APPROVED'])
    assert.equal(REAL_TELEGRAM_APPROVAL, 'I_APPROVE_REAL_TELEGRAM_CHANNEL_EFFECTS')
  })

  test('requires token, account, source and isolated run root after authorization', () => {
    const resolved = resolveRealTelegramAcceptance({
      DSH_TELEGRAM_REAL_CHANNEL_APPROVED: REAL_TELEGRAM_APPROVAL,
    })
    assert.equal(resolved.status, 'not-run')
    assert.equal(resolved.exitCode, 2)
    assert.deepEqual(resolved.report.reasons, [
      'missing:DSH_TELEGRAM_BOT_TOKEN',
      'missing:DSH_TELEGRAM_ACCOUNT_ID',
      'missing:DSH_TELEGRAM_DSH_SOURCE_DIR',
      'missing:DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT',
    ])
  })

  test('rejects malformed token, non-official API and overlapping roots before any run', () => {
    const malformed = resolveRealTelegramAcceptance({ ...readyEnvironment(), DSH_TELEGRAM_BOT_TOKEN: 'bad' })
    assert.equal(malformed.status, 'failed')
    assert.deepEqual(malformed.report.reasons, ['invalid:DSH_TELEGRAM_BOT_TOKEN'])

    const nonOfficial = resolveRealTelegramAcceptance({
      ...readyEnvironment(),
      DSH_TELEGRAM_BOT_API_BASE: 'http://127.0.0.1:9999',
    })
    assert.equal(nonOfficial.status, 'failed')
    assert.deepEqual(nonOfficial.report.reasons, ['invalid:DSH_TELEGRAM_BOT_API_BASE'])

    const overlapping = resolveRealTelegramAcceptance({
      ...readyEnvironment(),
      DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT: '/private/tmp/deepseek-harness/as1',
    })
    assert.equal(overlapping.status, 'failed')
    assert.deepEqual(overlapping.report.reasons, ['invalid:acceptance-roots-overlap'])
  })

  test('returns a secret-free ready report and keeps the token private', () => {
    const resolved = resolveRealTelegramAcceptance(readyEnvironment())
    assert.equal(resolved.status, 'ready')
    if (resolved.status !== 'ready') throw new Error('expected ready Telegram acceptance')
    assert.equal(resolved.execution.botToken, botToken)
    assert.equal(resolved.execution.accountId, 'personal-bot')
    assert.equal(resolved.execution.apiBase, 'https://api.telegram.org')
    assert.match(resolved.report.accountIdentityHash, /^[a-f0-9]{64}$/u)
    const publicReport = JSON.stringify(resolved.report)
    assert.doesNotMatch(publicReport, new RegExp(botToken, 'u'))
    assert.doesNotMatch(publicReport, /personal-bot/u)
  })

  test('requires canonical bounded human interaction timeout', () => {
    for (const timeout of ['060000', '59999', '900001']) {
      const resolved = resolveRealTelegramAcceptance({
        ...readyEnvironment(),
        DSH_TELEGRAM_REAL_CHANNEL_TIMEOUT_MS: timeout,
      })
      assert.equal(resolved.status, 'failed')
      assert.deepEqual(resolved.report.reasons, ['invalid:DSH_TELEGRAM_REAL_CHANNEL_TIMEOUT_MS'])
    }
  })

  test('requires every terminal observation and exact identity for retained reports', () => {
    const resolved = resolveRealTelegramAcceptance(readyEnvironment())
    assert.equal(resolved.status, 'ready')
    if (resolved.status !== 'ready') throw new Error('expected ready Telegram acceptance')
    const identity = {
      manifestHash: 'a'.repeat(64),
      evoforgeRevision: 'b'.repeat(40),
      dshRevision: 'c'.repeat(40),
      auditedLatestDshRevision: 'd'.repeat(40),
      preflight: resolved.report,
    }
    const incomplete = emptyTelegramObservations()
    incomplete.finalTarballsInstalled = true
    assert.throws(() => assertRealTelegramTerminalReport({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'passed',
      scope: 'real Telegram route',
      manifestHash: identity.manifestHash,
      revisions: {
        evoforge: identity.evoforgeRevision,
        deepseekHarness: identity.dshRevision,
        auditedLatestDeepseekHarness: identity.auditedLatestDshRevision,
      },
      chatKind: 'direct',
      accountIdentityHash: resolved.report.accountIdentityHash,
      routeIdentityHash: 'e'.repeat(64),
      stage: 'complete',
      observations: incomplete,
      reasons: [],
    }, identity), /verdict/u)

    const complete = Object.fromEntries(Object.keys(incomplete).map(key => [key, true]))
    assert.doesNotThrow(() => assertRealTelegramTerminalReport({
      schemaVersion: 1,
      benchmarkId: BENCHMARK_ID,
      status: 'passed',
      scope: 'real Telegram route',
      manifestHash: identity.manifestHash,
      revisions: {
        evoforge: identity.evoforgeRevision,
        deepseekHarness: identity.dshRevision,
        auditedLatestDeepseekHarness: identity.auditedLatestDshRevision,
      },
      chatKind: 'direct',
      accountIdentityHash: resolved.report.accountIdentityHash,
      routeIdentityHash: 'e'.repeat(64),
      stage: 'complete',
      observations: complete,
      reasons: [],
    }, identity))
  })

  test('exits 2 with one JSON report before any Bot API effect', () => {
    const result = spawnSync(tsx, [runner], {
      cwd: repositoryRoot,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.equal(result.stderr, '')
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      benchmarkId: 'as1-telegram-resident-pairing-epoch-1',
      status: 'not-run',
      reasons: ['real-telegram-effects-not-authorized'],
    })
  })

  test('fails before any Bot API effect when the authorized runner source is not a Git checkout', () => {
    const result = spawnSync(tsx, [runner], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH,
        ...readyEnvironment(),
        DSH_TELEGRAM_DSH_SOURCE_DIR: '/private/tmp/not-a-git-checkout',
      },
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout) as { status?: unknown; reasons?: readonly string[] }
    assert.equal(report.status, 'failed')
    assert.equal(report.reasons?.length, 1)
    assert.doesNotMatch(result.stdout, new RegExp(botToken, 'u'))
  })
})

function readyEnvironment(): NodeJS.ProcessEnv {
  return {
    DSH_TELEGRAM_REAL_CHANNEL_APPROVED: REAL_TELEGRAM_APPROVAL,
    DSH_TELEGRAM_BOT_TOKEN: botToken,
    DSH_TELEGRAM_ACCOUNT_ID: 'personal-bot',
    DSH_TELEGRAM_DSH_SOURCE_DIR: '/private/tmp/deepseek-harness',
    DSH_TELEGRAM_REAL_CHANNEL_RUN_ROOT: '/private/tmp/evoforge-as1',
  }
}
