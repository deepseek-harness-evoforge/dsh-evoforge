# dsh-telegram

`dsh-telegram` connects one deployment-authorized Telegram private chat to one existing,
stable DeepSeek Harness Agent. It is deliberately not a multi-channel gateway.

## What it adds

- exact `chat_id` + `user_id` filtering for private text messages;
- deterministic DSH message identities, so Telegram update replay does not create a second turn;
- final-answer delivery for every completed turn on the selected Agent, including native Goal and
  Schedule continuations;
- native slash Commands without a model call;
- one-shot DSH Approval buttons (`allowed-once` or `rejected` only);
- a durable Storage Domain delivery journal and `/telegram` status;
- a 10,000-record hard bound for terminal delivery history plus one monotonic command checkpoint;
- bounded retry only after Telegram explicitly returns `429 + retry_after`.

It registers no model Tool, Skill, system-prompt section, or dynamic context. Idle and ordinary
Session token overhead is zero; the selected Agent's existing model composition is unchanged.

## Requirements

- DSH `>=0.1.0-rc.5 <0.2.0` with Agent, Commands, Session, Storage and Storage Domain composed;
- Node.js `^22.19.0 || >=24`;
- one Telegram Bot token, one private chat id, one Telegram user id;
- a DSH root Agent with a stable `sessionId`. `agentId` below is that runtime Agent/Session id,
  not the declarative Agent config label. Keep native Session persistence enabled when restart
  continuity and replay deduplication are required.

The Bundle installs disabled because the route and token policy are deployment-specific. Enable
and configure its row explicitly:

```yaml
- id: evoforge-telegram
  name: dsh-telegram
  config:
    agentId: personal-main
    chatId: 100000001
    userId: 200000002
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

The corresponding Agent must use the exact stable identity:

```yaml
agents:
  - id: personal
    sessionId: personal-main
    provider: deepseek-official
    model: deepseek-v4-flash
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

Native Command admission is at-most-once per Telegram update. A crash after durable admission but
before command completion can therefore require the user to send the command again as a new
Telegram message; replaying the same update will never execute it twice. Journal compaction removes
only the oldest terminal records and never a live delivery.

## Deliberate limits

No groups, channels, topics, media, webhook server, streaming drafts, multi-Bot routing,
multi-Agent routing, second Session, second Goal, second Schedule, or permanent approval grant.
Add another out-of-tree adapter only after its own user workflow and authority boundary are proven.
