# dsh-software-delivery

Optional DSH Bundle for turning an explicit native Goal into a verified Git artifact. It contributes one
`software-delivery` Skill and one stable `complete_delivery` Tool; DSH remains the Shell, Sandbox, Approval, Session log,
Goal revision, and `update_goal` authority.

```sh
pnpm run dsh:install -- --suite delivery
```

The Agent supplies the exact Goal id/revision, linked worktree, base ref, and repository checks. A pass may complete that
Goal; a failed or unverifiable check leaves it active. Optional Draft PR head checks are bounded and opt-in. The plugin never
merges, marks ready, releases, deploys, or creates another task state machine.

`dsh-github-review` is not part of the public suite until its credentials and real-repository gates are corrected.

```sh
dsh plugin --profile web remove dsh-software-delivery
```

Removal unloads its Skill/Tool and leaves native Goal/Session data intact.
