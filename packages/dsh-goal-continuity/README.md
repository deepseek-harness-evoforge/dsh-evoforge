# dsh-goal-continuity

`dsh-goal-continuity` is a disabled-by-default DSH Bundle policy. On native cold Session resume, it can rearm an exact allowlisted active Goal through `GoalService.resume`; DSH remains the Goal, round-limit, Session, Agent-loop, persistence, permission, and model-execution authority.

```sh
dsh plugin --profile web add /absolute/path/dsh-goal-continuity-0.1.0-alpha.1.tgz
```

Enable only after explicitly authorizing persistent Session ids:

```yaml
- id: evoforge-goal-continuity
  name: dsh-goal-continuity
  disabled: false
  config:
    autoResumeSessionIds:
      - personal-main
```

It acts only on `agent/session-start` with source `resume`, an exact allowlist match, an active/disarmed Goal, and remaining native rounds. It does not scan cold Sessions, restart DSH, create a Mission/task database, retry providers, or add Tool/Skill/Prompt/Command state.

```sh
dsh plugin --profile web remove dsh-goal-continuity
```

Uninstall leaves the native Goal and Session event log readable. An external service manager, not this plugin, owns restarting DSH.
