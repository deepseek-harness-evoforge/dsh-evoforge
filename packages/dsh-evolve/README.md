# dsh-evolve

`dsh-evolve` is an evidence-driven evolution extension for DeepSeek Harness. Its first delivery is the offline Shadow command:

```bash
dsh-evolve shadow <skill-dir> --case-pack <case-pack-dir> --output <run-dir>
```

Shadow proposes and evaluates an inactive Skill candidate. It never edits the active Skill and does not add a Tool, provider, system-prompt fragment, or other model-visible surface to normal DSH Sessions. This keeps the normal-Session token and KV-cache delta at zero.

## Current status

P0A.1 implements the first safety tracer:

- one bounded OpenAI-compatible proposer request;
- deterministic hashing of the active Skill and case pack;
- rejection before application when a candidate names a path outside the owned Skill;
- fail-closed enforcement of reported input/output token limits;
- an auditable `report.json` and minimal proposal evidence;
- exit `2` plus an incomplete report when the model boundary fails or an in-scope candidate reaches the not-yet-implemented Trial evaluator;
- no write outside the requested run directory, including through a symlinked output parent.

P0A.1 is not yet a useful self-improvement release. It proves the mutation boundary before adding Trial execution. A candidate that passes the path gate is deliberately left `incomplete`, never guessed to be good or bad.

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
