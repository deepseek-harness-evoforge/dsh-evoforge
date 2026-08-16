# dsh-evolve-web

`dsh-evolve-web` is the optional, removable DSH Web adapter for `dsh-evolve`. It installs as one DSH profile Bundle and adds a root-scoped **Evolution** action beside Settings. The action remains available when no Session exists.

The panel reads the authoritative host state only when opened or explicitly refreshed. It shows the active Generation, resident-recovery state, automatic-promotion policy, current explicit-feedback signal ids, statically configured Shadow/Evaluator targets, private Evaluator Drafts, recent Shadow runs, pending reviews, bounded diffs, Trial counts, token evidence, and conservative protected-effect indicators. A Candidate detail keeps its improvement claim beside the exact changed files, decision reasons, limitations, cases, cost, impact indicators, and verified diff. Starting Feedback Shadow or authoring an Evaluator requires a confirmation that discloses the possible model charge and private correction transfer. Inspecting a Draft exposes only its bounded generated files; qualifying it requires a second, distinct confirmation before generated code enters the sealed runner. Qualification produces only a Qualified Case Pack. Starting that qualified pack requires a third, fresh paid-disclosure confirmation and reuses the existing Shadow path. Approval publishes an inactive Generation and closes the stale review form; promotion is always a separate action. Author, qualify, Shadow launch, reject, pause, resume, promote, and rollback preserve the same owners used by the host Commands surface.

Approved inactive Generations are projected from durable review evidence rather
than browser memory, so a refresh or process restart between approval and
promotion does not force the user back to the command line.

## Install

After both packages are published:

```bash
dsh plugin --profile web add dsh-evolve-web
```

The Bundle inserts exactly two rows: the `dsh-evolve` host runtime and this Web adapter. Its default configuration leaves resident recovery, Git Skill sources, private feedback copies, and automatic promotion disabled. Configure those explicitly in the profile's later `cordis.patch.yml` layer.

For local tarballs from this repository, install both artifacts in one invocation because `dsh-evolve` is not available from a registry yet:

```bash
pnpm --filter dsh-evolve pack --pack-destination "$PWD/.evoforge/pack"
pnpm --filter dsh-evolve-web pack --pack-destination "$PWD/.evoforge/pack"

dsh plugin --profile web add \
  "$PWD/.evoforge/pack/dsh-evolve-0.1.0-alpha.1.tgz" \
  "$PWD/.evoforge/pack/dsh-evolve-web-0.1.0-alpha.1.tgz"
```

Remove the Bundle with:

```bash
dsh plugin --profile web remove dsh-evolve-web
```

## Optional resident recovery

The Bundle intentionally does not guess an owned run directory or enable automatic promotion. Add a later profile patch when the operator has selected the directories and Git sources:

```yaml
- id: evoforge-evolution
  config:
    cacheRoot: !!js dshHomePath('evoforge', 'git-skills')
    supervisor:
      runRoots:
        - !!js dshHomePath('evoforge', 'plugin-delivery-runs')
        - !!js dshHomePath('evoforge', 'plugin-delivery-qualified-runs')
      scanIntervalMs: 30000
    feedbackDraftRoot: !!js dshHomePath('evoforge', 'private-feedback-drafts')
    shadowTargets:
      - id: plugin-delivery
        skill: build-dsh-plugin
        casePackDir: /absolute/path/to/calibrated-plugin-delivery-cases
        runRoot: !!js dshHomePath('evoforge', 'plugin-delivery-runs')
    evaluatorTargets:
      - id: plugin-delivery-evaluator
        skill: build-dsh-plugin
        root: !!js dshHomePath('evoforge', 'private-evaluator-drafts')
        dshRevision: 47f943859bef60e4160492346772ded9b24f765a
        shadowRunRoot: !!js dshHomePath('evoforge', 'plugin-delivery-qualified-runs')
```

Create both run roots before boot. The shipped Web profile already provides native Jobs, Storage Domain, Commands, and the browser runtime required by this configuration.

## Cache and privacy contract

- no Tool, Prompt, Skill, system message, or Session event is added;
- normal model requests gain zero tokens and retain the native DSH request shape;
- no background polling occurs; open, refresh, and completed actions cause reads;
- the Remote excludes run paths, proposal objects, feedback text, Prompt, cwd, and Session messages;
- at most 20 feedback signals, 20 static targets, 20 recent Shadow runs, 20 actionable reviews, 20 approved inactive Generations, and one bounded diff cross the browser transport;
- Shadow launch transports only a signal id and target id; host paths, feedback text, and model parameters never enter the browser;
- Evaluator Author transports only a signal id and static target id; qualification transports only the exact draft id and human note; Qualified Shadow transports only the exact draft id;
- the browser never becomes a second source of truth.

See [ADR-0025](../../docs/adr/0025-web-is-a-thin-kv-safe-adapter.md), the [base real-browser evidence](../../docs/evidence/p0c-6-web-control-plane.zh.md), the [explainable-review Chrome evidence](../../docs/evidence/ui-1-explainable-review.zh.md), and the [target-bound Shadow browser evidence](../../docs/evidence/p1-8-explicit-feedback-shadow-launch.zh.md).
