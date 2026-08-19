# dsh-telegram

`dsh-telegram` is a disabled-by-default DSH Bundle connecting one exact private Telegram chat/user through `dsh-gateway` to a native Workspace/Session/Agent. It is not a gateway, webhook server, daemon, or second Agent host.

```sh
dsh plugin --profile web add /absolute/path/dsh-telegram-0.1.0-alpha.1.tgz
```

- exact `chat_id` + `user_id` filtering for private text messages;
- Gateway-owned deterministic DSH message identities and ingress journal, so Telegram update replay does not create a second turn or repeat a native Command;
- final-answer delivery for every completed turn on the selected Agent, including native Goal and
  Schedule continuations;
- native slash Commands without a model call;
- one-shot DSH Approval buttons (`allowed-once` or `rejected` only);
- a durable Storage Domain delivery journal and `/telegram` status;
- a suite-internal exact notice route used by `dsh-evolve-attention` without exposing a generic
  notification provider;
- a 10,000-record hard bound for terminal outbound delivery history;
- bounded retry only after Telegram explicitly returns `429 + retry_after`.

It registers no model Tool, Skill, system-prompt section, or dynamic context. Idle and ordinary
Session token overhead is zero; the selected Agent's existing model composition is unchanged.

## Requirements

- DSH `>=0.1.0-rc.5 <0.1.0` with `dsh-gateway`, Agent, Agent presets, Commands, Session persistence, Workspace, Storage and Storage Domain composed;
- Node.js `^22.19.0 || >=24`;
- one Telegram Bot token, one private chat id, one Telegram user id;
- one existing native Workspace plus a static Gateway route naming its stable Session id, Agent preset,
  provider and model. The Gateway alone creates or cold-resumes that Agent.

The Bundle installs disabled because the route and token policy are deployment-specific. Enable
and configure its row explicitly:

```yaml
- id: evoforge-gateway
  name: dsh-gateway
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
  name: dsh-telegram
  disabled: false
  config:
    routeId: telegram-personal
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

The Gateway route is the only chat/user/Workspace/Session/Agent authority. `conversationId` and `userId`
must be canonical positive Telegram integer strings; private topics are not accepted. The token is read
from the environment of the DSH Host. Native Commands and one-shot Approval buttons reuse DSH services;
ingress deduplication belongs to the Gateway and outbound delivery records use Telegram's DSH Storage
Domain. The model cannot change the route or read the token.

Telegram long polling and pending retry timers are owned by the Cordis fiber. Disable/unload aborts them and unregisters routing. Ambiguous sends become `uncertain` and are not retried automatically; already delivered external messages cannot be retracted.

```sh
dsh plugin --profile web remove dsh-telegram
```

Set `DSH_TELEGRAM_BOT_TOKEN` in the process supervisor's secret environment. Naming that variable
in plugin config is the explicit deployment policy authorizing this plugin to read that one secret
and contact the fixed chat. The model cannot read the token or change the Bot API endpoint, chat,
user, or Agent route. Production accepts only `https://api.telegram.org`; loopback endpoints exist
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
it twice, and the user receives a bounded instruction to send a new Telegram message. Telegram
journal compaction removes only the oldest terminal outbound records and never a live delivery.

When the optional `dsh-evolve-attention` bridge is enabled in the same profile, actionable Evolve
Candidate and Evaluator Draft states use this package's existing exact chat route and delivery
journal. The suite-internal route service exposes the same static native Workspace id so every
Evolve scan remains explicitly Workspace-scoped. The bridge does not read the Bot token, add
another route, choose a recent Workspace, or turn a notice into Approval.
See [`dsh-evolve-attention`](../dsh-evolve-attention/README.md) for its message and cache contract.

## Deliberate limits

No groups, channels, topics, media, webhook server, streaming drafts, multi-Bot routing,
multi-Agent routing, second Session, second Goal, second Schedule, or permanent approval grant.
Add another out-of-tree adapter only after its own user workflow and authority boundary are proven.
