# dsh-evolve-attention

`dsh-evolve-attention` sends durable Telegram and/or Feishu notices when `dsh-evolve` has an
actionable Candidate or Evaluator Draft. It reuses concrete route services already owned by
`dsh-telegram` and `dsh-feishu`; it does not create a notification platform, another scheduler,
inline approval protocol, or second source of truth.

## What is notified

- a pending Candidate that needs review;
- an automatically approved but still inactive Candidate that needs an explicit promotion
  decision;
- an Evaluator Draft in `uncertain`, `draft-ready`, or `incomplete` state.

Each message contains only a bounded type, safe Skill label, status or recommendation, exact
content id, and the copyable `/evolve` inspection command. It excludes prompts, feedback, claims,
file paths, diffs, credentials, and model output. A notice is attention, never approval; the
originating Session continues.

## Requirements and installation

Run `dsh-evolve`, this package, and at least one supported channel Adapter in the same DSH profile.
Configure each Adapter first with exact static Gateway routes.

```bash
PACK_DIR="$(mktemp -d)"
pnpm --filter dsh-evolve pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-evolve-attention pack --pack-destination "$PACK_DIR"
pnpm --filter dsh-telegram pack --pack-destination "$PACK_DIR" # optional
pnpm --filter dsh-feishu pack --pack-destination "$PACK_DIR"   # optional
dsh plugin --profile web add "$PACK_DIR"/*.tgz
```

The bridge has no destination configuration. Telegram supplies its one static Workspace route;
Feishu supplies every exact `routeId → Workspace` binding configured on that Adapter instance.
Each scan passes the corresponding Workspace id explicitly to `dsh-evolve`, validates the returned
ownership, and never scans a recent or arbitrary Workspace. Multiple Feishu routes for one
Workspace share one overview read but retain independent durable delivery identities.

After a notice arrives, inspect and act through the existing command surface:

```text
/evolve review <candidate-id>
/evolve evaluator <draft-id>
```

There are deliberately no inline approve, promote, or qualify buttons.

## Delivery, lifecycle, and cache contract

The bridge scans once when a concrete route service appears and after the existing evolution
supervisor settles. It creates no timer or watcher. Deterministic notice ids flow through each
concrete Adapter route into the shared Gateway outbound journal; repeated scans, bridge reloads,
and process restarts therefore do not redeliver a recorded success. Ambiguous external sends remain
`uncertain` according to the Gateway contract.

Concrete channel dependencies are optional peers. Cordis injection owns each bridge independently:
installing only Telegram or only Feishu works, adding/removing either Adapter activates/disposes
only its child bridge, and removing this package leaves the native Session and gateway routes
intact.

This package registers no Tool, Skill, Prompt, or Command. It performs no model call and does not
change Agent requests, Session composition, or Skill catalogs. Normal and idle Session token
increment is `0`.

## Deliberate limits

- only existing `dsh-telegram` and `dsh-feishu` route services;
- no generic notification provider or public Adapter SPI;
- no polling, digest, escalation, calendar, email, Slack, or arbitrary recipient routing;
- no inline protected action;
- no production-reliability claim before real Bot/App, mobile client, restart, and multi-day soak.
