# dsh-goal-continuity

`dsh-goal-continuity` is an opt-in cold-resume policy for bounded native DeepSeek Harness Goals. When DSH restores an exact persisted Session after a process restart, the plugin can rearm that Session's still-active Goal so the existing `@deepseek-ai/dsh-goal-round-driver` continues within the Goal's durable round cap.

It does not create a Mission, scan cold Sessions, replace the Agent loop, or maintain another task database.

## Install

```sh
dsh plugin add dsh-goal-continuity
```

The Bundle row is installed disabled because rearming a Goal can cause paid provider requests. Enable it only after choosing exact persistent Session ids:

```yaml
- id: evoforge-goal-continuity
  name: dsh-goal-continuity
  disabled: false
  config:
    autoResumeSessionIds:
      - my-persistent-agent-session
```

The Agent itself must already restore that exact Session through native DSH Agent Loop and Session Persistence configuration. The normal DSH base Bundle supplies native Goal and same-session goal-round support.

## Behavior

On `agent/session-start` with source `resume`, the plugin:

1. matches the exact live Agent/Session id against the static allowlist;
2. reads the authoritative native Goal;
3. acts only when the Goal is active, disarmed, and has remaining `maxGoalRounds` capacity;
4. calls native `GoalService.resume` with the exact id and revision.

Paused, blocked, complete, exhausted, fresh-start, and non-allowlisted Goals remain unchanged. Reloading the plugin over an already-live Session does not synthesize another resume edge.

## Model Experience

### What the model sees

The plugin adds no Tool, Skill, system-prompt section, Command, or per-turn state. If it rearms a Goal, the model sees the same append-only native `<goal_round>` message that a human-authorized `/goal resume` would produce.

### Token effect

Idle and non-matching operation adds zero tokens. An authorized recovery can spend the model tokens of the remaining native Goal rounds; configuration is therefore a deployment-level paid-operation authorization.

### KV Cache effect

The stable system prompt, Tool names and schemas, Skill catalog, and existing Session prefix are unchanged. Recovery appends the normal native Goal round instead of rewriting prior context. The assembled test compares the provider-facing cache surface with manual native resume.

## Permissions and recovery

The plugin grants no filesystem, shell, network, secret, merge, release, deployment, or irreversible-effect permission. Every Tool call in a recovered round still uses native DSH permissions and Approval. Goal revision, activation, round count, completion, and blockers remain native Session-log facts; uninstall leaves them readable.

## Known limitations

- An OS service manager must restart DSH; this plugin does not manage processes.
- Static allowlisting does not distinguish a machine crash from a deliberate restart. Enabling it authorizes continuation after either event.
- It does not retry provider or persistence failures inside the same process and does not resume paused or blocked Goals.
- Local Continuity is not multi-machine High Availability.
