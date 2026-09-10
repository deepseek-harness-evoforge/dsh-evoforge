import { resolveRealProviderAcceptance } from './contract-interaction-current-epoch-2.ts'

const resolved = resolveRealProviderAcceptance(process.env)
process.stdout.write(`${JSON.stringify(resolved.report, null, 2)}\n`)
process.exitCode = resolved.exitCode
