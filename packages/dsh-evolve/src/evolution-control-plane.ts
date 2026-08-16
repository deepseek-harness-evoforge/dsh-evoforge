import type { AutoPromotionPolicy } from './auto-promotion.ts'
import type { CandidatePublisher } from './candidate-publisher.ts'
import type { DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type { FeedbackShadowLauncher } from './feedback-shadow-launcher.ts'
import type { EvaluatorDraftInbox } from './evaluator-draft-inbox.ts'
import type { AutomaticFeedbackShadowService } from './automatic-feedback-shadow.ts'
import type { AutomaticEvaluatorDraftService } from './automatic-evaluator-draft.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { ResidentEvolutionControl } from './resident-evolution-control.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type {
  EvolutionActionReceipt,
  EvolutionGenerationView,
  EvolutionEvaluatorDraftDetail,
  EvolutionOverview,
  EvolutionReviewDetail,
  EvolutionReviewView,
} from './control-types.ts'

const MAX_REVIEW_ROWS = 20
const MAX_FEEDBACK_ROWS = 20

/** Existing authoritative owners used by Commands and structured adapters. */
export interface EvolutionControlPlaneModules {
  readonly store: EvolutionStore
  readonly review?: {
    readonly inbox: Pick<ReviewInbox, 'scanAll' | 'get' | 'approve' | 'reject'>
    readonly publisher: Pick<CandidatePublisher, 'preview' | 'publish'>
  }
  readonly resident?: Pick<ResidentEvolutionControl, 'isPaused' | 'pause' | 'resume'>
  readonly automatic?: Pick<AutoPromotionPolicy, 'evaluate' | 'skills'>
  readonly outcomes?: Pick<DeliveryOutcomeStore, 'summarize'>
  readonly feedback?: Pick<FeedbackSignalStore, 'list' | 'summarize'>
  readonly feedbackShadow?: Pick<FeedbackShadowLauncher, 'available' | 'targets' | 'scan' | 'launch'>
  readonly automaticFeedback?: Pick<AutomaticFeedbackShadowService, 'budgetStatus'>
  readonly automaticEvaluator?: Pick<AutomaticEvaluatorDraftService, 'budgetStatus'>
  readonly evaluatorDrafts?: Pick<EvaluatorDraftInbox, 'available' | 'targets' | 'scan' | 'get' | 'author' | 'approve' | 'reject' | 'startShadow'>
}

/** A structured adapter surface that delegates to the same owners as Commands. */
export class EvolutionControlPlane {
  private readonly modules: EvolutionControlPlaneModules

  constructor(modules: EvolutionControlPlaneModules) {
    this.modules = modules
  }

  async overview(): Promise<EvolutionOverview> {
    const active = this.modules.store.getActiveGeneration()
    const [
      scan,
      shadowScan,
      evaluatorScan,
      automaticFeedbackBudget,
      automaticEvaluatorBudget,
    ] = await Promise.all([
      this.modules.review === undefined ? undefined : this.modules.review.inbox.scanAll(),
      this.modules.feedbackShadow === undefined ? undefined : this.modules.feedbackShadow.scan(),
      this.modules.evaluatorDrafts === undefined ? undefined : this.modules.evaluatorDrafts.scan(),
      this.modules.automaticFeedback === undefined
        ? undefined
        : this.modules.automaticFeedback.budgetStatus(),
      this.modules.automaticEvaluator === undefined
        ? undefined
        : this.modules.automaticEvaluator.budgetStatus(),
    ])
    const automaticSkills = this.modules.automatic?.skills() ?? []
    return {
      schemaVersion: 1,
      ...(active === undefined ? {} : { active: projectGeneration(active) }),
      recovery: this.modules.resident === undefined
        ? { available: false }
        : { available: true, paused: this.modules.resident.isPaused() },
      automaticPromotion: {
        enabled: automaticSkills.length > 0,
        skills: [...automaticSkills],
      },
      ...(this.modules.outcomes === undefined
        ? {}
        : { deliveryOutcomes: cloneOutcomeSummary(this.modules.outcomes.summarize(active?.id)) }),
      ...(this.modules.feedback === undefined
        ? {}
        : { feedbackSignals: { ...this.modules.feedback.summarize(active?.id) } }),
      ...(this.modules.feedbackShadow === undefined
        ? {}
        : {
            feedbackShadow: {
              available: this.modules.feedbackShadow.available(),
              warningCount: shadowScan?.warningCount ?? 0,
              signals: (this.modules.feedback?.list() ?? [])
                .slice(-MAX_FEEDBACK_ROWS)
                .reverse()
                .map(signal => ({
                  id: signal.id,
                  sourceUpdatedAt: signal.sourceUpdatedAt,
                  ...(signal.generationId === undefined ? {} : { generationId: signal.generationId }),
                })),
              targets: this.modules.feedbackShadow.targets().map(target => ({ ...target })),
              runs: (shadowScan?.runs ?? []).map(run => ({ ...run })),
            },
          }),
      ...(automaticFeedbackBudget === undefined
        ? {}
        : {
            automaticFeedbackBudget: {
              warningCount: automaticFeedbackBudget.warningCount,
              targets: automaticFeedbackBudget.targets.map(target => ({ ...target })),
            },
          }),
      ...(automaticEvaluatorBudget === undefined
        ? {}
        : {
            automaticEvaluatorBudget: {
              warningCount: automaticEvaluatorBudget.warningCount,
              targets: automaticEvaluatorBudget.targets.map(target => ({ ...target })),
            },
          }),
      ...(this.modules.evaluatorDrafts === undefined
        ? {}
        : {
            evaluatorAuthoring: {
              available: this.modules.evaluatorDrafts.available(),
              warningCount: evaluatorScan?.warningCount ?? 0,
              signals: (this.modules.feedback?.list() ?? [])
                .slice(-MAX_FEEDBACK_ROWS)
                .reverse()
                .map(signal => ({
                  id: signal.id,
                  sourceUpdatedAt: signal.sourceUpdatedAt,
                  ...(signal.generationId === undefined ? {} : { generationId: signal.generationId }),
                })),
              targets: this.modules.evaluatorDrafts.targets().map(target => ({ ...target })),
              drafts: (evaluatorScan?.drafts ?? []).map(draft => ({
                ...draft,
                cost: { ...draft.cost },
              })),
            },
          }),
      reviews: scan === undefined
        ? {
            available: false,
            pendingCount: 0,
            actionableCount: 0,
            warningCount: 0,
            items: [],
            inactiveGenerations: [],
          }
        : {
            ...projectReviews(scan, active?.id),
          },
    }
  }

  async review(id: string): Promise<EvolutionReviewDetail> {
    const review = this.requireReview()
    const candidate = await review.inbox.get(id)
    const diff = await review.publisher.preview(candidate)
    const automatic = this.modules.automatic === undefined
      ? undefined
      : await this.modules.automatic.evaluate(candidate)
    return {
      schemaVersion: 1,
      review: projectReview(candidate),
      diff: {
        patch: diff.patch,
        shownBytes: diff.shownBytes,
        totalBytes: diff.totalBytes,
        truncated: diff.truncated,
        impact: {
          version: diff.impact.version,
          scope: diff.impact.scope,
          indicators: [...diff.impact.indicators],
        },
      },
      ...(automatic === undefined
        ? {}
        : { automatic: {
            eligible: automatic.eligible,
            policyVersion: automatic.policyVersion,
            reasons: [...automatic.reasons],
          } }),
    }
  }

  async pause(): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.pause()
    return { schemaVersion: 1, action: 'pause', recoveryPaused: resident.isPaused() }
  }

  async resume(): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.resume()
    return { schemaVersion: 1, action: 'resume', recoveryPaused: resident.isPaused() }
  }

  async approveReview(id: string, note: string): Promise<EvolutionActionReceipt> {
    const review = this.requireReview()
    const approved = await review.inbox.approve(
      id,
      note,
      candidate => review.publisher.publish(candidate),
    )
    if (approved.generationId === undefined) {
      throw new Error('approved review has no inactive Generation id')
    }
    return {
      schemaVersion: 1,
      action: 'approve-review',
      reviewId: approved.id,
      generationId: approved.generationId,
      status: 'approved',
    }
  }

  async rejectReview(id: string, note: string): Promise<EvolutionActionReceipt> {
    const rejected = await this.requireReview().inbox.reject(id, note)
    return {
      schemaVersion: 1,
      action: 'reject-review',
      reviewId: rejected.id,
      status: 'rejected',
    }
  }

  async promote(generationId: string): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.promoteGeneration(generationId)
    return {
      schemaVersion: 1,
      action: 'promote',
      ...(result.previousId === undefined ? {} : { previousGenerationId: result.previousId }),
      activeGenerationId: result.generation.id,
    }
  }

  async rollback(): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.rollbackGeneration()
    return {
      schemaVersion: 1,
      action: 'rollback',
      previousGenerationId: result.previousId,
      ...(result.generation === undefined ? {} : { activeGenerationId: result.generation.id }),
    }
  }

  async startFeedbackShadow(signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    if (this.modules.feedbackShadow === undefined) {
      throw new Error('feedback Shadow is not configured')
    }
    return this.modules.feedbackShadow.launch(signalId, targetId)
  }

  async evaluatorDraft(id: string): Promise<EvolutionEvaluatorDraftDetail> {
    const draft = await this.requireEvaluatorDrafts().get(id)
    const { files, limitations, qualifiedShadowAvailable, decision, qualification, reason, ...view } = draft
    return {
      schemaVersion: 1,
      draft: { ...view, cost: { ...view.cost } },
      files: files.map(file => ({ ...file })),
      limitations: [...limitations],
      qualifiedShadowAvailable,
      ...(decision === undefined ? {} : { decision: { ...decision } }),
      ...(qualification === undefined ? {} : { qualification: { ...qualification } }),
      ...(reason === undefined ? {} : { reason }),
    }
  }

  async authorEvaluator(signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().author(signalId, targetId)
  }

  async approveEvaluator(id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().approve(id, note)
  }

  async rejectEvaluator(id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().reject(id, note)
  }

  async startEvaluatorShadow(id: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().startShadow(id)
  }

  private requireReview(): NonNullable<EvolutionControlPlaneModules['review']> {
    if (this.modules.review === undefined) {
      throw new Error('review inbox is not configured')
    }
    return this.modules.review
  }

  private requireResident(): NonNullable<EvolutionControlPlaneModules['resident']> {
    if (this.modules.resident === undefined) {
      throw new Error('resident recovery is not configured')
    }
    return this.modules.resident
  }

  private requireEvaluatorDrafts(): NonNullable<EvolutionControlPlaneModules['evaluatorDrafts']> {
    if (this.modules.evaluatorDrafts === undefined) {
      throw new Error('evaluator authoring is not configured')
    }
    return this.modules.evaluatorDrafts
  }
}

function projectReviews(
  all: Awaited<ReturnType<ReviewInbox['scanAll']>>,
  activeGenerationId: string | undefined,
): EvolutionOverview['reviews'] {
  const actionable = all.candidates.filter(candidate => candidate.status === 'pending'
    || (candidate.status === 'approved'
      && candidate.decisionActor === 'auto-clear-instruction-v1'
      && candidate.activatedAt === undefined))
  const inactiveGenerations = all.candidates
    .filter(candidate => candidate.status === 'approved'
      && candidate.generationId !== undefined
      && candidate.generationId !== activeGenerationId)
    .slice(-MAX_REVIEW_ROWS)
    .reverse()
    .map(candidate => ({
      generationId: candidate.generationId!,
      reviewId: candidate.id,
      skillName: candidate.skillName,
    }))
  return {
    available: true,
    pendingCount: actionable.filter(item => item.status === 'pending').length,
    actionableCount: actionable.length,
    warningCount: all.warnings.length,
    items: actionable.slice(0, MAX_REVIEW_ROWS).map(projectReview),
    inactiveGenerations,
  }
}

function projectGeneration(generation: ReturnType<EvolutionStore['getActiveGeneration']> & {}): EvolutionGenerationView {
  return {
    id: generation.id,
    ...(generation.parentId === undefined ? {} : { rollbackTargetId: generation.parentId }),
    createdAt: generation.createdAt,
    evaluatorVersion: generation.evaluatorVersion,
    policyVersion: generation.policyVersion,
    artifacts: generation.artifacts.map(artifact => ({ ...artifact })),
  }
}

function projectReview(candidate: ReviewCandidate): EvolutionReviewView {
  return {
    id: candidate.id,
    status: candidate.status,
    recommendation: candidate.recommendation,
    skillName: candidate.skillName,
    claim: candidate.claim,
    changedFiles: [...candidate.changedFiles],
    candidateTreeHash: candidate.candidateTreeHash,
    cases: candidate.cases.map(item => ({ ...item })),
    cost: { ...candidate.cost },
    reasons: [...candidate.reasons],
    limitations: [...candidate.limitations],
    evaluatorVersion: candidate.evaluatorVersion,
    compositionFingerprint: candidate.compositionFingerprint,
    compositionStable: candidate.compositionStable,
    startedAt: candidate.startedAt,
    ...(candidate.decisionActor === undefined ? {} : { decisionActor: candidate.decisionActor }),
    ...(candidate.decisionNote === undefined ? {} : { decisionNote: candidate.decisionNote }),
    ...(candidate.generationId === undefined ? {} : { generationId: candidate.generationId }),
    ...(candidate.activatedAt === undefined ? {} : { activatedAt: candidate.activatedAt }),
  }
}

function cloneOutcomeSummary(summary: ReturnType<DeliveryOutcomeStore['summarize']>) {
  return { all: { ...summary.all }, selected: { ...summary.selected } }
}
