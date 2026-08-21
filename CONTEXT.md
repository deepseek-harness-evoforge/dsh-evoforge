# DeepSeek Harness EvoForge

DeepSeek Harness EvoForge is the open-source home for out-of-tree DSH extensions. Its flagship is evidence-driven, reversible agent evolution; software delivery is the first measurable proving ground.

## Product authority

**DSH-native out-of-tree plugin suite**:
The only supported product shape. Every released EvoForge package is installed as an official DSH Bundle/profile layer and executes inside the existing DSH Host, Agent, Session, Goal, Approval, Storage, Jobs, Skill, Tool, and Cordis lifecycle.
_Avoid_: Standalone EvoForge application, alternate Runtime, companion daemon, required EvoForge CLI

**DSH Authority**:
The single source of truth for Agent identity, Session history, Goal state, permissions, persistence, jobs, and lifecycle. EvoForge may keep bounded plugin-owned domain records inside DSH Storage, but may not reinterpret them as a second Session, Goal, scheduler, or control plane.
_Avoid_: Mirrored authority, side database, parallel agent loop

**Assembled Plugin Contract**:
The release gate that packs artifacts, installs them with the target DSH plugin command into an isolated shipped profile, inspects the effective config, boots the Host, exercises a capability from a real DSH Agent/Session/Goal, unloads/removes the packages, and proves native data and startup remain intact.
_Avoid_: Source import test, repository-only test, CLI smoke test

## Language

**EvoForge**:
The public project hosted by the GitHub organization `deepseek-harness-evoforge`. It contains DSH extension design and development, whether a capability lives in the shared suite repository or a justified standalone repository.
_Avoid_: DSH fork, alternate harness, one mandatory monorepo

**EvoForge Suite**:
The `dsh-evoforge` repository containing capabilities that share DSH integration, release cadence, tests, and user installation. Published plugins use a `dsh-*` name. A capability moves to its own repository only when it has an independent lifecycle or trust boundary.
_Avoid_: Platform kernel, plugin marketplace

**EvoForge Plugin**:
An independently useful, removable out-of-tree DSH capability with a user-visible outcome and an explicit cache, permission, persistence, and rollback contract.
_Avoid_: Internal pipeline stage, DSH bug patch

**Feature Extension**:
An independently useful, removable capability that remains valuable when DSH itself is working exactly as documented. It composes supported DSH seams into a new user outcome rather than correcting their implementation.
_Avoid_: Bug workaround, core patch

**Hermes Replacement Target**:
The measurable outcome target that DSH plus EvoForge should cover reliable software delivery, persistent personal assistance, channels, schedules, memory/skills, human control, and evidence-driven evolution better than Hermes for selected workflows. It is not a promise to clone every Hermes component.
_Avoid_: Perfect agent, feature-for-feature rewrite

**Local Continuity**:
The first availability milestone: one host process may restart or crash without losing authoritative progress, duplicating protected effects, or corrupting active capability selection.
_Avoid_: High availability, distributed failover

**Authorized Goal Continuation**:
An opt-in deployment policy that lets an explicitly named persistent Session continue its still-active native Goal after cold resume, within that Goal's existing limits and permissions.
_Avoid_: Mission, automatic Session discovery, unlimited retry

**Resident Service**:
A user-level OS service registration that starts one exact DSH CLI/profile at login and restarts it after process exit. The generated unit and launchd/systemd are authoritative; the adapter itself exits after plan, apply, status, or remove.
_Avoid_: DSH daemon plugin, supervisor database, high availability

**Runtime Readiness Report**:
A point-in-time, read-only answer to whether the capabilities an operator explicitly requires are currently usable. Its outcome is `ready`, `not-ready`, or `unknown`; it names concrete blockers and next actions without repairing them, retaining health history, or becoming a second lifecycle authority.
_Avoid_: Invariant result, plugin inventory, uptime monitor, auto-repair plan

**Feishu Content Readiness**:
A point-in-time Host conclusion for one exact DSH Session that distinguishes configured Feishu content permissions, the Session's current native Tool/Approval availability, and future-Session-only activation. Platform resource authorization remains explicitly unverified until an approved real read.
_Avoid_: Configured means authorized, platform permission probe, Gateway content capability, current-Session schema rewrite

**DSH Gateway**:
The removable Host module that normalizes exact external channel identities, binds them to native DSH Workspace/Session ownership, and governs transport-neutral routing, delivery intent, deduplication, rate limits, and health. Channel Adapters own platform protocols and credentials; DSH remains authoritative for Agent, Goal, Schedule, Approval, permissions, and persistence.
_Avoid_: Channel Router, bot host, second Agent Runtime, dynamic workflow gateway, platform SDK wrapper

**Native Channel Image**:
An Adapter-owned external image resource that is downloaded through the platform's exact message-resource API, batch-validated and durably saved by the DSH AttachmentStore, then crosses DSH Gateway only as an immutable `ImageAttachmentRef`. The external resource key is transport input, never Session content.
_Avoid_: external URL/key in Session, base64 message block, generic file disguised as image, Adapter-owned attachment store

**Transport Observation**:
A redacted, point-in-time Adapter report registered with DSH Gateway for exact owned routes: transport kind, `connecting/ready/degraded/stopping`, observation time, and optional connection/activity/error times. The Adapter still owns protocol and recovery; the observation contains no account, endpoint, content, error text, external id, or credential.
_Avoid_: transport runtime, connection manager, error log, heartbeat daemon

**Uncertain External Effect**:
An effect whose durable intent exists and may have reached an external service, but whose result was not durably recorded before interruption. Recovery must not claim success or retry automatically when repetition could cost money or duplicate a user-visible action.
_Avoid_: Failed request, safe retry, exactly-once

**Shadow Supervisor**:
An optional DSH-lifecycle worker that scans explicitly configured run roots and resumes only durable, network-free Candidate/Trial phases. The run journal is authoritative; native DSH Jobs provides process-local observation and cancellation only.
_Avoid_: Daemon manager, durable scheduler, proposal retry loop

**High Availability**:
A later, measured service property requiring failure-domain redundancy and an explicit availability objective. A restartable single-machine daemon is reliable but is not described as highly available.
_Avoid_: Crash recovery, long-running process

**Core Defect**:
A case where native DSH behavior violates its documented contract or fails inside a DSH-owned capability. It belongs in the DSH community with a minimal reproduction; EvoForge may diagnose or report it but does not ship a shadow implementation.
_Avoid_: Plugin opportunity, compatibility feature

**Evolution Loop**:
The optional capability that turns DSH-owned Goals, failures, corrections, outcomes, reuse, and retention evidence into inactive candidate versions, evaluates them independently, and—only after offline value is proven—promotes or rejects them without blocking the originating session. It contains a bounded Fast Evolution Loop and an evidence-accumulating Slow Evolution Loop; runtime external search is not self-discovery.
_Avoid_: Self-rewriting agent, autonomous platform

**Capability Map**:
A host-visible inventory of the exact capabilities available to one DSH Workspace, including stable identity, source, scope, version, verification state, and selected Generation. It explains what may be routed without becoming a user-facing menu or a second Skill registry.
_Avoid_: Startup questionnaire, workflow catalog, mutable prompt inventory

**Capability Gap**:
A falsifiable statement that an active Goal needs a capability not supplied by any verified, applicable Skill or Tool in the current Capability Map. A failed attempt alone is not a gap until routing, permissions, configuration, and existing capability applicability have been checked.
_Avoid_: Generic failure, model uncertainty, excuse to generate a new Skill

**Self-Discovery**:
The host-side activity that derives a reusable Skill Opportunity only from attributable DSH-owned Goal experience, then authors an inactive Evolution Candidate for independent evaluation. Inspecting already installed capabilities is normal Goal execution; external search, import, download, marketplace access, and design-time research are not Self-Discovery.
_Avoid_: Skill Discovery, capability acquisition, user menu, runtime marketplace search, external Skill import, retry-as-learning

**Skill Opportunity**:
A deterministic, Workspace-scoped conclusion that repeated capability gaps across at least two distinct native DSH Goals identify reusable demand. Its Skill name comes from verified Gap evidence, never an operator-configured authoring target; same-Goal retries and weak evidence abstain. It does not itself authorize paid authoring, install, activation, or release.
_Avoid_: Gap cluster, search result, user-selected Skill, authoring permission, Candidate readiness

**Goal Outcome Context Association**:
A conservative, non-causal link from one compact Delivery Outcome to one stable native Goal identity whose known Gap evidence names exactly one Skill. The Outcome must follow a matching Gap in time and may carry the same or a later native Goal revision; an older revision, another Skill, or another Workspace abstains. This context never contributes another Goal to Opportunity eligibility or proves rework, reuse, or improvement.
_Avoid_: Exact-revision equality, retry evidence, causal attribution, success vote

**Exact Skill Correction Attribution**:
A fail-closed, non-causal link from one Explicit Feedback Signal to the target assistant turn's only successful durable Skill invocation, the exact hash of the invocation content blocks the model saw, and the native Goal identity folded through that turn. Missing or ambiguous turns, invocations, content, or Goals abstain; same-Session Gap proximity and same-name Skill identity are not attribution. Legacy records without the content hash remain readable but are ineligible for Existing Skill Improvement Opportunity discovery.
_Avoid_: Same-Session inference, Gap proximity, Skill blame, causal proof

**Exact Skill Use**:
A compact durable fact that one exact native Skill name and model-visible content version was successfully invoked while one native Goal and one Session-pinned Generation were current. It contains identity and attribution only, never Skill content, task success, value, or mutation authority.
_Avoid_: Skill popularity, model-reported use, live Tool event, success vote

**Cross-Goal Skill Reuse**:
A Workspace aggregate formed only when Exact Skill Uses for the same Skill name, content hash, and Generation span at least two distinct native Goals. It proves repeated use across Goals, not correctness, retention, improvement, or permission to author or promote a Candidate.
_Avoid_: Invocation count, same-Goal retry, name-only reuse, improvement claim

**Exact Skill Outcome Context**:
A non-causal association between one exact cross-Goal Skill version and later durable Delivery Outcomes from the same native Session, Goal, and Generation. It preserves repeated attempts, recovered delivery, missing outcomes, ambiguous latest facts, and measured cost/latency without claiming the Skill caused any result.
_Avoid_: Skill success rate, effect estimate, rework attribution, improvement proof, promotion vote

**Between-Attempt Work Context**:
A non-causal delta between adjacent, strictly ordered Delivery Outcome metric snapshots inside one Exact Skill Outcome Context. Missing, tied, cross-Goal, or regressing snapshots abstain; the delta is observed additional work, not proof of rework or Skill effect.
_Avoid_: Rework cost, retry penalty, Skill efficiency, causal savings

**Existing Skill Improvement Opportunity**:
A deterministic, Workspace-scoped investigation created only when one exact Skill name and invocation-content hash receives explicit negative corrections across at least two distinct native Goals. Duplicate signals, same-Goal retries, legacy no-hash attribution, and same-name different-content versions do not merge. It is not a Skill Opportunity for missing capability and never grants authoring, evaluation, installation, activation, or release authority; a separate Existing Skill Baseline Qualification must prove that every exact correction invocation used the same complete package.
_Avoid_: Name-only clustering, correction-as-causality, capability-absent baseline, partial Skill snapshot, Candidate permission

**Installed Skill Baseline Bundle**:
A Host-sealed, content-addressed archive of every regular file inside the independent directory package used by one exact native DSH Skill invocation. The Host re-loads the same scoped definition, matches the official rendered invocation content, scans the package twice, rejects ambiguous boundaries, links, executables, special files and drift, then records an immutable Session/invocation reference. It has no release authority and is evidence for a future existing-Skill paired baseline, not a Candidate or active Generation.
_Avoid_: Invocation hash as package, name-only snapshot, flat Markdown guess, runtime acquisition, current-Session rewrite

**Existing Skill Baseline Qualification**:
A Host-owned, content-addressed proof that every exact correction invocation in one current Existing Skill Improvement Opportunity resolves through its immutable Session/invocation reference to the same revalidated Installed Skill Baseline Bundle. Missing references wait; evidence drift, corruption, attribution mismatch, or multiple Bundle identities invalidate the qualification. Success permits only protected existing-Skill authoring and has no Candidate, install, activation, or release authority.
_Avoid_: First-baseline wins, current-directory reconstruction, rendered-content equivalence, proposer-selected baseline, implicit Candidate

**Existing Skill Evaluation Evidence Seal**:
A Host-owned, content-addressed snapshot of current explicit correction text plus its exact durable Goal and user-request context, read only through official DSH Message Feedback and Session Persistence services after one Existing Skill Baseline Qualification succeeds. At least four distinct Goals are split before Candidate authoring into authoring, admission, and holdout, with an additional retention partition from a fifth Goal; the proposer receives only authoring cases. The seal has no Candidate, install, activation, or release authority.
_Avoid_: Copying correction text into reference-only Signals, proposer-visible holdout, private DSH table reads, same-Goal retries, model-invented correction

**Existing Skill Holdout Governance**:
A Candidate-blind governance binding formed before proposer execution from one exact installed baseline and the protected holdout partition. It owns a calibrated assembled `skill-tree` Case Pack and model-separation evidence but has no Candidate effect verdict or release authority.
_Avoid_: Candidate-authored evaluator, capability-absent Envelope, effect verdict, external Skill acquisition

**Fast Evolution Loop**:
A bounded online loop that attributes an explicit correction, verified outcome, repeated failure, or measured cost to the exact Session Generation and records an inactive signal, gap, or small candidate for later evaluation. It never rewrites an active capability or publishes from the originating Session.
_Avoid_: Learn-once activation, synchronous reflection, retry-as-learning

**Slow Evolution Loop**:
An offline loop that aggregates evidence across DSH Goals, authors whole-Skill Candidates from that internal evidence, runs isolated paired and holdout evaluation, checks transfer and regressions, and makes a retained release decision for future Sessions. It may abstain when evidence is weak or conflicting.
_Avoid_: Nightly prompt rewrite, self-scoring batch job, greedy latest-wins

**Evaluation Governance Plane**:
The independent authority that owns protected cases, gold expectations, evaluator policy, hard gates, comparison results, and release eligibility. A Candidate and its proposer cannot read hidden cases or mutate this plane; boundary failure makes a Trial incomplete rather than passed.
_Avoid_: Candidate-authored judge, writable final-test, model confidence gate

**Skill Evaluation Evidence Seal**:
A content-addressed, governance-owned partition made before Candidate authoring from one exact Skill Opportunity snapshot. At least four distinct native Goals are required: an author sees only the bounded authoring subset, while independent admission and holdout subsets remain protected. When a fifth or later independent Goal exists, one separately ranked sample is reserved exclusively for Retention governance; fewer or inconsistent samples abstain without a model call.
_Avoid_: Random train/test split, Candidate-authored cases, post-hoc evaluator target, external Skill research

**Skill Evaluation Envelope**:
A content-addressed, governance-owned binding from one exact current Skill Opportunity and Skill Evaluation Evidence Seal to a `capability-absent` subject descriptor, calibrated deterministic-filesystem admission Case Pack, independent assembled holdout Case Pack, optional independent assembled Retention Case Pack, and isolated run roots. A four-Goal seal produces the backward-compatible v4 form; a seal with a reserved Retention sample produces v5. Admission never starts DSH, executes Candidate content, calls a model, or uses network; only a qualified exact Candidate enters assembled evaluation. Its identity includes every protected-sample author input and the governance author identity; the path is scoped by both Opportunity and evidence seal so later Goal evidence cannot silently retarget an older Candidate. Because an Opportunity starts from an exact native-catalog miss, its baseline contains no `SKILL.md`; a placeholder Skill is forbidden. Deployment policy selects only the Workspace governance, pinned DSH revision, run roots, and attempt budget; it cannot select the Skill, baseline, Case Pack, or Candidate direction. Any author-input mismatch, Opportunity mismatch, content drift, reused protected Case Pack, symlink, extra baseline file, or root overlap fails closed.
_Avoid_: Evaluation Target, operator-selected Skill, Candidate-authored test plan, mutable Case Pack, release authority

**Governance Case Pack Authoring**:
The candidate-independent activity that turns the protected subsets of one Skill Evaluation Evidence Seal into separately authored, zero-proposer-calibrated Case Packs before Candidate evaluation. The admission author must produce a deterministic filesystem evaluator; holdout and, when present, Retention authors must produce independent assembled DSH evaluators. Each author receives only its own protected sample and no Candidate artifact; a dispatched but unobserved paid result becomes uncertain rather than being retried. A bounded read-only governance projection may expose phase, roles present, aggregate usage, retry time, and failure class, but never protected content, evaluator source, provider identity, or host path.
_Avoid_: Candidate self-test, proposer-authored judge, operator-selected evaluation target, unsealed evaluator generation

**Capability-Absent Baseline**:
The exact DSH comparison subject for a missing-Skill Opportunity: the target Skill is not installed in the baseline profile and the exact whole-Skill Candidate is installed only in the Candidate profile. Both sides use the same DSH revision, task path, evaluator, permissions, and budget; only target Skill presence/body may differ in normalized composition.
_Avoid_: No-op Skill, placeholder `SKILL.md`, old-Skill baseline for a missing capability

**Capability-Absent Retention**:
An independent prior-case replay that continues the same native Jobs task after a promotable completed Shadow and compares its exact capability-absent subject with the exact internally authored whole-Skill Candidate. Its Case Pack comes only from the Candidate-invisible fifth-Goal Envelope v5 partition; v4 abstains. The absent side must still contain only its bound `subject.json`; Admission, Envelope, Shadow, Candidate tree, Skill identity, lineage, DSH revision, budgets, roots, Case Pack hashes, and non-target DSH composition are revalidated. A content-addressed locked run records an idempotent retained, regressed, or incomplete verdict with zero proposer calls and no release authority.
_Avoid_: Placeholder baseline, Git first-parent, Candidate reconstruction, self-judged retention, automatic promotion

**Assembled Evaluation Projection**:
A bounded, browser-safe Host join of one `ReviewInbox`-validated assembled Shadow and an optional `InternalSkillRetention`-validated durable run. The join requires exact Workspace, Skill, Candidate lineage, Admission, Envelope, Shadow run, baseline tree, and Candidate tree agreement; mismatches become warnings and remain unpaired. It contains no Host path, protected case content, evaluator source, provider identity, Goal content, proposal content, release decision, or runtime authority.
_Avoid_: Evaluation database, browser judge, path projection, best-effort lineage join, promotion gate

**Verified Release Tag**:
An annotated semantic Git tag on `main` that identifies a repository state whose declared core capability set passed its frozen release gates. It is not an Evolution Candidate version, does not replace content-addressed runtime Generations, and is never created merely because code was committed.
_Avoid_: Feature branch, progress marker, unverified release label

**Evolution Attention**:
A bounded host-only notice that an actionable internal Candidate or governance decision exists, delivered through an already authorized adapter while the originating Session continues. The notice points to the authoritative control command and never grants approval itself.
_Avoid_: Notification platform, inline approval, dynamic prompt injection, second workflow engine

**Evolution Attention Bridge**:
The removable `dsh-evolve-attention` composition plugin that projects Evolution Attention onto exact Workspace routes governed by `dsh-gateway` and delivered by `dsh-telegram` and/or `dsh-feishu`. It validates route-to-Workspace ownership and creates no timer, route configuration, public provider SPI, or second evolution state.
_Avoid_: Generic notifier, channel routing core, channel approval bot

**GitHub Review Follow-up**:
A bounded, content-addressed follow-up created when an allowlisted reviewer requests changes on the exact Draft PR head produced by a Delivery Outcome. The review is trusted only to trigger attention; its text remains untrusted input and can never authorize a Protected Action.
_Avoid_: Autonomous merge, trusted review instruction, webhook workflow, code-review platform

**Learning Signal**:
A compact factual observation linked to an existing DSH session or artifact, such as an explicit correction, verification result, repeated failure class, human rating, or measured cost. A signal may trigger investigation but never proves improvement or authorizes a mutation by itself.
_Avoid_: Full transcript copy, model reflection

**Evolution Candidate**:
An inactive, versioned diff owned by exactly one registered DSH Workspace and bound to the exact pre-authoring Skill Evaluation Evidence Seal that supplied its visible evidence, accompanied by a falsifiable improvement claim and a trial plan. Candidate creation cannot alter any active session or be reviewed, promoted, or reused from another Workspace.
_Avoid_: Live patch, learned rule

**Existing Skill Improvement Candidate**:
An inactive, quarantined, content-addressed complete Skill tree derived from one exact sealed installed-Skill baseline and its protected internal correction evidence, whose identity also binds the exact pre-authoring Evaluation Envelope containing Holdout and, with a fifth independent Goal, a separately authored Retention Case Pack. The author may change only bounded instruction text while the Host preserves every untouched byte and rejects identity, code, binary, path, permission, or license drift; the Candidate remains unevaluated, never executed, and without install, activation, or release authority.
_Avoid_: Runtime self-edit, partial patch artifact, downloaded Skill, capability-absent Candidate, approved improvement

**Existing Skill Candidate-blind Evaluation Envelope**:
A content-addressed, governance-owned binding created before an Existing Skill Improvement Candidate author runs. It binds the exact baseline, protected correction Evidence Seal, governance identity, calibrated assembled Holdout and optional independently authored Retention Case Pack; each governance call sees only its own protected Goal, a four-Goal Envelope cannot claim Retention, and a five-Goal Envelope binds both hashes into the Candidate identity.
_Avoid_: Post-Candidate test selection, combined proposer/judge prompt, reusable lookup tuple, Holdout result as Retention

**Existing Skill Paired Structural Admission**:
A host-only, content-addressed gate that re-resolves one exact Installed Skill Baseline Bundle, materializes its exact Existing Skill Improvement Candidate beside it, consumes the governance-only admission partition, and revalidates every archive, tree, declared change, preserved byte, and protected identity. Passing means only `qualified-for-holdout`: neither tree is executed, no effect improvement is claimed, and no release authority is created. It is deliberately separate from the capability-absent Skill Evaluation Envelope.
_Avoid_: Existing Skill as capability-absent, structural check as effect win, proposer-visible admission, reconstructed baseline, implicit promotion

**Existing Skill Exact Paired Holdout**:
A Host-owned, content-addressed effect evaluation that accepts only one exact `qualified-for-holdout` Admission, re-resolves its immutable installed baseline, exact whole-tree Candidate and the exact Candidate-blind Holdout Envelope already bound into that Candidate's identity, then executes both complete `skill-tree` subjects in the same assembled DSH Trial. It may classify only `improved`, `ambiguous`, `not-improved`, or `regressed` after calibration, assembled composition, input integrity and fixed-trial-count gates all pass; interruption after paid dispatch becomes uncertain and is never blindly retried. Its verdict is evidence for later Retention and has no install, activation, promotion, rollback, or release authority.
_Avoid_: Structural pass as effect win, Candidate self-test, capability-absent baseline, retrying uncertain paid work, holdout verdict as promotion

**Existing Skill Exact Retention**:
A Host-owned, content-addressed paired evaluation that accepts only one authoritative `improved` Existing Skill Exact Paired Holdout and the same Candidate's independent pre-Candidate Retention partition, then replays the exact baseline and Candidate trees under the same assembled integrity gates. Four-Goal Envelopes abstain; only `fail/pass` is retained, and every result has no release authority.
_Avoid_: Holdout replay, post-Candidate test selection, promotion verdict, missing-Skill prior-case Retention

**Evolution Candidate Lineage**:
The bounded, host-derived identity that follows one exact internally authored whole-Skill Candidate from its Skill Opportunity through one Skill Evaluation Envelope, admission, Shadow, Retention, review, and immutable Capability Generation. It binds internal evidence, Candidate version/content/tree, evaluation-envelope identity, independent evaluation, and release decisions while excluding Skill bodies, host paths, hidden cases, and proposer-private state.
_Avoid_: Discovered Skill Lineage, external source provenance, copied Candidate record, private evidence dump, self-asserted lineage

**Trial**:
A paired comparison that runs the active version and one Evolution Candidate against the same representative cases and hard safety checks. Deterministic outcomes lead; model judgment is supplementary.
_Avoid_: Self-review, usage count

**Sealed Trial**:
A Trial whose executor can prove that a Candidate cannot read protected cases or host data, write outside its workspace, or use undeclared network/process capabilities. If that boundary cannot be enforced, the run is incomplete rather than an evaluation result.
_Avoid_: Best-effort sandbox, prompt-only isolation

**Promotion**:
An atomic selection of an eligible inactive Generation for future sessions. Clear improvements may promote automatically within configured authority; ambiguous results enter a separate review inbox, and executable or permission-expanding changes remain Protected Actions.
_Avoid_: Merge, in-place edit

**Future-Session Promotion Eligibility**:
A Host-governed conclusion that binds one approved inactive Generation to its exact promotable Shadow and independently retained Candidate lineage. Missing, ambiguous, prepared, regressed, incomplete, or inconsistent evidence cannot change the active selection; eligibility never changes an already pinned Session.
_Avoid_: Retention release authority, approved-means-active, Web-only validation

**Capability Generation**:
An immutable, content-addressed set of capability versions owned by exactly one registered DSH Workspace and selected for one of its sessions. Existing sessions keep their generation; promotion affects only later sessions in that same Workspace, so behavior and the model-visible prefix do not drift mid-session.
_Avoid_: Latest files, mutable skill catalog

**Skill Bundle Generation Artifact**:
The immutable Capability Generation artifact for a brand-new internally authored whole-Skill Candidate. It embeds the Host-canonical archive plus artifact digest, tree hash, and exact Candidate lineage, and is loaded by a read-only DSH Skill Provider without a configured Git source, network lookup, marketplace, or runtime acquisition. It remains inactive until the normal Generation promotion boundary and affects only future Sessions.
_Avoid_: Downloaded Skill, Git branch, external repository dependency, mutable Candidate folder

**Evolution Workspace**:
The registered DSH Workspace whose stable native id is the mandatory ownership boundary for a Generation, Candidate, Case Pack, feedback signal, budget reservation, review decision, promotion, and rollback.
_Avoid_: Global evolution namespace, cwd prefix, channel account

**Software Delivery Pack**:
The optional `dsh-software-delivery` capability that takes a native DSH Goal through isolated editing, repository-defined verification, commit, and Draft PR. A host may also require at least one green remote check on the exact Draft PR head before this path completes the Goal. Git-specific behavior belongs here rather than in generic Goal infrastructure.
_Avoid_: Autonomous SDLC platform, coding operating system

**Completion Check**:
A small, inspectable result used before a Goal is allowed to complete. It reports `passed`, `failed`, or `unknown`, a concise explanation, and optional artifact references. Local checks and an opt-in exact-head remote-check read use the same three-state semantics; pending, missing, unreadable, or wrong-head evidence is `unknown`, never an implicit pass. It does not introduce a universal evidence ontology, watcher, or second state machine.
_Avoid_: Agent self-certification, evaluator framework

**Bounded Draft Check Wait**:
An opt-in host policy that keeps one active `complete_delivery` Tool call open for a fixed deadline while it read-only polls the same Draft PR's exact-head check rollup. It performs no model call, repeats no PR creation, stops on failure/head drift/cancellation, and stores no CI state; a later call recovers from GitHub facts.
_Avoid_: CI daemon, background watcher, unbounded wait, workflow scheduler

**Delivery Outcome**:
A compact Learning Signal projected from one source-linked `complete_delivery` call/result in the native DSH Session log and attributed to the Capability Generation pinned to that Session. Projection first crosses DSH's awaited Session durability checkpoint; a later cold Session start can replay a persisted pair idempotently without rerunning the Tool or any external effect. It may trigger evaluation, but one outcome never proves regression or authorizes rollback.
_Avoid_: Live-only Tool event, external-effect replay, transcript archive, rollback vote, delivery event platform

**Goal Execution Metrics**:
Bounded, non-causal facts describing provider-reported token/cache use and elapsed execution time for work unambiguously owned by one native Goal and captured by a Delivery Outcome. Incomplete ownership or measurement abstains; inferred prices are excluded, and the facts never authorize authoring, evaluation, promotion, or rollback.
_Avoid_: Transcript parser, token estimator, invented monetary price, cross-Goal average, optimization reward

**Parent Generation Outcome Comparison**:
A host-only, read-only comparison of bounded delivery outcome counts attributed to one active Generation and its exact parent or native DSH. It is descriptive evidence for a human, never causal proof or release authority.
_Avoid_: A/B platform, automatic verdict, improvement percentage, task-normalized benchmark

**Explicit Feedback Signal**:
A retractable, reference-only projection owned by the same Evolution Workspace as one current negative DSH message-feedback item with a non-blank human note. It may carry Exact Skill Correction Attribution, but never copies the note, note hash, cwd, Prompt, Transcript, message body, or Skill body; it may justify investigation but never authorizes mutation.
_Avoid_: `/learn` command, feedback memory, transcript copy, automatic Skill edit

**Case Pack Calibration**:
A zero-proposer, host-only execution of the declared known-bad and known-correction fixtures through the exact evaluator used by Admission, Shadow, or Retention. It proves evaluator direction for one content-addressed Case Pack; it does not prove novel-case coverage or Candidate value. Admission uses a deterministic filesystem evaluator, while holdout and Retention use their separate assembled DSH evaluators.
_Avoid_: Candidate-authored evaluator, cached trust forever, extra runtime service, model judge

**Counterfactual Canary**:
A content-addressed Host-owned replay triggered by a failed durable Outcome attributed to the exact active internal Candidate Generation. It compares the immutable pre-Candidate subject with that Candidate under sealed governance and emits only `keep`, `review`, or `rollback-eligible` evidence after calibration, integrity, and active-pointer-stability gates; it never changes a Generation pointer or an existing Session.
_Avoid_: Git parent inference, live traffic routing, failure counter, model reflection, rollback executor, automatic retry platform

**Future-Session Rollback Gate**:
The sole Host mutation seam that moves one Workspace from its exact active Generation to that Generation's parent or native DSH for future Sessions. Explicit human recovery is always available; an evidence-driven request must revalidate one exact `rollback-eligible` Counterfactual Canary. Both paths use an expected-active compare inside the serialized Store write so a concurrent pointer change fails without rolling back another Generation.
_Avoid_: Canary-owned pointer write, browser policy, current-Session mutation, external-effect undo, unchecked read-then-write rollback

**Cache Contract**:
The suite-wide rule that model-visible instructions, tools, schemas, and ordering remain stable within a DSH session. Cache impact is checked at the complete composition surface when that surface changes; plugins with no model-visible effect add no separate burden.
_Avoid_: Runtime cache plugin, per-plugin bureaucracy

**Protected Action**:
An operation that remains behind native DSH approval or an explicitly configured deployment rule. Merge, release, production deployment, secret access, paid operations, and irreversible external actions are Protected Actions.
_Avoid_: Policy platform, remembered consent

## Rules

- Every published capability must be a Feature Extension with a user-visible outcome. A plugin whose primary value is repairing or masking a Core Defect is out of scope.
- Runtime diagnostics may explain current composition failures, but must leave DSH lifecycle and repair authority unchanged.
- Reproduce Core Defects against native DSH, report them upstream, and remove them from the EvoForge roadmap. Diagnostics and version gating are allowed; monkey patches and shadow core implementations are not.
- Extend native DSH Goal, Session, Approval, Permission Preset, Storage, Jobs, Schedule, Workflow, FS, Shell, Skills, and Cordis lifecycle before adding a new seam.
- No Mission, Work Item DAG, parallel event-sourcing platform, Effect Broker, distributed lease, or unmeasured in-place self-rewrite.
- Software delivery starts with user trust: isolate changes, follow repository instructions, run repository-defined checks, show the diff, and keep protected actions human-controlled.
- Preserve the Cache Contract within correctness and safety constraints. Dynamic state is appended or fetched through existing stable tools; it does not rewrite the reusable prefix.
- A new public seam requires at least two real adapters. Until then, keep variation private to the implementing plugin.
- Learning Signals and Evolution Candidates never block or mutate the originating session.
- Prove Candidate evaluation in an offline Shadow experiment before building live Generation binding or automatic promotion.
- Promotion requires a Trial against the active baseline, an immutable Capability Generation, and a tested rollback path. Activity, reuse, or a model's confidence alone never demonstrates improvement.
- Instruction-only changes may auto-promote after clear measured improvement. Executable code, permissions, secrets, deployment behavior, and external side effects remain Protected Actions.
- Capability rollback restores instructions for future sessions; it never claims to undo an external side effect that already happened.
