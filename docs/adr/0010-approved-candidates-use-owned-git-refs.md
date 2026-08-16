# ADR 0010: Approved Candidates Use Owned Git Refs

Status: Accepted

## Context

A completed Shadow run contains an inactive proposal and paired-Trial evidence. Human review must be able to turn that evidence into an immutable Capability Generation, but approval must not edit the active Skill, move the user's branch, dirty the worktree, or silently activate the result. A crash between Git publication and Storage publication must also be retryable without producing a different version.

## Decision

`/evolve review <review-id> approve <note>` performs a fail-closed two-step publication:

1. Verify the run-local journal, terminal report, evidence hash, exact baseline Git tree, and sealed Candidate tree.
2. Materialize a deterministic Git commit and publish it at `refs/evoforge/generations/<review-id>`.
3. Validate the exact committed Skill through the normal Git Skill Provider.
4. Publish an inactive Generation manifest and then durably record the approval beside the Shadow run.

The commit identity, timestamp, parent, tree, and message are evidence-derived so retry produces the same commit. An existing EvoForge ref is accepted only when it resolves to that exact commit. The current branch, index, worktree, and active Generation pointer never move. Activation remains a separate explicit `/evolve promote <generation-id>` action and affects future Sessions only.

The review inbox is a projection of owned Shadow journals and reports, not a second database. It scans only direct child directories of configured run roots and refuses symlinked journal, report, or disposition files.

## Consequences

- Human approval and activation are deliberately separate, so reviewing evidence cannot change runtime behavior.
- Git objects and the owned EvoForge ref may exist before the Generation manifest if the process fails. Retry is deterministic and completes publication; the user branch remains untouched.
- Rejected and approved dispositions bind to an evidence hash. Later evidence mutation is reported instead of silently reusing the decision.
- The first slice presents claim, changed-file paths, case results, cost, reasons, and limitations. It does not claim a full diff viewer or automatic promotion.
- The feature adds no model Tool, system-prompt fragment, or dynamic Skill catalog entry, preserving the Cache Contract.

