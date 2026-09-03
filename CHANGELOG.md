# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Changed

- Removed the stale fixed `dsh-evolve-panel` and confirmation-backdrop CSS from the legacy
  `EvolutionAction` compatibility export. The export remains source-compatible but now renders its
  opened surface inline in normal document flow; the active registration remains the native DSH
  Control Center `conversation.view`. Added a negative package contract so fixed overlays cannot
  return. This is a single-page boundary cleanup and does not advance real Feishu, Provider, Hermes
  paired, long-term-effects, or release-tag gates. See [V5.86 evidence](docs/evidence/v5-86-remove-stale-evolution-overlay-2026-09-04.zh.md).

- Added an exact DSH preflight to the root `check`: assembled tests now require an explicit, clean, allowlisted DSH
  checkout and fail immediately with a copyable command when it is missing or mismatched. The alpha.5 full check
  still passes; this improves contributor feedback without broadening compatibility or release claims. See
  [V5.85 evidence](docs/evidence/v5-85-dsh-preflight-2026-09-04.zh.md).

- Re-ran the complete repository check against the audited, buildable DSH alpha.5 support baseline after the
  single-page channel journey work. Documentation/CI/package contracts, all package typechecks, tests, artifact
  verification, and builds passed; explicit historical/platform skips remain skips. This is a reproducible
  engineering-quality result only: real Feishu AS-2, independent Providers, Hermes paired, long-term effects, and
  the first release tag remain blocked. See [V5.84 evidence](docs/evidence/v5-84-alpha5-full-check-2026-09-04.zh.md).

- Added a shared, optional Control Center `Journey` component and a Gateway-driven Feishu newcomer guide. The
  native single-page Channels surface now explains resident connection → user DM → admin approval from redacted
  Host facts, while Telegram-only installs stay free of Feishu setup noise. A clean alpha.5 browser profile verified
  the guide, one-page layout, and reload recovery; the change does not claim real channel/provider/Hermes or release
  gates. See [V5.83 evidence](docs/evidence/v5-83-channel-journey-single-page-browser-2026-09-04.zh.md).

- Audited the user-facing Feishu README and release evidence for stale status. The guide now describes the current
  epoch-4 contract and the latest isolated run honestly: the official WebSocket reached `ready`, but no matching
  newcomer DM arrived before pairing, so the run failed closed and is not presented as a real-channel pass. Fixed
  the browser evidence link to the root `release-gates.json`; no runtime or release-gate status changed. See
  [V5.82 status](docs/status.zh.md#v582用户文档与发布门禁证据一致性审计本轮).

- Fixed the latest-DSH browser acceptance overlays so their test-only Control Center fixture is loaded through an
  external temporary ESM shim. DSH's nearest-`package.json` client identity resolver no longer mistakes the fixture
  for a second `dsh-control-center` source. A clean alpha.5 profile was then booted on the latest audited DSH
  support baseline and verified in one native Web page: real workspace/session selection, Control Center, Doctor
  refresh, keyboard surface switching, and page reload recovery all worked without opening another tab. This is
  acceptance-harness hardening, not a release claim; real channel/provider/Hermes gates remain unchanged. See
  [V5.81 evidence](docs/evidence/v5-81-browser-overlay-package-identity-2026-09-03.zh.md).

- Completed another isolated real Feishu AS-2 epoch-4 run: final Bundles installed, the clean profile was dumped,
  and the official WebSocket reached `ready`, but the 15-minute window still produced no matching pending private
  message. The runner failed closed before approval, Agent dispatch, or any external effect; the gate remains failed.
  This run was frozen before the V5.78/V5.79 health commits and is recorded separately rather than treated as their
  validation. See [V5.80 evidence](docs/evidence/v5-80-feishu-as2-latest-isolated-retry-2026-09-03.zh.md).

- Completed the Feishu reconnect-health follow-through: the Adapter now forwards its observed `lastInboundAt` into
  the shared Gateway transport registration, so the one-page Gateway view and the Feishu-specific health command
  expose the same inbound-event fact. An assembled-chat regression assertion covers the projection. See [V5.79
  evidence](docs/evidence/v5-79-feishu-inbound-projection-follow-through-2026-09-03.zh.md).

- Feishu's official WebSocket reconnect lifecycle is now projected through the existing Gateway transport health:
  `reconnecting` becomes `degraded` and `reconnected` returns to `ready` without restarting the DSH Host. Older
  platform test doubles may omit these optional hooks. The native Control Center therefore does not mistake a
  silently reconnecting resident Adapter for a healthy connection. See [V5.78 evidence](docs/evidence/v5-78-feishu-reconnect-health-2026-09-03.zh.md).

- Gateway transport health now exposes a redacted `lastInboundAt` separately from generic activity. Feishu and
  Telegram report real inbound events, and the single native Channels page can distinguish a connected transport from
  one that has actually received a platform event. No routing, pairing, delivery, or model behavior changed. See
  [V5.77 evidence](docs/evidence/v5-77-gateway-inbound-observation-2026-09-03.zh.md).

- Feishu health now separates the last inbound platform event from generic transport activity. The single native
  Control Center page says explicitly when the WebSocket is connected but no event has arrived, without probing
  permissions, reading credentials, or calling a model. See [V5.76 evidence](docs/evidence/v5-76-feishu-inbound-observation-2026-09-03.zh.md).

- Re-checked the current public HEADs for Hermes Agent, OpenClaw, and HanaAgent/openhanako and recorded tag-vs-HEAD
  identity separately. These projects remain design/paired references only; no runtime acquisition or dependency was
  added. See [the current revision audit](docs/research/ecosystem-current-revision-2026-09-03.zh.md).

- Recorded a fresh isolated retry of the real Feishu AS-2 epoch-4 contract: final Control Center/Gateway/Feishu bundles installed, the
  profile dumped, and the official WebSocket reached ready, but no matching pending pairing request arrived during
  the human window. The runner failed closed before Agent or external effects; the real-channel gate remains failed.
  See [V5.74 evidence](docs/evidence/v5-74-feishu-as2-epoch5-no-event-2026-09-03.zh.md).

- Re-audited all twelve physical Bundles and documented the minimal four user-facing suites. Independent Bundles are
  retained only for distinct lifecycle, permission, or external trust boundaries; ClawHub/market acquisition,
  duplicate Router/state, and other retired surfaces remain explicitly excluded. See the
  [package-boundary audit](docs/audits/2026-09-03-package-boundary-audit.zh.md).
- Recorded the latest DSH rc.1 tag and remote `master` re-audit separately from the alpha.5 buildable support baseline;
  both upstream clean builds remain blocked at the root tsdown entry. See [V5.72 evidence](docs/evidence/v5-72-latest-dsh-master-reaudit-2026-09-03.zh.md).

- Channel-only installs now include the lightweight native `dsh-control-center` alongside `dsh-gateway` and the
  selected Feishu/Telegram Adapter. Pairing approval and transport health therefore stay in one DSH Web page without
  forcing self-evolution or attention packages. The real Feishu AS-2 runner installs and removes that Control Center
  too; its latest human-window run remained a strict failure because no new pending Feishu DM arrived. See
  [V5.71 evidence](docs/evidence/v5-71-channel-suite-control-center-and-real-run-2026-09-03.zh.md).

- Migrated the public plugin suite to the audited DSH `0.1.2-alpha.5` contract and narrowed every published
  DSH peer range to that version. Historical rc.5/rc.2 revisions remain research evidence only until a separate
  runtime-specific migration matrix is rebuilt; the compatibility script and CI now exercise the current alpha.5
  tag only. See [alpha.5 migration audit](docs/research/dsh-alpha5-migration-audit-2026-09-03.zh.md) and
  [V5.69 evidence](docs/evidence/v5-69-dsh-alpha5-migration-2026-09-03.zh.md).
- Replaced the root README with a user-facing installation and operation guide. Internal progress history,
  release blockers, and DSH source/packaged-interface caveats remain in `docs/` instead of being presented as
  end-user instructions.

- Fixed a nondeterministic macOS assembled CI failure where `dsh-evolve-attention`'s shared channel-peer
  prebuild raced a duplicate direct `dsh-telegram` build and could clean `dist/index.mjs` after it was produced.
  The workflow now has one Telegram build path and `check:ci` prevents the duplicate from returning. This does not
  change the still-blocked real Feishu, real Provider, Hermes paired, or long-term release gates. See
  [V5.68 evidence](docs/evidence/v5-68-ci-telegram-build-race-2026-09-02.zh.md).

- The native Control Center now exposes accessible ARIA tabs with roving keyboard focus: arrow keys move between
  plugin surfaces, while Home/End jump to the first/last surface. Each tab points at the single active panel, so the
  entire visualization remains inside one DSH `conversation.view` without a second page or hidden router.
- Gateway transport details in the native Control Center now show the Host-recorded connection, last-activity, and
  last-error timestamps. This makes a ready WebSocket distinguishable from an Adapter that has actually received a
  platform event, without probing the platform, reading credentials, or calling a model.
- The native Gateway Control Center now polls the Host's redacted pending-pairing projection on the same page every
  five seconds. New requests appear without a second tab or a manual refresh, while transient poll failures retain
  the last authoritative list; the surface still performs no model call or mutation during polling.
- Resident Gateway pending pairing requests are now visible inside the native DSH Control Center and can be approved
  through the Host by opaque request id; code entry remains a compatibility path, not a Session command.
- The real Feishu AS-2 acceptance runner now consumes that redacted Host pending-request path and no longer waits for
  a pairing code on stdin. The complete real platform epoch is still a release blocker until its terminal report passes.
- Root package tests serialize cross-package `pretest → build → test` lifecycles while preserving package-internal
  parallelism; a complete local `pnpm test` now passes without shared-artifact or launchd fixture starvation.
- Public English capability claims and the security policy now describe the current content-addressed Candidate,
  separated governance/evaluation/mutation, future-Session promotion, Gateway authorization, and release-gate boundary;
  removed Feedback Draft CLI surfaces are no longer documented as active.
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
- User-facing installation is now organized into four default entries: `core`, `channels`, `delivery`, and `continuity`. `attention` is optional, `evolution`/`control`/`gateway` remain compatibility or advanced entries, and `full` is maintainer-only. The underlying DSH Bundles remain independently installable, permission-scoped, and removable; `channels` includes only the lightweight Web Control Center needed for one-page pairing and health, not the evolution or attention bridge.
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
