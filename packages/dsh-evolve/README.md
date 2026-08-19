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

Delivery Outcomes are projected only from a native DSH Session's source-sequence-linked `complete_delivery` call/result pair, after DSH's awaited Session durability checkpoint succeeds. Cold Session start replays persisted pairs idempotently into the bounded StorageDomain without rerunning the Tool or any external effect; live-only `tools/result` notifications have no evidence authority.

When DSH's official `tokenUsage` and `sessionStats` units are present, an Outcome may also carry `GoalExecutionMetrics`. The Host subtracts cumulative projection cuts only across turns whose first admitted message belongs to the exact then-active Goal revision, with the immutable delivery result event as cutoff. Manual/other/stale/ambiguous turns and missing or regressing projections abstain. Provider token/cache/timing facts remain host-only and non-causal; monetary cost is explicitly unavailable when DSH has no provider price projection.

`selfDiscoveryPolicies` optionally authorizes `{ id, workspaceId, runRoot, maxAttemptsPerUtcDay }`. It deliberately has no `skill`, source, path, Agent, workflow, or route selector. The Skill identity is derived from the internal Opportunity. A native DSH Job receives only bounded Goal/Gap evidence and asks the configured author model for one instruction-only whole-Skill bundle containing root `SKILL.md` and optional one-level `references/*.md`. The Host validates canonical paths, identity, size, regular-file-only content, and no scripts; it hashes model/input/artifact/tree provenance, stores the bundle privately, and emits an inactive/quarantined/unevaluated/never-executed Candidate. One reconciliation schedules at most one Job. A crash after a possibly paid request becomes `uncertain` and is never blindly retried.

The product does not provide external Skill search, package acquisition, marketplace access, download, or import. DSH Web projects the exact `Capability Gap → Skill Opportunity → Candidate` flow plus associated correction/outcome counts, bounded opaque references, the no-causality disclaimer, phase, cost, digests, and governance state. Candidate bodies, correction text, Session ids, and private paths never cross the adapter. Ecosystem research is limited to design-time decisions and frozen benchmarks.

`candidateEvaluationPolicies` optionally authorizes only `{ id, workspaceId, governanceRoot, runRoot }`. It has no Skill, baseline, Case Pack, source, or Candidate selector. For a currently discovered internal Opportunity, the Host resolves `governanceRoot/envelopes/<opportunity-id>/manifest.json`; the v2 manifest binds the exact Workspace, Opportunity snapshot, a `capability-absent` subject descriptor, deterministic admission Case Pack hash, and a different assembled holdout Case Pack hash. The absent baseline may contain only `subject.json`, never a placeholder `SKILL.md`. Directory identity, content drift, symlinks, root overlap, Opportunity mismatch, and admission/holdout reuse fail closed. Missing current evidence abstains.

One content-addressed Skill Evaluation Envelope now drives both phases. A native DSH Job runs the zero-model deterministic admission without executing Candidate code; only absent-baseline-fail/candidate-pass becomes `qualified-for-shadow`. The durable admission then re-resolves the same current Opportunity and Envelope before handing the exact Candidate tree and the Envelope's independent `dshAssembled: true` holdout to native Shadow Jobs. The assembled Trial leaves the target Skill uninstalled on the baseline side and installs it only for the Candidate. `SkillCandidateLineage` records the Envelope id rather than an operator target. No evaluation result installs, activates, or auto-promotes a Candidate.

After explicit approval, a capability-absent Candidate can now publish an inactive `skill-bundle` Generation artifact without a configured Git source. The Host reassembles and verifies the canonical whole-Skill archive against the sealed tree and lineage digest; Storage verifies it again, and the DSH Skill Provider materializes a read-only content-addressed tree for future Sessions only. Existing Sessions remain pinned, and root rollback returns later Sessions to native DSH. This is not external Skill acquisition: the artifact comes only from the internally authored Candidate and performs no network or marketplace lookup. Evaluation Envelope authoring and capability-absent Retention/canary remain incomplete, so this path is not automatically promoted or release-ready.

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
