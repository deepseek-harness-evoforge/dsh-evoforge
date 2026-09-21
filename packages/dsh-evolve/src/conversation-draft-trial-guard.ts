import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import * as NativeSkillTool from '@deepseek-ai/dsh-tool-skill'
import { FILE_TRIAL_MAX_CALLS, FILE_TRIAL_MAX_TOKENS, FILE_TRIAL_TOOL_NAMES, type prepareConversationFileTrial } from './conversation-file-trial.ts'

interface TrialRequestBounds {
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  readonly maxCalls: number
  /** Must durably commit a dispatch marker; rejection prevents provider entry. */
  readonly beforeDispatch: (call: number, signal: AbortSignal) => Promise<void>
  readonly fileTrial?: Awaited<ReturnType<typeof prepareConversationFileTrial>>
}

/**
 * Private setup-time guard for a fresh, owned native evaluation Agent. This is
 * not an evaluator or a budget ledger: the caller reserves the complete plan
 * before creation and supplies its durable per-call marker. No retry is safe
 * without a new marker, including the native loop's within-step retry path.
 */
export async function installConversationDraftTrialGuard(
  scoped: Context,
  agent: Agent,
  bounds: TrialRequestBounds,
): Promise<void> {
  bounds = Object.freeze({ ...bounds })
  if (!bounds.provider || !bounds.model
    || !Number.isSafeInteger(bounds.maxCalls) || bounds.maxCalls < 1 || bounds.maxCalls > (bounds.fileTrial ? FILE_TRIAL_MAX_CALLS : 3)
    || !Number.isSafeInteger(bounds.maxTokens) || bounds.maxTokens < 1 || bounds.maxTokens > (bounds.fileTrial ? FILE_TRIAL_MAX_TOKENS : 2000)) {
    throw new Error('invalid conversation trial request bounds')
  }
  scoped.tools.presentAs('native')
  if (bounds.fileTrial !== undefined) await bounds.fileTrial.install(scoped, agent)
  // A programmatic Agent does not inherit a user-facing preset. Supply the
  // official reader if absent; do not double-mount an existing catalog owner.
  if (scoped.tools.get('skill', agent) === undefined) await scoped.plugin(NativeSkillTool)
  // Restrictions name global tools only; scoped registrations survive this mask.
  const allowed = bounds.fileTrial === undefined ? ['skill'] : [...FILE_TRIAL_TOOL_NAMES]
  scoped.tools.restrict({ allow: allowed.filter(name => scoped.tools.get(name) !== undefined) })
  const definitions = new Map(allowed.map(name => [name, scoped.tools.get(name, agent)]))
  const schemas = JSON.stringify(scoped.tools.schemas(agent))
  const verifyTools = (): void => {
    const visible = scoped.tools.schemas(agent)
    const required = bounds.fileTrial === undefined ? ['skill'] : ['skill', 'read', 'write', 'edit', 'present']
    if (required.some(name => definitions.get(name) === undefined)
      || [...definitions].some(([name, definition]) => scoped.tools.get(name, agent) !== definition)
      || visible.some(tool => !allowed.includes(tool.name)) || JSON.stringify(visible) !== schemas) {
      throw new Error('conversation trial tool composition changed')
    }
  }
  verifyTools()
  let calls = 0
  let failed = false
  scoped.on('agent/request-error', async ({ agent: current }, next) => {
    if (current !== agent) return next()
    failed = true
    return undefined
  }, { prepend: true })
  scoped.on('tools/execute', async (exec, next) => {
    if (exec.agent !== agent) return next()
    verifyTools()
    if (bounds.fileTrial !== undefined) await bounds.fileTrial.checkTool(exec)
    else if (exec.name !== 'skill') throw new Error('conversation trial permits only skill loading')
    return next()
  }, { prepend: true })
  scoped.on('agent/request', async ({ agent: current, turn, signal }, next) => {
    if (current !== agent) return next()
    if (failed || turn !== 1 || calls >= bounds.maxCalls || signal.aborted) {
      throw new Error('conversation trial request limit reached')
    }
    const config = await next()
    verifyTools()
    if (config.provider !== bounds.provider || config.model !== bounds.model || config.maxTokens !== bounds.maxTokens) {
      failed = true
      throw new Error('conversation trial model route or output limit changed')
    }
    // Consume locally before awaiting so even a rejected/ambiguous write cannot
    // be reused in this process. Recovery belongs to the durable caller.
    calls++
    try {
      await bounds.beforeDispatch(calls, signal)
      signal.throwIfAborted()
      verifyTools()
      return config
    } catch (error) {
      failed = true
      throw error
    }
  }, { prepend: true })
}
