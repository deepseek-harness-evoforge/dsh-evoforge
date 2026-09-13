# Changelog

This file records user-visible changes for the unreleased product. Fine-grained development commands and historical
results live in `docs/evidence/` and Git history; they are intentionally not duplicated here.

## Unreleased

### Changed

- Isolated Feishu startup connection failures from native Host loading, retaining a degraded channel status and
  allowing recovery through native plugin reload or credential updates. Upgraded the official SDK to 1.73.3 to fix
  an unhandled WebSocket handshake-timeout error and explicitly closes failed-start sockets during disposal.
- Made `product` the default installation result: Evolution, Doctor, the native Control Center, resident Gateway,
  Feishu, and Telegram are installed together; platform adapters stay disabled until configured.
- Added `pnpm run dsh:install`, which verifies exact suite artifacts, stores local package sources in a durable
  content-addressed directory, withholds the effective DSH config from logs, and preserves recovery evidence on failure.
- Reframed the runtime around ordinary DSH interactions. A native Goal is optional; the Gap Tool remains available when
  the Goal service is absent, and no-Goal reports persist an explicit `abstained` signal instead of entering the legacy
  Goal-linked Candidate path.
- Added a content-addressed Interaction Episode ledger for immutable completed-turn provenance and replay-environment
  digest bindings. DSH Session remains the transcript authority; the ledger does not copy conversation bodies.
- Added a separate reference-only Interaction Capability Gap index and an Episode-first recorder. Failed Gap writes leave
  only a safe orphan Episode, and exact retry repairs the index without changing the legacy Goal-qualified Gap domain.
- Added a redacted Gateway ingress witness for Interaction evidence. It binds an authorized Workspace route to one exact
  durable Session enqueue; missing, ambiguous, or conflicting evidence abstains without delaying or failing delivery.
- Added default-deny, per-Workspace retention for raw-free Interaction Generation receipts. Receipts bind an exact
  completed trigger turn to the Session's durable native/evolved pin and continuously mounted Generation tree; they do
  not infer provider winners or close an Episode automatically.
- Added an independent default-deny Routing receipt vault for the EvoForge-owned successful Gap Tool path. Receipts
  correlate the exact model-visible schema, owned body, final DSH Tool result, and authenticated completed Session turn;
  the private resolver closes only Routing and is not yet consumed automatically by the running plugin.
- Extended completed-turn attestation to the human-first settled subset of DSH Session format v3. The projector validates
  embedded compact Assistant streams, the protected System head and inherited-header in-history prompt appends, request-route
  context, required versus ignorable vocabulary, and dialect/control-bound Generation/Routing receipts and facts. Retries, prequeued next-step
  context, surface replacements, compaction, PTC dispatches, mixed formats, and malformed streams remain fail closed;
  legacy receipts and qualifications lacking the control digest remain readable but no longer grant current authority.
- Added an internal dual-dialect physical Session reader for Interaction evidence: alpha.5 `readFrom` and current
  `open/read/close` now share one fail-closed cut contract, lifecycle-owned deadline, and logical-header identity;
  current handles are closed exactly once. The deadline covers the physical reader only; the preceding Session flush
  remains unbounded.
- Adapted Gateway persistence reads to current DSH handle envelopes and effective preset history, with cancellable
  shared resolution, exactly-once handle cleanup, partial-startup rollback, and conflicting Session-route rejection.
- Added current DSH live/cold feedback reconciliation and restart recovery through native feedback and Session services.
  Feedback projections wait for durability, remain unavailable during provider recovery, and cannot be changed by a
  retired provider's queued work. Recovery is idempotent and retains newer source feedback independently of scan order.
  These are compatibility slices; full rc.2 support and release verification remain pending.
- Retired failed native `skill` Tool calls as new evolution evidence because alpha.5 cannot distinguish absence from
  policy, load, cancellation, or execution failure. Historical rows remain readable but cannot qualify new opportunity
  or evaluation decisions.
- Made Goal-linked model-declared Gaps provisional for authoring until the owned Tool's exact final result, durable Session
  result, Workspace identity, and completed turn write a raw-free, content-addressed v2 qualification in an independently
  audited sidecar Domain. It binds the exact Gap/Workspace/Session/requested Skill/Goal and preserves the strict legacy Gap
  v1 medium for downgrade readers. Cancelled, rewritten, blocked, pipeline-outside captured-body,
  transferred/tampered authority, and historical unqualified rows cannot enter discovery, sealed evaluation, or restart
  reconciliation; qualification remains
  independent of optional Routing-receipt retention.
- Hardened Generation and Routing evidence stores so hostile storage rejections and quota-read uncertainty fail the live
  authority closed and remain visible to drain/close instead of leaking a stale positive read.
- Bounded each Gateway, Generation, and Routing Host-evidence source invocation to 30 seconds; a known alpha.5 Storage
  Domain limitation still prevents sound cancellation of an already accepted durable write and remains a release gate.
- Hard-disabled the current RP-1 epoch-2 paid runner until runtime artifacts, configuration binding, terminal revisions,
  and private failure output can be attested. Exact approval now returns a fixed failure before any Provider configuration
  or private path is read; the pinned manifest and deterministic Gap-to-Opportunity fixture remain non-paid evidence only.
- Corrected the `dsh-evolve` package contract so its statically imported native Goal and Tools packages are required peers;
  lifecycle-injected service integrations remain optional.
- Consolidated Gateway, channel, Evolution, and Doctor visualization into one Session-scoped native DSH Web view.
- Moved Feishu and Telegram secrets to the DSH CredentialProvider contract and kept both adapters disabled until their
  exact deployment configuration is present.
- Reduced public documentation to a user manual, current design/requirements, current status, and indexed maintainer
  research/evidence. Removed duplicate and superseded design pages from the working tree.

### Security

- The repository installer never prints `dump-config` output and never installs through an unverified directory glob.
- Prebuilt Bundle installation disables dependency install scripts instead of silently granting pnpm `allowBuilds` authority.
- A shell installation is no longer described as having passed DSH Agent Approval. Agent-initiated Shell calls remain
  subject to native Tool policy/Approval; human shell commands are deployment authority.

### Known blockers

- No registry package or stable SemVer tag has been published.
- Canonical DSH master `c291e796…` / CLI 0.1.5-rc.2 now passes install, root build, clean-profile readback, the strict
  direct-turn Generation binder, and the internal handle-based Interaction resolver read cohort. Retry/replacement/
  compaction/PTC cohorts, adjacent persistence consumers, dependency pins, Case Pack revisions, and the full support
  matrix remain unmigrated; the verified support baseline is still the separately audited 0.1.2-alpha.5 revision.
- Real long-running Feishu/Telegram, real-provider evolution, and complete same-condition Hermes paired evidence are not
  finished. The current RP-1 epoch-2 paid path is explicitly runtime-attestation-blocked, so the project does not claim an
  overall Hermes replacement.
