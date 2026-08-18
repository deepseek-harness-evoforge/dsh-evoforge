import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {
  EvolutionCapabilityMapView,
  EvolutionCapabilityRoute,
  EvolutionCapabilityView,
} from './control-types.ts'
import { sessionIdentityOf } from './generation-binder.ts'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'

export interface CapabilityObservation {
  readonly workspaceId: string
  readonly sessionId: string
  readonly snapshot: SkillCatalogSnapshot
  readonly generation?: CapabilityGeneration
}

export interface CapabilityMapMonitor {
  flush(): Promise<void>
  dispose(): Promise<void>
}

/** Process-local projection of the native DSH Skill catalog for exact Sessions. */
export class CapabilityMap {
  private readonly sessions = new Map<string, EvolutionCapabilityMapView>()

  observe(observation: CapabilityObservation): void {
    if (observation.generation !== undefined
      && observation.generation.workspaceId !== observation.workspaceId) {
      throw new Error('Capability Generation does not belong to the observed Workspace')
    }
    const previousRoutes = new Map(
      (this.sessions.get(sessionKey(observation.workspaceId, observation.sessionId))?.capabilities ?? [])
        .map(capability => [capability.name, capability.route]),
    )
    const artifacts = new Map(
      (observation.generation?.artifacts ?? []).map(artifact => [artifact.name, artifact]),
    )
    const capabilities: EvolutionCapabilityView[] = observation.snapshot.skills
      .map((skill) => {
        const artifact = artifacts.get(skill.name)
        return {
          name: skill.name,
          description: skill.description,
          source: skill.source,
          provider: skill.provider,
          scope: 'workspace-session' as const,
          invocation: {
            model: skill.invocation.modelInvocable,
            user: skill.invocation.userInvocable,
          },
          versionKind: artifact === undefined ? 'provider-managed' as const : 'evolved-tree' as const,
          ...(artifact === undefined ? {} : {
            version: artifact.treeHash,
            generationId: observation.generation!.id,
          }),
          route: previousRoutes.get(skill.name) ?? 'available',
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
    this.sessions.set(sessionKey(observation.workspaceId, observation.sessionId), {
      status: observation.snapshot.complete ? 'complete' : 'incomplete',
      catalogHash: hashCatalog(capabilities),
      capabilities,
    })
  }

  recordRoute(
    workspaceId: string,
    sessionId: string,
    skillName: string,
    route: Exclude<EvolutionCapabilityRoute, 'available'>,
  ): void {
    const key = sessionKey(workspaceId, sessionId)
    const current = this.sessions.get(key)
    if (current === undefined || !current.capabilities.some(capability => capability.name === skillName)) return
    this.sessions.set(key, {
      ...current,
      capabilities: current.capabilities.map(capability => capability.name === skillName
        ? { ...capability, route }
        : capability),
    })
  }

  remove(workspaceId: string, sessionId: string): void {
    this.sessions.delete(sessionKey(workspaceId, sessionId))
  }

  snapshot(workspaceId: string, sessionId?: string): EvolutionCapabilityMapView {
    if (sessionId === undefined) return { status: 'unobserved', capabilities: [] }
    const current = this.sessions.get(sessionKey(workspaceId, sessionId))
    if (current === undefined) return { status: 'unobserved', capabilities: [] }
    return {
      ...current,
      capabilities: current.capabilities.map(capability => ({
        ...capability,
        invocation: { ...capability.invocation },
      })),
    }
  }
}

/**
 * Observe DSH's native Skill seam without adding a Tool, prompt, or route menu.
 * Catalog observation is load-bearing only for this projection: failures are
 * contained and the Agent continues through the normal DSH pre-step chain.
 */
export function installCapabilityMapObserver(
  ctx: Context,
  capabilities: CapabilityMap,
  evolution: Pick<EvolutionStore, 'getSessionGeneration'>,
): CapabilityMapMonitor {
  let disposed = false
  let tail: Promise<void> = Promise.resolve()

  const removePreStep = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (!disposed) {
      try {
        if (ctx.get('skills') === undefined) throw new Error('DSH Skill Registry is not loaded')
        const identity = await sessionIdentityOf(ctx, agent)
        const snapshot = await ctx.skills.snapshot({
          cwd: agent.session.header.cwd,
          signal,
          scope: agent,
        })
        const generation = evolution.getSessionGeneration(identity)
        capabilities.observe({
          workspaceId: identity.workspaceId,
          sessionId: identity.sessionId,
          snapshot,
          ...(generation === undefined ? {} : { generation }),
        })
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one Capability Map observation: ${errorMessage(error)}`)
      }
    }
    return next()
  })

  const removeToolResult = ctx.on('tools/result', (execution, result) => {
    if (disposed || execution.name !== 'skill' || execution.agent === undefined || result.isError) return
    const skillName = successfulSkillName(result)
    if (skillName === undefined) return
    tail = tail.then(async () => {
      try {
        const identity = await sessionIdentityOf(ctx, execution.agent!)
        capabilities.recordRoute(identity.workspaceId, identity.sessionId, skillName, 'model-selected')
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one Capability route observation: ${errorMessage(error)}`)
      }
    })
  })

  const removeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    if (disposed) return
    tail = tail.then(async () => {
      try {
        const identity = await sessionIdentityOf(ctx, agent)
        capabilities.remove(identity.workspaceId, identity.sessionId)
      } catch (error) {
        ctx.logger.warn(`dsh-evolve skipped one Capability Map cleanup: ${errorMessage(error)}`)
      }
    })
  })

  return {
    async flush() {
      await tail
    },
    async dispose() {
      if (!disposed) {
        disposed = true
        removePreStep()
        removeToolResult()
        removeDisposed()
      }
      await tail
    },
  }
}

function sessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}\0${sessionId}`
}

function hashCatalog(capabilities: readonly EvolutionCapabilityView[]): string {
  const catalog = capabilities.map(({ route: _route, ...capability }) => capability)
  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
}

function successfulSkillName(result: Readonly<ToolExecutionResult>): string | undefined {
  if (result.isError || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
    return undefined
  }
  const name = result.value.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
