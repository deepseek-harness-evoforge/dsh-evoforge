import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'

export const name = 'dsh-goal-continuity'
export const inject = ['agents', 'goals']

export interface Config {
  /** Exact persisted Session ids whose active Goals may continue after cold resume. */
  readonly autoResumeSessionIds?: string[]
}

export const Config: Schema<Config> = z.object({
  autoResumeSessionIds: z.array(z.string()).max(50).default([]),
})

/** Install the opt-in cold-resume policy. */
export function apply(ctx: Context, config: Config = {}): void {
  const authorized = resolveSessionIds(config.autoResumeSessionIds ?? [])
  if (authorized.size === 0) return

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (source !== 'resume' || !authorized.has(String(agent.id))) return
    const goal = ctx.goals.get(agent)
    if (goal === undefined
      || goal.phase !== 'active'
      || goal.activation !== 'disarmed'
      || goal.roundsStarted >= goal.maxGoalRounds) return
    try {
      ctx.goals.resume(agent, { id: goal.id, revision: goal.revision })
    } catch (error: unknown) {
      ctx.logger.warn(
        `dsh-goal-continuity: kept Session "${agent.id}" disarmed: ${renderError(error)}`,
      )
    }
  })
}

function resolveSessionIds(input: readonly string[]): ReadonlySet<string> {
  if (input.length > 50) {
    throw new Error('dsh-goal-continuity supports at most 50 auto-resume Session ids')
  }
  const result = new Set<string>()
  for (const id of input) {
    if (id.length === 0 || Buffer.byteLength(id) > 512) {
      throw new Error('dsh-goal-continuity Session ids must be non-empty and at most 512 bytes')
    }
    if (result.has(id)) {
      throw new Error('dsh-goal-continuity auto-resume Session ids must be unique')
    }
    result.add(id)
  }
  return result
}

function renderError(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '<unrenderable value>'
  }
}
