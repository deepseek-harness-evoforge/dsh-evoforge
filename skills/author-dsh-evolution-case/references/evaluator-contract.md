# EvoForge evaluator contract

Use this reference while authoring or reviewing a Case Pack. The source of truth is
[`trial.ts`](../../../packages/dsh-evolve/src/trial.ts) and the manifest parser in
[`shadow.ts`](../../../packages/dsh-evolve/src/shadow.ts).

## Layout

```text
case-pack/
  manifest.json
  evidence/rationale.md
  calibration/known-bad/SKILL.md
  calibration/known-correction/SKILL.md
  final-test/evaluator.mjs
```

Only `evidence/rationale.md` enters the Candidate-authoring request. It records bounded internal evidence and is not an
external-search result. The calibration trees and evaluator stay on
the trusted host side. Keep a real held-out input inside the evaluator or its sealed workspace;
repeatedly exposed final-test data becomes selection data and requires a new final test.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "one-failure-class",
  "epoch": {
    "dshRevision": "exact-git-commit",
    "evaluatorVersion": "one-failure-class-v1"
  },
  "budget": {
    "candidateLimit": 1,
    "trialLimit": 4,
    "inputTokenLimit": 4000,
    "outputTokenLimit": 600
  },
  "evidence": { "rationale": "evidence/rationale.md" },
  "trial": {
    "evaluator": "final-test/evaluator.mjs",
    "timeoutMs": 10000,
    "outputLimitBytes": 65536,
    "dshAssembled": true
  },
  "calibration": {
    "knownBad": "calibration/known-bad",
    "knownCorrection": "calibration/known-correction"
  }
}
```

Use `dshAssembled` only when the evaluator actually boots the pinned DSH composition. Add
`dshProfileInstall` only for a real profile install/remove case. The current sealed executor is
macOS-only and fails closed elsewhere.

## Evaluator process

EvoForge invokes:

```text
node evaluator.mjs <candidate-dir> [<dsh-source-dir> [<pnpm-bin>]]
```

The evaluator receives a writable copy of one Skill tree, not the Case Pack path. Emit one JSON
object on stdout and send diagnostics to stderr:

```json
{
  "schemaVersion": 1,
  "passed": true,
  "checks": [{ "name": "observable-behavior", "passed": true }],
  "composition": {
    "fingerprint": "64-lowercase-hex",
    "modelCalls": 0,
    "usage": {}
  }
}
```

`checks` must be non-empty and `passed` must equal `checks.every(check => check.passed)`.
Assembled evaluators must include composition evidence. Output overflow, timeout, nonzero exit,
malformed JSON, missing composition, or aggregate contradiction makes the Trial incomplete.

## Integrity gates

- Use relative owned manifest paths; symlink or root escape fails closed.
- Set `trialLimit >= 4`: two calibration and two comparison executions.
- Freeze the Case Pack before proposal; any tree-hash drift invalidates the run.
- Keep proposer inputs, evaluator source, calibration fixtures, and held-out data disjoint.
- Calibrate known-bad `fail` and known-correction `pass` before any provider call.
- Preserve the active Skill and current Session; a recommendation only creates reviewable evidence.

See the assembled examples under [`examples/case-packs`](../../../examples/case-packs) for bounded
DSH boot, lifecycle, cache-composition, and profile-install patterns.
