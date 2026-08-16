# ADR 0011: Automatic Promotion Is an Opt-In Clear-Instruction Policy

Status: Accepted

## Context

The product owner permits self-promotion when an improvement is visibly positive, while ambiguous changes must remain asynchronous human review and every version must roll back. Treating every Shadow `promote` recommendation as automatic would be too broad: a Skill edit can change behavior even when it adds no executable file, and the current P1 slice has no canary or outcome-triggered automatic rollback.

## Decision

Automatic activation is disabled unless the operator configures an explicit `autoPromote.skills` allowlist. Version `auto-clear-instruction-v1` accepts a Candidate only when all of these deterministic gates pass:

- the Skill is explicitly allowlisted and its exact baseline Git tree is still current;
- Shadow recommends `promote`, at least one sealed case is `fail → pass`, every Candidate case/check passes, and at least four Trial executions were recorded;
- non-target DSH composition is explicitly reported stable by the assembled evaluator;
- the only change is a non-empty append to the existing `SKILL.md`;
- the append is at most 2 KiB and contains no conservative protected-action, tool, permission, secret, network, deployment, payment, messaging, or calendar terms;
- every evidence limitation is on the policy's fixed allowlist.

Any failed gate leaves the Candidate pending in the human review inbox and the detail command explains the reasons. There is no model judge or extra model call in the policy.

The existing resident scan owns automatic recovery. It records an evidence-bound approval with actor `auto-clear-instruction-v1`, publishes an inactive Generation with the same policy version, and only then moves the future-session active pointer. It writes `activatedAt` after that pointer move. An automatic approval without `activatedAt` remains visible in the review inbox and is retried after a crash; a branch/parent conflict therefore cannot disappear into logs. A durable `/evolve pause` also pauses automatic promotion.

## Consequences

- Human-approved Generations are never reinterpreted as automatic; actor provenance is terminal and evidence-bound.
- The policy cannot delete or rewrite existing safeguards, add files, code, tools, or permission configuration.
- DSH Approval and permission enforcement remain the actual Protected Action boundary. The lexical gate is deliberately conservative but is not presented as a semantic security proof.
- The change remains Cache Contract safe: it adds no Tool/Prompt, bounds Skill body growth, and affects future Sessions only.
- This is P1.1, not complete bounded autonomy. Canary routing, real-outcome monitoring, automatic rollback, false-promotion data, and production enablement remain required before a broader claim.
