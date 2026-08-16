# dsh-evolve

`dsh-evolve` is an evidence-driven evolution extension for DeepSeek Harness. It currently contains eleven deliberately separate lanes:

- **P0A Shadow** compares an active Skill with an inactive Candidate without changing live DSH.
- **P0B Local Continuity** records immutable Capability Generations, pins one Generation per Session, switches or rolls back only future Sessions, and resumes durable sealed work through an optional resident supervisor.
- **P0C Human Control** reviews completed evidence and publishes approved Candidates as inactive Generations before a separate explicit promotion.
- **P1.1 Narrow Autonomy** optionally auto-promotes only allowlisted, append-only instruction clear wins; every other Candidate remains human review.
- **P2D.1 Delivery Signals** passively associates verified `complete_delivery` outcomes with the Session-pinned Generation and shows only bounded host-side aggregates.
- **P1.2 Counterfactual Canary** asynchronously replays the original sealed Case Pack against the exact Git parent and Candidate before any automatic rollback.
- **P1.3 Explicit Feedback Intake** projects current negative DSH message feedback with a note into a retractable, reference-only host signal without copying the note.
- **P1.4 Private Feedback Case Draft** explicitly copies one exact, single-Skill correction into an unscored private draft without creating a Candidate.
- **P1.5 Feedback-guided Shadow** uses one exact private draft only as proposer search evidence while an existing calibrated Case Pack remains the evaluator.
- **P1.6 Pre-proposal Calibration** proves known-bad/known-correction direction with zero model calls and makes complete Shadow runs pass that gate before requesting a Candidate.
- **P1.7 Evaluator Authoring** provides an explicit, non-runtime Skill for turning one reproducible novel failure into independent search/calibration/final-test partitions and a calibrated evaluator.

The offline evaluation command is:

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir> [--feedback-draft <private-draft.json>]
```

Before spending proposer budget, a Case Pack author can run:

```bash
dsh-evolve calibrate --case-pack <case-pack-dir> --output <new-run-dir>
```

This executes only known-bad and known-correction through the same sealed
evaluator, records zero model calls/tokens, and writes one
`calibration-report.json`. Complete Shadow runs perform this gate automatically
before the proposer. Their successful paired Trial remains four executions total:
two calibration fixtures, baseline, and Candidate.

For a failure class that has no trusted Case Pack, explicitly use the repository's
[`author-dsh-evolution-case`](../../skills/author-dsh-evolution-case/SKILL.md) Skill. It requires an
observable reproduction, known-bad and independently confirmed correction, realistic negative
controls, and a red-then-green evaluator before calibration. The Skill has implicit invocation
disabled and is not part of the DSH runtime model surface. It does not claim to generate a grader
automatically.

When the DSH composition includes native Commands, the host-only human release
surface is also available:

```text
/evolve status
/evolve feedback
/evolve feedback <64-char-signal-id>
/evolve feedback <64-char-signal-id> draft <skill-name>
/evolve review
/evolve review <64-char-review-id>
/evolve review <64-char-review-id> reject <note>
/evolve review <64-char-review-id> approve <note>
/evolve pause
/evolve resume
/evolve promote <64-char-generation-id>
/evolve rollback
```

It never invokes the model. Review approval verifies the completed Shadow
evidence and exact Git Skill tree, then creates an immutable owned Git ref and
inactive Generation without moving the user's branch, worktree, or active
pointer. Review detail first reconstructs that same verified baseline and sealed
Candidate and renders at most 16 KiB of their diff; control characters are escaped
and truncation is explicit. It does not persist another patch copy. Promotion remains a separate explicit action. Promotion/rollback
changes only future Sessions; existing Sessions keep their pin.

After an interrupted run, explicitly resume the same immutable inputs with
`--resume`. A durable Candidate resumes at the sealed Trial. A proposal whose
request was observed but whose response was not recorded becomes
`incomplete/uncertain`; it is never retried automatically because the request
may have been paid.

Shadow proposes and evaluates an inactive Skill candidate. It never edits the active Skill and does not add a Tool, provider, system-prompt fragment, or other model-visible surface to normal DSH Sessions. With no active Capability Generation, the runtime plugin also adds no model-visible surface.

## Current status

The implemented Shadow slices include:

- one bounded OpenAI-compatible proposer request;
- deterministic hashing of the active Skill and case pack;
- rejection before application when a candidate names a path outside the owned Skill;
- fail-closed enforcement of reported input/output token limits;
- an auditable `report.json` and minimal proposal evidence;
- a durable run journal, deterministic proposal effect id, and explicit `--resume` path;
- refusal to auto-retry an uncertain paid proposal, while a durable Candidate may restart its sealed Trial;
- exit `2` plus an incomplete report when the model, integrity, budget, platform, or configured Trial boundary cannot support a recommendation;
- no write outside the requested run directory, including through a symlinked output parent;
- pre-proposal fail-closed calibration, so an invalid evaluator consumes zero proposer tokens;

On macOS, a Case Pack can add explicit search evidence, known-bad and
known-correction trees, and a trusted single-file evaluator. `shadow` first
calibrates the evaluator without a model call, exposes only the search evidence
to the proposer, then compares baseline and Candidate. The complete path remains
four separate Sealed Trials, and the hidden final test never enters the proposer.
An opt-in assembled Case Pack can also mount one exact DSH checkout read-only,
verify its Git revision, and boot the real Loader, Agent Loop, Skill path, and a
real tool round trip with a keyless scripted adapter. Candidate files remain
inactive data; arbitrary Candidate code is not executed. The first product
fixture typechecks and loads a trusted cache-safe host status service. A second
fixture starts real timer and watcher resources and verifies exact ownership
across restart, disable, re-enable, and root disposal. A third fixture performs
real offline `dsh plugin add/remove`, exact config dumps, and pinned App Boot
before and after removal. Linux and Windows adapters and a workspace disk quota
remain open work. One locally held-out `fail → pass` case passed after the
Candidate and Case Pack were frozen; that is local evidence, not third-party or
real-provider proof.

The P0B.1 runtime kernel also proves on the pinned DSH revision that:

- Generation manifests and the active pointer survive restart through a real DSH Storage Domain;
- promotion verifies the exact Git commit/tree before the pointer can move;
- each root Session receives one durable, lifecycle-bound pin, including an explicit native-DSH pin when no Generation is active;
- resume keeps the original pin, and a child inherits its parent's pin;
- the scoped Skill Provider serves a read-only materialization of the exact Git tree, including relative resources;
- promotion and rollback do not change any live Session;
- a failed pin write or damaged/missing Git tree disables only the evolved overlay and lets the native Agent turn continue; an integrity fallback is durably pinned to native when Storage remains writable;
- `SIGKILL` before publication, after publication, after promotion, and after rollback recovers to an exact non-torn state;
- the first Generation can roll back to native DSH, while older live Sessions remain unchanged;
- the packed artifact installs into a real DSH profile, boots, removes cleanly, and leaves native DSH composition intact;
- removing the plugin leaves native DSH Session and Goal facts readable.

P2D.1 observes the native final `tools/result` asynchronously. It retains at most
1,000 compact, idempotent outcomes and adds aggregate delivery counts to
`/evolve status`; prompts, repository paths, PR bodies, check output, and model
surface are excluded. A delivery failure is not attributed to the active Skill
and never triggers rollback by itself. For allowlisted automatic Generations,
P1.2 may submit the original Case Pack and exact immutable parent/Candidate trees
as one native `evolution` Job. Only calibrated parent-pass/Candidate-fail evidence
with an unchanged active pointer rolls back future Sessions. Candidate pass keeps
the version; every ambiguous or drifting case remains review. Its run-local
journal recovers a crash around the pointer write without repeating rollback.
Each immutable Generation runs at most one such four-execution canary, regardless
of how many later failures are observed.

P1.3 listens only to DSH's durable `message_feedback` change surface. It retains
at most 1,000 Session rows and 100 current signals per Session. A signal contains
Session/message references, the opaque feedback version, timestamps, and the
pinned Generation; it excludes the note, note hash, lifecycle fields,
cwd, transcript, Prompt, and message body. Changing the item to positive, removing
its note, or deleting it retracts the derived signal. Counts are host-only in
`/evolve status`, with zero model calls and no Tool, Prompt, or Skill-catalog
change. P1.4 can copy one direct user text and correction only after both a
private `feedbackDraftRoot` is configured and a user explicitly selects one
signal and one Skill through the host command. It rechecks the native feedback
version, durable Session lifecycle, pinned Generation, exact Git artifact, and
requires exactly one explicit target-Skill invocation. The content-addressed
`0600` draft excludes the assistant response, Tool output, Skill body, cwd, and
full transcript. It has no replay result or evaluator score and does not create
a Candidate. An explicit `shadow --feedback-draft` may use that exact draft to
guide the proposer only when its target name and whole-Skill content hash match
the active Skill. The existing calibrated Case Pack remains the independent
evaluator. Draft input fields are not directly copied into the report, proposal
evidence, or run journal; only its content id and private resume path are added.
The proposer claim and Candidate are durable for crash recovery, so model output
that echoes or paraphrases the draft can still be retained.

This is still pre-alpha. There is no paginated/graphical diff UI, real-task
false-promotion/false-rollback dataset, release, or production support. Explicit and resident
Shadow recovery now cover bounded proposer/Candidate/Trial crash boundaries, but
short automated soak is not production multi-day evidence. This is not a claim
that continuous self-improvement is complete.

## Runtime configuration (P0B)

The runtime plugin requires DSH Storage Domain and a source mapping for every
Skill that a Generation may activate:

```yaml
- id: dsh-evolve
  name: dsh-evolve
  config:
    cacheRoot: /absolute/path/to/.dsh/evoforge/git-skills
    feedbackDraftRoot: /absolute/path/to/.dsh/evoforge/private-feedback-drafts
    sources:
      - name: build-dsh-plugin
        repository: /absolute/path/to/owned-git-repository
        path: skills/build-dsh-plugin
    supervisor:
      runRoots:
        - /absolute/path/to/.dsh/evoforge/runs
      scanIntervalMs: 30000
    autoPromote:
      skills:
        - build-dsh-plugin
```

`feedbackDraftRoot` is optional. Setting it authorizes local copying of the
minimal user text and correction, but does not create anything automatically.
Draft creation additionally requires native Message Feedback, Session
Persistence, Commands, and an explicit `/evolve feedback <id> draft <skill>`.
The directory must be a real private directory with no group/world permissions.

`supervisor` is optional. When configured, the DSH composition must also load a
native `ctx.jobs` implementation such as `@deepseek-ai/dsh-jobs-local`. Each
direct child of a run root may contain one Shadow `run-state.json`. Only
`candidate-ready` and `trial-running` are resumed; prepared or uncertain paid
proposal work is never started automatically. Jobs supplies current-process
visibility and cancellation, while the journal remains the restart authority.
Cancelling a recovery suppresses that run for the rest of the current DSH
process; a later DSH restart may discover the still-durable Trial again.

When `autoPromote` is enabled, the same supervisor also scans compact failed
Delivery Outcomes after promotion. Counterfactual work reuses native Jobs and
the original run-local evidence; it does not add another daemon or scheduler.
The original originating Session continues immediately and keeps its pinned
Generation. Canary proposal-model token cost is zero; trusted evaluator cost is
still governed by the original Case Pack budget.

`/evolve pause` durably stops only automatic resident recovery; normal Sessions,
explicit Shadow CLI runs, review, promotion, and rollback remain available.
`/evolve resume` durably clears the pause and wakes discovery immediately. A
restart honors the stored state, and release pointer writes do not clear it.

The same `supervisor.runRoots` feed the host-only review inbox even when Jobs is
not installed. Only completed `promote` or `review` reports become pending
reviews. Approval accepts a full review id and a human note, publishes an
inactive Generation, and returns the full id required by `/evolve promote`.
Rejection and approval are durably bound to the evidence hash beside the run.

`autoPromote` is optional and disabled when its Skill list is empty or absent.
It also requires the resident supervisor and native Jobs. Version
`auto-clear-instruction-v1` accepts only an allowlisted exact baseline, explicit
assembled composition stability, a sealed baseline-fail/Candidate-pass result,
four or more Trial executions, and one non-empty append of at most 2 KiB to
`SKILL.md`. Protected-action, tool, permission, secret, network, deployment,
payment, messaging, and calendar terms route to human review. The lexical gate
is conservative routing, not a semantic security boundary; DSH Approval remains
authoritative. Automatic approval is durable before future-session activation,
so a crash between them is retryable.

`repository` remains the source of truth. `cacheRoot` is a rebuildable,
read-only materialization cache; it is never the authority for a Generation.
Only regular non-executable files are accepted in a P0B Skill tree, and the
total materialized tree is limited to 16 MiB. An inactive manifest may be
recorded first, but `promoteGeneration(id)` and rollback verify and materialize
the target Git tree before the single durable active-pointer write. Rolling
back the root clears the pointer and returns future Sessions to native DSH.

The host-only service is named `evoforge.evolution` and exposes publication,
lookup, promotion, rollback, Session pin lookup, and close operations. It adds
no Tool or system-prompt fragment. When a Generation is active, its Skill
catalog is model-visible through DSH's existing Skill path and is frozen for
that Session; Skill bodies remain on-demand.

## Run the tracer

The command is an explicit model request and may consume a paid provider budget. Configure a versioned case pack with positive token limits, then set the route for that invocation:

```bash
export DSH_EVOLVE_MODEL_BASE_URL=https://example.invalid/v1
export DSH_EVOLVE_MODEL_NAME=your-model
export DSH_EVOLVE_MODEL_API_KEY=your-key # optional for local/keyless routes

dsh-evolve shadow ./my-skill \
  --case-pack ./my-case-pack \
  --output ./runs/first-shadow
```

To guide proposal search with one explicitly selected correction, add:

```bash
  --feedback-draft /absolute/private/path/<draft-id>.json
```

This explicit invocation authorizes both the potentially paid proposer request
and disclosure of that draft's direct user text and correction to the configured
provider. The extra proposer input is bounded by the draft's 8 KiB user-text and
4 KiB correction limits and the Case Pack's shared `inputTokenLimit` (roughly
3,072 input tokens at the draft byte limit). Normal DSH Sessions still add zero
Evolve tokens or model-visible surfaces. The API key is used only as the request
credential and is not included in evidence, reports, fingerprints, stdout, or
stderr.

Exit codes:

- `0`: evaluation finished with `promote`, `review`, or `reject` as a business result;
- `1`: invocation, configuration, path, or compatibility error before a valid Trial;
- `2`: incomplete evaluation; evidence is retained when possible, but no recommendation is fabricated.

## Develop

From the repository root:

```bash
pnpm install
pnpm --filter dsh-evolve test
pnpm --filter dsh-evolve typecheck
pnpm --filter dsh-evolve build
```

The CLI tests cross the process boundary and use a local fixed HTTP model server. The evaluator and filesystem effects are not mocked.
