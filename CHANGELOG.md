# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Changed

- Removed the stale newcomer instruction to configure a Shadow/Evaluator Target; the current internal-evidence flow
  reports evidence and governance readiness directly and never asks users to choose a Skill, target, or path.
- Marked the historical Sidebar Web decisions as superseded and aligned ADR-0099 with the completed `dsh-evolve-web`
  migration into the native Control Center child surface.
- Corrected the `dsh-evolve-attention` README to describe both static routes and resident pairing grants;
  the bridge consumes only Host-authorized routes and never creates a second routing path.
- `pack:suite` now defaults to the user-facing `core` suite when `--suite` is omitted; the maintainer-only twelve-Bundle
  composition remains available only through the explicit `pack:full` command or `--suite full`.
- `pack:suite --suite channels` now accepts `--channel feishu|telegram` to install only the selected first-party Adapter;
  the Gateway/Adapter runtime and permission boundaries remain independent. See [V5.46 evidence](docs/evidence/v5-46-channel-selective-suite-pack-2026-08-26.zh.md).
- `pack:suite --help` now separates the four user-facing suites from the optional, compatibility, advanced, and
  maintainer-only entries, so internal Bundle composition is not presented as a twelve-way product picker; a regression
  test now locks this public ordering.
- The native Control Center empty state now explains the four public capability suites (`core`, `channels`, `delivery`,
  and `continuity`) and explicitly distinguishes those user entry points from independently manageable underlying
  Bundles, so a profile with no contributed surfaces is still self-explanatory.
- Compatibility lifecycle probes now inspect the target DSH Web CLI before choosing the no-browser handoff: rc.2 uses
  `--no-open`, while rc.5 keeps its flag-free `--port` contract. Random-port probes therefore do not leave dead tabs
  behind, and both supported DSH revisions retain a tested startup path. See [V5.50 evidence](docs/evidence/v5-50-single-browser-lifecycle-2026-08-26.zh.md).
- Added a tag/version consistency gate and a protected tag-triggered GitHub release workflow. It reruns the full check
  and every required release gate before publishing public Bundles to npm; the `npm` Environment remains maintainer-
  approved and no gate bypass is available. The local annotated-tag command runs the same version check before creating
  the tag, while the workflow supports either an npm token or trusted publishing. A workflow contract test now locks
  the tag-only trigger, annotated-tag/main ancestry check, protected Environment, gate-before-publish order, and
  commit-pinned Actions.
- The Evolution Control Center child surface now contributes a localized navigation label (`演化`/`Evolution`) instead
  of exposing its internal `evoforge-evolution` slot id to users.
- The dual DSH assembled matrix now materializes a temporary Case Pack copy whose epoch is bound to the checked-out
  revision; strict identity checks no longer fail rc.5 against an rc.2 fixture. The CI preflight requires this step.
  See [V5.43](docs/evidence/v5-43-dsh-matrix-case-pack-identity-2026-08-26.zh.md).
- Root typecheck now builds `dsh-control-center` before recursive consumers, and CI preflight locks that order so a clean
  runner cannot depend on stale client `lib` output. See [V5.42](docs/evidence/v5-42-ci-typecheck-preflight-2026-08-26.zh.md).
- Clean-runner CI now declares `tsx` directly in `dsh-feishu`, builds both Host and Client faces of the audited DSH
  checkout for assembled profiles, and checks that workflow invariant before execution. See [V5.41](docs/evidence/v5-41-ci-clean-runner-dependencies-2026-08-26.zh.md).
- Public installation docs now point to the native DSH `控制台 → 渠道` Surface and audited rc.2/rc.5 hosts; the docs checker rejects retired sidebar/Router channel-health instructions. See [V5.40](docs/evidence/v5-40-public-control-center-docs-2026-08-26.zh.md).
- The macOS assembled CI job now runs the same acceptance set against both audited DSH targets (`0.1.0-rc.5` and current `0.1.1-rc.2`), instead of silently testing only the older host. See [V5.39](docs/evidence/v5-39-ci-dsh-dual-target-matrix-2026-08-26.zh.md).
- GitHub Actions macOS assembled coverage now references only current test files; a new `check:ci` preflight catches stale package test paths before they reach a clean runner. See [V5.38](docs/evidence/v5-38-ci-workflow-current-paths-2026-08-26.zh.md).
- The Telegram adapter now has a verified real-DSH loopback browser path inside the shared Control Center (route, transport, refresh, reload, and zero application console errors). This remains deterministic loopback evidence, not a real Bot or release-gate pass; see [V5.37](docs/evidence/v5-37-telegram-control-surface-browser-2026-08-26.zh.md).
- `dsh-doctor` and `dsh-telegram` now contribute read-only native Control Center Surfaces through the official DSH client slot. Doctor's real browser refresh/disconnect/recovery path is documented in [V5.36](docs/evidence/v5-36-doctor-control-surface-browser-2026-08-26.zh.md); Telegram's real authorized route remains a release blocker.
- User-facing installation is now organized into four default entries: `core`, `channels`, `delivery`, and `continuity`. `attention` is optional, `evolution`/`control`/`gateway` remain compatibility or advanced entries, and `full` is maintainer-only. The underlying DSH Bundles remain independently installable, permission-scoped, and removable; `channels` no longer forces the Web Control Center or attention bridge.
- The public-package release preflight now verifies MIT/repository metadata, package READMEs, exported Cordis patches, and publishable Bundle manifests; CI runs that preflight on every matrix entry.
- Added a machine-readable `release-gates.json` and an annotated-tag command that refuses dirty/non-main/out-of-sync trees or any incomplete real-evidence gate.
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
