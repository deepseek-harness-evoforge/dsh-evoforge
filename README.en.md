# dsh-evoforge

[中文](README.md) · [Implementation status](docs/status.zh.md) · [Research index](docs/research/README.zh.md)

An out-of-tree extension suite for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). EvoForge adds removable capabilities through supported DSH seams; it is not a DSH fork or a home for core-defect workarounds.

> **Pre-alpha: do not use automatic activation in production.** The `dsh-evolve` P0A/P0B/P0C slices, including exact diffs, protected-effect lexical indicators, and the real-DSH Web control surface, narrow P1.1 auto-promotion, P1.2 counterfactual canary/rollback, P1.3 explicit-feedback intake, P1.4 private Feedback Case Drafts, P1.5 feedback-guided Shadow, P1.6 pre-proposal Case Pack calibration, P1.7 explicit evaluator-authoring Skill, P1.8 explicit target-bound Feedback Shadow Launch, P1.9 private Evaluator Draft/human qualification, P1.10 Qualified Shadow Handoff, P1.11 exact Candidate retention, P1.12 opt-in retention-gated auto-promotion, P1.13 one static Automatic Retention Target per Skill, P1.14 opt-in Automatic Feedback Shadow, P1.15 durable daily automatic budgets, P1.16 opt-in Automatic Evaluator Drafts, P1.17 human-approved Qualify-and-Shadow, P1.18 per-Skill automatic inflight gating, P1.19 bounded automatic ambiguous review, P1.20 automatic review-window visibility, and P2D.1 delivery-outcome observation are implemented. The `dsh-software-delivery` verified-delivery path, `dsh-doctor` zero-token Runtime Readiness report, and `dsh-telegram` single-private-chat Agent adapter are also implemented. Default background evaluator qualification, real-task false-promotion/false-rollback data, independent usability evidence, and production multi-day evidence remain incomplete.

`dsh-evolve` aims to turn agent self-improvement into an evidence-backed release process:

```text
real outcomes → inactive candidate → sealed paired trial
             → promote / review / reject → future sessions only → rollback
```

The optional `dsh-evolve-web` Bundle installs the host runtime and a root-scoped Web adapter as one removable profile layer. Its global sidebar action works without a Session, performs no background polling, and exposes bounded review evidence plus durable pause/resume/approve/reject/promote/rollback actions. A packed install against the pinned DSH revision and a real browser verified pause, process restart with the paused state intact, and resume with zero page errors. It adds no model-visible surface or tokens.

The Shadow lane provides deterministic Skill and case-pack hashes, owned-path and symlink boundaries, concurrent-mutation detection, token budgets, explicit incomplete results, known-bad/known-correction calibration, and a sealed paired final test. `dsh-evolve calibrate` runs the two calibration fixtures with zero model calls, and complete Shadow runs pass the same gate before spending proposer budget; the successful paired path remains four Trial executions total. Interrupted runs can explicitly `--resume`; an optional resident supervisor scans configured roots and submits only durable, network-free Candidate/Trial recovery to native DSH Jobs. The journal remains authoritative, and an uncertain paid proposal is never retried automatically. Completed evidence appears in a host-only review inbox; detail reconstructs the exact Git baseline and sealed Candidate to show a control-safe, bounded diff without persisting another copy. It also projects fixed lexical categories for changed artifact scope, credentials, destructive actions, messaging/calendar, network, payment, permissions, privileged tools, production changes, and rewritten instructions. These indicators are conservative routing aids, not a semantic safety proof; DSH Approval remains authoritative. Approval creates a deterministic owned Git ref and inactive Generation without moving the user's branch, worktree, active pointer, or live Session. Activation remains a separate explicit action. The runtime lane uses DSH Storage Domain plus an Agent-scoped provider backed by verified, read-only Git trees. With no active Generation it adds no model surface. With one active, it reuses DSH's native Skill catalog/body path, freezes that catalog per Session, and never adds an EvoForge Tool or system-prompt fragment. A real two-turn Agent regression proves that promotion preserves the live Session's Tool surface and full prior message prefix.

`dsh-software-delivery` contributes one stable, on-demand native Skill and a `dsh-delivery verify` CLI. In a composition with native Goal, ToolGoal, and shell capabilities it also exposes one fixed `complete_delivery` Tool: checks, exact-commit push, and optional GitHub Draft-PR publication run through native shell policy; native `update_goal` completes only after every requested artifact is confirmed. An opt-in host setting also requires at least one green rollup check on the exact PR head. It reads once per invocation and keeps the Goal active on pending, missing, failed, unreadable, or wrong-head checks; it does not poll or copy CI logs. Remote branch/PR facts make retries idempotent without a second journal. It adds no system-prompt fragment or second Goal/state machine. The Tool schema remains capped at 2 KiB serialized JSON and identical with the gate on or off. Direct native Goal completion remains available; the Draft slice currently supports GitHub.com same-repository branches.

When both plugins are present, `dsh-evolve` passively observes the final native `tools/result`, associates its compact three-state delivery outcome with the Session-pinned Generation, and exposes aggregate counts only through host-side `/evolve status`. Observation is asynchronous, bounded, idempotent, and adds no model-visible surface or token cost. It does not retain prompts, repository paths, PR bodies, or check output. P1.3 also reuses native DSH Message Feedback: only a current negative rating with a non-blank note creates a retractable reference; the note, note hash, cwd, transcript, and message body are never copied into EvoForge signal storage. P1.4 copies one direct user text and correction only after a private `feedbackDraftRoot` is configured and either a per-item host action or the P1.14 exact Target policy authorizes it for one exact Generation Skill. P1.5 gives that exact draft only to proposer search; the existing calibrated Case Pack remains the independent evaluator. Draft fields are not directly copied into durable run evidence, although proposer output that echoes them is retained with the Candidate. A matching delivery failure only triggers an asynchronous replay of the original sealed Case Pack against the exact Git parent and Candidate. Future-session selection rolls back only when calibration passes, the parent passes, the Candidate fails, and the active pointer is unchanged; ambiguous evidence is held for review. The canary makes no proposer call.

P1.8 closes the usability gap between an existing explicit correction and one background Shadow. An operator statically binds a public target id to an exact Skill, calibrated Case Pack, and owned run root. Commands and Web submit only a signal id and target id; they cannot supply host paths or model parameters. Each launch explicitly authorizes one potentially paid proposer request and bounded correction disclosure, returns without blocking the originating Session, and reuses content-addressed durable evidence on retry. A packed pinned-DSH browser test verified the global target button, disclosure dialog, cancel-with-no-run boundary, and zero console errors. It does not auto-generate an evaluator or auto-promote a Candidate, and it adds no model-visible surface or normal-Session tokens.

P1.9 handles explicit corrections that do not yet have a trusted Case Pack. One explicit Author action may make one bounded model request; the host fixes the exact known-bad Skill, manifest, budgets, and pinned DSH revision, while the model may propose only evidence, a corrected single-file Skill, and evaluator source. The result remains a private inactive Draft. A separate human exact-hash decision is required before generated code runs inside sealed qualification, and success publishes only a Qualified Case Pack—not a Shadow, Candidate, or Promotion. Normal Sessions add zero tokens; author output is capped at 1,600 tokens, and ambiguous paid effects are never retried automatically after a crash.

P1.10 removes the Qualified Case Pack path dead end. An Evaluator Target may bind an existing supervisor run root. A fresh explicit confirmation authorizes one potentially paid request and bounded correction disclosure; the host then passes only the journal-restored exact qualified hash into the existing P1.8 Shadow launcher, native Jobs, and durable journal. It never auto-starts or bypasses Candidate/Promotion gates, and normal Session model surfaces and token cost remain unchanged.

P1.11 replays one exact, reviewable Shadow Candidate against one independent trusted prior Case Pack.
It returns `retained`, `regressed`, or `incomplete` after the existing sealed calibration and paired
baseline/Candidate Trial, makes zero additional proposer calls, and never changes the active Skill or
promotion state. A complete invocation runs four evaluator Trials. Any model calls made by an assembled
evaluator are a separate reported cost; normal Session model surfaces and token cost remain unchanged.

P1.12 optionally requires that exact P1.11 evidence before the existing narrow clear-instruction policy
may auto-promote. Static host-only roots are scanned by the existing supervisor; missing, incomplete,
regressed, malformed, symlinked, or conflicting reports keep the Candidate in human review. It does not
run Retention automatically, change explicit human promotion, or add a model call or Session surface.

P1.13 can bind one exact prior Case Pack to each allowlisted Skill as an explicit deployment policy.
The existing supervisor then runs P1.11 through native Jobs only for an otherwise eligible clear win,
at most once per scan. Retained evidence continues through P1.12; regression, incomplete, or uncertain
execution remains in review. A potentially effectful attempt is never retried after an uncertain crash.
Normal Session composition and token cost remain unchanged.

P1.14 can bind one existing P1.8 target and its exact Case Pack hash as an explicit deployment policy.
One current negative feedback item with a non-blank correction may then create the minimal private Draft
and start one background Shadow without another foreground command, only when its pinned Generation
matches exactly one authorized Skill. The policy authorizes that bounded disclosure and proposer/evaluator
cost; zero or multiple matches remain manual. Existing Jobs, journal, review, Retention, promotion, and
rollback paths remain authoritative. An uncertain `proposal-pending` effect is never retried, the source
Session keeps its old Generation, and normal Session composition and token cost remain unchanged.

P1.15 caps each automatic Target's durable reservations per UTC day before a potentially paid boundary.
P1.18 also reads existing Draft, Shadow, and Review facts before reservation so one Skill has only one
unresolved automatic path. P1.19 prevents an unattended ambiguous Candidate from freezing that path
forever: an Automatic Feedback Target keeps its own `recommendation: review` Candidate for 168 hours by
default, then a later Signal may durably reject it before spending budget. Human launches, `promote`
recommendations, and approved-but-not-activated Generations never expire. The evidence remains auditable,
and the policy adds no timer, model call, Tool, prompt, Skill catalog entry, or normal-Session token.
P1.20 projects that exact window and its next-same-Skill-Signal trigger through Commands and Web. Explicit
Web refresh also re-reads the inspected detail and clears a stale form if host authority has changed; there
is still no polling, browser timer, durable state, model call, or normal-Session token.

P1.16 optionally creates one private inactive Evaluator Draft for an unambiguous correction under the
same daily budget, while qualification, Shadow, and Promotion remain separate authorities. P1.17 lets a
human who has reviewed the exact Draft combine sealed qualification and one contingent paid Shadow into
one cancellable action; qualification failure spends zero proposer calls.

`dsh-doctor` is a separate removable Bundle that reads the native Loader only when `/doctor` is invoked. It reports `READY`, `NOT READY`, or `UNKNOWN`, names missing/disabled/failed or still-changing required plugins, and suggests a next action without changing runtime state. It adds one native human Command, no model Tool/Prompt/Skill, no polling, and zero normal-Session tokens. Packed `dsh plugin add`, native config dump, real Loader boot, and removal are covered by the package test.

`dsh-telegram` binds one deployment-authorized Telegram private chat and user to one existing DSH
Agent with a stable `sessionId`. Completed Agent turns, including native Goal and Schedule
continuations, return to that chat; slash Commands stay on the host plane and one-shot Approval
callbacks fail closed. It adds no Tool, Skill, prompt section, or normal-Session tokens. A bounded DSH
Storage Domain journal persists send intent; only an explicit `429 + retry_after` is retried, while
transport ambiguity or a crash during send becomes `uncertain` to avoid duplicate external effects.
The Bundle installs disabled until its exact route and token-environment policy are configured.

## Verify locally

Requires Node.js `^22.19.0 || >=24` and pnpm `11.7.0`:

```bash
pnpm install
pnpm check
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-software-delivery pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-doctor pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-telegram pack --pack-destination "$PWD/.evoforge/pack"
```

Read the [Chinese status page](docs/status.zh.md) for the exact implemented/planned boundary, [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Case authors can explicitly invoke the repository's [`author-dsh-evolution-case`](skills/author-dsh-evolution-case/SKILL.md) Skill to turn one reproducible novel failure into a partitioned, calibrated Case Pack. It is not implicitly loaded and does not create a runtime model surface.

Licensed under [MIT](LICENSE).
