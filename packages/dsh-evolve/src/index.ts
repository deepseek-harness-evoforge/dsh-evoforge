import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { installGenerationBinder } from './generation-binder.ts'
import { CapabilityMap, installCapabilityMapObserver } from './capability-map.ts'
import {
  installCapabilityGapMonitor,
  openCapabilityGapStore,
} from './capability-gap-store.ts'
import { installCapabilityGapTool } from './capability-gap-tool.ts'
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
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
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
  }
  interface Events {
    /** Host-only wakeup after the resident evaluation scan has settled. */
    'evoforge/evolution/settled'(): void
  }
}

export const name = 'dsh-evolve'
export const inject = ['sessions', 'storageDomain', 'workspaceRegistry']

/**
 * Public deployment policy. It deliberately contains no Skill source, target,
 * repository, Case Pack, or promotion allowlist selected by an operator.
 */
export interface Config {
  /** Private content-addressed materialization root for internally authored Generations. */
  cacheRoot?: string
  selfDiscoveryPolicies?: SkillOpportunityAuthoringPolicyConfig[]
  candidateEvaluationPolicies?: SkillCandidateEvaluationPolicyConfig[]
  supervisor?: {
    runRoots: Array<{ workspaceId: string; path: string }>
    scanIntervalMs?: number
  }
}

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
  supervisor: z.object({
    runRoots: z.array(z.object({
      workspaceId: z.string().required(),
      path: z.string().required(),
    })).default([]),
    scanIntervalMs: z.number().step(1).min(1_000).default(30_000),
  }),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GenerationBundleRepository(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'generation-cache'),
  )
  const store = new VerifiedEvolutionStore(await openEvolutionStore(ctx.storageDomain), source)
  const deliveryOutcomes = await openDeliveryOutcomeStore(ctx.storageDomain)
  const feedbackSignals = await openFeedbackSignalStore(ctx.storageDomain)
  const capabilityGaps = await openCapabilityGapStore(ctx.storageDomain)
  const skillOpportunities = new ExperienceDrivenSkillOpportunityDiscovery(capabilityGaps, {
    feedback: feedbackSignals,
    outcomes: deliveryOutcomes,
  })
  const skillCandidateStore = await openSkillCandidateStore(ctx.storageDomain)
  let durableFeedbackAttribution: DurableFeedbackAttribution | undefined
  const feedbackMonitor = installFeedbackSignalMonitor(ctx, feedbackSignals, store, {
    attribution: {
      resolve: (sessionId, assistantMessageId) => durableFeedbackAttribution
        ?.resolve(sessionId, assistantMessageId) ?? Promise.resolve(undefined),
    },
  })
  const deliveryMonitor = installDeliveryOutcomeMonitor(ctx, deliveryOutcomes, store)
  const candidateEvaluationPolicies = config.candidateEvaluationPolicies ?? []
  const selfDiscoveryPolicies = config.selfDiscoveryPolicies ?? []
  if (selfDiscoveryPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId))) {
    throw new Error('internal Skill authoring requires an evaluation governance policy for every Workspace')
  }
  if (selfDiscoveryPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId && evaluation.dshRevision !== undefined))) {
    throw new Error('internal Skill authoring requires an exact DSH revision for autonomous evaluation governance')
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
  const disposeBinder = installGenerationBinder(ctx, store, source)
  const capabilities = new CapabilityMap()
  const capabilityMonitors = new Set<ReturnType<typeof installCapabilityMapObserver>>()
  ctx.inject(['skills'], (skillCtx) => {
    const monitor = installCapabilityMapObserver(skillCtx, capabilities, store)
    capabilityMonitors.add(monitor)
    skillCtx.effect(() => async () => {
      await monitor.dispose()
      capabilityMonitors.delete(monitor)
    }, 'dsh-evolve.capabilityMapObserver')
  })

  let skillAdmissionScheduler: SkillCandidateAdmissionScheduler | undefined
  let skillShadowScheduler: SkillCandidateShadowScheduler | undefined
  let skillRetention: InternalSkillRetention | undefined
  const skillCandidates = new SkillCandidateRepository(
    skillCandidateStore,
    candidate => skillAdmissionScheduler?.observe(candidate),
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
  const reconcileSkillOpportunities = async (workspaceId: string): Promise<void> => {
    const result = await slowLoopAuthoring?.reconcile(workspaceId)
    for (const warning of result?.warnings ?? []) {
      ctx.logger.warn(`dsh-evolve internal Skill authoring skipped work: ${warning}`)
    }
  }
  const capabilityGapMonitor = installCapabilityGapMonitor(
    ctx,
    capabilityGaps,
    capabilities,
    store,
    { onGap: gap => reconcileSkillOpportunities(gap.workspaceId) },
  )
  ctx.inject(['tools', 'goals'], (toolCtx) => {
    installCapabilityGapTool(
      toolCtx,
      capabilityGaps,
      capabilities,
      store,
      { onGap: gap => reconcileSkillOpportunities(gap.workspaceId) },
    )
  })

  const review = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : {
        inbox: new ReviewInbox(config.supervisor.runRoots),
        publisher: new CandidatePublisher(store, source),
      }
  const resident = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : new ResidentEvolutionControl(store)
  const control = new EvolutionControlPlane({
    store,
    capabilities,
    gaps: capabilityGaps,
    opportunities: skillOpportunities,
    evaluationEvidence: skillEvaluationEvidence,
    candidates: skillCandidateStore,
    ...(skillAdmission === undefined ? {} : { admissions: skillAdmission }),
    ...(skillRetention === undefined ? {} : { retention: skillRetention }),
    ...(slowLoopAuthoring === undefined ? {} : { slowLoopAuthoring }),
    ...(skillEvaluationGovernance === undefined ? {} : { evaluationGovernance: skillEvaluationGovernance }),
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    outcomes: deliveryOutcomes,
    feedback: feedbackSignals,
  })
  new EvolutionRemoteService(ctx, control)
  installEvolutionCommand(ctx, store, {
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    outcomes: deliveryOutcomes,
    feedback: feedbackSignals,
  })
  ctx.inject(['sessionPersistence'], (attributionCtx) => {
    const attribution = new DurableFeedbackAttribution(attributionCtx.sessionPersistence)
    attributionCtx.effect(() => {
      durableFeedbackAttribution = attribution
      return () => {
        if (durableFeedbackAttribution === attribution) durableFeedbackAttribution = undefined
      }
    }, 'dsh-evolve.durableFeedbackAttribution')
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
  if (config.supervisor !== undefined && config.supervisor.runRoots.length > 0) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.jobs.attachController('dsh-evolve-shadow-supervisor')
      const supervisor = new ShadowSupervisor({
        runRoots: config.supervisor!.runRoots,
        scanIntervalMs: config.supervisor!.scanIntervalMs ?? 30_000,
        pausedWorkspaces: [...new Set(config.supervisor!.runRoots.map(root => root.workspaceId))]
          .filter(workspaceId => resident!.isPaused(workspaceId)),
        afterScan: async (_signal, _workspaceId) => {
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
  ctx.effect(() => async () => {
    await deliveryMonitor.dispose()
    await Promise.all([...capabilityMonitors].map(monitor => monitor.dispose()))
    await capabilityGapMonitor.dispose()
    await feedbackMonitor.dispose()
    await deliveryOutcomes.close()
    await feedbackSignals.close()
    await capabilityGaps.close()
    await skillCandidateStore.close()
    await disposeBinder()
    await store.close()
  }, 'dsh-evolve.runtimeClose')
}

export type {
  CapabilityGeneration,
  EvolutionStore,
  GenerationInput,
  SessionIdentity,
  SkillGenerationArtifact,
} from './generation-store.ts'
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
export { EvolutionControlPlane } from './evolution-control-plane.ts'
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
  EvolutionGenerationView,
  EvolutionInactiveGenerationView,
  EvolutionOverview,
  EvolutionReviewCaseView,
  EvolutionReviewDetail,
  EvolutionReviewView,
} from './control-types.ts'
