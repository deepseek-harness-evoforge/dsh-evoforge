# dsh-evoforge

[中文](README.md) · [Implementation status](docs/status.zh.md) · [Research index](docs/research/README.zh.md)

An out-of-tree extension suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). EvoForge adds removable capabilities through supported DSH seams; it is not a DSH fork or a home for core-defect workarounds.

> **Pre-alpha: do not use automatic activation in production.** The `dsh-evolve` P0A/P0B/P0C slices, narrow P1.1 auto-promotion, P1.2 counterfactual canary/rollback, P1.3 explicit-feedback intake, P1.4 private Feedback Case Drafts, P1.5 feedback-guided Shadow, P1.6 pre-proposal Case Pack calibration, and P2D.1 delivery-outcome observation are implemented. The `dsh-software-delivery` Skill, Git verifier, native-Goal verified completion, idempotent Draft-PR publication, and optional exact-head remote-check gate are also implemented. Evaluators for novel failures, real-task false-promotion/false-rollback data, real-user evidence, and production multi-day evidence remain incomplete.

`dsh-evolve` aims to turn agent self-improvement into an evidence-backed release process:

```text
real outcomes → inactive candidate → sealed paired trial
             → promote / review / reject → future sessions only → rollback
```

The Shadow lane provides deterministic Skill and case-pack hashes, owned-path and symlink boundaries, concurrent-mutation detection, token budgets, explicit incomplete results, known-bad/known-correction calibration, and a sealed paired final test. `dsh-evolve calibrate` runs the two calibration fixtures with zero model calls, and complete Shadow runs pass the same gate before spending proposer budget; the successful paired path remains four Trial executions total. Interrupted runs can explicitly `--resume`; an optional resident supervisor scans configured roots and submits only durable, network-free Candidate/Trial recovery to native DSH Jobs. The journal remains authoritative, and an uncertain paid proposal is never retried automatically. Completed evidence appears in a host-only review inbox; detail reconstructs the exact Git baseline and sealed Candidate to show a control-safe, bounded diff without persisting another copy. Approval creates a deterministic owned Git ref and inactive Generation without moving the user's branch, worktree, active pointer, or live Session. Activation remains a separate explicit action. The runtime lane uses DSH Storage Domain plus an Agent-scoped provider backed by verified, read-only Git trees. With no active Generation it adds no model surface. With one active, it reuses DSH's native Skill catalog/body path, freezes that catalog per Session, and never adds an EvoForge Tool or system-prompt fragment. A real two-turn Agent regression proves that promotion preserves the live Session's Tool surface and full prior message prefix.

`dsh-software-delivery` contributes one stable, on-demand native Skill and a `dsh-delivery verify` CLI. In a composition with native Goal, ToolGoal, and shell capabilities it also exposes one fixed `complete_delivery` Tool: checks, exact-commit push, and optional GitHub Draft-PR publication run through native shell policy; native `update_goal` completes only after every requested artifact is confirmed. An opt-in host setting also requires at least one green rollup check on the exact PR head. It reads once per invocation and keeps the Goal active on pending, missing, failed, unreadable, or wrong-head checks; it does not poll or copy CI logs. Remote branch/PR facts make retries idempotent without a second journal. It adds no system-prompt fragment or second Goal/state machine. The Tool schema remains capped at 2 KiB serialized JSON and identical with the gate on or off. Direct native Goal completion remains available; the Draft slice currently supports GitHub.com same-repository branches.

When both plugins are present, `dsh-evolve` passively observes the final native `tools/result`, associates its compact three-state delivery outcome with the Session-pinned Generation, and exposes aggregate counts only through host-side `/evolve status`. Observation is asynchronous, bounded, idempotent, and adds no model-visible surface or token cost. It does not retain prompts, repository paths, PR bodies, or check output. P1.3 also reuses native DSH Message Feedback: only a current negative rating with a non-blank note creates a retractable reference; the note, note hash, cwd, transcript, and message body are never copied into EvoForge signal storage. P1.4 copies one direct user text and correction only after a private `feedbackDraftRoot` is configured and the user explicitly creates a draft for one exact Generation Skill. P1.5 lets an explicit Shadow run use that exact draft only as proposer search evidence; the existing calibrated Case Pack remains the independent evaluator. Draft fields are not directly copied into durable run evidence, although proposer output that echoes them is retained with the Candidate. A matching delivery failure only triggers an asynchronous replay of the original sealed Case Pack against the exact Git parent and Candidate. Future-session selection rolls back only when calibration passes, the parent passes, the Candidate fails, and the active pointer is unchanged; ambiguous evidence is held for review. The canary makes no proposer call.

## Verify locally

Requires Node.js `^22.19.0 || >=24` and pnpm `11.7.0`:

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-software-delivery pack --pack-destination "$PWD/.evoforge/pack"
```

Read the [Chinese status page](docs/status.zh.md) for the exact implemented/planned boundary, [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Licensed under [MIT](LICENSE).
