import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { installGenerationBinder } from './generation-binder.ts'
import {
  compileInteractionGenerationEvidencePolicies,
  createInteractionGenerationEvidenceSink,
  INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES,
  INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
  openInteractionGenerationEvidenceVault,
  type InteractionGenerationEvidencePolicyConfig,
} from './interaction-generation-evidence.ts'
import {
  compileInteractionRoutingEvidencePolicies,
  INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES,
  INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE,
  type InteractionRoutingEvidencePolicyConfig,
} from './interaction-routing-evidence.ts'
import { NATIVE_WORKSPACE_ID_PATTERN } from './workspace-identity.ts'
import { CapabilityMap, installCapabilityMapObserver } from './capability-map.ts'
import { openCapabilityGapStore } from './capability-gap-store.ts'
import { installCapabilityGapRoutingEvidenceV1 } from './capability-gap-routing-evidence.ts'
import { ExperienceDrivenSkillOpportunityDiscovery } from './skill-opportunity-discovery.ts'
import {
  SkillCandidateRepository,
  openSkillCandidateStore,
} from './skill-candidate-repository.ts'
import {
  SkillCandidateAdmission,
  SkillCandidateAdmissionScheduler,
} from './skill-candidate-admission.ts'
import {
  SkillCandidateShadowLauncher,
  SkillCandidateShadowScheduler,
} from './skill-candidate-shadow.ts'
import { InternalSkillRetention } from './internal-skill-retention.ts'
import { FutureSessionPromotion } from './future-session-promotion.ts'
import { FutureSessionRollback } from './future-session-rollback.ts'
import { ExistingSkillFutureSessionRollback } from './existing-skill-future-session-rollback.ts'
import {
  CounterfactualCanary,
  CounterfactualCanaryScheduler,
} from './counterfactual-canary.ts'
import {
  SkillEvaluationEnvelopeResolver,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import { SkillEvaluationEvidenceVault } from './skill-evaluation-evidence-vault.ts'
import {
  SkillEvaluationGovernance,
  type SkillEvaluationGovernancePolicyConfig,
} from './skill-evaluation-governance.ts'
import { installEvolutionCommand } from './evolve-command.ts'
import { CandidatePublisher } from './candidate-publisher.ts'
import { GenerationBundleRepository } from './generation-bundle-repository.ts'
import { openEvolutionStore, type EvolutionStore } from './generation-store.ts'
import { ShadowSupervisor } from './shadow-supervisor.ts'
import { createShadowJobRunner } from './shadow-job-runner.ts'
import { runShadow } from './shadow.ts'
import { ReviewInbox } from './review-inbox.ts'
import { ResidentEvolutionControl } from './resident-evolution-control.ts'
import { VerifiedEvolutionStore } from './verified-evolution-store.ts'
import {
  installDeliveryOutcomeMonitor,
  openDeliveryOutcomeStore,
} from './delivery-outcome-monitor.ts'
import {
  installFeedbackSignalMonitor,
  openFeedbackSignalStore,
} from './feedback-signal-monitor.ts'
import {
  installSkillUseMonitor,
  openSkillUseStore,
} from './skill-use-monitor.ts'
import { ExactSkillOutcomeContextProjection } from './skill-outcome-context.ts'
import {
  LongTermEffectsProjection,
  openLongTermEffectsStore,
  type LongTermEffectsStore,
} from './long-term-effects.ts'
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
import { runWithLifecycleDeadline } from './lifecycle-deadline.ts'
import {
  interactionSessionPersistenceReadDialectV1,
  sessionPersistenceReadTimeoutMs,
} from './interaction-session-persistence-read.ts'
import { InstalledSkillBaselineVault } from './installed-skill-baseline.ts'
import { installInstalledSkillBaselineMonitor } from './installed-skill-baseline-monitor.ts'
import { ExistingSkillBaselineQualification } from './existing-skill-baseline-qualification.ts'
import { ExistingSkillEvaluationEvidenceVault } from './existing-skill-evaluation-evidence-vault.ts'
import { ExistingSkillCandidateAuthoring } from './existing-skill-candidate-authoring.ts'
import { ExistingSkillHoldoutGovernance } from './existing-skill-holdout-governance.ts'
import {
  ExistingSkillCandidateAdmission,
  ExistingSkillCandidateAdmissionScheduler,
} from './existing-skill-candidate-admission.ts'
import {
  ExistingSkillHoldoutEvaluation,
  ExistingSkillHoldoutEvaluationScheduler,
} from './existing-skill-holdout-evaluation.ts'
import {
  ExistingSkillRetentionEvaluation,
  ExistingSkillRetentionEvaluationScheduler,
} from './existing-skill-retention-evaluation.ts'
import {
  ExistingSkillAutomaticPromotionScheduler,
  ExistingSkillRelease,
  type ExistingSkillAutomaticPromotionPolicy,
  openExistingSkillReleaseStore,
} from './existing-skill-release.ts'
import {
  ExistingSkillCounterfactualCanary,
  ExistingSkillCounterfactualCanaryScheduler,
} from './existing-skill-counterfactual-canary.ts'
import { EvolutionControlPlane } from './evolution-control-plane.ts'
import { EvolutionRemoteService } from './evolution-remote.ts'
import { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import {
  assertSlowLoopSkillAuthoringRootSeparation,
  SlowLoopSkillAuthoring,
  type SkillOpportunityAuthoringPolicyConfig,
} from './slow-loop-skill-authoring.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    'evoforge.evolution': EvolutionStore
    'evoforge.longTermEffects': LongTermEffectsStore
  }
  interface Events {
    /** Host-only wakeup after the resident evaluation scan has settled. */
    'evoforge/evolution/settled'(): void
    /** Optional terminal Gateway observation; body and credentials are never included. */
    'evoforge/gateway/outbound'(observation: {
      readonly workspaceId: string
      readonly recordId: string
      readonly routeId: string
      readonly adapter: string
      readonly intentKeyHash: string
      readonly operationKeyHash: string
      readonly status: 'applied' | 'unknown'
      readonly attempts: number
      readonly observedAt: number
    }): void
    /** Startup observation for exact Gateway journal recovery after interruption. */
    'evoforge/gateway/recovery'(observation: {
      readonly workspaceId: string
      readonly ingressRecovered: number
      readonly outboundRecovered: number
      readonly observedAt: number
    }): void
  }
}

export const name = 'dsh-evolve'
export const inject = ['agents', 'sessions', 'storageDomain', 'workspaceRegistry']

/**
 * Public deployment policy. It deliberately contains no Skill source, target,
 * repository, Case Pack, or promotion allowlist selected by an operator.
 */
export interface Config {
  /** Private content-addressed materialization root for internally authored Generations. */
  cacheRoot?: string
  selfDiscoveryPolicies?: SkillOpportunityAuthoringPolicyConfig[]
  candidateEvaluationPolicies?: SkillCandidateEvaluationPolicyConfig[]
  /** Host-admin authorization to retain raw-free Generation receipts for exact Workspaces. */
  interactionEvidencePolicies?: InteractionGenerationEvidencePolicyConfig[]
  /** Independent Host-admin authorization to retain raw-free Routing receipts. */
  interactionRoutingEvidencePolicies?: InteractionRoutingEvidencePolicyConfig[]
  /** Workspace-only authority for exact low-risk existing-Skill instruction promotion. */
  automaticPromotionPolicies?: ExistingSkillAutomaticPromotionPolicy[]
  supervisor?: {
    runRoots: Array<{ workspaceId: string; path: string }>
    scanIntervalMs?: number
  }
}

const interactionEvidencePoliciesConfig = z.transform(
  z.array(z.object({
    workspaceId: z.string().pattern(NATIVE_WORKSPACE_ID_PATTERN).required(),
    retention: z.object({
      generationMaxRecords: z.number().step(1).min(1)
        .max(INTERACTION_GENERATION_EVIDENCE_MAX_RECORDS_PER_WORKSPACE)
        .required(),
    }).required(),
  })).max(INTERACTION_GENERATION_EVIDENCE_MAX_POLICIES).default([]),
  (policies) => {
    const exact = policies as InteractionGenerationEvidencePolicyConfig[]
    compileInteractionGenerationEvidencePolicies(exact)
    return exact
  },
  true,
).default([])

const interactionRoutingEvidencePoliciesConfig = z.transform(
  z.array(z.object({
    workspaceId: z.string().pattern(NATIVE_WORKSPACE_ID_PATTERN).required(),
    retention: z.object({
      routingMaxRecords: z.number().step(1).min(1)
        .max(INTERACTION_ROUTING_EVIDENCE_MAX_RECORDS_PER_WORKSPACE)
        .required(),
    }).required(),
  })).max(INTERACTION_ROUTING_EVIDENCE_MAX_POLICIES).default([]),
  (policies) => {
    const exact = policies as InteractionRoutingEvidencePolicyConfig[]
    compileInteractionRoutingEvidencePolicies(exact)
    return exact
  },
  true,
).default([])

export const Config: Schema<Config> = z.object({
  cacheRoot: z.string(),
  selfDiscoveryPolicies: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
    runRoot: z.string().required(),
    maxAttemptsPerUtcDay: z.number().step(1).min(1).max(20).default(1),
  })).max(20).default([]),
  candidateEvaluationPolicies: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
    governanceRoot: z.string().required(),
    runRoot: z.string().required(),
    dshRevision: z.string(),
    maxAttemptsPerUtcDay: z.number().step(1).min(1).max(20).default(1),
  })).max(100).default([]),
  interactionEvidencePolicies: interactionEvidencePoliciesConfig,
  interactionRoutingEvidencePolicies: interactionRoutingEvidencePoliciesConfig,
  automaticPromotionPolicies: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
  })).max(100).default([]),
  supervisor: z.object({
    runRoots: z.array(z.object({
      workspaceId: z.string().required(),
      path: z.string().required(),
    })).default([]),
    scanIntervalMs: z.number().step(1).min(1_000).default(30_000),
  }),
})

type RuntimeOwnershipPhase = 'producer' | 'revocation' | 'resource'
type RuntimeCloser = () => void | Promise<void>

/**
 * Own every manually opened runtime resource from the first acquisition.
 * Producers are synchronously asked to quiesce before the evidence authority
 * is revoked; storage closes only after both phases have settled. Every closer
 * is attempted even when a sibling fails.
 */
class RuntimeOwnership {
  private readonly closers: Record<RuntimeOwnershipPhase, RuntimeCloser[]> = {
    producer: [],
    revocation: [],
    resource: [],
  }
  private closing: Promise<void> | undefined

  own(phase: RuntimeOwnershipPhase, closer: RuntimeCloser): void {
    if (this.closing !== undefined) throw new Error('dsh-evolve runtime is closing')
    this.closers[phase].push(closer)
  }

  close(): Promise<void> {
    this.closing ??= this.closeNow()
    return this.closing
  }

  private async closeNow(): Promise<void> {
    const errors: unknown[] = []
    // Invoking the complete producer phase is synchronous. In particular, the
    // Generation binder flips its closing gate and removes listeners before
    // the vault close below can revoke positive reads and wait for accepted writes.
    const producerTasks = invokeRuntimeClosers(this.closers.producer)
    const revocationTasks = invokeRuntimeClosers(this.closers.revocation)
    collectRuntimeCloseErrors(await Promise.allSettled([
      ...producerTasks,
      ...revocationTasks,
    ]), errors)
    collectRuntimeCloseErrors(await Promise.allSettled(
      invokeRuntimeClosers(this.closers.resource),
    ), errors)
    throwRuntimeCloseErrors(errors)
  }
}

function invokeRuntimeClosers(closers: readonly RuntimeCloser[]): Promise<void>[] {
  return [...closers].reverse().map((closer) => {
    try {
      return Promise.resolve(closer())
    } catch (error) {
      return Promise.reject(error)
    }
  })
}

function collectRuntimeCloseErrors(
  results: readonly PromiseSettledResult<void>[],
  errors: unknown[],
): void {
  for (const result of results) {
    if (result.status === 'rejected') errors.push(result.reason)
  }
}

function throwRuntimeCloseErrors(errors: readonly unknown[]): void {
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'dsh-evolve runtime cleanup failed')
  }
}

type RuntimeCallable = (...args: never[]) => unknown

function requiredCallable(receiver: object, key: string, label: string): RuntimeCallable {
  let cursor: object | null = receiver
  const visited = new Set<object>()
  try {
    while (cursor !== null) {
      if (visited.has(cursor)) throw new TypeError('cyclic prototype chain')
      visited.add(cursor)
      const descriptor = Reflect.getOwnPropertyDescriptor(cursor, key)
      if (descriptor !== undefined) {
        if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
          throw new TypeError('method is not a data function')
        }
        return descriptor.value as RuntimeCallable
      }
      cursor = Reflect.getPrototypeOf(cursor)
    }
  } catch {
    throw new Error(`${label} has no safe '${key}' method`)
  }
  throw new Error(`${label} has no safe '${key}' method`)
}

function plainRuntimeRecord(candidate: unknown): Readonly<Record<string, unknown>> | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
  let descriptors: Record<PropertyKey, PropertyDescriptor | undefined>
  try {
    const prototype = Reflect.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) return undefined
    descriptors = Object.getOwnPropertyDescriptors(candidate)
  } catch {
    return undefined
  }
  const record: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]
    if (typeof key !== 'string' || descriptor === undefined || !('value' in descriptor)) return undefined
    record[key] = descriptor.value
  }
  return record
}

function currentMessageFeedbackItems(candidate: unknown): readonly unknown[] {
  const result = plainRuntimeRecord(candidate)
  const value = plainRuntimeRecord(result?.value)
  if (result?.ok !== true || !Array.isArray(value?.items)) {
    throw new Error('current message feedback reconciliation failed')
  }
  try {
    return structuredClone(value.items)
  } catch {
    throw new Error('current message feedback reconciliation returned unclonable items')
  }
}

function currentPersistenceSessionIds(candidate: unknown): readonly string[] {
  if (!Array.isArray(candidate)) throw new Error('current Session catalog is malformed')
  const sessionIds = new Set<string>()
  for (const item of candidate) {
    const snapshot = plainRuntimeRecord(item)
    const header = plainRuntimeRecord(snapshot?.header)
    const id = header?.id
    if (typeof id !== 'string' || id.length === 0 || sessionIds.has(id)
      || typeof snapshot?.revision !== 'string'
      || [snapshot.eventCount, snapshot.sizeBytes].some(value => value !== undefined
        && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0))) {
      throw new Error('current Session catalog is malformed')
    }
    sessionIds.add(id)
  }
  return [...sessionIds].sort((left, right) => left.localeCompare(right))
}

async function disposeRuntimeGroup(
  resources: readonly { dispose(): Promise<void> }[],
): Promise<void> {
  const errors: unknown[] = []
  collectRuntimeCloseErrors(await Promise.allSettled(
    invokeRuntimeClosers(resources.map(resource => () => resource.dispose())),
  ), errors)
  throwRuntimeCloseErrors(errors)
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const runtime = new RuntimeOwnership()
  let runtimeCommitted = false
  // The early owner rolls back partial acquisition when apply rejects.
  ctx.effect(() => () => runtimeCommitted ? undefined : runtime.close(), 'dsh-evolve.runtimeRollback')
  const interactionEvidenceAuthority = compileInteractionGenerationEvidencePolicies(
    config.interactionEvidencePolicies ?? [],
  )
  const source = new GenerationBundleRepository(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'generation-cache'),
  )
  const evolutionStore = await openEvolutionStore(ctx.storageDomain)
  runtime.own('resource', () => evolutionStore.close())
  const store = new VerifiedEvolutionStore(evolutionStore, source)
  const interactionGenerationEvidence = await openInteractionGenerationEvidenceVault(
    ctx.storageDomain,
    { authority: interactionEvidenceAuthority },
  )
  runtime.own('revocation', () => interactionGenerationEvidence.close())
  const deliveryOutcomes = await openDeliveryOutcomeStore(ctx.storageDomain)
  runtime.own('resource', () => deliveryOutcomes.close())
  const retainedFeedbackSignals = await openFeedbackSignalStore(ctx.storageDomain)
  runtime.own('resource', () => retainedFeedbackSignals.close())
  let feedbackProjectionReady = false
  let feedbackProviderGeneration: symbol | undefined
  // Persisted projections cannot authorize feedback-derived work until the
  // current provider generation has rebuilt its durable source catalog.
  const feedbackSignals: typeof retainedFeedbackSignals = {
    replaceSession: (...args) => retainedFeedbackSignals.replaceSession(...args),
    removeSession: (...args) => retainedFeedbackSignals.removeSession(...args),
    get: (...args) => feedbackProjectionReady ? retainedFeedbackSignals.get(...args) : undefined,
    list: (...args) => feedbackProjectionReady ? retainedFeedbackSignals.list(...args) : [],
    summarize: (...args) => feedbackProjectionReady
      ? retainedFeedbackSignals.summarize(...args)
      : { all: 0, selected: 0 },
    close: () => retainedFeedbackSignals.close(),
  }
  const skillUses = await openSkillUseStore(ctx.storageDomain)
  runtime.own('resource', () => skillUses.close())
  const longTermEffects = await openLongTermEffectsStore(ctx.storageDomain)
  runtime.own('resource', () => longTermEffects.close())
  const skillOutcomeContext = new ExactSkillOutcomeContextProjection(skillUses, deliveryOutcomes)
  const capabilityGaps = await openCapabilityGapStore(ctx.storageDomain)
  runtime.own('resource', () => capabilityGaps.close())
  const skillOpportunities = new ExperienceDrivenSkillOpportunityDiscovery(capabilityGaps, {
    feedback: feedbackSignals,
    outcomes: deliveryOutcomes,
  })
  const skillCandidateStore = await openSkillCandidateStore(ctx.storageDomain)
  runtime.own('resource', () => skillCandidateStore.close())
  const existingSkillReleaseStore = await openExistingSkillReleaseStore(ctx.storageDomain)
  runtime.own('resource', () => existingSkillReleaseStore.close())
  let reconcileExistingSkillCandidates: ((workspaceId: string) => void) | undefined
  const feedbackMonitors = new Set<ReturnType<typeof installFeedbackSignalMonitor>>()
  runtime.own('producer', async () => {
    await disposeRuntimeGroup([...feedbackMonitors])
  })
  let counterfactualCanaryScheduler: CounterfactualCanaryScheduler | undefined
  let existingSkillCounterfactualCanaryScheduler: ExistingSkillCounterfactualCanaryScheduler | undefined
  const deliveryMonitor = installDeliveryOutcomeMonitor(ctx, deliveryOutcomes, store, {
    onOutcome: outcome => {
      if (outcome.status === 'failed') {
        counterfactualCanaryScheduler?.observe(outcome.workspaceId)
        existingSkillCounterfactualCanaryScheduler?.observe(outcome.workspaceId)
      }
    },
  })
  runtime.own('producer', () => deliveryMonitor.dispose())
  const candidateEvaluationPolicies = config.candidateEvaluationPolicies ?? []
  const selfDiscoveryPolicies = config.selfDiscoveryPolicies ?? []
  const automaticPromotionPolicies = config.automaticPromotionPolicies ?? []
  if (selfDiscoveryPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId))) {
    throw new Error('internal Skill authoring requires an evaluation governance policy for every Workspace')
  }
  if (selfDiscoveryPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId && evaluation.dshRevision !== undefined))) {
    throw new Error('internal Skill authoring requires an exact DSH revision for autonomous evaluation governance')
  }
  if (automaticPromotionPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId && evaluation.dshRevision !== undefined))) {
    throw new Error('automatic existing Skill promotion requires exact evaluation governance for every Workspace')
  }
  const resident = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : new ResidentEvolutionControl(store)
  if (automaticPromotionPolicies.length > 0 && resident === undefined) {
    throw new Error('automatic existing Skill promotion requires the durable resident pause authority')
  }
  const skillEvaluationEvidence = new SkillEvaluationEvidenceVault(
    candidateEvaluationPolicies,
    capabilityGaps,
  )
  const evaluationGovernancePolicies: SkillEvaluationGovernancePolicyConfig[] =
    candidateEvaluationPolicies.flatMap(policy => policy.dshRevision === undefined
      ? []
      : [{
          ...policy,
          dshRevision: policy.dshRevision,
          maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay ?? 1,
        }])
  const skillEvaluationGovernance = evaluationGovernancePolicies.length === 0
    ? undefined
    : new SkillEvaluationGovernance({
        policies: evaluationGovernancePolicies,
        evidence: skillEvaluationEvidence,
        budget: new AutomaticEvolutionBudget(),
      })

  ctx.provide('evoforge.evolution', store)
  ctx.provide('evoforge.longTermEffects', longTermEffects)
  const recordGatewayRecovery = (observation: {
    readonly workspaceId: string
    readonly ingressRecovered: number
    readonly outboundRecovered: number
    readonly observedAt: number
  }): void => {
    if (observation.ingressRecovered === 0 && observation.outboundRecovered === 0) return
    void longTermEffects.record({
      kind: 'recovery',
      workspaceId: observation.workspaceId,
      observedAt: observation.observedAt,
      trigger: 'restart',
      result: 'recovered',
      evidenceId: `gateway-recovery:${observation.observedAt}:${observation.ingressRecovered}:${observation.outboundRecovered}`,
    }).catch(error => {
      ctx.logger.warn(`dsh-evolve could not retain Gateway recovery observation: ${String(error)}`)
    })
  }
  ctx.on('evoforge/gateway/outbound', observation => {
    void longTermEffects.record({
      kind: 'external-effect',
      workspaceId: observation.workspaceId,
      observedAt: observation.observedAt,
      adapter: observation.adapter === 'feishu' ? 'dsh-feishu' : 'other',
      operationKeyHash: observation.operationKeyHash,
      idempotencyKeyHash: observation.intentKeyHash,
      result: observation.status,
      evidenceId: observation.recordId,
    }).catch(error => {
      ctx.logger.warn(`dsh-evolve could not retain Gateway long-term observation: ${String(error)}`)
    })
  })
  ctx.on('evoforge/gateway/recovery', recordGatewayRecovery)
  const gateway = ctx.get('evoforge.gateway' as never) as {
    recoveryObservations?: () => readonly {
      readonly workspaceId: string
      readonly ingressRecovered: number
      readonly outboundRecovered: number
      readonly observedAt: number
    }[]
  } | undefined
  for (const observation of gateway?.recoveryObservations?.() ?? []) recordGatewayRecovery(observation)
  const disposeBinder = installGenerationBinder(
    ctx,
    store,
    source,
    createInteractionGenerationEvidenceSink(interactionGenerationEvidence),
  )
  runtime.own('producer', disposeBinder)
  const skillUseMonitor = installSkillUseMonitor(ctx, skillUses, store)
  runtime.own('producer', () => skillUseMonitor.dispose())
  const capabilities = new CapabilityMap()
  const capabilityMonitors = new Set<ReturnType<typeof installCapabilityMapObserver>>()
  const installedBaselineMonitors = new Set<ReturnType<typeof installInstalledSkillBaselineMonitor>>()
  runtime.own('producer', () => disposeRuntimeGroup([...capabilityMonitors]))
  runtime.own('producer', () => disposeRuntimeGroup([...installedBaselineMonitors]))
  let existingSkillBaselineQualification: ExistingSkillBaselineQualification | undefined
  let existingSkillBaselineVault: InstalledSkillBaselineVault | undefined
  let existingSkillEvaluationEvidence: ExistingSkillEvaluationEvidenceVault | undefined
  let existingSkillAdmissionScheduler: ExistingSkillCandidateAdmissionScheduler | undefined
  let existingSkillHoldoutEvaluationScheduler: ExistingSkillHoldoutEvaluationScheduler | undefined
  let existingSkillRetentionEvaluationScheduler: ExistingSkillRetentionEvaluationScheduler | undefined
  const existingSkillHoldoutGovernance = evaluationGovernancePolicies.length === 0
    ? undefined
    : new ExistingSkillHoldoutGovernance({
        policies: evaluationGovernancePolicies,
        evidence: {
          readForGovernance: (workspaceId, opportunityId, qualificationId, evidenceId) => {
            if (existingSkillEvaluationEvidence === undefined) {
              return Promise.reject(new Error('existing Skill protected evidence is unavailable'))
            }
            return existingSkillEvaluationEvidence.readForGovernance(
              workspaceId,
              opportunityId,
              qualificationId,
              evidenceId,
            )
          },
        },
        budget: new AutomaticEvolutionBudget(),
      })
  ctx.inject(['skills'], (skillCtx) => {
    const monitor = installCapabilityMapObserver(skillCtx, capabilities, store)
    capabilityMonitors.add(monitor)
    const baselineVault = candidateEvaluationPolicies.length === 0
      ? undefined
      : new InstalledSkillBaselineVault(
          candidateEvaluationPolicies.map(policy => ({
            workspaceId: policy.workspaceId,
            governanceRoot: policy.governanceRoot,
          })),
          skillCtx.skills,
        )
    const baselineQualification = baselineVault === undefined
      ? undefined
      : new ExistingSkillBaselineQualification(skillOpportunities, feedbackSignals, baselineVault)
    existingSkillBaselineQualification = baselineQualification
    for (const policy of candidateEvaluationPolicies) {
      reconcileExistingSkillCandidates?.(policy.workspaceId)
    }
    const baselineMonitor = baselineVault === undefined
      ? undefined
      : installInstalledSkillBaselineMonitor(skillCtx, baselineVault)
    if (baselineMonitor !== undefined) installedBaselineMonitors.add(baselineMonitor)
    skillCtx.effect(() => async () => {
      await baselineMonitor?.dispose()
      if (baselineMonitor !== undefined) installedBaselineMonitors.delete(baselineMonitor)
      if (existingSkillBaselineQualification === baselineQualification) {
        existingSkillBaselineQualification = undefined
      }
      await monitor.dispose()
      capabilityMonitors.delete(monitor)
    }, 'dsh-evolve.skillObservation')
  })
  if (candidateEvaluationPolicies.length > 0) {
    ctx.inject(['skills', 'messageFeedback', 'sessionPersistence'], (evidenceCtx) => {
      const baselineVault = new InstalledSkillBaselineVault(
        candidateEvaluationPolicies.map(policy => ({
          workspaceId: policy.workspaceId,
          governanceRoot: policy.governanceRoot,
        })),
        evidenceCtx.skills,
      )
      const qualification = new ExistingSkillBaselineQualification(
        skillOpportunities,
        feedbackSignals,
        baselineVault,
      )
      const evidenceReadTimeoutMs = sessionPersistenceReadTimeoutMs(undefined)
      const evidencePersistenceDialect = interactionSessionPersistenceReadDialectV1(
        evidenceCtx.sessionPersistence,
      )
      const evidence = new ExistingSkillEvaluationEvidenceVault(
        candidateEvaluationPolicies,
        qualification,
        feedbackSignals,
        {
          list: request => runWithLifecycleDeadline(
            evidenceCtx,
            () => evidenceCtx.messageFeedback.list(request),
            {
              timeoutMs: evidenceReadTimeoutMs,
              label: 'dsh-evolve.existingSkillEvidence.messageFeedbackRead',
              timeoutMessage: 'Existing-Skill feedback evidence read timed out',
            },
          ),
        },
        new DurableFeedbackAttribution(evidenceCtx.sessionPersistence, {
          lifecycle: evidenceCtx,
        }),
        { persistenceDialect: evidencePersistenceDialect },
      )
      evidenceCtx.effect(() => {
        existingSkillBaselineVault = baselineVault
        existingSkillEvaluationEvidence = evidence
        for (const policy of candidateEvaluationPolicies) {
          reconcileExistingSkillCandidates?.(policy.workspaceId)
          existingSkillAdmissionScheduler?.reconcile(policy.workspaceId)
        }
        return () => {
          if (existingSkillBaselineVault === baselineVault) existingSkillBaselineVault = undefined
          if (existingSkillEvaluationEvidence === evidence) {
            existingSkillEvaluationEvidence = undefined
          }
        }
      }, 'dsh-evolve.existingSkillEvaluationEvidence')
    })
  }

  let skillAdmissionScheduler: SkillCandidateAdmissionScheduler | undefined
  let skillShadowScheduler: SkillCandidateShadowScheduler | undefined
  let skillRetention: InternalSkillRetention | undefined
  const skillCandidates = new SkillCandidateRepository(
    skillCandidateStore,
    candidate => skillAdmissionScheduler?.observe(candidate),
    candidateEvaluationPolicies.map(policy => ({
      workspaceId: policy.workspaceId,
      root: resolve(policy.governanceRoot, 'candidate-vault'),
    })),
    candidate => existingSkillAdmissionScheduler?.observe(candidate),
  )
  const existingSkillAdmission = candidateEvaluationPolicies.length === 0
    ? undefined
    : new ExistingSkillCandidateAdmission({
        policies: candidateEvaluationPolicies,
        baselines: {
          resolveBaseline: (workspaceId, baselineId) => {
            if (existingSkillBaselineVault === undefined) {
              return Promise.reject(new Error('existing Skill baseline vault is unavailable'))
            }
            return existingSkillBaselineVault.resolveBaseline(workspaceId, baselineId)
          },
        },
        candidates: skillCandidates,
        evidence: {
          readForGovernance: (workspaceId, opportunityId, qualificationId, evidenceId) => {
            if (existingSkillEvaluationEvidence === undefined) {
              return Promise.reject(new Error('existing Skill protected evidence is unavailable'))
            }
            return existingSkillEvaluationEvidence.readForGovernance(
              workspaceId,
              opportunityId,
              qualificationId,
              evidenceId,
            )
          },
        },
      })
  const existingSkillHoldoutEvaluation = evaluationGovernancePolicies.length === 0
    || existingSkillAdmission === undefined
    || existingSkillHoldoutGovernance === undefined
    ? undefined
    : new ExistingSkillHoldoutEvaluation({
        policies: evaluationGovernancePolicies,
        baselines: {
          resolveBaseline: (workspaceId, baselineId) => {
            if (existingSkillBaselineVault === undefined) {
              return Promise.reject(new Error('existing Skill baseline vault is unavailable'))
            }
            return existingSkillBaselineVault.resolveBaseline(workspaceId, baselineId)
          },
        },
        candidates: skillCandidates,
        governance: existingSkillHoldoutGovernance,
      })
  const existingSkillRetentionEvaluation = existingSkillHoldoutEvaluation === undefined
    || existingSkillHoldoutGovernance === undefined
    ? undefined
    : new ExistingSkillRetentionEvaluation({
        policies: evaluationGovernancePolicies,
        baselines: {
          resolveBaseline: (workspaceId, baselineId) => {
            if (existingSkillBaselineVault === undefined) {
              return Promise.reject(new Error('existing Skill baseline vault is unavailable'))
            }
            return existingSkillBaselineVault.resolveBaseline(workspaceId, baselineId)
          },
        },
        candidates: skillCandidates,
        governance: existingSkillHoldoutGovernance,
        holdouts: existingSkillHoldoutEvaluation,
      })
  const existingSkillRelease = existingSkillAdmission === undefined
    || existingSkillHoldoutEvaluation === undefined
    || existingSkillRetentionEvaluation === undefined
    ? undefined
    : new ExistingSkillRelease({
        candidates: {
          listExistingCandidates: workspaceId =>
            skillCandidateStore.listExistingCandidates(workspaceId),
          resolveExistingBundle: candidate => skillCandidates.resolveExistingBundle(candidate),
        },
        admissions: existingSkillAdmission,
        holdouts: existingSkillHoldoutEvaluation,
        retentions: existingSkillRetentionEvaluation,
        decisions: existingSkillReleaseStore,
        store,
        bundles: source,
        baselines: {
          resolveBaseline: (workspaceId, baselineId) => {
            if (existingSkillBaselineVault === undefined) {
              return Promise.reject(new Error('existing Skill baseline vault is unavailable'))
            }
            return existingSkillBaselineVault.resolveBaseline(workspaceId, baselineId)
          },
        },
        automaticPromotionPolicies,
        isPaused: workspaceId => resident?.isPaused(workspaceId) ?? true,
      })
  const existingSkillAutomaticPromotionScheduler = existingSkillRelease === undefined
    || automaticPromotionPolicies.length === 0
    ? undefined
    : new ExistingSkillAutomaticPromotionScheduler(
        existingSkillRelease,
        automaticPromotionPolicies.map(policy => policy.workspaceId),
      )
  const existingSkillCounterfactualCanary = existingSkillRelease === undefined
    || existingSkillRetentionEvaluation === undefined
    ? undefined
    : new ExistingSkillCounterfactualCanary({
        store,
        outcomes: deliveryOutcomes,
        releases: existingSkillRelease,
        candidates: skillCandidateStore,
        retention: existingSkillRetentionEvaluation,
        budget: new AutomaticEvolutionBudget(),
      }, {
        policies: evaluationGovernancePolicies.map(policy => ({
          ...policy,
          maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay ?? 1,
        })),
      })
  existingSkillCounterfactualCanaryScheduler = existingSkillCounterfactualCanary === undefined
    ? undefined
    : new ExistingSkillCounterfactualCanaryScheduler(
        existingSkillCounterfactualCanary,
        evaluationGovernancePolicies.map(policy => policy.workspaceId),
      )
  existingSkillRetentionEvaluationScheduler = existingSkillRetentionEvaluation === undefined
    ? undefined
    : new ExistingSkillRetentionEvaluationScheduler(
        existingSkillRetentionEvaluation,
        { listExistingCandidates: workspaceId => skillCandidateStore.listExistingCandidates(workspaceId) },
        existingSkillHoldoutEvaluation!,
        {
          onResult: candidate =>
            existingSkillAutomaticPromotionScheduler?.observe(candidate.workspaceId),
        },
      )
  existingSkillHoldoutEvaluationScheduler = existingSkillHoldoutEvaluation === undefined
    ? undefined
    : new ExistingSkillHoldoutEvaluationScheduler(
        existingSkillHoldoutEvaluation,
        { listExistingCandidates: workspaceId => skillCandidateStore.listExistingCandidates(workspaceId) },
        existingSkillAdmission!,
        {
          onResult: (candidate, result) =>
            existingSkillRetentionEvaluationScheduler?.observe(candidate, result),
        },
      )
  existingSkillAdmissionScheduler = existingSkillAdmission === undefined
    ? undefined
    : new ExistingSkillCandidateAdmissionScheduler(
        existingSkillAdmission,
        { listExistingCandidates: workspaceId => skillCandidateStore.listExistingCandidates(workspaceId) },
        {
          onResult: (candidate, result) =>
            existingSkillHoldoutEvaluationScheduler?.observe(candidate, result),
        },
      )
  let skillAdmission: SkillCandidateAdmission | undefined
  if (candidateEvaluationPolicies.length > 0) {
    if (config.supervisor === undefined || config.supervisor.runRoots.length === 0) {
      throw new Error('Skill Candidate evaluation policies require configured supervisor.runRoots')
    }
    if (candidateEvaluationPolicies.some(policy => !config.supervisor!.runRoots.some(root =>
      root.workspaceId === policy.workspaceId
      && resolve(root.path) === resolve(policy.runRoot, 'shadow')))) {
      throw new Error('Skill Candidate evaluation Shadow roots must be exact review supervisor roots')
    }
    const evaluationEnvelopes = new SkillEvaluationEnvelopeResolver(
      candidateEvaluationPolicies,
      skillOpportunities,
      skillEvaluationEvidence,
      skillEvaluationGovernance,
    )
    skillAdmission = new SkillCandidateAdmission(evaluationEnvelopes, skillCandidates)
    skillRetention = new InternalSkillRetention(skillAdmission, {
      runRoots: candidateEvaluationPolicies.map(policy => ({
        workspaceId: policy.workspaceId,
        path: resolve(policy.runRoot, 'retention'),
      })),
    })
    skillShadowScheduler = new SkillCandidateShadowScheduler(
      new SkillCandidateShadowLauncher(skillAdmission, {
        retention: skillRetention,
      }),
    )
    skillAdmissionScheduler = new SkillCandidateAdmissionScheduler(
      skillAdmission,
      { listCandidates: workspaceId => skillCandidateStore.listCandidates(workspaceId) },
      { onResult: (candidate, result) => skillShadowScheduler?.observe(candidate, result) },
    )
  }

  if (selfDiscoveryPolicies.length > 0) {
    assertSlowLoopSkillAuthoringRootSeparation(selfDiscoveryPolicies, [
      ...(config.cacheRoot === undefined ? [] : [config.cacheRoot]),
      ...candidateEvaluationPolicies.flatMap(value => [value.governanceRoot, value.runRoot]),
      ...(config.supervisor?.runRoots ?? []).map(value => value.path),
    ])
  }
  const slowLoopAuthoring = selfDiscoveryPolicies.length === 0
    ? undefined
    : new SlowLoopSkillAuthoring({
        policies: selfDiscoveryPolicies,
        opportunities: skillOpportunities,
        evaluationEvidence: skillEvaluationEvidence,
        candidates: {
          listCandidates: (workspaceId, opportunityId) =>
            skillCandidateStore.listCandidates(workspaceId, opportunityId),
          quarantine: input => skillCandidates.quarantine(input),
        },
        budget: new AutomaticEvolutionBudget(),
      })
  const existingSkillAuthoring = selfDiscoveryPolicies.length === 0
    ? undefined
    : new ExistingSkillCandidateAuthoring({
        policies: selfDiscoveryPolicies,
        opportunities: skillOpportunities,
        qualification: {
          qualify: opportunity => {
            const qualification = existingSkillBaselineQualification
            if (qualification === undefined) {
              return Promise.reject(new Error('existing Skill baseline qualification is unavailable'))
            }
            return qualification.qualify(opportunity)
          },
        },
        evaluationEvidence: {
          prepare: opportunity => {
            const evidence = existingSkillEvaluationEvidence
            if (evidence === undefined) {
              return Promise.reject(new Error('existing Skill protected evidence is unavailable'))
            }
            return evidence.prepare(opportunity)
          },
        },
        holdoutGovernance: existingSkillHoldoutGovernance!,
        candidates: {
          listExistingCandidates: (workspaceId, opportunityId) =>
            skillCandidateStore.listExistingCandidates(workspaceId, opportunityId),
          quarantineExisting: input => skillCandidates.quarantineExisting(input),
        },
        budget: new AutomaticEvolutionBudget(),
      })
  reconcileExistingSkillCandidates = workspaceId => {
    void existingSkillAuthoring?.reconcile(workspaceId).then((result) => {
      for (const warning of result.warnings) {
        ctx.logger.warn(`dsh-evolve existing Skill Candidate authoring skipped work: ${warning}`)
      }
    }, error => {
      ctx.logger.warn(`dsh-evolve existing Skill Candidate authoring failed: ${String(error)}`)
    })
  }
  const reconcileSkillOpportunities = async (workspaceId: string): Promise<void> => {
    const result = await slowLoopAuthoring?.reconcile(workspaceId)
    for (const warning of result?.warnings ?? []) {
      ctx.logger.warn(`dsh-evolve internal Skill authoring skipped work: ${warning}`)
    }
  }
  const capabilityGapRoutingEvidence = await installCapabilityGapRoutingEvidenceV1(
    ctx,
    {
      gaps: capabilityGaps,
      capabilities,
      evolution: store,
    },
    {
      policies: config.interactionRoutingEvidencePolicies ?? [],
      // A no-Goal Interaction is a durable signal, not an authoring trigger.
      // The legacy slow loop remains strictly Goal-qualified until its
      // Interaction evidence contract is introduced in a new epoch.
      onGap: gap => gap.goal === undefined
        ? undefined
        : reconcileSkillOpportunities(gap.workspaceId),
    },
  )
  runtime.own('producer', () => capabilityGapRoutingEvidence.dispose())

  const review = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : {
        inbox: new ReviewInbox(config.supervisor.runRoots),
        publisher: new CandidatePublisher(store, source),
      }
  const promotion = review === undefined || skillRetention === undefined
    ? undefined
    : new FutureSessionPromotion({
        store,
        review: review.inbox,
        retention: skillRetention,
      })
  const counterfactualCanary = promotion === undefined
    || review === undefined
    || skillRetention === undefined
    || skillAdmission === undefined
    ? undefined
    : new CounterfactualCanary({
        store,
        outcomes: deliveryOutcomes,
        promotion,
        review: review.inbox,
        retention: skillRetention,
        candidates: skillCandidateStore,
        admissions: skillAdmission,
        budget: new AutomaticEvolutionBudget(),
      }, {
        policies: candidateEvaluationPolicies.map(policy => ({
          id: policy.id,
          workspaceId: policy.workspaceId,
          runRoot: resolve(policy.runRoot, 'canary'),
          maxAttemptsPerUtcDay: policy.maxAttemptsPerUtcDay ?? 1,
        })),
      })
  counterfactualCanaryScheduler = counterfactualCanary === undefined
    ? undefined
    : new CounterfactualCanaryScheduler(
        counterfactualCanary,
        candidateEvaluationPolicies.map(policy => policy.workspaceId),
      )
  const rollback = new FutureSessionRollback({
    store,
    ...(counterfactualCanary === undefined ? {} : { canary: counterfactualCanary }),
  })
  const existingSkillRollback = existingSkillCounterfactualCanary === undefined
    || existingSkillRelease === undefined
    ? undefined
    : new ExistingSkillFutureSessionRollback({
        store,
        canary: existingSkillCounterfactualCanary,
        releases: existingSkillRelease,
      })
  const control = new EvolutionControlPlane({
    store,
    rollback,
    ...(existingSkillRollback === undefined ? {} : { existingSkillRollback }),
    ...(promotion === undefined ? {} : { promotion }),
    capabilities,
    gaps: capabilityGaps,
    opportunities: skillOpportunities,
    improvementBaselines: {
      qualify: async opportunity => existingSkillBaselineQualification?.qualify(opportunity),
    },
    improvementEvidence: {
      readiness: async opportunity => existingSkillEvaluationEvidence?.readiness(opportunity),
    },
    evaluationEvidence: skillEvaluationEvidence,
    candidates: skillCandidateStore,
    ...(skillAdmission === undefined ? {} : { admissions: skillAdmission }),
    ...(skillRetention === undefined ? {} : { retention: skillRetention }),
    ...(counterfactualCanary === undefined ? {} : { counterfactualCanary }),
    ...(existingSkillCounterfactualCanary === undefined
      ? {}
      : { existingSkillCounterfactualCanary }),
    ...(slowLoopAuthoring === undefined ? {} : { slowLoopAuthoring }),
    ...(existingSkillAuthoring === undefined ? {} : { existingSkillAuthoring }),
    ...(existingSkillHoldoutGovernance === undefined ? {} : { existingSkillHoldoutGovernance }),
    ...(existingSkillAdmission === undefined ? {} : { existingSkillAdmissions: existingSkillAdmission }),
    ...(existingSkillHoldoutEvaluation === undefined
      ? {}
      : { existingSkillHoldoutEvaluations: existingSkillHoldoutEvaluation }),
    ...(existingSkillRetentionEvaluation === undefined
      ? {}
      : { existingSkillRetentionEvaluations: existingSkillRetentionEvaluation }),
    ...(existingSkillRelease === undefined ? {} : { existingSkillRelease }),
    ...(skillEvaluationGovernance === undefined ? {} : { evaluationGovernance: skillEvaluationGovernance }),
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    outcomes: deliveryOutcomes,
    skillUses,
    skillOutcomeContext,
    feedback: feedbackSignals,
    longTermEffects: new LongTermEffectsProjection(longTermEffects, store, {
      outcomes: deliveryOutcomes,
    }),
  })
  new EvolutionRemoteService(ctx, control)
  installEvolutionCommand(ctx, store, {
    ...(promotion === undefined ? {} : { promotion }),
    ...(existingSkillRelease === undefined ? {} : { existingRelease: existingSkillRelease }),
    rollback,
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    outcomes: deliveryOutcomes,
    skillUses,
    skillOutcomeContext,
    feedback: feedbackSignals,
  })
  ctx.inject(['messageFeedback', 'sessionPersistence', 'sessions'], (attributionCtx) => {
    const feedbackPersistenceTimeoutMs = sessionPersistenceReadTimeoutMs(undefined)
    const attribution = new DurableFeedbackAttribution(attributionCtx.sessionPersistence, {
      lifecycle: attributionCtx,
    })
    const messageFeedback = attributionCtx.messageFeedback as unknown as {
      list(request: { readonly sessionId: string }): Promise<unknown>
    }
    const sessions = attributionCtx.sessions as unknown as {
      get(sessionId: string): unknown
      flush(session: unknown): Promise<unknown>
    }
    const persistence = attributionCtx.sessionPersistence as unknown as {
      readFrom?: (...args: never[]) => unknown
      open?: (...args: never[]) => unknown
      list?: (...args: never[]) => unknown
      listSnapshots?: (...args: never[]) => unknown
    }
    const persistenceDialect = interactionSessionPersistenceReadDialectV1(persistence)
    const catalogList = persistenceDialect === 'current'
      ? requiredCallable(persistence, 'list', 'current Session persistence')
      : undefined
    let alpha5RecoveryRows = new Map<string, unknown>()
    const feedback = {
      dialect: persistenceDialect,
      list: (request: { readonly sessionId: string }) => runWithLifecycleDeadline(
        attributionCtx,
        () => messageFeedback.list(request),
        {
          timeoutMs: feedbackPersistenceTimeoutMs,
          label: 'dsh-evolve.feedbackSignal.messageFeedbackBarrier',
          timeoutMessage: 'Message feedback reconciliation timed out',
        },
      ),
      recoverLive: async (sessionId: string) => {
        const live = sessions.get(sessionId)
        if (live === undefined) return
        const participated = await runWithLifecycleDeadline(
          attributionCtx,
          () => sessions.flush(live),
          {
            timeoutMs: feedbackPersistenceTimeoutMs,
            label: 'dsh-evolve.feedbackSignal.liveSessionFlush',
            timeoutMessage: 'Live feedback Session flush timed out',
          },
        )
        if (participated !== true) {
          throw new Error('Live feedback Session has no durability participant')
        }
      },
      listSessionIds: async (): Promise<readonly string[] | undefined> => {
        if (persistenceDialect === 'alpha5') {
          const domain = attributionCtx.storageDomain.get('message_feedback')
          if (domain === undefined) {
            throw new Error('alpha.5 message feedback source domain is unavailable')
          }
          const rows = new Map<string, unknown>()
          for (const [sessionId, row] of domain.table('sessions').entries()) {
            if (typeof sessionId !== 'string' || sessionId.length === 0 || rows.has(sessionId)) {
              throw new Error('alpha.5 message feedback source catalog is malformed')
            }
            try {
              rows.set(sessionId, structuredClone(row))
            } catch {
              throw new Error('alpha.5 message feedback source catalog is unclonable')
            }
          }
          alpha5RecoveryRows = rows
          return [...rows.keys()].sort((left, right) => left.localeCompare(right))
        }
        if (catalogList === undefined) return undefined
        const controller = new AbortController()
        const listed = await runWithLifecycleDeadline(
          attributionCtx,
          () => Reflect.apply(catalogList, persistence, [
            persistenceDialect === 'current' ? { signal: controller.signal } : controller.signal,
          ]),
          {
            timeoutMs: feedbackPersistenceTimeoutMs,
            label: 'dsh-evolve.feedbackSignal.sessionCatalog',
            timeoutMessage: 'Current Session catalog read timed out',
            signal: controller.signal,
            onDeadline: () => { controller.abort() },
          },
        )
        return currentPersistenceSessionIds(listed)
      },
      alpha5SourceRow: (sessionId: string): unknown => {
        const row = alpha5RecoveryRows.get(sessionId)
        if (row === undefined) throw new Error('alpha.5 message feedback source row is unavailable')
        return structuredClone(row)
      },
    }
    // Each injected provider generation owns its listeners, immutable service
    // references and pending work. Revocation precedes draining that work.
    let active = true
    const providerGeneration = Symbol('feedback-provider-generation')
    feedbackProviderGeneration = providerGeneration
    feedbackProjectionReady = false
    const changedWorkspaces = new Set<string>()
    const recover = async (sessionId: string) => {
      if (feedback.dialect === 'current') {
        const listedItems = currentMessageFeedbackItems(await feedback.list({ sessionId }))
        await feedback.recoverLive(sessionId)
        const stored = await attribution.readStoredSession(sessionId)
        return { dialect: 'current' as const, stored, listedItems }
      }
      const sourceRow = feedback.alpha5SourceRow(sessionId)
      const source = plainRuntimeRecord(sourceRow)
      if (!Array.isArray(source?.items)) {
        throw new Error('alpha.5 message feedback recovery row is malformed')
      }
      const stored = await attribution.readStoredSession(sessionId)
      return {
        dialect: 'alpha5' as const,
        stored,
        listedItems: structuredClone(source.items),
        sourceRow,
      }
    }
    const monitor = installFeedbackSignalMonitor(attributionCtx, feedbackSignals, store, {
      attribution,
      isActive: () => active && feedbackProviderGeneration === providerGeneration,
      currentSession: {
        dialect: persistenceDialect,
        reconcile: recover,
        recover,
        listSessionIds: feedback.listSessionIds,
      },
      onSignalsChanged: workspaceId => {
        if (feedbackProjectionReady) reconcileExistingSkillCandidates?.(workspaceId)
        else changedWorkspaces.add(workspaceId)
      },
      onRecoveryReady: () => {
        if (!active || feedbackProviderGeneration !== providerGeneration) return
        feedbackProjectionReady = true
        for (const workspaceId of changedWorkspaces) reconcileExistingSkillCandidates?.(workspaceId)
        changedWorkspaces.clear()
      },
    })
    feedbackMonitors.add(monitor)
    attributionCtx.effect(() => () => {
      active = false
      if (feedbackProviderGeneration === providerGeneration) {
        feedbackProviderGeneration = undefined
        feedbackProjectionReady = false
      }
      return monitor.dispose().finally(() => { feedbackMonitors.delete(monitor) })
    }, 'dsh-evolve.durableFeedbackAttribution')
    void monitor.reconcileCurrent().catch(error => {
      if (active) attributionCtx.logger.warn(`dsh-evolve feedback recovery failed: ${String(error)}`)
    })
  })

  if (skillAdmissionScheduler !== undefined || skillShadowScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-skill-admission')
        const detachShadow = skillShadowScheduler?.attachJobs(jobCtx.jobs)
        const detachAdmission = skillAdmissionScheduler?.attachJobs(jobCtx.jobs)
        return () => {
          detachAdmission?.()
          detachShadow?.()
          detachController()
        }
      }, 'dsh-evolve.skillAdmissionJobs')
    })
  }
  if (slowLoopAuthoring !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-slow-loop-authoring')
        const detachAuthoring = slowLoopAuthoring.attachJobs(jobCtx.jobs)
        void slowLoopAuthoring.reconcile().then((result) => {
          for (const warning of result.warnings) {
            jobCtx.logger.warn(`dsh-evolve slow-loop Skill authoring skipped work: ${warning}`)
          }
        }, error => {
          jobCtx.logger.warn(`dsh-evolve slow-loop Skill authoring startup failed: ${String(error)}`)
        })
        return () => {
          detachAuthoring()
          detachController()
        }
      }, 'dsh-evolve.slowLoopAuthoringJobs')
    })
  }
  if (existingSkillAuthoring !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-authoring')
        const detachAuthoring = existingSkillAuthoring.attachJobs(jobCtx.jobs)
        void existingSkillAuthoring.reconcile().then((result) => {
          for (const warning of result.warnings) {
            jobCtx.logger.warn(`dsh-evolve existing Skill Candidate authoring skipped work: ${warning}`)
          }
        }, error => {
          jobCtx.logger.warn(`dsh-evolve existing Skill Candidate authoring startup failed: ${String(error)}`)
        })
        return () => {
          detachAuthoring()
          detachController()
        }
      }, 'dsh-evolve.existingSkillAuthoringJobs')
    })
  }
  if (existingSkillAdmissionScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-admission')
        const detachAdmission = existingSkillAdmissionScheduler!.attachJobs(jobCtx.jobs)
        return () => {
          detachAdmission()
          detachController()
        }
      }, 'dsh-evolve.existingSkillAdmissionJobs')
    })
  }
  if (existingSkillHoldoutEvaluationScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-holdout')
        const detachEvaluation = existingSkillHoldoutEvaluationScheduler!.attachJobs(jobCtx.jobs)
        return () => {
          detachEvaluation()
          detachController()
        }
      }, 'dsh-evolve.existingSkillHoldoutJobs')
    })
  }
  if (existingSkillRetentionEvaluationScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-retention')
        const detachEvaluation = existingSkillRetentionEvaluationScheduler!.attachJobs(jobCtx.jobs)
        return () => {
          detachEvaluation()
          detachController()
        }
      }, 'dsh-evolve.existingSkillRetentionJobs')
    })
  }
  if (existingSkillAutomaticPromotionScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-auto-promotion')
        const detachPromotion = existingSkillAutomaticPromotionScheduler.attachJobs(jobCtx.jobs)
        return () => {
          detachPromotion()
          detachController()
        }
      }, 'dsh-evolve.existingSkillAutomaticPromotionJobs')
    })
  }
  if (existingSkillCounterfactualCanaryScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-existing-skill-canary')
        const detachCanary = existingSkillCounterfactualCanaryScheduler!.attachJobs(jobCtx.jobs)
        return () => {
          detachCanary()
          detachController()
        }
      }, 'dsh-evolve.existingSkillCounterfactualCanaryJobs')
    })
  }
  const canaryScheduler = counterfactualCanaryScheduler
  if (canaryScheduler !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-counterfactual-canary')
        const detachCanary = canaryScheduler.attachJobs(jobCtx.jobs)
        return () => {
          detachCanary()
          detachController()
        }
      }, 'dsh-evolve.counterfactualCanaryJobs')
    })
  }
  if (config.supervisor !== undefined && config.supervisor.runRoots.length > 0) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.jobs.attachController('dsh-evolve-shadow-supervisor')
      const supervisor = new ShadowSupervisor({
        runRoots: config.supervisor!.runRoots,
        scanIntervalMs: config.supervisor!.scanIntervalMs ?? 30_000,
        pausedWorkspaces: [...new Set(config.supervisor!.runRoots.map(root => root.workspaceId))]
          .filter(workspaceId => resident!.isPaused(workspaceId)),
        afterScan: async (_signal, workspaceId) => {
          counterfactualCanaryScheduler?.observe(workspaceId)
          existingSkillCounterfactualCanaryScheduler?.observe(workspaceId)
          existingSkillAutomaticPromotionScheduler?.observe(workspaceId)
          ctx.emit('evoforge/evolution/settled')
        },
        runner: createShadowJobRunner(jobCtx.jobs, runShadow),
        onError: (error, path) => {
          jobCtx.logger.warn(`dsh-evolve supervisor skipped ${path}: ${String(error)}`)
        },
      })
      jobCtx.effect(() => {
        const detach = resident!.attach(supervisor)
        supervisor.start()
        return async () => {
          detach()
          await supervisor.stop()
        }
      }, 'dsh-evolve.shadowSupervisor')
    })
  }
  // Registered last so ordinary unload revokes this runtime before the other
  // plugin effects unwind; the early owner remains only as apply rollback.
  ctx.effect(() => () => runtime.close(), 'dsh-evolve.runtimeClose')
  runtimeCommitted = true
}

export type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
  SessionGenerationPinState,
  SessionIdentity,
  SkillGenerationArtifact,
} from './generation-store.ts'
export type { InteractionGenerationEvidencePolicyConfig } from './interaction-generation-evidence.ts'
export type { InteractionRoutingEvidencePolicyConfig } from './interaction-routing-evidence.ts'
export type { SkillCandidateEvaluationPolicyConfig } from './skill-evaluation-envelope.ts'
export type {
  SkillEvaluationCaseAuthorInput,
  SkillEvaluationCaseAuthorResult,
  SkillEvaluationGovernancePolicyConfig,
  SkillEvaluationGovernanceResult,
  SkillEvaluationGovernanceRunView,
  SkillEvaluationGovernanceScan,
} from './skill-evaluation-governance.ts'
export type { ExactSkillInvocationAttribution } from './durable-feedback-attribution.ts'
export { InstalledSkillBaselineVault } from './installed-skill-baseline.ts'
export type {
  InstalledSkillBaselineCaptureResult,
  InstalledSkillBaselineManifest,
  InstalledSkillBaselinePolicy,
  ResolvedInstalledSkillBundle,
  ResolvedInstalledSkillBaseline,
} from './installed-skill-baseline.ts'
export { ExistingSkillBaselineQualification } from './existing-skill-baseline-qualification.ts'
export type {
  ExistingSkillBaselineQualificationEvidence,
  ExistingSkillBaselineQualificationManifest,
  ExistingSkillBaselineQualificationResult,
} from './existing-skill-baseline-qualification.ts'
export { ExistingSkillEvaluationEvidenceVault } from './existing-skill-evaluation-evidence-vault.ts'
export type {
  ExistingSkillAuthoringEvidence,
  ExistingSkillEvaluationEvidenceManifest,
  ExistingSkillEvaluationEvidencePreparation,
  ExistingSkillEvaluationEvidenceReadiness,
} from './existing-skill-evaluation-evidence-vault.ts'
export { ExistingSkillCandidateAuthoring } from './existing-skill-candidate-authoring.ts'
export type {
  ExistingSkillAuthorInput,
  ExistingSkillAuthorResult,
  ExistingSkillCandidateAuthoringPhase,
  ExistingSkillCandidateAuthoringRunView,
  ExistingSkillCandidateAuthoringScan,
  ExistingSkillCandidateAuthoringOptions,
} from './existing-skill-candidate-authoring.ts'
export { ExistingSkillHoldoutGovernance } from './existing-skill-holdout-governance.ts'
export type {
  ExistingSkillHoldoutAuthorInput,
  ExistingSkillHoldoutAuthorResult,
  ExistingSkillHoldoutCandidateBinding,
  ExistingSkillHoldoutEnvelope,
  ExistingSkillHoldoutGovernanceResult,
  ExistingSkillHoldoutGovernanceRunView,
  ExistingSkillHoldoutGovernanceScan,
  ExistingSkillHoldoutGovernanceSubject,
} from './existing-skill-holdout-governance.ts'
export {
  ExistingSkillHoldoutEvaluation,
  ExistingSkillHoldoutEvaluationScheduler,
} from './existing-skill-holdout-evaluation.ts'
export {
  ExistingSkillRetentionEvaluation,
  ExistingSkillRetentionEvaluationScheduler,
} from './existing-skill-retention-evaluation.ts'
export {
  ExistingSkillCounterfactualCanary,
  ExistingSkillCounterfactualCanaryScheduler,
} from './existing-skill-counterfactual-canary.ts'
export { ExistingSkillFutureSessionRollback } from './existing-skill-future-session-rollback.ts'
export type {
  ExistingSkillFutureSessionRollbackEligibility,
  ExistingSkillFutureSessionRollbackModules,
  ExistingSkillFutureSessionRollbackReason,
} from './existing-skill-future-session-rollback.ts'
export type {
  ExistingSkillCounterfactualCanaryEvidence,
  ExistingSkillCounterfactualCanaryModules,
  ExistingSkillCounterfactualCanaryPolicy,
  ExistingSkillCounterfactualCanaryPreparedView,
  ExistingSkillCounterfactualCanaryReason,
  ExistingSkillCounterfactualCanaryReconcile,
  ExistingSkillCounterfactualCanaryResult,
  ExistingSkillCounterfactualCanaryScan,
} from './existing-skill-counterfactual-canary.ts'
export {
  ExistingSkillAutomaticPromotionScheduler,
  ExistingSkillRelease,
  openExistingSkillReleaseStore,
} from './existing-skill-release.ts'
export type {
  ExistingSkillAutomaticPromotionPolicy,
  ExistingSkillAutomaticPromotionReason,
  ExistingSkillAutomaticPromotionResult,
  ExistingSkillAutomaticPromotionScan,
  ExistingSkillAutomaticPromotionStatus,
  ExistingSkillAutomaticPromotionStatusScan,
  ExistingSkillReleaseDecision,
  ExistingSkillReleaseEligibility,
  ExistingSkillReleaseReason,
  ExistingSkillReleaseStore,
} from './existing-skill-release.ts'
export type { ExistingSkillCandidateLineage } from './existing-skill-candidate-lineage.ts'
export type {
  ExistingSkillRetentionEvaluationEvidence,
  ExistingSkillRetentionEvaluationReason,
  ExistingSkillRetentionEvaluationResult,
  ExistingSkillRetentionEvaluationRunView,
  ExistingSkillRetentionEvaluationScan,
  ExistingSkillRetentionHoldoutSource,
  ExistingSkillRetentionTrialInput,
  ExistingSkillRetentionVerdict,
  ExistingSkillCanaryReplay,
} from './existing-skill-retention-evaluation.ts'
export type {
  ExistingSkillHoldoutEvaluationEvidence,
  ExistingSkillHoldoutEvaluationReason,
  ExistingSkillHoldoutEvaluationResult,
  ExistingSkillHoldoutEvaluationRunView,
  ExistingSkillHoldoutEvaluationScan,
  ExistingSkillHoldoutTrialInput,
  ExistingSkillHoldoutVerdict,
} from './existing-skill-holdout-evaluation.ts'
export {
  ExistingSkillCandidateAdmission,
  ExistingSkillCandidateAdmissionScheduler,
} from './existing-skill-candidate-admission.ts'
export type {
  ExistingSkillCandidateAdmissionReason,
  ExistingSkillCandidateAdmissionResult,
  ExistingSkillCandidateAdmissionScan,
} from './existing-skill-candidate-admission.ts'
export type { SkillOpportunityAuthoringPolicyConfig } from './slow-loop-skill-authoring.ts'
export type { ShadowResumeInvocation, ShadowSupervisorOptions } from './shadow-supervisor.ts'
export type {
  DeliveryOutcome,
  DeliveryOutcomeCounts,
  DeliveryOutcomeInput,
  DeliveryOutcomeSummary,
} from './delivery-outcome-monitor.ts'
export type {
  FeedbackSignal,
  FeedbackSignalSummary,
} from './feedback-signal-monitor.ts'
export { openInteractionEpisodeStore } from './interaction-episode-store.ts'
export type {
  InteractionEpisodeInputV1,
  InteractionEpisodeSource,
  InteractionEpisodeStore,
  InteractionEpisodeV1,
} from './interaction-episode-store.ts'
export {
  CompletedInteractionGapRecorder,
  openInteractionCapabilityGapStore,
} from './interaction-capability-gap-store.ts'
export type {
  CompletedInteractionGapResult,
  InteractionCapabilityGapSource,
  InteractionCapabilityGapStore,
  InteractionCapabilityGapV1,
  InteractionCapabilityGapViewV1,
  InteractionEpisodeRefV1,
} from './interaction-capability-gap-store.ts'
export { installSkillUseMonitor, openSkillUseStore } from './skill-use-monitor.ts'
export type {
  SkillReuseCounts,
  SkillReuseEvidence,
  SkillReuseSummary,
  SkillUse,
  SkillUseInput,
  SkillUseMonitor,
  SkillUseStore,
} from './skill-use-monitor.ts'
export {
  ExactSkillOutcomeContextProjection,
  summarizeExactSkillOutcomeContext,
} from './skill-outcome-context.ts'
export type {
  ExactSkillOutcomeContextEvidence,
  ExactSkillOutcomeContextReader,
  ExactSkillOutcomeContextRollup,
  ExactSkillOutcomeContextSummary,
} from './skill-outcome-context.ts'
export { EvolutionControlPlane } from './evolution-control-plane.ts'
export { FutureSessionPromotion } from './future-session-promotion.ts'
export type {
  FutureSessionPromotionEligibility,
  FutureSessionPromotionModules,
  FutureSessionPromotionReason,
} from './future-session-promotion.ts'
export { CounterfactualCanary, CounterfactualCanaryScheduler } from './counterfactual-canary.ts'
export type {
  CounterfactualCanaryEvidence,
  CounterfactualCanaryModules,
  CounterfactualCanaryPolicy,
  CounterfactualCanaryPreparedView,
  CounterfactualCanaryReason,
  CounterfactualCanaryReconcile,
  CounterfactualCanaryResult,
  CounterfactualCanaryRunView,
  CounterfactualCanaryScan,
} from './counterfactual-canary.ts'
export { InternalSkillRetention } from './internal-skill-retention.ts'
export type {
  InternalCandidateShadowResult,
  InternalSkillRetentionReason,
  InternalSkillRetentionResult,
  InternalSkillRetentionRunRoot,
  InternalSkillRetentionRunView,
  InternalSkillRetentionScan,
} from './internal-skill-retention.ts'
export type { EvolutionControlPlaneModules } from './evolution-control-plane.ts'
export { EvolutionRemoteService } from './evolution-remote.ts'
export type { EvolutionRemoteTypertContract } from './evolution-remote.typert.ts'
export type {
  EvolutionActionReceipt,
  EvolutionArtifactView,
  EvolutionFutureSessionPromotionReason,
  EvolutionGenerationView,
  EvolutionExistingSkillAdmissionView,
  EvolutionExistingSkillHoldoutEvaluationView,
  EvolutionExistingSkillRetentionEvaluationView,
  EvolutionInactiveGenerationView,
  EvolutionOverview,
  EvolutionReviewCaseView,
  EvolutionReviewDetail,
  EvolutionReviewView,
  EvolutionSkillReuseCountsView,
  EvolutionSkillReuseEvidenceView,
  EvolutionExactSkillBetweenAttemptWorkView,
  EvolutionExactSkillFailureContextInvestigationView,
  EvolutionExactSkillFailureContextInvestigationRollupView,
  EvolutionExactSkillOutcomeContextEvidenceView,
  EvolutionExactSkillOutcomeContextRollupView,
  EvolutionLongTermEffectsMetricView,
  EvolutionLongTermEffectsView,
} from './control-types.ts'
export {
  LongTermEffectsProjection,
  openLongTermEffectsStore,
} from './long-term-effects.ts'
export type {
  LongTermEffectsReader,
  LongTermEffectsStore,
  LongTermEffectsSummary,
  LongTermFact,
  LongTermFactInput,
  LongTermMetricStatus,
  LongTermMetricView,
} from './long-term-effects.ts'
