import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { CapabilityGeneration, EvolutionStore } from './generation-store.ts'
import type { CandidatePublisher } from './candidate-publisher.ts'
import type { ReviewCandidate, ReviewInbox } from './review-inbox.ts'

const USAGE = 'Usage: /evolve [status|review [<review-id> [approve|reject <note>]]|promote <64-char-generation-id>|rollback]'
const generationIdPattern = /^[a-f0-9]{64}$/

/** Register the optional human control plane without adding a model Tool. */
export function installEvolutionCommand(
  ctx: Context,
  store: EvolutionStore,
  review?: { inbox: ReviewInbox; publisher: CandidatePublisher },
): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'evolve',
      description: 'review, publish, promote, or roll back immutable capability Generations',
      input: { hint: '[status|review ...|promote <generation-id>|rollback]' },
      handler: ({ rawInput }) => executeEvolutionCommand(store, rawInput, review),
    })
  })
}

/** Execute one explicit human action over the verified release store. */
export async function executeEvolutionCommand(
  store: EvolutionStore,
  rawInput: string,
  review?: { inbox: ReviewInbox; publisher: CandidatePublisher },
): Promise<CommandResult> {
  const input = rawInput.trim()
  try {
    if (input === '' || input === 'status') return renderStatus(store.getActiveGeneration())
    if (input === 'review') {
      if (review === undefined) return reviewUnavailable()
      const scan = await review.inbox.scan()
      return renderReviewList(scan.candidates, scan.warnings.length)
    }
    const reviewAction = /^review\s+([a-f0-9]{64})(?:\s+(approve|reject)\s+([\s\S]+))?$/u.exec(input)
    if (reviewAction?.[1] !== undefined) {
      if (review === undefined) return reviewUnavailable()
      const [, id, action, note] = reviewAction
      if (action === undefined) return renderReview(await review.inbox.get(id))
      if (note === undefined || note.trim() === '') return { kind: 'error', text: USAGE }
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
      const result = await store.rollbackGeneration()
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
      const result = await store.promoteGeneration(promote[1])
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
        `- ${candidate.id} [${candidate.recommendation}] ${candidate.skillName}: ${candidate.claim}`),
      ...candidates.length > visible.length ? [`- … ${candidates.length - visible.length} more`] : [],
      ...warningCount === 0 ? [] : [`Skipped invalid runs: ${warningCount}`],
      '',
      'Inspect: /evolve review <review-id>',
    ].join('\n'),
  }
}

function renderReview(candidate: ReviewCandidate): CommandResult {
  return {
    kind: 'success',
    text: [
      `Evolution review ${candidate.id}`,
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
      '',
      `Approve inactive publication: /evolve review ${candidate.id} approve <note>`,
      `Reject: /evolve review ${candidate.id} reject <note>`,
    ].join('\n'),
  }
}

function renderStatus(active: CapabilityGeneration | undefined): CommandResult {
  if (active === undefined) {
    return {
      kind: 'success',
      text: [
        'Evolution status',
        'Active: native DSH',
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
      `Rollback target: ${active.parentId ?? 'native DSH'}`,
      'Artifacts:',
      ...active.artifacts.map(artifact =>
        `- skill ${artifact.name} tree ${artifact.treeHash} commit ${artifact.gitCommit}`),
      'Existing Sessions keep their pinned Generation.',
      '',
      'Commands: /evolve rollback',
    ].join('\n'),
  }
}
