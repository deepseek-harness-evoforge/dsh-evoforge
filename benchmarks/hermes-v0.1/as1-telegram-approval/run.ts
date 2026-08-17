import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { TelegramRuntime } from '../../../packages/dsh-telegram/src/runtime.ts'

const execFile = promisify(execFileCallback)
const benchmarkRoot = dirname(fileURLToPath(import.meta.url))
const suiteRoot = resolve(benchmarkRoot, '../../..')
const dshRoot = resolve(suiteRoot, '../deepseek-harness')
const hermesRoot = resolve(suiteRoot, '../hermes-agent')
const manifest = JSON.parse(await readFile(join(benchmarkRoot, 'manifest.json'), 'utf8'))
const expectedResult = JSON.parse(await readFile(join(benchmarkRoot, 'result.json'), 'utf8'))

await assertRevision(dshRoot, manifest.revisions.deepseekHarness)
await assertRevision(hermesRoot, manifest.revisions.hermesAgent)
const evoforge = await exerciseEvoforge()
const hermesProcess = await execFile('python3', [
  join(benchmarkRoot, 'hermes-telegram-approval.py'),
  hermesRoot,
], {
  cwd: hermesRoot,
  env: {
    ...process.env,
    HERMES_DISABLE_TELEMETRY: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  },
  timeout: 30_000,
})
const hermes = JSON.parse(hermesProcess.stdout.trim())

const result = {
  schemaVersion: 1,
  benchmarkId: manifest.id,
  revisions: manifest.revisions,
  comparable: true,
  scope: manifest.scope,
  outcome: {
    evoforge: {
      promptSent: evoforge.promptSent,
      callbackAnswers: evoforge.callbackAnswers,
      protectedActionResolutions: evoforge.resolutions,
      unauthorizedResolutions: evoforge.resolutionsAfterUnauthorized,
      replayResolutions: evoforge.resolutionsAfterReplay - evoforge.resolutionsAfterAuthorized,
      pendingAfterAuthorized: evoforge.pendingAfterAuthorized,
    },
    hermes: {
      promptSent: hermes.promptSent,
      protectedActionResolutions: hermes.resolverCallsAfterReplay,
      unauthorizedResolutions: hermes.resolverCallsAfterUnauthorized,
      replayResolutions: hermes.resolverCallsAfterReplay - hermes.resolverCallsAfterAuthorized,
      pendingAfterAuthorized: hermes.pendingAfterAuthorized,
      unauthorizedToast: hermes.unauthorizedToast,
      replayToast: hermes.replayToast,
    },
  },
  primaryMetric: {
    name: 'protected actions resolved by unauthorized or replayed callbacks',
    lowerIsBetter: true,
    evoforge: evoforge.resolutionsAfterUnauthorized
      + (evoforge.resolutionsAfterReplay - evoforge.resolutionsAfterAuthorized),
    hermes: hermes.resolverCallsAfterUnauthorized
      + (hermes.resolverCallsAfterReplay - hermes.resolverCallsAfterAuthorized),
  },
  hardGates: {
    evoforge: {
      promptTargetsExactChat: evoforge.promptSent && evoforge.promptChatId === 1001,
      allowOnceShapeBounded: evoforge.allowOnceCallbackShape,
      unauthorizedRejected: evoforge.resolutionsAfterUnauthorized === 0
        && evoforge.pendingAfterUnauthorized === 1,
      exactUserAllowedOnce: evoforge.resolutionsAfterAuthorized === 1
        && evoforge.outcome === 'allowed-once'
        && evoforge.pendingAfterAuthorized === 0,
      replayDidNotResolve: evoforge.resolutionsAfterReplay === 1,
    },
    hermes: {
      promptTargetsExactChat: hermes.promptSent && hermes.promptChatIdExact,
      allowOnceShapeBounded: hermes.allowOnceCallbackShape,
      unauthorizedRejected: hermes.resolverCallsAfterUnauthorized === 0
        && hermes.pendingAfterUnauthorized === 1,
      exactUserAllowedOnce: hermes.resolverCallsAfterAuthorized === 1
        && hermes.authorizedChoice === 'once'
        && hermes.pendingAfterAuthorized === 0,
      replayDidNotResolve: hermes.resolverCallsAfterReplay === 1,
    },
  },
  verdict: 'tie on deterministic Telegram allow-once identity and replay control; no real-Bot, latency, delivery, or global superiority claim',
}
assertResult(result)
if (JSON.stringify(result) !== JSON.stringify(expectedResult)) {
  throw new Error('paired result drifted from the frozen epoch; create a new epoch instead of rewriting evidence')
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

async function exerciseEvoforge(): Promise<any> {
  const sends: any[] = []
  const callbackAnswers: string[] = []
  const config = {
    routeId: 'telegram-main',
    sessionId: 'main',
    endpoint: {
      adapter: 'telegram',
      accountId: 'test-bot',
      conversationId: '1001',
      userId: '2002',
    },
    chatId: 1001,
    userId: 2002,
    tokenEnv: 'DSH_TELEGRAM_TEST_TOKEN',
    apiBase: 'http://127.0.0.1',
    pollTimeoutSeconds: 1,
    maxSendAttempts: 1,
    maxTextChars: 4_000,
  }
  const api = {
    async sendText(input: any) {
      sends.push(input)
      return { ok: true as const, messageId: '44' }
    },
    async answerCallback(id: string) {
      callbackAnswers.push(id)
      return true
    },
  }
  const runtime = new TelegramRuntime(
    {} as any,
    config,
    {} as any,
    api as any,
    {} as any,
  )
  let fallbackCalls = 0
  const approval = (runtime as any).requestApproval({
    toolName: 'deploy',
    reason: 'Protected production action.',
    signal: new AbortController().signal,
  }, () => {
    fallbackCalls += 1
    return Promise.resolve<ApprovalOutcome>('unavailable')
  }) as Promise<ApprovalOutcome>
  await waitFor(() => sends.length === 1)
  const callbackData = sends[0]?.replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data
  const nonce = /^dsh:a:([A-Za-z0-9_-]{1,32}):allow$/u.exec(callbackData)?.[1]
  if (nonce === undefined) throw new Error(`invalid EvoForge approval callback: ${callbackData}`)
  const resolutions: ApprovalOutcome[] = []
  void approval.then(outcome => { resolutions.push(outcome) })
  const unauthorized = telegramCallback(91, 'wrong-user', 9999, callbackData)
  const authorized = telegramCallback(92, 'authorized', 2002, callbackData)
  await (runtime as any).handleUpdate(unauthorized)
  await Promise.resolve()
  const resolutionsAfterUnauthorized = resolutions.length
  const pendingAfterUnauthorized = (runtime as any).pendingApprovals.size
  await (runtime as any).handleUpdate(authorized)
  const outcome = await approval
  await Promise.resolve()
  const resolutionsAfterAuthorized = resolutions.length
  const pendingAfterAuthorized = (runtime as any).pendingApprovals.size
  await (runtime as any).handleUpdate(authorized)
  await Promise.resolve()
  return {
    promptSent: sends.length === 1,
    promptChatId: sends[0]?.chatId,
    allowOnceCallbackShape: nonce.length >= 1 && nonce.length <= 32,
    callbackAnswers: callbackAnswers.length,
    resolutions: resolutions.length,
    resolutionsAfterUnauthorized,
    pendingAfterUnauthorized,
    resolutionsAfterAuthorized,
    pendingAfterAuthorized,
    resolutionsAfterReplay: resolutions.length,
    outcome,
    fallbackCalls,
  }
}

function telegramCallback(updateId: number, callbackId: string, userId: number, data: string): any {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: { id: userId, is_bot: false },
      message: { message_id: 44, chat: { id: 1001, type: 'private' } },
      data,
    },
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for approval prompt')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function assertResult(candidate: any): void {
  if (!Object.values(candidate.hardGates.evoforge).every(Boolean)) {
    throw new Error(`EvoForge hard gate failed: ${JSON.stringify(candidate.hardGates.evoforge)}`)
  }
  if (!Object.values(candidate.hardGates.hermes).every(Boolean)) {
    throw new Error(`Hermes hard gate failed: ${JSON.stringify(candidate.hardGates.hermes)}`)
  }
  if (candidate.primaryMetric.evoforge !== 0 || candidate.primaryMetric.hermes !== 0) {
    throw new Error(`approval replay control failed: ${JSON.stringify(candidate.primaryMetric)}`)
  }
}

async function assertRevision(repository: string, expected: string): Promise<void> {
  const actual = await git(repository, 'rev-parse', 'HEAD')
  if (actual !== expected) throw new Error(`${repository} is ${actual}, expected ${expected}`)
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', args, { cwd, timeout: 30_000 })
  return result.stdout.trim()
}
