# DeepSeek Harness EvoForge

EvoForge is a set of native plugins for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).
It adds resident channels, evidence-driven internal evolution, software delivery, and one Web control surface while
reusing DSH's Agent, Session, Goal, Skill, Tool, Approval, Jobs, Workspace, storage, and Cordis lifecycle.

EvoForge is not a standalone agent, a Codex plugin, a second runtime, or a plugin marketplace. DSH remains the only
runtime and state authority.

## Status

This project is pre-alpha. Developers can reproduce the source and local Bundle installation path, but no npm registry
release exists and the project does not yet claim a Hermes upper replacement. Real channels, real model providers,
long-running behavior, and the same-condition Hermes comparison are still being verified. Read the [current status](docs/status.zh.md)
before production use.

## Capability suites

Install user outcomes rather than managing every internal Bundle:

| Suite | Result |
| --- | --- |
| `core` | Evidence-driven evolution, diagnostics, and the native DSH Web control surface |
| `channels` | Resident Gateway, Feishu/Telegram adapters, pairing, routing, durable delivery, and the same Web surface |
| `delivery` | Isolated software delivery, verification, Draft PRs, and GitHub review follow-up |
| `continuity` | Bounded Goal cold resume and user-level DSH profile residence |

`attention` is an optional channel-notification add-on; `full` is for maintainer acceptance only. Suites are installation
presets, not another runtime or marketplace. See the [suite boundary guide](docs/capability-suites.zh.md).

## Install

The current source is this repository's local tarballs. Prepare Node.js 22, pnpm 11, and DSH
`dsh-v0.1.2-alpha.5` (`db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5`), then run from the repository root:

> Registry packages are not published yet. Do not run `dsh plugin ... add dsh-*` directly; build the local tarballs below
> first so an unrelated package with the same name cannot be installed accidentally.

```sh
pnpm install --frozen-lockfile
PACK_ROOT="$(mktemp -d)"
pnpm run pack:suite -- --suite core --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/core"/*.tgz
dsh --profile web --dump-config
dsh --profile web --no-open
```

Start the DSH Host once. Its startup log prints a Web URL; open that URL in the existing DSH browser tab and use the
browser's reload thereafter. Do not start the Host again just to refresh or reconnect. `dsh-resident` also defaults to
`noOpen: true`, so crash recovery does not create duplicate pages; set `noOpen: false` only as an explicit opt-out.

Add channels or delivery when needed:

```sh
PACK_ROOT="${PACK_ROOT:-$(mktemp -d)}"
pnpm run pack:suite -- --suite channels --channel feishu --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/channels-feishu"/*.tgz

pnpm run pack:suite -- --suite delivery --out "$PACK_ROOT"
dsh plugin --profile web add "$PACK_ROOT/delivery"/*.tgz
```

DSH's official commands own startup, stop, reload, and removal. EvoForge does not require another web server, daemon, or
product CLI.

## Feishu setup and pairing

After installing `channels`, configure the Feishu App for the DSH profile:

```sh
export DSH_FEISHU_APP_ID='cli_...'
export DSH_FEISHU_APP_SECRET='...'
```

Enable the bot, long-connection event `im.message.receive_v1`, message sending, and card callbacks. Add the bot to the
test account's direct chat. Once DSH is running, an unknown user sends any private message to the bot:

1. The resident Gateway returns a one-time pairing code; the first message never reaches the Agent.
2. An administrator approves the pending request in the same DSH Web `Channels` surface; the redacted request-id is shown on the pending row and can be approved there.
3. The user sends the next message, which enters the bound native DSH Session.

No Session pairing command, temporary listener, or second webpage is required. See [`dsh-gateway`](packages/dsh-gateway/README.md)
and [`dsh-feishu`](packages/dsh-feishu/README.md) for routing, revocation, permissions, and troubleshooting.

## Internal evolution

The entry point accepts a natural-language Goal, materials, constraints, permissions, and acceptance criteria. EvoForge uses
DSH-installed capabilities plus real Goal successes, failures, corrections, rework, cost, latency, and external outcomes to
identify reviewable gaps and generate/evaluate complete Skill Candidates in isolation.

Candidates pass baseline/holdout/retention, safety, permission, cost, latency, and cache gates. Execution, Candidate, and
governance evaluation are isolated. Insufficient evidence produces `abstain` or `quarantine`; the current Session stays pinned,
promotion affects future Sessions only, and canary, crash recovery, and exact rollback are supported.

This is not runtime search, download, or import of Skills from an external market, and it is not model self-evaluation. Code,
credentials, and external side effects always require protected-action authorization.

## Web control surface

`core` and `channels` use one native DSH page instead of one page per plugin. The surface shows Gateway, Feishu, and Telegram
health; capabilities and gaps; Candidate versions, lineage, diffs, baseline/holdout, and failure attribution; cost, latency,
cache, permissions; and promotion, quarantine, pause, resume, and rollback controls.

It does not call a model or copy Session/state authority. Plugins contribute through DSH's native surface slots.

## Remove

Use DSH's official command to remove the complete suite:

```sh
dsh plugin --profile web remove \
  dsh-evolve dsh-evolve-web dsh-control-center dsh-evoforge-doctor \
  dsh-evoforge-gateway dsh-evoforge-feishu dsh-evoforge-telegram dsh-evolve-attention \
  dsh-software-delivery dsh-github-review dsh-goal-continuity dsh-resident
dsh --profile web --dump-config
```

Removal unregisters EvoForge effects but keeps native DSH Session, Goal, and Workspace data. External effects that already
occurred are not undone by uninstalling.

## Known limitations

- No registry packages have been published; the names above are local Bundle installation identifiers, not stable npm dependencies.
- Complete real Feishu pairing, Schedule, Approval, post-restart messages, revocation/re-pairing, and long-term reconnect are still under acceptance.
- Real Providers, a same-task/model/permission/budget Hermes paired benchmark, and long-term false-promotion/forgetting/negative-transfer data are incomplete.
- The supported DSH attachment contract currently covers verified native image paths only; Gateway does not invent file/audio/video blocks.
- An external Telegram Bot, production permissions, and multi-day operation require separate verification.

For a runtime issue, start with DSH's native `/doctor`, then read the [current status](docs/status.zh.md) and the relevant plugin README.
Never include an App Secret, access token, or real message content in an Issue or log.

## Contributing

Read the [development and release discipline](docs/releasing.zh.md), [plugin contract](docs/plugin-contract.zh.md), and
[suite boundaries](docs/capability-suites.zh.md). Pull requests should include the DSH revision, reproduction commands,
test results, and redacted evidence. Changes land on `main` in small commits; release requires real installation, browser,
channel, provider, and Hermes comparison gates.

License: MIT.
