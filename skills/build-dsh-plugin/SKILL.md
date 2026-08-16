---
name: build-dsh-plugin
description: Design, implement, review, or package an out-of-tree DeepSeek Harness plugin. Use for deciding between Skill, Tool, Cordis runtime plugin, bundle, or Client plugin; selecting DSH services and lifecycle seams; protecting KV Cache; defining permissions and persistence; adding tests; diagnosing whether a request is an upstream DSH core defect; or preparing an EvoForge plugin for release.
---

# Build a DSH Plugin

Produce one removable user capability through supported DSH/Cordis seams. Treat DSH as the runtime and preserve its model-prefix cache discipline.

## 1. Establish authority

1. Locate the target plugin repository and the exact DSH checkout/version it supports.
2. Read every applicable `AGENTS.md`. In EvoForge, also read `CONTEXT.md`, `docs/requirements.zh.md`, `docs/plugin-contract.zh.md`, and the relevant ADR.
3. Inspect the current DSH source and official docs for every API used. Treat remembered API names as hypotheses when the DSH revision differs.
4. Determine whether the user requested design, diagnosis, implementation, review, or release; mutate only within that authority.

Complete when the target revision, governing instructions, requested outcome, and allowed mutation are explicit.

## 2. Pass the feature test

Write one sentence: “For `<user>`, this plugin turns `<input/state>` into `<new outcome>`.” Then apply:

- **Upstream-fixed test**: if a fully correct DSH makes the plugin useless, produce an upstream reproduction instead.
- **Deep-module test**: internal stages that only work together stay private inside one plugin.
- **Repository test**: keep the plugin in the Suite unless it has an independent release/trust boundary, materially different dependencies/license, or a standalone adopter.
- **Evidence test**: name the observable outcome that will prove value before choosing architecture.

Stop the plugin proposal when no independent user result survives these tests.

## 3. Select the smallest DSH shape

- Use a **Skill** for instructions loaded only when needed.
- Use a **Tool Consumer** only when the model must invoke a new atomic action.
- Use a **Cordis runtime plugin** for host observation, commands, services, storage, or composition.
- Use a **Bundle** only when installation should automatically add a profile patch layer.
- Use a **Client plugin/UI Adapter** only for presentation over an existing authoritative Host surface.

Prefer a function plugin. Introduce a `Service` only when another real plugin consumes the named capability. Keep a seam private until two real Adapters establish variation.

Read [references/dsh-contract.md](references/dsh-contract.md) before writing or reviewing runtime code, Bundle metadata, a Tool, or a model-visible contribution.

Complete when the selected form is the smallest one that can produce the user outcome.

## 4. Inventory the surface

Record, before coding:

- required and optional `ctx` services;
- events observed or emitted;
- registrations and owned external resources;
- model-visible prompt, Tool, Schema, Skill catalog/body, and ordering changes;
- durable state and authoritative source;
- filesystem, network, secret, payment, deployment, or irreversible effects;
- host commands/views and human decisions;
- unload, crash, retry, and rollback semantics.

Dependency order comes from `inject`, not config order. Consume Service Definitions, not concrete Providers or `agent-loop`.

Complete when every effect belongs to an owner and every model-visible byte has a stable source.

## 5. Freeze the cache plan

Default to zero model surface. Keep progress, timestamps, approvals, Candidate state, and UI projections in the host plane.

If the plugin changes a model surface:

1. Explain why Skill-on-demand or an existing Tool cannot achieve the outcome.
2. Freeze names, descriptions, Schema, ordering, and catalog for one Session.
3. Ensure every model-visible input can be reconstructed from Session facts.
4. Compare the complete request composition, not a plugin-local string.
5. Define a cache regression gate before implementation.

Promotion or configuration changes affecting the model surface take effect only for future Sessions unless native DSH semantics explicitly guarantee otherwise.

Complete when a test can distinguish stable composition from regression.

## 6. Design red tests

Write failing tests before implementation for every applicable branch:

- config defaults, invalid input, and version mismatch;
- load, dependency loss, reload, dispose, and removal;
- one real assembled DSH path, not only direct function calls;
- model/user-visible snapshot when behavior is visible;
- complete composition stability;
- permission denial and Protected Actions;
- crash points around durable transitions and external writes;
- idempotent retry and exact rollback target.

Use deterministic/keyless evidence first. Add a real-provider smoke only when the behavior depends on a provider.

Complete when each promised behavior and failure mode has an observable red test.

## 7. Implement through owned effects

- Export `name`, hard `inject`, runtime `Config` schema when configurable, and `apply`.
- Register through Cordis/DSH effect APIs. Acquire timers, watchers, processes, connections, and temporary directories inside `ctx.effect()` and return cleanup.
- Store only plugin-owned derived state; keep DSH Session and Goal authoritative.
- Persist before changing authoritative memory. Use stable idempotency keys and query-before-create for external writes.
- Namespace new services under `evoforge.*`.
- Fail loud at load or the earliest point a reference can be resolved.
- Keep executable, permission-expanding, secret, release, deployment, payment, and irreversible changes behind native approval or a declared policy.

Do not add a custom framework manifest when `package.json`, exports, `Config`, and `cordis.patch.yml` already own the facts.

Complete when the red tests pass without widening the interface.

## 8. Verify the assembled capability

Run the smallest checks that cover the changed surface, then prove:

1. install or local-link into a clean DSH profile;
2. `--dump-config` contains only intended rows;
3. boot succeeds with dependencies and fails clearly without required configuration;
4. the real user path produces the promised outcome;
5. reload/dispose leaves no registrations, processes, watchers, or owned temporary data;
6. removal leaves native DSH bootable and its Session/Goal data readable;
7. model composition and cache metrics match the declared class;
8. supported DSH versions pass the same contract tests.

For any Web or GUI change, also exercise the real user-visible flow in a controlled browser, refresh once to verify authoritative state, and inspect the visible failure path. Component tests or screenshots alone do not complete UI verification.

Report only commands actually run. A narrow passing test cannot prove a repository-wide or multi-version claim.

## 9. Hand off evidence

Summarize in one compact record:

- user outcome and non-goals;
- package/repository and supported DSH range;
- DSH seams and model surface;
- permissions, state, external effects, uninstall behavior;
- tests run with results;
- cache delta;
- known limitations and protected next action.

When a finding is a DSH Core Defect, attach a native minimal reproduction and keep it out of the EvoForge feature roadmap.

## Package host-provided runtime dependencies

Declare DSH and Cordis packages supplied by the host in both `peerDependencies` and `devDependencies`, never in production `dependencies`. This keeps local typechecking reproducible without bundling a second host runtime. Verify the packed artifact contains only the intended exports and files, and prove install, boot, removal, and native boot against the exact supported DSH revision.

## Finish the authorized outcome

When implementation is authorized, continue through every remaining safe, in-scope step needed for the requested deliverable. A progress or status update is not completion. Do not turn continuation into open-ended churn or expand the user's authority.

Stop only when one of these conditions is true:

- The requested outcome and its verification are complete.
- You are blocked by missing user authority, required input, or external state after exhausting safe in-scope checks and recovery paths.
- No safe, in-scope work remains.

Before the final handoff, reconcile the requested artifacts with the evidence actually produced. If the authorized outcome includes a push, Draft PR, or remote checks, finish and verify those steps before reporting completion. Protected actions still require the user's existing approval or an explicit policy.
