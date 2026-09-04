# dsh-evoforge-telegram

Thin Telegram adapter for the resident `dsh-gateway`. It owns Bot API polling, platform formatting, credentials, and sends;
Gateway owns pairing, routing, delivery journal, and DSH Session identity.

## Install and enable

Normal users install the complete product:

```sh
pnpm run dsh:install
```

The adapter is installed disabled. Enable pairing with a DSH profile override:

```yaml
- id: evoforge-telegram
  name: dsh-evoforge-telegram
  disabled: false
  config:
    mode: pairing
    accountId: telegram-bot-prod
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
    routeIds: []
```

`tokenEnv` is a DSH CredentialProvider reference name, not a cleartext environment value. Save the Bot token through DSH;
never place it in YAML, Git, logs, or Session content.

## Pairing and routes

The first unknown direct message returns a one-time code and is not dispatched. Approve the exact principal in the shared
DSH Web Channels surface and bind an existing Workspace/Session; only the next message enters that Session.

Static routes must bind exact account, chat/user, Workspace, Session, Agent preset, provider, and model. Wildcards, groups
without an explicit policy, or model-selected routing fail closed.

Gateway deduplicates updates and persists sends. Telegram `429 + retry_after` permits bounded retry; timeout, crash, or any
other ambiguous result becomes `uncertain`. Cordis stops polling on disable/reload/remove. Current real-channel limitations
are in [status](../../docs/status.zh.md).

## Remove

```sh
dsh plugin --profile web remove dsh-evoforge-telegram
```

Removal stops polling; native Session/Workspace data and completed external effects remain.
