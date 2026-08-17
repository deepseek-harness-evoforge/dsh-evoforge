# DeepSeek Harness EvoForge

**EvoForge is an out-of-tree plugin suite installed into DeepSeek Harness. It is not a standalone harness, Runtime, CLI application, web server, or daemon.** DSH remains the sole authority for Agents, Sessions, Goals, Approvals, Storage, Jobs, Skills, Tools, Workspaces, and the Cordis lifecycle.

Compatibility evidence is pinned to DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`). The suite is pre-alpha and has not been published to a registry; local tarballs installed through the official DSH profile command are the only current installation path.

## Current suite

The repository contains eleven native DSH Bundles: evidence-driven evolution and its Web adapter, verified software delivery, runtime diagnosis, GitHub review follow-up, Workspace Channel Router, Telegram, Feishu, cross-channel evolution attention, native Goal cold resume, and `/resident` control for one exact launchd/systemd user unit. External routes, recovery, and deployment control are disabled until an operator provides exact configuration.

## Install into DSH

```sh
pnpm install --frozen-lockfile
PACK_DIR="$(mktemp -d)"
for package in \
  dsh-evolve dsh-evolve-web dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-channel-router dsh-telegram dsh-feishu \
  dsh-evolve-attention dsh-goal-continuity dsh-resident
do
  pnpm --filter "$package" pack --pack-destination "$PACK_DIR"
done

dsh plugin --profile web add "$PACK_DIR"/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

Inside DSH, use `/doctor`, `/evolve status`, the EvoForge Web sidebar, the native `software-delivery` Skill with `complete_delivery`, and `/resident plan|status|apply|remove`. Telegram, review follow-up, attention, Goal continuity, and resident control reuse DSH-owned control surfaces. No model can select credentials, external identities, Workspaces, or broaden route authority.

There is no supported `dsh-evolve`, `dsh-delivery`, or `dsh-resident` product CLI. Test drivers are not packaged entry points.

## Remove

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-evolve-attention dsh-feishu dsh-telegram \
  dsh-channel-router dsh-goal-continuity dsh-resident
dsh --profile web --dump-config
dsh --profile web
```

Removal unregisters EvoForge effects while native DSH Session, Goal, and Workspace data remains readable. External effects that already occurred cannot be undone by uninstalling a plugin.

The native Workspace Channel Router, Telegram and Feishu Adapters, Workspace-owned evolution, and eleven-package clean-profile gate are implemented. v0.1 still requires complete cache/browser acceptance, real-channel credential smoke tests, long-running outcome evidence, and a reproducible Hermes paired benchmark.

See the [Chinese installation guide](docs/getting-started.zh.md), [status](docs/status.zh.md), [shape audit](docs/native-plugin-shape-audit.zh.md), and [plugin contract](docs/plugin-contract.zh.md).

License: MIT.
