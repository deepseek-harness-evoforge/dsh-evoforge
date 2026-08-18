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

`trustedDiscoverySources` is an optional list of `{ id, repository, skillsRoot }` entries. Each entry explicitly trusts one existing local Git checkout or mirror as a discovery source. `trustedAgentSkillIndexes` separately accepts `{ id, indexUrl }` entries for explicitly trusted Agent Skills Discovery v0.2 well-known indexes. Production indexes must use HTTPS at `/.well-known/agent-skills/index.json`; plain HTTP is loopback-only for real integration tests. External `skill-md` and `archive` artifacts must stay same-origin, match the index SHA-256 digest, and match their root `SKILL.md` identity. Archive support is deliberately limited to digest-first `.tar.gz`/`.zip` decoding with path, link, type, file-count, per-file and total-size gates. Verified bytes remain in private DSH Storage; discovery never executes, installs, or activates the package.

After either an exact native Skill miss or an accepted model-declared Gap, EvoForge first checks the exact Skill name. If it is absent and the Gap is linked to an active Goal, it performs a bounded, deterministic lexical-semantic search over valid names and descriptions. Only one strong, unambiguous match becomes a durable quarantined candidate; weak, ambiguous, schema-unknown, cross-origin, digest-mismatched, or invalid results abstain. Verified external `SKILL.md` bytes are retained privately in DSH Storage so later deterministic admission materializes the pinned artifact without trusting a newer network response. Candidate bodies never cross the Web adapter. No discovered package is executed, installed, or activated, and the default empty source lists record an explicit abstention.

The host also derives bounded cross-Goal demand clusters from durable, Goal-linked Gaps. Repeated requests are grouped only inside one Workspace and only after two distinct Goal ids; different proposed names converge only when discovery independently resolves them to one quarantined Skill identity. Same-Goal retries do not qualify and conflicting candidates exclude that Gap. The cluster itself has evidence authority only.

`slowLoopAuthorTargets` optionally authorizes one exact `{ id, workspaceId, skill, runRoot, maxAttemptsPerUtcDay }` target. Only an unresolved same-name cluster with at least two distinct Goals, no candidate on any member Gap, composed native Jobs and Web services, and remaining durable UTC-day budget can reach the configured OpenAI-compatible authoring route. One reconciliation schedules at most one Job. Native Web research first builds a bounded corpus with URL-disjoint knowledge and verification tracks. The author receives only Goal evidence plus the knowledge tracks and must return one complete instruction-only Agent Skill bundle containing root `SKILL.md` and one-level `references/*.md`; the Host assembles and validates the archive, hashes model/input/research/artifact/tree provenance, stores it privately, and emits an inactive/quarantined/unevaluated/never-executed Candidate. A crash after a possibly paid request becomes `uncertain` and is never blindly retried. The module has no install, activation, publisher, or release interface, and its Web projection exposes only phase, counts, digests, cost, and Candidate id.

`researchHoldoutTargets` is the mandatory independent gate whenever the same exact Workspace+Skill appears in both `slowLoopAuthorTargets` and `discoveryAdmissionTargets`. Each `{ id, workspaceId, skill, runRoot, maxAttemptsPerUtcDay }` target has a separate owned root, durable UTC-day budget, evaluator route (`DSH_EVOLVE_HOLDOUT_MODEL_BASE_URL`, `DSH_EVOLVE_HOLDOUT_MODEL_NAME`, optional `DSH_EVOLVE_HOLDOUT_MODEL_API_KEY`), and native Job. It rebinds the withheld verification evidence to the exact Candidate/research/tree/author lineage, refuses an evaluator identity that can match the author, materializes but never executes the instruction-only bundle, and asks for one finding per exact anchor digest. The Host—not the model—derives `pass`, `fail`, or `inconclusive`; duplicate, missing, or unknown anchors fail closed. Only a durable `pass` can enqueue deterministic admission. Its Web projection shows bounded status, digest lineage, per-anchor assessments, and cost, but never excerpts, URLs, evaluator attributions, model routes, Skill bodies, or private paths. The gate has no install, activation, publication, or release authority.

`researchRevisionTargets` must exactly cover `researchHoldoutTargets`. A durable `fail` or `inconclusive` on an original research-v2 Candidate may trigger one separately budgeted native Job. The Host revalidates the exact durable Holdout report, removes satisfied anchors and all withheld excerpts/URLs, materializes but never executes the exact parent bundle, and gives a reviser only the whole-Skill text plus bounded failed/unresolved `{ anchorDigest, assessment, attribution }` findings. The reviser returns one complete replacement bundle; the Host reassembles it, rejects malformed or unchanged trees, binds the v3 Candidate to the parent Candidate/tree and Holdout id, and keeps it inactive/quarantined/unevaluated/never-executed. The v3 Candidate automatically re-enters independent Holdout; it can pass onward to deterministic admission or remain quarantined, but it can never trigger a second revision. Revision uses `DSH_EVOLVE_REVISION_MODEL_*` when configured and otherwise falls back to the authoring `DSH_EVOLVE_MODEL_*` route. Crash recovery never blindly repeats a possibly paid call. The Web projection exposes only digest lineage, state and cost—not finding attribution, Skill bodies, model routes or private paths—and provides no release action.

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
