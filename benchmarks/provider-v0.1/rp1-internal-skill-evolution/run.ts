import { executeRealProviderAcceptance } from './execute.ts'
import { resolveRealProviderAcceptance } from './contract.ts'

const resolved = resolveRealProviderAcceptance(process.env)
if (resolved.status !== 'ready') {
  process.stdout.write(`${JSON.stringify(resolved.report, null, 2)}\n`)
  process.exitCode = resolved.exitCode
} else {
  try {
    const report = await executeRealProviderAcceptance(resolved.execution, resolved.report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = report.status === 'passed' ? 0 : 1
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      benchmarkId: resolved.report.benchmarkId,
      status: 'failed',
      reasons: [boundedError(error, [
        resolved.execution.proposer.apiKey,
        resolved.execution.proposer.baseUrl,
        resolved.execution.governance.apiKey,
        resolved.execution.governance.baseUrl,
      ])],
      proposer: resolved.report.proposer,
      governance: resolved.report.governance,
    }, null, 2)}\n`)
    process.exitCode = 1
  }
}

function boundedError(error: unknown, privateValues: readonly string[]): string {
  let value = error instanceof Error ? error.message : String(error)
  for (const privateValue of privateValues) value = value.replaceAll(privateValue, '[redacted]')
  return value.replace(/[\r\n]+/gu, ' ').slice(0, 512) || 'unknown acceptance failure'
}
