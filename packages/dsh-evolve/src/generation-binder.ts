import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { GenerationBundleRepository } from './generation-bundle-repository.ts'
import {
  verifyCapabilityGenerationIdentityV2,
  type CapabilityGeneration,
  type EvolutionStore,
  type SessionIdentity,
} from './generation-store.ts'
import {
  createInteractionGenerationEvidenceReceiptV1,
  type InteractionGenerationBindingV1,
  type InteractionGenerationEvidenceSinkV1,
  type InteractionGenerationEvidenceSubjectV1,
} from './interaction-generation-evidence.ts'
import { proveInteractionEpisodeTranscript } from './interaction-episode-projector.ts'
import { projectInteractionEpisodeTriggerRequestControlV1 } from './interaction-trigger-request-control.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const GENERATION_PROVIDER_NAME = 'evoforge-generation'
// `FiberState` is a declaration-only const enum in Cordis 4.0.2. Keep the
// pinned ABI value local so verbatim-module consumers do not emit a missing
// runtime import.
const ACTIVE_FIBER_STATE = 2

type SettledBinding =
  | {
      readonly generation: Extract<InteractionGenerationBindingV1, { readonly kind: 'native' }>
    }
  | {
      readonly generation: Extract<InteractionGenerationBindingV1, { readonly kind: 'evolved' }>
      readonly canonicalGeneration: CapabilityGeneration
      readonly generationDigest: string
    }

interface ProviderRegistration {
  readonly id: object
}

interface CoverageToken {
  readonly id: object
  readonly mountEpoch?: string | undefined
  readonly registration?: ProviderRegistration | undefined
  active: boolean
}

interface TurnCoverage {
  readonly turn: number
  readonly token: CoverageToken
  readonly preSteps: Map<number, number | undefined>
  nextPreStep: number
  pendingStep: number | undefined
  valid: boolean
}

interface BindingState {
  readonly agent: Agent
  readonly session: Session
  readonly turns: Map<number, TurnCoverage>
  settled: Promise<SettledBinding | undefined>
  binding?: SettledBinding | undefined
  identity?: SessionIdentity | undefined
  providerFiber?: Fiber | undefined
  pendingRegistration?: ProviderRegistration | undefined
  activeToken?: CoverageToken | undefined
  disposal?: Promise<void> | undefined
  lifecycleCutoff?: number | undefined
  nextSessionEventSeq?: number | undefined
  lifecycleValid: boolean
  disposed: boolean
}

/**
 * Pin one exact Session lifecycle and, when configured with the private sink,
 * retain only completed-turn Generation evidence. The receipt proves the
 * binder-owned pin/mount boundary; it deliberately says nothing about catalog
 * winners or the rest of Host composition. Like the DSH Session substrate, it
 * trusts code already admitted to the same process with authority to append
 * Session events; it is not an isolation boundary against such a plugin.
 */
export function installGenerationBinder(
  ctx: Context,
  store: EvolutionStore,
  source: Pick<GenerationBundleRepository, 'providerFor'>,
  evidence?: InteractionGenerationEvidenceSinkV1,
): () => Promise<void> {
  const binderEpoch = epoch()
  const bindings = new WeakMap<Agent, BindingState>()
  const sessionBindings = new WeakMap<Session, BindingState>()
  const idBindings = new Map<string, BindingState>()
  const lifecyclePoisoned = new WeakSet<Session>()
  const fiberBindings = new WeakMap<Fiber, BindingState>()
  const states = new Set<BindingState>()
  const writes = new Set<Promise<void>>()
  const disposalErrors = new Set<unknown>()
  let closing = false

  const invalidateToken = (state: BindingState, token?: CoverageToken): void => {
    const current = token ?? state.activeToken
    if (current === undefined) return
    current.active = false
    if (state.activeToken === current) state.activeToken = undefined
    for (const turn of state.turns.values()) {
      if (turn.token === current) turn.valid = false
    }
  }

  const invalidateLifecycle = (state: BindingState): void => {
    state.lifecycleValid = false
    lifecyclePoisoned.add(state.session)
    for (const turn of state.turns.values()) turn.valid = false
  }

  const activateNative = (state: BindingState): void => {
    invalidateToken(state)
    state.activeToken = { id: {}, active: true }
  }

  const activateEvolved = (
    state: BindingState,
    registration: ProviderRegistration,
  ): void => {
    if (closing
      || state.disposed
      || state.pendingRegistration !== registration
      || state.providerFiber?.state !== ACTIVE_FIBER_STATE) return
    invalidateToken(state)
    state.activeToken = {
      id: {},
      active: true,
      mountEpoch: epoch(),
      registration,
    }
  }

  const bind = (agent: Agent, lifecycleCutoff?: number): BindingState => {
    const existing = bindings.get(agent)
    if (existing !== undefined) {
      if (existing.session !== agent.session || lifecycleCutoff !== undefined) {
        invalidateLifecycle(existing)
      }
      return existing
    }
    const exactCutoff = lifecycleCutoff !== undefined
      && Number.isSafeInteger(lifecycleCutoff)
      && lifecycleCutoff >= 0
      && !Object.is(lifecycleCutoff, -0)
      ? lifecycleCutoff
      : undefined
    if (exactCutoff === undefined) lifecyclePoisoned.add(agent.session)
    const state: BindingState = {
      agent,
      session: agent.session,
      turns: new Map(),
      disposed: false,
      lifecycleCutoff: exactCutoff,
      nextSessionEventSeq: exactCutoff,
      lifecycleValid: exactCutoff !== undefined,
      settled: Promise.resolve(undefined),
    }
    state.settled = bindAgent(ctx, store, source, agent, state, {
      activateNative: () => activateNative(state),
      registerFiber: fiber => {
        state.providerFiber = fiber
        fiberBindings.set(fiber, state)
        const registration = state.pendingRegistration
        if (fiber.state === ACTIVE_FIBER_STATE && registration !== undefined) {
          activateEvolved(state, registration)
        }
      },
      registerProvider: (scoped, provider) => {
        if (closing || state.disposed) throw new Error('Generation binder is disposing')
        scoped.skills.registerProvider(() => provider)
        const registration: ProviderRegistration = { id: {} }
        state.pendingRegistration = registration
        scoped.effect(() => () => {
          if (state.pendingRegistration === registration) {
            state.pendingRegistration = undefined
          }
          if (state.activeToken?.registration === registration) {
            invalidateToken(state, state.activeToken)
          }
        }, 'dsh-evolve.generationMountEvidence')
      },
      invalidate: () => invalidateToken(state),
      isClosing: () => closing,
    })
    bindings.set(agent, state)
    sessionBindings.set(agent.session, state)
    idBindings.set(String(agent.id), state)
    states.add(state)
    return state
  }

  const retain = (receipt: Parameters<InteractionGenerationEvidenceSinkV1['retain']>[0]): void => {
    if (evidence === undefined || closing || !allowsEvidence(receipt.workspaceId)) return
    let accepted: Promise<void>
    try {
      accepted = Promise.resolve(evidence.retain(receipt))
    } catch (error) {
      warnEvidenceFailure(ctx, 'retain', error)
      return
    }
    const observed = accepted.catch(error => {
      warnEvidenceFailure(ctx, 'retain', error)
    }).finally(() => {
      writes.delete(observed)
    })
    writes.add(observed)
  }

  const allowsEvidence = (workspaceId: string): boolean => {
    if (evidence === undefined || closing) return false
    try {
      return evidence.allows(workspaceId)
    } catch (error) {
      warnEvidenceFailure(ctx, 'authorize', error)
      return false
    }
  }

  const drainEvidence = async (): Promise<void> => {
    await Promise.all([...writes])
    if (evidence === undefined) return
    await evidence.drain()
  }

  const recordDisposalError = (error: unknown): void => {
    disposalErrors.add(error)
    ctx.logger.warn(`dsh-evolve could not dispose a Generation binding: ${errorMessage(error)}`)
  }

  const listenerDisposers = [
    ctx.on('agent/session-start', ({ agent }) => {
      if (closing) return
      if (!isExactLiveSubject(ctx, agent)) {
        const state = idBindings.get(String(agent.id))
        if (state !== undefined) invalidateLifecycle(state)
        poisonCanonicalSession(ctx, agent, lifecyclePoisoned)
        return
      }
      const lifecycleCutoff = lifecyclePoisoned.has(agent.session)
        ? undefined
        : Number(agent.session.seq)
      void bind(agent, lifecycleCutoff).settled.catch(error => {
        ctx.logger.warn(`dsh-evolve could not settle a Generation binding: ${errorMessage(error)}`)
      })
    }),
    ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (closing) return next()
      if (!isExactLiveSubject(ctx, agent)) {
        const state = idBindings.get(String(agent.id))
        if (state !== undefined) invalidateLifecycle(state)
        return next()
      }
      const state = bind(agent)
      const token = await readyToken(state)
      const coverage = token === undefined
        ? observeUnavailablePreStep(state, turn)
        : observePreStep(state, token, turn, step)
      const decision = await next()
      if (token !== undefined && !tokenIsActive(state, token)) {
        coverage.valid = false
      }
      if (decision.kind === 'reject') coverage.valid = false
      return decision
    }),
    ctx.on('session/event', (session, event) => {
      if (closing) return
      const state = sessionBindings.get(session) ?? idBindings.get(String(session.id))
      if (state === undefined) {
        poisonCanonicalSessionById(ctx, session, lifecyclePoisoned)
        return
      }
      if (state.session !== session
        || state.agent.session !== session
        || !isExactLiveSubject(ctx, state.agent)
        || !acceptExactLiveSessionEvent(state, event)) {
        invalidateLifecycle(state)
        return
      }
      observeSessionEvent(state, store, event, binderEpoch, allowsEvidence, retain)
    }),
    ctx.on('internal/status', (fiber) => {
      const state = fiberBindings.get(fiber)
      if (state === undefined || state.providerFiber !== fiber) return
      if (fiber.state === ACTIVE_FIBER_STATE) {
        const registration = state.pendingRegistration
        if (registration !== undefined) activateEvolved(state, registration)
      } else {
        invalidateToken(state)
      }
    }),
    ctx.on('agent/disposed', ({ agent }) => {
      const state = bindings.get(agent)
      bindings.delete(agent)
      if (state !== undefined) {
        sessionBindings.delete(state.session)
        if (idBindings.get(String(state.agent.id)) === state) idBindings.delete(String(state.agent.id))
        invalidateToken(state)
        void disposeBinding(state, states, invalidateToken).catch(error => {
          recordDisposalError(error)
        })
      }
    }),
    ctx.on('session/disposed', (session) => {
      const state = sessionBindings.get(session)
      sessionBindings.delete(session)
      if (state !== undefined) {
        bindings.delete(state.agent)
        if (idBindings.get(String(state.agent.id)) === state) idBindings.delete(String(state.agent.id))
        invalidateToken(state)
        void disposeBinding(state, states, invalidateToken).catch(error => {
          recordDisposalError(error)
        })
      }
    }),
  ]

  return async () => {
    if (!closing) {
      closing = true
      for (const dispose of listenerDisposers) dispose()
      for (const state of states) invalidateToken(state)
    }
    const results = await Promise.allSettled(
      [...states].map(state => disposeBinding(state, states, invalidateToken)),
    )
    for (const result of results) {
      if (result.status !== 'rejected') continue
      if (!disposalErrors.has(result.reason)) recordDisposalError(result.reason)
    }
    try {
      await drainEvidence()
    } catch (error) {
      warnEvidenceFailure(ctx, 'drain', error)
    }
    const errors = [...disposalErrors]
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Generation binder cleanup failed')
    }
  }
}

async function bindAgent(
  ctx: Context,
  store: EvolutionStore,
  source: Pick<GenerationBundleRepository, 'providerFor'>,
  agent: Agent,
  state: BindingState,
  lifecycle: {
    readonly activateNative: () => void
    readonly registerFiber: (fiber: Fiber) => void
    readonly registerProvider: (
      scoped: Context,
      provider: Awaited<ReturnType<GenerationBundleRepository['providerFor']>>,
    ) => void
    readonly invalidate: () => void
    readonly isClosing: () => boolean
  },
): Promise<SettledBinding | undefined> {
  const identity = await sessionIdentityOf(ctx, agent)
  state.identity = identity
  try {
    const pinned = await store.pinSession(identity, {
      ...agent.session.header.parentSession === undefined
        ? {}
        : { parentSessionId: String(agent.session.header.parentSession) },
    })
    if (state.disposed || lifecycle.isClosing()) return undefined
    if (pinned === undefined) {
      const binding: SettledBinding = {
        generation: {
          kind: 'native',
          pin: 'settled',
          effectiveMount: { kind: 'native' },
        },
      }
      state.binding = binding
      lifecycle.activateNative()
      return binding
    }

    const generation = verifiedPinnedGeneration(store, pinned, identity.workspaceId)
    if (ctx.get('skills') === undefined) {
      throw new Error('DSH Skill Registry is not loaded')
    }
    const provider = await source.providerFor(generation)
    if (provider.name !== GENERATION_PROVIDER_NAME) {
      throw new Error(`Generation provider '${provider.name}' does not match '${GENERATION_PROVIDER_NAME}'`)
    }
    if (state.disposed || lifecycle.isClosing()) return undefined
    const binding: SettledBinding = {
      generation: {
        kind: 'evolved',
        pin: 'settled',
        generationId: generation.id,
        effectiveMount: { kind: 'evolved', generationId: generation.id },
      },
      canonicalGeneration: generation,
      generationDigest: generation.id,
    }
    state.binding = binding
    const providerFiber = agent.ctx.inject(['skills'], (scoped) => {
      lifecycle.registerProvider(scoped, provider)
    })
    lifecycle.registerFiber(providerFiber)
    const mountedFiber = await providerFiber.await()
    lifecycle.registerFiber(mountedFiber)
    if (state.disposed || lifecycle.isClosing()) {
      lifecycle.invalidate()
      await providerFiber.dispose()
      return undefined
    }
    if (providerFiber.state !== ACTIVE_FIBER_STATE || state.activeToken === undefined) {
      throw new Error('evolved Generation provider registration did not become ACTIVE')
    }
    return binding
  } catch (error) {
    lifecycle.invalidate()
    state.binding = undefined
    if (state.disposed || lifecycle.isClosing()) return undefined
    let unmountError: unknown
    try {
      await state.providerFiber?.dispose()
    } catch (caught) {
      unmountError = caught
    }
    if (unmountError !== undefined) {
      if (!state.disposed && !lifecycle.isClosing()) {
        ctx.logger.warn(
          `dsh-evolve: Session '${identity.sessionId}' cannot prove a usable Generation binding: ${errorMessage(error)}`
          + `; evolved provider unmount could not be proven: ${errorMessage(unmountError)}`,
        )
      }
      return undefined
    }
    state.providerFiber = undefined
    state.pendingRegistration = undefined
    if (state.disposed || lifecycle.isClosing()) return undefined
    let fallbackError: unknown
    try {
      await store.fallbackSessionToNative(identity)
    } catch (caught) {
      fallbackError = caught
    }
    if (fallbackError === undefined && !state.disposed && !lifecycle.isClosing()) {
      const binding: SettledBinding = {
        generation: {
          kind: 'native',
          pin: 'settled',
          effectiveMount: { kind: 'native' },
        },
      }
      state.binding = binding
      lifecycle.activateNative()
      ctx.logger.warn(
        `dsh-evolve: Session '${identity.sessionId}' continues without evolved Skills: ${errorMessage(error)}`
        + '; native fallback is durable for this lifecycle',
      )
      return binding
    }
    if (!state.disposed && !lifecycle.isClosing()) {
      ctx.logger.warn(
        `dsh-evolve: Session '${identity.sessionId}' cannot prove a usable Generation binding: ${errorMessage(error)}`
        + `; native fallback could not be persisted: ${errorMessage(fallbackError)}`,
      )
    }
    return undefined
  }
}

function verifiedPinnedGeneration(
  store: EvolutionStore,
  pinned: CapabilityGeneration,
  workspaceId: string,
): CapabilityGeneration {
  const generation = verifyCapabilityGenerationIdentityV2(pinned, workspaceId)
  const stored = store.getGeneration(generation.id)
  const verifiedStored = verifyCapabilityGenerationIdentityV2(stored, workspaceId)
  if (!isDeepStrictEqual(generation, verifiedStored)) {
    throw new Error(`pinned Generation '${generation.id}' does not match its canonical store row`)
  }
  return generation
}

async function readyToken(state: BindingState): Promise<CoverageToken | undefined> {
  const binding = await state.settled
  if (state.disposed || binding === undefined || state.binding !== binding) {
    return undefined
  }
  const providerFiber = state.providerFiber
  if (binding.generation.kind === 'evolved' && providerFiber !== undefined) {
    try {
      await providerFiber.await()
    } catch {
      return undefined
    }
  }
  const token = state.activeToken
  if (token === undefined || !tokenIsActive(state, token)) {
    return undefined
  }
  return token
}

function tokenIsActive(state: BindingState, token: CoverageToken): boolean {
  if (state.disposed || !token.active || state.activeToken !== token) return false
  const binding = state.binding
  if (binding === undefined) return false
  if (binding.generation.kind === 'native') {
    return token.registration === undefined && token.mountEpoch === undefined
  }
  return token.registration !== undefined
    && token.registration === state.pendingRegistration
    && token.mountEpoch !== undefined
    && state.providerFiber?.state === ACTIVE_FIBER_STATE
}

function isExactLiveSubject(ctx: Context, agent: Agent): boolean {
  try {
    const agents = ctx.get('agents')
    const sessions = ctx.get('sessions')
    return agents !== undefined
      && sessions !== undefined
      && agent.id === agent.session.id
      && agents.get(agent.id) === agent
      && sessions.get(agent.session.id) === agent.session
  } catch {
    return false
  }
}

function isExactLiveSession(ctx: Context, session: Session): boolean {
  try {
    return ctx.get('sessions')?.get(session.id) === session
  } catch {
    return false
  }
}

function poisonCanonicalSession(
  ctx: Context,
  observedAgent: Agent,
  poisoned: WeakSet<Session>,
): void {
  try {
    const canonical = ctx.get('agents')?.get(observedAgent.id)
    if (canonical !== undefined && isExactLiveSession(ctx, canonical.session)) {
      poisoned.add(canonical.session)
    }
  } catch {
    // An inexact lifecycle object cannot establish positive evidence.
  }
}

function poisonCanonicalSessionById(
  ctx: Context,
  observedSession: Session,
  poisoned: WeakSet<Session>,
): void {
  try {
    const canonical = ctx.get('sessions')?.get(observedSession.id)
    if (canonical !== undefined) poisoned.add(canonical)
  } catch {
    // An inexact lifecycle object cannot establish positive evidence.
  }
}

function acceptExactLiveSessionEvent(state: BindingState, event: SessionEvent): boolean {
  if (!state.lifecycleValid
    || state.lifecycleCutoff === undefined
    || state.nextSessionEventSeq === undefined) return false
  const seq = Number(event.seq)
  if (!Number.isSafeInteger(seq)
    || seq < state.lifecycleCutoff
    || seq !== state.nextSessionEventSeq
    || state.session.eventAt(event.seq) !== event
    || Number(state.session.seq) !== seq + 1) return false
  state.nextSessionEventSeq = seq + 1
  return true
}

function observePreStep(
  state: BindingState,
  token: CoverageToken,
  turn: number,
  step: number,
): TurnCoverage {
  let coverage = state.turns.get(turn)
  if (coverage === undefined) {
    coverage = {
      turn,
      token,
      preSteps: new Map(),
      nextPreStep: 1,
      pendingStep: undefined,
      valid: state.lifecycleValid && step === 1,
    }
    state.turns.set(turn, coverage)
  }
  if (!Number.isSafeInteger(turn)
    || turn < 1
    || !Number.isSafeInteger(step)
    || step < 1
    || coverage.token !== token
    || coverage.nextPreStep !== step
    || coverage.pendingStep !== undefined
    || coverage.preSteps.has(step)) {
    coverage.valid = false
  }
  coverage.preSteps.set(step, undefined)
  coverage.pendingStep = step
  coverage.nextPreStep = step + 1
  return coverage
}

function observeUnavailablePreStep(state: BindingState, turn: number): TurnCoverage {
  const coverage = state.turns.get(turn) ?? invalidCoverage(turn)
  coverage.valid = false
  state.turns.set(turn, coverage)
  return coverage
}

function observeSessionEvent(
  state: BindingState,
  store: EvolutionStore,
  event: SessionEvent,
  binderEpoch: string,
  allowsEvidence: (workspaceId: string) => boolean,
  retain: (receipt: Parameters<InteractionGenerationEvidenceSinkV1['retain']>[0]) => void,
): void {
  if (event.type === 'step/start') {
    const coverage = state.turns.get(event.data.turn)
    if (coverage === undefined) {
      state.turns.set(event.data.turn, invalidCoverage(event.data.turn))
      return
    }
    if (!coverage.valid
      || !tokenIsActive(state, coverage.token)
      || coverage.pendingStep !== event.data.step) {
      coverage.valid = false
      return
    }
    coverage.pendingStep = undefined
    coverage.preSteps.set(event.data.step, Number(event.seq))
    return
  }
  if (event.type !== 'turn/end') return
  const coverage = state.turns.get(event.data.turn)
  state.turns.delete(event.data.turn)
  const canonical = state.binding !== undefined && bindingIsStillCanonical(state, store)
  if (event.data.reason.kind !== 'completed'
    || coverage === undefined
    || !coverage.valid
    || coverage.pendingStep !== undefined
    || !tokenIsActive(state, coverage.token)
    || state.binding === undefined
    || !canonical) return

  const snapshot = state.session.snapshotEvents()
  if (snapshot.length !== Number(event.seq) + 1 || snapshot[Number(event.seq)] !== event) return
  const stepStarts = snapshot.filter((candidate): candidate is SessionEvent<'step/start'> =>
    candidate.type === 'step/start'
    && candidate.data.turn === event.data.turn
    && candidate.seq < event.seq)
  if (stepStarts.length !== coverage.preSteps.size
    || stepStarts.some(candidate =>
      coverage.preSteps.get(candidate.data.step) !== Number(candidate.seq))) return

  const candidateCalls = snapshot.filter((candidate): candidate is SessionEvent<'tool/call'> =>
    candidate.type === 'tool/call'
    && candidate.data.turn === event.data.turn
    && candidate.seq < event.seq
    && (candidate.data.name === 'skill' || candidate.data.name === 'report_capability_gap'))
  for (const candidate of candidateCalls) {
    const proven = proveInteractionEpisodeTranscript({
      header: state.session.header,
      inheritedEventCount: state.session.inheritedEventCount,
      snapshotEvents: () => snapshot,
    }, Number(event.seq), { callId: String(candidate.data.callId) })
    if (proven.status !== 'proven') continue
    const firstStepSeq = coverage.preSteps.get(1)
    if (proven.proof.source.turn !== coverage.turn
      || firstStepSeq === undefined
      || proven.proof.witness.admissionStepStartSeq !== firstStepSeq) continue
    const subject: InteractionGenerationEvidenceSubjectV1 = {
      schemaVersion: 1,
      kind: 'durable-interaction-episode-subject-v1',
      session: {
        header: state.session.header,
        inheritedEventCount: Number(state.session.inheritedEventCount),
        throughSeq: Number(event.seq),
        events: snapshot,
      },
      transcript: proven.proof,
    }
    const projected = projectInteractionEpisodeTriggerRequestControlV1(subject)
    if (projected.status !== 'projected') continue
    try {
      const binding = state.binding
      const workspaceId = state.identity?.workspaceId
      const lifecycleCutoff = state.lifecycleCutoff
      if (workspaceId === undefined
        || lifecycleCutoff === undefined
        || !allowsEvidence(workspaceId)) continue
      const receipt = 'generationDigest' in binding
        ? createInteractionGenerationEvidenceReceiptV1({
            workspaceId,
            subject,
            derived: { triggerRequestControl: projected.fact },
            generation: binding.generation,
            generationDigest: binding.generationDigest ?? '',
            binderEpoch,
            lifecycleCutoff,
            mountEpoch: coverage.token.mountEpoch ?? '',
          })
        : createInteractionGenerationEvidenceReceiptV1({
            workspaceId,
            subject,
            derived: { triggerRequestControl: projected.fact },
            generation: binding.generation,
            binderEpoch,
            lifecycleCutoff,
          })
      retain(receipt)
    } catch {
      // A malformed or drifting live observation is not evidence.
    }
  }
}

function bindingIsStillCanonical(state: BindingState, store: EvolutionStore): boolean {
  const identity = state.identity
  const binding = state.binding
  if (identity === undefined || binding === undefined) return false
  try {
    const readPin = store.getSessionGenerationPin
    if (readPin === undefined) return false
    const currentPin = readPin.call(store, identity)
    if (!('canonicalGeneration' in binding)) return currentPin.kind === 'native'
    if (currentPin.kind !== 'evolved') return false
    const verifiedPin = verifyCapabilityGenerationIdentityV2(
      currentPin.generation,
      identity.workspaceId,
    )
    const verifiedRow = verifyCapabilityGenerationIdentityV2(
      store.getGeneration(binding.canonicalGeneration.id),
      identity.workspaceId,
    )
    return isDeepStrictEqual(verifiedPin, binding.canonicalGeneration)
      && isDeepStrictEqual(verifiedRow, binding.canonicalGeneration)
  } catch {
    return false
  }
}

function invalidCoverage(turn: number): TurnCoverage {
  return {
    turn,
    token: { id: {}, active: false },
    preSteps: new Map(),
    nextPreStep: 1,
    pendingStep: undefined,
    valid: false,
  }
}

async function disposeBinding(
  state: BindingState,
  states: Set<BindingState>,
  invalidate: (state: BindingState, token?: CoverageToken) => void,
): Promise<void> {
  if (state.disposal !== undefined) return state.disposal
  state.disposed = true
  invalidate(state)
  for (const turn of state.turns.values()) turn.valid = false
  state.turns.clear()
  const disposal = (async () => {
    try {
      await state.settled.catch(() => undefined)
      await state.providerFiber?.dispose()
    } finally {
      state.providerFiber = undefined
      state.pendingRegistration = undefined
      states.delete(state)
    }
  })()
  state.disposal = disposal
  return disposal
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

function epoch(): string {
  return randomBytes(32).toString('hex')
}

function warnEvidenceFailure(
  ctx: Context,
  operation: 'authorize' | 'retain' | 'drain',
  error: unknown,
): void {
  ctx.logger.warn(
    `dsh-evolve could not ${operation} optional Interaction Generation evidence: ${errorMessage(error)}`,
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
