# dsh-telegram

`dsh-telegram` is a disabled-by-default DSH Bundle connecting one exact private Telegram chat/user to one existing stable DSH Agent/Session. It is not a gateway, webhook server, daemon, or second Agent host.

```sh
dsh plugin --profile web add /absolute/path/dsh-telegram-0.1.0-alpha.1.tgz
```

Enable it only with an explicit profile patch:

```yaml
- id: evoforge-telegram
  name: dsh-telegram
  disabled: false
  config:
    agentId: personal-main
    chatId: 100000001
    userId: 200000002
    tokenEnv: DSH_TELEGRAM_BOT_TOKEN
```

The selected Agent must already exist under that exact stable DSH Session id. The token is read from the environment of the DSH Host. Native Commands and one-shot Approval buttons reuse DSH services; replay deduplication and bounded delivery records use DSH Storage Domain. The model cannot change the route or read the token.

Telegram long polling and pending retry timers are owned by the Cordis fiber. Disable/unload aborts them and unregisters routing. Ambiguous sends become `uncertain` and are not retried automatically; already delivered external messages cannot be retracted.

```sh
dsh plugin --profile web remove dsh-telegram
```

Native DSH Session/Goal history remains usable.
