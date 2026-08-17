# dsh-software-delivery

`dsh-software-delivery` is an out-of-tree DSH Bundle for completing a native DSH Goal as a verified Git artifact. It contributes one on-demand `software-delivery` Skill and one stable `complete_delivery` Tool. There is no standalone verifier product or `dsh-delivery` executable.

```sh
dsh plugin --profile web add /absolute/path/dsh-software-delivery-0.1.0-alpha.1.tgz
dsh --profile web
```

In a DSH session, create/continue a native Goal and use the `software-delivery` Skill. The Agent calls `complete_delivery` with the exact Goal id/revision, linked worktree, base ref, and repository check argv. The Tool resolves that Agent's native Bash/pwsh and `update_goal`, so DSH Sandbox, Approval, Tool policy, Session event log, and Goal revision remain authoritative.

Optional profile config can require exact Draft PR head checks and a bounded in-call wait:

```yaml
- id: evoforge-software-delivery
  name: dsh-software-delivery
  config:
    requireDraftPrChecks: true
    draftPrCheckWait:
      timeoutMs: 1800000
      pollIntervalMs: 15000
```

The plugin never merges, releases, deploys, marks a PR ready, or creates a second Goal/state machine. If its native Tool dependencies are unavailable, the Skill tells the Agent to keep the Goal active rather than bypass DSH.

```sh
dsh plugin --profile web remove dsh-software-delivery
```

Unload removes only its Skill and Tool; native Goal and Session data stays in DSH.
