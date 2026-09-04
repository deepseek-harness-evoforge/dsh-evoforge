import { resolveRealTelegramAcceptance } from './contract.ts'

const resolved = resolveRealTelegramAcceptance(process.env)
if (resolved.status !== 'ready') {
  process.stdout.write(`${JSON.stringify(resolved.report, null, 2)}\n`)
  process.exitCode = resolved.exitCode
} else {
  // The external Bot run is intentionally not auto-started by a preflight-only
  // command. This keeps an accidentally exported token from causing effects;
  // the real runner will be admitted only when its human challenge executor is
  // present and the release gate explicitly authorizes it.
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmarkId: resolved.report.benchmarkId,
    status: 'not-run',
    reasons: ['real-telegram-executor-requires-explicit-human-runner'],
  }, null, 2)}\n`)
  process.exitCode = 2
}
