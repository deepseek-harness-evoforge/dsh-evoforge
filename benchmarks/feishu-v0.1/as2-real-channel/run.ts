import { resolveRealFeishuAcceptance } from './contract.ts'

const resolved = resolveRealFeishuAcceptance(process.env)
if (resolved.status !== 'ready') {
  process.stdout.write(`${JSON.stringify(resolved.report, null, 2)}\n`)
  process.exitCode = resolved.exitCode
} else {
  try {
    const { executeRealFeishuAcceptance } = await import('./execute.ts')
    const report = await executeRealFeishuAcceptance(resolved.execution, resolved.report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = report.status === 'passed' ? 0 : 1
  } catch (error: unknown) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmarkId: resolved.report.benchmarkId,
      status: 'failed',
      chatKind: resolved.report.chatKind,
      appIdentityHash: resolved.report.appIdentityHash,
      routeIdentityHash: resolved.report.routeIdentityHash,
      reasons: [boundedError(error, [
        resolved.execution.appId,
        resolved.execution.appSecret,
        resolved.execution.conversationId,
        resolved.execution.userId,
      ])],
    }, null, 2)}\n`)
    process.exitCode = 1
  }
}

function boundedError(error: unknown, privateValues: readonly string[]): string {
  let value = error instanceof Error ? error.message : String(error)
  for (const privateValue of privateValues) value = value.replaceAll(privateValue, '[redacted]')
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown acceptance failure'
}
