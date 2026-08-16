import type { Context } from '@deepseek-ai/cordis'
import { installCompleteDeliveryBinder } from './complete-delivery.js'

export const name = 'dsh-software-delivery'
export const inject = ['skills']

export function apply(ctx: Context): void {
  ctx.skills.register({
    name: 'software-delivery',
    description: 'Deliver a software change in an isolated Git worktree with repository-defined checks, a commit, and an optional Draft PR.',
    whenToUse: 'Use for implementation work that should finish as reviewable, objectively verified Git evidence.',
    source: 'bundled',
    invocation: { modelInvocable: true, userInvocable: true },
    content: SOFTWARE_DELIVERY_SKILL,
  })
  ctx.inject(['goals', 'tools'], installCompleteDeliveryBinder)
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

7. When the \`complete_delivery\` Tool is available, call it with the exact Goal id/revision, worktree, base and repository check argv. It runs checks through the native shell Tool and completes the native Goal only after a \`passed\` result. Do not separately call \`update_goal complete\`.
8. In a composition without Goal/Tool integration, run \`dsh-delivery verify --worktree <absolute-worktree> --config <absolute-config>\`. Treat only a \`passed\` report for the exact committed HEAD as objective completion evidence. A failed or unknown report keeps the native Goal active.
9. If requested or permitted by the user's standing policy, push the feature branch and create a Draft PR. Report the commit, verification result, remaining limitations, and Draft PR URL. Keep the worktree available for review.

## Authority

Creating a worktree, editing, testing, committing, pushing the feature branch, and creating a Draft PR are delivery actions. Never merge, release, deploy, read secrets, make paid calls, or perform irreversible external actions without explicit human approval or an explicit deployment policy. Do not convert a Draft PR to ready-for-review unless authorized.

The standalone verifier executes configured argv without a shell and a minimal environment. The integrated completion Tool delegates checks to DSH's existing bash/pwsh Tool so native sandbox and approval policy remain authoritative. Both bound captured output and verify that checks did not move HEAD, move the base ref, or dirty the worktree.`

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
