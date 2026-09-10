import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-goal'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import {
  defineTool,
  type ToolDefinition,
  type ToolExecution,
  type ToolExecutionResult,
  type ToolExecutionSuccess,
  type ToolRuntime,
} from '@deepseek-ai/dsh-tools'
import type { CapabilityMap } from './capability-map.ts'
import { createCapabilityGapAuthoringQualificationV2 } from './capability-gap-store.ts'
import type {
  CapabilityGap,
  CapabilityGapStore,
} from './capability-gap-store.ts'
import { sessionIdentityOf } from './generation-binder.ts'
import type { EvolutionStore, SessionIdentity } from './generation-store.ts'
import {
  createLifecycleTimerScope,
  type LifecycleTimerScope,
} from './lifecycle-deadline.ts'
import {
  compileInteractionRoutingEvidencePolicies,
  createInteractionRoutingEvidenceReceiptV1,
  createInteractionRoutingEvidenceSink,
  createInteractionRoutingEvidenceSource,
  INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1,
  interactionRoutingEvidenceQueryIdentityIdV1,
  openInteractionRoutingEvidenceVault,
  type InteractionRoutingEvidenceDerivedV1,
  type InteractionRoutingEvidencePolicyConfig,
  type InteractionRoutingEvidenceReceiptV1,
  type InteractionRoutingEvidenceSinkV1,
  type InteractionRoutingEvidenceSourceV1,
  type InteractionRoutingEvidenceSubjectV1,
  type InteractionRoutingEvidenceVaultV1,
} from './interaction-routing-evidence.ts'
import {
  proveInteractionEpisodeTranscript,
  type InteractionEpisodeTranscriptProofV1,
} from './interaction-episode-projector.ts'
import { projectInteractionEpisodeTriggerRequestControlV1 } from './interaction-trigger-request-control.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const ROUTING_TOOL_NAME = INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1.name
const DEFAULT_WORKSPACE_RECHECK_TIMEOUT_MS = 30_000
const MAX_WORKSPACE_RECHECK_TIMEOUT_MS = 120_000

export interface CapabilityGapRoutingEvidenceDependenciesV1 {
  readonly gaps: Pick<CapabilityGapStore, 'record' | 'qualifyForAuthoring'>
  readonly capabilities: Pick<CapabilityMap, 'snapshot'>
  readonly evolution: Pick<EvolutionStore, 'getSessionGeneration'>
}

export interface CapabilityGapRoutingEvidenceOptionsV1 {
  readonly policies?: readonly InteractionRoutingEvidencePolicyConfig[]
  readonly now?: () => number
  readonly onGap?: (gap: CapabilityGap) => Promise<void> | void
  /** @internal Bounded completion-time Workspace lookup; exposed only for deterministic tests. */
  readonly workspaceRecheckTimeoutMs?: number | undefined
}

export interface InstalledCapabilityGapRoutingEvidenceV1 {
  readonly source: InteractionRoutingEvidenceSourceV1
  dispose(): Promise<void>
}

interface RegistrationEpoch {
  readonly registrationEpoch: string
  readonly tools: ToolRuntime
  definition?: ToolDefinition | undefined
  active: boolean
}

interface TurnCoverage {
  readonly turn: number
  readonly registration: RegistrationEpoch
  readonly preSteps: Map<number, number | undefined>
  nextPreStep: number
  pendingStep: number | undefined
  valid: boolean
}

interface CallObservation {
  readonly event: SessionEvent<'tool/call'>
  readonly coverage: TurnCoverage | undefined
  readonly executions: ExecutionObservation[]
  ambiguous: boolean
}

interface ExecutionObservation {
  readonly execution: Readonly<ToolExecution>
  readonly executionEpoch: string
  readonly registration: RegistrationEpoch
  readonly state: LifecycleState
  readonly call: CallObservation
  listenerEntries: number
  listenerSettles: number
  bodyEntries: number
  bodySettles: number
  finalObservations: number
  sessionResultObservations: number
  valid: boolean
  bodyValue?: unknown
  bodyIdentity?: SessionIdentity
  bodyGap?: CapabilityGap
  bodyCreated?: boolean
  bodyQualified?: boolean
  bodyGoal?: CapabilityGap['goal']
  finalResult?: Readonly<ToolExecutionSuccess>
  sessionResult?: SessionEvent<'tool/result'>
}

interface LifecycleState {
  readonly agent: Agent
  readonly session: Session
  readonly sessionHeader: Session['header']
  readonly inheritedEventCount?: number | undefined
  readonly lifecycleCutoff?: number | undefined
  readonly turns: Map<number, TurnCoverage>
  readonly callsById: Map<string, CallObservation[]>
  nextSessionEventSeq?: number | undefined
  lifecycleValid: boolean
  disposed: boolean
}

interface CompletionSessionIdentitySnapshot {
  readonly sessionId: string
  readonly createdAt: number
  readonly cwd?: string | undefined
}

/**
 * Install the exact owned Capability Gap Tool and expose only a least-authority
 * Routing evidence reader. The producer accepts evidence only after one live,
 * direct Tool execution is paired with its exact final outcome and an
 * authenticated completed Session turn.
 */
export async function installCapabilityGapRoutingEvidenceV1(
  ctx: Context,
  dependencies: CapabilityGapRoutingEvidenceDependenciesV1,
  options: CapabilityGapRoutingEvidenceOptionsV1 = {},
): Promise<InstalledCapabilityGapRoutingEvidenceV1> {
  const authorityEpoch = epoch()
  const now = options.now ?? Date.now
  const workspaceRecheckTimeoutMs = options.workspaceRecheckTimeoutMs
    ?? DEFAULT_WORKSPACE_RECHECK_TIMEOUT_MS
  if (!Number.isInteger(workspaceRecheckTimeoutMs)
    || workspaceRecheckTimeoutMs < 1
    || workspaceRecheckTimeoutMs > MAX_WORKSPACE_RECHECK_TIMEOUT_MS) {
    throw new Error('Capability Gap Routing Workspace recheck timeout is invalid')
  }
  const authority = compileInteractionRoutingEvidencePolicies(options.policies ?? [])
  const vault = await openInteractionRoutingEvidenceVault(ctx.storageDomain, { authority })
  const sink = createInteractionRoutingEvidenceSink(vault)
  const vaultSource = createInteractionRoutingEvidenceSource(vault)
  const pendingCompletions = new Map<string, Promise<void>>()
  const source: InteractionRoutingEvidenceSourceV1 = deepFreeze({
    async resolveRoutingEvidence(subject, derived) {
      const key = interactionRoutingEvidenceQueryIdentityIdV1(subject, derived)
      if (key !== undefined) await pendingCompletions.get(key)?.catch(() => undefined)
      return vaultSource.resolveRoutingEvidence(subject, derived)
    },
  })
  const bindings = new WeakMap<Agent, LifecycleState>()
  const sessionBindings = new WeakMap<Session, LifecycleState>()
  const idBindings = new Map<string, LifecycleState>()
  const lifecyclePoisoned = new WeakSet<Session>()
  const states = new Set<LifecycleState>()
  const executions = new WeakMap<object, ExecutionObservation>()
  const tasks = new Set<Promise<void>>()
  const lifecycleDisposers: Array<() => unknown> = []
  let currentRegistration: RegistrationEpoch | undefined
  let injectionFiber: Fiber | undefined
  let closing = false
  const workspaceRecheckCloseSubscribers = new Set<() => void>()
  let workspaceRecheckTimers: LifecycleTimerScope | undefined
  let disposal: Promise<void> | undefined
  let installationCommitted = false

  const beginClosing = (): void => {
    if (closing) return
    closing = true
    for (const signal of [...workspaceRecheckCloseSubscribers]) signal()
    workspaceRecheckCloseSubscribers.clear()
  }

  const registrationOwnsToolFor = (
    registration: RegistrationEpoch,
    agent: Agent,
  ): boolean => {
    if (closing
      || !registration.active
      || currentRegistration !== registration
      || registration.definition === undefined) return false
    try {
      return registration.tools.get(ROUTING_TOOL_NAME, agent) === registration.definition
    } catch {
      return false
    }
  }

  const invalidateTurn = (coverage: TurnCoverage): void => {
    coverage.valid = false
  }

  const invalidateRegistrationObservations = (registration: RegistrationEpoch): void => {
    for (const state of states) {
      for (const coverage of state.turns.values()) {
        if (coverage.registration === registration) invalidateTurn(coverage)
      }
      for (const calls of state.callsById.values()) {
        for (const call of calls) {
          if (call.coverage?.registration === registration) call.ambiguous = true
          for (const observed of call.executions) {
            if (observed.registration === registration) observed.valid = false
          }
        }
      }
    }
  }

  const invalidateRegistration = (registration: RegistrationEpoch): void => {
    if (!registration.active) return
    registration.active = false
    if (currentRegistration === registration) currentRegistration = undefined
    invalidateRegistrationObservations(registration)
  }

  const invalidateLifecycle = (state: LifecycleState): void => {
    if (!state.lifecycleValid) return
    state.lifecycleValid = false
    lifecyclePoisoned.add(state.session)
    for (const coverage of state.turns.values()) coverage.valid = false
    for (const calls of state.callsById.values()) {
      for (const call of calls) {
        for (const observed of call.executions) observed.valid = false
      }
    }
  }

  const releaseLifecycleState = (state: LifecycleState): void => {
    state.disposed = true
    invalidateLifecycle(state)
    for (const calls of state.callsById.values()) {
      for (const call of calls) {
        for (const observed of call.executions) executions.delete(observed.execution)
      }
    }
    state.turns.clear()
    state.callsById.clear()
    if (bindings.get(state.agent) === state) bindings.delete(state.agent)
    if (sessionBindings.get(state.session) === state) sessionBindings.delete(state.session)
    if (idBindings.get(String(state.agent.id)) === state) {
      idBindings.delete(String(state.agent.id))
    }
    states.delete(state)
  }

  const releaseAllLifecycleStates = (): void => {
    for (const state of [...states]) releaseLifecycleState(state)
    idBindings.clear()
    states.clear()
  }

  const bind = (agent: Agent, lifecycleCutoff?: number): LifecycleState => {
    const existing = bindings.get(agent)
    if (existing !== undefined) {
      if (existing.session !== agent.session || lifecycleCutoff !== undefined) {
        invalidateLifecycle(existing)
      }
      return existing
    }
    const exactCutoff = exactNonNegativeInteger(lifecycleCutoff)
    const inheritedEventCount = exactNonNegativeInteger(agent.session.inheritedEventCount)
    if (exactCutoff === undefined || inheritedEventCount === undefined) {
      lifecyclePoisoned.add(agent.session)
    }
    const state: LifecycleState = {
      agent,
      session: agent.session,
      sessionHeader: agent.session.header,
      inheritedEventCount,
      lifecycleCutoff: exactCutoff,
      turns: new Map(),
      callsById: new Map(),
      nextSessionEventSeq: exactCutoff,
      lifecycleValid: exactCutoff !== undefined
        && inheritedEventCount !== undefined
        && !lifecyclePoisoned.has(agent.session),
      disposed: false,
    }
    const priorById = idBindings.get(String(agent.id))
    const priorBySession = sessionBindings.get(agent.session)
    if (priorById !== undefined && priorById !== state) invalidateLifecycle(priorById)
    if (priorBySession !== undefined && priorBySession !== state) invalidateLifecycle(priorBySession)
    if (priorById !== undefined || priorBySession !== undefined) {
      state.lifecycleValid = false
      lifecyclePoisoned.add(agent.session)
    }
    bindings.set(agent, state)
    sessionBindings.set(agent.session, state)
    idBindings.set(String(agent.id), state)
    states.add(state)
    return state
  }

  const track = (task: Promise<void>): void => {
    const observed = task.finally(() => tasks.delete(observed))
    tasks.add(observed)
    void observed.catch(() => undefined)
  }

  const trackThunk = (task: () => Promise<void>): void => {
    let resolveEnrolled!: () => void
    let rejectEnrolled!: (error: unknown) => void
    const enrolled = new Promise<void>((resolve, reject) => {
      resolveEnrolled = resolve
      rejectEnrolled = reject
    })
    track(enrolled)
    try {
      void Promise.resolve(task()).then(resolveEnrolled, rejectEnrolled)
    } catch (error) {
      rejectEnrolled(error)
    }
  }

  const trackCompletion = (
    subject: InteractionRoutingEvidenceSubjectV1,
    derived: InteractionRoutingEvidenceDerivedV1,
    task: () => Promise<void>,
  ): void => {
    const key = interactionRoutingEvidenceQueryIdentityIdV1(subject, derived)
    let resolveEnrolled!: () => void
    let rejectEnrolled!: (error: unknown) => void
    const enrolled = new Promise<void>((resolve, reject) => {
      resolveEnrolled = resolve
      rejectEnrolled = reject
    })
    if (key !== undefined) {
      pendingCompletions.set(key, enrolled)
      const releaseBarrier = (): void => {
        if (pendingCompletions.get(key) === enrolled) pendingCompletions.delete(key)
      }
      void enrolled.then(releaseBarrier, releaseBarrier)
    }
    // Enroll both shutdown draining and the exact-subject read barrier before
    // entering Workspace service code. This preserves a completed turn across
    // immediate teardown and closes synchronous re-entrant read/dispose races.
    track(enrolled)
    try {
      void Promise.resolve(task()).then(resolveEnrolled, rejectEnrolled)
    } catch (error) {
      rejectEnrolled(error)
    }
  }

  const warn = (
    operation: 'authorize' | 'retain' | 'record conflict' | 'reconcile',
    error: unknown,
  ): void => {
    safelyWarn(ctx,
      `dsh-evolve could not ${operation} optional Interaction Routing evidence: ${errorMessage(error)}`,
    )
  }

  const completionSessionIdentity = async (
    agent: Agent,
  ): Promise<SessionIdentity | undefined> => {
    type Outcome =
      | { readonly kind: 'identity'; readonly identity: SessionIdentity }
      | { readonly kind: 'failed'; readonly error: unknown }
      | { readonly kind: 'closing' }
      | { readonly kind: 'timeout' }
    if (closing) return undefined
    let signalClose: (() => void) | undefined
    const close = new Promise<Outcome>(resolve => {
      signalClose = () => resolve({ kind: 'closing' })
      workspaceRecheckCloseSubscribers.add(signalClose)
    })
    let identitySnapshot: CompletionSessionIdentitySnapshot
    try {
      identitySnapshot = snapshotCompletionSessionIdentity(agent)
    } catch (error) {
      if (signalClose !== undefined) workspaceRecheckCloseSubscribers.delete(signalClose)
      warn('authorize', error)
      return undefined
    }
    let releaseTimeout: (() => void) | undefined
    const timeout = new Promise<Outcome>(resolve => {
      releaseTimeout = workspaceRecheckTimers?.register(
        workspaceRecheckTimeoutMs,
        () => resolve({ kind: 'timeout' }),
        () => resolve({ kind: 'closing' }),
      )
    })
    if (releaseTimeout === undefined) {
      if (signalClose !== undefined) workspaceRecheckCloseSubscribers.delete(signalClose)
      return undefined
    }
    const identity = resolveCompletionSessionIdentity(ctx, identitySnapshot).then<Outcome, Outcome>(
      value => ({ kind: 'identity', identity: value }),
      error => ({ kind: 'failed', error }),
    )
    let outcome: Outcome
    try {
      outcome = await Promise.race<Outcome>([identity, close, timeout])
    } finally {
      releaseTimeout()
      if (signalClose !== undefined) workspaceRecheckCloseSubscribers.delete(signalClose)
    }
    if (outcome.kind === 'identity') return outcome.identity
    if (outcome.kind === 'failed') warn('authorize', outcome.error)
    if (outcome.kind === 'timeout') {
      safelyWarn(ctx,
        `dsh-evolve timed out rechecking Workspace identity after ${workspaceRecheckTimeoutMs}ms`,
      )
    }
    return undefined
  }

  const retentionAuthorization = (workspaceId: string): boolean | undefined => {
    if (closing) return undefined
    try {
      return sink.allows(workspaceId)
    } catch (error) {
      warn('authorize', error)
      return undefined
    }
  }

  const invokeOnGap = (observed: ExecutionObservation): Promise<void> => {
    if (options.onGap === undefined
      || observed.bodyQualified !== true
      || observed.bodyGap === undefined
      || observed.bodyGoal === undefined) return Promise.resolve()
    return Promise.resolve().then(() => options.onGap!(observed.bodyGap!)).then(
      () => undefined,
      error => warn('reconcile', error),
    )
  }

  const retainProvenObservation = (
    receipt: InteractionRoutingEvidenceReceiptV1,
  ): void => {
    const workspaceId = receipt.workspaceId
    if (closing) return
    let configured: boolean
    try {
      configured = authority.allows(workspaceId)
    } catch (error) {
      warn('authorize', error)
      return
    }
    const authorized = retentionAuthorization(workspaceId)
    if (authorized === undefined) return
    if (!configured) return
    if (!authorized) return
    trackThunk(async () => {
      try {
        await sink.retain(receipt)
      } catch (error) {
        warn('retain', error)
      }
    })
  }

  const qualifyProvenGap = async (
    observed: ExecutionObservation,
    receipt: InteractionRoutingEvidenceReceiptV1,
  ): Promise<void> => {
    const gap = observed.bodyGap
    if (gap === undefined || observed.bodyGoal === undefined || closing) return
    if (receipt.subject.triggerKind !== 'successful-gap-report') return
    let qualification: ReturnType<typeof createCapabilityGapAuthoringQualificationV2>
    let qualified: Awaited<ReturnType<CapabilityGapStore['qualifyForAuthoring']>>
    try {
      qualification = createCapabilityGapAuthoringQualificationV2(gap, {
        sourceDialect: receipt.sourceDialect,
        subject: { ...receipt.subject, triggerKind: 'successful-gap-report' },
        provenance: receipt.provenance,
      })
      qualified = await dependencies.gaps.qualifyForAuthoring(gap.id, qualification)
    } catch (error) {
      safelyWarn(ctx,
        `dsh-evolve could not qualify a completed Capability Gap for authoring: ${errorMessage(error)}`,
      )
      return
    }
    const { authoringQualification: returnedQualification, ...returnedBase } = qualified.gap
    const { authoringQualification: _priorQualification, ...observedBase } = gap
    const qualificationIsExact = isDeepStrictEqual(returnedQualification, qualification)
    if (closing
      || typeof qualified.qualified !== 'boolean'
      || !isDeepStrictEqual(returnedBase, observedBase)
      || !qualificationIsExact) {
      safelyWarn(ctx, 'dsh-evolve rejected an inexact Capability Gap authoring qualification')
      return
    }
    observed.bodyGap = qualified.gap
    observed.bodyQualified = qualified.qualified
    if (qualified.qualified) await invokeOnGap(observed)
  }

  const recordConflict = (
    workspaceId: string,
    subject: InteractionRoutingEvidenceSubjectV1,
    derived: InteractionRoutingEvidenceDerivedV1,
  ): void => {
    if (retentionAuthorization(workspaceId) !== true) return
    trackThunk(async () => {
      try {
        await sink.recordConflict({ workspaceId, subject, derived })
      } catch (error) {
        warn('record conflict', error)
      }
    })
  }

  const observeCompletedTurn = (
    state: LifecycleState,
    event: SessionEvent<'turn/end'>,
  ): void => {
    const coverage = state.turns.get(event.data.turn)
    state.turns.delete(event.data.turn)
    const inheritedEventCount = state.inheritedEventCount
    try {
      if (event.data.reason.kind !== 'completed'
      || coverage === undefined
      || !coverage.valid
      || coverage.pendingStep !== undefined
      || inheritedEventCount === undefined
      || !state.lifecycleValid
      || state.disposed
      || !registrationOwnsToolFor(coverage.registration, state.agent)) return

    const snapshot = state.session.snapshotEvents()
    if (snapshot.length !== Number(event.seq) + 1
      || snapshot[Number(event.seq)] !== event) return
    const stepStarts = snapshot.filter((candidate): candidate is SessionEvent<'step/start'> =>
      candidate.type === 'step/start'
      && candidate.data.turn === event.data.turn
      && candidate.seq < event.seq)
    if (stepStarts.length !== coverage.preSteps.size
      || stepStarts.some(candidate =>
        coverage.preSteps.get(candidate.data.step) !== Number(candidate.seq))) return

    const calls = snapshot.filter((candidate): candidate is SessionEvent<'tool/call'> =>
      candidate.type === 'tool/call'
      && candidate.data.name === ROUTING_TOOL_NAME
      && candidate.data.turn === event.data.turn
      && candidate.seq < event.seq)
    for (const candidate of calls) {
      const observations = state.callsById.get(String(candidate.data.callId))
        ?.filter(call => call.event === candidate) ?? []
      if (observations.length !== 1) continue
      const call = observations[0]!
      const proven = proveInteractionEpisodeTranscript({
        header: state.sessionHeader,
        inheritedEventCount: inheritedEventCount as Session['inheritedEventCount'],
        snapshotEvents: () => snapshot,
      }, Number(event.seq), { callId: String(candidate.data.callId) })
      if (proven.status !== 'proven'
        || proven.proof.trigger.kind !== 'successful-gap-report'
        || proven.proof.source.turn !== coverage.turn
        || !loggedRequestsContainExactContract(snapshot, proven.proof, coverage.registration)) {
        continue
      }
      const admissionSeq = coverage.preSteps.get(1)
      if (admissionSeq === undefined
        || proven.proof.witness.admissionStepStartSeq !== admissionSeq) continue
      const subject: InteractionRoutingEvidenceSubjectV1 = {
        schemaVersion: 1,
        kind: 'durable-interaction-episode-subject-v1',
        session: {
          header: state.sessionHeader,
          inheritedEventCount,
          throughSeq: Number(event.seq),
          events: snapshot,
        },
        transcript: proven.proof,
      }
      const projected = projectInteractionEpisodeTriggerRequestControlV1(subject)
      if (projected.status !== 'projected') continue
      const derived = { triggerRequestControl: projected.fact } as const
      const valid = call.executions.filter(observed =>
        observationIsExact(
          ctx,
          state,
          coverage,
          call,
          observed,
          proven.proof.trigger.requestedSkill,
          proven.proof.goal,
          registrationOwnsToolFor,
        ))
      if (!call.ambiguous && call.executions.length === 1 && valid.length === 1) {
        const observed = valid[0]!
        trackCompletion(subject, derived, async () => {
          const completionIdentity = await completionSessionIdentity(state.agent)
          if (completionIdentity === undefined) return
          if (closing
            || state.disposed
            || !state.lifecycleValid
            || !observed.valid
            || !isExactLiveSubject(ctx, state.agent)
            || !registrationOwnsToolFor(coverage.registration, state.agent)) return
          const bodyIdentity = observed.bodyIdentity
          if (bodyIdentity === undefined
            || !lifecycleIdentityIsCurrent(state)
            || !completionSessionHeaderMatches(state.agent, completionIdentity)
            || completionIdentity.workspaceId !== bodyIdentity.workspaceId
            || completionIdentity.sessionId !== bodyIdentity.sessionId
            || completionIdentity.createdAt !== bodyIdentity.createdAt
            || completionIdentity.cwd !== bodyIdentity.cwd) {
            const workspaceIds = new Set([
              ...(bodyIdentity === undefined ? [] : [bodyIdentity.workspaceId]),
              completionIdentity.workspaceId,
            ])
            for (const workspaceId of [...workspaceIds].sort()) {
              recordConflict(workspaceId, subject, derived)
            }
            return
          }
          const lifecycleCutoff = state.lifecycleCutoff
          if (lifecycleCutoff === undefined) return
          let receipt: InteractionRoutingEvidenceReceiptV1
          try {
            receipt = createInteractionRoutingEvidenceReceiptV1({
              workspaceId: completionIdentity.workspaceId,
              subject,
              derived,
              authorityEpoch,
              registrationEpoch: coverage.registration.registrationEpoch,
              executionEpoch: observed.executionEpoch,
              lifecycleCutoff,
              bodyValue: observed.bodyValue,
              finalResult: observed.finalResult,
            })
          } catch (error) {
            warn('retain', error)
            return
          }
          retainProvenObservation(receipt)
          // Authoring qualification is durable and unconditional for a Goal-
          // linked proven Gap. It is neither granted nor withheld by optional
          // Routing receipt retention.
          if (observed.bodyGoal !== undefined) {
            trackThunk(() => qualifyProvenGap(observed, receipt))
          }
        })
        continue
      }
      const workspaceIds = new Set(call.executions.flatMap(observed =>
        observed.bodyIdentity === undefined ? [] : [observed.bodyIdentity.workspaceId]))
      for (const workspaceId of [...workspaceIds].sort()) {
        recordConflict(workspaceId, subject, derived)
      }
    }
    } finally {
      releaseTurnObservations(state, event.data.turn, executions)
    }
  }

  try {
    workspaceRecheckTimers = createLifecycleTimerScope(
      ctx,
      'dsh-evolve.capabilityGapRouting.workspaceRecheckTimers',
    )
    lifecycleDisposers.push(
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
        bind(agent, lifecycleCutoff)
      }),
      ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
        if (closing) return next()
        if (!isExactLiveSubject(ctx, agent)) {
          const state = idBindings.get(String(agent.id))
          if (state !== undefined) invalidateLifecycle(state)
          return next()
        }
        const state = bind(agent)
        const registration = currentRegistration
        const coverage = registration !== undefined
          && registrationOwnsToolFor(registration, agent)
          ? observePreStep(state, registration, turn, step)
          : observeUnavailablePreStep(state, turn)
        const decision = await next()
        if (registration === undefined
          || !registrationOwnsToolFor(registration, agent)
          || decision.kind === 'reject') coverage.valid = false
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
        if (event.type === 'step/start') {
          observeStepStart(state, event, registrationOwnsToolFor)
          return
        }
        if (event.type === 'tool/call' && event.data.name === ROUTING_TOOL_NAME) {
          observeToolCall(state, event)
          return
        }
        if (event.type === 'tool/result') {
          observeSessionResult(state, event)
          return
        }
        if (event.type === 'turn/end') observeCompletedTurn(state, event)
      }),
      ctx.on('agent/disposed', ({ agent }) => {
        const state = bindings.get(agent)
        if (state === undefined) return
        releaseLifecycleState(state)
      }),
      ctx.on('session/disposed', (session) => {
        const state = sessionBindings.get(session)
        if (state === undefined) return
        releaseLifecycleState(state)
      }),
      ctx.on('internal/status', (fiber) => {
        // FiberState.FAILED is a declaration-only const enum in Cordis 4.0.2.
        // Keep the pinned ABI value local so verbatim-module consumers do not
        // emit a missing runtime import.
        if (!installationCommitted || fiber !== injectionFiber || fiber.state !== 3) return
        if (!closing) {
          beginClosing()
          if (currentRegistration !== undefined) invalidateRegistration(currentRegistration)
          for (const remove of lifecycleDisposers.splice(0).reverse()) safelyDispose(remove)
          releaseAllLifecycleStates()
        }
        disposal ??= closeInstalledProducer(
          injectionFiber,
          tasks,
          sink,
          vault,
          workspaceRecheckTimers!,
        )
        void disposal.catch(error => {
          safelyWarn(ctx,
            `dsh-evolve disabled Interaction Routing evidence after a Tool mount failure: ${errorMessage(error)}`,
          )
        })
      }),
    )

    const toolsWerePresent = ctx.get('tools') !== undefined
    injectionFiber = ctx.inject(['tools'], (toolCtx) => {
      if (closing) return
      if (currentRegistration?.active) {
        throw new Error('Capability Gap Routing evidence already has an active Tool registration')
      }
      const registration: RegistrationEpoch = {
        registrationEpoch: epoch(),
        tools: toolCtx.tools,
        active: false,
      }
      const removeChange = toolCtx.on('tools/change', () => {
        if (!registration.active || currentRegistration !== registration) return
        // Alpha.5 does not expose the definition selected by ToolRuntime for an
        // execution. Any registry mutation during an admitted turn could hide
        // a transient same-name shadow, so poison only the observations already
        // in progress and keep this registration available for a clean turn.
        invalidateRegistrationObservations(registration)
      })
      const removeExecute = toolCtx.on('tools/execute', async (execution, next) => {
        let observed = executions.get(execution)
        if (observed !== undefined) {
          observed.listenerEntries += 1
          observed.valid = false
          observed.call.ambiguous = true
        } else {
          observed = beginExecutionObservation(
            ctx,
            registration,
            execution,
            bindings,
            executions,
            registrationOwnsToolFor,
          )
        }
        const result = await next()
        if (observed !== undefined) observed.listenerSettles += 1
        return result
      })
      const removeResult = toolCtx.on('tools/result', (execution, result) => {
        const observed = executions.get(execution)
        if (observed === undefined) return
        observed.finalObservations += 1
        if (observed.finalObservations !== 1
          || !finalObservationIsExact(
            observed,
            execution,
            result,
            registrationOwnsToolFor,
          )) {
          observed.valid = false
          observed.call.ambiguous = true
          return
        }
        observed.finalResult = result
      })
      let unregister: (() => unknown) | undefined
      try {
        const definition = createOwnedToolDefinition(
          ctx,
          dependencies,
          now,
          executions,
          registrationOwnsToolFor,
        )
        registration.definition = definition
        unregister = toolCtx.tools.register(definition)
        registration.active = true
        currentRegistration = registration
        if (toolCtx.tools.get(ROUTING_TOOL_NAME) !== definition) {
          throw new Error('Capability Gap Routing evidence Tool registration is not canonical')
        }
      } catch (error) {
        invalidateRegistration(registration)
        removeChange()
        removeResult()
        removeExecute()
        try {
          unregister?.()
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Capability Gap Routing evidence Tool mount and rollback both failed',
          )
        }
        throw error
      }
      return () => {
        invalidateRegistration(registration)
        removeChange()
        removeResult()
        removeExecute()
        unregister?.()
      }
    })
    if (toolsWerePresent) await injectionFiber.await()
  } catch (installError) {
    beginClosing()
    if (currentRegistration !== undefined) invalidateRegistration(currentRegistration)
    for (const dispose of lifecycleDisposers.splice(0).reverse()) safelyDispose(dispose)
    releaseAllLifecycleStates()
    const cleanup = await Promise.allSettled([
      ...(injectionFiber === undefined ? [] : [injectionFiber.dispose()]),
      Promise.all([...tasks]),
      sink.drain(),
      vault.close(),
      ...(workspaceRecheckTimers === undefined ? [] : [workspaceRecheckTimers.dispose()]),
    ])
    const errors: unknown[] = [installError]
    for (const result of cleanup) {
      if (result.status === 'rejected') errors.push(result.reason)
    }
    if (errors.length === 1) throw installError
    throw new AggregateError(errors, 'Capability Gap Routing evidence installation rollback failed')
  }

  const dispose = (): Promise<void> => {
    if (disposal !== undefined) return disposal
    beginClosing()
    if (currentRegistration !== undefined) invalidateRegistration(currentRegistration)
    for (const remove of lifecycleDisposers.splice(0).reverse()) safelyDispose(remove)
    releaseAllLifecycleStates()
    disposal = closeInstalledProducer(
      injectionFiber!,
      tasks,
      sink,
      vault,
      workspaceRecheckTimers!,
    )
    return disposal
  }

  installationCommitted = true
  return Object.freeze({ source, dispose })
}

function createOwnedToolDefinition(
  ctx: Context,
  dependencies: CapabilityGapRoutingEvidenceDependenciesV1,
  now: () => number,
  executions: WeakMap<object, ExecutionObservation>,
  registrationOwnsToolFor: (registration: RegistrationEpoch, agent: Agent) => boolean,
): ToolDefinition {
  const contract = INTERACTION_ROUTING_EVIDENCE_TOOL_CONTRACT_V1
  return deepFreeze(defineTool({
    name: contract.name,
    description: contract.description,
    parameters: contract.parameters,
    output: {
      schema: contract.output,
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'abstained'
          ? `Capability Gap ${value.gapId} recorded for ${value.requestedSkill}; discovery abstained because no native DSH Goal is active.`
          : value.status === 'queued'
          ? `Capability Gap ${value.gapId} provisionally recorded for ${value.requestedSkill}; authoring eligibility is checked only after an exact completed turn, and discovery may not run.`
          : `Capability Gap ${value.gapId} was already recorded for ${value.requestedSkill}.`,
      }],
    },
    async execute({ name }, execution) {
      const observed = executions.get(execution)
      if (observed === undefined) {
        throw new Error('report_capability_gap requires an observed owned Tool execution')
      }
      observed.bodyEntries += 1
      if (!observed.valid
        || observed.bodyEntries !== 1
        || observed.listenerEntries !== 1
        || observed.listenerSettles !== 0
        || observed.execution !== execution
        || observed.state.disposed
        || !observed.state.lifecycleValid
        || observed.state.agent !== execution.agent
        || !isExactLiveSubject(ctx, observed.state.agent)
        || !registrationOwnsToolFor(observed.registration, observed.state.agent)) {
        observed.valid = false
        observed.call.ambiguous = true
        throw new Error('report_capability_gap requires an exact live owned Tool execution')
      }
      try {
        if (!isSkillName(name) || name.length > 128) {
          throw new Error(`invalid proposed Skill name '${name}'`)
        }
        const agent = execution.agent
        if (agent === undefined) throw new Error('report_capability_gap requires a native DSH Agent')
        const identity = await sessionIdentityOf(ctx, agent)
        const catalog = dependencies.capabilities.snapshot(identity.workspaceId, identity.sessionId)
        if (catalog.status !== 'complete' || catalog.catalogHash === undefined) {
          throw new Error('cannot confirm a Capability Gap from an incomplete Session Skill catalog')
        }
        if (catalog.capabilities.some(capability => capability.name === name)) {
          throw new Error(`Skill '${name}' is already available in this Session`)
        }
        const goal = currentGoal(ctx, agent)
        const generationId = dependencies.evolution.getSessionGeneration(identity)?.id
        const recorded = await dependencies.gaps.record({
          observedAt: now(),
          workspaceId: identity.workspaceId,
          sessionId: identity.sessionId,
          requestedSkill: name,
          catalogHash: catalog.catalogHash,
          catalogSize: catalog.capabilities.length,
          ...(generationId === undefined ? {} : { generationId }),
          ...(goal === undefined
            ? { abstention: { reason: 'missing-native-goal' as const } }
            : { goal }),
          evidence: {
            kind: 'model-declared-skill-gap',
            catalog: 'complete',
            routing: 'model-declared-no-applicable-skill',
            providers: 'settled',
          },
        })
        const value = goal === undefined
          ? {
              status: 'abstained' as const,
              reason: 'missing-native-goal' as const,
              gapId: recorded.gap.id,
              requestedSkill: recorded.gap.requestedSkill,
            }
          : {
              status: recorded.created ? 'queued' as const : 'already-recorded' as const,
              gapId: recorded.gap.id,
              requestedSkill: recorded.gap.requestedSkill,
            }
        observed.bodyIdentity = identity
        observed.bodyGap = recorded.gap
        observed.bodyCreated = recorded.created
        observed.bodyGoal = goal
        observed.bodyValue = value
        if (typeof recorded.created !== 'boolean') observed.valid = false
        return value
      } finally {
        observed.bodySettles += 1
      }
    },
    presentCall({ name }) {
      return {
        card: 'generic',
        title: `Report missing capability ${name}`,
        kind: 'read',
        rawInput: name,
      }
    },
  }))
}

function beginExecutionObservation(
  ctx: Context,
  registration: RegistrationEpoch,
  execution: Readonly<ToolExecution>,
  bindings: WeakMap<Agent, LifecycleState>,
  executions: WeakMap<object, ExecutionObservation>,
  registrationOwnsToolFor: (registration: RegistrationEpoch, agent: Agent) => boolean,
): ExecutionObservation | undefined {
  const agent = execution.agent
  if (execution.name !== ROUTING_TOOL_NAME
    || agent === undefined
    || String(execution.rootCallId) !== String(execution.callId)
    || execution.parent !== undefined
    || !isExactLiveSubject(ctx, agent)
    || !registrationOwnsToolFor(registration, agent)) return undefined
  const state = bindings.get(agent)
  if (state === undefined
    || !state.lifecycleValid
    || state.disposed
    || state.agent !== agent
    || state.session !== agent.session) return undefined
  const calls = state.callsById.get(String(execution.callId)) ?? []
  const eligibleCalls = calls.filter(call =>
    call.coverage !== undefined
    && call.coverage.valid
    && call.coverage.registration === registration
    && call.event.data.name === ROUTING_TOOL_NAME
    && exactGapArguments(call.event.data.arguments, execution.arguments))
  if (eligibleCalls.length !== 1) {
    for (const call of calls) call.ambiguous = true
    return undefined
  }
  const call = eligibleCalls[0]!
  const observed: ExecutionObservation = {
    execution,
    executionEpoch: epoch(),
    registration,
    state,
    call,
    listenerEntries: 1,
    listenerSettles: 0,
    bodyEntries: 0,
    bodySettles: 0,
    finalObservations: 0,
    sessionResultObservations: 0,
    valid: true,
  }
  if (call.executions.length > 0) {
    call.ambiguous = true
    observed.valid = false
    for (const prior of call.executions) prior.valid = false
  }
  call.executions.push(observed)
  executions.set(execution, observed)
  return observed
}

function finalObservationIsExact(
  observed: ExecutionObservation,
  execution: Readonly<ToolExecution>,
  result: Readonly<ToolExecutionResult>,
  registrationOwnsToolFor: (registration: RegistrationEpoch, agent: Agent) => boolean,
): result is Readonly<ToolExecutionSuccess> {
  if (result.isError) return false
  const definition = observed.registration.definition
  if (definition === undefined) return false
  let expected: ToolExecutionSuccess
  try {
    expected = {
      isError: false,
      value: observed.bodyValue as ToolExecutionSuccess['value'],
      content: definition.output.render(
        execution.arguments,
        observed.bodyValue as ToolExecutionSuccess['value'],
      ),
    }
  } catch {
    return false
  }
  return observed.valid
    && observed.execution === execution
    && observed.listenerEntries === 1
    && observed.bodyEntries === 1
    && observed.bodySettles === 1
    && isDeepStrictEqual(result, expected)
    && registrationOwnsToolFor(observed.registration, observed.state.agent)
}

function observePreStep(
  state: LifecycleState,
  registration: RegistrationEpoch,
  turn: number,
  step: number,
): TurnCoverage {
  let coverage = state.turns.get(turn)
  if (coverage === undefined) {
    coverage = {
      turn,
      registration,
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
    || coverage.registration !== registration
    || coverage.nextPreStep !== step
    || coverage.pendingStep !== undefined
    || coverage.preSteps.has(step)) coverage.valid = false
  coverage.preSteps.set(step, undefined)
  coverage.pendingStep = step
  coverage.nextPreStep = step + 1
  return coverage
}

function observeUnavailablePreStep(state: LifecycleState, turn: number): TurnCoverage {
  const coverage = state.turns.get(turn) ?? invalidCoverage(turn)
  coverage.valid = false
  state.turns.set(turn, coverage)
  return coverage
}

function invalidCoverage(turn: number): TurnCoverage {
  return {
    turn,
    registration: {
      registrationEpoch: '',
      tools: undefined as unknown as ToolRuntime,
      active: false,
    },
    preSteps: new Map(),
    nextPreStep: 1,
    pendingStep: undefined,
    valid: false,
  }
}

function observeStepStart(
  state: LifecycleState,
  event: SessionEvent<'step/start'>,
  registrationOwnsToolFor: (registration: RegistrationEpoch, agent: Agent) => boolean,
): void {
  const coverage = state.turns.get(event.data.turn)
  if (coverage === undefined) {
    state.turns.set(event.data.turn, invalidCoverage(event.data.turn))
    return
  }
  if (!coverage.valid
    || coverage.pendingStep !== event.data.step
    || !registrationOwnsToolFor(coverage.registration, state.agent)) {
    coverage.valid = false
    return
  }
  coverage.pendingStep = undefined
  coverage.preSteps.set(event.data.step, Number(event.seq))
}

function observeToolCall(
  state: LifecycleState,
  event: SessionEvent<'tool/call'>,
): void {
  const coverage = state.turns.get(event.data.turn)
  const observation: CallObservation = {
    event,
    coverage,
    executions: [],
    ambiguous: false,
  }
  const callId = String(event.data.callId)
  const calls = state.callsById.get(callId) ?? []
  if (calls.length > 0) {
    observation.ambiguous = true
    for (const prior of calls) {
      prior.ambiguous = true
      for (const execution of prior.executions) execution.valid = false
    }
  }
  if (coverage === undefined
    || !coverage.valid
    || coverage.preSteps.get(event.data.step) === undefined) observation.ambiguous = true
  calls.push(observation)
  state.callsById.set(callId, calls)
}

function observeSessionResult(
  state: LifecycleState,
  event: SessionEvent<'tool/result'>,
): void {
  if (event.data.message.source.kind !== 'tool') return
  const calls = state.callsById.get(String(event.data.message.source.callId)) ?? []
  for (const call of calls) {
    for (const observed of call.executions) {
      observed.sessionResultObservations += 1
      if (observed.sessionResultObservations !== 1
        || observed.finalResult === undefined
        || !sessionResultMatches(observed, event)) {
        observed.valid = false
        call.ambiguous = true
        continue
      }
      observed.sessionResult = event
    }
  }
}

function releaseTurnObservations(
  state: LifecycleState,
  turn: number,
  executions: WeakMap<object, ExecutionObservation>,
): void {
  for (const [callId, calls] of state.callsById) {
    const retained: CallObservation[] = []
    for (const call of calls) {
      if (call.event.data.turn !== turn) {
        retained.push(call)
        continue
      }
      for (const observed of call.executions) executions.delete(observed.execution)
    }
    if (retained.length === 0) state.callsById.delete(callId)
    else state.callsById.set(callId, retained)
  }
}

function sessionResultMatches(
  observed: ExecutionObservation,
  event: SessionEvent<'tool/result'>,
): boolean {
  const final = observed.finalResult
  const block = event.data.message.content[0]
  const sourceSeqs = event.sourceEventSeqs?.map(Number)
  return final !== undefined
    && !final.isError
    && event.surfaceOp === 'append'
    && event.data.message.role === 'user'
    && event.data.message.source.kind === 'tool'
    && String(event.data.message.source.callId) === String(observed.execution.callId)
    && event.data.message.content.length === 1
    && block?.type === 'tool-result'
    && String(block.toolCallId) === String(observed.execution.callId)
    && block.isError === false
    && isDeepStrictEqual(block.content, final.content)
    && event.data.error === undefined
    && (final.meta === undefined
      ? !Object.hasOwn(event.data, 'meta')
      : isDeepStrictEqual(event.data.meta, final.meta))
    && sourceSeqs?.length === 1
    && sourceSeqs[0] === Number(observed.call.event.seq)
}

function observationIsExact(
  ctx: Context,
  state: LifecycleState,
  coverage: TurnCoverage,
  call: CallObservation,
  observed: ExecutionObservation,
  requestedSkill: string,
  durableGoal: InteractionEpisodeTranscriptProofV1['goal'],
  registrationOwnsToolFor: (registration: RegistrationEpoch, agent: Agent) => boolean,
): boolean {
  const result = observed.finalResult
  const sessionResult = observed.sessionResult
  const identity = observed.bodyIdentity
  const gap = observed.bodyGap
  return observed.valid
    && !call.ambiguous
    && observed.state === state
    && observed.call === call
    && observed.registration === coverage.registration
    && observed.listenerEntries === 1
    && observed.listenerSettles === 1
    && observed.bodyEntries === 1
    && observed.bodySettles === 1
    && observed.finalObservations === 1
    && observed.sessionResultObservations === 1
    && result !== undefined
    && sessionResult !== undefined
    && identity !== undefined
    && gap !== undefined
    && observed.bodyCreated !== undefined
    && !result.isError
    && isDeepStrictEqual(observed.bodyValue, result.value)
    && String(observed.execution.callId) === String(call.event.data.callId)
    && String(observed.execution.rootCallId) === String(call.event.data.callId)
    && observed.execution.parent === undefined
    && observed.execution.name === ROUTING_TOOL_NAME
    && observed.execution.agent === state.agent
    && lifecycleIdentityIsCurrent(state)
    && identity.sessionId === String(state.session.id)
    && identity.workspaceId === gap.workspaceId
    && gap.sessionId === identity.sessionId
    && gap.requestedSkill === requestedSkill
    && (observed.bodyGoal === undefined
      ? durableGoal === undefined
        && gap.goal === undefined
        && isDeepStrictEqual(gap.abstention, { reason: 'missing-native-goal' })
      : durableGoal !== undefined
        && durableGoal.id === observed.bodyGoal.id
        && durableGoal.revision === observed.bodyGoal.revision
        && isDeepStrictEqual(gap.goal, observed.bodyGoal)
        && gap.abstention === undefined)
    && isDeepStrictEqual(gap.evidence, {
      kind: 'model-declared-skill-gap',
      catalog: 'complete',
      routing: 'model-declared-no-applicable-skill',
      providers: 'settled',
    })
    && isDeepStrictEqual(observed.execution.arguments, { name: requestedSkill })
    && registrationOwnsToolFor(observed.registration, state.agent)
    && isExactLiveSubject(ctx, state.agent)
    && state.session.eventAt(call.event.seq) === call.event
    && state.session.eventAt(sessionResult.seq) === sessionResult
}

function loggedRequestsContainExactContract(
  events: readonly SessionEvent[],
  proof: InteractionEpisodeTranscriptProofV1,
  registration: RegistrationEpoch,
): boolean {
  const definition = registration.definition
  if (definition === undefined) return false
  const expected = {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }
  const headerSeqs = new Set(proof.witness.assistantRequestRoutes.map(route => route.headerSeq))
  if (headerSeqs.size === 0) return false
  for (const headerSeq of headerSeqs) {
    const event = events[headerSeq]
    if (event?.type !== 'request/header') return false
    const schemas = event.data.header.tools
    if (schemas === undefined) return false
    const named = schemas.filter(schema => schema.name === ROUTING_TOOL_NAME)
    if (named.length !== 1 || !isDeepStrictEqual(named[0], expected)) return false
  }
  return true
}

function exactGapArguments(serialized: string, argumentsValue: unknown): boolean {
  try {
    const parsed: unknown = JSON.parse(serialized)
    return isDeepStrictEqual(parsed, argumentsValue)
      && isDeepStrictEqual(argumentsValue, {
        name: (argumentsValue as { readonly name?: unknown } | null)?.name,
      })
  } catch {
    return false
  }
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

function acceptExactLiveSessionEvent(
  state: LifecycleState,
  event: SessionEvent,
): boolean {
  if (!state.lifecycleValid
    || !lifecycleIdentityIsCurrent(state)
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

function lifecycleIdentityIsCurrent(state: LifecycleState): boolean {
  try {
    return state.agent.session === state.session
      && state.session.header === state.sessionHeader
      && exactNonNegativeInteger(state.session.inheritedEventCount)
        === state.inheritedEventCount
  } catch {
    return false
  }
}

function currentGoal(ctx: Context, agent: Agent): CapabilityGap['goal'] | undefined {
  const goals = ctx.get('goals')
  if (goals === undefined) return undefined
  try {
    const goal = goals.get(agent)
    if (goal === undefined || goal.phase !== 'active') return undefined
    return { id: goal.id, revision: goal.revision, objective: goal.objective }
  } catch {
    return undefined
  }
}

function snapshotCompletionSessionIdentity(agent: Agent): CompletionSessionIdentitySnapshot {
  const { id, createdAt, cwd } = agent.session.header
  return {
    sessionId: String(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
  }
}

function completionSessionHeaderMatches(
  agent: Agent,
  identity: SessionIdentity,
): boolean {
  try {
    const snapshot = snapshotCompletionSessionIdentity(agent)
    return snapshot.sessionId === identity.sessionId
      && snapshot.createdAt === identity.createdAt
      && snapshot.cwd === identity.cwd
  } catch {
    return false
  }
}

async function resolveCompletionSessionIdentity(
  ctx: Context,
  snapshot: CompletionSessionIdentitySnapshot,
): Promise<SessionIdentity> {
  return {
    workspaceId: await workspaceIdForCwd(ctx, snapshot.cwd),
    sessionId: snapshot.sessionId,
    createdAt: snapshot.createdAt,
    ...snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd },
  }
}

async function closeInstalledProducer(
  injectionFiber: Fiber,
  tasks: Set<Promise<void>>,
  sink: InteractionRoutingEvidenceSinkV1,
  vault: InteractionRoutingEvidenceVaultV1,
  workspaceRecheckTimers: LifecycleTimerScope,
): Promise<void> {
  const results = await Promise.allSettled([
    injectionFiber.dispose(),
    Promise.all([...tasks]),
    sink.drain(),
    vault.close(),
  ])
  const timerResults = await Promise.allSettled([workspaceRecheckTimers.dispose()])
  const errors = [...results, ...timerResults]
    .flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Capability Gap Routing evidence cleanup failed')
  }
}

function safelyDispose(dispose: () => unknown): void {
  try {
    void dispose()
  } catch {
    // The final resource close still runs; listener disposers are synchronous.
  }
}

function safelyWarn(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    // Diagnostic failure cannot reopen or authenticate a failed producer.
  }
}

function exactNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
    ? value
    : undefined
}

function epoch(): string {
  return randomBytes(32).toString('hex')
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value
  const object = value as object
  if (seen.has(object)) return value
  seen.add(object)
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen)
    }
  }
  return Object.freeze(value)
}

function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return String(error.message)
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}
