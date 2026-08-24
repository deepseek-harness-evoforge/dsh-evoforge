# Existing-Skill automatic promotion is Workspace-scoped and fail closed

Status: accepted — 2026-08-24

## Context

The existing-Skill path already binds one internally discovered correction opportunity to an exact installed Bundle, a quarantined whole-tree Candidate, structural Admission, Candidate-blind paired Holdout, independent Retention, an inactive Generation, future-Session promotion, Canary, and exact rollback. Until this decision, release still required a human approve followed by a separate promote even when the Candidate was a clear, low-risk instruction improvement. Historical `autoPromote.targets` and static Skill/Case-Pack paths were deleted because they let an operator preselect the evolution direction and were not bound to the current internal evidence chain.

## Decision

`dsh-evolve` may receive `automaticPromotionPolicies`, each containing only a stable policy id and one native Workspace id. The policy cannot name a Skill, path, source, Candidate, Case Pack, evaluator, or workflow. It is valid only when the same Workspace has exact evaluation governance and the durable resident pause authority.

`ExistingSkillRelease` remains the sole Host mutation owner. Automatic release is narrower than human release and must revalidate all normal release evidence plus every condition below:

- one exact Candidate, qualified structural Admission, improved paired Holdout, and retained independent Retention with zero scan warnings;
- the exact installed baseline archive and exact Candidate archive still match their content identities;
- only `SKILL.md` changed, no file was added, removed, renamed, or made executable, and all other bytes and modes are identical;
- Candidate `SKILL.md` is the complete baseline bytes followed by 1–2048 canonical UTF-8 bytes;
- the appended text has no protected-effect indicator for credentials, destructive actions, messaging/calendar, network, payment, permissions/sandbox, privileged tools, production change, or rewritten instructions;
- when paired evidence contains model usage, Candidate model calls, input/output/reasoning/cache-write tokens do not exceed baseline and cache-read tokens do not decrease in both Holdout and Retention; zero-model deterministic gates remain valid;
- both paired sides completed within the same sealed Case Pack timeout and their assembled composition fingerprint stayed equal;
- the Workspace is not durably paused and the active Generation still equals the exact parent.

Passing the gate first publishes an inactive Generation and records an immutable `automatic-clear-instruction-v2` decision bound to the deployment policy and exact evidence. Only then may the same owner atomically select that Generation for future Sessions. A crash after publication or decision persistence is recovered from the durable Candidate/evaluation/decision/Generation facts; selecting an already-active Generation is idempotent. A policy change, parent drift, evidence drift, warning, cancellation, or protected effect fails closed without changing the pointer.

Native DSH Jobs is only the lifecycle and visibility adapter. It wakes reconciliation after Retention and on Host restart; it owns no durable scheduler state, alternate Runtime, or second queue. Control/Web receives a read-only status projection and never triggers reconciliation while rendering.

Human approve/reject/promote remains available for ambiguous or broader instruction changes. New Skills, scripts, code, permissions, credentials, external effects, deployment behavior, and executable changes never pass this automatic gate.

## Consequences

Clear existing-Skill instruction corrections can reach future Sessions without a blocking human choice while preserving DSH Session pinning, exact rollback, and independent evaluator authority. The policy authorizes a class of mutation for one Workspace but cannot direct which Skill evolves. The lexical effect screen and paired metrics are conservative gates, not semantic proof or a Hermes superiority claim. Real-provider false-promotion, latency, long-term transfer, and negative-transfer evidence remain release blockers.

This decision narrows the human-only rule in [ADR-0086](0086-existing-skill-release-is-a-separate-host-mutation-gate.md) without changing its sole-owner, inactive-publication, future-Session, or rollback boundaries. It does not restore [ADR-0032](0032-retention-evidence-is-an-opt-in-auto-promotion-gate.md) or any deleted static target design.
