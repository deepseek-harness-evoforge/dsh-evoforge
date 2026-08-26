# DeepSeek Harness EvoForge

**EvoForge is an out-of-tree plugin suite installed into DeepSeek Harness. It is not a standalone harness, Runtime, CLI application, web server, or daemon.** DSH remains the sole authority for Agents, Sessions, Goals, Approvals, Storage, Jobs, Skills, Tools, Workspaces, and the Cordis lifecycle.

Compatibility evidence is pinned to the audited DeepSeek Harness revisions `47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`) and `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (`0.1.1-rc.2`). The twelve internal Bundles are exposed as smaller capability suites; see the [suite boundary guide](docs/capability-suites.zh.md). The project is pre-alpha and has not been published to a registry; local tarballs installed through the official DSH profile command are the only current installation path.

## Current capability suites

The repository contains twelve independently removable native DSH Bundles, grouped for users as `evolution`, `control`, `gateway`, `channels`, `delivery`, `continuity`, and `full`. The groups are installation presets, not a second runtime or registry. External routes, recovery, and deployment control are disabled until an operator provides exact configuration.

The active evolution path uses DSH-internal Goal, Skill invocation, correction, and outcome evidence only; it performs no runtime Skill-market search or acquisition and asks the user for no route, Agent, workflow, Skill, or source choice. Repeated exact corrections to one sealed installed-Skill baseline can now drive protected authoring of a complete content-addressed Candidate tree. Only bounded `SKILL.md`/`references/*.md` instruction text may change; all other files, including binaries, are inherited byte-for-byte and permission drift is rejected. The Candidate remains inactive, quarantined, unevaluated, never executed, and without release authority. Existing-Skill paired evaluation, retention, canary, promotion, real-provider/browser recovery, and full Hermes paired evidence remain unfinished.

## Install into DSH

```sh
pnpm install --frozen-lockfile
PACK_ROOT="$(mktemp -d)"
pnpm run pack:suite -- --suite evolution --out "$PACK_ROOT"
pnpm run pack:suite -- --suite control --out "$PACK_ROOT"

dsh plugin --profile web add "$PACK_ROOT/evolution"/*.tgz "$PACK_ROOT/control"/*.tgz
dsh --profile web --dump-config
dsh --profile web
```

Inside DSH, use `/doctor`, the native Control Center view, the native `software-delivery` Skill with `complete_delivery`, and `/resident plan|status|apply|remove`. Telegram, review follow-up, attention, Goal continuity, and resident control reuse DSH-owned control surfaces. No model can select credentials, external identities, Workspaces, or broaden route authority.

There is no supported `dsh-evolve`, `dsh-delivery`, or `dsh-resident` product CLI. Test drivers are not packaged entry points.

## Remove

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery dsh-doctor \
  dsh-github-review dsh-evolve-attention dsh-feishu dsh-telegram \
  dsh-gateway dsh-goal-continuity dsh-resident dsh-control-center
dsh --profile web --dump-config
dsh --profile web
```

Removal unregisters EvoForge effects while native DSH Session, Goal, and Workspace data remains readable. External effects that already occurred cannot be undone by uninstalling a plugin.

The native Workspace DSH Gateway, Telegram and Feishu Adapters, Workspace-owned evolution, eleven-package clean-profile gate, full composition Cache Contract gate, and real DSH browser restart/failure/recovery acceptance are implemented. Four deterministic Hermes paired slices now cover EV-1, SD-1, LC-1, and Telegram approval: the first two support narrow control-plane advantage claims, while local crash recovery and allow-once replay control are ties. v0.1 still requires real-channel credential smoke tests plus same-model coding, real-message delivery, long-task, provider, and long-running paired evidence.

See the [Chinese installation guide](docs/getting-started.zh.md), [status](docs/status.zh.md), [shape audit](docs/native-plugin-shape-audit.zh.md), and [plugin contract](docs/plugin-contract.zh.md).

License: MIT.
