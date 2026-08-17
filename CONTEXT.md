# DeepSeek Harness EvoForge

DeepSeek Harness EvoForge is the open-source home for out-of-tree DSH extensions. Its flagship is evidence-driven, reversible agent evolution; software delivery is the first measurable proving ground.

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
The optional capability that turns repeated real-task outcomes into inactive candidate versions, evaluates them independently, and—only after offline value is proven—promotes or rejects them without blocking the originating session. Candidate search may reuse an external optimizer; EvoForge owns the DSH-native evaluation and release control plane.
_Avoid_: Self-rewriting agent, autonomous platform

**Learning Signal**:
A compact factual observation linked to an existing DSH session or artifact, such as an explicit correction, verification result, repeated failure class, human rating, or measured cost. A signal may trigger investigation but never proves improvement or authorizes a mutation by itself.
_Avoid_: Full transcript copy, model reflection

**Evolution Candidate**:
An inactive, versioned diff to an owned capability, accompanied by a falsifiable improvement claim and a trial plan. Candidate creation cannot alter any active session.
_Avoid_: Live patch, learned rule

**Trial**:
A paired comparison that runs the active version and one Evolution Candidate against the same representative cases and hard safety checks. Deterministic outcomes lead; model judgment is supplementary.
_Avoid_: Self-review, usage count

**Sealed Trial**:
A Trial whose executor can prove that a Candidate cannot read protected cases or host data, write outside its workspace, or use undeclared network/process capabilities. If that boundary cannot be enforced, the run is incomplete rather than an evaluation result.
_Avoid_: Best-effort sandbox, prompt-only isolation

**Promotion**:
An atomic selection of a proven candidate for future sessions. Clear improvements may promote automatically within configured authority; ambiguous results enter a separate review inbox, and executable or permission-expanding changes remain Protected Actions.
_Avoid_: Merge, in-place edit

**Capability Generation**:
An immutable set of active capability versions selected for a session. Existing sessions keep their generation; promotion affects only later sessions so behavior and the model-visible prefix do not drift mid-session.
_Avoid_: Latest files, mutable skill catalog

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
A compact Learning Signal observed from the final `complete_delivery` result and attributed to the Capability Generation pinned to that Session. It may trigger evaluation, but one outcome never proves regression or authorizes rollback.
_Avoid_: Transcript archive, rollback vote, delivery event platform

**Parent Generation Outcome Comparison**:
A host-only, read-only comparison of bounded delivery outcome counts attributed to one active Generation and its exact parent or native DSH. It is descriptive evidence for a human, never causal proof or release authority.
_Avoid_: A/B platform, automatic verdict, improvement percentage, task-normalized benchmark

**Explicit Feedback Signal**:
A retractable, reference-only projection of one current DSH message-feedback item that is negative and carries a non-blank human note. It stores the DSH feedback version and Session/message/Generation references, but never copies the note, note hash, cwd, Prompt, Transcript, or message body. It may justify later Candidate investigation; it never authorizes a mutation by itself.
_Avoid_: `/learn` command, feedback memory, transcript copy, automatic Skill edit

**Feedback Case Draft**:
A private, content-addressed, unscored sample created only after configuration-level copy authorization and either one explicit host action or an explicit Automatic Feedback Shadow deployment policy. It binds one still-current feedback version to one direct user text, one correction, one exact Generation Skill artifact, the whole materialized Skill content hash, and one Session-prefix hash; it excludes assistant responses, Tool output, Skill bodies, cwd, and full Transcript. It is not evaluator truth by itself.
_Avoid_: Automatic transcript harvesting, generic Case platform, Candidate, proof of improvement

**Evaluator Draft**:
A private, content-addressed and inactive proposal for one Case Pack, authored from an exact Feedback Case Draft and exact Skill version. Its generated files are review material only: they cannot execute, score a Candidate, become a Shadow Target, or authorize promotion until a separate human decision and sealed qualification succeed.
_Avoid_: Evaluator, trusted test, automatic grader, Evolution Candidate

**Qualified Case Pack**:
An immutable Evaluator Draft whose exact files were semantically approved by a human and whose evaluator then rejected the declared known-bad fixture and accepted the declared known-correction fixture inside the sealed runner. Qualification proves direction for that exact pack, not novel-case coverage or Candidate improvement.
_Avoid_: Proven evaluator, self-certified test, active Skill, promotion evidence

**Feedback-guided Shadow**:
A Shadow run that supplies one exact private Feedback Case Draft only to the proposer as untrusted search evidence, while an existing calibrated Case Pack remains the independent evaluator. The draft id and private resume path are durable; its input fields are not directly copied into Shadow evidence, although proposer output that echoes them remains durable Candidate evidence. One explicit host invocation or Automatic Feedback Shadow deployment policy authorizes the potentially paid provider request and disclosure.
_Avoid_: Generated evaluator, self-scoring Candidate, background paid proposal, feedback text in report/journal

**Shadow Target**:
A statically configured binding from a public operator-chosen id to one exact Skill name, calibrated Case Pack, and owned run root. A target makes an explicit Feedback Shadow Launch repeatable without exposing host paths or accepting browser-supplied execution paths.
_Avoid_: Workflow, arbitrary run request, dynamic evaluator

**Feedback Shadow Launch**:
A human-initiated Protected Action that turns one still-current Explicit Feedback Signal into a private draft and submits one configured Feedback-guided Shadow to native Jobs. It returns immediately to the caller and originating Session; it creates evidence for later review but does not prove improvement or authorize promotion.
_Avoid_: Automatic learning, synchronous Session reflection, paid resident retry

**Automatic Feedback Shadow**:
An opt-in deployment policy that lets one still-current explicit correction enter one statically configured, exact-hash Shadow Target without another per-signal command. It reuses the private Draft, independent evaluator, native Jobs, review, Retention, future-Session promotion, and rollback paths; ambiguity and uncertain paid effects remain asynchronous human work.
_Avoid_: Background reflection, automatic evaluator trust, live-session learning, self-grading

**Automatic Evolution Budget**:
A deployment-level UTC-day cap on durable automatic attempt reservations for one exact automatic Target. A reservation is consumed before a possibly paid author/launch boundary and survives crashes; it never limits an explicit human action or claims to be a billing ledger.
_Avoid_: Token scheduler, pricing engine, global quota service, model budget in Session

**Automatic Evaluator Draft**:
An opt-in deployment policy that lets one still-current explicit correction create one private, inactive Evaluator Draft for a unique static Target without a per-signal author command. It spends a durable daily attempt reservation first and leaves execution, qualification, Shadow, and Promotion under their existing separate authorities.
_Avoid_: Automatic evaluator trust, self-grading, synchronous Session reflection, default background spending

**Per-Skill Automatic Inflight Gate**:
A host-only preflight that lets P1.14/P1.16 reserve budget for a Skill only when its existing Evaluator Draft, Shadow journal, and Review Inbox contain no unresolved earlier automatic work. Deferred Signals stay in the existing Signal Store; explicit human actions remain available.
_Avoid_: Evolution queue, distributed lease, duplicate state store, limit on human actions

**Automatic Ambiguous Review Expiry**:
An opt-in host policy that gives an ambiguous Candidate created by Automatic Feedback Shadow a bounded review window. When a later Signal arrives after that window, the existing Review Inbox durably rejects the old Candidate while retaining all evidence, then lets the Per-Skill Automatic Inflight Gate reconsider the new Signal.
_Avoid_: Background TTL service, evidence deletion, expiration of human or promotable work

**Automatic Review Window Projection**:
A read-only host projection that tells Commands and Web when an Automatic Ambiguous Review Expiry becomes eligible and that only the next same-Skill automatic Signal can trigger rejection. It is derived from existing evidence and policy, not persisted or advanced by a timer.
_Avoid_: Countdown service, browser authority, notification queue, claim that eligibility already means rejection

**Human-approved Qualify-and-Shadow**:
One explicit host action taken after a human reviews an exact Evaluator Draft. It authorizes sealed qualification and one contingent paid Shadow: qualification failure stops before the proposer, while success delegates to the existing content-addressed Qualified Shadow launcher. It does not authorize Promotion.
_Avoid_: Automatic approval, qualify-and-promote, workflow engine, Session-visible review state

**Case Pack Calibration**:
A zero-model, host-only execution of the declared known-bad and known-correction fixtures through the same sealed evaluator used by Shadow. It proves evaluator direction before proposer spend; it does not prove coverage of novel failures. A complete Shadow performs this gate before requesting a Candidate and still uses four Trial executions total.
_Avoid_: Evaluator generation, cached trust forever, extra runtime service, model judge

**Retention Target**:
A static deployment policy binding one exact Skill to one independent prior Case Pack version for automatic Retention before clear-win promotion. It authorizes one potentially effectful evaluation attempt per exact Candidate; an uncertain attempt remains human-reviewed.
_Avoid_: Case registry, test scheduler, remembered consent

**Counterfactual Canary**:
An asynchronous replay of the original sealed Case Pack against the exact active Candidate and its immutable Git parent after a matching failed Delivery Outcome. It may roll back future-session selection only when calibration passes, the parent passes, the Candidate fails, and the active pointer is unchanged.
_Avoid_: Live traffic routing, failure counter, model reflection, automatic retry platform

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
