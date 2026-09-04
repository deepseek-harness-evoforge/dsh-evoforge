import { resolveRealTelegramAcceptance } from './contract.ts'

const resolved = resolveRealTelegramAcceptance(process.env)
if (resolved.status !== 'ready') {
  process.stdout.write(`${JSON.stringify(resolved.report, null, 2)}\n`)
  process.exitCode = resolved.exitCode
} else {
  try {
    const { executeRealTelegramAcceptance } = await import('./execute.ts')
    const report = await executeRealTelegramAcceptance(resolved.execution, resolved.report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = report.status === 'passed' ? 0 : 1
  } catch (error: unknown) {
    let message = error instanceof Error ? error.message : String(error)
    message = message.replaceAll(resolved.execution.botToken, '[redacted]')
      .replaceAll(resolved.execution.accountId, '[redacted]')
      .replace(/[\r\n]+/gu, ' ').slice(0, 512)
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmarkId: resolved.report.benchmarkId,
      status: 'failed',
      chatKind: resolved.report.chatKind,
      accountIdentityHash: resolved.report.accountIdentityHash,
      reasons: [message || 'unknown acceptance failure'],
    }, null, 2)}\n`)
    process.exitCode = 1
  }
}
