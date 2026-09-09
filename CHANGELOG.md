# Changelog

This file records user-visible changes for the unreleased product. Fine-grained development commands and historical
results live in `docs/evidence/` and Git history; they are intentionally not duplicated here.

## Unreleased

### Changed

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
- The latest audited DSH canonical revision installs but has an upstream root type-entry build failure; the buildable
  support baseline remains the separately audited alpha.5 revision.
- Real long-running Feishu/Telegram, real-provider evolution, and complete same-condition Hermes paired evidence are not
  finished, so the project does not claim an overall Hermes replacement.
