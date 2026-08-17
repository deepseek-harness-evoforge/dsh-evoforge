# dsh-resident

`dsh-resident` installs one exact DeepSeek Harness CLI/profile as a user-level `launchd` or `systemd`
service. It starts at user login, restarts after either a crash or a normal process exit, and can be
removed explicitly.

It is an operational CLI, not a DSH runtime Bundle. It adds no Tool, Skill, Prompt, Command, model call,
state database, daemon, or Session-visible text. The operating-system service manager and the generated
unit are the only authorities.

> Pre-alpha. Use on a development machine first. Multi-machine high availability, Windows, secret
> provisioning, log rotation, and production soak evidence are outside this release.

## Commands

Inspect the exact unit before changing the machine:

```sh
dsh-resident plan \
  --profile web \
  --dsh-entry /absolute/path/to/dsh/lib/bin.js \
  --node-bin /absolute/path/to/node \
  --dsh-home /absolute/path/to/.dsh \
  --cwd /absolute/path/to/workspace
```

Use `node -p 'process.execPath'` to obtain the exact Node path. From a directory where the DSH package
resolves, this prints its JavaScript entry without using a `.bin` shell wrapper:

```sh
node -e "const p=require.resolve('@deepseek-ai/dsh/package.json');const m=require(p);console.log(require('node:path').resolve(require('node:path').dirname(p),m.bin.dsh))"
```

Install and start it only after reviewing that JSON:

```sh
dsh-resident apply \
  --profile web \
  --dsh-entry /absolute/path/to/dsh/lib/bin.js \
  --node-bin /absolute/path/to/node \
  --dsh-home /absolute/path/to/.dsh \
  --cwd /absolute/path/to/workspace \
  --confirm-deployment
```

Query or remove the exact service derived from `DSH_HOME + profile`:

```sh
dsh-resident status --profile web --dsh-home /absolute/path/to/.dsh
dsh-resident remove --profile web --dsh-home /absolute/path/to/.dsh --confirm-deployment
```

The manager defaults to `launchd` on macOS and `systemd` on Linux. `--manager` may be specified for a
cross-platform `plan`; `apply`, `status`, and `remove` refuse a non-native manager.

## Safety and cache contract

- `plan` is read-only. `apply` and `remove` are deployment actions and require
  `--confirm-deployment` on every call.
- Paths are absolute and normalized. The unit invokes the exact Node executable and DSH JavaScript
  entry directly, without a shell or `PATH` lookup.
- The unit contains only `DSH_HOME`; it neither reads nor copies API keys or other shell environment
  variables. Configure provider credentials through an independently approved mechanism.
- Unit files are written atomically with mode `0600`. The DSH home and workspace remain owned by DSH
  and the user.
- macOS stdout/stderr logs remain under `<DSH_HOME>/resident/<service-id>/` after removal so an operator
  does not lose failure evidence. Removing those logs is a separate user decision.
- Because no model-visible DSH surface is added, idle and active token overhead are both `0`.

## Platform behavior

On macOS the generated LaunchAgent uses `RunAtLoad`, `KeepAlive`, and a five-second throttle. It starts
after the user logs in. On Linux the generated user unit uses `Restart=always`, a five-second delay, and
a bounded start-limit window. Starting a systemd user service before login may require an operator to
enable user lingering; `dsh-resident` does not do that automatically.

Both managers intentionally restart after a clean DSH exit as well as a crash. Use `remove` when the
profile should remain stopped. A registered service can be temporarily inactive during manager backoff;
inspect the returned `registered`, `active`, and `unitPresent` fields separately.

## Source verification

```sh
pnpm --filter dsh-resident test
pnpm --filter dsh-resident typecheck
pnpm --filter dsh-resident build
pnpm --filter dsh-resident pack --pack-destination /tmp
```
