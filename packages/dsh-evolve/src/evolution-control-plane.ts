import type { AutoPromotionPolicy } from './auto-promotion.ts'
import type { CandidatePublisher } from './candidate-publisher.ts'
import type { DeliveryOutcomeStore } from './delivery-outcome-monitor.ts'
import type { FeedbackSignal, FeedbackSignalStore } from './feedback-signal-monitor.ts'
import type { FeedbackShadowLauncher } from './feedback-shadow-launcher.ts'
import type { EvaluatorDraftInbox } from './evaluator-draft-inbox.ts'
import type { AutomaticFeedbackShadowService } from './automatic-feedback-shadow.ts'
import type { AutomaticEvaluatorDraftService } from './automatic-evaluator-draft.ts'
import type { CapabilityGapStore } from './capability-gap-store.ts'
import type { EvolutionStore } from './generation-store.ts'
import type { ResidentEvolutionControl } from './resident-evolution-control.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type {
  EvolutionActionReceipt,
  EvolutionCapabilityMapView,
  EvolutionCapabilityGapQueueView,
  EvolutionEvaluatorDraftView,
  EvolutionFeedbackSignalView,
  EvolutionGenerationView,
  EvolutionEvaluatorDraftDetail,
  EvolutionOverview,
  EvolutionReviewDetail,
  EvolutionReviewView,
} from './control-types.ts'

const MAX_REVIEW_ROWS = 20
const MAX_FEEDBACK_ROWS = 20
const MAX_CAPABILITY_GAP_ROWS = 20

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
  readonly evaluatorDrafts?: Pick<EvaluatorDraftInbox, 'available' | 'targets' | 'scan' | 'get' | 'author' | 'approve' | 'approveAndStartShadow' | 'reject' | 'startShadow'>
  readonly capabilities?: {
    readonly snapshot: (workspaceId: string, sessionId?: string) => EvolutionCapabilityMapView
  }
  readonly gaps?: Pick<CapabilityGapStore, 'list'>
}

/** A structured adapter surface that delegates to the same owners as Commands. */
export class EvolutionControlPlane {
  private readonly modules: EvolutionControlPlaneModules

  constructor(modules: EvolutionControlPlaneModules) {
    this.modules = modules
  }

  async overview(workspaceId: string, sessionId?: string): Promise<EvolutionOverview> {
    const active = this.modules.store.getActiveGeneration(workspaceId)
    const [
      scan,
      shadowScan,
      evaluatorScan,
      automaticFeedbackBudget,
      automaticEvaluatorBudget,
    ] = await Promise.all([
      this.modules.review === undefined ? undefined : this.modules.review.inbox.scanAll(),
      this.modules.feedbackShadow === undefined ? undefined : this.modules.feedbackShadow.scan(workspaceId),
      this.modules.evaluatorDrafts === undefined ? undefined : this.modules.evaluatorDrafts.scan(workspaceId),
      this.modules.automaticFeedback === undefined
        ? undefined
        : this.modules.automaticFeedback.budgetStatus(workspaceId),
      this.modules.automaticEvaluator === undefined
        ? undefined
        : this.modules.automaticEvaluator.budgetStatus(workspaceId),
    ])
    const automaticSkills = this.modules.automatic?.skills(workspaceId) ?? []
    return {
      schemaVersion: 1,
      ...(active === undefined ? {} : { active: projectGeneration(active) }),
      workspaceId,
      recovery: this.modules.resident === undefined
        ? { available: false }
        : { available: true, paused: this.modules.resident.isPaused(workspaceId) },
      automaticPromotion: {
        enabled: automaticSkills.length > 0,
        skills: [...automaticSkills],
      },
      ...(this.modules.capabilities === undefined
        ? {}
        : { capabilityMap: cloneCapabilityMap(this.modules.capabilities.snapshot(workspaceId, sessionId)) }),
      ...(this.modules.gaps === undefined
        ? {}
        : { capabilityGaps: projectCapabilityGaps(this.modules.gaps.list(workspaceId)) }),
      ...(this.modules.outcomes === undefined
        ? {}
        : {
            deliveryOutcomes: cloneOutcomeSummary(this.modules.outcomes.summarize(
              workspaceId,
              active?.id,
              active === undefined
                ? undefined
                : active.parentId === undefined ? {} : { baselineGenerationId: active.parentId },
            )),
          }),
      ...(this.modules.feedback === undefined
        ? {}
        : { feedbackSignals: { ...this.modules.feedback.summarize(workspaceId, active?.id) } }),
      ...(this.modules.feedbackShadow === undefined
        ? {}
        : {
            feedbackShadow: {
              available: this.modules.feedbackShadow.available(),
              warningCount: shadowScan?.warningCount ?? 0,
              signals: projectFeedbackSignals(
                this.modules.feedback?.list(workspaceId) ?? [],
                this.modules.feedbackShadow.targets(),
                this.modules.store,
              ),
              targets: this.modules.feedbackShadow.targets()
                .filter(target => target.workspaceId === workspaceId)
                .map(target => ({ ...target })),
              runs: (shadowScan?.runs ?? [])
                .filter(run => run.workspaceId === workspaceId)
                .map(run => ({ ...run })),
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
              actionableCount: (evaluatorScan?.drafts ?? [])
                .filter(draft => isActionableEvaluatorStatus(draft.status)).length,
              warningCount: evaluatorScan?.warningCount ?? 0,
              signals: projectFeedbackSignals(
                this.modules.feedback?.list(workspaceId) ?? [],
                this.modules.evaluatorDrafts.targets(),
                this.modules.store,
              ),
              targets: this.modules.evaluatorDrafts.targets()
                .filter(target => target.workspaceId === workspaceId)
                .map(target => ({ ...target })),
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
            ...projectReviews(scan, active?.id, workspaceId),
          },
    }
  }

  async review(workspaceId: string, id: string): Promise<EvolutionReviewDetail> {
    const review = this.requireReview()
    const candidate = await review.inbox.get(id)
    assertWorkspace(candidate.workspaceId, workspaceId, 'Review Candidate')
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

  async pause(workspaceId: string): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.pause(workspaceId)
    return { schemaVersion: 1, workspaceId, action: 'pause', recoveryPaused: resident.isPaused(workspaceId) }
  }

  async resume(workspaceId: string): Promise<EvolutionActionReceipt> {
    const resident = this.requireResident()
    await resident.resume(workspaceId)
    return { schemaVersion: 1, workspaceId, action: 'resume', recoveryPaused: resident.isPaused(workspaceId) }
  }

  async approveReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    const review = this.requireReview()
    assertWorkspace((await review.inbox.get(id)).workspaceId, workspaceId, 'Review Candidate')
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
      workspaceId,
      action: 'approve-review',
      reviewId: approved.id,
      generationId: approved.generationId,
      status: 'approved',
    }
  }

  async rejectReview(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    const inbox = this.requireReview().inbox
    assertWorkspace((await inbox.get(id)).workspaceId, workspaceId, 'Review Candidate')
    const rejected = await inbox.reject(id, note)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'reject-review',
      reviewId: rejected.id,
      status: 'rejected',
    }
  }

  async promote(workspaceId: string, generationId: string): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.promoteGeneration(workspaceId, generationId)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'promote',
      ...(result.previousId === undefined ? {} : { previousGenerationId: result.previousId }),
      activeGenerationId: result.generation.id,
    }
  }

  async rollback(workspaceId: string): Promise<EvolutionActionReceipt> {
    const result = await this.modules.store.rollbackGeneration(workspaceId)
    return {
      schemaVersion: 1,
      workspaceId,
      action: 'rollback',
      previousGenerationId: result.previousId,
      ...(result.generation === undefined ? {} : { activeGenerationId: result.generation.id }),
    }
  }

  async startFeedbackShadow(workspaceId: string, signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    if (this.modules.feedbackShadow === undefined) {
      throw new Error('feedback Shadow is not configured')
    }
    return this.modules.feedbackShadow.launch(workspaceId, signalId, targetId)
  }

  async evaluatorDraft(workspaceId: string, id: string): Promise<EvolutionEvaluatorDraftDetail> {
    const draft = await this.requireEvaluatorDrafts().get(workspaceId, id)
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

  async authorEvaluator(workspaceId: string, signalId: string, targetId: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().author(workspaceId, signalId, targetId)
  }

  async approveEvaluator(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().approve(workspaceId, id, note)
  }

  async approveAndStartEvaluatorShadow(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().approveAndStartShadow(workspaceId, id, note)
  }

  async rejectEvaluator(workspaceId: string, id: string, note: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().reject(workspaceId, id, note)
  }

  async startEvaluatorShadow(workspaceId: string, id: string): Promise<EvolutionActionReceipt> {
    return this.requireEvaluatorDrafts().startShadow(workspaceId, id)
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

function cloneCapabilityMap(map: EvolutionCapabilityMapView): EvolutionCapabilityMapView {
  return {
    status: map.status,
    ...(map.catalogHash === undefined ? {} : { catalogHash: map.catalogHash }),
    capabilities: map.capabilities.map(capability => ({
      ...capability,
      invocation: { ...capability.invocation },
    })),
  }
}

function projectCapabilityGaps(
  gaps: ReturnType<CapabilityGapStore['list']>,
): EvolutionCapabilityGapQueueView {
  return {
    confirmedCount: gaps.filter(gap => gap.status === 'confirmed').length,
    items: gaps.slice(0, MAX_CAPABILITY_GAP_ROWS).map(gap => ({
      id: gap.id,
      observedAt: gap.observedAt,
      requestedSkill: gap.requestedSkill,
      catalogHash: gap.catalogHash,
      catalogSize: gap.catalogSize,
      ...(gap.generationId === undefined ? {} : { generationId: gap.generationId }),
      ...(gap.goal === undefined ? {} : { goal: { ...gap.goal } }),
      status: gap.status,
      evidence: { ...gap.evidence },
    })),
  }
}

function projectFeedbackSignals(
  signals: readonly FeedbackSignal[],
  targets: readonly { readonly id: string; readonly workspaceId: string; readonly skillName: string }[],
  store: Pick<EvolutionStore, 'getGeneration'>,
): EvolutionFeedbackSignalView[] {
  return signals
    .slice(-MAX_FEEDBACK_ROWS)
    .reverse()
    .map((signal) => {
      const generation = signal.generationId === undefined
        ? undefined
        : store.getGeneration(signal.generationId)
      const skillNames = generation === undefined || generation.workspaceId !== signal.workspaceId
        ? new Set<string>()
        : new Set(generation.artifacts.map(artifact => artifact.name))
      return {
        id: signal.id,
        workspaceId: signal.workspaceId,
        sourceUpdatedAt: signal.sourceUpdatedAt,
        ...(signal.generationId === undefined ? {} : { generationId: signal.generationId }),
        eligibleTargetIds: targets
          .filter(target => target.workspaceId === signal.workspaceId && skillNames.has(target.skillName))
          .map(target => target.id),
      }
    })
}

function isActionableEvaluatorStatus(status: EvolutionEvaluatorDraftView['status']): boolean {
  return ['uncertain', 'draft-ready', 'qualification-running', 'incomplete'].includes(status)
}

function projectReviews(
  all: Awaited<ReturnType<ReviewInbox['scanAll']>>,
  activeGenerationId: string | undefined,
  workspaceId: string,
): EvolutionOverview['reviews'] {
  const workspaceCandidates = all.candidates.filter(candidate => candidate.workspaceId === workspaceId)
  const actionable = workspaceCandidates.filter(candidate => candidate.status === 'pending'
    || (candidate.status === 'approved'
      && candidate.decisionActor === 'auto-clear-instruction-v1'
      && candidate.activatedAt === undefined))
  const inactiveGenerations = workspaceCandidates
    .filter(candidate => candidate.status === 'approved'
      && candidate.generationId !== undefined
      && candidate.generationId !== activeGenerationId)
    .slice(-MAX_REVIEW_ROWS)
    .reverse()
    .map(candidate => ({
      workspaceId: candidate.workspaceId,
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
    workspaceId: generation.workspaceId,
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
    workspaceId: candidate.workspaceId,
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
    ...(candidate.automaticReviewExpiry === undefined
      ? {}
      : { automaticReviewExpiry: { ...candidate.automaticReviewExpiry } }),
    ...(candidate.decisionActor === undefined ? {} : { decisionActor: candidate.decisionActor }),
    ...(candidate.decisionNote === undefined ? {} : { decisionNote: candidate.decisionNote }),
    ...(candidate.generationId === undefined ? {} : { generationId: candidate.generationId }),
    ...(candidate.activatedAt === undefined ? {} : { activatedAt: candidate.activatedAt }),
  }
}

function cloneOutcomeSummary(summary: ReturnType<DeliveryOutcomeStore['summarize']>) {
  return {
    all: { ...summary.all },
    selected: { ...summary.selected },
    ...(summary.baseline === undefined ? {} : { baseline: { ...summary.baseline } }),
  }
}

function assertWorkspace(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} belongs to Workspace '${actual}', not '${expected}'`)
  }
}
