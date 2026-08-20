import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { durableSkillInvocations } from './durable-skill-invocation.ts'
import { sessionIdentityOf } from './generation-binder.ts'
import type { InstalledSkillBaselineVault } from './installed-skill-baseline.ts'

export interface InstalledSkillBaselineMonitor {
  readonly flush: () => Promise<void>
  readonly dispose: () => Promise<void>
}

/** Observe the native Agent log; never adds a prompt, Tool, route or workflow. */
export function installInstalledSkillBaselineMonitor(
  ctx: Context,
  vault: InstalledSkillBaselineVault,
): InstalledSkillBaselineMonitor {
  let disposed = false
  const seen = new WeakMap<Agent, Set<string>>()
  const tails = new WeakMap<Agent, Promise<void>>()
  const pending = new Set<Promise<void>>()

  const removePreStep = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (!disposed) {
      const prior = tails.get(agent) ?? Promise.resolve()
      const task = prior
        .then(() => observeAgent(ctx, vault, agent, signal, seen))
        .catch((error) => {
          ctx.logger.warn(`dsh-evolve skipped installed Skill baseline observation: ${errorMessage(error)}`)
        })
      tails.set(agent, task)
      pending.add(task)
      void task.finally(() => pending.delete(task)).catch(() => undefined)
      await task
    }
    return next()
  })
  const removeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    seen.delete(agent)
    tails.delete(agent)
  })

  return {
    async flush() {
      while (pending.size > 0) await Promise.all([...pending])
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        removePreStep()
        removeDisposed()
      }
      while (pending.size > 0) await Promise.all([...pending])
    },
  }
}

async function observeAgent(
  ctx: Context,
  vault: InstalledSkillBaselineVault,
  agent: Agent,
  signal: AbortSignal,
  seenByAgent: WeakMap<Agent, Set<string>>,
): Promise<void> {
  let agentSeen = seenByAgent.get(agent)
  if (agentSeen === undefined) {
    agentSeen = new Set<string>()
    seenByAgent.set(agent, agentSeen)
  }
  const identity = await sessionIdentityOf(ctx, agent)
  for (const invocation of durableSkillInvocations(agent.session.events)) {
    const key = invocationKey(invocation)
    if (agentSeen.has(key)) continue
    agentSeen.add(key)
    try {
      const result = await vault.capture({
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        invocationSeq: invocation.seq,
        route: invocation.route,
        skillName: invocation.skillName,
        invocationContent: invocation.content,
        ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
        scope: agent,
        signal,
      })
      if (result.status === 'abstained'
        && !['policy-unavailable', 'provider-not-sealable', 'flat-skill-no-package-boundary']
          .includes(result.reason)) {
        ctx.logger.warn(
          `dsh-evolve abstained from sealing installed Skill '${invocation.skillName}': ${result.reason}`,
        )
      }
    } catch (error) {
      agentSeen.delete(key)
      ctx.logger.warn(
        `dsh-evolve could not seal installed Skill '${invocation.skillName}': ${errorMessage(error)}`,
      )
    }
  }
}

function invocationKey(invocation: ReturnType<typeof durableSkillInvocations>[number]): string {
  return createHash('sha256').update(JSON.stringify([
    invocation.seq,
    invocation.route,
    invocation.skillName,
    invocation.content,
  ])).digest('hex')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
