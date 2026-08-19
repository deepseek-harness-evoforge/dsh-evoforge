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
import {
  SkillEvaluationEnvelopeResolver,
  type SkillCandidateEvaluationPolicyConfig,
} from './skill-evaluation-envelope.ts'
import { SkillEvaluationEvidenceVault } from './skill-evaluation-evidence-vault.ts'
import { installEvolutionCommand } from './evolve-command.ts'
import { CandidatePublisher } from './candidate-publisher.ts'
import { GitSkillSource, type GitSkillSourceConfig } from './git-skill-source.ts'
import { openEvolutionStore, type EvolutionStore } from './generation-store.ts'
import { ShadowSupervisor } from './shadow-supervisor.ts'
import { createShadowJobRunner } from './shadow-job-runner.ts'
import { runShadow } from './shadow.ts'
import { ReviewInbox } from './review-inbox.ts'
import { ResidentEvolutionControl } from './resident-evolution-control.ts'
import { VerifiedEvolutionStore } from './verified-evolution-store.ts'
import { AutoPromotionPolicy, AutoPromotionService, type AutoPromotionTarget } from './auto-promotion.ts'
import {
  installDeliveryOutcomeMonitor,
  openDeliveryOutcomeStore,
} from './delivery-outcome-monitor.ts'
import { CounterfactualCanary } from './counterfactual-canary.ts'
import { createCanaryJobRunner } from './counterfactual-canary-job.ts'
import { createSealedCanaryRunner } from './sealed-canary-runner.ts'
import {
  installFeedbackSignalMonitor,
  openFeedbackSignalStore,
} from './feedback-signal-monitor.ts'
import { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'
import { EvolutionControlPlane } from './evolution-control-plane.ts'
import { EvolutionRemoteService } from './evolution-remote.ts'
import {
  FeedbackShadowLauncher,
  type FeedbackShadowTargetConfig,
} from './feedback-shadow-launcher.ts'
import {
  EvaluatorDraftInbox,
  type EvaluatorDraftTargetConfig,
} from './evaluator-draft-inbox.ts'
import { RetentionEvidenceIndex } from './retention-evidence-index.ts'
import {
  assertAutomaticRetentionTargets,
  AutomaticRetentionService,
  type AutomaticRetentionTargetConfig,
} from './automatic-retention.ts'
import { createAutomaticRetentionJobRunner } from './automatic-retention-job.ts'
import {
  assertAutomaticFeedbackShadowTargets,
  AutomaticFeedbackShadowService,
  DEFAULT_PENDING_REVIEW_AGE_HOURS,
  type AutomaticFeedbackShadowTarget,
  type AutomaticFeedbackShadowTargetReference,
} from './automatic-feedback-shadow.ts'
import { AutomaticEvolutionBudget } from './automatic-evolution-budget.ts'
import {
  assertAutomaticEvaluatorDraftTargets,
  assertAutomaticEvaluatorDraftSeparation,
  AutomaticEvaluatorDraftService,
  type AutomaticEvaluatorDraftTarget,
  type AutomaticEvaluatorDraftTargetReference,
} from './automatic-evaluator-draft.ts'
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
    /** Host-only wakeup after the existing resident evolution scan has settled. */
    'evoforge/evolution/settled'(): void
  }
}

export const name = 'dsh-evolve'
export const inject = ['sessions', 'storageDomain', 'workspaceRegistry']

export interface Config {
  cacheRoot?: string
  feedbackDraftRoot?: string
  sources?: GitSkillSourceConfig[]
  selfDiscoveryPolicies?: SkillOpportunityAuthoringPolicyConfig[]
  candidateEvaluationPolicies?: SkillCandidateEvaluationPolicyConfig[]
  supervisor?: {
    runRoots: Array<{ workspaceId: string; path: string }>
    scanIntervalMs?: number
  }
  autoPromote?: {
    targets: AutoPromotionTarget[]
    retentionRoots?: string[]
    retentionTargets?: AutomaticRetentionTargetConfig[]
  }
  shadowTargets?: FeedbackShadowTargetConfig[]
  automaticFeedbackTargets?: AutomaticFeedbackShadowTargetReference[]
  evaluatorTargets?: EvaluatorDraftTargetConfig[]
  automaticEvaluatorTargets?: AutomaticEvaluatorDraftTargetReference[]
}

export const Config: Schema<Config> = z.object({
  cacheRoot: z.string(),
  feedbackDraftRoot: z.string(),
  sources: z.array(z.object({
    name: z.string().required(),
    repository: z.string().required(),
    path: z.string().required(),
  })).default([]),
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
  })).max(100).default([]),
  supervisor: z.object({
    runRoots: z.array(z.object({
      workspaceId: z.string().required(),
      path: z.string().required(),
    })).default([]),
    scanIntervalMs: z.number().step(1).min(1_000).default(30_000),
  }),
  autoPromote: z.object({
    targets: z.array(z.object({
      workspaceId: z.string().required(),
      skill: z.string().required(),
    })).max(100).default([]),
    retentionRoots: z.array(z.string()).max(20).default([]),
    retentionTargets: z.array(z.object({
      id: z.string().required(),
      workspaceId: z.string().required(),
      skill: z.string().required(),
      casePackDir: z.string().required(),
      casePackHash: z.string().required(),
      runRoot: z.string().required(),
    })).max(20).default([]),
  }),
  shadowTargets: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
    skill: z.string().required(),
    casePackDir: z.string().required(),
    runRoot: z.string().required(),
  })).default([]),
  automaticFeedbackTargets: z.array(z.object({
    target: z.string().required(),
    casePackHash: z.string().required(),
    maxAttemptsPerUtcDay: z.number().step(1).min(1).max(20).default(1),
    maxPendingReviewAgeHours: z.number().step(1).min(1).max(2_160)
      .default(DEFAULT_PENDING_REVIEW_AGE_HOURS),
  })).max(20).default([]),
  evaluatorTargets: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
    skill: z.string().required(),
    root: z.string().required(),
    dshRevision: z.string().required(),
    shadowRunRoot: z.string(),
  })).default([]),
  automaticEvaluatorTargets: z.array(z.object({
    target: z.string().required(),
    maxAttemptsPerUtcDay: z.number().step(1).min(1).max(20).default(1),
  })).max(20).default([]),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GitSkillSource(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'git-skills'),
    config.sources ?? [],
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
  const feedbackMonitor = installFeedbackSignalMonitor(ctx, feedbackSignals, store)
  const deliveryMonitor = installDeliveryOutcomeMonitor(ctx, deliveryOutcomes, store)
  let feedbackDraftBuilder: FeedbackCaseDraftBuilder | undefined
  const automaticTargets = config.autoPromote?.targets ?? []
  const retentionRoots = config.autoPromote?.retentionRoots ?? []
  const retentionTargets = config.autoPromote?.retentionTargets ?? []
  const shadowTargets = config.shadowTargets ?? []
  const automaticFeedbackTargetReferences = config.automaticFeedbackTargets ?? []
  const evaluatorTargets = config.evaluatorTargets ?? []
  const automaticEvaluatorTargetReferences = config.automaticEvaluatorTargets ?? []
  const candidateEvaluationPolicies = config.candidateEvaluationPolicies ?? []
  const selfDiscoveryPolicies = config.selfDiscoveryPolicies ?? []
  if (selfDiscoveryPolicies.some(policy => !candidateEvaluationPolicies.some(evaluation =>
    evaluation.workspaceId === policy.workspaceId))) {
    throw new Error('internal Skill authoring requires an evaluation governance policy for every Workspace')
  }
  const skillEvaluationEvidence = new SkillEvaluationEvidenceVault(
    candidateEvaluationPolicies,
    capabilityGaps,
  )
  const shadowTargetsById = new Map(shadowTargets.map(target => [target.id, target]))
  const automaticFeedbackTargets: AutomaticFeedbackShadowTarget[] =
    automaticFeedbackTargetReferences.map((reference) => {
      const target = shadowTargetsById.get(reference.target)
      if (target === undefined) {
        throw new Error(`automatic Feedback Shadow references unknown target '${reference.target}'`)
      }
      return {
        ...target,
        casePackHash: reference.casePackHash,
        maxAttemptsPerUtcDay: reference.maxAttemptsPerUtcDay ?? 1,
        maxPendingReviewAgeHours:
          reference.maxPendingReviewAgeHours ?? DEFAULT_PENDING_REVIEW_AGE_HOURS,
      }
    })
  if (automaticFeedbackTargets.length > 0) {
    assertAutomaticFeedbackShadowTargets(automaticFeedbackTargets)
  }
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
    )
    skillAdmission = new SkillCandidateAdmission(evaluationEnvelopes, skillCandidates)
    skillShadowScheduler = new SkillCandidateShadowScheduler(
      new SkillCandidateShadowLauncher(skillAdmission),
    )
    skillAdmissionScheduler = new SkillCandidateAdmissionScheduler(
      skillAdmission,
      {
        listCandidates: workspaceId => skillCandidateStore.listCandidates(workspaceId),
      },
      { onResult: (candidate, result) => skillShadowScheduler?.observe(candidate, result) },
    )
  }
  const slowLoopAuthoringBudget = new AutomaticEvolutionBudget()
  if (selfDiscoveryPolicies.length > 0) {
    assertSlowLoopSkillAuthoringRootSeparation(selfDiscoveryPolicies, [
      ...(config.cacheRoot === undefined ? [] : [config.cacheRoot]),
      ...(config.feedbackDraftRoot === undefined ? [] : [config.feedbackDraftRoot]),
      ...(config.sources ?? []).map(value => value.repository),
      ...candidateEvaluationPolicies.flatMap(value => [value.governanceRoot, value.runRoot]),
      ...(config.supervisor?.runRoots ?? []).map(value => value.path),
      ...shadowTargets.flatMap(value => [value.casePackDir, value.runRoot]),
      ...evaluatorTargets.flatMap(value => [value.root, ...(value.shadowRunRoot === undefined
        ? []
        : [value.shadowRunRoot])]),
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
          quarantine: input =>
            skillCandidates.quarantine(input),
        },
        budget: slowLoopAuthoringBudget,
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
        inbox: new ReviewInbox(config.supervisor.runRoots, {
          automaticReviewExpiry: automaticFeedbackTargets.map(target => ({
            workspaceId: target.workspaceId,
            skillName: target.skill,
            maxPendingReviewMs: target.maxPendingReviewAgeHours * 60 * 60 * 1_000,
          })),
        }),
        publisher: new CandidatePublisher(store, source),
      }
  const resident = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : new ResidentEvolutionControl(store)
  if (retentionTargets.length > 0) assertAutomaticRetentionTargets(retentionTargets)
  if (automaticTargets.length > 0 && review === undefined) {
    throw new Error('automatic promotion requires configured supervisor.runRoots')
  }
  if (retentionRoots.length > 0 && automaticTargets.length === 0) {
    throw new Error('retention evidence roots require a non-empty automatic promotion Skill allowlist')
  }
  if (retentionTargets.length > 0 && retentionRoots.length === 0) {
    throw new Error('automatic Retention targets require configured retention evidence roots')
  }
  if (retentionTargets.some(target => !automaticTargets.some(automatic =>
    automatic.workspaceId === target.workspaceId && automatic.skill === target.skill))) {
    throw new Error('automatic Retention targets must name an automatic promotion Workspace and Skill')
  }
  if (retentionTargets.some(target =>
    !retentionRoots.some(root => resolve(root) === resolve(target.runRoot)))) {
    throw new Error('automatic Retention target run roots must be exact retention evidence roots')
  }
  if (shadowTargets.length > 0 && (config.supervisor === undefined
    || config.supervisor.runRoots.length === 0
    || config.feedbackDraftRoot === undefined)) {
    throw new Error('feedback Shadow targets require supervisor.runRoots and feedbackDraftRoot')
  }
  if (automaticFeedbackTargetReferences.length > 0 && shadowTargets.length === 0) {
    throw new Error('automatic Feedback Shadow requires configured feedback Shadow targets')
  }
  if (evaluatorTargets.length > 0 && config.feedbackDraftRoot === undefined) {
    throw new Error('evaluator targets require feedbackDraftRoot')
  }
  if (automaticEvaluatorTargetReferences.length > 0 && evaluatorTargets.length === 0) {
    throw new Error('Automatic Evaluator Draft requires configured evaluator targets')
  }
  if (automaticEvaluatorTargetReferences.length > 0 && (config.supervisor === undefined
    || config.supervisor.runRoots.length === 0)) {
    throw new Error('Automatic Evaluator Draft requires configured supervisor.runRoots')
  }
  const evaluatorShadowTargets = evaluatorTargets.flatMap(target =>
    target.shadowRunRoot === undefined
      ? []
      : [{ id: target.id, workspaceId: target.workspaceId, skill: target.skill, runRoot: target.shadowRunRoot }])
  if (evaluatorShadowTargets.length > 0 && (config.supervisor === undefined
    || config.supervisor.runRoots.length === 0)) {
    throw new Error('qualified evaluator Shadow requires configured supervisor.runRoots')
  }
  const retentionEvidence = retentionRoots.length === 0
    ? undefined
    : new RetentionEvidenceIndex(retentionRoots)
  const automaticPreflight = automaticTargets.length === 0
    ? undefined
    : new AutoPromotionPolicy(source, store, automaticTargets)
  const automaticPolicy = automaticTargets.length === 0
    ? undefined
    : new AutoPromotionPolicy(
        source,
        store,
        automaticTargets,
        ...retentionEvidence === undefined ? [] : [retentionEvidence],
      )
  const automatic = automaticPolicy === undefined || review === undefined
    ? undefined
    : new AutoPromotionService({
        inbox: review.inbox,
        policy: automaticPolicy,
        publisher: review.publisher,
        store,
      })
  const feedbackDraft = config.feedbackDraftRoot === undefined
    ? undefined
    : {
        create: (workspaceId: string, signalId: string) => {
          if (feedbackDraftBuilder === undefined) {
            throw new Error(
              'native message feedback and Session persistence are not composed for Feedback Case Draft creation',
            )
          }
          return feedbackDraftBuilder.create(workspaceId, signalId)
        },
      }
  const feedbackShadow = shadowTargets.length === 0 && evaluatorShadowTargets.length === 0
    ? undefined
    : new FeedbackShadowLauncher({
        targets: shadowTargets,
        monitoredTargets: evaluatorShadowTargets,
        supervisorRunRoots: config.supervisor!.runRoots,
        drafts: () => feedbackDraftBuilder,
        source,
      })
  const automaticEvolutionBudget = new AutomaticEvolutionBudget()
  if (automaticFeedbackTargets.length > 0) {
    automaticEvolutionBudget.assertTargets(automaticFeedbackTargets)
  }
  const automaticFeedback = automaticFeedbackTargets.length === 0
    || feedbackShadow === undefined
    || review === undefined
    ? undefined
    : new AutomaticFeedbackShadowService({
        evolution: store,
        shadow: feedbackShadow,
        signals: feedbackSignals,
        targets: automaticFeedbackTargets,
        inflight: [feedbackShadow, review.inbox],
        budget: automaticEvolutionBudget,
      })
  const evaluatorDrafts = evaluatorTargets.length === 0
    ? undefined
    : new EvaluatorDraftInbox({
        targets: evaluatorTargets,
        drafts: () => feedbackDraftBuilder,
        source,
        ...(feedbackShadow === undefined ? {} : { shadow: feedbackShadow }),
      })
  const evaluatorTargetsById = new Map(evaluatorTargets.map(target => [target.id, target]))
  const automaticEvaluatorTargets: AutomaticEvaluatorDraftTarget[] =
    automaticEvaluatorTargetReferences.map((reference) => {
      const target = evaluatorTargetsById.get(reference.target)
      if (target === undefined) {
        throw new Error(`Automatic Evaluator Draft references unknown target '${reference.target}'`)
      }
      return {
        id: target.id,
        workspaceId: target.workspaceId,
        skill: target.skill,
        root: target.root,
        maxAttemptsPerUtcDay: reference.maxAttemptsPerUtcDay ?? 1,
      }
    })
  if (automaticEvaluatorTargets.length > 0) {
    assertAutomaticEvaluatorDraftTargets(automaticEvaluatorTargets)
    automaticEvolutionBudget.assertTargets(automaticEvaluatorTargets.map(target => ({
      id: target.id,
      workspaceId: target.workspaceId,
      skill: target.skill,
      runRoot: target.root,
      maxAttemptsPerUtcDay: target.maxAttemptsPerUtcDay,
    })))
  }
  const automaticFeedbackSkills = new Set(automaticFeedbackTargets.map(target =>
    `${target.workspaceId}\0${target.skill}`))
  assertAutomaticEvaluatorDraftSeparation(automaticEvaluatorTargets, automaticFeedbackSkills)
  const automaticEvaluator = automaticEvaluatorTargets.length === 0
    || evaluatorDrafts === undefined
    || review === undefined
    ? undefined
    : new AutomaticEvaluatorDraftService({
        evolution: store,
        evaluator: evaluatorDrafts,
        signals: feedbackSignals,
        targets: automaticEvaluatorTargets,
        inflight: [
          evaluatorDrafts,
          ...(feedbackShadow === undefined ? [] : [feedbackShadow]),
          review.inbox,
        ],
        budget: automaticEvolutionBudget,
      })
  const control = new EvolutionControlPlane({
    store,
    capabilities,
    gaps: capabilityGaps,
    opportunities: skillOpportunities,
    evaluationEvidence: skillEvaluationEvidence,
    candidates: skillCandidateStore,
    ...(skillAdmission === undefined ? {} : { admissions: skillAdmission }),
    ...(slowLoopAuthoring === undefined ? {} : { slowLoopAuthoring }),
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    ...(automaticPolicy === undefined ? {} : { automatic: automaticPolicy }),
    outcomes: deliveryOutcomes,
    feedback: feedbackSignals,
    ...(feedbackShadow === undefined ? {} : { feedbackShadow }),
    ...(automaticFeedback === undefined ? {} : { automaticFeedback }),
    ...(automaticEvaluator === undefined ? {} : { automaticEvaluator }),
    ...(evaluatorDrafts === undefined ? {} : { evaluatorDrafts }),
  })
  new EvolutionRemoteService(ctx, control)
  installEvolutionCommand(ctx, store, {
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    ...(automaticPolicy === undefined ? {} : { automatic: automaticPolicy }),
    outcomes: deliveryOutcomes,
    feedback: feedbackSignals,
    ...(feedbackDraft === undefined ? {} : { feedbackDraft }),
    ...(feedbackShadow === undefined ? {} : { feedbackShadow }),
    ...(automaticFeedback === undefined ? {} : { automaticFeedback }),
    ...(automaticEvaluator === undefined ? {} : { automaticEvaluator }),
    ...(evaluatorDrafts === undefined ? {} : { evaluatorDrafts }),
  })
  if (config.feedbackDraftRoot !== undefined) {
    ctx.inject(['messageFeedback', 'sessionPersistence'], (draftCtx) => {
      const builder = new FeedbackCaseDraftBuilder(
        config.feedbackDraftRoot!,
        feedbackSignals,
        store,
        source,
        draftCtx.messageFeedback,
        draftCtx.sessionPersistence,
      )
      draftCtx.effect(() => {
        feedbackDraftBuilder = builder
        return () => {
          if (feedbackDraftBuilder === builder) feedbackDraftBuilder = undefined
        }
      }, 'dsh-evolve.feedbackCaseDraftBuilder')
    })
  }
  if (skillAdmissionScheduler !== undefined
    || skillShadowScheduler !== undefined) {
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
  if (evaluatorDrafts !== undefined) {
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.effect(() => {
        const detachController = jobCtx.jobs.attachController('dsh-evolve-evaluator-authoring')
        const detachInbox = evaluatorDrafts.attachJobs(jobCtx.jobs)
        return () => {
          detachInbox()
          detachController()
        }
      }, 'dsh-evolve.evaluatorDraftJobs')
    })
  }
  if (config.supervisor !== undefined && config.supervisor.runRoots.length > 0) {
    // Jobs is optional for the base release kernel. A configured supervisor activates
    // only when the host composes the native process-local Jobs service.
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.jobs.attachController('dsh-evolve-shadow-supervisor')
      const detachFeedbackShadow = feedbackShadow?.attachJobs(jobCtx.jobs)
      const canary = automatic === undefined || review === undefined
        ? undefined
        : new CounterfactualCanary({
            inbox: review.inbox,
            outcomes: deliveryOutcomes,
            runner: createCanaryJobRunner(
              jobCtx.jobs,
              createSealedCanaryRunner(source, store),
            ),
            store,
          })
      const automaticRetention = retentionTargets.length === 0
        || retentionEvidence === undefined
        || automaticPreflight === undefined
        || review === undefined
        ? undefined
        : new AutomaticRetentionService({
            evidence: retentionEvidence,
            inbox: review.inbox,
            preflight: automaticPreflight,
            runner: createAutomaticRetentionJobRunner(jobCtx.jobs),
            targets: retentionTargets,
          })
      const automaticAfterScan = automaticFeedback === undefined
        && automaticEvaluator === undefined
        && automatic === undefined
        ? undefined
        : async (signal: AbortSignal, workspaceId: string) => {
            const feedbackResult = await automaticFeedback?.scanOnce(workspaceId)
            for (const warning of feedbackResult?.warnings ?? []) {
              jobCtx.logger.warn(`dsh-evolve automatic Feedback Shadow skipped signal: ${warning}`)
            }
            const evaluatorResult = await automaticEvaluator?.scanOnce(workspaceId)
            for (const warning of evaluatorResult?.warnings ?? []) {
              jobCtx.logger.warn(`dsh-evolve Automatic Evaluator Draft skipped signal: ${warning}`)
            }
            if (automatic === undefined) return
            const retentionResult = await automaticRetention?.scanOnce(signal, workspaceId)
            for (const warning of retentionResult?.warnings ?? []) {
              jobCtx.logger.warn(`dsh-evolve automatic Retention skipped evidence: ${warning}`)
            }
            const result = await automatic.scanOnce(workspaceId)
            for (const warning of result.warnings) {
              jobCtx.logger.warn(`dsh-evolve automatic promotion skipped evidence: ${warning}`)
            }
            const canaryResult = await canary!.scanOnce(signal, workspaceId)
            for (const warning of canaryResult.warnings) {
              jobCtx.logger.warn(`dsh-evolve counterfactual canary skipped evidence: ${warning}`)
            }
            for (const reviewed of canaryResult.reviewed) {
              jobCtx.logger.warn(
                `dsh-evolve counterfactual canary requires review for Generation ${reviewed.generationId}: ${reviewed.reason}`,
              )
            }
            for (const rollback of canaryResult.rolledBack) {
              jobCtx.logger.warn(
                `dsh-evolve counterfactual canary rolled back Generation ${rollback.previousId}`,
              )
            }
          }
      const afterScan = async (signal: AbortSignal, workspaceId: string): Promise<void> => {
        try {
          await automaticAfterScan?.(signal, workspaceId)
        } finally {
          ctx.emit('evoforge/evolution/settled')
        }
      }
      const supervisor = new ShadowSupervisor({
        runRoots: config.supervisor!.runRoots,
        scanIntervalMs: config.supervisor!.scanIntervalMs ?? 30_000,
        pausedWorkspaces: [...new Set([
          ...shadowTargets.map(target => target.workspaceId),
          ...evaluatorTargets.map(target => target.workspaceId),
          ...retentionTargets.map(target => target.workspaceId),
        ])].filter(workspaceId => resident!.isPaused(workspaceId)),
        afterScan,
        runner: createShadowJobRunner(jobCtx.jobs, runShadow),
        onError: (error, path) => {
          jobCtx.logger.warn(`dsh-evolve supervisor skipped ${path}: ${String(error)}`)
        },
      })
      jobCtx.effect(() => {
        const detach = resident!.attach(supervisor)
        supervisor.start()
        return async () => {
          detachFeedbackShadow?.()
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
export type { GitSkillSourceConfig } from './git-skill-source.ts'
export type { SkillCandidateEvaluationPolicyConfig } from './skill-evaluation-envelope.ts'
export type { FeedbackShadowTargetConfig } from './feedback-shadow-launcher.ts'
export type { AutomaticFeedbackShadowTargetReference } from './automatic-feedback-shadow.ts'
export type { AutomaticEvaluatorDraftTargetReference } from './automatic-evaluator-draft.ts'
export type { SkillOpportunityAuthoringPolicyConfig } from './slow-loop-skill-authoring.ts'
export type { AutomaticRetentionTargetConfig } from './automatic-retention.ts'
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
export type { EvolutionControlPlaneModules } from './evolution-control-plane.ts'
export { EvolutionRemoteService } from './evolution-remote.ts'
export type { EvolutionRemoteTypertContract } from './evolution-remote.typert.ts'
export type {
  EvolutionActionReceipt,
  EvolutionArtifactView,
  EvolutionEvaluatorDraftView,
  EvolutionGenerationView,
  EvolutionInactiveGenerationView,
  EvolutionOverview,
  EvolutionReviewCaseView,
  EvolutionReviewDetail,
  EvolutionReviewView,
} from './control-types.ts'
