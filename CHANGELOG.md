# Changelog

All notable changes will be recorded here. The project has not published a stable release.

## Unreleased

### Changed

- **V5.183**: Re-fetched and audited canonical DSH, then verified the Web experience with one Host and one browser page. The
  native Session `控制台` tab renders EvoForge Control Center in `conversation.view`; Runtime Doctor and Channels tabs switch
  in place, status refresh is clickable, revocation requires a second confirmation, and reloading the same URL restores the
  control surface. The final browser tab count was one and no second dashboard or fixed overlay was used. This is browser-layout
  and interaction evidence only; real channel, Provider/Hermes, long-run, npm, and tag gates remain blocked. See [V5.183 evidence](docs/evidence/v5-183-single-page-control-center-browser-2026-09-04.zh.md).

- **V5.182**: Aligned Telegram with the native DSH credential lifecycle. Structural route/pairing validation and a stable Host
  façade now load before the Bot token; an empty or invalid credential reference leaves the Host fail-closed and bootable without
  polling or Telegram effects. A committed `credentials/reference-updated` event disposes and replaces the runtime in place,
  without a second Gateway route, Session, or Web page. Added a real Cordis lifecycle test for missing-token boot, update, start,
  and unload. Telegram `10 files / 36 tests`, typecheck, build, and the subsequent latest-DSH full check (`CHECK_RC=0`) pass;
  Evolution `309/309`, Gateway `41/41`, and Feishu `19 files / 55 tests` remain green. Real Telegram/Feishu, Provider/Hermes,
  long-run, npm, and tag gates remain blocked. See [V5.182 evidence](docs/evidence/v5-182-telegram-native-credential-lazy-start-2026-09-04.zh.md).

- **V5.181**: Fixed custom Feishu credential references in the Web form. The Host now publishes a minimal typed Remote,
  `evoforgeFeishu/references()`, that returns only configured reference names; the browser then uses DSH's native
  write-only `remote.credentials.describe/set` seam for either defaults or custom names. Added generated artifact/source-digest
  guards, package exports, default/custom jsdom coverage, and the Remote service test. Feishu 3 files / 9 tests, typecheck,
  build, and Typert generation pass; the subsequent latest-DSH full check finished `CHECK_RC=0` with Feishu `19 files / 55 tests`,
  Gateway `41/41`, and Evolution `309/309`. The English README now documents native CredentialProvider setup. Real channel,
  Provider/Hermes, long-run, npm, and tag gates remain blocked. See [V5.181 evidence](docs/evidence/v5-181-feishu-custom-credential-reference-remote-2026-09-04.zh.md).

- **V5.180**: Added a native DSH Web credential section to the Feishu surface. App ID and App Secret use the official
  `remote.credentials` write-only seam; metadata is shown without echoing values, and a committed reference update
  restarts the same resident Adapter façade. Missing/invalid references now leave Feishu fail-closed while allowing the
  DSH Host, Gateway, Web, Session, and Goal services to boot. Feishu `52/52`, typecheck/build, channels packing, and
  the authoritative alpha.5 `pnpm run check` (`CHECK_RC=0`) pass. This increment did not claim real Feishu AS-2 or
  browser form completion; the remaining external, Provider, Hermes, long-run, npm, and tag gates stay blocked. See
  [V5.180 evidence](docs/evidence/v5-180-native-feishu-credential-surface-and-lazy-start-2026-09-04.zh.md).

- **V5.179**: Re-fetched and audited the latest canonical DSH before moving both channel adapters from direct
  `process.env` secret reads to the native `CredentialProvider` seam. Feishu App credentials and the Telegram Bot token
  now resolve through `ctx.credentials` with fail-closed validation; legacy `*Env` field names remain only for profile
  compatibility. Packed Telegram boundary and assembled tests, Telegram `35/35`, Feishu `51/51`, typechecks, and builds
  pass. User docs now describe DSH Web/local credential setup and durable pack paths. Real channel, live rotation,
  Hermes-paired, long-run, and npm ownership gates remain blocked. See [V5.179 evidence](docs/evidence/v5-179-native-channel-credentials-2026-09-04.zh.md)
  and [ADR-0103](docs/adr/0103-channel-adapters-use-native-dsh-credentials.md).

- **V5.178**: Re-fetched canonical DSH and ran the complete alpha.5 repository check after the CI package-filter and
  Telegram worker fix. The authoritative no-pipeline rerun finished `CHECK_RC=0`: Evolution `309/309`, Gateway `41/41`,
  Feishu `50/50`, Telegram `34/34`, Doctor `40/40`, Evolve Web `27/27`, all Bundle typechecks/builds, and the
  clean-profile lifecycle passed (platform-specific skips remain explicit). An earlier run whose outer zsh exit-code
  wrapper failed was discarded rather than reported as green. Real external release gates remain blocked. See
  [V5.178 evidence](docs/evidence/v5-178-full-check-after-ci-filter-fix-2026-09-04.zh.md).

- **V5.177**: Fixed GitHub Actions after the project-prefixed package-name migration and removed a real assembled
  Telegram test race. CI now filters Doctor/Telegram by their public package names, honors Telegram's package-declared
  single-worker policy while `prepack` can clean shared `dist`, and fails closed when a workflow uses a migrated
  directory id, an unknown package filter, or bypasses a package worker limit. The pre-fix two-file repro failed `1/2`
  with `ERR_MODULE_NOT_FOUND`; the same pair passed `2/2` and the full Telegram CI subset passed `4/4` after the fix.
  See [V5.177 evidence](docs/evidence/v5-177-ci-public-name-and-telegram-worker-contract-2026-09-04.zh.md).

- **V5.176**: Refreshed `release-gates.json` to index the latest suite-pack, single-page browser, current-Hermes
  deterministic EV-1, and full-check evidence without changing any gate status or blocker. Gate manifest tests pass
  `3/3`, evidence is complete, and the aggregate remains `blocked`; no SemVer tag was created. See
  [V5.176 evidence](docs/evidence/v5-176-release-gate-evidence-index-refresh-2026-09-04.zh.md).

- **V5.175**: Re-fetched and audited canonical DSH, then ran the complete alpha.5 `pnpm run check` after the suite
  packer fix. The run exited `0`: DSH preflight, docs/CI/suite/release-script gates, Typert/typecheck/builds,
  clean-profile lifecycle, and all Bundle tests passed (Evolution `309/309`, Gateway `41/41`, Feishu `50/50`, Telegram
  `34/34`, Doctor `40/40`, Evolve Web `27/27`, Control Center `27/27`; platform-specific skips remain explicit).
  Real channel, Provider, Hermes paired, long-term, and npm ownership gates remain blocked. See
  [V5.175 evidence](docs/evidence/v5-175-full-check-after-suite-packer-fix-2026-09-04.zh.md).

- **V5.174**: Re-ran the current-Hermes EV-1 epoch-4 deterministic paired control benchmark on the audited DSH
  alpha.5 support checkout and Hermes revision `29d0cc2602e01943ab300c0382fc9d97efb376da`. Calibration passed `2/2`
  and the run exited `0`; EvoForge made `0` active-Skill mutations before explicit promotion while the Hermes production
  seam made `1`, with EvoForge preserving current-Session generation and exact rollback. This is a narrow release-control
  result only, not model/channel/long-term or global Hermes-replacement evidence. See
  [V5.174 evidence](docs/evidence/v5-174-hermes-current-ev1-epoch4-rerun-2026-09-04.zh.md).

- **V5.173**: Fixed the public suite packer after the project-prefixed distribution-name migration. Suite entries keep
  stable workspace directory ids, while `pnpm pack` now filters by each package's declared public `manifest.name`; the
  regression is covered and `channels/feishu` now produces installable Control Center, Gateway, and Feishu tarballs.
  Re-fetched canonical DSH before a real alpha.5 single-page Web check: one `--no-open` Host, one native Session,
  Control Center channel journey, refresh, full-page reload recovery, and zero browser errors. A stale refused page was
  cleaned at the end; fixture observations do not count as real external channel or Hermes paired evidence. See
  [V5.173 evidence](docs/evidence/v5-173-suite-pack-and-single-page-browser-2026-09-04.zh.md).

- **V5.172**: Added a bounded, read-only Feishu startup App diagnostic behind the official Adapter. It reports bot
  identity resolution, the two required message transport scopes, and whether the event-subscription read API is
  reachable; missing message scopes are `attention`, while an unavailable `event:subscription:read` check remains
  `not-verified` and never tears down a live WebSocket. The optional redacted result is projected into the existing V2
  health snapshot and native single-page Control Center without a new Remote, Gateway, state store, browser request, or
  model call. The Web bundle remains about 36 KB because the Node-only SDK stays out of the client. Feishu targeted tests
  pass `12/12`, with typecheck/build green; real AS-2 and all external release gates remain blocked. See
  [V5.172 evidence](docs/evidence/v5-172-feishu-startup-access-diagnostic-2026-09-04.zh.md) and
  [ADR-0102](docs/adr/0102-feishu-startup-access-diagnostic-is-advisory.md).

- **V5.171**: Migrated the four colliding unscoped distribution names to the project-prefixed
  `dsh-evoforge-{doctor,feishu,gateway,telegram}` names across manifests, Cordis patches, Typert artifacts, workspace
  dependencies, suites, fixtures, benchmarks, and user installation docs. Repository directories and logical Bundle ids
  remain stable; no alias or second runtime was introduced. Re-fetched canonical DSH `origin/master` `76fda729` before
  regenerating artifacts and rerunning the alpha.5 checks: Evolution `309/309`, Doctor `40/40`, Gateway `41/41`, Feishu
  `46/46`, Telegram `34/34`, Evolve-attention `11/11`, Evolve Web `27/27`, clean-profile `1/1`, and root build `0`.
  The names are currently available but not proven maintainer-owned, so registry release remains fail-closed. See
  [V5.171 evidence](docs/evidence/v5-171-public-package-name-migration-2026-09-04.zh.md).

- **V5.170**: Re-fetched canonical DSH before rerunning the complete alpha.5 check after integrating the latest-DSH
  audit classifier into the root check chain. The run finished `CHECK_RC=0`; Evolution `309/309`, Gateway `41/41`,
  Feishu `46/46`, Telegram `34/34`, Resident `17 passed / 1 skipped`, clean-profile `1 passed / 1 skipped`, all 12
  Bundle typechecks/tests/builds, and the new `2/2` classifier tests passed. Real release gates remain unchanged. See
  [V5.170 evidence](docs/evidence/v5-170-full-check-after-dsh-audit-command-2026-09-04.zh.md).

- **V5.169**: Added `audit:dsh:latest`, a repeatable maintainer command that fetches canonical DSH, verifies clean
  `HEAD == origin/master`, installs dependencies, runs the official root build, and distinguishes the known rc.1
  `lib/types` upstream defect (exit `2`) from unknown failures (exit `1`). The canonical DSH audit returned revision
  `76fda729`, install `0`, build classification `blocked-upstream-root-types-entry`, and audit exit `2`; classifier tests
  passed `2/2` and are now part of the root `pnpm check`. See [V5.169 evidence](docs/evidence/v5-169-latest-dsh-audit-command-2026-09-04.zh.md).

- **V5.168**: Re-fetched and audited the latest canonical DSH before rerunning the complete alpha.5 repository check
  after the unpublished-install documentation guard. The run finished with `CHECK_RC=0`: Evolution `309/309`, Gateway
  `41/41`, Feishu `46/46`, Telegram `34/34`, Resident `17 passed / 1 skipped`, clean-profile `1 passed / 1 skipped`,
  all 12 Bundle typechecks/tests/builds, and the new docs guard passed. Real channel, Provider, Hermes paired, long-term,
  and npm gates remain unchanged. See [V5.168 evidence](docs/evidence/v5-168-full-check-after-install-guard-2026-09-04.zh.md).

- **V5.167**: Added a `check-docs` guard that rejects bare `dsh plugin ... add dsh-*` registry names in operational
  documentation while packages remain unpublished. Local tarball paths and historical evidence are unaffected. The
  documentation, diff, and release preflight checks passed; runtime behavior is unchanged. See [V5.167 evidence](docs/evidence/v5-167-unpublished-install-doc-guard-2026-09-04.zh.md).

- **V5.166**: Added explicit registry-not-published warnings to the Chinese and English root READMEs. Users are told
  to build local suite tarballs before invoking the official DSH installer, preventing accidental installation of
  unrelated packages that share an unscoped `dsh-*` name. Documentation and diff checks passed; runtime behavior is
  unchanged. See [V5.166 evidence](docs/evidence/v5-166-root-readme-registry-warning-2026-09-04.zh.md).

- **V5.165**: Updated the maintainer EV-1 example to the current Hermes `origin/main` revision
  `29d0cc2602e01943ab300c0382fc9d97efb376da` and epoch-4, replacing the retired epoch-3 checkout while retaining
  exact revision assertions and fail-closed drift handling. Documentation and diff checks passed; benchmark gate status
  is unchanged. See [V5.165 evidence](docs/evidence/v5-165-current-hermes-install-doc-2026-09-04.zh.md).

- **V5.164**: Corrected the `dsh-github-review` README so it no longer instructs users to install an unpublished
  registry name. It now uses the reproducible `delivery` suite tarballs and states that a project-owned namespace and
  release tag must exist before switching to a registry spec. Documentation and diff checks passed; runtime behavior is
  unchanged. See [V5.164 evidence](docs/evidence/v5-164-user-install-doc-correction-2026-09-04.zh.md).

- **V5.163**: Re-fetched the latest canonical DSH and recorded an open-source readiness audit. Static Bundle metadata
  checks pass, while npm ownership, the latest DSH clean build, real Feishu/Telegram paths, real Provider pairing, the
  same-condition Hermes run, and long-term outcome data still block a registry release. The audit also explains why the
  12 physical Bundles are exposed through four user suites without collapsing independent lifecycle and trust boundaries.
  See [V5.163 evidence](docs/evidence/v5-163-open-source-readiness-audit-2026-09-04.zh.md).

- **V5.162**: Re-fetched canonical DSH rc.1 and reran its own frozen install/build boundary. Dependency installation
  passed, but the official root build still exits `1` because `@deepseek-ai/dsh-root` cannot resolve
  `lib/types/{index,invariant,startup}.js`; the DSH worktree remains clean. This upstream defect is recorded separately
  from EvoForge's rc.1 clean-profile compatibility and keeps the formal support claim on alpha.5 until DSH repairs its
  root build. See [V5.162 evidence](docs/evidence/v5-162-dsh-rc1-root-build-boundary-2026-09-04.zh.md).

- **V5.161**: Ran the clean-profile suite against canonical DSH rc.1 and the pinned alpha.5 support checkout. The
  first rc.1 attempt exposed a real fixture drift (`sessionPersistence.load` was removed); the fixture now prefers the
  official `open(id, 'read')`/`read()`/`close()` seam and falls back to `load()` only for alpha.5. Both baselines passed
  `1/1`, covering official install, native Host/Goal/Session/Storage, a Tool call, dispose, remove, and readback. This
  broadens compatibility evidence without hiding the rc.1 root tsdown build defect or changing the alpha.5 support claim.
  See [V5.161 evidence](docs/evidence/v5-161-current-dsh-rc1-clean-profile-compatibility-2026-09-04.zh.md).

- **V5.160**: Re-ran the full alpha.5 repository check after rebasing the current Hermes EV-1 benchmark. The audited
  DSH rc.1 was fetched and verified clean; documentation, CI/suite/release contracts, Hermes/Provider/Feishu/Telegram
  acceptance contracts, all 12 Bundle typechecks, tests, and builds passed (`CHECK_RC=0`). Key counts were Evolution
  `309/309`, Gateway `41/41`, Feishu `46/46`, Telegram `34/34`, Resident `17 passed / 1 skipped`, and clean-profile
  software delivery `1 passed / 1 skipped`. No real credentials or external effects were used, and real release gates
  remain unchanged. See [V5.160 evidence](docs/evidence/v5-160-alpha5-full-check-after-hermes-epoch4-2026-09-04.zh.md).

- **V5.159**: Re-fetched Hermes and detected that `origin/main` had moved from the epoch-3 pin to
  `29d0cc2602e01943ab300c0382fc9d97efb376da`. The stale current manifest correctly failed its revision assertion;
  a new epoch-4 manifest/result now runs the same DSH alpha.5 frozen deterministic EV-1 comparison against current
  Hermes. Calibration was `2/2`, both sides were fail→pass, EvoForge's primary metric was `0` versus Hermes `1`, and
  all six EvoForge release-control hard gates held. This remains deterministic control evidence, not model quality,
  real-channel, long-term, or full Hermes paired evidence. See [V5.159 evidence](docs/evidence/v5-159-hermes-current-revision-ev1-epoch4-2026-09-04.zh.md).

- **V5.158**: Captured a machine-readable `check:release:gates -- --json` snapshot. The manifest and every evidence
  path validate, while seven real release conditions remain blocked: npm namespace ownership, external Telegram and
  Feishu epochs, real Provider paired runs, the same-model Hermes pairing, and long-term outcome data. No SemVer tag was
  created; local clean-profile success is not presented as a completed Hermes replacement. See [V5.158 evidence](docs/evidence/v5-158-release-gate-json-snapshot-2026-09-04.zh.md).

- **V5.157**: Ran the official DSH clean-profile lifecycle against the four user suites (12 Bundles): packed and
  installed through `dsh plugin --profile web add`, booted the native Host, exercised native Session/Goal/Storage and
  a real Tool call, disposed the Fiber, removed every plugin with the official command, and read the persisted Goal
  back after removal. The single test passed (`exit 0`, ~39.74s) with no browser-opening handoff. This validates local
  installability and reversibility only; real channels, Provider paired runs, long-term effects, npm names, and Hermes
  publication gates remain unchanged. See [V5.157 evidence](docs/evidence/v5-157-clean-profile-user-suite-install-2026-09-04.zh.md).

- **V5.156**: Packed the four user-facing suites and audited all 12 resulting tarballs: `core` (4), `channels` (4),
  `delivery` (2), and `continuity` (2). Each suite emitted `evoforge-suite.json` with version/SHA-256/audience, and
  no tarball contained `node_modules`, `.bin`, or a product `bin` directory. This verifies package boundaries only; real
  channels, Providers, Hermes pairing, long-term effects, and registry publication remain gated. See [V5.156 evidence](docs/evidence/v5-156-user-suite-tarball-boundary-2026-09-04.zh.md).

- **V5.155**: Standardized all user-facing Web startup examples on `dsh --profile web --no-open`, documented reuse
  of one existing browser tab, and added a `check-docs` guard that rejects a bare `dsh --profile web` in operational
  documentation. Documentation checks passed; runtime and release-gate status are unchanged. See [V5.155 evidence](docs/evidence/v5-155-single-web-doc-guard-2026-09-04.zh.md).

- **V5.154**: Updated the root README, getting-started guide, and capability-suite guide to start the DSH Web Host
  with `--no-open`, reuse one existing browser tab, and refresh without launching another Host. The docs now state the
  supported DSH alpha.5 revision and explain that `dsh-resident` defaults to `noOpen: true`, with `noOpen: false` as an
  explicit opt-out. Documentation checks passed; runtime and release-gate status are unchanged. See [V5.154 evidence](docs/evidence/v5-154-single-web-startup-docs-2026-09-04.zh.md).

- **V5.153**: Re-ran the complete alpha.5 repository check after making resident Web services default to DSH's
  `--no-open` handoff. The latest canonical DSH rc.1 was fetched and verified clean; documentation, contracts, all 12
  Bundle typechecks, tests, and builds passed (`exit 0`, Resident `17 passed / 1 skipped`, Gateway `41/41`, Feishu
  `46/46`, Telegram `34/34`, Evolution `309/309`). No real credentials or external effects were used; real-channel,
  Provider, Hermes paired, long-term, and npm gates remain unchanged. See [V5.153 evidence](docs/evidence/v5-153-alpha5-full-check-after-resident-default-2026-09-04.zh.md).

- **V5.152**: Changed `dsh-resident` to default `noOpen: true`, so a launchd/systemd crash restart appends DSH's
  official `--no-open` and does not create another browser tab. An operator can explicitly set `noOpen: false` when
  this service should open the Web UI on every start. Resident tests (`17 passed / 1 skipped`), typecheck, and build
  passed; no Gateway, Session, Router, or state authority changed. See [V5.152 evidence](docs/evidence/v5-152-resident-no-open-default-2026-09-04.zh.md).

- **V5.151**: Re-ran the complete alpha.5 repository check after the Gateway single-page no-inbound diagnostic. The
  canonical DSH rc.1 was fetched and verified clean; documentation, CI/suite/release contracts, Hermes/Provider/Feishu/
  Telegram acceptance contracts, all 12 Bundle typechecks, tests, and builds passed (`exit 0`, Gateway `41/41`, Feishu
  `46/46`, Telegram `34/34`). No real credentials or external effects were used, and all real-channel, Provider, Hermes
  paired, long-term, and registry gates remain unchanged. See [V5.151 evidence](docs/evidence/v5-151-alpha5-full-check-after-gateway-diagnostic-2026-09-04.zh.md).

- **V5.150**: Added an Adapter-level no-inbound diagnostic to the native Gateway Control Surface. A `ready` transport
  with no authoritative `lastInboundAt` now shows a single-page attention notice explaining that the connection is up
  but no platform event has arrived, with checks for bot enablement, event subscriptions, and long-lived connection
  settings. Gateway tests (`41/41`), typecheck, and build passed; no model, page, Router, or state-store path was added.
  See [V5.150 evidence](docs/evidence/v5-150-gateway-no-inbound-diagnostic-2026-09-04.zh.md).

- **V5.149**: Ran the real Feishu AS-2 with the exact user-provided App credential on a new physical run root. Final
  Bundles, profile dump, and the official WebSocket handshake reached `ready`, but no newcomer private-message pending
  appeared during the full 60-second window. The runner failed closed before pairing and produced no Agent or platform
  reply/card/notice effect; the Feishu gate remains `failed`. The AS-1/AS-2 runner errors now explain that macOS `/tmp`
  is a symlink alias and real runs must use `/private/tmp`. See [V5.149 evidence](docs/evidence/v5-149-real-feishu-as2-valid-credential-no-pending-2026-09-04.zh.md).

- **V5.148**: Re-ran the complete alpha.5 repository check after wiring the configured Telegram API endpoint into the
  final AS-1 DSH overlay. Canonical DSH rc.1 was fetched and verified clean; documentation, CI/suite/release contracts,
  Hermes/Provider/Feishu/Telegram acceptance contracts, all 12 Bundle typechecks, tests, and builds passed (`exit 0`).
  No real credentials or external effects were used, and the real Telegram gate remains `not-run`. See [V5.148 evidence](docs/evidence/v5-148-alpha5-full-check-after-telegram-api-fix-2026-09-04.zh.md).

- **V5.147**: Verified the Telegram AS-1 unauthorised runner and final package boundary after the executor admission.
  With no approval or credentials, `pnpm benchmark:telegram:as1` exits `2` with one `not-run` JSON and performs no Bot
  request. Control Center, Gateway, and Telegram tarballs all pack successfully and contain neither `node_modules` nor a
  product CLI; the worktree remains clean. The real Telegram gate is still `not-run`. See [V5.147 evidence](docs/evidence/v5-147-telegram-as1-preflight-pack-boundary-2026-09-04.zh.md).

- **V5.146**: Admitted the real Telegram AS-1 executor skeleton behind the exact authorization switch. It reuses the
  verified DSH app-boot/final-Bundle path to exercise a real private-chat pairing request, Host approval, native reply,
  Gateway ingress replay, native Approval, restart, uninstall, and Session readback; all run state is isolated and
  redacted. The unauthorised path still reads only its switch and performs no Bot request. No authorized real Bot run has
  completed, so the release gate remains `not-run`. See [V5.146 evidence](docs/evidence/v5-146-telegram-as1-executor-skeleton-2026-09-04.zh.md).

- **V5.145**: Re-ran the complete repository check after admitting the real Telegram AS-1 contract. The canonical DSH
  rc.1 was fetched and verified clean, the audited alpha.5 support checkout passed documentation, CI/suite/release
  contracts, Hermes/Provider/Feishu/Telegram acceptance contracts, all package typechecks, tests, and builds (`exit 0`);
  no real Telegram or Feishu effects were used and the worktree stayed clean. See [V5.145 evidence](docs/evidence/v5-145-alpha5-full-check-after-telegram-as1-contract-2026-09-04.zh.md).

- **V5.144**: Added a strict real Telegram Bot AS-1 resident-pairing acceptance contract. The preflight reads only its
  exact authorization switch before inspecting the Bot token, binds retained reports to both the admitted DSH support
  revision and the separately audited latest DSH revision, and requires pairing isolation, Host approval, duplicate-update
  suppression, native Approval, restart, uninstall, and Session readback observations. The entrypoint intentionally remains
  preflight-only and exits `not-run` even with a token until an explicit human-channel executor is admitted; no real Bot
  effect is claimed. See [V5.144 evidence](docs/evidence/v5-144-telegram-as1-real-contract-2026-09-04.zh.md).

- **V5.143**: Generalized the Gateway first-connection journey to the selected Adapter instead of hard-coding a Feishu
  label. Telegram-only surfaces now show the same resident-connection, newcomer-message, and Host-approval stages;
  the existing single-page Control Center and Gateway authority remain unchanged. Gateway Surface `9/9` and the full
  alpha.5 check passed. See [V5.143 evidence](docs/evidence/v5-143-gateway-generic-journey-2026-09-04.zh.md).

- **V5.141**: Generalized the native Gateway pairing-code control from a Feishu-only field to a shared Adapter
  selector. Telegram-only and future resident channel profiles now expose the same single-page Host approval path;
  the selected Adapter is passed to the existing Gateway authority, with no extra page or state store. The generic
  Control Surface regression and full alpha.5 check passed. See [V5.141 evidence](docs/evidence/v5-141-gateway-generic-pairing-2026-09-04.zh.md).

- **V5.140**: Added a resident Telegram Host-pairing mode that reuses the shared Gateway authorization and
  durable delivery seams. Unknown direct messages receive a one-time code without Agent ingress; after Host approval,
  only the next message is dispatched to the native DSH Session. Existing exact static-route profiles remain compatible,
  and a real-DSH alpha.5 assembled pairing path passed. Real Telegram Bot and Hermes paired release gates remain open.
  See [V5.140 evidence](docs/evidence/v5-140-telegram-pairing-assembled-2026-09-04.zh.md).

- **V5.139**: Fixed Feishu authorization ordering for unsupported top-level messages. An unknown direct user now
  receives a pairing code even when the first message is a file, audio, or video; an already authorized route receives
  one durable, idempotent attachment-contract notice instead of silent loss. The assembled chat and pairing regressions
  passed `2/2`; no real credentials or external effects were used. See [V5.139 evidence](docs/evidence/v5-139-feishu-unsupported-first-message-2026-09-04.zh.md).

- **V5.138**: Re-ran the complete alpha.5 repository check after tightening DSH preflight to reject untracked
  files. Documentation, CI/suite/release contracts, all 12 package typechecks, tests, and builds passed (`CHECK_RC=0`);
  the worktree remained clean. Real channels/providers, Hermes paired, long-term effects, and npm release gates remain
  unchanged. See [V5.138 evidence](docs/evidence/v5-138-alpha5-full-check-after-preflight-guard-2026-09-04.zh.md).

- **V5.137**: Hardened the DSH compatibility preflight to inspect complete `git status --porcelain`, rejecting
  untracked files as well as tracked changes. The regression now covers both dirty forms (`4/4` tests passed),
  preventing a debug artifact from being mistaken for a clean audited DSH checkout. See [V5.137 evidence](docs/evidence/v5-137-dsh-preflight-untracked-guard-2026-09-04.zh.md).

- **V5.136**: Recorded a fresh real Feishu AS-2 epoch-5 attempt on `dfdac55`. Final Bundles installed, the
  profile dump passed, and the resident official WebSocket reached `ready`, but no matching newcomer private
  message arrived during the five-minute window. The runner failed closed before pairing or any Agent/platform
  effect; the `real-feishu-as2` gate remains failed. See [V5.136 evidence](docs/evidence/v5-136-real-feishu-as2-epoch5-no-pending-2026-09-04.zh.md).

- **V5.135**: Added and strictly froze EV-1 epoch-3 against the current Hermes `origin/main`
  (`63279301…`) instead of the stale local checkout. On the audited DSH alpha.5 baseline, calibration passed
  `2/2`; EvoForge kept the baseline immutable and Session-pinned (`0` premature active-Skill edits) while Hermes
  modified its active Skill in place (`1`). This remains a deterministic release-control slice, not a model,
  channel, or global-replacement claim. See [V5.135 evidence](docs/evidence/v5-135-hermes-current-ev1-epoch-3-2026-09-04.zh.md).

- **V5.134**: Strengthened the assembled Feishu pairing regression by reusing the revoked route id and admitting
  the repaired message with a different `group` chat kind. This proves stale observation state is cleared rather
  than merely hidden; typecheck, Gateway build, and the regression passed. See [V5.134 evidence](docs/evidence/v5-134-feishu-route-id-repair-regression-2026-09-04.zh.md).

- **V5.133**: Cleared Feishu `observedChatKinds` state when a dynamic pairing grant is revoked, preventing a
  reused route id from inheriting stale direct/group drift. Typecheck, Gateway build, and the assembled pairing
  regression passed. See [V5.133 evidence](docs/evidence/v5-133-feishu-revoked-observation-cleanup-2026-09-04.zh.md).

- **V5.132**: Extended Feishu revoked-grant reconciliation to the read-only `observedChatKind` Host seam, so
  revoked dynamic routes no longer expose stale direct/group observations. Typecheck, Gateway build, and the
  assembled revoke/re-pair regression passed. See [V5.132 evidence](docs/evidence/v5-132-feishu-revoked-observation-reconciliation-2026-09-04.zh.md).

- **V5.131**: Re-ran the complete repository check after Feishu revoked-route reconciliation on the audited DSH
  alpha.5 support checkout: documentation/CI/suite/release contracts, all 12 package typechecks, tests, and builds
  passed; the worktree stayed clean. Real Feishu, Provider, Hermes paired, long-term, and npm gates remain unchanged.
  See [V5.131 evidence](docs/evidence/v5-131-alpha5-full-check-after-feishu-revoke-2026-09-04.zh.md).

- **V5.130**: Corrected the Chinese and English root README pairing instructions: request-id approval is performed
  on the redacted pending row in the same native DSH Web `Channels` surface, not through a nonexistent standalone
  Host CLI. No runtime entry point changed. See [V5.130 evidence](docs/evidence/v5-130-user-doc-host-approval-clarification-2026-09-04.zh.md).

- **V5.129**: Reconciled dynamic Feishu pairing routes with the authoritative Gateway state. Host route listings,
  health snapshots, notifications, and inbound handling now drop revoked grants while preserving the native DSH
  Agent/Session; the assembled revoke → re-pair regression passed 1/1 after waiting for outbound terminal state.
  This does not change the still-blocked real Feishu, Provider, Hermes paired, long-term, or npm release gates. See
  [V5.129 evidence](docs/evidence/v5-129-feishu-revoked-route-reconciliation-2026-09-04.zh.md).

- **V5.128**: Added an explicit `benchmark:hermes:ev1:alpha5` script and documented the current alpha.5 manifest/result
  path, while keeping the historical EV-1 command and epoch immutable. The new entry still requires an exact DSH source
  and fails closed on revision or result drift.

- **V5.127**: Added documentation checks for the copyable Goal prompt: its final text block must stay within 2,000
  characters, require autonomous continuation, and avoid promising an unsupported host CLI. This is a documentation
  guard only; runtime behavior is unchanged.

- **V5.126**: Made the latest-DSH audit a contributor and release requirement: fetch `origin/master`, verify the
  clean exact revision/tag/dependencies, record it in evidence, and explicitly separate an upstream build failure
  from the admitted support baseline. No runtime behavior changed.

- **V5.125**: Synchronized the Hermes acceptance scorecard and paired-benchmark page with the current alpha.5 EV-1
  epoch. The new evidence is linked without rewriting the original epoch-1 result, and its narrow deterministic
  release-control conclusion remains separate from model, channel, or full-replacement claims.

- **V5.124**: Aligned the copyable Goal prompt with the implemented Host authority: Feishu pairing is approved from the native
  DSH Web pending list, never from a Session Command; a future host-management command may reuse that authority without
  changing the user-facing flow. This removes an unsupported CLI promise while preserving the resident Gateway contract.

- **V5.123**: Added and strictly froze a new deterministic Hermes EV-1 control-plane epoch on the current buildable
  DSH alpha.5 revision without rewriting epoch-1. The run passes calibration `2/2`; EvoForge keeps the baseline immutable,
  pins the current Session, fails closed across Workspaces, and preserves exact promotion/rollback state (`0` premature
  active-Skill edits versus Hermes `1`). This is not model-quality or full paired evidence. See [V5.123 evidence](docs/evidence/v5-123-hermes-ev1-alpha5-epoch-2-2026-09-04.zh.md).

- **V5.122**: Corrected an active `dsh-evolve` release-boundary comment that still described immutable Git trees after
  runtime Git Skill source/ref acquisition had been removed. It now names the actual content-addressed Skill Bundle
  materialization check; Generation-store `10/10`, documentation checks, and diff checks pass. No runtime behavior changed.
  See [V5.122 evidence](docs/evidence/v5-122-content-addressed-release-comment-cleanup-2026-09-04.zh.md).

- **V5.114**: Fixed the real Feishu AS-2 acceptance overlay to replace DSH's existing `web-runtime` row by id instead of
  inserting a duplicate Loader entry. AS-2 typecheck and 10/10 safety-contract tests pass; the first post-fix real run was
  correctly stopped by the clean-revision guard before credentials or platform effects. Real Feishu remains unpassed.
  See [V5.114 evidence](docs/evidence/v5-114-feishu-as2-overlay-loader-row-fix-2026-09-04.zh.md).

- **V5.115**: Re-ran the real Feishu AS-2 from the clean V5.114 revision. Final Bundle installation, profile dump, and the
  official transport reached ready; no newcomer private message produced a pending pairing request within the bounded
  window, so the runner failed closed before any Agent or platform effect. Real Feishu remains unpassed.
  See [V5.115 evidence](docs/evidence/v5-115-feishu-as2-official-transport-no-pending-2026-09-04.zh.md).

- **V5.116**: Re-ran the complete alpha.5 repository check after the Feishu AS-2 overlay fix. Documentation, CI/suite/release
  contracts, compatibility, Hermes/Provider/Feishu contract checks, all package typechecks, tests, and builds passed
  (`CHECK_RC=0`); real-channel, real-provider, paired, long-term, Telegram, and npm gates remain unchanged.
  See [V5.116 evidence](docs/evidence/v5-116-alpha5-full-check-after-feishu-as2-fix-2026-09-04.zh.md).

- **V5.117**: Rewrote the Chinese and English root READMEs as user-facing installation and usage guides. They now cover
  capability suites, local Bundle installation, resident Feishu pairing, the single Web control surface, removal,
  troubleshooting, and honest pre-alpha limitations; maintainer evidence remains under `docs/`. Documentation checks pass.
  See [V5.117 evidence](docs/evidence/v5-117-user-readme-rewrite-2026-09-04.zh.md).

- **V5.118**: Added an AS-2 regression contract that requires the acceptance overlay to replace DSH's existing `web-runtime`
  row by id and rejects putting it inside `insert`. Typecheck and 11/11 safety/input/terminal contract tests pass; no real
  credentials or platform effects are used. Real Feishu remains unpassed.
  See [V5.118 evidence](docs/evidence/v5-118-feishu-as2-overlay-regression-contract-2026-09-04.zh.md).

- **V5.119**: Clarified the `dsh-evolve` user README so `report_capability_gap` starts internal evidence processing,
  not ambiguous “background discovery”. The runtime boundary remains DSH-installed capabilities and internal Goal evidence;
  documentation checks pass and no runtime code changed. See [V5.119 evidence](docs/evidence/v5-119-internal-gap-wording-2026-09-04.zh.md).

- **V5.120**: Made the optional-install snippets in the Chinese and English root READMEs standalone by assigning a default
  temporary `PACK_ROOT`. Documentation checks pass; runtime and release gates are unchanged. See [V5.120 evidence](docs/evidence/v5-120-readme-standalone-pack-root-2026-09-04.zh.md).

- **V5.121**: Ran the real Feishu AS-2 with the maximum 900-second interaction window from a clean revision. Final Bundle
  installation, profile dump, and official transport stayed ready, but no newcomer private message created a pending request;
  the runner failed closed before any Agent or platform effect. Real Feishu remains unpassed.
  See [V5.121 evidence](docs/evidence/v5-121-feishu-as2-long-wait-no-pending-2026-09-04.zh.md).

- **V5.113**: Added a cross-instance Generation cache readback regression for nested Skill references. A fresh
  `GenerationBundleRepository` verifies the immutable owner marker, read-only tree, file list, and hashes after materialization;
  the candidate-publisher suite passed 8/8. See [V5.113 evidence](docs/evidence/v5-113-generation-cache-restart-verification-2026-09-04.zh.md).

- **V5.112**: Aligned the status matrix with the machine release gates, changing Web Control Plane, Telegram, and Hermes paired
  rows to `partial` while keeping real Provider `not-run` and Feishu AS-2 `partial`. Local contracts and fixtures no longer imply
  production completion; the documented `not-run`/`partial`/`failed` blockers remain authoritative. See [V5.112 evidence](docs/evidence/v5-112-status-table-release-gate-alignment-2026-09-04.zh.md).

- **V5.111**: Re-ran the final-tarball DSH clean-profile lifecycle after the suite identity fix: official add/dump/boot,
  real Session/Goal/Storage/Tool path, dispose/remove, and native readback passed 1/1 on the audited alpha.5 runtime. This
  is a local lifecycle regression only; real channel/provider, paired benchmark, long-term, and npm gates remain blocked.
  See [V5.111 evidence](docs/evidence/v5-111-clean-profile-core-install-2026-09-04.zh.md).

- **V5.110**: Normalized equivalent GitHub repository URL forms in the npm ownership gate without accepting another host or
  path. This prevents a future owned scoped package from being falsely classified as a collision; six classifier tests and
  documentation checks passed. Existing unowned-name collisions still block the first tag. See [V5.110 evidence](docs/evidence/v5-110-npm-repository-url-normalization-2026-09-04.zh.md).

- **V5.109**: Separated workspace directory identity from the public npm name in `pack:suite`. Scoped package migration can now
  produce the correct tarball filename and DSH remove target without rewriting Cordis Bundle identities. Core suite packing and
  suite tests passed; the existing npm ownership blocker remains. See [V5.109 evidence](docs/evidence/v5-109-suite-pack-public-name-boundary-2026-09-04.zh.md).

- **V5.108**: Added the same live npm package-name ownership preflight to local `release:tag`, before release gates,
  and covered its ordering with a regression test. Local and GitHub release paths now fail closed consistently on name
  collisions or registry errors. The four existing collisions still block the first tag. See [V5.108 evidence](docs/evidence/v5-108-local-tag-npm-preflight-2026-09-04.zh.md).

- **V5.107**: Made release metadata validation resolve package files by workspace directory instead of `manifest.name`,
  so a future project-owned scoped npm name can be migrated without breaking README/Bundle patch checks. No package names
  were changed and the npm ownership gate remains blocking. See [V5.107 evidence](docs/evidence/v5-107-release-check-scoped-name-safety-2026-09-04.zh.md).

- **V5.106**: Separated stable DSH logical Bundle identities from provisional npm distribution names and recorded the
  namespace migration decision in ADR-0101. The four existing npm collisions remain a hard release blocker; no guessed
  scope, alias package, or silent global rename is allowed. See [ADR-0101](docs/adr/0101-public-package-namespace-before-npm-release.md).

- **V5.105**: Removed ambiguous runtime capability-acquisition wording from the roadmap and copyable Goal prompt. Runtime self-discovery is now explicitly limited to DSH-installed capabilities and real internal Goal/feedback/outcome evidence; external ecosystem material is design-time research/benchmark input only and cannot be searched, downloaded, imported, or installed at runtime. See [V5.105 evidence](docs/evidence/v5-105-runtime-self-discovery-boundary-2026-09-04.zh.md).

- **V5.104**: Audited npm registry ownership for every public Bundle and found four unscoped names already owned by unrelated repositories (`dsh-doctor`, `dsh-feishu`, `dsh-gateway`, `dsh-telegram`). Added a fail-closed `check:release:names` preflight and required release gate; no tag is allowed until a project-owned namespace is authorized and the package/dependency/install matrix is revalidated. See [V5.104 evidence](docs/evidence/v5-104-npm-package-name-collision-2026-09-04.zh.md).

- **V5.103**: Aligned the Feishu and getting-started user docs with the actual single-page Control Center contract: it performs only a low-frequency read of the redacted Host pending projection so new pairing requests appear without a second page; it does not poll platform messages, probe credentials, read message bodies, or call a model. See [V5.103 evidence](docs/evidence/v5-103-channel-doc-contract-2026-09-04.zh.md).

- **V5.102**: Re-fetched the latest DSH `origin/master` (`76fda729…`), passed the exact-revision and clean-worktree preflight, and ran the official root build. Recorded the upstream `dsh-root` tsdown entry failure (`lib/types/{index,invariant,startup}.js`) without modifying or forking DSH; the buildable EvoForge support baseline remains alpha.5. See [V5.102 evidence](docs/evidence/v5-102-latest-dsh-build-blocker-2026-09-04.zh.md).

- Re-ran the complete repository check after the real-browser Control Center hit-target fix. Latest DSH master was fetched
  and verified clean; the audited buildable alpha.5 support baseline passed documentation/CI/suite/release contracts,
  compatibility checks, all package typechecks, tests, and builds (Evolve 69/309, Gateway 8/40, Feishu 18/46,
  Telegram 8/29). Real Feishu, external Telegram, Provider, Hermes paired, long-term-effect, and release-tag gates remain
  unchanged. See [V5.101 evidence](docs/evidence/v5-101-alpha5-full-check-after-hit-target-fix-2026-09-04.zh.md).

- Fixed a real DSH Web hit-target regression in the native Control Center. DSH's sibling left-width drag handle (z-index 8)
  covered the 40px center of the plugin navigation, so mouse clicks only moved focus while keyboard navigation still worked.
  The Control Center root now owns a local z-index 9 stacking context, and the browser fixture creates its workspace path
  before the official WorkspaceRegistry resolves it. Against the audited buildable DSH alpha.5 profile, one real browser tab
  clicked Channels, Feishu Content, and Evolution, refreshed status, and recovered after a full reload. See [V5.100 evidence]
  (docs/evidence/v5-100-control-center-mouse-hit-target-2026-09-04.zh.md).

- Re-ran the complete repository check after quieting the non-interactive Feishu AS-2 overlay. Documentation, CI,
  package/release contracts, compatibility checks, all package typechecks, tests, and builds passed on the audited
  clean DSH alpha.5 baseline; `dsh-evolve` is 69 files / 309 tests, Gateway 8 / 40, Feishu 18 / 46, Telegram 8 / 29,
  and Evolution Web 2 / 27. This is an engineering-quality result only: real Feishu AS-2, independent Providers,
  Hermes paired, long-term effects, browser recovery, and the first release tag remain blocked. See [V5.99 evidence]
  (docs/evidence/v5-99-alpha5-full-check-after-as2-overlay-2026-09-04.zh.md).

- Quieted the non-interactive real Feishu AS-2 overlay. DSH's Web service remains available for native RPC composition,
  but the seed, connection, and restart boots now disable `openBrowser`, URL printing, and model-facing Web context so
  the runner does not emit a fresh temporary URL for every boot. The user-facing DSH path remains one native
  `conversation.view` control surface; no page, Router, Gateway, Session, or state store was added. AS-2 contract
  tests and typecheck pass. See [V5.98 evidence]
  (docs/evidence/v5-98-as2-single-page-startup-output-2026-09-04.zh.md).

- Recorded the newest isolated real Feishu AS-2 retry. Final Bundles installed into a fresh profile, config dump
  passed, and the official WebSocket reached `ready`; no newcomer private message produced a Host pending request
  during the 15-minute window, so the runner failed closed before pairing or any Agent/platform effect. The run root
  is not reused and the `real-feishu-as2` gate remains failed. See [V5.97 evidence]
  (docs/evidence/v5-97-real-feishu-as2-no-pending-2026-09-04.zh.md).

- Re-ran the complete repository check after the Feishu callback and alpha.5 Schedule-fixture fixes, using the clean
  audited alpha.5 DSH profile. Documentation/CI/package/release contracts, compatibility checks, all 12 package
  typechecks, all tests, and all builds passed; Feishu is 18 files / 46 tests, Telegram 8 / 29, and Gateway 8 / 40.
  Real Feishu AS-2, independent Providers, Hermes paired, long-term effects, and release-tag gates remain unchanged.
  See [V5.96 evidence](docs/evidence/v5-96-alpha5-full-check-2026-09-04.zh.md).

- Repaired the Feishu Schedule crash-recovery fixture for the audited DSH alpha.5 persistence contract. The fixture
  now replaces the actual `persistBatch` method (the old seam silently replaced an unused `appendBatch` property),
  and uses a five-second due window so fault injection is installed before dispatch. The test still kills the seed
  process after one external effect and verifies recovery does not duplicate it. No upstream DSH source or skip was
  added; the full Feishu suite is now 18 files / 46 tests green. See [V5.95 evidence]
  (docs/evidence/v5-95-schedule-crash-fixture-alpha5-2026-09-04.zh.md).

- Added a host-side failure boundary around official Feishu `message` and `cardAction` async callbacks. Handler
  failures now settle as a redacted Gateway `degraded` observation and warning instead of becoming unhandled SDK
  Promise rejections; reporting failures and post-dispose callbacks are contained as well. No Gateway, Session,
  queue, retry policy, or page was added. Typecheck, targeted teardown regression, and build pass; the existing
  alpha.5 Schedule crash-fixture timeout keeps the full Feishu suite out of release evidence. See [V5.94 evidence]
  (docs/evidence/v5-94-feishu-event-boundary-2026-09-04.zh.md).

- Reset the Gateway Surface when its DSH `Session` or resolved `Workspace` changes. Old transport, route, pending
  pairing, input, and action state is cleared before the new Host snapshot loads, and stale requests/intervals cannot
  overwrite the new Session. Added a delayed-rerender regression; no page, router, Session, or state store was added.
  See [V5.93 evidence](docs/evidence/v5-93-gateway-session-switch-isolation-2026-09-04.zh.md).

- Isolated the Feishu pairing-code input id per mounted Gateway Surface with React `useId()`. During a native
  DSH Session switch or recovery, temporarily mounted Gateway views can no longer make their labels point at the
  other Session's input. Added a two-surface accessibility regression; no route, page, Session, or state store was
  added. See [V5.92 evidence](docs/evidence/v5-92-gateway-pairing-aria-isolation-2026-09-04.zh.md).

- Bound Feishu message-resource downloads to the caller's `AbortSignal` through the Adapter's existing Axios
  signal context. Gateway shutdown, Session cancellation, and Adapter disposal can now interrupt a stalled
  platform download instead of only checking cancellation before and after it; limits and error semantics are
  unchanged. See [V5.91 evidence](docs/evidence/v5-91-feishu-download-abort-signal-2026-09-04.zh.md).

- Isolated the native Control Center tab and panel ARIA ids per React mount with `useId()`. Session switching
  or recovery can no longer make two temporarily mounted views point at each other; the change adds no route,
  Session, state store, or page. Added a two-view regression and rebuilt the package. See [V5.90 evidence](docs/evidence/v5-90-control-center-instance-aria-ids-2026-09-04.zh.md).

- Recorded the newest isolated real Feishu AS-2 epoch-4 result. Final Bundles installed into a clean profile,
  the effective configuration was dumped, and the official WebSocket reached `ready`; no matching newcomer DM
  arrived during the 15-minute window, so the runner failed closed before pairing or any external effect. The
  real-channel gate remains `failed`, and this non-terminal run root will not be reused. See [V5.89 evidence](docs/evidence/v5-89-feishu-as2-epoch4-no-pending-2026-09-04.zh.md).

- Gated the native Gateway pairing and newcomer sections by observed Feishu Host facts. Telegram-only profiles no
  longer render empty Feishu controls, and the pairing help now makes pending-request approval the primary flow while
  retaining code entry for compatibility. This reduces single-page setup noise without adding a page or runtime.
  See [V5.88 evidence](docs/evidence/v5-88-gateway-feishu-surface-gating-2026-09-04.zh.md).

- Projected official Feishu policy rejections into the existing redacted Gateway health snapshot. The native
  Control Center can now distinguish an inbound event rejected by allowlist/mention policy from a WebSocket that
  has received no event; no message, chat, sender, credential, or model data is exposed, and policy rejects do not
  become transport failures. See [V5.87 evidence](docs/evidence/v5-87-feishu-policy-reject-observability-2026-09-04.zh.md).

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
