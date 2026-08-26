# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Changed

- User-facing installation is now organized into the `evolution`, `control`, `gateway`, `channels`, `delivery`, `continuity`, and `full` capability suites. The underlying DSH Bundles remain independently installable, permission-scoped, and removable.
- `dsh-evolve-web` now contributes its evolution surface to the native Control Center instead of registering a duplicate fixed sidebar dialog.
- CI package verification now consumes the suite manifest and no longer references removed package names or obsolete hard-gate scripts.

### Release readiness

- Added the release preflight and release-gate documentation. The project remains pre-alpha and is not yet a registry release.

### Added

- Initial EvoForge research baseline, including the DSH 171-plugin catalog and comparisons with Claude Code Rev and Hermes Agent.
- `build-dsh-plugin`, an executable development Skill for cache-safe out-of-tree DSH extensions.
- `dsh-evolve` P0A.1 Shadow safety tracer with owned-path, symlink, integrity, token-budget and credential-persistence tests.
- A macOS Sealed Trial execution primitive with real read, write, process, network, environment, timeout and output-limit tests.
- A calibrated `shadow` vertical slice that exposes only search evidence to the proposer, runs known-bad, known-correction, baseline and Candidate in separate macOS Sealed Trials, and keeps the final-test evaluator hidden.
- Public status, contributor, support and security documentation.
- `dsh-evolve` P1.3 explicit-feedback intake, which turns current DSH negative message feedback with a note into bounded, retractable, reference-only host signals without adding model-visible context.
- `dsh-evolve` P1.4 private Feedback Case Drafts, created only after explicit root configuration and a per-signal host command, with exact Generation/Skill attribution, content-addressed private files, and zero model calls.
- `dsh-evolve` P1.5 feedback-guided Shadow, which supplies one exact private draft only to the proposer while the existing calibrated Case Pack remains the independent evaluator; draft fields are not directly copied into durable evidence.
- `dsh-evolve` P1.6 zero-model Case Pack calibration and automatic pre-proposal calibration for complete Shadow runs; invalid evaluator direction now consumes no proposer request.
- `dsh-evolve` P1.8 explicit target-bound Feedback Shadow Launch through host Commands and Web, with native Jobs execution, content-addressed retry, path-free browser transport, and no foreground Session or model-surface changes.
- `dsh-evolve` P1.14 opt-in Automatic Feedback Shadow, which lets one unambiguous explicit correction enter one existing exact-hash Target, reuses the current Shadow/Retention/release chain, and never retries an uncertain paid proposal or changes the originating Session.
- `dsh-evolve` P1.15 Automatic Evolution Budget, a per-Target UTC-day cap reserved durably before an automatic paid boundary, with crash-safe idempotency, fail-closed corruption handling, bounded Commands/Web status, and zero Session/model-surface change.
- `dsh-evolve` P1.16 Automatic Evaluator Draft, an opt-in static policy that turns one unambiguous explicit correction into a private inactive evaluator proposal after a durable daily reservation, while human qualification, Shadow, and Promotion remain separate.
- `dsh-evolve` P1.17 Human-approved Qualify-and-Shadow, a single cancellable action that runs sealed qualification and starts one explicitly authorized paid Shadow only after calibration succeeds, while retaining the original split actions.
- `dsh-software-delivery` P2C.3 bounded exact-head Draft check waiting, an opt-in host policy that removes mechanical Agent retries while keeping failure, timeout, cancellation and head drift fail-closed and leaving the Tool/Skill model surface unchanged.
- A 64-turn real DSH Agent parity gate proving that a fully configured evolution host plane and a future-Generation pointer change leave every current-Session model-visible request and reusable prefix byte-equivalent to the no-EvoForge control.
- `dsh-evolve-web`, a removable DSH profile Bundle with a no-Session global sidebar entry, generated Remote transport, bounded review evidence, and durable pause/resume/approve/reject/promote/rollback actions without polling or model-visible context.
- An explainable `dsh-evolve-web` Candidate detail that keeps the claim, changed files, decision reasons, limitations, cases, token cost, protected-effect hints, and exact diff together, then clears the stale review form after approve or reject.
- `dsh-resident`, a zero-token operational CLI that renders and explicitly manages one exact DSH profile as a user-level launchd/systemd service, with a real macOS DSH `SIGKILL` restart lifecycle and clean unit removal.
- `dsh-evolve-attention`, a zero-token bridge that sends durable, bounded Workspace-scoped attention for actionable Candidate and Evaluator Draft states through existing exact Telegram and/or Feishu routes while the originating Session continues.
- `dsh-github-review`, a cache-stable read-only GitHub bridge that turns an allowlisted human's exact-head Draft-PR `CHANGES_REQUESTED` review into one bounded, untrusted native Agent follow-up in the originating Session, with crash recovery and no merge authority.
- A suite-wide `test:cache-contract` gate covering 64-turn Evolution parity, GitHub review, Goal cold resume, stable Software Delivery surfaces, and two native Workspace Agents with Router, Telegram, Feishu, and evolution attention simultaneously active.

### Security

- `shadow` executes only the trusted Case Pack evaluator inside the integrated macOS boundary. The opt-in assembled lane may boot an exact pinned DSH checkout, but Candidate files remain inactive data and arbitrary Candidate code execution remains disabled.
