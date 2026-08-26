# dsh-control-center

`dsh-control-center` is the shared native DSH Web control surface for EvoForge
Bundles. It contributes one official `conversation.view` and a typed Cordis
child slot, `evoforge.control.surface`, for Gateway, Feishu, Evolution, and
future adapters that have an independently verified user result.

It is a Web shell, not a second router, registry, state store, Runtime, or
server. It does not call a model, create a Session or Goal, read credentials,
or mutate plugin state by itself. Each child surface remains responsible for
its own Host authority and permission boundary.

## Install

For the normal user installation, pack and install the `core` capability suite:

```sh
pnpm run pack:suite -- --suite core --out /tmp/evoforge-packs
dsh plugin --profile web add /tmp/evoforge-packs/core/*.tgz
dsh --profile web
```

The suite also installs `dsh-evolve`, `dsh-doctor`, and `dsh-evolve-web`. The
control center is intentionally separate from those adapters so Gateway and
other DSH plugins can reuse the same native view without depending on
Evolution-specific state.

## Lifecycle and removal

The Bundle is disabled unless the DSH profile enables it. Removing it removes
the view and child slot; it does not delete native DSH Sessions, Goals,
Workspaces, or another plugin's persisted evidence.

```sh
dsh plugin --profile web remove dsh-control-center
```

The package is MIT-licensed and follows the repository's supported DSH
revision range. See the [capability suite boundary guide](../../docs/capability-suites.zh.md)
for why the physical Bundle remains separate from `dsh-evolve-web`.
