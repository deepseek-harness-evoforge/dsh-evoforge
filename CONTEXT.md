# EvoForge domain glossary

This file is a glossary, not an implementation log or a copy of the requirements. Definitions here are the canonical
meaning of terms used by agents and maintainers.

## Authority and shape

**DSH-native plugin suite**
Out-of-tree Cordis/Bundle/Client packages installed into an existing DeepSeek Harness Host. DSH owns Agent, Session, Goal,
Skill, Tool, Approval, Jobs, Schedule, Workspace, storage, permissions, and lifecycle.

**DSH Authority**
The single source of truth for the objects above. EvoForge may store bounded, namespaced records through DSH Storage but
never creates a parallel Session, Goal, scheduler, approval system, database, or runtime.

**Feature extension**
A capability that remains useful when DSH behaves according to its documented contract. A DSH Core Defect belongs upstream;
EvoForge may supply a minimal reproduction, not a shadow implementation.

**Capability Suite**
A user-facing installation preset that expands to official Bundle artifacts. `product` is the complete default;
`delivery` and `continuity` are public add-ons, and `attention` is optional. `core`, `channels`, `evolution`, `control`, and
`gateway` are compatibility/development presets; `full` is maintainer-only. A suite is not a runtime or marketplace.

**Logical package id / distribution name**
The logical id used by a suite manifest is separate from the eventual registry name. For example, the logical gateway,
feishu, and telegram components currently ship from repository packages named dsh-evoforge-gateway,
dsh-evoforge-feishu, and dsh-evoforge-telegram. Never infer a public registry name from a logical id.

**Assembled Plugin Contract**
A clean-profile proof that official add/dump/boot, real DSH Session execution, reload/dispose, remove, native readback,
and resource cleanup all work for the declared DSH revision.

## Interaction and continuity

**Interaction**
One native DSH message, command, attachment, feedback event, schedule dispatch, or channel event. It may refer to a native
Goal, but it does not require one.

**Work episode**
A read-only projection that groups related Interaction records from native Session/Workspace logs. It is not a persisted
Session, Goal, task queue, or authority.

**Native Goal**
The DSH object for explicit long-running work, continuation, and recovery. It is optional for ordinary conversation; text
cannot create permission or bypass approval.

**GoalIntent**
A transient semantic projection of ordinary text when it contains a desired result, materials, constraints, or acceptance
criteria. It is not a DSH Goal, storage record, task queue, or permission grant; the Interaction remains valid when no such
projection can be formed.

**Authorized Goal Continuation**
A policy allowing one explicitly bound native Session to continue an active native Goal after cold resume within existing
limits. It does not discover Sessions or retry indefinitely.

**Resident Service**
A user-level launchd/systemd registration that starts one DSH profile. It is an OS plan and lifecycle adapter, not a second
Gateway or supervisor database.

## Channels

**DSH Gateway**
The single resident Host module for transport-neutral identity normalization, pairing, Workspace/Session binding, ingress and
outbound intent, deduplication, rate limits, uncertain effects, and redacted health. It does not own platform SDKs or DSH
Session/Goal/Approval authority.

**Channel Adapter**
A removable platform integration that owns SDK/WebSocket/long-poll behavior, credential references, platform formatting,
attachments, and sends. It delegates routing and persistence to Gateway/DSH.

**Channel Pairing Request**
A short-lived Host record created by an untrusted principal's first direct message. The first message is consumed before
Agent dispatch; only a salted code digest, exact endpoint, expiry, and bounded retry facts persist.

**Channel Trust Grant / Revocation**
An atomic Host decision binding or ending one exact principal-to-native-Session route. Revocation keeps native history,
blocks future effects, and causes a later message to pair again.

**Uncertain External Effect**
A durable intent whose external result was not recorded before interruption. Recovery must surface uncertainty and avoid
automatic duplicate effects.

## Evolution

**Experience Signal**
A factual observation attached to an Interaction or artifact: outcome, explicit correction, validation result, observed
additional work, measured token/latency/cache use, or external effect. It is not a reward or causal proof.

**Capability Map**
A Host-visible inventory of installed Skill/Tool identity, scope, version, verification, permissions, and selected Generation.
It guides internal routing and is not a user menu or second registry.

**Capability Gap**
A falsifiable missing-capability statement after applicability, configuration, permission, and DSH contract checks. A
generic failure, retry, or preference is not a gap.

**Self-discovery**
Host-side discovery of reusable patterns from DSH-owned Interaction and outcome evidence. It explicitly excludes runtime
marketplace/ClawHub search, download, import, and external Skill acquisition. Design-time research is separate.

**Skill Investigation**
A review record for a suspected missing capability or existing-Skill problem. It may abstain and has no mutation authority.

**Evolution Candidate**
An inactive, complete, content-addressed Skill tree bound to its evidence, parent Generation, DSH revision, evaluator, scope,
permissions, and provenance. It cannot alter an active Session, evaluator, profile, or governance plane.

**Generation**
A content-addressed Skill version selected by the Host for future Sessions. Current Sessions remain pinned to their original
Generation until they end.

**Fast Evolution Loop**
An online, bounded writer of Experience Signals and investigations. It never activates or publishes a Candidate.

**Slow Evolution Loop**
An offline, evidence-gated author/evaluate/review process that may produce a future-Session Generation or quarantine result.

**Evaluation Governance Plane**
The independent owner of protected cases, gold expectations, evaluator policy, holdout/retention partitions, comparisons, and
release eligibility. A proposer cannot read or mutate it and cannot be the final judge.

**Abstain / Quarantine / Uncertain**
First-class outcomes for insufficient evidence, unsafe Candidate, or unknown external execution. None is a pass.

**Protected Action**
An action that can change code, credentials, profile, OS service, paid provider usage, or external state. It requires native
DSH policy and Approval; natural language cannot enlarge authority.

**Retention / Canary / Rollback**
Retention tests future reuse on unseen prior cases. Canary observes a promoted Generation against its exact baseline.
Rollback atomically changes the future-Session pointer after independent evidence; it cannot undo effects already sent.

## Web and evidence

**Control Center**
A removable DSH Client module that registers one Session-scoped conversation.view and a child slot for plugin projections.
It is model-free and does not copy DSH state. Blank Sessions or onboarding may legitimately hide the slot.

**Evidence State**
The strongest claim supported by reproducible evidence: designed, implemented, verified, better for a named workflow,
partial, blocked, or not-measured. A local fixture cannot be promoted to better.

**Verified Release Tag**
An annotated SemVer tag on main created only after the declared release gates pass. It identifies repository code, not a
runtime Candidate or Generation.
