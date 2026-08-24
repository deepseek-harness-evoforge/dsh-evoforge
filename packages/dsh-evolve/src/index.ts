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
import { DurableFeedbackAttribution } from './durable-feedback-attribution.ts'
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
  /** Workspace-only authority for exact low-risk existing-Skill instruction promotion. */
  automaticPromotionPolicies?: ExistingSkillAutomaticPromotionPolicy[]
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

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GenerationBundleRepository(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'generation-cache'),
  )
  const store = new VerifiedEvolutionStore(await openEvolutionStore(ctx.storageDomain), source)
  const deliveryOutcomes = await openDeliveryOutcomeStore(ctx.storageDomain)
  const feedbackSignals = await openFeedbackSignalStore(ctx.storageDomain)
  const skillUses = await openSkillUseStore(ctx.storageDomain)
  const skillOutcomeContext = new ExactSkillOutcomeContextProjection(skillUses, deliveryOutcomes)
  const capabilityGaps = await openCapabilityGapStore(ctx.storageDomain)
  const skillOpportunities = new ExperienceDrivenSkillOpportunityDiscovery(capabilityGaps, {
    feedback: feedbackSignals,
    outcomes: deliveryOutcomes,
  })
  const skillCandidateStore = await openSkillCandidateStore(ctx.storageDomain)
  const existingSkillReleaseStore = await openExistingSkillReleaseStore(ctx.storageDomain)
  let durableFeedbackAttribution: DurableFeedbackAttribution | undefined
  let reconcileExistingSkillCandidates: ((workspaceId: string) => void) | undefined
  const feedbackMonitor = installFeedbackSignalMonitor(ctx, feedbackSignals, store, {
    attribution: {
      resolve: (sessionId, assistantMessageId) => durableFeedbackAttribution
        ?.resolve(sessionId, assistantMessageId) ?? Promise.resolve(undefined),
    },
    onSignalsChanged: workspaceId => reconcileExistingSkillCandidates?.(workspaceId),
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
  const disposeBinder = installGenerationBinder(ctx, store, source)
  const skillUseMonitor = installSkillUseMonitor(ctx, skillUses, store)
  const capabilities = new CapabilityMap()
  const capabilityMonitors = new Set<ReturnType<typeof installCapabilityMapObserver>>()
  const installedBaselineMonitors = new Set<ReturnType<typeof installInstalledSkillBaselineMonitor>>()
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
      const evidence = new ExistingSkillEvaluationEvidenceVault(
        candidateEvaluationPolicies,
        qualification,
        feedbackSignals,
        evidenceCtx.messageFeedback,
        evidenceCtx.sessionPersistence,
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
  ctx.effect(() => async () => {
    await deliveryMonitor.dispose()
    await skillUseMonitor.dispose()
    await Promise.all([...installedBaselineMonitors].map(monitor => monitor.dispose()))
    await Promise.all([...capabilityMonitors].map(monitor => monitor.dispose()))
    await capabilityGapMonitor.dispose()
    await feedbackMonitor.dispose()
    await deliveryOutcomes.close()
    await feedbackSignals.close()
    await skillUses.close()
    await capabilityGaps.close()
    await skillCandidateStore.close()
    await existingSkillReleaseStore.close()
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
} from './control-types.ts'
