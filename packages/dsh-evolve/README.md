# dsh-evolve

`dsh-evolve` is an out-of-tree DSH Bundle. It runs inside the existing DSH Host and uses native Storage Domain, Agent/Session, Jobs, Commands, Skills, Tools, and message-feedback seams. It is not a standalone evolution Runtime.

Install the packed artifact through DSH:

```sh
dsh plugin --profile web add /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

The Bundle inserts exactly one `evoforge-evolution` row and defaults `cacheRoot` under `DSH_HOME`. Configure the row in the profile's `cordis.patch.yml` when Git Skill sources, private feedback roots, bounded supervisor roots, or explicit automatic policies are required.

`trustedDiscoverySources` is an optional list of `{ id, repository, skillsRoot }` entries. Each entry explicitly trusts one existing local Git checkout or mirror as a discovery source. After an exact native Skill miss, EvoForge reads the matching whole-Skill folder from the pinned Git commit into quarantine metadata; it does not checkout, execute, install, or activate the package. The default empty list records an explicit abstention instead of searching an untrusted source.

`discoveryAdmissionTargets` optionally binds one exact Workspace and Skill to fixed baseline/Case Pack hashes and an owned run root. New quarantined candidates enter a native DSH Job for a zero-model deterministic admission Trial. This path rejects assembled evaluators and executable/non-instruction package files; a baseline-fail/candidate-pass result is only `qualified-for-shadow` and carries `releaseAuthority: none`. It never installs, activates, publishes, or auto-promotes a discovered Skill.

Inside a DSH session, use `/evolve status`, review/release Commands, or the separately installed `dsh-evolve-web` client adapter. Active Generation selection is future-session-only; live Session history, Goal state, Approval, Jobs, and Storage remain DSH authoritative.

When the Bundle row declares exact `shadowTargets` or `evaluatorTargets`, protected authoring and Shadow actions also stay on the DSH Command surface:

```text
/evolve feedback <signal-id> shadow <target-id>
/evolve feedback <signal-id> author <evaluator-target-id>
/evolve evaluator <draft-id> approve <review-note>
/evolve evaluator <draft-id> shadow
```

Each authoring or Shadow launch is submitted as a native DSH Job and returns immediately. `/evolve evaluator <draft-id> qualify-shadow <review-note>` is the explicit combined qualification-plus-Shadow action. Target paths, Case Pack hashes, run roots, and spending boundaries come only from host profile configuration, never from the browser or Command arguments.

There is no published `dsh-evolve` executable. Shadow/calibration drivers under `test/fixtures` are non-packed development fixtures. Long-running scan/recovery work is optional, bounded, and owned by the plugin's Cordis lifecycle; unload cancels its work and unregisters services.

Remove it with:

```sh
dsh plugin --profile web remove dsh-evolve
```

Remove `dsh-evolve-web` first when both are installed. Native DSH Session/Goal data remains readable; plugin-owned evolution records can remain in DSH Storage for a later reinstall.
