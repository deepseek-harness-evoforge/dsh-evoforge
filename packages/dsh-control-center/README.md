# dsh-control-center

Shared native DSH Web shell for EvoForge. It registers one Session-scoped `conversation.view` and the typed
`evoforge.control.surface` child slot used by Gateway, Channels, Evolution, and Doctor.

It does not start a server, call a model, read credentials, create Session/Goal state, or copy another plugin's data.
Each child surface keeps its own Host authority and permissions.

The selected child page is remembered per Session through DSH's native Client store, so a browser refresh or returning
from the conversation keeps the selection. If that plugin is unavailable, the first available page is shown. This is a
browser-local display preference, not a copy of Session or channel data. Blocked browser storage leaves navigation usable
but cannot preserve the choice across refreshes. Removing the view leaves the harmless preference; DSH clears the active
store's persisted preference when its Session scope is removed.

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
