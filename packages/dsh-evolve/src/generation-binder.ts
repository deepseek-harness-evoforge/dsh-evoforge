import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import type { CapabilityGeneration, EvolutionStore, SessionIdentity } from './generation-store.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

interface BindingState {
  settled: Promise<CapabilityGeneration | undefined>
  providerFiber?: Fiber
  disposed: boolean
}

export function installGenerationBinder(
  ctx: Context,
  store: EvolutionStore,
  source: Pick<GenerationBundleRepository, 'providerFor'>,
): () => Promise<void> {
  const bindings = new WeakMap<Agent, BindingState>()
  const states = new Set<BindingState>()

  const bind = (agent: Agent): BindingState => {
    const existing = bindings.get(agent)
    if (existing !== undefined) return existing
    const state: BindingState = {
      disposed: false,
      settled: Promise.resolve(undefined),
    }
    state.settled = bindAgent(ctx, store, source, agent, state)
    bindings.set(agent, state)
    states.add(state)
    return state
  }

  ctx.on('agent/session-start', ({ agent }) => {
    void bind(agent).settled
  })
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    await bind(agent).settled
    return next()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const state = bindings.get(agent)
    bindings.delete(agent)
    if (state !== undefined) void disposeBinding(state, states)
  })

  return async () => {
    await Promise.all([...states].map(state => disposeBinding(state, states)))
  }
}

async function bindAgent(
  ctx: Context,
  store: EvolutionStore,
  source: Pick<GenerationBundleRepository, 'providerFor'>,
  agent: Agent,
  state: BindingState,
): Promise<CapabilityGeneration | undefined> {
  const identity = await sessionIdentityOf(ctx, agent)
  try {
    const generation = await store.pinSession(identity, {
      ...agent.session.header.parentSession === undefined
        ? {}
        : { parentSessionId: String(agent.session.header.parentSession) },
    })
    if (generation === undefined) return undefined
    if (ctx.get('skills') === undefined) {
      throw new Error('DSH Skill Registry is not loaded')
    }
    const provider = await source.providerFor(generation)
    if (state.disposed) return undefined
    const providerFiber = agent.ctx.inject(['skills'], (scoped) => {
      scoped.skills.registerProvider(() => provider)
    })
    state.providerFiber = providerFiber
    await providerFiber
    if (state.disposed) {
      await providerFiber.dispose()
      return undefined
    }
    return generation
  } catch (error) {
    await state.providerFiber?.dispose().catch(() => undefined)
    let fallbackError: unknown
    try {
      await store.fallbackSessionToNative(identity)
    } catch (caught) {
      fallbackError = caught
    }
    if (!state.disposed) {
      ctx.logger.warn(
        `dsh-evolve: Session '${identity.sessionId}' continues without evolved Skills: ${errorMessage(error)}`
        + (fallbackError === undefined
          ? '; native fallback is durable for this lifecycle'
          : `; native fallback could not be persisted: ${errorMessage(fallbackError)}`),
      )
    }
    return undefined
  }
}

async function disposeBinding(state: BindingState, states: Set<BindingState>): Promise<void> {
  if (!state.disposed) state.disposed = true
  await state.settled.catch(() => undefined)
  await state.providerFiber?.dispose()
  states.delete(state)
}

export async function sessionIdentityOf(ctx: Context, agent: Agent): Promise<SessionIdentity> {
  const { id, createdAt, cwd } = agent.session.header
  return {
    workspaceId: await workspaceIdForCwd(ctx, cwd),
    sessionId: String(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
