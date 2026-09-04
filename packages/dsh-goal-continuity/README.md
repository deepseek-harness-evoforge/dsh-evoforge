# dsh-goal-continuity

Disabled-by-default policy for users who explicitly want a native DSH Goal to continue after a cold Session resume. It can
rearm one exact allowlisted active Goal through `GoalService.resume`; ordinary conversation does not require a Goal.

Install the optional continuity suite from the repository root:

```sh
pnpm run dsh:install -- --suite continuity --profile admin
```

Enable only exact Session ids:

```yaml
- id: evoforge-goal-continuity
  name: dsh-goal-continuity
  disabled: false
  config:
    autoResumeSessionIds: [personal-main]
```

It does not scan Sessions, restart DSH, create a task database, retry providers, or change native round limits. An external
service manager—optionally controlled by `dsh-resident`—owns process restart.

```sh
dsh plugin --profile admin remove dsh-goal-continuity
```

Native Goal and Session history remain readable.
