# DeepSeek Harness EvoForge

**EvoForge is an out-of-tree plugin suite installed into DeepSeek Harness. It is not a standalone harness, Runtime, CLI application, web server, or daemon.** DSH remains the only Agent Host and the authority for Session, Goal, Approval, Storage, Jobs, Skills, Tools, and Cordis lifecycle.

Current compatibility evidence is pinned to DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5`). The suite is pre-alpha and has not been published to a registry. Build the six tarballs, then install them with the official profile command:

```sh
PACK_DIR="$(mktemp -d)"
pnpm install --frozen-lockfile
pnpm --filter dsh-evolve pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-evolve-web pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-software-delivery pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-doctor pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-telegram pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-goal-continuity pack --pack-destination "$PACK_DIR"

dsh plugin --profile web add \
  "$PACK_DIR/dsh-evolve-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-evolve-web-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-software-delivery-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-doctor-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-telegram-0.1.0-alpha.1.tgz" \
  "$PACK_DIR/dsh-goal-continuity-0.1.0-alpha.1.tgz"

dsh --profile web --dump-config
dsh --profile web
```

Inside DSH, use `/doctor`, `/evolve status`, the Web sidebar, and the native `software-delivery` Skill/`complete_delivery` Tool within a DSH Goal. Telegram and Goal continuity install disabled and require explicit profile patch configuration. No core capability requires an EvoForge executable or a second process.

Remove the suite through DSH:

```sh
dsh plugin --profile web remove \
  dsh-evolve-web dsh-evolve dsh-software-delivery \
  dsh-doctor dsh-telegram dsh-goal-continuity
dsh --profile web --dump-config
dsh --profile web
```

Native DSH Session and Goal data remains readable after removal. See the [Chinese install guide](docs/getting-started.zh.md), [shape audit](docs/native-plugin-shape-audit.zh.md), and [plugin contract](docs/plugin-contract.zh.md).

License: MIT.
