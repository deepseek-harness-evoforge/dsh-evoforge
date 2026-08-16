# dsh-evolve

`dsh-evolve` is an evidence-driven evolution extension for DeepSeek Harness. It currently contains two deliberately separate lanes:

- **P0A Shadow** compares an active Skill with an inactive Candidate without changing live DSH.
- **P0B.1 release kernel** records immutable Capability Generations, pins one Generation per Session, and switches or rolls back only future Sessions.

The user-facing command remains the offline Shadow command:

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

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
- no write outside the requested run directory, including through a symlinked output parent.

On macOS, a Case Pack can add explicit search evidence, known-bad and
known-correction trees, and a trusted single-file evaluator. `shadow` exposes
only the search evidence to the proposer, then runs four separate Sealed Trials
for calibration, baseline, and Candidate before opening the hidden final test.
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

This is still pre-alpha. There is no end-user promotion command, review inbox,
automatic promotion policy, an always-on Job supervisor, release, or production
support. Explicit Shadow runs now have bounded proposer/Candidate/Trial crash
recovery, but this is not a multi-day autonomous runtime. The runtime service is an implementation surface for P0B
testing, not a claim that continuous self-improvement is complete.

## Runtime configuration (P0B.1)

The runtime plugin requires DSH Storage Domain and a source mapping for every
Skill that a Generation may activate:

```yaml
- id: dsh-evolve
  name: dsh-evolve
  config:
    cacheRoot: /absolute/path/to/.dsh/evoforge/git-skills
    sources:
      - name: build-dsh-plugin
        repository: /absolute/path/to/owned-git-repository
        path: skills/build-dsh-plugin
```

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

The API key is used only as the request credential. It is not included in evidence, reports, fingerprints, stdout, or stderr.

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
