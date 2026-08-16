# dsh-evolve

`dsh-evolve` is an evidence-driven evolution extension for DeepSeek Harness. Its first delivery is the offline Shadow command:

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

Shadow proposes and evaluates an inactive Skill candidate. It never edits the active Skill and does not add a Tool, provider, system-prompt fragment, or other model-visible surface to normal DSH Sessions. This keeps the normal-Session token and KV-cache delta at zero.

## Current status

The implemented Shadow slices include:

- one bounded OpenAI-compatible proposer request;
- deterministic hashing of the active Skill and case pack;
- rejection before application when a candidate names a path outside the owned Skill;
- fail-closed enforcement of reported input/output token limits;
- an auditable `report.json` and minimal proposal evidence;
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
across restart, disable, re-enable, and root disposal. Linux and Windows
adapters, a workspace disk quota, one product evaluator fixture, and a locally
held-out case remain open work.

This is not yet a useful self-improvement release. The assembled example proves
the mechanics and non-target composition gate, not real-provider improvement or
generalization to a locally held-out case.

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
