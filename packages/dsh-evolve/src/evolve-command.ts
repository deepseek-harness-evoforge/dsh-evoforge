import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'
import type { CandidateDiffPreview, CandidatePublisher } from './candidate-publisher.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type { ResidentEvolutionControl } from './resident-evolution-control.ts'
import type { AutoPromotionPolicy, AutoPromotionPolicyResult } from './auto-promotion.ts'
import type { DeliveryOutcomeStore, DeliveryOutcomeSummary } from './delivery-outcome-monitor.ts'
import type {
  FeedbackSignal,
  FeedbackSignalStore,
  FeedbackSignalSummary,
} from './feedback-signal-monitor.ts'
import type { FeedbackCaseDraftBuilder } from './feedback-case-draft.ts'
import type { FeedbackShadowLauncher } from './feedback-shadow-launcher.ts'
import type { EvaluatorDraftInbox } from './evaluator-draft-inbox.ts'
import type {
  AutomaticFeedbackBudgetStatus,
  AutomaticFeedbackShadowService,
} from './automatic-feedback-shadow.ts'
import type {
  AutomaticEvaluatorBudgetStatus,
  AutomaticEvaluatorDraftService,
} from './automatic-evaluator-draft.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const USAGE = 'Usage: /evolve [status|feedback [<signal-id> [draft|shadow <target>|author <evaluator-target>]]|evaluator [<draft-id> [shadow|qualify-shadow <note>|approve|reject <note>]]|review [<review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]'
const generationIdPattern = /^[a-f0-9]{64}$/

export interface EvolutionCommandModules {
  readonly review?: { inbox: ReviewInbox; publisher: CandidatePublisher }
  readonly resident?: Pick<ResidentEvolutionControl, 'isPaused' | 'pause' | 'resume'>
  readonly automatic?: Pick<AutoPromotionPolicy, 'evaluate' | 'skills'>
  readonly outcomes?: Pick<DeliveryOutcomeStore, 'summarize'>
  readonly feedback?: Pick<FeedbackSignalStore, 'list' | 'summarize'>
  readonly feedbackDraft?: Pick<FeedbackCaseDraftBuilder, 'create'>
  readonly feedbackShadow?: Pick<FeedbackShadowLauncher, 'launch'>
  readonly automaticFeedback?: Pick<AutomaticFeedbackShadowService, 'budgetStatus'>
  readonly automaticEvaluator?: Pick<AutomaticEvaluatorDraftService, 'budgetStatus'>
  readonly evaluatorDrafts?: Pick<EvaluatorDraftInbox, 'author' | 'scan' | 'get' | 'approve' | 'approveAndStartShadow' | 'reject' | 'startShadow'>
}

/** Register the optional human control plane without adding a model Tool. */
export function installEvolutionCommand(
  ctx: Context,
  store: EvolutionStore,
  modules: EvolutionCommandModules = {},
): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'evolve',
      description: 'inspect feedback, review, publish, promote, or roll back immutable capability Generations',
      input: { hint: '[status|feedback ...|review ...|pause|resume|promote <generation-id>|rollback]' },
      handler: async ({ rawInput, agent }) => executeEvolutionCommand(
        store,
        rawInput,
        modules,
        await workspaceIdForCwd(ctx, agent.session.header.cwd),
      ),
    })
  })
}

/** Execute one explicit human action over the verified release store. */
export async function executeEvolutionCommand(
  store: EvolutionStore,
  rawInput: string,
  modules: EvolutionCommandModules = {},
  workspaceId: string,
): Promise<CommandResult> {
  const input = rawInput.trim()
  const { review, resident, automatic, outcomes, feedback, feedbackDraft, feedbackShadow, automaticFeedback, automaticEvaluator, evaluatorDrafts } = modules
  try {
    if (input === '' || input === 'status') {
      const active = store.getActiveGeneration(workspaceId)
      const [automaticFeedbackBudget, automaticEvaluatorBudget] = await Promise.all([
        automaticFeedback?.budgetStatus(workspaceId),
        automaticEvaluator?.budgetStatus(workspaceId),
      ])
      return renderStatus(
        active,
        resident?.isPaused(workspaceId),
        automatic?.skills(workspaceId),
        outcomes?.summarize(
          workspaceId,
          active?.id,
          active === undefined
            ? undefined
            : active.parentId === undefined ? {} : { baselineGenerationId: active.parentId },
        ),
        feedback?.summarize(workspaceId, active?.id),
        automaticFeedbackBudget,
        automaticEvaluatorBudget,
      )
    }
    if (input === 'pause') {
      if (resident === undefined) return residentUnavailable()
      await resident.pause(workspaceId)
      return {
        kind: 'success',
        text: 'Resident evolution recovery paused durably. Active recovery was stopped; normal Sessions and human review remain available.',
      }
    }
    if (input === 'resume') {
      if (resident === undefined) return residentUnavailable()
      await resident.resume(workspaceId)
      return {
        kind: 'success',
        text: 'Resident evolution recovery resumed. Durable Candidate/Trial discovery was awakened.',
      }
    }
    if (input === 'feedback') {
      if (feedback === undefined) return feedbackUnavailable()
      return renderFeedbackList(feedback.list(workspaceId))
    }
    const feedbackShadowAction = /^feedback\s+([a-f0-9]{64})\s+shadow\s+([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(input)
    if (feedbackShadowAction?.[1] !== undefined && feedbackShadowAction[2] !== undefined) {
      if (feedbackShadow === undefined) return feedbackShadowUnavailable()
      const launched = await feedbackShadow.launch(workspaceId, feedbackShadowAction[1], feedbackShadowAction[2])
      return {
        kind: 'success',
        text: launched.jobId === undefined
          ? `Feedback Shadow ${launched.launchId} already has durable status ${launched.runStatus}. No paid request was repeated.`
          : [
              `Feedback Shadow ${launched.launchId} submitted as native Job ${launched.jobId}.`,
              'This explicit action authorized one potentially paid proposer request and disclosure of the bounded private correction.',
              'The originating Session does not wait; inspect the review inbox after completion.',
            ].join('\n'),
      }
    }
    const evaluatorAuthorAction = /^feedback\s+([a-f0-9]{64})\s+author\s+([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(input)
    if (evaluatorAuthorAction?.[1] !== undefined && evaluatorAuthorAction[2] !== undefined) {
      if (evaluatorDrafts === undefined) return evaluatorDraftsUnavailable()
      const authored = await evaluatorDrafts.author(workspaceId, evaluatorAuthorAction[1], evaluatorAuthorAction[2])
      return {
        kind: 'success',
        text: authored.jobId === undefined
          ? `Evaluator authoring ${authored.launchId} has durable status ${authored.draftStatus}. No paid request was repeated.`
          : [
              `Evaluator authoring ${authored.launchId} submitted as native Job ${authored.jobId}.`,
              'This explicit action authorized one potentially paid request and disclosure of the bounded private correction plus exact Skill.',
              'The result stays private and non-executable until a separate human approval.',
            ].join('\n'),
      }
    }
    const feedbackDraftAction = /^feedback\s+([a-f0-9]{64})\s+draft$/u.exec(input)
    if (feedbackDraftAction?.[1] !== undefined) {
      if (feedback === undefined) return feedbackUnavailable()
      if (feedbackDraft === undefined) return feedbackDraftUnavailable()
      const result = await feedbackDraft.create(workspaceId, feedbackDraftAction[1])
      return {
        kind: 'success',
        text: result.created
          ? `Feedback Case Draft created.\nDraft: ${result.draft.id}\nSkill: ${result.draft.target.name} (derived from the exact durable invocation).\nStatus: draft; no replay score or Candidate was created.`
          : `Feedback Case Draft already exists.\nDraft: ${result.draft.id}\nSkill: ${result.draft.target.name} (derived from the exact durable invocation).\nStatus: draft; no replay score or Candidate was created.`,
      }
    }
    const feedbackAction = /^feedback\s+([a-f0-9]{64})$/u.exec(input)
    if (feedbackAction?.[1] !== undefined) {
      if (feedback === undefined) return feedbackUnavailable()
      const signal = feedback.list(workspaceId).find(candidate => candidate.id === feedbackAction[1])
      if (signal === undefined) throw new Error('feedback signal is no longer current')
      return renderFeedback(signal)
    }
    if (input === 'review') {
      if (review === undefined) return reviewUnavailable()
      const scan = await review.inbox.scan()
      return renderReviewList(
        scan.candidates.filter(candidate => candidate.workspaceId === workspaceId),
        scan.warnings.length,
      )
    }
    if (input === 'evaluator') {
      if (evaluatorDrafts === undefined) return evaluatorDraftsUnavailable()
      const scan = await evaluatorDrafts.scan(workspaceId)
      if (scan.drafts.length === 0) {
        return {
          kind: 'success',
          text: `No evaluator drafts.${scan.warningCount === 0 ? '' : ` Skipped ${scan.warningCount} invalid run(s).`}`,
        }
      }
      return {
        kind: 'success',
        text: [
          `Evaluator drafts: ${scan.drafts.length}`,
          ...scan.drafts.map(draft => `- ${draft.id} [${draft.status}] ${draft.skillName}; model calls ${draft.cost.modelCalls}, tokens ${draft.cost.inputTokens}/${draft.cost.outputTokens}`),
          ...scan.warningCount === 0 ? [] : [`Skipped invalid runs: ${scan.warningCount}`],
          '',
          'Inspect: /evolve evaluator <draft-id>',
        ].join('\n'),
      }
    }
    const evaluatorShadowAction = /^evaluator\s+([a-f0-9]{64})\s+shadow$/u.exec(input)
    if (evaluatorShadowAction?.[1] !== undefined) {
      if (evaluatorDrafts === undefined) return evaluatorDraftsUnavailable()
      const launched = await evaluatorDrafts.startShadow(workspaceId, evaluatorShadowAction[1])
      return {
        kind: 'success',
        text: launched.jobId === undefined
          ? `Qualified Shadow ${launched.launchId} has durable status ${launched.runStatus}. No paid request was repeated.`
          : [
              `Qualified Shadow ${launched.launchId} submitted as native Job ${launched.jobId}.`,
              'This explicit action authorized one potentially paid proposer request and disclosure of the bounded private correction.',
              'It does not modify a Skill or authorize Promotion.',
            ].join('\n'),
      }
    }
    const evaluatorQualifyShadowAction = /^evaluator\s+([a-f0-9]{64})\s+qualify-shadow\s+([\s\S]+)$/u.exec(input)
    if (evaluatorQualifyShadowAction?.[1] !== undefined
      && evaluatorQualifyShadowAction[2] !== undefined) {
      if (evaluatorDrafts === undefined) return evaluatorDraftsUnavailable()
      const [,, note] = evaluatorQualifyShadowAction
      if (note.trim() === '') return { kind: 'error', text: USAGE }
      const launched = await evaluatorDrafts.approveAndStartShadow(
        workspaceId,
        evaluatorQualifyShadowAction[1],
        note,
      )
      return {
        kind: 'success',
        text: launched.jobId === undefined
          ? `Evaluator qualification passed and Shadow ${launched.launchId} has durable status ${launched.runStatus}. No paid request was repeated.`
          : [
              `Evaluator qualification passed and Shadow ${launched.launchId} was submitted as native Job ${launched.jobId}.`,
              'This one human action approved exact generated code and authorized one contingent paid Shadow.',
              'It does not modify a Skill or authorize Promotion.',
            ].join('\n'),
      }
    }
    const evaluatorAction = /^evaluator\s+([a-f0-9]{64})(?:\s+(approve|reject)\s+([\s\S]+))?$/u.exec(input)
    if (evaluatorAction?.[1] !== undefined) {
      if (evaluatorDrafts === undefined) return evaluatorDraftsUnavailable()
      const [, id, action, note] = evaluatorAction
      if (action === undefined) {
        const draft = await evaluatorDrafts.get(workspaceId, id)
        return {
          kind: 'success',
          text: [
            `Evaluator Draft ${draft.id}`,
            `Status: ${draft.status}`,
            `Target: ${draft.targetId} / ${draft.skillName}`,
            `Authoring cost: ${draft.cost.modelCalls} model call(s), ${draft.cost.inputTokens} input / ${draft.cost.outputTokens} output tokens`,
            `Limitations: ${draft.limitations.join('; ')}`,
            ...draft.reason === undefined ? [] : [`Reason: ${draft.reason}`],
            ...draft.files.flatMap(file => [`--- ${file.path}`, file.content]),
            '',
            ...draft.status === 'draft-ready'
              ? [
                  `Approve exact hash for sealed qualification: /evolve evaluator ${draft.id} approve <note>`,
                  `Qualify and then start one paid Shadow: /evolve evaluator ${draft.id} qualify-shadow <note>`,
                  `Reject: /evolve evaluator ${draft.id} reject <note>`,
                ]
              : [],
            ...draft.status === 'qualified' && draft.qualifiedShadowAvailable
              ? [`Start one explicit paid Shadow: /evolve evaluator ${draft.id} shadow`]
              : [],
          ].join('\n'),
        }
      }
      if (note === undefined || note.trim() === '') return { kind: 'error', text: USAGE }
      if (action === 'reject') {
        const rejected = await evaluatorDrafts.reject(workspaceId, id, note)
        return {
          kind: 'success',
          text: `Evaluator Draft ${rejected.draftId ?? id} rejected durably. No generated code was executed.`,
        }
      }
      const approved = await evaluatorDrafts.approve(workspaceId, id, note)
      return {
        kind: 'success',
        text: [
          `Evaluator Draft ${approved.draftId ?? id} approved and sealed calibration passed.`,
          'Qualified Case Pack published immutably.',
          'No Skill, Session, Shadow, Candidate, or Generation was changed.',
        ].join('\n'),
      }
    }
    const reviewAction = /^review\s+([a-f0-9]{64})(?:\s+(approve|reject)\s+([\s\S]+))?$/u.exec(input)
    if (reviewAction?.[1] !== undefined) {
      if (review === undefined) return reviewUnavailable()
      const [, id, action, note] = reviewAction
      if (action === undefined) {
        const candidate = await review.inbox.get(id)
        assertWorkspace(candidate.workspaceId, workspaceId, 'Review Candidate')
        const diff = await review.publisher.preview(candidate)
        const automaticDecision = automatic === undefined
          ? undefined
          : await automatic.evaluate(candidate)
        return renderReview(candidate, diff, automaticDecision)
      }
      if (note === undefined || note.trim() === '') return { kind: 'error', text: USAGE }
      assertWorkspace((await review.inbox.get(id)).workspaceId, workspaceId, 'Review Candidate')
      if (action === 'reject') {
        const rejected = await review.inbox.reject(id, note)
        return {
          kind: 'success',
          text: `Review Candidate ${rejected.id} rejected. No Generation was created or activated.`,
        }
      }
      const approved = await review.inbox.approve(
        id,
        note,
        candidate => review.publisher.publish(candidate),
      )
      return {
        kind: 'success',
        text: [
          `Review Candidate ${approved.id} approved.`,
          `Inactive Generation: ${approved.generationId}`,
          'No Session was changed.',
          `Activate for future Sessions: /evolve promote ${approved.generationId}`,
        ].join('\n'),
      }
    }
    if (input === 'rollback') {
      const result = await store.rollbackGeneration(workspaceId)
      return {
        kind: 'success',
        text: [
          'Generation rolled back for future Sessions.',
          `Previous: ${result.previousId}`,
          `Active: ${result.generation?.id ?? 'native DSH'}`,
          'Existing Sessions were not changed.',
        ].join('\n'),
      }
    }
    const promote = /^promote\s+([^\s]+)$/u.exec(input)
    if (promote?.[1] !== undefined && generationIdPattern.test(promote[1])) {
      const result = await store.promoteGeneration(workspaceId, promote[1])
      if (result.previousId === result.generation.id) {
        return {
          kind: 'success',
          text: `Generation ${result.generation.id} is already active. Existing Sessions remain pinned.`,
        }
      }
      return {
        kind: 'success',
        text: [
          'Generation promoted for future Sessions.',
          `Previous: ${result.previousId ?? 'native DSH'}`,
          `Active: ${result.generation.id}`,
          'Existing Sessions were not changed.',
          'Rollback: /evolve rollback',
        ].join('\n'),
      }
    }
    return { kind: 'error', text: USAGE }
  } catch (error) {
    return {
      kind: 'error',
      text: `Evolution action failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function reviewUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Review inbox is not configured. Set dsh-evolve supervisor.runRoots to owned Shadow run roots.',
  }
}

function residentUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Resident recovery is not configured. Set dsh-evolve supervisor.runRoots before using pause/resume.',
  }
}

function feedbackUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Explicit feedback signals are unavailable in this runtime composition.',
  }
}

function assertWorkspace(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label} belongs to Workspace '${actual}', not '${expected}'`)
}

function feedbackDraftUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Feedback Case Draft creation is disabled. Configure a private dsh-evolve feedbackDraftRoot and compose native message feedback plus Session persistence.',
  }
}

function feedbackShadowUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Feedback Shadow launch is disabled. Configure a private feedbackDraftRoot, supervisor run roots, static shadowTargets, and native Jobs.',
  }
}

function evaluatorDraftsUnavailable(): CommandResult {
  return {
    kind: 'error',
    text: 'Evaluator authoring is disabled. Configure a private feedbackDraftRoot, static evaluatorTargets, and native Jobs.',
  }
}

function renderFeedbackList(signals: FeedbackSignal[]): CommandResult {
  if (signals.length === 0) {
    return { kind: 'success', text: 'No current explicit feedback signals.' }
  }
  const visible = [...signals].reverse().slice(0, 20)
  return {
    kind: 'success',
    text: [
      `Current explicit feedback signals: ${signals.length}`,
      ...visible.map(signal =>
        `- ${signal.id} [${signal.generationId ?? 'native DSH'}] Session ${signal.sessionId}, message ${signal.messageId}`),
      ...signals.length > visible.length ? [`- … ${signals.length - visible.length} more`] : [],
      '',
      'Inspect: /evolve feedback <signal-id>',
    ].join('\n'),
  }
}

function renderFeedback(signal: FeedbackSignal): CommandResult {
  return {
    kind: 'success',
    text: [
      `Explicit feedback signal ${signal.id}`,
      `Session: ${signal.sessionId}`,
      `Message: ${signal.messageId}`,
      `Feedback version: ${signal.feedbackVersion}`,
      `Generation: ${signal.generationId ?? 'native DSH'}`,
      'The correction text remains in native DSH feedback authority.',
      'Create a private draft with its Skill derived from durable Session evidence: /evolve feedback <signal-id> draft',
    ].join('\n'),
  }
}

function renderReviewList(candidates: ReviewCandidate[], warningCount: number): CommandResult {
  if (candidates.length === 0) {
    return {
      kind: 'success',
      text: `No pending evolution reviews.${warningCount === 0 ? '' : ` Skipped ${warningCount} invalid run(s).`}`,
    }
  }
  const visible = candidates.slice(0, 20)
  return {
    kind: 'success',
    text: [
      `Pending evolution reviews: ${candidates.length}`,
      ...visible.map(candidate =>
        `- ${candidate.id} [${candidate.status === 'pending' ? '' : `${candidate.status}/`}${candidate.recommendation}] ${candidate.skillName}: ${candidate.claim}${renderReviewWindowSummary(candidate)}`),
      ...candidates.length > visible.length ? [`- … ${candidates.length - visible.length} more`] : [],
      ...warningCount === 0 ? [] : [`Skipped invalid runs: ${warningCount}`],
      '',
      'Inspect: /evolve review <review-id>',
    ].join('\n'),
  }
}

function renderReview(
  candidate: ReviewCandidate,
  diff: CandidateDiffPreview,
  automatic?: AutoPromotionPolicyResult,
): CommandResult {
  const diffHeader = diff.truncated
    ? `Verified diff (exact Git baseline → sealed Candidate; controls escaped; first ${diff.shownBytes} of ${diff.totalBytes} bytes, truncated):`
    : `Verified diff (exact Git baseline → sealed Candidate; controls escaped; ${diff.totalBytes} bytes):`
  const patch = diff.patch.endsWith('\n') ? diff.patch.slice(0, -1) : diff.patch
  return {
    kind: 'success',
    text: [
      `Evolution review ${candidate.id}`,
      `Status: ${candidate.status}${candidate.decisionActor === undefined ? '' : ` (${candidate.decisionActor})`}`,
      ...renderReviewExpiry(candidate),
      `Recommendation: ${candidate.recommendation}`,
      `Skill: ${candidate.skillName}`,
      `Claim: ${candidate.claim}`,
      `Changed files: ${candidate.changedFiles.join(', ')}`,
      `Candidate tree: ${candidate.candidateTreeHash}`,
      `Cases: ${candidate.cases.map(item =>
        `${item.id} ${item.baseline}→${item.candidate} checks ${item.passedChecks}/${item.totalChecks}`).join('; ')}`,
      `Proposal tokens: input ${candidate.cost.inputTokens}, output ${candidate.cost.outputTokens}`,
      `Sealed Trial count: ${candidate.cost.trialCount}`,
      `Composition: ${candidate.compositionFingerprint}`,
      `Reasons: ${candidate.reasons.join('; ')}`,
      `Limitations: ${candidate.limitations.join('; ')}`,
      ...candidate.generationId === undefined ? [] : [`Generation: ${candidate.generationId}`],
      ...candidate.activatedAt === undefined ? [] : [`Activated: ${candidate.activatedAt}`],
      `Protected-effect projection (${diff.impact.version}; lexical only): scope ${diff.impact.scope}; indicators ${diff.impact.indicators.length === 0 ? 'none detected' : diff.impact.indicators.join(', ')}`,
      'DSH Approval remains authoritative; no lexical indicator is a safety proof.',
      diffHeader,
      patch.length === 0 ? '(no textual changes)' : patch,
      ...diff.truncated ? ['[diff truncated; publication still verifies the complete Candidate tree]'] : [],
      ...automatic === undefined
        ? []
        : [automatic.eligible
            ? `Automatic policy: eligible (${automatic.policyVersion})`
            : `Automatic policy: manual review — ${automatic.reasons.join('; ')}`],
      '',
      ...candidate.status === 'pending'
        ? [
            `Approve inactive publication: /evolve review ${candidate.id} approve <note>`,
            `Reject: /evolve review ${candidate.id} reject <note>`,
          ]
        : candidate.status === 'approved' && candidate.activatedAt === undefined
          ? [
              'Automatic activation is pending; the Candidate remains visible until the pointer move is durable.',
              `Manual retry for future Sessions: /evolve promote ${candidate.generationId}`,
            ]
          : [],
    ].join('\n'),
  }
}

function renderReviewWindowSummary(candidate: ReviewCandidate): string {
  const expiry = candidate.automaticReviewExpiry
  if (expiry === undefined) return ''
  return expiry.eligible
    ? ` — automatic review expiry eligible since ${expiry.eligibleAt}`
    : ` — automatic review window until ${expiry.eligibleAt}`
}

function renderReviewExpiry(candidate: ReviewCandidate): string[] {
  const expiry = candidate.automaticReviewExpiry
  if (expiry === undefined) return []
  return [expiry.eligible
    ? `Automatic review expiry: eligible since ${expiry.eligibleAt}; the next same-Skill automatic Signal rejects this Candidate.`
    : `Automatic review expiry: open until ${expiry.eligibleAt}; after that, the next same-Skill automatic Signal rejects this Candidate.`]
}

function renderStatus(
  active: CapabilityGeneration | undefined,
  recoveryPaused?: boolean,
  automaticSkills?: string[],
  outcomeSummary?: DeliveryOutcomeSummary,
  feedbackSummary?: FeedbackSignalSummary,
  automaticFeedbackBudget?: AutomaticFeedbackBudgetStatus,
  automaticEvaluatorBudget?: AutomaticEvaluatorBudgetStatus,
): CommandResult {
  const recovery = recoveryPaused === undefined
    ? []
    : [`Resident recovery: ${recoveryPaused ? 'paused' : 'running'}`]
  const automatic = automaticSkills === undefined
    ? []
    : [`Automatic promotion: auto-clear-instruction-v1 (${automaticSkills.join(', ')})`]
  const delivery = outcomeSummary === undefined
    ? []
    : [
        `Delivery outcomes: ${renderOutcomeCounts(outcomeSummary.all)}`,
        `Active selection outcomes (${active?.id ?? 'native DSH'}): ${renderOutcomeCounts(outcomeSummary.selected)}`,
        ...(outcomeSummary.baseline === undefined || active === undefined
          ? []
          : [
              `Parent selection outcomes (${active.parentId ?? 'native DSH'}): ${renderOutcomeCounts(outcomeSummary.baseline)}`,
              'Observed delivery counts are descriptive; they do not prove that a Generation caused the difference.',
            ]),
      ]
  const feedback = feedbackSummary === undefined
    ? []
    : [`Explicit feedback signals: ${feedbackSummary.all} retained (${feedbackSummary.selected} active selection)`]
  const budget = [
    ...renderAutomaticBudget('Feedback Shadow', automaticFeedbackBudget),
    ...renderAutomaticBudget('Evaluator Draft', automaticEvaluatorBudget),
  ]
  if (active === undefined) {
    return {
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
        ...recovery,
        ...automatic,
        ...delivery,
        ...feedback,
        ...budget,
        'Future Sessions will use native capabilities.',
        '',
        'Commands: /evolve promote <64-char-generation-id>',
      ].join('\n'),
    }
  }
  return {
    kind: 'success',
    text: [
      'Evolution status',
      `Active: ${active.id}`,
      ...recovery,
      ...automatic,
      ...delivery,
      ...feedback,
      ...budget,
      `Rollback target: ${active.parentId ?? 'native DSH'}`,
      'Artifacts:',
      ...active.artifacts.map(artifact =>
        artifact.kind === 'skill'
          ? `- skill ${artifact.name} tree ${artifact.treeHash} commit ${artifact.gitCommit}`
          : `- skill-bundle ${artifact.name} tree ${artifact.treeHash} digest ${artifact.artifactDigest}`),
      'Existing Sessions keep their pinned Generation.',
      '',
      'Commands: /evolve rollback',
    ].join('\n'),
  }
}

function renderAutomaticBudget(
  workflow: 'Feedback Shadow' | 'Evaluator Draft',
  budget: AutomaticFeedbackBudgetStatus | AutomaticEvaluatorBudgetStatus | undefined,
): string[] {
  if (budget === undefined) return []
  return [
    ...budget.targets.map(target => target.status === 'unknown'
      ? `Automatic evolution budget (${workflow}): ${target.targetId} unknown; automatic action fails closed`
      : `Automatic evolution budget (${workflow}): ${target.targetId} ${target.used}/${target.limit} attempts used on ${target.utcDay} UTC (${target.remaining} remaining)`),
    ...budget.warningCount === 0
      ? []
      : [`Automatic evolution budget (${workflow}) warnings: ${budget.warningCount}`],
  ]
}

function renderOutcomeCounts(counts: DeliveryOutcomeSummary['all']): string {
  return `${counts.total} total (${counts.passed} passed, ${counts.failed} failed, ${counts.unknown} unknown)`
}
