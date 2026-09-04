# dsh-evolve

Host-side, evidence-gated Skill evolution for DSH. It observes native interactions and results, records bounded signals,
and manages inactive content-addressed Candidates without creating a second Agent, Session, Goal, approval system,
scheduler, database, or runtime.

## User result

- Ordinary DSH conversation stays unchanged; a Goal is optional and only belongs to DSH long-running continuation.
- Corrections, failed checks, rework, measured outcomes, token/latency/cache facts, and uncertain effects can become
  evidence. A single failure, retry, preference, or model self-score cannot rewrite a Skill.
- Candidate authoring, execution, and evaluation governance are separate. Missing evidence yields `abstain`, `review`,
  or `quarantine`.
- Promotion changes only future Session selection. The active Session remains pinned; canary and rollback are exact
  Host decisions.

The current implementation persists a no-Goal gap signal but deliberately stops it at `abstained`; the complete
Interaction-episode slow loop and real-provider proof remain release blockers. See [current status](../../docs/status.zh.md).

## Install and use

Normal users install the complete product:

```sh
pnpm run dsh:install
```

Use the Evolution surface in the same DSH Web conversation view. The compatibility `core`/`evolution` suites exist only
for old deployments and isolated development. External Skill marketplaces, runtime downloads, and other Agents are not
evolution sources.

## Remove

```sh
dsh plugin --profile web remove dsh-evolve
```

Remove `dsh-evolve-web` first if that Client adapter is installed. Native Session/Goal/Workspace data and external effects
remain. Design and claim boundaries are in [evolution design](../../docs/architecture/evolution-design.zh.md) and the
[Hermes scorecard](../../docs/architecture/hermes-replacement-scorecard.zh.md).
