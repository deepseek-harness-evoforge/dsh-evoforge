# dsh-evolve-web

Browser adapter for `dsh-evolve`. It contributes the Evolution child surface to `dsh-control-center` through official
DSH Client metadata and generated Remotes. It starts no server, registers no Tool/Skill/Prompt, calls no model, and stores
no second copy of evolution state.

## Install

Normal users receive this package with the complete product:

```sh
pnpm run dsh:install
```

The `control` suite is a compatibility/development subset. The view appears inside an opened native DSH Session; blank
onboarding has no conversation slot. Use one Host and the full authenticated Web URL printed by DSH.

## Surface contract

The Client resolves the exact Workspace from the selected native Session, clears state on Workspace switches, rejects
mismatched responses, and never falls back to a recent Workspace. It renders Host-authoritative gaps, Candidate lineage
and diff, gates, measurements, Generation selection, canary, and rollback. Reads preserve last-good data with a visible
stale/error state; mutations go through the Host Remote and native permissions.

Historical browser tests do not replace a clean-profile rerun for the current checkout. Current limitations are recorded
in [status](../../docs/status.zh.md).

## Remove

```sh
dsh plugin --profile web remove dsh-evolve-web dsh-evolve
```
