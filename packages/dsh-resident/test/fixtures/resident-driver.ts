/** Test-only process driver for exercising the internal OS adapter without publishing a product CLI. */
import { parseArgs } from 'node:util'
import {
  applyPlan,
  createLocation,
  createPlan,
  removeService,
  requireNativeManager,
  resolveManager,
  status,
} from '../../src/index.js'

async function main(argv: readonly string[]): Promise<void> {
  const [action, ...rest] = argv
  if (action !== 'plan' && action !== 'apply' && action !== 'status' && action !== 'remove') {
    throw new Error(`unknown test action ${JSON.stringify(action)}`)
  }
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      manager: { type: 'string' },
      profile: { type: 'string' },
      'dsh-entry': { type: 'string' },
      'node-bin': { type: 'string' },
      'dsh-home': { type: 'string' },
      cwd: { type: 'string' },
      'confirm-deployment': { type: 'boolean' },
    },
  })
  if ((action === 'apply' || action === 'remove') && values['confirm-deployment'] !== true) {
    throw new Error(`${action} requires --confirm-deployment`)
  }
  const manager = resolveManager(values.manager)
  const profile = required(values.profile, '--profile')
  const dshHome = required(values['dsh-home'], '--dsh-home')
  if (action === 'status' || action === 'remove') {
    const location = await createLocation({ manager, profile, dshHome })
    requireNativeManager(manager)
    const output = action === 'status' ? await status(location) : await removeService(location)
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }
  const plan = await createPlan({
    manager,
    profile,
    dshEntry: required(values['dsh-entry'], '--dsh-entry'),
    nodeBin: required(values['node-bin'], '--node-bin'),
    dshHome,
    cwd: required(values.cwd, '--cwd'),
  })
  const output = action === 'plan'
    ? plan
    : (requireNativeManager(manager), await applyPlan(plan))
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') throw new Error(`${flag} is required`)
  return value
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`dsh-resident: ${message}\n`)
  process.exitCode = 1
})
