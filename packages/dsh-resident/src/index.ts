import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  applyPlan,
  createLocation,
  createPlan,
  removeService,
  requireNativeManager,
  resolveManager,
  status,
  type Manager,
  type Plan,
} from './os-service.js'

export const name = 'dsh-resident'
export const inject = ['commands']

const USAGE = 'Usage: /resident plan | status | apply <plan-sha256> | remove <service-id>'

export interface Config {
  /** OS manager for the exact target; auto resolves only to the current native manager. */
  readonly manager?: 'auto' | Manager
  /** Exact DSH profile that the OS service will boot. */
  readonly profile: string
  /** Exact DSH home owned by the target profile. */
  readonly dshHome: string
  /** Exact workspace used as the target process working directory. */
  readonly cwd: string
  /** Exact JavaScript entry for the installed DSH CLI. */
  readonly dshEntry: string
  /** Exact Node executable used to boot DSH. */
  readonly nodeBin: string
  /** Disable the target Web profile's default browser handoff. */
  readonly noOpen?: boolean
}

export const Config: Schema<Config> = z.object({
  manager: z.union(['auto', 'launchd', 'systemd'] as const).default('auto'),
  profile: z.string().required(),
  dshHome: z.string().required(),
  cwd: z.string().required(),
  dshEntry: z.string().required(),
  nodeBin: z.string().required(),
  noOpen: z.boolean().default(false),
})

interface ResolvedConfig {
  readonly manager: Manager
  readonly profile: string
  readonly dshHome: string
  readonly cwd: string
  readonly dshEntry: string
  readonly nodeBin: string
  readonly noOpen: boolean
}

/** Register the DSH-owned human control surface; this package publishes no executable. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.commands.register({
    name: 'resident',
    description: 'inspect or explicitly deploy one exact DSH profile as an OS user service',
    input: { hint: 'plan | status | apply <plan-sha256> | remove <service-id>' },
    handler: invocation => executeResidentCommand(resolved, invocation),
  })
}

/** Content address reviewed by the operator before one exact apply action. */
export function planFingerprint(plan: Plan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

async function executeResidentCommand(
  config: ResolvedConfig,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const words = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
  const [action, confirmation, ...extra] = words
  if (action === undefined || extra.length > 0) return commandError(USAGE)
  try {
    if (action === 'plan') {
      if (confirmation !== undefined) return commandError(USAGE)
      const plan = await configuredPlan(config)
      const fingerprint = planFingerprint(plan)
      return commandSuccess(plan, `To apply this exact plan: /resident apply ${fingerprint}`)
    }
    const location = await createLocation(config)
    if (action === 'status') {
      if (confirmation !== undefined) return commandError(USAGE)
      requireNativeManager(config.manager)
      return commandSuccess(await status(location))
    }
    if (action === 'apply') {
      const plan = await configuredPlan(config)
      const fingerprint = planFingerprint(plan)
      if (confirmation !== fingerprint) {
        return commandError(`Apply refused: review /resident plan, then confirm its exact SHA-256.\n${USAGE}`)
      }
      requireNativeManager(config.manager)
      throwIfAborted(invocation.signal)
      return commandSuccess(await applyPlan(plan))
    }
    if (action === 'remove') {
      if (confirmation !== location.serviceId) {
        return commandError(`Remove refused: confirm the exact service id ${location.serviceId}.\n${USAGE}`)
      }
      requireNativeManager(config.manager)
      throwIfAborted(invocation.signal)
      return commandSuccess(await removeService(location))
    }
    return commandError(USAGE)
  } catch (error: unknown) {
    return commandError(`dsh-resident: ${renderError(error)}`)
  }
}

async function configuredPlan(config: ResolvedConfig): Promise<Plan> {
  return createPlan(config)
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    manager: resolveManager(config.manager === undefined || config.manager === 'auto'
      ? undefined
      : config.manager),
    profile: config.profile,
    dshHome: config.dshHome,
    cwd: config.cwd,
    dshEntry: config.dshEntry,
    nodeBin: config.nodeBin,
    noOpen: config.noOpen === true,
  }
}

function commandSuccess(value: unknown, suffix?: string): CommandResult {
  const rendered = JSON.stringify(value, null, 2)
  return { kind: 'success', text: suffix === undefined ? rendered : `${rendered}\n\n${suffix}` }
}

function commandError(text: string): CommandResult {
  return { kind: 'error', text }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('resident command aborted')
}

function renderError(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '<unrenderable value>'
  }
}

export {
  applyPlan,
  createLocation,
  createPlan,
  removeService,
  requireNativeManager,
  resolveManager,
  status,
  type Manager,
  type Plan,
  type ServiceLocation,
} from './os-service.js'
