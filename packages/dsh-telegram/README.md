# dsh-telegram

`dsh-telegram` is a disabled-by-default DSH Bundle connecting Telegram private messages through the resident `dsh-gateway` to native DSH Workspace/Session/Agent state. It supports both an exact static route and Hermes-style Host pairing for unknown direct messages. It is not a gateway, webhook server, daemon, or second Agent host.

When `dsh-control-center` is installed, the browser half contributes a read-only Telegram Surface to the native DSH Web view. It executes the existing `/telegram` Command, shows the static or paired route, transport and Gateway delivery counts, and never creates a second route, journal or health authority.

```sh
dsh plugin --profile web add /absolute/path/dsh-evoforge-telegram-0.1.0-alpha.1.tgz
```

- exact `chat_id` + `user_id` filtering for static private text routes;
- resident pairing mode: an unknown private sender receives a one-time code from the Adapter, the first message never enters the Agent, and only a Host-approved next message is dispatched through Gateway;
- Gateway-owned deterministic DSH message identities and ingress journal, so Telegram update replay does not create a second turn or repeat a native Command;
- final-answer delivery for every completed turn on the selected Agent, including native Goal and
  Schedule continuations;
- native slash Commands without a model call;
- one-shot DSH Approval buttons (`allowed-once` or `rejected` only);
- a Gateway-owned durable outbound journal and `/telegram` status;
- a suite-internal exact notice route used by `dsh-evolve-attention` without exposing a generic
  notification provider;
- a Gateway-configured hard bound for outbound delivery history;
- bounded retry only after Telegram explicitly returns `429 + retry_after`.
- a 30-second Gateway-owned wall-clock limit for every outbound attempt; timeout or unload becomes
  `uncertain` and is never replayed automatically.

It registers no model Tool, Skill, system-prompt section, or dynamic context. Idle and ordinary
Session token overhead is zero; the selected Agent's existing model composition is unchanged.

## Requirements

- DSH `0.1.2-alpha.5` (`dsh-v0.1.2-alpha.5`) with `dsh-gateway`, Agent, Agent presets, Commands, Session persistence, Workspace, Storage and Storage Domain composed. DSH `0.1.2-rc.1` is newer but its clean upstream build is currently blocked; it is not yet an accepted runtime target;
- Node.js `^22.19.0 || >=24`;
- one Telegram Bot token;
- static mode additionally needs one private chat id, one Telegram user id, and one existing native
  Workspace plus a static Gateway route naming its stable Session id, Agent preset, provider and model;
- pairing mode needs a Gateway account id and an existing native Workspace/Session target for the
  administrator to approve. The Gateway alone creates or cold-resumes that Agent.

The Bundle installs disabled because the route, pairing, and token policies are deployment-specific.
For the existing exact-route mode, enable and configure its rows explicitly:

```yaml
- id: evoforge-gateway
  name: dsh-evoforge-gateway
  disabled: false
  config:
    routes:
      - id: telegram-personal
        adapter: telegram
        accountId: personal-bot
        conversationId: "100000001"
        userId: "200000002"
        workspaceId: 11111111-1111-4111-8111-111111111111
        sessionId: personal-main
        agentPreset: standard
        provider: deepseek-official
        model: deepseek-v4-flash

- id: evoforge-telegram
  name: dsh-evoforge-telegram
  disabled: false
  config:
    routeId: telegram-personal
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

For resident Host pairing (no static Telegram chat/user route), leave `routeIds` empty and configure
the same account id on `dsh-telegram`:

```yaml
- id: evoforge-gateway
  name: dsh-evoforge-gateway
  disabled: false
  config:
    pairing:
      enabled: true

- id: evoforge-telegram
  name: dsh-evoforge-telegram
  disabled: false
  config:
    mode: pairing
    accountId: personal-bot
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

When an unknown user sends a private message, the Gateway decides whether to offer a code. The
administrator approves the redacted pending request in the native DSH Web Channels surface using an
existing live Workspace/Session target. The next message is then routed to that native Session;
the first message is never replayed. Group messages remain ignored.

The Gateway route is the only chat/user/Workspace/Session/Agent authority. `conversationId` and `userId`
must be canonical positive Telegram integer strings; private topics are not accepted. The token is read
from the environment of the DSH Host. Native Commands and one-shot Approval buttons reuse DSH services;
ingress deduplication and outbound delivery records belong to the Gateway. The Adapter retains only
Telegram polling, protocol mapping, platform sending, and one-shot Approval UI. The model cannot change
the route or read the token.

Telegram long polling is owned by the Cordis fiber; Gateway owns the serialized outbound registration
and retry timers. The Adapter reports only redacted `connecting/ready/degraded/stopping` observations
for its configured account and active routes into Gateway health; protocol errors and reconnect policy stay here. Disable/unload aborts both. Ambiguous sends become `uncertain` and are not retried
automatically; already delivered external messages cannot be retracted.

```sh
dsh plugin --profile web remove dsh-evoforge-telegram
```

Set `DSH_TELEGRAM_BOT_TOKEN` in the process supervisor's secret environment. Naming that variable
in plugin config is the explicit deployment policy authorizing this plugin to read that one secret
and contact the configured Bot account. The model cannot read the token or change the Bot API endpoint,
chat, user, or Agent route. Production accepts only `https://api.telegram.org`; loopback endpoints exist
for a local Bot API server and tests.

## Delivery semantics

Telegram has no caller-supplied idempotency key for `sendMessage`, so this package does not claim
exactly-once delivery:

1. `prepared` is durable before a send is scheduled.
2. `sending` is durable before `sendMessage` starts.
3. A successful response records Telegram's `message_id` as `delivered`.
4. An explicit `429` can retry at most `maxSendAttempts` and never after a retry delay above five
   minutes.
5. A transport break, malformed response, non-429 rejection, or process restart from `sending`
   becomes `uncertain`; it is not retried automatically because Telegram may already have accepted
   it.

`/telegram` reports retained delivered, pending, uncertain, and failed counts. Removing the plugin
stops future routing and leaves native DSH Session/Goal state usable. It cannot retract messages
already accepted by Telegram.

Native Command admission is at-most-once per Telegram update through the shared Gateway journal. A
crash at an unprovable effect boundary becomes `uncertain`; replaying the same update never executes
it twice, and the user receives a bounded instruction to send a new Telegram message. Gateway journal
compaction removes only the oldest terminal outbound records and never a live delivery.

When the optional `dsh-evolve-attention` bridge is enabled in the same profile, actionable Evolve
Candidate review and inactive promotion decisions use this package's existing exact chat route and Gateway delivery
journal. The suite-internal route service exposes the same static native Workspace id so every
Evolve scan remains explicitly Workspace-scoped. The bridge does not read the Bot token, add
another route, choose a recent Workspace, or turn a notice into Approval.
See [`dsh-evolve-attention`](../dsh-evolve-attention/README.md) for its message and cache contract.

## Deliberate limits

No groups, channels, topics, media materialization, webhook server, streaming drafts, multi-Bot routing,
multi-Agent routing, second Session, second Goal, second Schedule, or permanent approval grant.
Pairing mode intentionally does not expose a notification route to `dsh-evolve-attention` until a
specific Workspace target has been selected; static mode remains the supported attention path.
Add another out-of-tree adapter only after its own user workflow and authority boundary are proven.
