---
name: author-dsh-evolution-case
description: Turn one reproducible, previously uncovered DSH Skill failure into a private calibrated EvoForge Case Pack with an independent deterministic evaluator, known-bad and known-correction fixtures, sealed-Trial boundaries, and an honest evidence handoff. Use when a Feedback Case Draft has no trusted evaluator, a new failure class must become replayable, or an existing Case Pack may be tautological, leaky, or unable to reject realistic negative controls.
---

# Author a DSH Evolution Case

Produce one trusted evaluator for one observed failure. Treat evaluator authoring as test engineering: the correction may guide the Candidate, but it cannot grade itself.

Read [references/evaluator-contract.md](references/evaluator-contract.md) before creating or changing a Case Pack.

## 1. Establish the case

1. Locate the EvoForge checkout, exact DSH revision, target Skill tree, private Feedback Case Draft if used, and applicable repository instructions.
2. Write one falsifiable sentence: “Given `<input/state>`, the current Skill causes `<observable failure>`; a correct Skill produces `<observable outcome>`.”
3. Reproduce the failure without changing the target Skill. Prefer repository checks, exact host state, lifecycle/resource probes, or read-only external facts. Use model judgment only as supplemental evidence.
4. Record the smallest trusted fixture that reproduces it and an independently reviewed correction that fixes it.

Complete when the same observable check fails on the known-bad tree and passes on the known-correction tree. If the outcome is subjective, unreplayable, secret-dependent, or only restates the correction text, stop with an investigation note; no Case Pack or Candidate is justified yet.

## 2. Freeze independent evidence

Keep four roles separate:

- `search/evidence.md`: facts the proposer may see; exclude hidden expectations and evaluator source.
- `calibration/known-bad/`: an exact Skill tree that exhibits the failure.
- `calibration/known-correction/`: an exact, human-confirmed Skill tree that fixes it.
- `final-test/evaluator.mjs`: trusted checks that observe behavior without consulting Candidate claims.

Start from the closest existing `examples/case-packs/` fixture. Preserve one failure class per pack. Add at least one realistic negative control that can contain the expected vocabulary yet still behaves incorrectly; a text-presence check alone is not sufficient behavioral evidence.

Complete when the evaluator contract, hidden inputs, expected outcome, budgets, and epoch are fixed before any new Candidate is proposed.

## 3. Make the evaluator red

1. Write the evaluator against the known-bad tree first.
2. Run it only through EvoForge's sealed path; keep spawned processes bounded and clean up owned resources.
3. Confirm known-bad fails for the intended observable reason, not a setup error.
4. Confirm each negative control fails.
5. Run the unchanged evaluator on known-correction and confirm every required check passes.

Prefer real parse/typecheck/test, DSH Loader/Agent/Tool round trips, lifecycle disposal, cache-composition snapshots, or exact artifact checks over source-text inspection. Candidate code is untrusted; executable evolution remains a commit/Draft-PR workflow and never activates through this Skill.

Complete when failure and success are attributable to the stated behavior and the evaluator emits the exact bounded JSON contract.

## 4. Calibrate before proposing

Run a fresh zero-model calibration directory:

```bash
dsh-evolve calibrate \
  --case-pack /absolute/private/case-pack \
  --output /absolute/new-calibration-run
```

Require exit `0`, known-bad `fail`, known-correction `pass`, zero proposer calls/tokens, and an unchanged Case Pack hash. On exit `2`, repair the fixture or evaluator; changing the Candidate cannot repair a broken grading direction.

Complete when `calibration-report.json` proves both directions and discloses the exact Case Pack hash and evaluator epoch.

## 5. Run one bounded Shadow

Only after explicit authorization for any provider disclosure or paid request, run:

```bash
dsh-evolve shadow /absolute/target-skill \
  --case-pack /absolute/private/case-pack \
  --output /absolute/new-shadow-run \
  [--feedback-draft /absolute/private/draft.json]
```

The Feedback Case Draft is untrusted search evidence. Keep it out of calibration and final-test inputs. Treat only calibrated `baseline=fail`, `candidate=pass`, unchanged active Skill/Case Pack, stable non-target composition, and passed hard gates as a promotion recommendation. Review or reject every ambiguous result.

Complete when the report is reproducible from durable evidence and no current Session or active Skill changed.

## 6. Hand off

Report:

- observed user failure and exact reproduction;
- target Skill and pinned DSH/evaluator epoch;
- partition contents and privacy location;
- known-bad, negative-control, and known-correction results;
- calibration and Shadow commands, exit status, report path, and hashes;
- model calls/tokens, cache/composition delta, permissions, and external effects;
- recommendation, limitations, and the next protected action.

Keep private prompts, corrections, secrets, evaluator fixtures, and held-out inputs out of public commits. Public evidence may contain bounded redacted metrics and hashes. Do not activate, merge, release, deploy, read secrets, or make paid calls without the authority already required for those actions.

