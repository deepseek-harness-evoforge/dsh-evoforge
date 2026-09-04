# dsh-control-center

Shared native DSH Web shell for EvoForge. It registers one Session-scoped `conversation.view` and the typed
`evoforge.control.surface` child slot used by Gateway, Channels, Evolution, and Doctor.

It does not start a server, call a model, read credentials, create Session/Goal state, or copy another plugin's data.
Each child surface keeps its own Host authority and permissions.

## Install

Normal users install it through the complete product from the repository root:

```sh
pnpm run dsh:install
```

The `control` suite is only a compatibility/development subset. Start one DSH Host with `--no-open`, use the full
authenticated URL printed by DSH, and open a native Session before expecting the view to appear.

## Remove

```sh
dsh plugin --profile web remove dsh-control-center
```

Removal deletes the view and child slot, not native DSH Sessions, Goals, Workspaces, or business-plugin evidence.
See [capability suites](../../docs/capability-suites.zh.md).
