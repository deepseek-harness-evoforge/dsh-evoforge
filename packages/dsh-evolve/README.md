# dsh-evolve

`dsh-evolve` is an out-of-tree DSH Bundle. It runs inside the existing DSH Host and uses native Storage Domain, Agent/Session, Jobs, Commands, Skills, Tools, and message-feedback seams. It is not a standalone evolution Runtime.

Install the packed artifact through DSH:

```sh
dsh plugin --profile web add /absolute/path/dsh-evolve-0.1.0-alpha.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

The Bundle inserts exactly one `evoforge-evolution` row and defaults `cacheRoot` under `DSH_HOME`. Configure the row in the profile's `cordis.patch.yml` when current Generation Git sources, private feedback roots, bounded supervisor roots, or explicit automatic policies are required.

Existing-capability routing remains native DSH behavior: the model reads the complete Session Skill catalog and calls the native `skill` Tool when a catalog entry applies. EvoForge adds one stable model-facing Tool, `report_capability_gap`, for the distinct case where no cataloged Skill applies to an active natural-language Goal. The Host accepts only a bounded kebab-case proposal, rechecks the exact Workspace/Session, active native Goal, complete settled catalog, and absence of that exact Skill, then durably records the Gap before scheduling background discovery. This is not a user menu and does not ask the user to choose a path, Agent, workflow, or Skill. The Tool never searches the network, installs a package, executes candidate content, or changes the current Session.

Self-discovery is internal experience learning. `ExperienceDrivenSkillOpportunityDiscovery` derives eligibility only from durable, Goal-linked DSH Capability Gaps. One same-name pattern becomes an eligible `SkillOpportunity` only inside one Workspace and after at least two distinct Goal ids. Opportunity v2 may associate a later reference-only correction when its Session has exactly one Gap Skill, or a later compact delivery outcome when its stable Goal id has exactly one Gap Skill across known revisions and the Outcome revision is not older than the matching Gap. Ambiguity fails closed and `causalClaim` is always `none`; this context cannot create or reorder an Opportunity, change authoring eligibility, or enter the author input. Same-Goal retries, missing Goal identity, cross-Workspace evidence, and insufficient observations abstain. Runtime external search, package acquisition, download, import, and marketplace access are not product capabilities.

`selfDiscoveryPolicies` optionally authorizes `{ id, workspaceId, runRoot, maxAttemptsPerUtcDay }`. It deliberately has no `skill`, source, path, Agent, workflow, or route selector. The Skill identity is derived from the internal Opportunity. A native DSH Job receives only bounded Goal/Gap evidence and asks the configured author model for one instruction-only whole-Skill bundle containing root `SKILL.md` and optional one-level `references/*.md`. The Host validates canonical paths, identity, size, regular-file-only content, and no scripts; it hashes model/input/artifact/tree provenance, stores the bundle privately, and emits an inactive/quarantined/unevaluated/never-executed Candidate. One reconciliation schedules at most one Job. A crash after a possibly paid request becomes `uncertain` and is never blindly retried.

The product does not provide external Skill search, package acquisition, marketplace access, download, or import. DSH Web projects the exact `Capability Gap → Skill Opportunity → Candidate` flow plus associated correction/outcome counts, bounded opaque references, the no-causality disclaimer, phase, cost, digests, and governance state. Candidate bodies, correction text, Session ids, and private paths never cross the adapter. Ecosystem research is limited to design-time decisions and frozen benchmarks.

`candidateAdmissionTargets` optionally binds one exact Workspace and Skill to fixed baseline/Case Pack hashes and an owned run root. New internal-experience v1 Candidates enter a native DSH Job for a zero-model deterministic admission Trial. This path rejects assembled evaluators and executable/non-instruction package files; a baseline-fail/candidate-pass result is only `qualified-for-shadow` and carries `releaseAuthority: none`. It never installs, activates, publishes, or auto-promotes a Skill Candidate.

`candidateShadowTargets` optionally binds that qualified Workspace+Skill to a different fixed `dshAssembled: true` holdout Case Pack and a run root that must also appear exactly in `supervisor.runRoots`. After the admission Job settles, native DSH Jobs revalidate the durable admission report and Candidate tree, then run the existing Shadow/ReviewInbox path without a proposer model. The Host shrinks the exact Skill Opportunity, Candidate identity, author policy, content/tree hashes and admission ids into `SkillCandidateLineage`. This lineage participates in the Shadow run id and is cross-checked across journal, report, resume and Review evidence; Skill bodies, host paths, hidden cases and provider identity are excluded. A clear win remains an inactive human-review Candidate. Generation publication and Web projection remain separate later gates.

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
