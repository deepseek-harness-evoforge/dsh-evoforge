import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { installGenerationBinder } from './generation-binder.ts'
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
import { AutoPromotionPolicy, AutoPromotionService } from './auto-promotion.ts'
import {
  installDeliveryOutcomeMonitor,
  openDeliveryOutcomeStore,
  type DeliveryOutcomeMonitor,
} from './delivery-outcome-monitor.ts'
import { CounterfactualCanary } from './counterfactual-canary.ts'
import { createCanaryJobRunner } from './counterfactual-canary-job.ts'
import { createSealedCanaryRunner } from './sealed-canary-runner.ts'
import {
  installFeedbackSignalMonitor,
  openFeedbackSignalStore,
} from './feedback-signal-monitor.ts'
import { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    'evoforge.evolution': EvolutionStore
  }
}

export const name = 'dsh-evolve'
export const inject = ['storageDomain']

export interface Config {
  cacheRoot?: string
  feedbackDraftRoot?: string
  sources?: GitSkillSourceConfig[]
  supervisor?: {
    runRoots: string[]
    scanIntervalMs?: number
  }
  autoPromote?: {
    skills: string[]
  }
}

export const Config: Schema<Config> = z.object({
  cacheRoot: z.string(),
  feedbackDraftRoot: z.string(),
  sources: z.array(z.object({
    name: z.string().required(),
    repository: z.string().required(),
    path: z.string().required(),
  })).default([]),
  supervisor: z.object({
    runRoots: z.array(z.string()).default([]),
    scanIntervalMs: z.number().step(1).min(1_000).default(30_000),
  }),
  autoPromote: z.object({
    skills: z.array(z.string()).default([]),
  }),
})

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const source = new GitSkillSource(
    config.cacheRoot ?? join(homedir(), '.dsh', 'evoforge', 'git-skills'),
    config.sources ?? [],
  )
  const store = new VerifiedEvolutionStore(await openEvolutionStore(ctx.storageDomain), source)
  const deliveryOutcomes = await openDeliveryOutcomeStore(ctx.storageDomain)
  const feedbackSignals = await openFeedbackSignalStore(ctx.storageDomain)
  const feedbackMonitor = installFeedbackSignalMonitor(ctx, feedbackSignals, store)
  let feedbackDraftBuilder: FeedbackCaseDraftBuilder | undefined
  const deliveryMonitors = new Set<DeliveryOutcomeMonitor>()
  ctx.provide('evoforge.evolution', store)
  const disposeBinder = installGenerationBinder(ctx, store, source)
  const review = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : {
        inbox: new ReviewInbox(config.supervisor.runRoots),
        publisher: new CandidatePublisher(store, source),
      }
  const resident = config.supervisor === undefined || config.supervisor.runRoots.length === 0
    ? undefined
    : new ResidentEvolutionControl(store)
  const automaticSkills = config.autoPromote?.skills ?? []
  if (automaticSkills.length > 0 && review === undefined) {
    throw new Error('automatic promotion requires configured supervisor.runRoots')
  }
  const automaticPolicy = automaticSkills.length === 0
    ? undefined
    : new AutoPromotionPolicy(source, store, automaticSkills)
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
        create: (signalId: string, skillName: string) => {
          if (feedbackDraftBuilder === undefined) {
            throw new Error(
              'native message feedback and Session persistence are not composed for Feedback Case Draft creation',
            )
          }
          return feedbackDraftBuilder.create(signalId, skillName)
        },
      }
  installEvolutionCommand(ctx, store, {
    ...(review === undefined ? {} : { review }),
    ...(resident === undefined ? {} : { resident }),
    ...(automaticPolicy === undefined ? {} : { automatic: automaticPolicy }),
    outcomes: deliveryOutcomes,
    feedback: feedbackSignals,
    ...(feedbackDraft === undefined ? {} : { feedbackDraft }),
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
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      const monitor = installDeliveryOutcomeMonitor(toolCtx, deliveryOutcomes, store)
      deliveryMonitors.add(monitor)
      return async () => {
        await monitor.dispose()
        deliveryMonitors.delete(monitor)
      }
    }, 'dsh-evolve.deliveryOutcomeMonitor')
  })
  if (config.supervisor !== undefined && config.supervisor.runRoots.length > 0) {
    // Jobs is optional for the base release kernel. A configured supervisor activates
    // only when the host composes the native process-local Jobs service.
    ctx.inject(['jobs'], (jobCtx) => {
      jobCtx.jobs.attachController('dsh-evolve-shadow-supervisor')
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
      const supervisor = new ShadowSupervisor({
        runRoots: config.supervisor!.runRoots,
        scanIntervalMs: config.supervisor!.scanIntervalMs ?? 30_000,
        paused: resident!.isPaused(),
        ...automatic === undefined ? {} : {
          afterScan: async (signal) => {
            const result = await automatic.scanOnce()
            for (const warning of result.warnings) {
              jobCtx.logger.warn(`dsh-evolve automatic promotion skipped evidence: ${warning}`)
            }
            const canaryResult = await canary!.scanOnce(signal)
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
          },
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
    await Promise.all([...deliveryMonitors].map(monitor => monitor.dispose()))
    await feedbackMonitor.dispose()
    await deliveryOutcomes.close()
    await feedbackSignals.close()
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
