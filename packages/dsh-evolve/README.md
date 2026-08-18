# dsh-evolve

`dsh-evolve` is an out-of-tree DSH Bundle. It runs inside the existing DSH Host and uses native Storage Domain, Agent/Session, Jobs, Commands, Skills, Tools, and message-feedback seams. It is not a standalone evolution Runtime.

Install the packed artifact through DSH:

```sh
dsh plugin --profile web add /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

The Bundle inserts exactly one `evoforge-evolution` row and defaults `cacheRoot` under `DSH_HOME`. Configure the row in the profile's `cordis.patch.yml` when Git Skill sources, private feedback roots, bounded supervisor roots, or explicit automatic policies are required.

Existing-capability routing remains native DSH behavior: the model reads the complete Session Skill catalog and calls the native `skill` Tool when a catalog entry applies. EvoForge adds one stable model-facing Tool, `report_capability_gap`, for the distinct case where no cataloged Skill applies to an active natural-language Goal. The Host accepts only a bounded kebab-case proposal, rechecks the exact Workspace/Session, active native Goal, complete settled catalog, and absence of that exact Skill, then durably records the Gap before scheduling background discovery. This is not a user menu and does not ask the user to choose a path, Agent, workflow, or Skill. The Tool never searches the network, installs a package, executes candidate content, or changes the current Session.

`trustedDiscoverySources` is an optional list of `{ id, repository, skillsRoot }` entries. Each entry explicitly trusts one existing local Git checkout or mirror as a discovery source. After either an exact native Skill miss or an accepted model-declared Gap, EvoForge first checks the exact Skill name at the pinned Git commit. If that path is absent and the Gap is linked to an active Goal, it performs a bounded, deterministic lexical-semantic search over valid `SKILL.md` names and descriptions in the same trusted tree. Only one strong, unambiguous match becomes quarantine metadata; weak or ambiguous results abstain. The package is content-addressed and never checked out, executed, installed, or activated. The default empty list records an explicit abstention instead of searching an untrusted source. Network/external-catalog search and candidate generation are not implemented yet.

The host also derives bounded cross-Goal demand clusters from durable, Goal-linked Gaps. Repeated requests are grouped only inside one Workspace and only after two distinct Goal ids; different proposed names converge only when discovery independently resolves them to one quarantined Skill identity. Same-Goal retries do not qualify, conflicting candidates exclude that Gap, and a cluster has evidence authority only: it cannot generate, install, activate, or release a Skill.

`discoveryAdmissionTargets` optionally binds one exact Workspace and Skill to fixed baseline/Case Pack hashes and an owned run root. New quarantined candidates enter a native DSH Job for a zero-model deterministic admission Trial. This path rejects assembled evaluators and executable/non-instruction package files; a baseline-fail/candidate-pass result is only `qualified-for-shadow` and carries `releaseAuthority: none`. It never installs, activates, publishes, or auto-promotes a discovered Skill.

`discoveryShadowTargets` optionally binds that qualified Workspace+Skill to a different fixed `dshAssembled: true` holdout Case Pack and a run root that must also appear exactly in `supervisor.runRoots`. After the admission Job settles, native DSH Jobs revalidate the durable admission report and Candidate tree, then run the existing Shadow/ReviewInbox path without a proposer model. A clear win remains an inactive human-review Candidate; external provenance is deliberately outside automatic-promotion policy.

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
