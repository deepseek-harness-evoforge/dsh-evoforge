import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'
import type { CandidateDiffPreview, CandidatePublisher } from './candidate-publisher.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'
import type { ResidentEvolutionControl } from './resident-evolution-control.ts'
import type { DeliveryOutcomeStore, DeliveryOutcomeSummary } from './delivery-outcome-monitor.ts'
import type {
  FeedbackSignal,
  FeedbackSignalStore,
  FeedbackSignalSummary,
} from './feedback-signal-monitor.ts'
import { workspaceIdForCwd } from './workspace-identity.ts'

const USAGE = 'Usage: /evolve [status|feedback [<signal-id>]|review [<review-id> [approve|reject <note>]]|pause|resume|promote <64-char-generation-id>|rollback]'
const generationIdPattern = /^[a-f0-9]{64}$/

export interface EvolutionCommandModules {
  readonly review?: { inbox: ReviewInbox; publisher: CandidatePublisher }
  readonly resident?: Pick<ResidentEvolutionControl, 'isPaused' | 'pause' | 'resume'>
  readonly outcomes?: Pick<DeliveryOutcomeStore, 'summarize'>
  readonly feedback?: Pick<FeedbackSignalStore, 'list' | 'summarize'>
}

/** Register the host-owned control plane without adding a model Tool. */
export function installEvolutionCommand(
  ctx: Context,
  store: EvolutionStore,
  modules: EvolutionCommandModules = {},
): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'evolve',
      description: 'inspect internal evidence, review Candidates, and control immutable Generations',
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
  const { review, resident, outcomes, feedback } = modules
  try {
    if (input === '' || input === 'status') {
      const active = store.getActiveGeneration(workspaceId)
      return renderStatus(
        active,
        resident?.isPaused(workspaceId),
        outcomes?.summarize(
          workspaceId,
          active?.id,
          active === undefined
            ? undefined
            : active.parentId === undefined ? {} : { baselineGenerationId: active.parentId },
        ),
        feedback?.summarize(workspaceId, active?.id),
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
    const reviewAction = /^review\s+([a-f0-9]{64})(?:\s+(approve|reject)\s+([\s\S]+))?$/u.exec(input)
    if (reviewAction?.[1] !== undefined) {
      if (review === undefined) return reviewUnavailable()
      const [, id, action, note] = reviewAction
      if (action === undefined) {
        const candidate = await review.inbox.get(id)
        assertWorkspace(candidate.workspaceId, workspaceId, 'Review Candidate')
        return renderReview(candidate, await review.publisher.preview(candidate))
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
      'The correction remains in native DSH feedback authority and is evidence for asynchronous opportunity discovery.',
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
        `- ${candidate.id} [${candidate.status === 'pending' ? '' : `${candidate.status}/`}${candidate.recommendation}] ${candidate.skillName}: ${candidate.claim}`),
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
): CommandResult {
  const diffHeader = diff.truncated
    ? `Verified diff (sealed capability-absent baseline → exact Candidate Bundle; controls escaped; first ${diff.shownBytes} of ${diff.totalBytes} bytes, truncated):`
    : `Verified diff (sealed capability-absent baseline → exact Candidate Bundle; controls escaped; ${diff.totalBytes} bytes):`
  const patch = diff.patch.endsWith('\n') ? diff.patch.slice(0, -1) : diff.patch
  return {
    kind: 'success',
    text: [
      `Evolution review ${candidate.id}`,
      `Status: ${candidate.status}${candidate.decisionActor === undefined ? '' : ` (${candidate.decisionActor})`}`,
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
      ...diff.truncated ? ['[diff truncated; publication still verifies the complete Candidate Bundle]'] : [],
      '',
      ...candidate.status === 'pending'
        ? [
            `Approve inactive publication: /evolve review ${candidate.id} approve <note>`,
            `Reject: /evolve review ${candidate.id} reject <note>`,
          ]
        : candidate.status === 'approved' && candidate.activatedAt === undefined
          ? [`Activate for future Sessions: /evolve promote ${candidate.generationId}`]
          : [],
    ].join('\n'),
  }
}

function renderStatus(
  active: CapabilityGeneration | undefined,
  recoveryPaused?: boolean,
  outcomeSummary?: DeliveryOutcomeSummary,
  feedbackSummary?: FeedbackSignalSummary,
): CommandResult {
  const recovery = recoveryPaused === undefined
    ? []
    : [`Resident recovery: ${recoveryPaused ? 'paused' : 'running'}`]
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
  if (active === undefined) {
    return {
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
        ...recovery,
        ...delivery,
        ...feedback,
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
      ...delivery,
      ...feedback,
      `Rollback target: ${active.parentId ?? 'native DSH'}`,
      'Artifacts:',
      ...active.artifacts.map(artifact =>
        artifact.kind === 'skill-bundle'
          ? `- skill-bundle ${artifact.name} tree ${artifact.treeHash} digest ${artifact.artifactDigest}`
          : `- quarantined legacy artifact ${artifact.name} tree ${artifact.treeHash}`),
      'Existing Sessions keep their pinned Generation.',
      '',
      'Commands: /evolve rollback',
    ].join('\n'),
  }
}

function renderOutcomeCounts(counts: DeliveryOutcomeSummary['all']): string {
  return `${counts.total} total (${counts.passed} passed, ${counts.failed} failed, ${counts.unknown} unknown)`
}
