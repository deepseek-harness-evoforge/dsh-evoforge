import type { Context } from '@deepseek-ai/cordis'
import { installCompleteDeliveryBinder } from './complete-delivery.js'
import type { DraftPrCheckWaitPolicy } from './draft-pr.js'

export const name = 'dsh-software-delivery'
export const inject = ['skills']

export interface Config {
  /** Keep a Goal active until every check on the exact Draft PR head is green. */
  readonly requireDraftPrChecks?: boolean
  /** Optionally wait inside the active delivery Tool call instead of requiring another Agent turn. */
  readonly draftPrCheckWait?: {
    readonly timeoutMs?: number
    readonly pollIntervalMs?: number
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const draftPrCheckWait = resolveDraftPrCheckWait(config)
  ctx.skills.register({
    name: 'software-delivery',
    description: 'Deliver a software change in an isolated Git worktree with repository-defined checks, a commit, and an optional Draft PR.',
    whenToUse: 'Use for implementation work that should finish as reviewable, objectively verified Git evidence.',
    source: 'bundled',
    invocation: { modelInvocable: true, userInvocable: true },
    content: SOFTWARE_DELIVERY_SKILL,
  })
  ctx.inject(['goals', 'tools'], deliveryCtx => installCompleteDeliveryBinder(deliveryCtx, {
    requireDraftPrChecks: config.requireDraftPrChecks === true,
    ...(draftPrCheckWait === undefined ? {} : { draftPrCheckWait }),
  }))
}

const DEFAULT_CHECK_WAIT_TIMEOUT_MS = 30 * 60_000
const DEFAULT_CHECK_POLL_INTERVAL_MS = 15_000
const MIN_CHECK_WAIT_TIMEOUT_MS = 10_000
const MAX_CHECK_WAIT_TIMEOUT_MS = 2 * 60 * 60_000
const MIN_CHECK_POLL_INTERVAL_MS = 1_000
const MAX_CHECK_POLL_INTERVAL_MS = 5 * 60_000

/** Normalize host-only wait policy without changing the Tool or Skill model surface. */
function resolveDraftPrCheckWait(config: Config): DraftPrCheckWaitPolicy | undefined {
  if (config.draftPrCheckWait === undefined) return undefined
  if (config.requireDraftPrChecks !== true) {
    throw new Error('draftPrCheckWait requires requireDraftPrChecks: true')
  }
  const timeoutMs = config.draftPrCheckWait.timeoutMs ?? DEFAULT_CHECK_WAIT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < MIN_CHECK_WAIT_TIMEOUT_MS
    || timeoutMs > MAX_CHECK_WAIT_TIMEOUT_MS) {
    throw new Error(
      `draftPrCheckWait.timeoutMs must be an integer between ${MIN_CHECK_WAIT_TIMEOUT_MS} and ${MAX_CHECK_WAIT_TIMEOUT_MS}`,
    )
  }
  const pollIntervalMs = config.draftPrCheckWait.pollIntervalMs
    ?? Math.min(DEFAULT_CHECK_POLL_INTERVAL_MS, timeoutMs)
  if (!Number.isSafeInteger(pollIntervalMs)
    || pollIntervalMs < MIN_CHECK_POLL_INTERVAL_MS
    || pollIntervalMs > MAX_CHECK_POLL_INTERVAL_MS
    || pollIntervalMs > timeoutMs) {
    throw new Error(
      `draftPrCheckWait.pollIntervalMs must be an integer between ${MIN_CHECK_POLL_INTERVAL_MS} and ${Math.min(MAX_CHECK_POLL_INTERVAL_MS, timeoutMs)}`,
    )
  }
  return Object.freeze({ timeoutMs, pollIntervalMs })
}

const SOFTWARE_DELIVERY_SKILL = `# Software delivery

Use the native DSH Goal as the single source of task intent and completion state. Do not create a parallel mission, plan graph, worker daemon, or hidden definition of done.

## Deliver

1. Read the repository's own instructions and tests before changing it.
2. Record the exact starting commit and intended base ref.
3. Create a named feature branch in a sibling linked Git worktree. Keep the user's primary checkout untouched.
4. Make the smallest in-scope change. Preserve unrelated work and repository conventions.
5. Run the repository's relevant checks, review the diff, and commit the complete change in the linked worktree.
6. Create a JSON verification config outside the repository or in an already-tracked project location:

   {"schemaVersion":1,"baseRef":"main","checks":[{"name":"test","argv":["pnpm","test"]}]}

7. When the \`complete_delivery\` Tool is available, call it with the exact Goal id/revision, worktree, base and repository check argv. If the requested outcome includes a Draft PR, also pass \`draft_pr\` with its base branch, title and body. It uses native shell policy for checks and publication, then completes the native Goal only after every requested artifact is confirmed. Do not separately push, create the PR, or call \`update_goal complete\`.
8. In a composition without Goal/Tool integration, run \`dsh-delivery verify --worktree <absolute-worktree> --config <absolute-config>\`. Treat only a \`passed\` report for the exact committed HEAD as objective completion evidence. A failed or unknown report keeps the native Goal active.
9. Report the commit, verification result, remaining limitations, and Draft PR URL when requested. Keep the worktree available for review.

## Authority

Creating a worktree, editing, testing, committing, pushing the feature branch, and creating a Draft PR are delivery actions. Never merge, release, deploy, read secrets, make paid calls, or perform irreversible external actions without explicit human approval or an explicit deployment policy. Do not convert a Draft PR to ready-for-review unless authorized.

The standalone verifier executes configured argv without a shell and a minimal environment. The integrated completion Tool delegates checks, push and GitHub Draft PR commands to DSH's existing bash/pwsh Tool so native sandbox and approval policy remain authoritative. It never merges or marks a PR ready. Both paths bound captured output and verify that checks did not move HEAD, move the base ref, or dirty the worktree.`

export {
  verifyDelivery,
  type CapturedOutput,
  type DeliveryCheck,
  type DeliveryCheckEvidence,
  type DeliveryCheckRunner,
  type DeliveryCheckRunContext,
  type DeliveryCheckRunResult,
  type DeliveryReport,
  type DeliveryRepositoryEvidence,
  type VerifyDeliveryOptions,
} from './verify-delivery.js'
