# dsh-resident

Native DSH Bundle that plans and manages one exact profile's user-level launchd/systemd service through `/resident`. It has
no standalone executable, daemon, Session, database, Agent loop, or Gateway. The OS service manager remains process authority.

## Install and configure

Install the optional continuity suite into a separate management profile:

```sh
pnpm run dsh:install -- --suite continuity --profile admin
```

The Bundle is disabled until a profile patch supplies canonical absolute `dshHome`, `cwd`, `dshEntry`, and `nodeBin`, plus
the target profile. `noOpen` defaults to true so restarts do not create browser tabs.

## Confirmed actions

```text
/resident plan
/resident apply <plan-sha256>
/resident status
/resident remove <service-id>
```

`plan` is read-only. Only the exact returned hash may apply the unit; removal similarly requires the exact service id.
These are OS effects distinct from plugin installation. If a call disconnects after the effect begins, query status before
retrying.

The unit executes exact Node + DSH entry without a shell, stores no API token, is written atomically with private mode, and
starts the target with `--no-open` by default. Disabling/uninstalling the Bundle removes only the command surface: remove an
existing OS service explicitly first.

```sh
dsh plugin --profile admin remove dsh-resident
```
