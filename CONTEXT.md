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
The optional `dsh-software-delivery` capability that takes a native DSH Goal through isolated editing, repository-defined verification, commit, and Draft PR. Git-specific behavior belongs here rather than in generic Goal infrastructure.
_Avoid_: Autonomous SDLC platform, coding operating system

**Completion Check**:
A small, inspectable result used before a Goal is allowed to complete. It reports `passed`, `failed`, or `unknown`, a concise explanation, and optional artifact references. It does not introduce a universal evidence ontology.
_Avoid_: Agent self-certification, evaluator framework

**Cache Contract**:
The suite-wide rule that model-visible instructions, tools, schemas, and ordering remain stable within a DSH session. Cache impact is checked at the complete composition surface when that surface changes; plugins with no model-visible effect add no separate burden.
_Avoid_: Runtime cache plugin, per-plugin bureaucracy

**Protected Action**:
An operation that remains behind native DSH approval or an explicitly configured deployment rule. Merge, release, production deployment, secret access, paid operations, and irreversible external actions are Protected Actions.
_Avoid_: Policy platform, remembered consent

## Rules

- Every published capability must be a Feature Extension with a user-visible outcome. A plugin whose primary value is repairing or masking a Core Defect is out of scope.
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
